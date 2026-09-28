'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { build, parseArgs } = require('../src/cli');
const { UserError } = require('../src/errors');
const { createFixtureArchive, makeTmpDir, zipDir, listFiles, SENSITIVE } = require('./helpers/fixture');

const TEMPLATE = path.join(__dirname, '..', 'template');

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
  const summary = await build({ ...opts, flags: { yes: true, reconfigure: false } });

  assert.equal(summary.included, 5);
  assert.deepEqual(summary.excluded, { retweet: 1, reply: 1 });
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
  await build({ ...opts, flags: { yes: true, reconfigure: false } });
  const forbidden = [SENSITIVE.email, SENSITIVE.phone, '393331234567', SENSITIVE.creationIp, SENSITIVE.loginIp,
    SENSITIVE.dmMarker, 'Milano', 'Twitter for Android', 'GPSDATA', 'secret text', 'someone else text', '@other I agree'];
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
  const summary = await build({ ...opts, flags: { yes: false, reconfigure: false } });
  assert.equal(summary.included, 7);
  assert.deepEqual(summary.excluded, { retweet: 0, reply: 0 });
});

test('the temporary extraction folder is removed even when the build fails', async () => {
  const opts = await setup();
  // Private temp base: test files run in parallel and create their own temp folders.
  const tmpBase = makeTmpDir('tmp-base');
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  Object.assign(process.env, { TMPDIR: tmpBase, TEMP: tmpBase, TMP: tmpBase });
  try {
    await assert.rejects(build({ ...opts, templateDir: path.join(opts.siteDir, 'no-template'), flags: { yes: true, reconfigure: false } }));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  assert.deepEqual(fs.readdirSync(tmpBase), []);
});
