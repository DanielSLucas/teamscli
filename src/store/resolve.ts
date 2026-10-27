import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { CliError } from '../errors.ts';
import type { Conversation, ConversationKind, Person } from '../models.ts';
import { getConversation, listConversations } from './conversations.ts';

/** What an ambiguous error lists in `details.candidates`. */
export interface Candidate {
  id: string;
  kind: ConversationKind | 'person';
  title: string;
  shortId?: string;
}

interface Named<T> {
  item: T;
  candidate: Candidate;
  names: string[];
  personNames?: string[];
}

/** Stable seven-hex identifier derived from a conversation id. */
export function shortId(conversationId: string): string {
  return createHash('sha256').update(conversationId).digest('hex').slice(0, 7);
}

/** Finds a chat or channel by id, short id or name. A local `selfId` excludes the signed-in user from one-on-one names. */
export function resolveConversation(db: DatabaseSync, query: string, selfId: string | null): Conversation {
  const exact = getConversation(db, query);
  if (exact) return exact;

  const teams = new Map(db.prepare('SELECT id, name FROM teams').all().map((row) => [row.id as string, row.name as string]));
  const otherMembers = new Map<string, string[]>();
  const rows = db
    .prepare(`
      SELECT cm.conversation_id, p.display_name, p.email FROM conversation_members cm
      JOIN conversations c ON c.id = cm.conversation_id AND c.kind = 'chat'
      JOIN people p ON p.id = cm.person_id
      WHERE (p.display_name IS NOT NULL OR p.email IS NOT NULL) AND (:selfId IS NULL OR cm.person_id <> :selfId)
    `)
    .all({ selfId });
  for (const row of rows) {
    const id = row.conversation_id as string;
    const names = otherMembers.get(id) ?? [];
    if (typeof row.display_name === 'string') names.push(...nameVariants(row.display_name));
    if (typeof row.email === 'string') names.push(...emailVariants(row.email));
    otherMembers.set(id, names);
  }

  const named = listConversations(db).map((conversation): Named<Conversation> => {
    const names = conversation.title === null ? [] : [conversation.title];
    const team = conversation.teamId === null ? undefined : teams.get(conversation.teamId);
    if (conversation.kind === 'channel' && team !== undefined && conversation.title !== null) names.unshift(`${team}/${conversation.title}`);
    const personNames = otherMembers.get(conversation.id) ?? [];
    names.push(...personNames);
    const title = names[0] ?? conversation.id;
    return {
      item: conversation,
      candidate: { id: conversation.id, kind: conversation.kind, title, shortId: shortId(conversation.id) },
      names,
      ...(conversation.kind === 'chat' ? { personNames } : {}),
    };
  });

  const shortPrefix = query.toLowerCase();
  if (/^[0-9a-f]{4,7}$/i.test(query)) {
    const matches = named.filter(({ item }) => shortId(item.id).startsWith(shortPrefix));
    if (matches.length === 1) return matches[0]!.item;
    if (matches.length > 1) throw ambiguous(query, 'chat or channel', matches.map(({ candidate }) => candidate));
  }

  return pick(query, named, 'chat or channel');
}

/** Finds a person by id, display name or email. */
export function resolvePerson(db: DatabaseSync, query: string): Person {
  const people = db.prepare('SELECT id, display_name, email FROM people').all().map((row): Person => ({
    id: row.id as string,
    displayName: row.display_name as string | null,
    email: row.email as string | null,
  }));
  const exact = people.find((person) => person.id === query);
  if (exact) return exact;
  return pick(query, people.map((person) => ({
    item: person,
    candidate: { id: person.id, kind: 'person' as const, title: person.displayName ?? person.email ?? person.id },
    names: [
      ...(person.displayName === null ? [] : nameVariants(person.displayName)),
      ...(person.email === null ? [] : emailVariants(person.email)),
    ],
  })), 'person');
}

// Strongest level wins: exact name, then prefix, then substring. Never picks among ties.
function pick<T>(query: string, named: Named<T>[], what: string): T {
  const wanted = normalizeQuery(query);
  if (wanted === '') throw new CliError('usage', `Give a ${what} name or id.`);
  const levels = [
    (name: string) => name === wanted,
    (name: string) => name.startsWith(wanted),
    (name: string) => name.includes(wanted),
  ];
  for (const matches of levels) {
    let found = named.filter(({ names }) => names.some((name) => matches(normalize(name))));
    if (found.some(({ personNames }) => personNames?.some((name) => matches(normalize(name))))) {
      found = found.filter(({ candidate }) => candidate.kind !== 'group');
    }
    const [first] = found;
    if (first && found.length === 1) return first.item;
    if (found.length > 1) throw ambiguous(query, what, found.map(({ candidate }) => candidate));
  }
  throw new CliError('not_found', `No ${what} matches "${query}" in the local data; run "teamscli sync" or use an id.`);
}

function ambiguous(query: string, what: string, candidates: Candidate[]): CliError {
  const ordered = candidates.toSorted((a, b) => a.id.localeCompare(b.id));
  const listed = ordered.map(({ id, shortId: idShort, title }) => `${title} (${idShort ?? id})`).join(', ');
  return new CliError('ambiguous', `"${query}" matches more than one ${what}, use an id: ${listed}.`, { candidates: ordered });
}

function nameVariants(value: string): string[] {
  const normalized = normalize(value);
  return [...new Set([normalized, ...normalized.split(' ')])];
}

function emailVariants(value: string): string[] {
  const localPart = value.split('@', 1)[0]!.replace(/[._-]+/g, ' ');
  return nameVariants(localPart);
}

function normalizeQuery(value: string): string {
  const emailOrLogin = value.includes('@') || (value.includes('.') && !/\s/.test(value));
  return normalize(emailOrLogin ? value.split('@', 1)[0]!.replace(/[._-]+/g, ' ') : value);
}

/** Case- and accent-insensitive, whitespace collapsed. */
function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
