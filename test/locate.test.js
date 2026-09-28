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

test('exposes the temp extraction folder for zips and removes it synchronously', async () => {
  const dir = makeTmpDir('archive');
  await zipDir(createFixtureArchive(), path.join(dir, 'twitter.zip'));
  const located = await locateArchive(dir);
  assert.equal(typeof located.tempDir, 'string');
  assert.ok(located.root.startsWith(located.tempDir));
  assert.ok(fs.existsSync(located.tempDir));
  located.cleanupSync();
  assert.ok(!fs.existsSync(located.tempDir));
  await located.cleanup(); // still safe after the folder is gone
});

test('tempDir is null for an extracted folder and cleanupSync leaves it alone', async () => {
  const dir = makeTmpDir('archive');
  createFixtureArchive(dir);
  const located = await locateArchive(dir);
  assert.equal(located.tempDir, null);
  located.cleanupSync();
  assert.ok(hasManifest(dir), 'cleanupSync must not delete the user folder');
});
