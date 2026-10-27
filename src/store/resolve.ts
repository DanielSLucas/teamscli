import type { DatabaseSync } from 'node:sqlite';
import { CliError } from '../errors.ts';
import type { Conversation, ConversationKind, Person } from '../models.ts';
import { getConversation, listConversations } from './conversations.ts';

/** What an ambiguous error lists in `details.candidates`. */
export interface Candidate {
  id: string;
  kind: ConversationKind | 'person';
  title: string;
}

interface Named<T> {
  item: T;
  candidate: Candidate;
  names: string[];
}

/**
 * Finds a chat or channel by id or name. Names: the title; `Team/Channel` for channels; the other
 * person's name for one-on-one chats (`selfId` excludes the signed-in user; null keeps everyone).
 */
export function resolveConversation(db: DatabaseSync, query: string, selfId: string | null): Conversation {
  const exact = getConversation(db, query);
  if (exact) return exact;

  const teams = new Map(db.prepare('SELECT id, name FROM teams').all().map((row) => [row.id as string, row.name as string]));
  const otherMembers = new Map<string, string[]>();
  const rows = db
    .prepare(`
      SELECT cm.conversation_id, p.display_name FROM conversation_members cm
      JOIN conversations c ON c.id = cm.conversation_id AND c.kind = 'chat'
      JOIN people p ON p.id = cm.person_id
      WHERE p.display_name IS NOT NULL AND (:selfId IS NULL OR cm.person_id <> :selfId)
    `)
    .all({ selfId });
  for (const row of rows) {
    const id = row.conversation_id as string;
    otherMembers.set(id, [...(otherMembers.get(id) ?? []), row.display_name as string]);
  }

  const named = listConversations(db).map((conversation): Named<Conversation> => {
    const names = conversation.title === null ? [] : [conversation.title];
    const team = conversation.teamId === null ? undefined : teams.get(conversation.teamId);
    if (conversation.kind === 'channel' && team !== undefined && conversation.title !== null) names.unshift(`${team}/${conversation.title}`);
    names.push(...(otherMembers.get(conversation.id) ?? []));
    const title = names[0] ?? conversation.id;
    return { item: conversation, candidate: { id: conversation.id, kind: conversation.kind, title }, names };
  });
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
    names: [person.displayName, person.email].filter((name) => name !== null),
  })), 'person');
}

// Strongest level wins: exact name, then prefix, then substring. Never picks among ties.
function pick<T>(query: string, named: Named<T>[], what: string): T {
  const wanted = normalize(query);
  if (wanted === '') throw new CliError('usage', `Give a ${what} name or id.`);
  const levels = [
    (name: string) => name === wanted,
    (name: string) => name.startsWith(wanted),
    (name: string) => name.includes(wanted),
  ];
  for (const matches of levels) {
    const found = named.filter(({ names }) => names.some((name) => matches(normalize(name))));
    const [first] = found;
    if (first && found.length === 1) return first.item;
    if (found.length > 1) {
      const candidates = found.map(({ candidate }) => candidate);
      const listed = candidates.map(({ id, title }) => `${title} (${id})`).join(', ');
      throw new CliError('ambiguous', `"${query}" matches more than one ${what}, use an id: ${listed}.`, { candidates });
    }
  }
  throw new CliError('not_found', `No ${what} matches "${query}" in the local data; run "teamscli sync" or use an id.`);
}

/** Case- and accent-insensitive, whitespace collapsed. */
function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
