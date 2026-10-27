import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteHtml, toTeamsHtml } from '../../src/teams/compose.ts';
import { htmlToText } from '../../src/teams/html.ts';

test('paragraphs and line breaks', () => {
  assert.equal(toTeamsHtml('first\nline two\n\n\nsecond'), '<p>first<br>line two</p><p>second</p>');
  assert.equal(toTeamsHtml('a\r\nb'), '<p>a<br>b</p>');
  assert.equal(toTeamsHtml('  \n\n '), '');
});

test('simple markdown', () => {
  assert.equal(toTeamsHtml('**bold** and *it* and `x < y`'), '<p><strong>bold</strong> and <em>it</em> and <code>x &lt; y</code></p>');
  assert.equal(toTeamsHtml('2 * 3 * 4'), '<p>2 * 3 * 4</p>');
  assert.equal(toTeamsHtml('`**not bold**`'), '<p><code>**not bold**</code></p>');
});

test('user HTML is escaped, never passed through', () => {
  assert.equal(toTeamsHtml('<script>alert("x")</script> & \'q\''),
    '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;</p>');
  assert.equal(toTeamsHtml('<b onclick="x">hi</b>'), '<p>&lt;b onclick=&quot;x&quot;&gt;hi&lt;/b&gt;</p>');
});

test('http and https links; anything else stays text', () => {
  assert.equal(toTeamsHtml('[docs](https://example.com/a?b=1&c="2")'), '<p><a href="https://example.com/a?b=1&amp;c=&quot;2&quot;">docs</a></p>');
  assert.equal(toTeamsHtml('see http://example.com/x.'), '<p>see <a href="http://example.com/x">http://example.com/x</a>.</p>');
  assert.equal(toTeamsHtml('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.equal(toTeamsHtml('[x](data:text/html,<b>)'), '<p>[x](data:text/html,&lt;b&gt;)</p>');
  assert.equal(toTeamsHtml('https://example.com/"><script>'), '<p><a href="https://example.com/">https://example.com/</a>&quot;&gt;&lt;script&gt;</p>');
});

test('quote block escapes name and preview and round-trips to text', () => {
  const html = quoteHtml({ id: '1767261600000', senderId: '8:orgid:00000000-0000-0000-0000-000000000001', senderName: 'Alice <Ex> & "Co"', text: '<script>x</script>' });
  assert.equal(html,
    '<blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="1767261600000">'
    + '<strong itemprop="mri" itemid="8:orgid:00000000-0000-0000-0000-000000000001">Alice &lt;Ex&gt; &amp; &quot;Co&quot;</strong>'
    + '<span itemprop="time" itemid="1767261600000"></span>'
    + '<p itemprop="preview">&lt;script&gt;x&lt;/script&gt;</p></blockquote>');
  assert.equal(htmlToText(html + toTeamsHtml('ok')), 'Alice <Ex> & "Co" <script>x</script> ok');
});
