# Twitter Archive Site Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn this repository into a generic tool that converts any Twitter archive (April 2024 format) into a privacy-safe static website with `npm install` + `npm run build`.

**Architecture:** A Node.js CommonJS pipeline in `src/` with one module per step (locate → read → filter/notes → transform → media → write → guard), orchestrated by `src/cli.js`. The static frontend lives in `template/` (derived from today's `docs/`), and the build copies it to `site/` together with generated data files. Every step is a small module with its own tests under `test/`, run by the built-in `node --test`.

**Tech Stack:** Node.js ≥ 18 (CommonJS), `yauzl` (zip reading), `prompts` (interactive questions), `yazl` (dev only, to build zip fixtures in tests), `node:test` + `node:assert/strict`.

**Spec:** `specs/2026-09-28-archive-site-generator-design.md`

## Global Constraints

- Node.js 18 or newer; `package.json` `engines.node` is `>=18`.
- Runtime dependencies: only `yauzl` and `prompts`. Dev dependency: only `yazl`. No image libraries.
- No network calls during the build.
- CLI output, CLI error messages and code comments are in English. Site UI strings come from `template/i18n/<lang>.json` (`it`, `en`).
- User-facing errors are thrown as `UserError(message, hint)` and printed without stack trace; stack traces only with `--debug`.
- Sensitive values (email, phone, IP) must never appear in any output, log or error message.
- The real archive (`original-archive/`, `archive/`) is never used as a test fixture.
- Commit messages: Conventional Commits style (`feat:`, `test:`, `docs:`, `chore:`), and **no `Co-Authored-By` line or any reference to Claude/AI**.
- Tests: files named `test/*.test.js`, run with `npm test`.

## File Map

| File | Responsibility |
|---|---|
| `package.json` | scripts `build`, `test`; dependencies |
| `.gitignore` | ignores `archive/*` (except its README), `site/`, `config.json`, `original-archive/` |
| `archive/README.md` | placeholder so the folder exists after clone; tells the user what to put there |
| `src/errors.js` | `UserError` |
| `src/archive/parse.js` | parse `window.__THAR_CONFIG = …` and `window.YTD.x.partN = …` files |
| `src/archive/locate.js` | find zip(s) or extracted folder in `archive/`, extract zips to a temp dir |
| `src/archive/read.js` | read only the allowlisted archive files, return a normalized archive object |
| `src/pipeline/text.js` | `decodeEntities` |
| `src/pipeline/filter.js` | inclusion rules (retweets, replies, threads) |
| `src/pipeline/notes.js` | match long posts (`note-tweet.js`) to tweets |
| `src/pipeline/transform.js` | raw tweet → public tweet with allowlisted fields |
| `src/pipeline/strip.js` | remove metadata from JPEG/PNG buffers |
| `src/pipeline/media.js` | copy tweet media and profile images into `site/` |
| `src/privacy/guard.js` | collect owner's sensitive values; scan `site/` and block on match |
| `src/site/write.js` | prepare `site/`, write data files, copy template, render `index.html` |
| `src/wizard.js` | defaults, `config.json` load/validate/save, interactive questions |
| `src/cli.js` | entry point: flags, Node version check, orchestration, summary, error printing |
| `template/index.html` | page with `{{placeholders}}` |
| `template/assets/css/style.css` | copied from `docs/` |
| `template/assets/js/app.js` | frontend, generalized (no hardcoded owner, i18n) |
| `template/assets/images/defaultAvatar.svg`, `favicon.ico` | copied from `docs/` |
| `template/i18n/it.json`, `template/i18n/en.json` | UI strings |
| `test/helpers/fixture.js` | builds a fake archive on disk, zips folders |
| `test/*.test.js` | tests |
| `README.md`, `README.it.md`, `LICENSE` | documentation |

---

### Task 1: Project scaffolding, `UserError`, archive file parsers

**Files:**
- Create: `package.json`, `archive/README.md`, `src/errors.js`, `src/archive/parse.js`
- Modify: `.gitignore`
- Test: `test/parse.test.js`

**Interfaces:**
- Produces:
  - `class UserError extends Error { constructor(message: string, hint?: string) }` with `.hint: string`, from `src/errors.js`
  - `parseManifest(content: string): object` — returns the `__THAR_CONFIG` object; throws `UserError` if the prefix is not `window.__THAR_CONFIG`
  - `parseYtd(content: string, label: string): Array<object>` — returns the array; throws `UserError` if the prefix does not start with `window.YTD.` or the JSON is not an array

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "twitter-archive-site",
  "version": "1.0.0",
  "private": true,
  "description": "Turn your Twitter archive into a privacy-safe static website",
  "license": "MIT",
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "build": "node src/cli.js",
    "test": "node --test"
  },
  "dependencies": {
    "prompts": "^2.4.2",
    "yauzl": "^3.1.3"
  },
  "devDependencies": {
    "yazl": "^2.5.1"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: creates `node_modules/` and `package-lock.json`, no errors.

- [ ] **Step 3: Replace `.gitignore`**

```gitignore
# ==========================================================
# PERSONAL DATA - NEVER COMMIT
# Twitter archives contain email, IP addresses, DMs and other private data
# ==========================================================
archive/*
!archive/README.md
original-archive/
config.json

# Generated site
site/

# Node
node_modules/
npm-debug.log*

# OS
.DS_Store
Thumbs.db

# Editor
.vscode/
.idea/
*.swp
*.swo

# Temp & scratch
*.tmp
*.log
prompt.txt
Da rimuovere dal vecchio layout.png
```

- [ ] **Step 4: Create `archive/README.md`**

```markdown
# Put your Twitter archive here

Copy the `.zip` file you downloaded from Twitter/X into this folder
(or all the `.zip` files, if your archive was split into parts).

You can also extract the zip here instead: the folder that contains
`Your archive.html` and `data/` is detected automatically.

Everything in this folder except this README is ignored by git:
your archive contains private data and must never be committed.
```

- [ ] **Step 5: Write the failing tests** — `test/parse.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseManifest, parseYtd } = require('../src/archive/parse');
const { UserError } = require('../src/errors');

test('parseManifest returns the config object', () => {
  const content = 'window.__THAR_CONFIG = {\n  "userInfo" : { "accountId" : "1" }\n}';
  assert.deepEqual(parseManifest(content), { userInfo: { accountId: '1' } });
});

test('parseManifest rejects other formats with a UserError', () => {
  assert.throws(() => parseManifest('var x = {}'), UserError);
  assert.throws(() => parseManifest('{"a":1}'), UserError);
});

test('parseYtd returns the array of a YTD file', () => {
  const content = 'window.YTD.tweets.part0 = [ { "tweet" : { "id_str" : "1" } } ]';
  assert.deepEqual(parseYtd(content, 'data/tweets.js'), [{ tweet: { id_str: '1' } }]);
});

test('parseYtd accepts an empty array and a trailing semicolon', () => {
  assert.deepEqual(parseYtd('window.YTD.note_tweet.part0 = [ ];', 'x'), []);
});

test('parseYtd rejects non-YTD content with a UserError naming the file', () => {
  assert.throws(() => parseYtd('hello', 'data/tweets.js'), (err) => {
    assert.ok(err instanceof UserError);
    assert.match(err.message, /data\/tweets\.js/);
    return true;
  });
  assert.throws(() => parseYtd('window.YTD.x.part0 = {"a":1}', 'x'), UserError);
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '../src/archive/parse'`.

- [ ] **Step 7: Create `src/errors.js`**

```js
'use strict';

/**
 * An error caused by the user's input or environment (missing archive,
 * unsupported format, ...). The CLI prints it without a stack trace.
 */
class UserError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'UserError';
    this.hint = hint || '';
  }
}

module.exports = { UserError };
```

- [ ] **Step 8: Create `src/archive/parse.js`**

```js
'use strict';

const { UserError } = require('../errors');

const UNSUPPORTED_HINT =
  'This tool supports the Twitter archive format of April 2024 ' +
  '(data/manifest.js starting with "window.__THAR_CONFIG").';

/** Split "prefix = json" into [prefix, parsed json]. Returns null on failure. */
function splitAssignment(content) {
  const eq = content.indexOf('=');
  if (eq === -1) return null;
  const prefix = content.slice(0, eq).trim();
  const body = content.slice(eq + 1).trim().replace(/;\s*$/, '');
  try {
    return [prefix, JSON.parse(body)];
  } catch {
    return null;
  }
}

function parseManifest(content) {
  const parts = splitAssignment(content);
  if (!parts || parts[0] !== 'window.__THAR_CONFIG' || typeof parts[1] !== 'object') {
    throw new UserError('Unsupported archive format: data/manifest.js is not recognized.', UNSUPPORTED_HINT);
  }
  return parts[1];
}

function parseYtd(content, label) {
  const parts = splitAssignment(content);
  if (!parts || !parts[0].startsWith('window.YTD.') || !Array.isArray(parts[1])) {
    throw new UserError(`Unsupported archive format: cannot read ${label}.`, UNSUPPORTED_HINT);
  }
  return parts[1];
}

module.exports = { parseManifest, parseYtd };
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, 5 tests.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json .gitignore archive/README.md src/errors.js src/archive/parse.js test/parse.test.js
git commit -m "feat: add project scaffolding and archive file parsers"
```

---

### Task 2: Test fixture + allowlisted archive reader

**Files:**
- Create: `test/helpers/fixture.js`, `src/archive/read.js`
- Test: `test/read.test.js`

**Interfaces:**
- Consumes: `parseManifest`, `parseYtd` (Task 1), `UserError`.
- Produces (fixture, used by later tests):
  - `OWNER = { accountId: '1000', userName: 'testuser', displayName: 'Test User' }`
  - `SENSITIVE = { email, phone, creationIp, loginIp, dmMarker }` (strings)
  - `makeTmpDir(prefix: string): string`
  - `makeJpeg(): Buffer`, `makePng(): Buffer`
  - `createFixtureArchive(targetDir?: string, overrides?: { accountId?: string }): string` — writes a full fake archive (`targetDir/data/...`) and returns `targetDir`
  - `zipDir(srcDir: string, outFile: string, only?: (relPath: string) => boolean): Promise<void>`
- Produces (reader):
  - `readManifest(root: string): object`
  - `readArchive(root: string): Archive` where
    `Archive = { user: { accountId, userName, displayName }, generationDate: string, tweets: object[] /* unwrapped .tweet */, noteTweets: object[] /* unwrapped .noteTweet */, profile: { bio, website, location, avatarMediaUrl, headerMediaUrl }, account: { createdAt }, mediaDir: string, profileMediaDir: string, profileMediaFiles: string[] }`
  - `PIPELINE_TYPES = ['tweets', 'noteTweet', 'profile', 'account']`

- [ ] **Step 1: Create `test/helpers/fixture.js`**

```js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const OWNER = { accountId: '1000', userName: 'testuser', displayName: 'Test User' };

const SENSITIVE = {
  email: 'secret.owner@example.com',
  phone: '+393331234567',
  creationIp: '203.0.113.7',
  loginIp: '198.51.100.23',
  dmMarker: 'DM_SECRET_MARKER',
};

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function jpegSegment(marker, payload) {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** Minimal JPEG-like buffer with APP0, APP1 (EXIF with GPS text), COM, DQT, SOS, scan data, EOI. */
function makeJpeg() {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    jpegSegment(0xe1, Buffer.from('Exif\0\0GPSDATA-45.1,9.2', 'latin1')),
    jpegSegment(0xfe, Buffer.from('camera comment', 'latin1')),
    jpegSegment(0xdb, Buffer.alloc(65, 1)),
    jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from('SCANDATA', 'latin1'),
    Buffer.from([0xff, 0xd9]),
  ]);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}

/** Minimal PNG-like buffer with IHDR, tEXt (secret text), IDAT, IEND. */
function makePng() {
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', Buffer.alloc(13)),
    pngChunk('tEXt', Buffer.from('Comment\0secret text', 'latin1')),
    pngChunk('IDAT', Buffer.from('PIXELS', 'latin1')),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function rawTweet(fields) {
  const {
    id, date, text, hashtags = [], urls = [], mentions = [], media,
    replyStatus, replyUser, replyName,
  } = fields;
  const tweet = {
    edit_info: { initial: { editTweetIds: [id], editableUntil: '2020-01-01T00:00:00.000Z' } },
    retweeted: false,
    source: '<a href="http://twitter.com/download/android" rel="nofollow">Twitter for Android</a>',
    entities: {
      hashtags: hashtags.map((h) => ({ text: h, indices: ['0', '1'] })),
      symbols: [],
      user_mentions: mentions.map((m) => ({ ...m, id_str: '42', indices: ['0', '1'] })),
      urls,
    },
    display_text_range: ['0', String(text.length)],
    favorite_count: '3',
    id_str: id,
    id,
    retweet_count: '1',
    created_at: date,
    favorited: false,
    full_text: text,
    lang: 'it',
    geo: { type: 'Point', coordinates: ['45.1', '9.2'] },
    coordinates: { type: 'Point', coordinates: ['9.2', '45.1'] },
    place: { full_name: 'Milano, Lombardia' },
  };
  if (media) {
    tweet.entities.media = media;
    tweet.extended_entities = { media };
  }
  if (replyStatus) {
    tweet.in_reply_to_status_id_str = replyStatus;
    tweet.in_reply_to_status_id = replyStatus;
    tweet.in_reply_to_user_id_str = replyUser;
    tweet.in_reply_to_user_id = replyUser;
    tweet.in_reply_to_screen_name = replyName;
  }
  return { tweet };
}

function photo(url) {
  return { type: 'photo', media_url_https: url, media_url: url.replace('https', 'http'), url: 'https://t.co/media1' };
}

const TWEETS_PART0 = [
  rawTweet({
    id: '101', date: 'Thu Jan 02 10:00:00 +0000 2020',
    text: 'Hello world &amp; friends #test https://t.co/abc123 https://t.co/media1',
    hashtags: ['test'],
    urls: [{ url: 'https://t.co/abc123', expanded_url: 'https://example.org/page', display_url: 'example.org/page' }],
    media: [photo('https://pbs.twimg.com/media/photoA.jpg'), photo('https://pbs.twimg.com/media/diagram.png')],
  }),
  rawTweet({ id: '102', date: 'Fri Jan 03 10:00:00 +0000 2020', text: 'RT @other: someone else text' }),
  rawTweet({
    id: '103', date: 'Sat Jan 04 10:00:00 +0000 2020', text: '@other I agree',
    mentions: [{ name: 'Other Person', screen_name: 'other' }],
    replyStatus: '900', replyUser: '2000', replyName: 'other',
  }),
  rawTweet({
    id: '104', date: 'Thu Jan 02 10:05:00 +0000 2020', text: 'Second part of my thread',
    replyStatus: '101', replyUser: '1000', replyName: 'testuser',
  }),
];

const TWEETS_PART1 = [
  rawTweet({
    id: '105', date: 'Mon Mar 01 12:00:00 +0000 2021',
    text: 'This is a long post that gets truncated… https://t.co/long1',
  }),
  rawTweet({
    id: '106', date: 'Tue Mar 02 12:00:00 +0000 2021', text: 'Photo without file',
    media: [photo('https://pbs.twimg.com/media/missing.jpg')],
  }),
  rawTweet({
    id: '107', date: 'Wed Mar 03 12:00:00 +0000 2021', text: 'My video',
    media: [{
      type: 'video',
      media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/107/pu/img/thumb.jpg',
      video_info: {
        variants: [
          { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/ext_tw_video/107/pu/pl/list.m3u8' },
          { content_type: 'video/mp4', bitrate: '256000', url: 'https://video.twimg.com/ext_tw_video/107/pu/vid/320x180/clipA.mp4?tag=12' },
          { content_type: 'video/mp4', bitrate: '832000', url: 'https://video.twimg.com/ext_tw_video/107/pu/vid/640x360/clipB.mp4?tag=12' },
        ],
      },
    }],
  }),
];

const NOTE_TEXT = 'This is a long post that gets truncated in the tweet but here it is complete, see https://t.co/n1';

function manifestFor(accountId) {
  const files = (name, fileName, count = '1') => ({ files: [{ fileName, globalName: `YTD.${name}.part0`, count }] });
  return {
    userInfo: { accountId, userName: OWNER.userName, displayName: OWNER.displayName },
    archiveInfo: { sizeBytes: '1000', generationDate: '2024-04-08T15:59:18.409Z', isPartialArchive: false },
    readmeInfo: { fileName: 'data/README.txt', directory: 'data/', name: 'README.txt' },
    dataTypes: {
      account: files('account', 'data/account.js'),
      accountCreationIp: files('account_creation_ip', 'data/account-creation-ip.js'),
      directMessages: { mediaDirectory: 'data/direct_messages_media', ...files('direct_messages', 'data/direct-messages.js') },
      ipAudit: files('ip_audit', 'data/ip-audit.js'),
      noteTweet: files('note_tweet', 'data/note-tweet.js'),
      phoneNumber: files('phone_number', 'data/phone-number.js'),
      profile: { mediaDirectory: 'data/profile_media', ...files('profile', 'data/profile.js') },
      tweets: {
        mediaDirectory: 'data/tweets_media',
        files: [
          { fileName: 'data/tweets.js', globalName: 'YTD.tweets.part0', count: '4' },
          { fileName: 'data/tweets-part1.js', globalName: 'YTD.tweets.part1', count: '3' },
        ],
      },
    },
  };
}

function ytd(name, part, entries) {
  return `window.YTD.${name}.part${part} = ${JSON.stringify(entries, null, 2)}`;
}

function createFixtureArchive(targetDir, overrides = {}) {
  const root = targetDir || makeTmpDir('fixture-archive');
  const accountId = overrides.accountId || OWNER.accountId;
  const data = path.join(root, 'data');
  const write = (rel, content) => {
    const full = path.join(data, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(root, 'Your archive.html'), '<html>archive viewer</html>');
  write('manifest.js', `window.__THAR_CONFIG = ${JSON.stringify(manifestFor(accountId), null, 2)}`);
  write('tweets.js', ytd('tweets', 0, TWEETS_PART0));
  write('tweets-part1.js', ytd('tweets', 1, TWEETS_PART1));
  write('note-tweet.js', ytd('note_tweet', 0, [{
    noteTweet: {
      noteTweetId: '5000',
      createdAt: '2021-03-01T12:00:00.000Z',
      core: {
        text: NOTE_TEXT,
        urls: [{ shortUrl: 'https://t.co/n1', expandedUrl: 'https://example.org/full', displayUrl: 'example.org/full' }],
        mentions: [], hashtags: [], cashtags: [], styletags: [],
      },
    },
  }]));
  write('profile.js', ytd('profile', 0, [{
    profile: {
      description: { bio: 'I tweet things', website: 'https://t.co/prof1', location: 'Somewhere' },
      avatarMediaUrl: 'https://pbs.twimg.com/profile_images/1/avatarX.jpg',
      headerMediaUrl: `https://pbs.twimg.com/profile_banners/${accountId}/1600000000`,
    },
  }]));
  write('account.js', ytd('account', 0, [{
    account: {
      email: SENSITIVE.email, createdVia: 'web', username: OWNER.userName, accountId,
      createdAt: '2008-06-01T10:00:00.000Z', accountDisplayName: OWNER.displayName,
    },
  }]));
  write('phone-number.js', ytd('phone_number', 0, [{ device: { phoneNumber: SENSITIVE.phone } }]));
  write('account-creation-ip.js', ytd('account_creation_ip', 0, [{ accountCreationIp: { accountId, userCreationIp: SENSITIVE.creationIp } }]));
  write('ip-audit.js', ytd('ip_audit', 0, [{ ipAudit: { accountId, createdAt: '2024-01-01T00:00:00.000Z', loginIp: SENSITIVE.loginIp, loginPortNumber: '443' } }]));
  write('direct-messages.js', ytd('direct_messages', 0, [{ dmConversation: { conversationId: '1000-2000', messages: [{ messageCreate: { text: SENSITIVE.dmMarker } }] } }]));

  write('tweets_media/101-photoA.jpg', makeJpeg());
  write('tweets_media/101-diagram.png', makePng());
  write('tweets_media/107-clipB.mp4', Buffer.from('MP4DATA'));
  write('tweets_media/999-unused.jpg', makeJpeg());
  write(`profile_media/${accountId}-avatarX.jpg`, makeJpeg());
  write(`profile_media/${accountId}-1600000000.jpg`, makeJpeg());
  return root;
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function zipDir(srcDir, outFile, only = () => true) {
  const yazl = require('yazl');
  const zip = new yazl.ZipFile();
  for (const rel of listFiles(srcDir)) {
    if (only(rel)) zip.addFile(path.join(srcDir, rel), rel);
  }
  return new Promise((resolve, reject) => {
    zip.outputStream.pipe(fs.createWriteStream(outFile)).on('close', resolve).on('error', reject);
    zip.end();
  });
}

