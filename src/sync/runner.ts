import type { DatabaseSync } from 'node:sqlite';
import { CliError, type ErrorCode } from '../errors.ts';
import type { Checkpoint, Conversation, Message } from '../models.ts';
import { getCheckpoint, listPendingBackfills, upsertCheckpoint, upsertCheckpointInTransaction } from '../store/checkpoints.ts';
import { getConversation, listConversations, upsertConversations } from '../store/conversations.ts';
import { getMessage, oldestMessageAt, upsertMessagesInTransaction } from '../store/messages.ts';
import { conversationLabel, listMembers, setMembers, upsertPeople, upsertPeopleInTransaction } from '../store/people.ts';
import { upsertTeams } from '../store/teams.ts';
import { transaction } from '../store/database.ts';
import { classifyMessageChange, type SyncEvent } from './events.ts';
import { fetchTeamsAndChats } from '../teams/csa.ts';
import { listConversations as listRemoteConversations } from '../teams/conversations.ts';
import type { Endpoints, TeamsClient } from '../teams/client.ts';
import { listMessages } from '../teams/messages.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const CONVERSATION_SCOPE = 'conversations';
const MAX_RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;

export interface SyncWarning {
  conversationId: string;
  code: 'remote';
  status: number | null;
}

export interface SyncResult {
  conversations: number;
  conversationsSynced: number;
  messages: number;
  warnings: SyncWarning[];
}

export type SyncEventEmitter = (event: SyncEvent) => void;
export type SyncSleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface SyncOptions {
  db: DatabaseSync;
  client: TeamsClient;
  endpoints: Endpoints;
  days: number;
  now: () => Date;
  log: (message: string) => void;
  /** Signed-in user, left out of 1:1 chat labels in progress lines. */
  selfId?: string | null;
  emit?: SyncEventEmitter;
  signal?: AbortSignal;
}

export interface SyncFollowOptions extends SyncOptions {
  intervalSeconds: number;
  signal: AbortSignal;
  sleep: SyncSleep;
}

interface SyncPassResult {
  result: SyncResult;
  complete: boolean;
}

/** Syncs changed conversations and resumes any interrupted history backfills. */
export async function runSync(options: SyncOptions): Promise<SyncResult> {
  try {
    return (await runSyncPass(options)).result;
  } catch (error) {
    emitSyncError(options.emit, error, null, true);
    throw error;
  }
}

/** Repeats sync passes until the command's AbortSignal is raised. */
export async function runSyncFollow({ intervalSeconds, signal, sleep, ...options }: SyncFollowOptions): Promise<SyncResult> {
  let result = emptyResult();
  let rateLimitBackoff = 1000;

  while (!signal.aborted) {
    try {
      const pass = await runSyncPass({ ...options, signal });
      result = pass.result;
      if (!pass.complete || signal.aborted) break;
      rateLimitBackoff = 1000;
      await sleep(intervalSeconds * 1000, signal);
    } catch (error) {
      if (error instanceof CliError && error.code === 'auth_required') {
        emitSyncError(options.emit, error, null, true);
        throw error;
      }
      if (error instanceof CliError && (error.code === 'rate_limited' || error.code === 'remote')) {
        const delay = error.code === 'rate_limited'
          ? Math.max(rateLimitBackoff, retryAfterMs(error))
          : intervalSeconds * 1000;
        emitSyncError(options.emit, error, null, false);
        options.log(`Sync warning: ${error.code}; retrying in ${Math.ceil(delay / 1000)} seconds.`);
        await sleep(delay, signal);
        if (error.code === 'rate_limited') rateLimitBackoff = Math.min(rateLimitBackoff * 2, MAX_RATE_LIMIT_BACKOFF_MS);
        continue;
      }
      emitSyncError(options.emit, error, null, true);
      throw error;
    }
  }

  return result;
}

