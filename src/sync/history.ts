import type { DatabaseSync } from 'node:sqlite';
import { getCheckpoint, upsertHistoryCheckpointInTransaction } from '../store/checkpoints.ts';
import { oldestMessageAt, upsertMessagesInTransaction } from '../store/messages.ts';
import { transaction } from '../store/database.ts';
import { upsertPeopleInTransaction } from '../store/people.ts';
import type { Endpoints, TeamsClient } from '../teams/client.ts';
import { listMessages } from '../teams/messages.ts';

export interface HistoryFetchOptions {
  db: DatabaseSync;
  client: TeamsClient;
  endpoints: Endpoints;
  conversationId: string;
  before?: string;
  pages?: number;
  now: () => Date;
  log: (message: string) => void;
}

export interface HistoryFetchResult {
  conversationId: string;
  /** Pages containing messages older than `before`; newer pages do not count toward the limit. */
  pages: number;
  messages: number;
  historyComplete: boolean;
}

/** Backfills older messages while leaving the sync cursor untouched. */
export async function fetchHistory({
  db, client, endpoints, conversationId, before, pages: pageLimit, now, log,
}: HistoryFetchOptions): Promise<HistoryFetchResult> {
  const checkpoint = getCheckpoint(db, conversationId);
  if (checkpoint?.historyComplete) {
    log(`History ${conversationId} is already complete.`);
    return { conversationId, pages: 0, messages: 0, historyComplete: true };
  }

  const cutoff = before ?? checkpoint?.oldestMessageAt ?? now().toISOString();
  let pages = 0;
  let scannedPages = 0;
  let messages = 0;
  let historyComplete = false;

  // shortcut: this re-walks pages already synced; upgrade when an endpoint supports a time range.
  for await (const page of listMessages(client, endpoints, conversationId, { startTime: 1 })) {
    const isOlderPage = page.messages.some((message) => message.createdAt < cutoff);
    if (isOlderPage) pages++;
    scannedPages++;
    messages += page.messages.length;
    historyComplete = page.backwardLink === null;

    transaction(db, () => {
      upsertMessagesInTransaction(db, page.messages);
      upsertPeopleInTransaction(db, page.people);
      upsertHistoryCheckpointInTransaction(db, {
        scope: conversationId,
        oldestMessageAt: oldestMessageAt(db, conversationId),
        historyComplete,
        updatedAt: now().toISOString(),
      });
    });
    log(`History ${conversationId}: page ${scannedPages}; ${page.messages.length} messages received.`);

    if (historyComplete || (pageLimit !== undefined && pages >= pageLimit)) break;
  }

  return { conversationId, pages, messages, historyComplete };
}
