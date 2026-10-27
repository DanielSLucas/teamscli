import type { DatabaseSync } from 'node:sqlite';
import { CliError } from '../errors.ts';
import type { Checkpoint, Conversation } from '../models.ts';
import { getCheckpoint, listPendingBackfills, upsertCheckpoint, upsertCheckpointInTransaction } from '../store/checkpoints.ts';
import { getConversation, listConversations, upsertConversations } from '../store/conversations.ts';
import { oldestMessageAt, upsertMessagesInTransaction } from '../store/messages.ts';
import { setMembers, upsertPeople, upsertPeopleInTransaction } from '../store/people.ts';
import { upsertTeams } from '../store/teams.ts';
import { transaction } from '../store/database.ts';
import { fetchTeamsAndChats } from '../teams/csa.ts';
import { listConversations as listRemoteConversations } from '../teams/conversations.ts';
import type { Endpoints, TeamsClient } from '../teams/client.ts';
import { listMessages } from '../teams/messages.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const CONVERSATION_SCOPE = 'conversations';

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

export interface SyncOptions {
  db: DatabaseSync;
  client: TeamsClient;
  endpoints: Endpoints;
  days: number;
  now: () => Date;
  log: (message: string) => void;
}

/** Syncs changed conversations and resumes any interrupted history backfills. */
export async function runSync({ db, client, endpoints, days, now, log }: SyncOptions): Promise<SyncResult> {
  const changedIds: string[] = [];
  const listCheckpoint = getCheckpoint(db, CONVERSATION_SCOPE);
  let nextSyncState: string | null = null;

  for await (const page of listRemoteConversations(client, endpoints, listCheckpoint?.syncState ?? undefined)) {
    upsertConversations(db, page.conversations);
    changedIds.push(...page.conversations.map(({ id }) => id));
    nextSyncState = page.syncState;
  }

  const csa = await fetchTeamsAndChats(client, endpoints);
  upsertTeams(db, csa.teams);
  upsertConversations(db, csa.channels);
  upsertPeople(db, csa.people);
  for (const { conversationId, members } of csa.chatMembers) {
    if (getConversation(db, conversationId)) setMembers(db, conversationId, members);
  }
  if (csa.partial) log('Teams returned partial team and chat data.');

  const conversations = listConversations(db);
  const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const pendingIds = listPendingBackfills(db).map(({ scope }) => scope);
  const syncedCandidates = [...new Set([...changedIds, ...pendingIds])]
    .map((id) => conversationsById.get(id))
    .filter((conversation): conversation is Conversation => conversation !== undefined && shouldSync(conversation));
  const backfillStartTime = now().getTime() - days * DAY_MS;
  const warnings: SyncWarning[] = [];
  let messages = 0;

  for (const [index, conversation] of syncedCandidates.entries()) {
    const checkpoint = getCheckpoint(db, conversation.id);
    let saved = 0;
    const onPage = (count: number) => {
      saved += count;
      messages += count;
    };
    try {
      if (checkpoint?.backwardLink) {
        await syncMessagePages({
          db, client, endpoints, conversation, continuationUrl: checkpoint.backwardLink,
          backfill: true, checkpoint, now, onPage,
        });
      } else if (checkpoint?.syncState) {
        await syncMessagePages({
          db, client, endpoints, conversation, continuationUrl: checkpoint.syncState,
          backfill: false, checkpoint, now, onPage,
        });
      } else {
        await syncMessagePages({
          db, client, endpoints, conversation, startTime: backfillStartTime,
          backfill: true, checkpoint, now, onPage,
        });
      }
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== 'remote') throw error;
      const status = typeof (error.details as { status?: unknown } | null)?.status === 'number'
        ? (error.details as { status: number }).status
        : null;
      warnings.push({ conversationId: conversation.id, code: 'remote', status });
      log(`Sync warning for ${conversation.id}: remote${status === null ? '' : ` ${status}`}.`);
    }
    log(`Sync ${index + 1}/${syncedCandidates.length}: ${conversation.id}; ${saved} messages saved.`);
  }

  // Commit the list cursor last so auth and throttling failures replay the same changed conversations.
  upsertCheckpoint(db, {
    scope: CONVERSATION_SCOPE,
    syncState: nextSyncState,
    backwardLink: null,
    oldestMessageAt: null,
    historyComplete: false,
    updatedAt: now().toISOString(),
  });

  return {
    conversations: conversations.length,
    conversationsSynced: syncedCandidates.length,
    messages,
    warnings,
  };
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
}

async function syncMessagePages({
  db, client, endpoints, conversation, continuationUrl, startTime, backfill, checkpoint, now, onPage,
}: SyncMessagePagesOptions): Promise<void> {
  for await (const page of listMessages(client, endpoints, conversation.id, { continuationUrl, startTime })) {
    const finalPage = page.messages.length === 0 || page.backwardLink === null;
    transaction(db, () => {
      upsertMessagesInTransaction(db, page.messages);
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
    onPage(page.messages.length);
  }
}

function shouldSync(conversation: Conversation): boolean {
  // Other system streams (notifications, mentions, call logs and threads) are intentionally excluded; 48:notes is included.
  return conversation.kind !== 'system' || conversation.id === '48:notes';
}
