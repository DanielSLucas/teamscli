import { test } from 'node:test';
import assert from 'node:assert/strict';

test('runs on Node 24+ with type stripping', () => {
  assert.ok(Number(process.versions.node.split('.')[0]) >= 24);
});