module.exports = {
  OWNER, SENSITIVE, NOTE_TEXT,
  makeTmpDir, makeJpeg, makePng, createFixtureArchive, zipDir, listFiles,
};
```

- [ ] **Step 2: Write the failing tests** — `test/read.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readArchive, readManifest } = require('../src/archive/read');
const { UserError } = require('../src/errors');
const { createFixtureArchive, makeTmpDir, OWNER } = require('./helpers/fixture');

test('readArchive reads tweets from all parts listed in the manifest', () => {
  const root = createFixtureArchive();
  const archive = readArchive(root);
  assert.equal(archive.tweets.length, 7);
  assert.deepEqual(archive.tweets.map((t) => t.id_str), ['101', '102', '103', '104', '105', '106', '107']);
});

test('readArchive returns user, profile, account date, notes and media paths', () => {
  const root = createFixtureArchive();
  const a = readArchive(root);
  assert.deepEqual(a.user, OWNER);
  assert.equal(a.generationDate, '2024-04-08T15:59:18.409Z');
  assert.equal(a.profile.bio, 'I tweet things');
  assert.equal(a.profile.website, 'https://t.co/prof1');
  assert.equal(a.profile.location, 'Somewhere');
  assert.equal(a.profile.avatarMediaUrl, 'https://pbs.twimg.com/profile_images/1/avatarX.jpg');
  assert.deepEqual(a.account, { createdAt: '2008-06-01T10:00:00.000Z' });
  assert.equal(a.noteTweets.length, 1);
  assert.equal(a.noteTweets[0].noteTweetId, '5000');
  assert.equal(a.mediaDir, path.join(root, 'data', 'tweets_media'));
  assert.deepEqual(a.profileMediaFiles.sort(), ['1000-1600000000.jpg', '1000-avatarX.jpg']);
});

test('readArchive never exposes the email from account.js', () => {
  const root = createFixtureArchive();
  assert.doesNotMatch(JSON.stringify(readArchive(root)), /secret\.owner@example\.com/);
});

test('readArchive opens only allowlisted files', (t) => {
  const root = createFixtureArchive();
  const opened = [];
  const original = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function (file, ...rest) {
    opened.push(path.basename(String(file)));
    return original.call(fs, file, ...rest);
  });
  readArchive(root);
  const allowed = new Set(['manifest.js', 'tweets.js', 'tweets-part1.js', 'note-tweet.js', 'profile.js', 'account.js']);
  for (const name of opened) assert.ok(allowed.has(name), `unexpected file read: ${name}`);
  assert.ok(opened.includes('tweets-part1.js'));
});

test('readManifest throws a UserError when manifest.js is missing', () => {
  const root = makeTmpDir('empty-archive');
  assert.throws(() => readManifest(root), UserError);
});

test('readArchive throws a UserError when the archive has no tweets', () => {
  const root = createFixtureArchive();
  fs.writeFileSync(path.join(root, 'data', 'tweets.js'), 'window.YTD.tweets.part0 = []');
  fs.writeFileSync(path.join(root, 'data', 'tweets-part1.js'), 'window.YTD.tweets.part1 = []');
  assert.throws(() => readArchive(root), UserError);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '../src/archive/read'`.

- [ ] **Step 4: Create `src/archive/read.js`**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { parseManifest, parseYtd } = require('./parse');
const { UserError } = require('../errors');

/**
 * The only data types the pipeline is allowed to read. Anything else in the
 * archive (DMs, IP logs, followers, ads, deleted tweets, ...) is never opened here.
 */
const PIPELINE_TYPES = ['tweets', 'noteTweet', 'profile', 'account'];

function filesOf(manifest, type) {
  const dataType = manifest.dataTypes && manifest.dataTypes[type];
  if (!dataType || !Array.isArray(dataType.files)) return [];
  return dataType.files.map((f) => f.fileName).filter(Boolean);
}

function readManifest(root) {
  const file = path.join(root, 'data', 'manifest.js');
  if (!fs.existsSync(file)) {
    throw new UserError(
      'Unsupported archive format: data/manifest.js not found.',
      'Make sure you copied the archive downloaded from Twitter/X, not a single file from it.'
    );
  }
  return parseManifest(fs.readFileSync(file, 'utf8'));
}

function readType(root, manifest, type, key) {
  if (!PIPELINE_TYPES.includes(type)) throw new Error(`Data type not allowlisted: ${type}`);
  const out = [];
  for (const rel of filesOf(manifest, type)) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    for (const entry of parseYtd(fs.readFileSync(full, 'utf8'), rel)) {
      if (entry && entry[key]) out.push(entry[key]);
    }
  }
  return out;
}

function readArchive(root) {
  const manifest = readManifest(root);
  const userInfo = manifest.userInfo || {};
  if (!userInfo.accountId || !userInfo.userName) {
    throw new UserError('Unsupported archive format: account information missing in data/manifest.js.');
  }

  const tweets = readType(root, manifest, 'tweets', 'tweet');
  if (tweets.length === 0) {
    throw new UserError('No tweets found in the archive.', 'Check that the archive is complete (data/tweets.js).');
  }
  const noteTweets = readType(root, manifest, 'noteTweet', 'noteTweet');
  const profileEntry = readType(root, manifest, 'profile', 'profile')[0] || {};
  const accountEntry = readType(root, manifest, 'account', 'account')[0] || {};
  const description = profileEntry.description || {};

  const tweetsType = manifest.dataTypes.tweets || {};
  const profileType = manifest.dataTypes.profile || {};
  const mediaDir = path.join(root, tweetsType.mediaDirectory || 'data/tweets_media');
  const profileMediaDir = path.join(root, profileType.mediaDirectory || 'data/profile_media');
  const profileMediaFiles = fs.existsSync(profileMediaDir) ? fs.readdirSync(profileMediaDir) : [];

  return {
    user: {
      accountId: String(userInfo.accountId),
      userName: userInfo.userName,
      displayName: userInfo.displayName || accountEntry.accountDisplayName || userInfo.userName,
    },
    generationDate: (manifest.archiveInfo && manifest.archiveInfo.generationDate) || '',
    tweets,
    noteTweets,
    profile: {
      bio: description.bio || '',
      website: description.website || '',
      location: description.location || '',
      avatarMediaUrl: profileEntry.avatarMediaUrl || '',
      headerMediaUrl: profileEntry.headerMediaUrl || '',
    },
    // Only the creation date: account.js also holds the email, which must not leave this module.
    account: { createdAt: accountEntry.createdAt || '' },
    mediaDir,
    profileMediaDir,
    profileMediaFiles,
  };
}

module.exports = { readArchive, readManifest, PIPELINE_TYPES };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests in `parse.test.js` and `read.test.js`.

- [ ] **Step 6: Commit**

```bash
git add test/helpers/fixture.js test/read.test.js src/archive/read.js
git commit -m "feat: read only allowlisted files from the Twitter archive"
```

---

### Task 3: Locate the archive (zip or folder) in `archive/`

**Files:**
- Create: `src/archive/locate.js`
- Test: `test/locate.test.js`

**Interfaces:**
- Consumes: `UserError`; `readManifest` (Task 2) to compare account ids across zips.
- Produces: `locateArchive(archiveDir: string): Promise<{ root: string, cleanup: () => Promise<void> }>` — `root` is the folder containing `data/manifest.js`. `cleanup` removes the temp extraction folder (no-op for extracted folders).

- [ ] **Step 1: Write the failing tests** — `test/locate.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { locateArchive } = require('../src/archive/locate');
const { UserError } = require('../src/errors');
const { createFixtureArchive, makeTmpDir, zipDir } = require('./helpers/fixture');

const hasManifest = (root) => fs.existsSync(path.join(root, 'data', 'manifest.js'));

test('finds an archive extracted directly into archive/', async () => {
  const dir = makeTmpDir('archive');
  createFixtureArchive(dir);
  const { root, cleanup } = await locateArchive(dir);
  assert.equal(root, dir);
  await cleanup();
  assert.ok(hasManifest(dir), 'cleanup must not delete the user folder');
});

test('finds an archive nested one level down', async () => {
  const dir = makeTmpDir('archive');
  const nested = path.join(dir, 'twitter-2024-04-08');
  fs.mkdirSync(nested);
  createFixtureArchive(nested);
  const { root } = await locateArchive(dir);
  assert.equal(root, nested);
});

test('extracts a single zip into a temp folder and cleans it up', async () => {
  const dir = makeTmpDir('archive');
  await zipDir(createFixtureArchive(), path.join(dir, 'twitter.zip'));
  const { root, cleanup } = await locateArchive(dir);
  assert.ok(hasManifest(root));
  assert.ok(!root.startsWith(dir), 'must extract outside archive/');
  await cleanup();
  assert.ok(!fs.existsSync(root));
});

test('merges an archive split into several zips', async () => {
  const src = createFixtureArchive();
  const dir = makeTmpDir('archive');
  await zipDir(src, path.join(dir, 'twitter-part1.zip'), (rel) => !rel.startsWith('data/tweets_media/'));
  await zipDir(src, path.join(dir, 'twitter-part2.zip'), (rel) => rel.startsWith('data/tweets_media/'));
  const { root, cleanup } = await locateArchive(dir);
  assert.ok(hasManifest(root));
  assert.ok(fs.existsSync(path.join(root, 'data', 'tweets_media', '101-photoA.jpg')));
  await cleanup();
});

test('rejects zips of two different accounts', async () => {
  const dir = makeTmpDir('archive');
  await zipDir(createFixtureArchive(), path.join(dir, 'a.zip'));
  await zipDir(createFixtureArchive(undefined, { accountId: '2222' }), path.join(dir, 'b.zip'));
  await assert.rejects(locateArchive(dir), UserError);
});

test('rejects a zip together with an extracted folder', async () => {
  const dir = makeTmpDir('archive');
  createFixtureArchive(dir);
  await zipDir(createFixtureArchive(), path.join(dir, 'twitter.zip'));
  await assert.rejects(locateArchive(dir), UserError);
});

test('rejects two extracted folders', async () => {
  const dir = makeTmpDir('archive');
  for (const name of ['one', 'two']) {
    fs.mkdirSync(path.join(dir, name));
    createFixtureArchive(path.join(dir, name));
  }
  await assert.rejects(locateArchive(dir), UserError);
});

test('rejects an empty archive/ folder and a missing one', async () => {
  const dir = makeTmpDir('archive');
  fs.writeFileSync(path.join(dir, 'README.md'), 'put your zip here');
  await assert.rejects(locateArchive(dir), UserError);
  await assert.rejects(locateArchive(path.join(dir, 'nope')), UserError);
});

test('rejects a corrupted zip', async () => {
  const dir = makeTmpDir('archive');
  fs.writeFileSync(path.join(dir, 'broken.zip'), 'this is not a zip');
  await assert.rejects(locateArchive(dir), UserError);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '../src/archive/locate'`.

- [ ] **Step 3: Create `src/archive/locate.js`**

```js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const yauzl = require('yauzl');
const { UserError } = require('../errors');
const { readManifest } = require('./read');

const COPY_HINT = 'Copy the .zip file downloaded from Twitter/X into the "archive" folder, then run "npm run build" again.';

/** Folders (up to maxDepth levels below dir, dir included) that contain data/manifest.js. */
function findManifestRoots(dir, maxDepth) {
  const roots = [];
  const visit = (current, depth) => {
    if (fs.existsSync(path.join(current, 'data', 'manifest.js'))) {
      roots.push(current);
      return;
    }
    if (depth >= maxDepth) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) visit(path.join(current, entry.name), depth + 1);
    }
  };
  visit(dir, 0);
  return roots;
}

function extractZip(zipPath, destDir) {
  const corrupted = () => new UserError(
    `Cannot read the zip file "${path.basename(zipPath)}".`,
    'The file may be corrupted or incomplete: download the archive again from Twitter/X.'
  );
  const base = path.resolve(destDir) + path.sep;
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zip) => {
      if (openErr) return reject(corrupted());
      zip.on('error', () => reject(corrupted()));
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        const dest = path.resolve(destDir, entry.fileName);
        if (!dest.startsWith(base)) {
          zip.readEntry(); // never write outside the temp folder
          return;
        }
        if (entry.fileName.endsWith('/')) {
          fs.mkdirSync(dest, { recursive: true });
          zip.readEntry();
          return;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        zip.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr) return reject(corrupted());
          const writeStream = fs.createWriteStream(dest);
          readStream.on('error', () => reject(corrupted()));
          writeStream.on('error', reject);
          writeStream.on('finish', () => zip.readEntry());
          readStream.pipe(writeStream);
        });
      });
      zip.readEntry();
    });
  });
}

