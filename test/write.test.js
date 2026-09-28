'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { prepareSiteDir, renderTemplate, writeSite } = require('../src/site/write');
const { readArchive } = require('../src/archive/read');
const { createFixtureArchive, makeTmpDir } = require('./helpers/fixture');

const TEMPLATE = path.join(__dirname, '..', 'template');
const config = { lang: 'it', title: 'Test <User> — Archivio', includeRetweets: false, includeReplies: false, noindex: true, website: 'https://example.org' };
const tweets = [
  { id: '101', created_at: '2020-01-02T10:00:00Z', text: 'a', media: [] },
  { id: '104', created_at: '2020-01-02T10:05:00Z', text: 'b', media: [] },
  { id: '105', created_at: '2021-03-01T12:00:00Z', text: 'c', media: [] },
];

function build(overrides = {}) {
  const site = makeTmpDir('site');
  const archive = readArchive(createFixtureArchive());
  const result = writeSite({
    siteDir: site, templateDir: TEMPLATE, archive, config: { ...config, ...overrides }, tweets,
    images: { avatar: 'assets/images/avatar.jpg', header: null },
  });
  return { site, result };
}

function loadGlobal(file, name) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
  // Deserialize via JSON to move objects from vm context's realm to this realm (strict deepEqual requires same prototype)
  return JSON.parse(JSON.stringify(ctx.window[name]));
}

test('renderTemplate escapes values, inserts raw values, rejects unknown placeholders', () => {
  assert.equal(renderTemplate('<p>{{a}}</p>{{{b}}}', { a: '<x>' }, { b: '<meta>' }), '<p>&lt;x&gt;</p><meta>');
  assert.throws(() => renderTemplate('{{missing}}', {}, {}), /missing/);
  assert.throws(() => renderTemplate('{{{missing}}}', {}, {}), /missing/);
});

test('prepareSiteDir empties an existing folder', () => {
  const site = makeTmpDir('site');
  fs.writeFileSync(path.join(site, 'old.txt'), 'x');
  prepareSiteDir(site);
  assert.deepEqual(fs.readdirSync(site), []);
});

test('writes one data file per year, newest tweets first', () => {
  const { site, result } = build();
  assert.deepEqual(result.years, ['2021', '2020']);
  assert.deepEqual(result.tweetCounts, { 2021: 1, 2020: 2 });
  const y2020 = loadGlobal(path.join(site, 'data', 'tweets-2020.js'), 'ARCHIVE_TWEETS')['2020'];
  assert.deepEqual(y2020.map((t) => t.id), ['104', '101']);
  assert.ok(!fs.readdirSync(path.join(site, 'data')).some((f) => f.endsWith('.json')));
});

test('writes the public manifest', () => {
  const { site } = build();
  const m = loadGlobal(path.join(site, 'data', 'manifest.js'), 'ARCHIVE_MANIFEST');
  assert.deepEqual(m.profile, {
    username: 'testuser', displayName: 'Test User', createdAt: '2008-06-01T10:00:00.000Z',
    bio: 'I tweet things', website: 'https://example.org', location: 'Somewhere',
    avatarLocal: 'assets/images/avatar.jpg', headerLocal: null,
  });
  assert.deepEqual(m.years, ['2021', '2020']);
  assert.equal(m.totalTweets, 3);
  assert.equal(m.lang, 'it');
  assert.equal(m.exportedAt, '2024-04-08T15:59:18.409Z');
});

test('copies the template and writes the chosen translation', () => {
  const { site } = build();
  for (const rel of ['assets/css/style.css', 'assets/js/app.js', 'assets/images/defaultAvatar.svg']) {
    assert.ok(fs.existsSync(path.join(site, rel)), rel);
  }
  assert.ok(!fs.existsSync(path.join(site, 'i18n')));
  assert.equal(loadGlobal(path.join(site, 'assets', 'js', 'i18n.js'), 'ARCHIVE_I18N').locale, 'it-IT');
});

test('renders index.html with escaped values and robots meta', () => {
  const { site } = build();
  const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  assert.match(html, /<html lang="it">/);
  assert.match(html, /<title>Test &lt;User&gt; — Archivio<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /Archivio Twitter di @testuser/);
  assert.match(html, /Esportato: aprile 2024/);
  assert.match(html, /Naviga per anno/);
  assert.doesNotMatch(html, /\{\{/);
});

test('omits robots meta when indexing is allowed and supports English', () => {
  const { site } = build({ noindex: false, lang: 'en' });
  const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /name="robots"/);
  assert.match(html, /Browse by year/);
  assert.match(html, /Exported: April 2024/);
});
