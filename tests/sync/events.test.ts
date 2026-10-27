import assert from 'node:assert/strict';
import test from 'node:test';
import { eventLine } from '../../src/cli/output.ts';
import { classifyMessageChange, emitEvent, type SyncEvent } from '../../src/sync/events.ts';
import { aConversation, aMessage } from '../helpers/builders.ts';

const at = new Date('2026-01-01T10:00:00.000Z');

function lines(events: SyncEvent[]): unknown[] {
  const out: unknown[] = [];
  for (const event of events) emitEvent((type, data) => out.push(JSON.parse(eventLine(type, data, at))), event);
  return out;
}

test('events keep the v1 envelope and carry models as data', () => {
  const message = aMessage();
  const conversation = aConversation();
  assert.deepEqual(lines([
    { type: 'message.new', data: message },
    { type: 'conversation.updated', data: conversation },
    { type: 'sync.progress', data: { phase: 'messages', conversationId: conversation.id, conversationsDone: 1, conversationsTotal: 3, messages: 20 } },
    { type: 'sync.error', data: { code: 'rate_limited', message: 'Slow down.', conversationId: null, fatal: false } },
  ]), [
    { v: 1, type: 'message.new', at: at.toISOString(), data: message },
    { v: 1, type: 'conversation.updated', at: at.toISOString(), data: conversation },
    {
      v: 1,
      type: 'sync.progress',
      at: at.toISOString(),
      data: { phase: 'messages', conversationId: conversation.id, conversationsDone: 1, conversationsTotal: 3, messages: 20 },
    },
    { v: 1, type: 'sync.error', at: at.toISOString(), data: { code: 'rate_limited', message: 'Slow down.', conversationId: null, fatal: false } },
  ]);
});

test('classifyMessageChange: first sight is new, unless already deleted', () => {
  assert.equal(classifyMessageChange(null, aMessage()), 'message.new');
  assert.equal(classifyMessageChange(null, aMessage({ deletedAt: '2026-01-01T11:00:00.000Z', content: '' })), null);
});

test('classifyMessageChange: same or older version is a repeat', () => {
  const stored = aMessage({ version: 10 });
  assert.equal(classifyMessageChange(stored, aMessage({ version: 10 })), null);
  assert.equal(classifyMessageChange(stored, aMessage({ version: 9, content: 'older' })), null);
});

test('classifyMessageChange: newer version is an edit, a delete, or nothing', () => {
  const stored = aMessage({ version: 10 });
  assert.equal(classifyMessageChange(stored, aMessage({ version: 11, editedAt: '2026-01-01T11:00:00.000Z', content: 'Hi' })), 'message.edited');
  assert.equal(classifyMessageChange(stored, aMessage({ version: 11, content: 'changed without edittime' })), 'message.edited');
  assert.equal(classifyMessageChange(stored, aMessage({ version: 11, deletedAt: '2026-01-01T11:00:00.000Z', content: '' })), 'message.deleted');
  assert.equal(classifyMessageChange(stored, aMessage({ version: 11 })), null, 'reaction-only bump');
});

test('classifyMessageChange: nothing after a delete', () => {
  const deleted = aMessage({ version: 11, deletedAt: '2026-01-01T11:00:00.000Z', content: '' });
  assert.equal(classifyMessageChange(deleted, aMessage({ version: 12, deletedAt: '2026-01-01T11:00:00.000Z', content: '' })), null);
});
