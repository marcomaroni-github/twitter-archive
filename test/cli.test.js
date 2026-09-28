'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { build, parseArgs } = require('../src/cli');
const { UserError } = require('../src/errors');
const { createFixtureArchive, makeTmpDir, zipDir, listFiles, SENSITIVE } = require('./helpers/fixture');

const TEMPLATE = path.join(__dirname, '..', 'template');

function loadGlobal(file, name) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx);
  return JSON.parse(JSON.stringify(ctx.window[name]));
}

/**
 * Run fn with a private temp base: build() removes stale twitter-archive-* folders
 * from os.tmpdir(), and other test files run in parallel with their own extractions.
 */
async function withTmpBase(fn) {
  const tmpBase = makeTmpDir('tmp-base');
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  Object.assign(process.env, { TMPDIR: tmpBase, TEMP: tmpBase, TMP: tmpBase });
  try {
    return await fn(tmpBase);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const run = (opts) => withTmpBase(() => build(opts));

async function setup() {
  const work = makeTmpDir('work');
  const archiveDir = path.join(work, 'archive');
  fs.mkdirSync(archiveDir);
  await zipDir(createFixtureArchive(), path.join(archiveDir, 'twitter.zip'));
  return {
    archiveDir,
    siteDir: path.join(work, 'site'),
    configPath: path.join(work, 'config.json'),
    templateDir: TEMPLATE,
    extraDir: path.join(work, 'extra'),
    log: () => {},
  };
}

test('parseArgs reads the supported flags and rejects others', () => {
  assert.deepEqual(parseArgs([]), { yes: false, reconfigure: false, debug: false });
  assert.deepEqual(parseArgs(['--yes', '--reconfigure', '--debug']), { yes: true, reconfigure: true, debug: true });
  assert.throws(() => parseArgs(['--nope']), UserError);
});

test('end to end: builds a site from a zip with default options', async () => {
  const opts = await setup();
  const summary = await run({ ...opts, flags: { yes: true, reconfigure: false } });

  assert.equal(summary.included, 5);
  assert.deepEqual(summary.excluded, { retweet: 1, reply: 1, private: 0 });
  assert.equal(summary.media.count, 3);
  assert.deepEqual(summary.years, ['2021', '2020']);

  const files = listFiles(opts.siteDir).sort();
  for (const f of ['index.html', 'data/manifest.js', 'data/tweets-2020.js', 'data/tweets-2021.js',
    'assets/js/app.js', 'assets/js/i18n.js', 'assets/images/avatar.jpg', 'assets/images/header.jpg',
    'tweets_media/101-photoA.jpg', 'tweets_media/101-diagram.png', 'tweets_media/107-clipB.mp4']) {
    assert.ok(files.includes(f), `missing ${f}`);
  }
  assert.ok(!files.includes('tweets_media/999-unused.jpg'));
  assert.ok(fs.existsSync(opts.configPath));

  const tweets2021 = fs.readFileSync(path.join(opts.siteDir, 'data', 'tweets-2021.js'), 'utf8');
  assert.match(tweets2021, /here it is complete/);
});

test('end to end: no private data anywhere in the site', async () => {
  const opts = await setup();
  await run({ ...opts, flags: { yes: true, reconfigure: false } });
  const forbidden = [SENSITIVE.email, SENSITIVE.phone, '393331234567', SENSITIVE.creationIp, SENSITIVE.loginIp,
    SENSITIVE.dmMarker, 'Milano', 'Somewhere', 'Twitter for Android', 'GPSDATA', 'secret text', 'someone else text', '@other I agree'];
  for (const rel of listFiles(opts.siteDir)) {
    const content = fs.readFileSync(path.join(opts.siteDir, rel)).toString('latin1');
    for (const needle of forbidden) assert.ok(!content.includes(needle), `${needle} found in ${rel}`);
  }
});

test('end to end: options include retweets and replies', async () => {
  const opts = await setup();
  fs.writeFileSync(opts.configPath, JSON.stringify({
    lang: 'en', title: 'All', includeRetweets: true, includeReplies: true, noindex: false, website: '',
  }));
  const summary = await run({ ...opts, flags: { yes: false, reconfigure: false } });
  assert.equal(summary.included, 7);
  assert.deepEqual(summary.excluded, { retweet: 0, reply: 0, private: 0 });
});

test('the temporary extraction folder is removed even when the build fails', async () => {
  const opts = await setup();
  await withTmpBase(async (tmpBase) => {
    await assert.rejects(build({ ...opts, templateDir: path.join(opts.siteDir, 'no-template'), flags: { yes: true, reconfigure: false } }));
    assert.deepEqual(fs.readdirSync(tmpBase), []);
  });
});

test('a build that fails while writing the site leaves no partial site folder', async () => {
  const opts = await setup();
  const templateDir = path.join(path.dirname(opts.siteDir), 'no-template');
  await assert.rejects(run({ ...opts, templateDir, flags: { yes: true, reconfigure: false } }));
  assert.ok(!fs.existsSync(opts.siteDir), 'partial site folder still present');
});

test('stale extraction folders from interrupted runs are removed', async () => {
  const opts = await setup();
  await withTmpBase(async (tmpBase) => {
    const stale = path.join(tmpBase, 'twitter-archive-site-extract-stale1');
    fs.mkdirSync(path.join(stale, 'data'), { recursive: true });
    fs.writeFileSync(path.join(stale, 'data', 'direct-messages.js'), 'private');
    const other = path.join(tmpBase, 'twitter-archive-other-tool');
    fs.mkdirSync(other);
    await build({ ...opts, flags: { yes: true, reconfigure: false } });
    assert.ok(!fs.existsSync(stale), 'stale extraction folder still present');
    assert.ok(fs.existsSync(other), 'unrelated temp folder must be kept');
  });
});

test('end to end: tweets and bio containing your private contact data are hidden', async () => {
  const opts = await setup();
  const src = createFixtureArchive();
  const edit = (rel, from, to) => {
    const file = path.join(src, 'data', rel);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(from, to));
  };
  edit('tweets-part1.js', 'Photo without file', `Photo without file, write to ${SENSITIVE.email}`);
  edit('profile.js', 'I tweet things', `Contact: ${SENSITIVE.email}`);
  fs.rmSync(path.join(opts.archiveDir, 'twitter.zip'));
  await zipDir(src, path.join(opts.archiveDir, 'twitter.zip'));
  fs.writeFileSync(opts.configPath, JSON.stringify({
    lang: 'en', title: 'T', includeRetweets: false, includeReplies: false, noindex: true, website: `https://example.org/?${SENSITIVE.email}`,
  }));
  const lines = [];
  const summary = await run({ ...opts, log: (l) => lines.push(l), flags: { yes: true, reconfigure: false } });

  assert.equal(summary.included, 4);
  assert.deepEqual(summary.excluded, { retweet: 1, reply: 1, private: 1 });
  const all = listFiles(opts.siteDir).map((rel) => fs.readFileSync(path.join(opts.siteDir, rel)).toString('latin1')).join('\n');
  assert.ok(!all.includes(SENSITIVE.email));
  assert.ok(!all.includes('Photo without file'));
  const manifest = fs.readFileSync(path.join(opts.siteDir, 'data', 'manifest.js'), 'utf8');
  assert.match(manifest, /"bio": ""/);
  assert.match(manifest, /"website": ""/);
  assert.ok(lines.some((l) => l.includes('1 tweets containing your private contact data')));
  assert.ok(!lines.join('\n').includes(SENSITIVE.email));
  assert.match(fs.readFileSync(opts.configPath, 'utf8'), /example\.org/, 'config.json must not be rewritten');
});

test('end to end: files in extra/ are copied into the site', async () => {
  const opts = await setup();
  fs.mkdirSync(opts.extraDir);
  fs.writeFileSync(path.join(opts.extraDir, 'CNAME'), 'tweets.example.org');
  fs.writeFileSync(path.join(opts.extraDir, 'README.md'), 'instructions');
  const lines = [];
  await run({ ...opts, log: (l) => lines.push(l), flags: { yes: true, reconfigure: false } });
  assert.equal(fs.readFileSync(path.join(opts.siteDir, 'CNAME'), 'utf8'), 'tweets.example.org');
  assert.ok(!fs.existsSync(path.join(opts.siteDir, 'README.md')));
  assert.ok(lines.includes('  Extra files copied: 1'));
});

test('end to end: an image that cannot be cleaned falls back to the remote URL', async () => {
  const opts = await setup();
  const src = createFixtureArchive();
  const photo = path.join(src, 'data', 'tweets_media', '101-photoA.jpg');
  fs.writeFileSync(photo, fs.readFileSync(photo).subarray(0, 10));
  fs.rmSync(path.join(opts.archiveDir, 'twitter.zip'));
  await zipDir(src, path.join(opts.archiveDir, 'twitter.zip'));
  const summary = await run({ ...opts, flags: { yes: true, reconfigure: false } });

  assert.deepEqual(summary.media.skipped, ['101-photoA.jpg']);
  assert.ok(!fs.existsSync(path.join(opts.siteDir, 'tweets_media', '101-photoA.jpg')));
  const t101 = loadGlobal(path.join(opts.siteDir, 'data', 'tweets-2020.js'), 'ARCHIVE_TWEETS')['2020'].find((t) => t.id === '101');
  assert.equal(t101.media[0].local, null);
  assert.equal(t101.media[0].url, 'https://pbs.twimg.com/media/photoA.jpg');
  assert.equal(t101.media[1].local, 'tweets_media/101-diagram.png');
});

test('without an interactive terminal the build behaves like --yes', async () => {
  const opts = await setup();
  const lines = [];
  let asked = false;
  const prompt = async () => { asked = true; return {}; };
  const summary = await run({
    ...opts, log: (l) => lines.push(l), flags: { yes: false, reconfigure: false }, interactive: false, prompt,
  });
  assert.equal(asked, false, 'prompt must not be called');
  assert.equal(summary.included, 5);
  assert.ok(lines.includes('No interactive terminal: using config.json or the defaults.'));
  assert.ok(fs.existsSync(opts.configPath));
});

test('with an interactive terminal the setup questions are asked', async () => {
  const opts = await setup();
  let asked = false;
  const prompt = async () => { asked = true; return {}; };
  await assert.rejects(run({ ...opts, flags: { yes: false, reconfigure: false }, interactive: true, prompt }), UserError);
  assert.equal(asked, true);
});
