'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TPL = path.join(__dirname, '..', 'template');
const read = (rel) => fs.readFileSync(path.join(TPL, rel), 'utf8');
const it = JSON.parse(read('i18n/it.json'));
const en = JSON.parse(read('i18n/en.json'));

test('it and en have the same keys, all non-empty strings', () => {
  assert.deepEqual(Object.keys(it).sort(), Object.keys(en).sort());
  for (const dict of [it, en]) for (const [k, v] of Object.entries(dict)) {
    assert.equal(typeof v, 'string', k);
    assert.ok(v.length > 0, k);
  }
});

test('every {{t.key}} in index.html exists in i18n', () => {
  const keys = [...read('index.html').matchAll(/\{\{t\.(\w+)\}\}/g)].map((m) => m[1]);
  assert.ok(keys.length > 0);
  for (const k of keys) assert.ok(k in it, `missing i18n key: ${k}`);
});

test('every tr("key") in app.js exists in i18n', () => {
  const keys = [...read('assets/js/app.js').matchAll(/tr\('(\w+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 10);
  for (const k of keys) assert.ok(k in it, `missing i18n key: ${k}`);
});

test('app.js is valid JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(read('assets/js/app.js')));
});

test('template contains no reference to a specific owner or locale', () => {
  for (const rel of ['index.html', 'assets/js/app.js', 'assets/css/style.css']) {
    const src = read(rel);
    for (const needle of ['marcomaroni', 'Marco Maroni', '15570883', 'it-IT', 'edpovFA7', '1702049469']) {
      assert.ok(!src.includes(needle), `${rel} contains ${needle}`);
    }
  }
});

function loadArchiveText() {
  const ctx = { window: {}, document: { addEventListener() {} } };
  vm.runInNewContext(read('assets/js/app.js'), ctx);
  assert.ok(ctx.window.ArchiveText, 'app.js must expose window.ArchiveText');
  return ctx.window.ArchiveText;
}

test('renderText keeps expanded URLs intact (no mention/hashtag rewriting inside links)', () => {
  const { renderText } = loadArchiveText();
  const urls = [
    { url: 'https://t.co/aaa111', expanded_url: 'https://medium.com/@user/post', display_url: 'medium.com/@user/post' },
    { url: 'https://t.co/bbb222', expanded_url: 'https://example.org/page#section', display_url: 'example.org/page#section' },
  ];
  const html = renderText('Read https://t.co/aaa111 and https://t.co/bbb222', urls);
  assert.ok(html.includes('<a href="https://medium.com/@user/post" target="_blank" rel="noopener noreferrer">medium.com/@user/post</a>'), html);
  assert.ok(html.includes('<a href="https://example.org/page#section" target="_blank" rel="noopener noreferrer">example.org/page#section</a>'), html);
  assert.doesNotMatch(html, /class="mention"|class="hashtag"/);
});

test('renderText links mentions and Unicode hashtags with a data-tag attribute', () => {
  const { renderText } = loadArchiveText();
  const html = renderText('Ciao @friend_1, #perché #tag2 ok', []);
  assert.ok(html.includes('<a href="https://twitter.com/friend_1" target="_blank" rel="noopener noreferrer" class="mention">@friend_1</a>'), html);
  assert.ok(html.includes('<a href="#" class="hashtag" data-tag="perché">#perché</a>'), html);
  assert.ok(html.includes('data-tag="tag2">#tag2</a> ok'), html);
  assert.doesNotMatch(html, /onclick|javascript:/);
});

test('renderText escapes text and never uses a non-http expanded_url as href', () => {
  const { renderText } = loadArchiveText();
  const urls = [{ url: 'https://t.co/ccc333', expanded_url: 'javascript:alert(1)', display_url: 'click me' }];
  const html = renderText('<script>alert("x")</script> https://t.co/ccc333 https://t.co/unknown9', urls);
  assert.ok(html.startsWith('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'), html);
  assert.ok(!html.includes('<script'));
  assert.doesNotMatch(html, /href="javascript:/);
  assert.ok(html.includes('<a href="https://t.co/ccc333" target="_blank" rel="noopener noreferrer">click me</a>'), html);
  assert.ok(!html.includes('unknown9'), 'unknown t.co links are dropped');
});

test('renderText does not treat a quote in a hashtag as code', () => {
  const { renderText } = loadArchiveText();
  const html = renderText("#it's", []);
  assert.ok(html.includes('data-tag="it">#it</a>&#39;s'), html);
});

test('a # right after a slash (plain-text path or URL fragment) is not a hashtag', () => {
  const { renderText } = loadArchiveText();
  const html = renderText('see example.org/#section and docs/#x, but #real', []);
  assert.ok(html.startsWith('see example.org/#section and docs/#x, but '), html);
  assert.equal((html.match(/class="hashtag"/g) || []).length, 1);
  assert.ok(html.includes('data-tag="real"'), html);
});

test('renderText takes only the text and the URLs', () => {
  const { renderText } = loadArchiveText();
  assert.equal(renderText.length, 2);
});
