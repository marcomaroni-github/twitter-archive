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
