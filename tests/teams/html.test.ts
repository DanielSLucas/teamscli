import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText } from '../../src/teams/html.ts';

test('strips tags, decodes common and numeric entities, and collapses whitespace', () => {
  assert.equal(htmlToText('<p>Tom &amp; Jerry &#x1F600; &#169; &nbsp; <b>ok</b></p><div>next<br>line</div>'), 'Tom & Jerry 😀 © ok next line');
});

test('keeps mention labels, quoted text, and emoji as readable text', () => {
  const html = '<blockquote>\n  <strong>Alice</strong>\n  <span>quoted &lt;text&gt; 😀</span>\n</blockquote><p>Reply 👋</p>';
  assert.equal(htmlToText(html), 'Alice quoted <text> 😀 Reply 👋');
});

test('returns an empty string for empty markup', () => {
  assert.equal(htmlToText('<p></p><br>  </br>'), '');
});
