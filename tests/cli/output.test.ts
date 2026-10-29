import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventLine, formatTime, jsonSuccess, renderHuman, renderMessage, renderMessageDetail, renderMessages, table } from '../../src/cli/output.ts';
import type { Message } from '../../src/models.ts';

// Expected times below are in this zone; CI runners default to UTC.
process.env.TZ = 'America/Sao_Paulo';

test('table aligns columns and shows null as "-"', () => {
  assert.equal(
    table([
      { id: '19:a', title: 'Design review' },
      { id: '19:bcd', title: null },
    ]),
    'id      title\n19:a    Design review\n19:bcd  -',
  );
});

test('renderHuman renders records as key/value lines and arrays of records as tables', () => {
  assert.equal(renderHuman({ messages: 3, conversations: 12 }), 'messages       3\nconversations  12');
  assert.equal(renderHuman([{ a: 1 }]), 'a\n1');
  assert.equal(renderHuman(undefined), '');
});

test('human timestamps use the process timezone and leave non-ISO fields alone', () => {
  const originalTz = process.env.TZ;
  process.env.TZ = 'America/Sao_Paulo';
  try {
    assert.equal(formatTime('2026-10-27T12:04:00.000Z', 'America/Sao_Paulo'), '2026-10-27 09:04');
    assert.equal(
      renderHuman({ createdAt: '2026-10-27T12:04:00.000Z', updatedAt: 'not a timestamp' }),
      'createdAt  2026-10-27 09:04\nupdatedAt  not a timestamp',
    );
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});

test('message renderers use plain text, compact line breaks and mark edits and deletions', () => {
  const edited: Message = {
    id: 'message-1',
    conversationId: '19:synthetic@thread.v2',
    parentId: null,
    senderId: '8:person-1',
    senderName: 'Alice Example',
    type: 'RichText/Html',
    content: '<p>HTML content that must not appear</p>',
    text: 'Plain\ntext',
    createdAt: '2026-10-27T12:04:00.000Z',
    editedAt: '2026-10-27T12:05:00.000Z',
    deletedAt: null,
    version: 2,
    clientMessageId: null,
    files: [],
  };
  const deleted: Message = {
    ...edited,
    id: 'message-2',
    text: 'Deleted body',
    editedAt: null,
    deletedAt: '2026-10-27T12:06:00.000Z',
  };

  assert.equal(renderMessage(edited), '2026-10-27 09:04  Alice Example: Plain text (edited)');
  assert.equal(renderMessages([edited, deleted]), '2026-10-27 09:04  Alice Example: Plain text (edited)\n2026-10-27 09:04  Alice Example: [deleted]');
  assert.equal(
    renderMessageDetail(edited),
    'id            message-1\nconversation  19:synthetic@thread.v2\ntime          2026-10-27 09:04\nsender        Alice Example\ntext          Plain text (edited)',
  );
  assert.equal(
    renderMessageDetail({ ...edited, parentId: 'root-message' }),
    'id            message-1\nconversation  19:synthetic@thread.v2\nreply to  root-message\ntime          2026-10-27 09:04\nsender        Alice Example\ntext          Plain text (edited)',
  );
  assert.doesNotMatch(renderMessage(edited) + renderMessageDetail(edited), /HTML content|<p>/);
});

test('json and event envelopes', () => {
  assert.equal(jsonSuccess(undefined), '{"ok":true,"data":null}');
  assert.equal(eventLine('sync.progress', { n: 1 }, new Date(0)), '{"v":1,"type":"sync.progress","at":"1970-01-01T00:00:00.000Z","data":{"n":1}}');
});
