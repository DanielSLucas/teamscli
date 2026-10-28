import type { DatabaseSync } from 'node:sqlite';
import type { Conversation, ConversationMember, Person } from '../models.ts';
import { transaction } from './database.ts';

export type MemberWithName = ConversationMember & { displayName: string | null };

export function upsertPeople(db: DatabaseSync, people: Person[]): void {
  transaction(db, () => upsertPeopleInTransaction(db, people));
}

/** Caller owns the surrounding transaction. */
export function upsertPeopleInTransaction(db: DatabaseSync, people: Person[]): void {
  const statement = db.prepare(`
    INSERT INTO people (id, display_name, email)
    VALUES (:id, :displayName, :email)
    ON CONFLICT (id) DO UPDATE SET
      display_name = coalesce(excluded.display_name, people.display_name),
      email = coalesce(excluded.email, people.email)
  `);
  for (const person of people) statement.run({ ...person });
}

export function setMembers(db: DatabaseSync, conversationId: string, members: ConversationMember[]): void {
  const insert = db.prepare(`
    INSERT INTO conversation_members (conversation_id, person_id, role)
    VALUES (:conversationId, :personId, :role)
    ON CONFLICT (conversation_id, person_id) DO UPDATE SET role = excluded.role
  `);
  transaction(db, () => {
    db.prepare('DELETE FROM conversation_members WHERE conversation_id = ?').run(conversationId);
    for (const member of members) {
      insert.run({ conversationId, personId: member.personId, role: member.role });
    }
  });
}

export function listMembers(db: DatabaseSync, conversationId: string): MemberWithName[] {
  return db
    .prepare(`
      SELECT cm.conversation_id, cm.person_id, cm.role, p.display_name
      FROM conversation_members cm
      LEFT JOIN people p ON p.id = cm.person_id
      WHERE cm.conversation_id = ?
      ORDER BY p.display_name COLLATE NOCASE, cm.person_id
    `)
    .all(conversationId)
    .map((row) => ({
      conversationId: row.conversation_id as string,
      personId: row.person_id as string,
      role: row.role as string | null,
      displayName: row.display_name as string | null,
    }));
}

export function getPersonName(db: DatabaseSync, personId: string | null): string | null {
  if (personId === null) return null;
  const name = db.prepare('SELECT display_name FROM people WHERE id = ?').get(personId)?.display_name;
  return typeof name === 'string' ? name : null;
}

/** Human label: the title, or up to three member names (without self in 1:1 chats); empty when neither is known. */
export function conversationLabel(conversation: Conversation, members: MemberWithName[], selfId: string | null): string {
  if (conversation.title !== null) return conversation.title;
  const others = conversation.kind === 'chat' && selfId !== null
    ? members.filter(({ personId }) => personId !== selfId)
    : members;
  const names = others.map(({ displayName, personId }) => displayName ?? personId);
  const shown = names.slice(0, 3).join(', ');
  return `${shown}${names.length > 3 ? ` +${names.length - 3}` : ''}`;
}