async function runSyncPass({ db, client, endpoints, days, now, log, selfId = null, emit, signal }: SyncOptions): Promise<SyncPassResult> {
  if (signal?.aborted) return { result: emptyResult(), complete: false };

  const changedIds: string[] = [];
  const listCheckpoint = getCheckpoint(db, CONVERSATION_SCOPE);
  let nextSyncState: string | null = null;

  for await (const page of listRemoteConversations(client, endpoints, listCheckpoint?.syncState ?? undefined)) {
    upsertConversationsAndEmit(db, page.conversations, emit);
    changedIds.push(...page.conversations.map(({ id }) => id));
    nextSyncState = page.syncState;
    if (signal?.aborted) return { result: emptyResult(listConversations(db).length), complete: false };
  }

  const csa = await fetchTeamsAndChats(client, endpoints);
  upsertTeams(db, csa.teams);
  upsertConversationsAndEmit(db, csa.channels, emit);
  upsertPeople(db, csa.people);
  for (const { conversationId, members } of csa.chatMembers) {
    if (getConversation(db, conversationId)) setMembers(db, conversationId, members);
  }
  if (csa.partial) {
    log('Teams returned partial team and chat data.');
    emitSyncError(emit, new CliError('remote', 'Teams returned partial team and chat data.'), null, false);
  }
  if (signal?.aborted) return { result: emptyResult(listConversations(db).length), complete: false };

  const conversations = listConversations(db);
  const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const pendingIds = listPendingBackfills(db).map(({ scope }) => scope);
  const syncedCandidates = [...new Set([...changedIds, ...pendingIds])]
    .map((id) => conversationsById.get(id))
    .filter((conversation): conversation is Conversation => conversation !== undefined && shouldSync(conversation));
  const backfillStartTime = now().getTime() - days * DAY_MS;
  const warnings: SyncWarning[] = [];
  let messages = 0;

  emitProgress(emit, {
    phase: 'conversations', conversationId: null, conversationsDone: 0,
    conversationsTotal: syncedCandidates.length, messages,
  });

  for (const [index, conversation] of syncedCandidates.entries()) {
    if (signal?.aborted) return { result: resultFor(conversations.length, index, messages, warnings), complete: false };
    const checkpoint = getCheckpoint(db, conversation.id);
    const label = conversationLabel(conversation, listMembers(db, conversation.id), selfId) || conversation.id;
    let saved = 0;
    const onPage = (count: number) => {
      saved += count;
      messages += count;
    };
    try {
      const pageOptions = { db, client, endpoints, conversation, checkpoint, now, onPage, emit, signal };
      if (checkpoint?.backwardLink) {
        if (!await syncMessagePages({ ...pageOptions, continuationUrl: checkpoint.backwardLink, backfill: true })) {
          return { result: resultFor(conversations.length, index, messages, warnings), complete: false };
        }
      } else if (checkpoint?.syncState) {
        if (!await syncMessagePages({ ...pageOptions, continuationUrl: checkpoint.syncState, backfill: false })) {
          return { result: resultFor(conversations.length, index, messages, warnings), complete: false };
        }
      } else if (!await syncMessagePages({ ...pageOptions, startTime: backfillStartTime, backfill: true })) {
        return { result: resultFor(conversations.length, index, messages, warnings), complete: false };
      }
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== 'remote') throw error;
      const status = typeof (error.details as { status?: unknown } | null)?.status === 'number'
        ? (error.details as { status: number }).status
        : null;
      warnings.push({ conversationId: conversation.id, code: 'remote', status });
      log(`Sync warning for ${label}: remote${status === null ? '' : ` ${status}`}.`);
      emitSyncError(emit, error, conversation.id, false);
    }
    log(`Sync ${index + 1}/${syncedCandidates.length}: ${label}; ${saved} ${saved === 1 ? 'message' : 'messages'} saved.`);
    emitProgress(emit, {
      phase: 'messages', conversationId: conversation.id,
      conversationsDone: index + 1, conversationsTotal: syncedCandidates.length, messages,
    });
  }

  if (signal?.aborted) return { result: resultFor(conversations.length, syncedCandidates.length, messages, warnings), complete: false };

  // Commit the list cursor last so auth and throttling failures replay the same changed conversations.
  upsertCheckpoint(db, {
    scope: CONVERSATION_SCOPE,
    syncState: nextSyncState,
    backwardLink: null,
    oldestMessageAt: null,
    historyComplete: false,
    updatedAt: now().toISOString(),
  });

  const result = resultFor(conversations.length, syncedCandidates.length, messages, warnings);
  emitProgress(emit, {
    phase: 'done', conversationId: null,
    conversationsDone: syncedCandidates.length, conversationsTotal: syncedCandidates.length, messages,
  });
  return { result, complete: true };
}