function accountIdAt(root) {
  return String((readManifest(root).userInfo || {}).accountId || '');
}

async function extractZips(zips) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twitter-archive-'));
  const cleanup = async () => fs.rmSync(tmp, { recursive: true, force: true });
  try {
    let accountId = null;
    for (const zipPath of zips) {
      await extractZip(zipPath, tmp);
      const roots = findManifestRoots(tmp, 2);
      if (roots.length > 1) throw new UserError('The zip files contain more than one archive.', 'Keep only the zip files of one archive in the "archive" folder.');
      if (roots.length === 1) {
        const current = accountIdAt(roots[0]);
        if (accountId !== null && current !== accountId) {
          throw new UserError('The zip files belong to different accounts.', 'Keep only the zip files of one archive in the "archive" folder.');
        }
        accountId = current;
      }
    }
    const roots = findManifestRoots(tmp, 2);
    if (roots.length === 0) {
      throw new UserError('The zip file does not contain a Twitter archive (data/manifest.js not found).', COPY_HINT);
    }
    return { root: roots[0], cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

async function locateArchive(archiveDir) {
  if (!fs.existsSync(archiveDir)) {
    throw new UserError(`Folder not found: ${archiveDir}`, COPY_HINT);
  }
  const zips = fs.readdirSync(archiveDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.zip'))
    .map((e) => path.join(archiveDir, e.name))
    .sort();
  const folders = findManifestRoots(archiveDir, 2);

  if (zips.length > 0 && folders.length > 0) {
    throw new UserError(
      'The "archive" folder contains both zip files and an extracted archive.',
      'Keep only one of them: either the zip file(s) or the extracted folder.'
    );
  }
  if (zips.length > 0) return extractZips(zips);
  if (folders.length === 0) throw new UserError('No Twitter archive found in the "archive" folder.', COPY_HINT);
  if (folders.length > 1) {
    throw new UserError('More than one extracted archive found in the "archive" folder.', 'Keep only one archive in the "archive" folder.');
  }
  return { root: folders[0], cleanup: async () => {} };
}

module.exports = { locateArchive };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, including all 9 tests of `locate.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/archive/locate.js test/locate.test.js
git commit -m "feat: locate the archive as zip, split zips or extracted folder"
```

---

### Task 4: Inclusion rules and long posts

**Files:**
- Create: `src/pipeline/text.js`, `src/pipeline/filter.js`, `src/pipeline/notes.js`
- Test: `test/filter.test.js`, `test/notes.test.js`

**Interfaces:**
- Consumes: raw tweet objects (`archive.tweets[i]`), `archive.user`, `archive.noteTweets`.
- Produces:
  - `decodeEntities(text: string): string`
  - `shouldInclude(tweet, user: { accountId }, options: { includeRetweets: boolean, includeReplies: boolean }): { include: true } | { include: false, reason: 'retweet' | 'reply' }`
  - `buildNoteIndex(noteTweets: object[]): Map<number, Note[]>` with `Note = { text: string, urls: Array<{ url, expanded_url, display_url }> }`
  - `findNote(tweet, index): Note | null`

- [ ] **Step 1: Write the failing tests** — `test/filter.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldInclude } = require('../src/pipeline/filter');
const { decodeEntities } = require('../src/pipeline/text');

const user = { accountId: '1000' };
const off = { includeRetweets: false, includeReplies: false };
const on = { includeRetweets: true, includeReplies: true };

const original = { id_str: '1', full_text: 'hello' };
const retweet = { id_str: '2', full_text: 'RT @other: text' };
const flaggedRetweet = { id_str: '3', full_text: 'text', retweeted: true };
const replyToOther = { id_str: '4', full_text: '@other hi', in_reply_to_status_id_str: '9', in_reply_to_user_id_str: '2000' };
const replyToDeletedUser = { id_str: '5', full_text: 'hi', in_reply_to_status_id: '9' };
const selfReply = { id_str: '6', full_text: 'part 2', in_reply_to_status_id_str: '1', in_reply_to_user_id_str: '1000' };
const oldStyleMention = { id_str: '7', full_text: '@other hello' };

test('original tweets, self replies and old-style mentions are always included', () => {
  for (const t of [original, selfReply, oldStyleMention]) {
    assert.deepEqual(shouldInclude(t, user, off), { include: true });
  }
});

test('retweets are excluded by default and included with the option', () => {
  assert.deepEqual(shouldInclude(retweet, user, off), { include: false, reason: 'retweet' });
  assert.deepEqual(shouldInclude(flaggedRetweet, user, off), { include: false, reason: 'retweet' });
  assert.deepEqual(shouldInclude(retweet, user, on), { include: true });
});

test('replies to others are excluded by default and included with the option', () => {
  assert.deepEqual(shouldInclude(replyToOther, user, off), { include: false, reason: 'reply' });
  assert.deepEqual(shouldInclude(replyToDeletedUser, user, off), { include: false, reason: 'reply' });
  assert.deepEqual(shouldInclude(replyToOther, user, on), { include: true });
});

test('decodeEntities decodes the entities Twitter uses in full_text', () => {
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&apos;'), 'a & b <c> "d" \'e\'');
});
```

- [ ] **Step 2: Write the failing tests** — `test/notes.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNoteIndex, findNote } = require('../src/pipeline/notes');

const note = {
  noteTweetId: '5000',
  createdAt: '2021-03-01T12:00:00.000Z',
  core: {
    text: 'This is a long post that gets truncated in the tweet but here it is complete',
    urls: [{ shortUrl: 'https://t.co/n1', expandedUrl: 'https://example.org/full', displayUrl: 'example.org/full' }],
  },
};

test('findNote matches a tweet by creation second and text prefix', () => {
  const index = buildNoteIndex([note]);
  const tweet = { created_at: 'Mon Mar 01 12:00:00 +0000 2021', full_text: 'This is a long post that gets truncated… https://t.co/long1' };
  assert.deepEqual(findNote(tweet, index), {
    text: note.core.text,
    urls: [{ url: 'https://t.co/n1', expanded_url: 'https://example.org/full', display_url: 'example.org/full' }],
  });
});

test('findNote returns null for a different second or a different text', () => {
  const index = buildNoteIndex([note]);
  assert.equal(findNote({ created_at: 'Mon Mar 01 12:00:01 +0000 2021', full_text: 'This is a long post' }, index), null);
  assert.equal(findNote({ created_at: 'Mon Mar 01 12:00:00 +0000 2021', full_text: 'Something else entirely' }, index), null);
});

test('findNote handles an empty index and invalid dates', () => {
  assert.equal(findNote({ created_at: 'Mon Mar 01 12:00:00 +0000 2021', full_text: 'x' }, buildNoteIndex([])), null);
  assert.equal(findNote({ created_at: 'not a date', full_text: 'x' }, buildNoteIndex([note])), null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '../src/pipeline/filter'` and `'../src/pipeline/notes'`.

- [ ] **Step 4: Create `src/pipeline/text.js`**

```js
'use strict';

/** Decode the HTML entities Twitter uses in tweet text. */
function decodeEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

module.exports = { decodeEntities };
```

- [ ] **Step 5: Create `src/pipeline/filter.js`**

```js
'use strict';

function isRetweet(tweet) {
  return tweet.retweeted === true || (tweet.full_text || '').startsWith('RT @');
}

function replyIds(tweet) {
  return {
    statusId: tweet.in_reply_to_status_id_str || tweet.in_reply_to_status_id || null,
    userId: tweet.in_reply_to_user_id_str || tweet.in_reply_to_user_id || null,
  };
}

/** Decide whether a raw tweet is published. Own tweets and thread self-replies are always kept. */
function shouldInclude(tweet, user, options) {
  if (isRetweet(tweet)) {
    return options.includeRetweets ? { include: true } : { include: false, reason: 'retweet' };
  }
  const { statusId, userId } = replyIds(tweet);
  if (statusId && String(userId) !== String(user.accountId)) {
    return options.includeReplies ? { include: true } : { include: false, reason: 'reply' };
  }
  return { include: true };
}

module.exports = { shouldInclude, replyIds };
```

- [ ] **Step 6: Create `src/pipeline/notes.js`**

```js
'use strict';

const { decodeEntities } = require('./text');

function secondKey(dateStr) {
  const ms = Date.parse(dateStr);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

function normalize(text) {
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

/** The visible start of a truncated tweet: text before the ellipsis or the t.co link. */
function prefixOf(text) {
  return normalize(text).split('…')[0].split('https://t.co/')[0].trim().slice(0, 30);
}

function buildNoteIndex(noteTweets) {
  const index = new Map();
  for (const n of noteTweets) {
    const key = secondKey(n.createdAt);
    if (key === null || !n.core) continue;
    const urls = (n.core.urls || []).map((u) => ({
      url: u.shortUrl || u.url || '',
      expanded_url: u.expandedUrl || u.expanded_url || '',
      display_url: u.displayUrl || u.display_url || '',
    }));
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ text: n.core.text || '', urls });
  }
  return index;
}

/** The long-post version of a tweet, if the archive has one. */
function findNote(tweet, index) {
  const key = secondKey(tweet.created_at);
  const candidates = key === null ? null : index.get(key);
  if (!candidates) return null;
  const prefix = prefixOf(tweet.full_text || '');
  if (!prefix) return candidates.length === 1 ? candidates[0] : null;
  return candidates.find((n) => normalize(n.text).startsWith(prefix)) || null;
}

module.exports = { buildNoteIndex, findNote };
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/pipeline/text.js src/pipeline/filter.js src/pipeline/notes.js test/filter.test.js test/notes.test.js
git commit -m "feat: add inclusion rules and long post matching"
```

---

### Task 5: Transform raw tweets into public tweets

**Files:**
- Create: `src/pipeline/transform.js`
- Test: `test/transform.test.js`

**Interfaces:**
- Consumes: `decodeEntities` (Task 4), `replyIds` from `src/pipeline/filter.js` (Task 4), `Note` from `findNote` (Task 4).
- Produces: `toPublicTweet(tweet, ctx): PublicTweet` where
  `ctx = { user: { accountId }, options: { includeReplies: boolean }, hasLocalMedia: (fileName: string) => boolean, note: Note | null }` and
  `PublicTweet = { id, created_at, text, urls, mentions, hashtags, media, in_reply_to_status_id, in_reply_to_screen_name, retweet_count, favorite_count, lang }`,
  `media[i] = { type, url, local: string | null, video_url?: string }` with `local` like `tweets_media/<id>-<file>`.

- [ ] **Step 1: Write the failing tests** — `test/transform.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toPublicTweet } = require('../src/pipeline/transform');
const { readArchive } = require('../src/archive/read');
const { createFixtureArchive } = require('./helpers/fixture');

const archive = readArchive(createFixtureArchive());
const byId = (id) => archive.tweets.find((t) => t.id_str === id);
const ctx = (overrides = {}) => ({
  user: archive.user,
  options: { includeReplies: false },
  hasLocalMedia: (name) => ['101-photoA.jpg', '101-diagram.png', '107-clipB.mp4'].includes(name),
  note: null,
  ...overrides,
});

const PUBLIC_FIELDS = [
  'id', 'created_at', 'text', 'urls', 'mentions', 'hashtags', 'media',
  'in_reply_to_status_id', 'in_reply_to_screen_name', 'retweet_count', 'favorite_count', 'lang',
];

test('output has exactly the allowlisted fields', () => {
  const out = toPublicTweet(byId('101'), ctx());
  assert.deepEqual(Object.keys(out), PUBLIC_FIELDS);
});

test('location, device and edit data are dropped', () => {
  const json = JSON.stringify(archive.tweets.map((t) => toPublicTweet(t, ctx())));
  assert.doesNotMatch(json, /Milano/);
  assert.doesNotMatch(json, /Android/);
  assert.doesNotMatch(json, /45\.1/);
  assert.doesNotMatch(json, /editableUntil/);
});

test('maps text, date, urls, hashtags, counters and photos', () => {
  const out = toPublicTweet(byId('101'), ctx());
  assert.equal(out.id, '101');
  assert.equal(out.created_at, '2020-01-02T10:00:00Z');
  assert.equal(out.text, 'Hello world & friends #test https://t.co/abc123 https://t.co/media1');
  assert.deepEqual(out.urls, [{ url: 'https://t.co/abc123', expanded_url: 'https://example.org/page', display_url: 'example.org/page' }]);
  assert.deepEqual(out.hashtags, ['test']);
  assert.equal(out.retweet_count, 1);
  assert.equal(out.favorite_count, 3);
  assert.equal(out.lang, 'it');
  assert.deepEqual(out.media, [
    { type: 'photo', url: 'https://pbs.twimg.com/media/photoA.jpg', local: 'tweets_media/101-photoA.jpg' },
    { type: 'photo', url: 'https://pbs.twimg.com/media/diagram.png', local: 'tweets_media/101-diagram.png' },
  ]);
});

test('missing media files give local: null', () => {
  assert.equal(toPublicTweet(byId('106'), ctx()).media[0].local, null);
});

test('videos use the best mp4 variant for both local file and video_url', () => {
  const [video] = toPublicTweet(byId('107'), ctx()).media;
  assert.equal(video.type, 'video');
  assert.equal(video.local, 'tweets_media/107-clipB.mp4');
  assert.equal(video.video_url, 'https://video.twimg.com/ext_tw_video/107/pu/vid/640x360/clipB.mp4?tag=12');
});

test('self replies keep the parent id; replies to others keep nothing unless enabled', () => {
  const self = toPublicTweet(byId('104'), ctx());
  assert.equal(self.in_reply_to_status_id, '101');
  assert.equal(self.in_reply_to_screen_name, null);

  const other = toPublicTweet(byId('103'), ctx());
  assert.equal(other.in_reply_to_status_id, null);
  assert.equal(other.in_reply_to_screen_name, null);

  const otherEnabled = toPublicTweet(byId('103'), ctx({ options: { includeReplies: true } }));
  assert.equal(otherEnabled.in_reply_to_screen_name, 'other');
  assert.deepEqual(otherEnabled.mentions, [{ name: 'Other Person', screen_name: 'other' }]);
});

test('a matching long post replaces the text and adds its urls', () => {
  const note = { text: 'Full long text https://t.co/n1', urls: [{ url: 'https://t.co/n1', expanded_url: 'https://example.org/full', display_url: 'example.org/full' }] };
  const out = toPublicTweet(byId('105'), ctx({ note }));
  assert.equal(out.text, 'Full long text https://t.co/n1');
  assert.ok(out.urls.some((u) => u.expanded_url === 'https://example.org/full'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '../src/pipeline/transform'`.

- [ ] **Step 3: Create `src/pipeline/transform.js`**

```js
'use strict';

const { decodeEntities } = require('./text');
const { replyIds } = require('./filter');

function toIso(dateStr) {
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().replace('.000Z', 'Z');
}

function fileNameFromUrl(url) {
  return (url || '').split('?')[0].split('/').pop() || '';
}

function bestMp4(media) {
  const variants = (media.video_info && media.video_info.variants) || [];
  const mp4s = variants.filter((v) => v.content_type === 'video/mp4');
  if (mp4s.length === 0) return null;
  return mp4s.reduce((a, b) => (Number(a.bitrate || 0) >= Number(b.bitrate || 0) ? a : b));
}

function publicMedia(tweetId, media, hasLocalMedia) {
  const type = media.type || 'photo';
  const url = media.media_url_https || media.media_url || '';
  const entry = { type, url, local: null };
  let fileName = fileNameFromUrl(url);
  if (type === 'video' || type === 'animated_gif') {
    const best = bestMp4(media);
    fileName = best ? fileNameFromUrl(best.url) : '';
    if (best) entry.video_url = best.url;
  }
  const localName = `${tweetId}-${fileName}`;
  if (fileName && hasLocalMedia(localName)) entry.local = `tweets_media/${localName}`;
  return entry;
}

function publicUrls(urls) {
  return (urls || []).map((u) => ({
    url: u.url || '',
    expanded_url: u.expanded_url || '',
    display_url: u.display_url || '',
  }));
}

/** Build the public version of a tweet. Only the fields listed here ever reach the site. */
function toPublicTweet(tweet, { user, options, hasLocalMedia, note }) {
  const id = String(tweet.id_str || tweet.id || '');
  const entities = tweet.entities || {};
  const mediaItems = (tweet.extended_entities && tweet.extended_entities.media) || entities.media || [];
  const { statusId, userId } = replyIds(tweet);
  const isSelfReply = Boolean(statusId) && String(userId) === String(user.accountId);
  const isReplyToOther = Boolean(statusId) && !isSelfReply;

  return {
    id,
    created_at: toIso(tweet.created_at),
    text: decodeEntities(note ? note.text : tweet.full_text),
    urls: publicUrls(entities.urls).concat(note ? publicUrls(note.urls) : []),
    mentions: (entities.user_mentions || []).map((m) => ({ name: m.name || '', screen_name: m.screen_name || '' })),
    hashtags: (entities.hashtags || []).map((h) => h.text || ''),
    media: mediaItems.map((m) => publicMedia(id, m, hasLocalMedia)),
    in_reply_to_status_id: isSelfReply ? String(statusId) : null,
    in_reply_to_screen_name: isReplyToOther && options.includeReplies ? tweet.in_reply_to_screen_name || null : null,
    retweet_count: parseInt(tweet.retweet_count || 0, 10) || 0,
    favorite_count: parseInt(tweet.favorite_count || 0, 10) || 0,
    lang: tweet.lang || '',
  };
}

module.exports = { toPublicTweet };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/transform.js test/transform.test.js
git commit -m "feat: transform raw tweets into public tweets with allowlisted fields"
```

---

### Task 6: Strip image metadata and copy media

**Files:**
- Create: `src/pipeline/strip.js`, `src/pipeline/media.js`
- Test: `test/strip.test.js`, `test/media.test.js`

**Interfaces:**
- Consumes: `PublicTweet[]` (Task 5), `Archive` (Task 2).
- Produces:
  - `stripMetadata(buf: Buffer): Buffer` — cleaned JPEG/PNG, or `buf` unchanged when not recognized
  - `listMediaFiles(mediaDir: string): Set<string>`
  - `copyTweetMedia(tweets: PublicTweet[], mediaDir: string, siteDir: string): { count: number, bytes: number, warnings: string[] }`
  - `copyProfileImages(archive: Archive, siteDir: string): { avatar: string | null, header: string | null }` — site-relative paths like `assets/images/avatar.jpg`
  - Constants `MAX_FILE_BYTES = 100 * 1024 * 1024`, `MAX_TOTAL_BYTES = 1024 * 1024 * 1024`

- [ ] **Step 1: Write the failing tests** — `test/strip.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stripMetadata } = require('../src/pipeline/strip');
const { makeJpeg, makePng } = require('./helpers/fixture');

const hasMarker = (buf, a, b) => {
  for (let i = 0; i < buf.length - 1; i++) if (buf[i] === a && buf[i + 1] === b) return true;
  return false;
};

test('JPEG: removes EXIF (APP1) and comments, keeps the rest', () => {
  const out = stripMetadata(makeJpeg());
  assert.ok(!hasMarker(out, 0xff, 0xe1), 'APP1 still present');
  assert.ok(!hasMarker(out, 0xff, 0xfe), 'COM still present');
  assert.ok(!out.toString('latin1').includes('GPSDATA'));
  assert.ok(out.toString('latin1').includes('JFIF'));
  assert.ok(out.toString('latin1').includes('SCANDATA'));
  assert.deepEqual([...out.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...out.subarray(-2)], [0xff, 0xd9]);
});

test('PNG: removes text chunks, keeps image chunks', () => {
  const out = stripMetadata(makePng()).toString('latin1');
  assert.ok(!out.includes('tEXt'));
  assert.ok(!out.includes('secret text'));
  assert.ok(out.includes('IHDR') && out.includes('IDAT') && out.includes('IEND'));
});

test('unrecognized or truncated data is returned unchanged', () => {
  const mp4 = Buffer.from('MP4DATA');
  assert.equal(stripMetadata(mp4), mp4);
  const truncated = makeJpeg().subarray(0, 10);
  assert.equal(stripMetadata(truncated), truncated);
});
```

- [ ] **Step 2: Write the failing tests** — `test/media.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { copyTweetMedia, copyProfileImages, listMediaFiles } = require('../src/pipeline/media');
const { readArchive } = require('../src/archive/read');
const { createFixtureArchive, makeTmpDir } = require('./helpers/fixture');

const tweets = [
  { id: '101', media: [{ local: 'tweets_media/101-photoA.jpg' }, { local: 'tweets_media/101-diagram.png' }] },
  { id: '106', media: [{ local: null }] },
  { id: '107', media: [{ local: 'tweets_media/107-clipB.mp4' }] },
];

test('listMediaFiles lists the media folder (empty set if missing)', () => {
  const archive = readArchive(createFixtureArchive());
  assert.ok(listMediaFiles(archive.mediaDir).has('101-photoA.jpg'));
  assert.equal(listMediaFiles(path.join(archive.mediaDir, 'nope')).size, 0);
});

test('copies only referenced media, stripping image metadata', () => {
  const archive = readArchive(createFixtureArchive());
  const site = makeTmpDir('site');
  const result = copyTweetMedia(tweets, archive.mediaDir, site);
  const copied = fs.readdirSync(path.join(site, 'tweets_media')).sort();
  assert.deepEqual(copied, ['101-diagram.png', '101-photoA.jpg', '107-clipB.mp4']);
  assert.equal(result.count, 3);
  assert.ok(result.bytes > 0);
  assert.deepEqual(result.warnings, []);
  const jpg = fs.readFileSync(path.join(site, 'tweets_media', '101-photoA.jpg')).toString('latin1');
  assert.ok(!jpg.includes('GPSDATA'));
  assert.equal(fs.readFileSync(path.join(site, 'tweets_media', '107-clipB.mp4'), 'utf8'), 'MP4DATA');
});

test('warns about files over 100 MB', () => {
  const archive = readArchive(createFixtureArchive());
  const site = makeTmpDir('site');
  const big = path.join(archive.mediaDir, '107-clipB.mp4');
  fs.truncateSync(big, 101 * 1024 * 1024);
  const result = copyTweetMedia(tweets, archive.mediaDir, site);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /107-clipB\.mp4/);
  assert.match(result.warnings[0], /100 MB/);
});

test('copies avatar and header with fixed names and no metadata', () => {
  const archive = readArchive(createFixtureArchive());
  const site = makeTmpDir('site');
  const images = copyProfileImages(archive, site);
  assert.deepEqual(images, { avatar: 'assets/images/avatar.jpg', header: 'assets/images/header.jpg' });
  const avatar = fs.readFileSync(path.join(site, 'assets', 'images', 'avatar.jpg')).toString('latin1');
  assert.ok(!avatar.includes('GPSDATA'));
  assert.ok(fs.existsSync(path.join(site, 'assets', 'images', 'header.jpg')));
});

test('profile images are null when not in the archive', () => {
  const archive = { ...readArchive(createFixtureArchive()), profileMediaFiles: [] };
  assert.deepEqual(copyProfileImages(archive, makeTmpDir('site')), { avatar: null, header: null });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '../src/pipeline/strip'` and `'../src/pipeline/media'`.

- [ ] **Step 4: Create `src/pipeline/strip.js`**

```js
'use strict';

// JPEG segments removed: APP1 (EXIF, XMP), APP13 (IPTC), COM (comments).
const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]);
// PNG chunks removed: EXIF, text metadata, modification time.
const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function stripJpeg(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const parts = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte
    if (marker === 0xda || marker === 0xd9) {
      // Start of scan (or end of image): the rest is image data, copied verbatim.
      parts.push(buf.subarray(i));
      return Buffer.concat(parts);
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      parts.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > buf.length) return null;
    if (!JPEG_DROP.has(marker)) parts.push(buf.subarray(i, i + 2 + length));
    i += 2 + length;
  }
  return null;
}

function stripPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const parts = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const length = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const end = i + 12 + length;
    if (end > buf.length) return null;
    if (!PNG_DROP.has(type)) parts.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') return Buffer.concat(parts);
  }
  return null;
}

/** Remove metadata (EXIF, GPS, comments) from JPEG/PNG. Anything else is returned unchanged. */
function stripMetadata(buf) {
  return stripJpeg(buf) || stripPng(buf) || buf;
}

module.exports = { stripMetadata };
```

- [ ] **Step 5: Create `src/pipeline/media.js`**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { stripMetadata } = require('./strip');

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png']);

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function listMediaFiles(mediaDir) {
  return new Set(fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : []);
}

/** Copy one file, removing image metadata. Returns the number of bytes written. */
function copyClean(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (IMAGE_EXT.has(path.extname(src).toLowerCase())) {
    const cleaned = stripMetadata(fs.readFileSync(src));
    fs.writeFileSync(dest, cleaned);
    return cleaned.length;
  }
  fs.copyFileSync(src, dest);
  return fs.statSync(dest).size;
}

function copyTweetMedia(tweets, mediaDir, siteDir) {
  const needed = new Set();
  for (const t of tweets) for (const m of t.media || []) if (m.local) needed.add(path.basename(m.local));

  const warnings = [];
  let count = 0;
  let bytes = 0;
  for (const name of needed) {
    const src = path.join(mediaDir, name);
    if (!fs.existsSync(src)) continue;
    const size = copyClean(src, path.join(siteDir, 'tweets_media', name));
    if (size > MAX_FILE_BYTES) {
      warnings.push(`Large file (${mb(size)}): tweets_media/${name} — GitHub Pages rejects files over 100 MB.`);
    }
    count += 1;
    bytes += size;
  }
  if (bytes > MAX_TOTAL_BYTES) {
    warnings.push(`Media total is ${mb(bytes)} — GitHub Pages sites should stay under 1 GB.`);
  }
  return { count, bytes, warnings };
}

/** Last path segment of a URL without extension, e.g. ".../profile_images/1/abc.jpg" → "abc". */
function mediaKey(url) {
  const last = (url || '').split('?')[0].split('/').pop() || '';
  return last.replace(/\.[^.]+$/, '');
}

function copyProfileImage(archive, url, baseName, siteDir) {
  const key = mediaKey(url);
  if (!key) return null;
  const file = archive.profileMediaFiles.find((f) => f.replace(/\.[^.]+$/, '').endsWith(`-${key}`));
  if (!file) return null;
  const rel = `assets/images/${baseName}${path.extname(file).toLowerCase()}`;
  copyClean(path.join(archive.profileMediaDir, file), path.join(siteDir, rel));
  return rel;
}

function copyProfileImages(archive, siteDir) {
  return {
    avatar: copyProfileImage(archive, archive.profile.avatarMediaUrl, 'avatar', siteDir),
    header: copyProfileImage(archive, archive.profile.headerMediaUrl, 'header', siteDir),
  };
}

module.exports = { listMediaFiles, copyTweetMedia, copyProfileImages, MAX_FILE_BYTES, MAX_TOTAL_BYTES };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/pipeline/strip.js src/pipeline/media.js test/strip.test.js test/media.test.js
git commit -m "feat: copy published media and strip image metadata"
```

---

### Task 7: Privacy guard

**Files:**
- Create: `src/privacy/guard.js`
- Test: `test/guard.test.js`

**Interfaces:**
- Consumes: `readManifest` (Task 2), `parseYtd` (Task 1), `UserError`.
- Produces:
  - `collectSensitive(root: string): Array<{ kind: 'email' | 'phone' | 'ip', value: string }>`
  - `scanSite(siteDir: string, sensitive): Array<{ kind: string, file: string }>` — `file` relative to `siteDir`, forward slashes
  - `guardSite(siteDir: string, sensitive): void` — on findings deletes `siteDir` and throws `UserError` (message names kind + file, never the value)

- [ ] **Step 1: Write the failing tests** — `test/guard.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { collectSensitive, scanSite, guardSite } = require('../src/privacy/guard');
const { UserError } = require('../src/errors');
const { createFixtureArchive, makeTmpDir, SENSITIVE } = require('./helpers/fixture');

function siteWith(files) {
  const dir = makeTmpDir('site');
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

test('collects email, phone (also digits only) and IPs', () => {
  const values = collectSensitive(createFixtureArchive());
  const has = (kind, value) => values.some((v) => v.kind === kind && v.value === value);
  assert.ok(has('email', SENSITIVE.email));
  assert.ok(has('phone', SENSITIVE.phone));
  assert.ok(has('phone', '393331234567'));
  assert.ok(has('ip', SENSITIVE.creationIp));
  assert.ok(has('ip', SENSITIVE.loginIp));
});

test('skips sensitive files that are missing', () => {
  const root = createFixtureArchive();
  fs.rmSync(path.join(root, 'data', 'phone-number.js'));
  fs.rmSync(path.join(root, 'data', 'ip-audit.js'));
  const kinds = collectSensitive(root).map((v) => v.kind);
  assert.ok(!kinds.includes('phone'));
  assert.ok(kinds.includes('email'));
});

test('scanSite finds values case-insensitively in text files only', () => {
  const sensitive = collectSensitive(createFixtureArchive());
  const site = siteWith({
    'index.html': '<p>clean</p>',
    'data/tweets-2020.js': `window.X = "${SENSITIVE.email.toUpperCase()}"`,
    'tweets_media/a.jpg': SENSITIVE.email,
  });
  assert.deepEqual(scanSite(site, sensitive), [{ kind: 'email', file: 'data/tweets-2020.js' }]);
});

test('IP and phone matches respect number boundaries', () => {
  const sensitive = [{ kind: 'ip', value: '1.2.3.4' }];
  assert.deepEqual(scanSite(siteWith({ 'a.js': 'version 11.2.3.45' }), sensitive), []);
  assert.equal(scanSite(siteWith({ 'a.js': 'ip 1.2.3.4.' }), sensitive).length, 1);
});

test('guardSite deletes the site and throws without revealing the value', () => {
  const sensitive = collectSensitive(createFixtureArchive());
  const site = siteWith({ 'data/manifest.js': `phone: ${SENSITIVE.phone}` });
  assert.throws(() => guardSite(site, sensitive), (err) => {
    assert.ok(err instanceof UserError);
    assert.match(err.message, /phone/);
    assert.match(err.message, /data\/manifest\.js/);
    assert.ok(!err.message.includes(SENSITIVE.phone));
    assert.ok(!err.message.includes('393331234567'));
    assert.ok(!err.hint.includes('393331234567'));
    return true;
  });
  assert.ok(!fs.existsSync(site));
});

test('guardSite passes on a clean site', () => {
  const site = siteWith({ 'index.html': '<p>ok</p>' });
  guardSite(site, collectSensitive(createFixtureArchive()));
  assert.ok(fs.existsSync(site));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '../src/privacy/guard'`.

- [ ] **Step 3: Create `src/privacy/guard.js`**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const { readManifest } = require('../archive/read');
const { parseYtd } = require('../archive/parse');
const { UserError } = require('../errors');

/**
 * Data types read ONLY to know what must never appear in the site.
 * The values stay inside this module: they are not returned to the pipeline or logged.
 */
const SENSITIVE_TYPES = {
  account: 'email',
  phoneNumber: 'phone',
  accountCreationIp: 'ip',
  ipAudit: 'ip',
};
const KEY_PATTERN = { email: /email/i, phone: /phone/i, ip: /ip$/i };
const TEXT_EXT = new Set(['.html', '.js', '.css', '.json', '.txt']);

function stringLeaves(value, key, out) {
  if (typeof value === 'string') out.push([key, value]);
  else if (Array.isArray(value)) value.forEach((v) => stringLeaves(v, key, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) stringLeaves(v, k, out);
  }
  return out;
}

function collectSensitive(root) {
  const manifest = readManifest(root);
  const found = new Map();
  const add = (kind, value) => { if (value.length >= 5) found.set(`${kind}:${value}`, { kind, value }); };

  for (const [type, kind] of Object.entries(SENSITIVE_TYPES)) {
    const dataType = manifest.dataTypes && manifest.dataTypes[type];
    for (const file of (dataType && dataType.files) || []) {
      const full = path.join(root, file.fileName);
      if (!fs.existsSync(full)) continue;
      const entries = parseYtd(fs.readFileSync(full, 'utf8'), file.fileName);
      for (const [key, value] of stringLeaves(entries, '', [])) {
        if (!KEY_PATTERN[kind].test(key)) continue;
        add(kind, value.trim());
        if (kind === 'phone') add(kind, value.replace(/\D/g, ''));
      }
    }
  }
  return [...found.values()];
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matcher({ kind, value }) {
  const body = escapeRegExp(value);
  // Numbers must not be part of a longer number (e.g. an IP inside a version string).
  const source = kind === 'email' ? body : `(?<![\\d.])${body}(?![\\d]|\\.\\d)`;
  return new RegExp(source, 'i');
}

function textFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...textFiles(full, base));
    else if (TEXT_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

function scanSite(siteDir, sensitive) {
  const matchers = sensitive.map((s) => ({ kind: s.kind, re: matcher(s) }));
  const findings = [];
  for (const file of textFiles(siteDir)) {
    const content = fs.readFileSync(file, 'utf8');
    const kinds = new Set(matchers.filter((m) => m.re.test(content)).map((m) => m.kind));
    const rel = path.relative(siteDir, file).split(path.sep).join('/');
    for (const kind of kinds) findings.push({ kind, file: rel });
  }
  return findings;
}

function guardSite(siteDir, sensitive) {
  const findings = scanSite(siteDir, sensitive);
  if (findings.length === 0) return;
  fs.rmSync(siteDir, { recursive: true, force: true });
  const list = findings.map((f) => `your ${f.kind} in ${f.file}`).join(', ');
  throw new UserError(
    `Privacy check failed: found ${list}. The site folder was deleted.`,
    'If this data appears in one of your own tweets, that tweet cannot be published by this tool yet. ' +
      'Otherwise please report the problem (without sharing your data).'
  );
}

module.exports = { collectSensitive, scanSite, guardSite };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/privacy/guard.js test/guard.test.js
git commit -m "feat: block the build when private owner data reaches the site"
```

---

### Task 8: Generic site template and i18n

**Files:**
- Create: `template/index.html`, `template/i18n/it.json`, `template/i18n/en.json`
- Create (copy from `docs/`): `template/assets/css/style.css`, `template/assets/js/app.js`, `template/assets/images/defaultAvatar.svg`, `template/assets/images/favicon.ico`
- Modify: `template/assets/js/app.js`, `template/assets/css/style.css:2`
- Test: `test/template.test.js`

**Interfaces:**
- Produces (used by Task 9):
  - `template/index.html` placeholders: `{{lang}}`, `{{title}}`, `{{description}}`, `{{displayName}}`, `{{username}}`, `{{footerArchive}}`, `{{footerExported}}`, `{{t.<key>}}` for any i18n key, and the raw placeholder `{{{robotsMeta}}}`.
  - i18n JSON keys (both files, identical key set): `locale, metaDescription, tweetsLabel, navTitle, loading, loadingArchive, loadingAllYears, allYears, searching, searchPlaceholder, clearSearch, noResults, noResultsFor, noTweets, resultsOne, resultsMany, countAll, countYear, loadMore, retweetOf, threadReply, replyTo, photoAlt, imageUnavailable, videoUnavailable, videoNotLocal, retweets, likes, memberSince, menu, footerArchive, footerExported, loadError`. Parameters are written `{name}`.
  - Frontend reads `window.ARCHIVE_I18N` (from `assets/js/i18n.js`, generated in Task 9) and `window.ARCHIVE_MANIFEST` with `profile.avatarLocal`, `profile.headerLocal`.

- [ ] **Step 1: Copy the frontend files**

```bash
mkdir -p template/assets/css template/assets/js template/assets/images template/i18n
cp docs/assets/css/style.css template/assets/css/style.css
cp docs/assets/js/app.js template/assets/js/app.js
cp docs/assets/images/defaultAvatar.svg docs/assets/images/favicon.ico template/assets/images/
```

(`docs/` stays untouched: it still serves the live site until Task 12.)

- [ ] **Step 2: Write the failing tests** — `test/template.test.js`

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `ENOENT` on `template/i18n/it.json`.

- [ ] **Step 4: Create `template/i18n/it.json`**

```json
{
  "locale": "it-IT",
  "metaDescription": "Archivio pubblico dei tweet di @{user}",
  "tweetsLabel": "Tweet",
  "navTitle": "Naviga per anno",
  "loading": "Caricamento…",
  "loadingArchive": "Caricamento archivio…",
  "loadingAllYears": "Caricamento tutti gli anni…",
  "allYears": "Tutti gli anni",
  "searching": "Ricerca in corso…",
  "searchPlaceholder": "Cerca nei tweet…",
  "clearSearch": "Cancella ricerca",
  "noResults": "Nessun risultato trovato.",
  "noResultsFor": "Nessun tweet trovato per \"{q}\"",
  "noTweets": "Nessun tweet disponibile.",
  "resultsOne": "{n} risultato per \"{q}\"",
  "resultsMany": "{n} risultati per \"{q}\"",
  "countAll": "{n} tweet in tutti gli anni",
  "countYear": "{n} tweet nel {year}",
  "loadMore": "Carica altri tweet",
  "retweetOf": "Retweet di @{user}",
  "threadReply": "🧵 Risposta nel thread",
  "replyTo": "In risposta a @{user}",
  "photoAlt": "Foto del tweet",
  "imageUnavailable": "🖼️ Immagine non disponibile",
  "videoUnavailable": "🎬 Video non disponibile",
  "videoNotLocal": "🎬 Video (non disponibile localmente)",
  "retweets": "Retweet",
  "likes": "Like",
  "memberSince": "📅 Membro dal {date}",
  "menu": "Menu",
  "footerArchive": "Archivio Twitter di @{user}",
  "footerExported": "Esportato: {date}",
  "loadError": "Errore nel caricamento dell'archivio."
}
```

- [ ] **Step 5: Create `template/i18n/en.json`**

```json
{
  "locale": "en-US",
  "metaDescription": "Public archive of tweets by @{user}",
  "tweetsLabel": "Tweets",
  "navTitle": "Browse by year",
  "loading": "Loading…",
  "loadingArchive": "Loading archive…",
  "loadingAllYears": "Loading all years…",
  "allYears": "All years",
  "searching": "Searching…",
  "searchPlaceholder": "Search tweets…",
  "clearSearch": "Clear search",
  "noResults": "No results found.",
  "noResultsFor": "No tweets found for \"{q}\"",
  "noTweets": "No tweets available.",
  "resultsOne": "{n} result for \"{q}\"",
  "resultsMany": "{n} results for \"{q}\"",
  "countAll": "{n} tweets across all years",
  "countYear": "{n} tweets in {year}",
  "loadMore": "Load more tweets",
  "retweetOf": "Retweet of @{user}",
  "threadReply": "🧵 Thread reply",
  "replyTo": "Replying to @{user}",
  "photoAlt": "Tweet photo",
  "imageUnavailable": "🖼️ Image not available",
  "videoUnavailable": "🎬 Video not available",
  "videoNotLocal": "🎬 Video (not available locally)",
  "retweets": "Retweets",
  "likes": "Likes",
  "memberSince": "📅 Joined {date}",
  "menu": "Menu",
  "footerArchive": "Twitter archive of @{user}",
  "footerExported": "Exported: {date}",
  "loadError": "Could not load the archive."
}
```

- [ ] **Step 6: Create `template/index.html`**

```html
<!doctype html>
<html lang="{{lang}}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{title}}</title>
  <meta name="description" content="{{description}}">
  {{{robotsMeta}}}
  <link rel="icon" href="assets/images/favicon.ico" type="image/x-icon">
  <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>

<div id="app" class="app-layout">

  <!-- ── Sidebar ── -->
  <aside id="sidebar" class="sidebar">

    <div class="profile-card">
      <div class="profile-header-img">
        <img id="profile-header" src="" alt="" class="header-image" style="display:none">
      </div>
      <div class="profile-avatar-wrap">
        <img id="profile-avatar" src="assets/images/defaultAvatar.svg" alt="Avatar" class="profile-avatar">
      </div>
      <div class="profile-info">
        <h1 id="profile-name" class="profile-name">{{displayName}}</h1>
        <p id="profile-username" class="profile-username">@{{username}}</p>
        <p id="profile-bio" class="profile-bio"></p>
        <p id="profile-website" class="profile-website"></p>
        <p id="profile-since" class="profile-since"></p>
        <div id="profile-stats" class="profile-stats">
          <div class="stat">
            <span id="stat-tweets" class="stat-value">—</span>
            <span class="stat-label">{{t.tweetsLabel}}</span>
          </div>
        </div>
      </div>
    </div>

    <nav class="sidebar-nav">
      <div class="nav-section-title">{{t.navTitle}}</div>
      <ul id="year-nav" class="year-nav">
        <li class="nav-loading">{{t.loading}}</li>
      </ul>
    </nav>

    <footer class="sidebar-footer">
      <p>{{footerArchive}}</p>
      <p>{{footerExported}}</p>
    </footer>

  </aside>

  <!-- ── Main column ── -->
  <main id="main" class="main-column">

    <div class="search-bar-wrap">
      <div class="search-bar">
        <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <g><path d="M21.53 20.47l-3.66-3.66C19.195 15.24 20 13.214 20 11c0-4.97-4.03-9-9-9s-9 4.03-9 9 4.03 9 9 9c2.215 0 4.24-.804 5.808-2.13l3.66 3.66c.147.146.34.22.53.22s.385-.073.53-.22c.295-.293.295-.767.002-1.06zM3.5 11c0-4.135 3.365-7.5 7.5-7.5s7.5 3.365 7.5 7.5-3.365 7.5-7.5 7.5-7.5-3.365-7.5-7.5z"/></g>
        </svg>
        <input id="search-input" type="search" placeholder="{{t.searchPlaceholder}}" autocomplete="off" spellcheck="false">
        <button id="search-clear" class="search-clear" aria-label="{{t.clearSearch}}" style="display:none">✕</button>
      </div>
    </div>

    <div id="status-bar" class="status-bar"></div>

    <div id="tweet-list" class="tweet-list">
      <div class="loading-placeholder">
        <div class="spinner"></div>
        <p>{{t.loadingArchive}}</p>
      </div>
    </div>

    <div id="load-more-wrap" style="display:none" class="load-more-wrap">
      <button id="load-more" class="load-more-btn">{{t.loadMore}}</button>
    </div>

    <div id="no-results" class="no-results" style="display:none">
      <svg viewBox="0 0 24 24" aria-hidden="true" class="no-results-icon">
        <g><path d="M21.53 20.47l-3.66-3.66C19.195 15.24 20 13.214 20 11c0-4.97-4.03-9-9-9s-9 4.03-9 9 4.03 9 9 9c2.215 0 4.24-.804 5.808-2.13l3.66 3.66c.147.146.34.22.53.22s.385-.073.53-.22c.295-.293.295-.767.002-1.06zM3.5 11c0-4.135 3.365-7.5 7.5-7.5s7.5 3.365 7.5 7.5-3.365 7.5-7.5 7.5-7.5-3.365-7.5-7.5z"/></g>
      </svg>
      <p id="no-results-msg">{{t.noResults}}</p>
    </div>

  </main>

</div>

<button id="sidebar-toggle" class="sidebar-toggle" aria-label="{{t.menu}}">
  <svg viewBox="0 0 24 24" aria-hidden="true"><g><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></g></svg>
</button>

<script src="assets/js/i18n.js"></script>
<script src="data/manifest.js"></script>
<script src="assets/js/app.js"></script>
</body>
</html>
```

- [ ] **Step 7: Update the stylesheet header** — `template/assets/css/style.css` line 2

Replace:
```css
   twitter-archive.marcomaroni.it — Stylesheet
```
with:
```css
   Twitter Archive Site — Stylesheet
```

- [ ] **Step 8: Generalize `template/assets/js/app.js`** — apply these replacements in order (each `old` block is exact text from the copied file).

8a. Header (lines 1-3). Replace
```js
/* ════════════════════════════════════════════════════════
   twitter-archive.marcomaroni.it — App JavaScript
   ════════════════════════════════════════════════════════ */
```
with
```js
/* ════════════════════════════════════════════════════════
   Twitter Archive Site — App JavaScript
   ════════════════════════════════════════════════════════ */
```

8b. State + helpers. Replace
```js
  USERNAME:      'marcomaroni',
  ACCOUNT_ID:    '15570883',
};
```
with
```js
  USERNAME:      '',
  I18N:          window.ARCHIVE_I18N || {},
  LOCALE:        (window.ARCHIVE_I18N && window.ARCHIVE_I18N.locale) || 'en-US',
};

// ═══════════════════════════════════════════════════════
// I18N HELPERS
// ═══════════════════════════════════════════════════════
function tr(key, params) {
  let s = App.I18N[key] || key;
  for (const [k, v] of Object.entries(params || {})) s = s.split(`{${k}}`).join(String(v));
  return s;
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString(App.LOCALE);
}
```

8c. Init. Replace
```js
    let manifest = window.ARCHIVE_MANIFEST;
    if (!manifest) {
      manifest = await fetchJSON('data/manifest.json');
    }
    App.profile     = manifest.profile;
    App.years       = manifest.years;       // already newest-first from script
    App.tweetCounts = manifest.tweetCounts;
    App.totalTweets = manifest.totalTweets;
    App.USERNAME    = manifest.profile.username || 'marcomaroni';

    renderProfile();
    renderYearNav();
    bindEvents();

    // Load the most recent year by default
    const latestYear = App.years[0];
    await selectYear(latestYear);
```
with
```js
    const manifest = window.ARCHIVE_MANIFEST;
    if (!manifest) throw new Error('data/manifest.js not loaded');
    App.profile     = manifest.profile;
    App.years       = manifest.years;       // already newest-first from the build
    App.tweetCounts = manifest.tweetCounts;
    App.totalTweets = manifest.totalTweets;
    App.USERNAME    = manifest.profile.username || '';

    renderProfile();
    renderYearNav();
    bindEvents();

    if (App.years.length === 0) {
      App.displayTweets = [];
      renderTweetList();
      return;
    }

    // Load the most recent year by default
    await selectYear(App.years[0]);
```

8d. Init error. Replace
```js
        <p style="color:#e0245e">Errore nel caricamento dell'archivio.<br>
        Controlla che i file in <code>docs/data/</code> esistano.</p>
```
with
```js
        <p style="color:#e0245e">${escHtml(tr('loadError'))}</p>
```

8e. Remove `fetchJSON` (no JSON files are generated any more). Replace
```js
// ═══════════════════════════════════════════════════════
// FETCH HELPERS
// ═══════════════════════════════════════════════════════
async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return resp.json();
}

```
with an empty string.

8f. Profile name. Replace
```js
  $('profile-name').textContent     = p.displayName || 'Marco Maroni';
  $('profile-username').textContent = '@' + (p.username || 'marcomaroni');
```
with
```js
  $('profile-name').textContent     = p.displayName || p.username || '';
  $('profile-username').textContent = '@' + (p.username || '');
```

8g. Member since. Replace
```js
    sinceEl.innerHTML = `📅 Membro dal ${formatMonthYear(d)}`;
```
with
```js
    sinceEl.textContent = tr('memberSince', { date: formatMonthYear(d) });
```

8h. Avatar and header. Replace
```js
  const avatarEl = $('profile-avatar');
  if (p.avatarLocal) {
    avatarEl.src = p.avatarLocal;
    avatarEl.onerror = () => {
      avatarEl.src = p.avatarUrl || 'assets/images/defaultAvatar.svg';
      avatarEl.onerror = () => { avatarEl.src = 'assets/images/defaultAvatar.svg'; };
    };
  } else if (p.avatarUrl) {
    avatarEl.src = p.avatarUrl;
    avatarEl.onerror = () => { avatarEl.src = 'assets/images/defaultAvatar.svg'; };
  }

  // Header banner — use local file if available
  const headerEl = $('profile-header');
  // The header image is the one NOT containing 'edpovFA7' (which is the avatar)
  // Local header: assets/images/15570883-1702049469.jpg
  const headerLocal = 'assets/images/15570883-1702049469.jpg';
  headerEl.src = headerLocal;
  headerEl.onerror = () => { headerEl.style.display = 'none'; };


  // Stats
  $('stat-tweets').textContent = App.totalTweets.toLocaleString('it-IT');
```
with
```js
  const avatarEl = $('profile-avatar');
  if (p.avatarLocal) {
    avatarEl.src = p.avatarLocal;
    avatarEl.onerror = () => { avatarEl.src = 'assets/images/defaultAvatar.svg'; };
  }

  // Header banner
  const headerEl = $('profile-header');
  if (p.headerLocal) {
    headerEl.src = p.headerLocal;
    headerEl.style.display = '';
    headerEl.onerror = () => { headerEl.style.display = 'none'; };
  }

  // Stats
  $('stat-tweets').textContent = fmtNum(App.totalTweets);
```

8i. Year nav. Replace
```js
  nav.appendChild(makeYearItem('Tutti gli anni', totalCount, 'all'));
```
with
```js
  nav.appendChild(makeYearItem(tr('allYears'), totalCount, 'all'));
```
and replace
```js
    <span class="year-count">${count.toLocaleString('it-IT')}</span>
```
with
```js
    <span class="year-count">${fmtNum(count)}</span>
```

8j. Status messages. Replace `showStatus('Caricamento…');` with `showStatus(tr('loading'));`, replace `showStatus('Caricamento tutti gli anni…');` with `showStatus(tr('loadingAllYears'));`, and replace `showStatus('Ricerca in corso…');` with `showStatus(tr('searching'));`.

8k. Year loading without JSON fallback. Replace
```js
  // Try loading via script tag first (works seamlessly on file:// without CORS issues)
  try {
    await loadScript(`data/tweets-${key}.js`);
    const tweets = (window.ARCHIVE_TWEETS && window.ARCHIVE_TWEETS[key]) || [];
    App.loadedYears.set(key, tweets);
    return;
  } catch (scriptErr) {
    // Fallback to fetch (for pure HTTP environments if .json exists)
    try {
      const tweets = await fetchJSON(`data/tweets-${key}.json`);
      App.loadedYears.set(key, tweets);
    } catch (err) {
      console.warn(`Could not load tweets for ${key}:`, err);
      App.loadedYears.set(key, []); // empty to avoid retry
    }
  }
```
with
```js
  // Script tags work both on file:// and over HTTP, without CORS issues
  try {
    await loadScript(`data/tweets-${key}.js`);
    const tweets = (window.ARCHIVE_TWEETS && window.ARCHIVE_TWEETS[key]) || [];
    App.loadedYears.set(key, tweets);
  } catch (err) {
    console.warn(`Could not load tweets for ${key}:`, err);
    App.loadedYears.set(key, []); // empty to avoid retry
  }
```

8l. No-results message. Replace
```js
    $('no-results-msg').textContent = App.searchQuery
      ? `Nessun tweet trovato per "${App.searchQuery}"`
      : 'Nessun tweet disponibile.';
```
with
```js
    $('no-results-msg').textContent = App.searchQuery
      ? tr('noResultsFor', { q: App.searchQuery })
      : tr('noTweets');
```

8m. Result counts. Replace
```js
  if (App.searchQuery) {
    showStatus(`${filtered.length.toLocaleString('it-IT')} risultat${filtered.length === 1 ? 'o' : 'i'} per "${App.searchQuery}"`);
  } else {
    const yearLabel = App.currentYear === 'all' ? 'in tutti gli anni' : `nel ${App.currentYear}`;
    showStatus(`${filtered.length.toLocaleString('it-IT')} tweet ${yearLabel}`);
  }
```
with
```js
  const n = fmtNum(filtered.length);
  if (App.searchQuery) {
    showStatus(tr(filtered.length === 1 ? 'resultsOne' : 'resultsMany', { n, q: App.searchQuery }));
  } else if (App.currentYear === 'all') {
    showStatus(tr('countAll', { n }));
  } else {
    showStatus(tr('countYear', { n, year: App.currentYear }));
  }
```

8n. Tweet card: thread and reply detection. Replace
```js
  const isRT         = tweet.text && tweet.text.startsWith('RT @');
  const isSelfReply  = tweet.in_reply_to_screen_name &&
                       tweet.in_reply_to_screen_name.toLowerCase() === App.USERNAME.toLowerCase();
```
with
```js
  const isRT         = tweet.text && tweet.text.startsWith('RT @');
  // The build keeps in_reply_to_status_id only for replies to the owner's own tweets (threads)
  // and in_reply_to_screen_name only for replies to other users.
  const isSelfReply  = Boolean(tweet.in_reply_to_status_id);
  const replyToOther = tweet.in_reply_to_screen_name || null;
```

8o. Tweet card: avatar. Replace
```js
  const avatarSrc = App.profile?.avatarLocal
    ? App.profile.avatarLocal
    : (App.profile?.avatarUrl || 'assets/images/defaultAvatar.svg');
```
with
```js
  const avatarSrc = App.profile?.avatarLocal || 'assets/images/defaultAvatar.svg';
```

8p. Tweet card: labels and name. Replace
```js
            <span>Retweet di @${escHtml(rtAuthor || '')}</span>
          </div>` : ''}
        ${isSelfReply ? `
          <div class="tweet-thread-label">
            🧵 Risposta nel thread
          </div>` : ''}
        <div class="tweet-header">
          <span class="tweet-display-name">${escHtml(App.profile?.displayName || 'Marco Maroni')}</span>
```
with
```js
            <span>${escHtml(tr('retweetOf', { user: rtAuthor || '' }))}</span>
          </div>` : ''}
        ${isSelfReply ? `
          <div class="tweet-thread-label">
            ${escHtml(tr('threadReply'))}
          </div>` : ''}
        ${replyToOther ? `
          <div class="tweet-thread-label">
            ${escHtml(tr('replyTo', { user: replyToOther }))}
          </div>` : ''}
        <div class="tweet-header">
          <span class="tweet-display-name">${escHtml(App.profile?.displayName || App.USERNAME)}</span>
```

8q. Media strings. Replace
```js
      <img src="${escAttr(src)}" alt="Foto del tweet" loading="lazy"
           onerror="this.parentNode.innerHTML='<div class=\'media-fallback-icon\'>🖼️ Immagine non disponibile</div>'">
```
with
```js
      <img src="${escAttr(src)}" alt="${escAttr(tr('photoAlt'))}" loading="lazy"
           onerror="this.parentNode.innerHTML='<div class=\'media-fallback-icon\'>${escAttr(tr('imageUnavailable'))}</div>'">
```
replace
```js
               onerror="this.parentNode.innerHTML='<div class=\'media-fallback-icon\'>🎬 Video non disponibile</div>'">
```
with
```js
               onerror="this.parentNode.innerHTML='<div class=\'media-fallback-icon\'>${escAttr(tr('videoUnavailable'))}</div>'">
```
and replace
```js
      <div class="media-fallback-icon">🎬 Video (non disponibile localmente)</div>
```
with
```js
      <div class="media-fallback-icon">${escHtml(tr('videoNotLocal'))}</div>
```

8r. Stats. Replace
```js
      <span class="tweet-stat tweet-stat-rt${rt > 0 ? ' has-count' : ''}" title="${rt.toLocaleString('it-IT')} Retweet">
        ${svgRetweet()}
        <span class="stat-num">${rt.toLocaleString('it-IT')}</span>
      </span>
      <span class="tweet-stat tweet-stat-fav${fav > 0 ? ' has-count' : ''}" title="${fav.toLocaleString('it-IT')} Like">
        ${svgHeart()}
        <span class="stat-num">${fav.toLocaleString('it-IT')}</span>
      </span>
```
with
```js
      <span class="tweet-stat tweet-stat-rt${rt > 0 ? ' has-count' : ''}" title="${fmtNum(rt)} ${escAttr(tr('retweets'))}">
        ${svgRetweet()}
        <span class="stat-num">${fmtNum(rt)}</span>
      </span>
      <span class="tweet-stat tweet-stat-fav${fav > 0 ? ' has-count' : ''}" title="${fmtNum(fav)} ${escAttr(tr('likes'))}">
        ${svgHeart()}
        <span class="stat-num">${fmtNum(fav)}</span>
      </span>
```

8s. Date helpers. Replace
```js
function formatDateShort(isoStr) {
  if (!isoStr) return '';
  const d   = new Date(isoStr);
  const now = new Date();
  const diffMs  = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH   = Math.floor(diffMs / 3600000);
  const diffD   = Math.floor(diffMs / 86400000);

  // For an archive that's 2+ years old, always show the date
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateFull(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleString('it-IT', {
    weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function formatMonthYear(d) {
  return d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
}
```
with
```js
function formatDateShort(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleDateString(App.LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateFull(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleString(App.LOCALE, {
    weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function formatMonthYear(d) {
  return d.toLocaleDateString(App.LOCALE, { month: 'long', year: 'numeric' });
}
```

8t. Verify no leftovers:

Run: `grep -nE "it-IT|marcomaroni|Marco Maroni|15570883|fetchJSON|Caricamento|Nessun|Retweet di|Membro" template/assets/js/app.js`
Expected: no output.

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, including 5 tests of `template.test.js`.

- [ ] **Step 10: Commit**

```bash
git add template test/template.test.js
git commit -m "feat: add generic site template with it/en translations"
```

---

### Task 9: Write the site

**Files:**
- Create: `src/site/write.js`
- Test: `test/write.test.js`

**Interfaces:**
- Consumes: `template/` (Task 8), `Archive` (Task 2), `PublicTweet[]` (Task 5), images `{ avatar, header }` (Task 6), `Config` (Task 10 shape: `{ lang, title, includeRetweets, includeReplies, noindex, website }`).
- Produces:
  - `prepareSiteDir(siteDir: string): void` — deletes and recreates the folder
  - `renderTemplate(html: string, values: Record<string,string>, rawValues: Record<string,string>): string` — escapes `{{x}}`, inserts `{{{x}}}` raw, throws `Error` on unknown placeholders
  - `writeSite({ siteDir, templateDir, archive, config, tweets, images }): { years: string[], tweetCounts: Record<string, number> }`

- [ ] **Step 1: Write the failing tests** — `test/write.test.js`

```js
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
  return ctx.window[name];
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '../src/site/write'`.

- [ ] **Step 3: Create `src/site/write.js`**

```js
'use strict';

const fs = require('fs');
const path = require('path');

function prepareSiteDir(siteDir) {
  fs.rmSync(siteDir, { recursive: true, force: true });
  fs.mkdirSync(siteDir, { recursive: true });
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fill(str, params) {
  let s = str;
  for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

function renderTemplate(html, values, rawValues) {
  return html
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, key) => {
      if (!(key in rawValues)) throw new Error(`Unknown raw placeholder in template: ${key}`);
      return rawValues[key];
    })
    .replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
      if (!(key in values)) throw new Error(`Unknown placeholder in template: ${key}`);
      return escHtml(values[key]);
    });
}

function loadI18n(templateDir, lang) {
  return JSON.parse(fs.readFileSync(path.join(templateDir, 'i18n', `${lang}.json`), 'utf8'));
}

function formatMonthYear(iso, locale) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(d);
}

function groupByYear(tweets) {
  const byYear = {};
  for (const t of tweets) {
    const year = (t.created_at || '').slice(0, 4) || 'unknown';
    (byYear[year] = byYear[year] || []).push(t);
  }
  for (const list of Object.values(byYear)) list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return byYear;
}

function writeData(siteDir, byYear, manifest) {
  const dataDir = path.join(siteDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  for (const [year, list] of Object.entries(byYear)) {
    fs.writeFileSync(
      path.join(dataDir, `tweets-${year}.js`),
      `window.ARCHIVE_TWEETS = window.ARCHIVE_TWEETS || {};\nwindow.ARCHIVE_TWEETS[${JSON.stringify(year)}] = ${JSON.stringify(list)};\n`
    );
  }
  fs.writeFileSync(path.join(dataDir, 'manifest.js'), `window.ARCHIVE_MANIFEST = ${JSON.stringify(manifest, null, 2)};\n`);
}

function writeSite({ siteDir, templateDir, archive, config, tweets, images }) {
  const i18n = loadI18n(templateDir, config.lang);
  const byYear = groupByYear(tweets);
  const years = Object.keys(byYear).sort().reverse();
  const tweetCounts = Object.fromEntries(years.map((y) => [y, byYear[y].length]));
  const username = archive.user.userName;

  writeData(siteDir, byYear, {
    profile: {
      username,
      displayName: archive.user.displayName,
      createdAt: archive.account.createdAt,
      bio: archive.profile.bio,
      website: config.website,
      location: archive.profile.location,
      avatarLocal: images.avatar,
      headerLocal: images.header,
    },
    years,
    tweetCounts,
    totalTweets: tweets.length,
    lang: config.lang,
    exportedAt: archive.generationDate,
    generatedAt: new Date().toISOString(),
  });

  fs.cpSync(path.join(templateDir, 'assets'), path.join(siteDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'assets', 'js', 'i18n.js'), `window.ARCHIVE_I18N = ${JSON.stringify(i18n, null, 2)};\n`);

  const values = {
    lang: config.lang,
    title: config.title,
    description: fill(i18n.metaDescription, { user: username }),
    displayName: archive.user.displayName,
    username,
    footerArchive: fill(i18n.footerArchive, { user: username }),
    footerExported: fill(i18n.footerExported, { date: formatMonthYear(archive.generationDate, i18n.locale) }),
  };
  for (const [k, v] of Object.entries(i18n)) values[`t.${k}`] = v;
  const robotsMeta = config.noindex ? '<meta name="robots" content="noindex, nofollow">' : '';
  const html = fs.readFileSync(path.join(templateDir, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(siteDir, 'index.html'), renderTemplate(html, values, { robotsMeta }));

  return { years, tweetCounts };
}

module.exports = { prepareSiteDir, renderTemplate, writeSite };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS. If `Esportato: aprile 2024` fails, check that Node has full ICU (`node -p "new Intl.DateTimeFormat('it',{month:'long'}).format(new Date())"` must print an Italian month); official Node builds do.

- [ ] **Step 5: Commit**

```bash
git add src/site/write.js test/write.test.js
git commit -m "feat: write site data, template and translated index.html"
```

---

### Task 10: Setup wizard and `config.json`

**Files:**
- Create: `src/wizard.js`
- Test: `test/wizard.test.js`

**Interfaces:**
- Consumes: `Archive` (Task 2), `UserError`.
- Produces:
  - `Config = { lang: 'it' | 'en', title: string, includeRetweets: boolean, includeReplies: boolean, noindex: boolean, website: string }`
  - `detectLang(tweets: object[]): 'it' | 'en'`
  - `titleFor(lang, displayName): string`
  - `defaultConfig(archive): Config`
  - `normalizeConfig(raw: object, defaults: Config): { config: Config, fixed: string[] }`
  - `resolveConfig({ configPath: string, archive, reconfigure: boolean, yes: boolean, prompt?: (questions) => Promise<object> }): Promise<{ config: Config, fixed: string[], asked: boolean }>` — always writes `configPath`

- [ ] **Step 1: Write the failing tests** — `test/wizard.test.js`

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { detectLang, titleFor, defaultConfig, normalizeConfig, resolveConfig } = require('../src/wizard');
const { UserError } = require('../src/errors');
const { makeTmpDir } = require('./helpers/fixture');

const archive = {
  user: { displayName: 'Test User' },
  tweets: [{ lang: 'it' }, { lang: 'it' }, { lang: 'en' }],
};
const configPath = () => path.join(makeTmpDir('cfg'), 'config.json');
const noPrompt = async () => { throw new Error('prompt must not be called'); };

test('detectLang picks it only when Italian is the most frequent language', () => {
  assert.equal(detectLang([{ lang: 'it' }, { lang: 'it' }, { lang: 'en' }]), 'it');
  assert.equal(detectLang([{ lang: 'en' }, { lang: 'it' }, { lang: 'en' }]), 'en');
  assert.equal(detectLang([{ lang: 'es' }]), 'en');
  assert.equal(detectLang([]), 'en');
});

test('defaultConfig uses privacy-first defaults', () => {
  assert.deepEqual(defaultConfig(archive), {
    lang: 'it', title: 'Test User — Archivio Twitter',
    includeRetweets: false, includeReplies: false, noindex: true, website: '',
  });
  assert.equal(titleFor('en', 'Ann'), 'Ann — Twitter archive');
});

test('normalizeConfig fixes invalid fields and reports them', () => {
  const defaults = defaultConfig(archive);
  const { config, fixed } = normalizeConfig(
    { lang: 'fr', title: '', includeRetweets: 'yes', includeReplies: true, noindex: false, website: 'example.org' },
    defaults
  );
  assert.deepEqual(config, { ...defaults, includeReplies: true, noindex: false });
  assert.deepEqual(fixed.sort(), ['includeRetweets', 'lang', 'title', 'website']);
});

test('--yes without config.json writes and returns the defaults', async () => {
  const file = configPath();
  const r = await resolveConfig({ configPath: file, archive, reconfigure: false, yes: true, prompt: noPrompt });
  assert.deepEqual(r.config, defaultConfig(archive));
  assert.equal(r.asked, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), r.config);
});

test('an existing config.json is reused without questions', async () => {
  const file = configPath();
  fs.writeFileSync(file, JSON.stringify({ lang: 'en', title: 'Mine', includeRetweets: true, includeReplies: false, noindex: true, website: '' }));
  const r = await resolveConfig({ configPath: file, archive, reconfigure: false, yes: false, prompt: noPrompt });
  assert.equal(r.config.title, 'Mine');
  assert.equal(r.config.includeRetweets, true);
  assert.equal(r.asked, false);
});

test('an unreadable config.json is a UserError', async () => {
  const file = configPath();
  fs.writeFileSync(file, '{ not json');
  await assert.rejects(resolveConfig({ configPath: file, archive, reconfigure: false, yes: false, prompt: noPrompt }), UserError);
});

test('first run asks the questions and saves the answers', async () => {
  const file = configPath();
  let questions;
  const prompt = async (qs) => {
    questions = qs;
    return { lang: 'en', title: 'Hello', includeRetweets: false, includeReplies: true, noindex: true, website: '' };
  };
  const r = await resolveConfig({ configPath: file, archive, reconfigure: false, yes: false, prompt });
  assert.equal(r.asked, true);
  assert.deepEqual(questions.map((q) => q.name), ['lang', 'title', 'includeRetweets', 'includeReplies', 'noindex', 'website']);
  const titleQ = questions.find((q) => q.name === 'title');
  assert.equal(titleQ.initial('en', { lang: 'en' }), 'Test User — Twitter archive');
  assert.equal(r.config.includeReplies, true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).title, 'Hello');
});

test('--reconfigure asks again starting from the saved values', async () => {
  const file = configPath();
  fs.writeFileSync(file, JSON.stringify({ ...defaultConfig(archive), website: 'https://saved.example' }));
  let websiteInitial;
  const prompt = async (qs) => {
    websiteInitial = qs.find((q) => q.name === 'website').initial;
    return { ...defaultConfig(archive), website: '' };
  };
  const r = await resolveConfig({ configPath: file, archive, reconfigure: true, yes: false, prompt });
  assert.equal(websiteInitial, 'https://saved.example');
  assert.equal(r.config.website, '');
});

test('cancelling the questions is a UserError', async () => {
  const prompt = async () => ({ lang: 'it' }); // prompts returns partial answers on Ctrl+C
  await assert.rejects(resolveConfig({ configPath: configPath(), archive, reconfigure: false, yes: false, prompt }), UserError);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '../src/wizard'`.

- [ ] **Step 3: Create `src/wizard.js`**

```js
'use strict';

const fs = require('fs');
const { UserError } = require('./errors');

const LANGS = ['it', 'en'];
const FIELDS = ['lang', 'title', 'includeRetweets', 'includeReplies', 'noindex', 'website'];

function detectLang(tweets) {
  const counts = {};
  for (const t of tweets) if (t.lang) counts[t.lang] = (counts[t.lang] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top && top[0] === 'it' ? 'it' : 'en';
}

function titleFor(lang, displayName) {
  return lang === 'it' ? `${displayName} — Archivio Twitter` : `${displayName} — Twitter archive`;
}

function defaultConfig(archive) {
  const lang = detectLang(archive.tweets);
  return {
    lang,
    title: titleFor(lang, archive.user.displayName),
    includeRetweets: false,
    includeReplies: false,
    noindex: true,
    website: '',
  };
}

const VALID = {
  lang: (v) => LANGS.includes(v),
  title: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 200,
  includeRetweets: (v) => typeof v === 'boolean',
  includeReplies: (v) => typeof v === 'boolean',
  noindex: (v) => typeof v === 'boolean',
  website: (v) => v === '' || (typeof v === 'string' && /^https?:\/\/\S+$/.test(v)),
};

function normalizeConfig(raw, defaults) {
  const config = {};
  const fixed = [];
  for (const field of FIELDS) {
    if (raw && VALID[field](raw[field])) {
      config[field] = typeof raw[field] === 'string' ? raw[field].trim() : raw[field];
    } else {
      config[field] = defaults[field];
      fixed.push(field);
    }
  }
  return { config, fixed };
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    throw new UserError('config.json is not valid JSON.', 'Delete config.json or run "npm run build -- --reconfigure".');
  }
}

function saveConfig(configPath, config) {
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function buildQuestions(base, displayName) {
  const customTitle = base.title !== titleFor(base.lang, displayName);
  const yesNo = { active: 'yes', inactive: 'no' };
  return [
    {
      type: 'select', name: 'lang', message: 'Site language',
      choices: [{ title: 'Italiano', value: 'it' }, { title: 'English', value: 'en' }],
      initial: LANGS.indexOf(base.lang),
    },
    {
      type: 'text', name: 'title', message: 'Site title',
      initial: (prev, values) => (customTitle ? base.title : titleFor(values.lang || prev, displayName)),
    },
    { type: 'toggle', name: 'includeRetweets', message: 'Include retweets (content written by other people)?', initial: base.includeRetweets, ...yesNo },
    { type: 'toggle', name: 'includeReplies', message: 'Include your replies to other users?', initial: base.includeReplies, ...yesNo },
    { type: 'toggle', name: 'noindex', message: 'Hide the site from search engines?', initial: base.noindex, ...yesNo },
    {
      type: 'text', name: 'website', message: 'Website to show on your profile (leave empty for none)',
      initial: base.website,
      validate: (v) => v === '' || /^https?:\/\/\S+$/.test(v) || 'Must start with http:// or https://',
    },
  ];
}

async function resolveConfig({ configPath, archive, reconfigure, yes, prompt }) {
  const defaults = defaultConfig(archive);
  const existing = loadConfig(configPath);

  if (existing && !reconfigure) {
    const { config, fixed } = normalizeConfig(existing, defaults);
    if (fixed.length) saveConfig(configPath, config);
    return { config, fixed, asked: false };
  }

  const base = existing ? normalizeConfig(existing, defaults).config : defaults;
  if (yes) {
    saveConfig(configPath, base);
    return { config: base, fixed: [], asked: false };
  }

  const ask = prompt || require('prompts');
  const answers = await ask(buildQuestions(base, archive.user.displayName));
  if (!FIELDS.every((f) => f in answers)) {
    throw new UserError('Setup cancelled.', 'Run "npm run build" again when you are ready.');
  }
  const { config, fixed } = normalizeConfig(answers, base);
  saveConfig(configPath, config);
  return { config, fixed, asked: true };
}

module.exports = { detectLang, titleFor, defaultConfig, normalizeConfig, resolveConfig };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wizard.js test/wizard.test.js
git commit -m "feat: add setup wizard with privacy-first defaults saved to config.json"
```

---

### Task 11: CLI orchestration and end-to-end test

**Files:**
- Create: `src/cli.js`
- Test: `test/cli.test.js`

**Interfaces:**
- Consumes: everything above — `locateArchive`, `readArchive`, `collectSensitive`, `guardSite`, `resolveConfig`, `shouldInclude`, `buildNoteIndex`, `findNote`, `toPublicTweet`, `listMediaFiles`, `copyTweetMedia`, `copyProfileImages`, `prepareSiteDir`, `writeSite`, `UserError`.
- Produces:
  - `parseArgs(argv: string[]): { yes: boolean, reconfigure: boolean, debug: boolean }` — throws `UserError` on unknown flags
  - `build({ archiveDir, siteDir, configPath, templateDir, flags, prompt?, log? }): Promise<Summary>` with `Summary = { included: number, excluded: { retweet: number, reply: number }, media: { count, bytes, warnings }, years: string[] }`
  - `main(argv): Promise<number>` — exit code

- [ ] **Step 1: Write the failing tests** — `test/cli.test.js`

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with `Cannot find module '../src/cli'`.

- [ ] **Step 3: Create `src/cli.js`**

```js
#!/usr/bin/env node
'use strict';

// Keep this check before any require that may use newer syntax.
const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (NODE_MAJOR < 18) {
  console.error(`✖ Node.js ${process.versions.node} is too old: version 18 or newer is required.`);
  console.error('  → Install the current LTS version from https://nodejs.org and try again.');
  process.exit(1);
}

const path = require('path');
const { UserError } = require('./errors');
const { locateArchive } = require('./archive/locate');
const { readArchive } = require('./archive/read');
const { collectSensitive, guardSite } = require('./privacy/guard');
const { resolveConfig } = require('./wizard');
const { shouldInclude } = require('./pipeline/filter');
const { buildNoteIndex, findNote } = require('./pipeline/notes');
const { toPublicTweet } = require('./pipeline/transform');
const { listMediaFiles, copyTweetMedia, copyProfileImages } = require('./pipeline/media');
const { prepareSiteDir, writeSite } = require('./site/write');

const ROOT = path.resolve(__dirname, '..');
const FLAGS = { '--yes': 'yes', '--reconfigure': 'reconfigure', '--debug': 'debug' };

function parseArgs(argv) {
  const flags = { yes: false, reconfigure: false, debug: false };
  for (const arg of argv) {
    if (!FLAGS[arg]) throw new UserError(`Unknown option: ${arg}`, 'Supported options: --yes, --reconfigure, --debug.');
    flags[FLAGS[arg]] = true;
  }
  return flags;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function printSummary(log, summary, siteDir, fixed) {
  const rel = path.relative(process.cwd(), siteDir) || siteDir;
  log('');
  log(`✔ Site generated in ${rel}${path.sep}`);
  log(`  Tweets published: ${summary.included}`);
  log(`  Excluded: ${summary.excluded.retweet} retweets, ${summary.excluded.reply} replies to other users`);
  log(`  Media files: ${summary.media.count} (${mb(summary.media.bytes)})`);
  if (fixed.length) log(`  config.json: invalid values replaced with defaults for ${fixed.join(', ')}`);
  for (const w of summary.media.warnings) log(`  ⚠ ${w}`);
  log('');
  log('Next steps:');
  log(`  1. Open ${path.join(rel, 'index.html')} in your browser to check the result.`);
  log(`  2. Upload the ${rel}${path.sep} folder to your hosting (see README).`);
}

async function build({
  archiveDir = path.join(ROOT, 'archive'),
  siteDir = path.join(ROOT, 'site'),
  configPath = path.join(ROOT, 'config.json'),
  templateDir = path.join(ROOT, 'template'),
  flags = { yes: false, reconfigure: false },
  prompt,
  log = console.log,
} = {}) {
  log('Looking for your archive…');
  const located = await locateArchive(archiveDir);
  try {
    const archive = readArchive(located.root);
    const sensitive = collectSensitive(located.root);
    log(`Found the archive of @${archive.user.userName} (${archive.tweets.length} tweets).`);

    const { config, fixed } = await resolveConfig({
      configPath, archive, reconfigure: flags.reconfigure, yes: flags.yes, prompt,
    });

    const options = { includeRetweets: config.includeRetweets, includeReplies: config.includeReplies };
    const mediaFiles = listMediaFiles(archive.mediaDir);
    const noteIndex = buildNoteIndex(archive.noteTweets);
    const excluded = { retweet: 0, reply: 0 };
    const tweets = [];
    for (const raw of archive.tweets) {
      const decision = shouldInclude(raw, archive.user, options);
      if (!decision.include) {
        excluded[decision.reason] += 1;
        continue;
      }
      tweets.push(toPublicTweet(raw, {
        user: archive.user,
        options,
        hasLocalMedia: (name) => mediaFiles.has(name),
        note: findNote(raw, noteIndex),
      }));
    }

    log('Writing the site…');
    prepareSiteDir(siteDir);
    const images = copyProfileImages(archive, siteDir);
    const media = copyTweetMedia(tweets, archive.mediaDir, siteDir);
    const { years } = writeSite({ siteDir, templateDir, archive, config, tweets, images });

    log('Checking that no private data was published…');
    guardSite(siteDir, sensitive);

    const summary = { included: tweets.length, excluded, media, years };
    printSummary(log, summary, siteDir, fixed);
    return summary;
  } finally {
    await located.cleanup();
  }
}

async function main(argv) {
  let flags = { debug: argv.includes('--debug') };
  try {
    flags = parseArgs(argv);
    await build({ flags });
    return 0;
  } catch (err) {
    if (err instanceof UserError) {
      console.error(`\n✖ ${err.message}`);
      if (err.hint) console.error(`  → ${err.hint}`);
    } else if (err && err.code === 'ENOSPC') {
      console.error('\n✖ Not enough disk space to generate the site.');
      console.error('  → Free some space and run "npm run build" again.');
    } else {
      console.error('\n✖ Unexpected error while generating the site.');
      if (flags.debug) console.error(err && err.stack ? err.stack : err);
      else console.error('  → Run "npm run build -- --debug" for details.');
    }
    return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { build, parseArgs, main };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, all test files.

- [ ] **Step 5: Manual check on the fixture with the real CLI**

```bash
node -e "require('./test/helpers/fixture').createFixtureArchive(require('path').resolve('archive'))"
npm run build -- --yes
```
Expected: the summary shows `Tweets published: 5`, `Excluded: 1 retweets, 1 replies to other users`, `Media files: 3`. Open `site/index.html` with a double click: the sidebar shows "Test User", years 2021 and 2020, the thread label on tweet 104, the long text on tweet 105, the photo on tweet 101 (the fixture images are not real pictures, so the broken-image fallback is expected).

Then clean up (these paths are gitignored, but remove them anyway):
```bash
rm -rf archive/data "archive/Your archive.html" site config.json
```

- [ ] **Step 6: Manual check on the real archive**

```bash
npm run build -- --reconfigure
```
Before running, move or copy the real archive into `archive/` (for example copy the contents of `original-archive/` into `archive/`). Answer the questions (Italian, defaults). Expected: about 16,400 tweets published, 12,732 retweets and 14,909 replies excluded, about 1,793 media files. Open `site/index.html` and compare with the live site: same tweets, avatar and header shown, Italian UI. Then run `npm run build -- --reconfigure` choosing English and check the UI strings and dates.

- [ ] **Step 7: Commit**

```bash
git add src/cli.js test/cli.test.js
git commit -m "feat: add build command orchestrating the privacy-safe pipeline"
```

---

### Task 12: Documentation and removal of the personal site

**Files:**
- Create: `README.md` (replace), `README.it.md`, `LICENSE`
- Delete (only after explicit user confirmation, Step 4): `docs/`, `scripts/`

**Interfaces:**
- Consumes: CLI behaviour and options from Task 11.

- [ ] **Step 1: Replace `README.md`**

````markdown
# Twitter Archive Site

Turn the archive you downloaded from Twitter/X into a static website you can
publish anywhere — keeping your private data private.

Supported format: the Twitter archive as exported in April 2024.

## What you need

- [Node.js](https://nodejs.org) 18 or newer
- Your Twitter archive (`.zip`), requested from Twitter/X under
  *Settings → Your account → Download an archive of your data*

## Create your site

1. Download this project (green **Code** button → **Download ZIP**, then extract it) or clone it with git.
2. Copy your archive `.zip` into the `archive` folder. If Twitter split it into several zips, copy all of them.
3. Open a terminal in the project folder and run:

   ```
   npm install
   npm run build
   ```

4. Answer a few questions. Pressing Enter keeps the safe default.
5. Double-click `site/index.html` to check the result in your browser.
6. Publish the `site` folder (see [Publishing](#publishing)).

Your answers are saved in `config.json`: the next `npm run build` asks nothing.

| Command | What it does |
|---|---|
| `npm run build` | Builds the site (asks questions only the first time) |
| `npm run build -- --reconfigure` | Asks the questions again |
| `npm run build -- --yes` | Never asks; uses `config.json` or the defaults |
| `npm run build -- --debug` | Shows technical details when something goes wrong |

## What gets published — and what doesn't

Published:
- Your own tweets and the replies you wrote in your own threads
- Their photos and videos (with location and camera data removed from images)
- Your name, username, bio, location, avatar and header as shown on your profile
- Retweets and replies to other users **only if you choose so** (default: no)

Never published, whatever you choose:
- Direct messages, email address, phone number, IP addresses
- Followers, following, likes, blocks, mutes, lists, ads data
- Deleted tweets
- The device you tweeted from and the location attached to tweets

The tool reads only the files it needs from the archive. As a last safety net,
after building it searches the site for your email, phone number and IP
addresses: if it finds any, it deletes the site and stops.

Mentions of other people (`@name`) inside your tweets are kept as they are,
because they were already public.

By default the site asks search engines not to index it. You can change this
during the setup.

## Publishing

The `site` folder is a plain static website: upload it anywhere.

- **GitHub Pages**: create a new repository, put the contents of `site` in it,
  then *Settings → Pages → Deploy from a branch*. GitHub rejects files over
  100 MB and recommends sites under 1 GB: the build warns you if you exceed them.
- **Netlify**: drag and drop the `site` folder on <https://app.netlify.com/drop>.
- **Your own server**: copy the contents of `site` to the web root.

Never publish the `archive` folder or `config.json`.

## Development

```
npm test
```

Tests run on a small fake archive in `test/helpers/fixture.js`, never on real data.
````

- [ ] **Step 2: Create `README.it.md`**

````markdown
# Twitter Archive Site

Trasforma l'archivio scaricato da Twitter/X in un sito statico da pubblicare
dove vuoi, senza esporre i tuoi dati privati.

Formato supportato: l'archivio di Twitter come esportato ad aprile 2024.

## Cosa serve

- [Node.js](https://nodejs.org) 18 o successivo
- L'archivio di Twitter (`.zip`), da richiedere su Twitter/X in
  *Impostazioni → Il tuo account → Scarica un archivio dei tuoi dati*

## Crea il tuo sito

1. Scarica questo progetto (pulsante verde **Code** → **Download ZIP**, poi estrailo) oppure clonalo con git.
2. Copia lo `.zip` dell'archivio nella cartella `archive`. Se Twitter l'ha diviso in più zip, copiali tutti.
3. Apri un terminale nella cartella del progetto e lancia:

   ```
   npm install
   npm run build
   ```

4. Rispondi a poche domande. Premendo Invio accetti il default prudente.
5. Apri `site/index.html` con un doppio clic per controllare il risultato.
6. Pubblica la cartella `site` (vedi [Pubblicazione](#pubblicazione)).

Le risposte vengono salvate in `config.json`: il `npm run build` successivo non chiede nulla.

| Comando | Cosa fa |
|---|---|
| `npm run build` | Genera il sito (fa domande solo la prima volta) |
| `npm run build -- --reconfigure` | Ripropone le domande |
| `npm run build -- --yes` | Non chiede mai; usa `config.json` o i default |
| `npm run build -- --debug` | Mostra i dettagli tecnici in caso di errore |

## Cosa viene pubblicato e cosa no

Pubblicato:
- I tuoi tweet e le risposte che hai scritto nei tuoi thread
- Le loro foto e i video (dalle immagini vengono tolti posizione e dati della fotocamera)
- Nome, username, bio, località, avatar e copertina come appaiono nel profilo
- Retweet e risposte ad altri utenti **solo se lo scegli** (default: no)

Mai pubblicato, qualunque cosa tu scelga:
- Messaggi diretti, email, numero di telefono, indirizzi IP
- Follower, seguiti, like, blocchi, silenziati, liste, dati pubblicitari
- Tweet cancellati
- Il dispositivo da cui hai twittato e la posizione associata ai tweet

Lo strumento legge dall'archivio solo i file che gli servono. Come ultima
protezione, dopo la generazione cerca nel sito la tua email, il tuo numero di
telefono e i tuoi indirizzi IP: se li trova, cancella il sito e si ferma.

Le menzioni di altre persone (`@nome`) dentro i tuoi tweet restano come sono,
perché erano già pubbliche.

Per default il sito chiede ai motori di ricerca di non indicizzarlo. Puoi
cambiarlo durante le domande iniziali.

## Pubblicazione

La cartella `site` è un normale sito statico: caricala dove preferisci.

- **GitHub Pages**: crea un nuovo repository, mettici il contenuto di `site`,
  poi *Settings → Pages → Deploy from a branch*. GitHub rifiuta file oltre
  100 MB e consiglia siti sotto 1 GB: la build ti avvisa se li superi.
- **Netlify**: trascina la cartella `site` su <https://app.netlify.com/drop>.
- **Un tuo server**: copia il contenuto di `site` nella cartella pubblica.

Non pubblicare mai la cartella `archive` né `config.json`.

## Sviluppo

```
npm test
```

I test usano un piccolo archivio finto in `test/helpers/fixture.js`, mai dati reali.
````

- [ ] **Step 3: Create `LICENSE`** (MIT, as declared in `package.json`)

```text
MIT License

Copyright (c) 2026 Marco Maroni

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Commit the documentation**

```bash
git add README.md README.it.md LICENSE
git commit -m "docs: document usage, privacy guarantees and publishing"
```

- [ ] **Step 5: STOP — confirm with the user before removing the personal site**

`docs/` is currently the GitHub Pages source of twitter-archive.marcomaroni.it. Removing it from `main` takes the live site down. Ask the user to confirm that the site has been regenerated with `npm run build` and is published from a separate repository (with the `CNAME` file for the custom domain), or that they accept the downtime. Do not continue without an explicit yes.

- [ ] **Step 6: Remove the personal site and old scripts** (only after the confirmation in Step 5)

```bash
git rm -r -q docs scripts
npm test
```
Expected: tests still PASS (nothing depends on `docs/` or `scripts/`).

```bash
git commit -m "chore: remove personal site and legacy scripts from the tool repository"
```
