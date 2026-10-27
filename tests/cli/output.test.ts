import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventLine, jsonSuccess, renderHuman, table } from '../../src/cli/output.ts';

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

test('json and event envelopes', () => {
  assert.equal(jsonSuccess(undefined), '{"ok":true,"data":null}');
  assert.equal(eventLine('sync.progress', { n: 1 }, new Date(0)), '{"v":1,"type":"sync.progress","at":"1970-01-01T00:00:00.000Z","data":{"n":1}}');
});