interface SyncMessagePagesOptions {
  db: DatabaseSync;
  client: TeamsClient;
  endpoints: Endpoints;
  conversation: Conversation;
  continuationUrl?: string;
  startTime?: number;
  backfill: boolean;
  checkpoint: Checkpoint | null;
  now: () => Date;
  onPage: (count: number) => void;
  emit?: SyncEventEmitter;
  signal?: AbortSignal;
}

async function syncMessagePages({
  db, client, endpoints, conversation, continuationUrl, startTime, backfill, checkpoint, now, onPage, emit, signal,
}: SyncMessagePagesOptions): Promise<boolean> {
  for await (const page of listMessages(client, endpoints, conversation.id, { continuationUrl, startTime })) {
    const messages = [...page.messages].sort(compareMessages);
    const messageEvents: SyncEvent[] = [];
    const finalPage = messages.length === 0 || page.backwardLink === null;
    transaction(db, () => {
      for (const message of messages) {
        const change = classifyMessageChange(getMessage(db, conversation.id, message.id), message);
        upsertMessagesInTransaction(db, [message]);
        if (change) messageEvents.push({ type: change, data: message });
      }
      upsertPeopleInTransaction(db, page.people);
      const next: Checkpoint = {
        scope: conversation.id,
        // Keep the final page cursor; S9 must verify this with Teams, and idempotent upserts make replay safe.
        syncState: finalPage ? page.syncState ?? checkpoint?.syncState ?? null : checkpoint?.syncState ?? null,
        backwardLink: backfill && !finalPage ? page.backwardLink : null,
        oldestMessageAt: oldestMessageAt(db, conversation.id),
        historyComplete: backfill ? false : checkpoint?.historyComplete ?? false,
        updatedAt: now().toISOString(),
      };
      upsertCheckpointInTransaction(db, next);
    });
    for (const event of messageEvents) emit?.(event);
    onPage(messages.length);
    if (signal?.aborted) return false;
  }
  return !signal?.aborted;
}

function upsertConversationsAndEmit(db: DatabaseSync, incoming: Conversation[], emit?: SyncEventEmitter): void {
  const ids = [...new Set(incoming.map(({ id }) => id))];
  const before = new Map(ids.map((id) => [id, getConversation(db, id)]));
  upsertConversations(db, incoming);
  for (const id of ids) {
    const after = getConversation(db, id);
    const previous = before.get(id) ?? null;
    if (after && (!previous || !sameConversation(previous, after))) emit?.({ type: 'conversation.updated', data: after });
  }
}

function sameConversation(left: Conversation, right: Conversation): boolean {
  return left.id === right.id && left.kind === right.kind && left.title === right.title
    && left.teamId === right.teamId && left.lastMessageAt === right.lastMessageAt;
}

function compareMessages(left: Message, right: Message): number {
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  if (left.version === right.version) return 0;
  return left.version < right.version ? -1 : 1;
}

function emitProgress(emit: SyncEventEmitter | undefined, data: Extract<SyncEvent, { type: 'sync.progress' }>['data']): void {
  emit?.({ type: 'sync.progress', data });
}

function emitSyncError(emit: SyncEventEmitter | undefined, error: unknown, conversationId: string | null, fatal: boolean): void {
  const code: ErrorCode = error instanceof CliError ? error.code : 'internal';
  const message = error instanceof CliError ? error.message : 'An unexpected error occurred.';
  emit?.({ type: 'sync.error', data: { code, message, conversationId, fatal } });
}

function retryAfterMs(error: CliError): number {
  const seconds = (error.details as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

function resultFor(conversations: number, conversationsSynced: number, messages: number, warnings: SyncWarning[]): SyncResult {
  return { conversations, conversationsSynced, messages, warnings };
}

function emptyResult(conversations = 0): SyncResult {
  return resultFor(conversations, 0, 0, []);
}

function shouldSync(conversation: Conversation): boolean {
  // Other system streams (notifications, mentions, call logs and threads) are intentionally excluded; 48:notes is included.
  return conversation.kind !== 'system' || conversation.id === '48:notes';
}
