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
  assert.deepEqual(result.skipped, []);
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

test('an image whose metadata cannot be removed is not copied', () => {
  const archive = readArchive(createFixtureArchive());
  const photo = path.join(archive.mediaDir, '101-photoA.jpg');
  fs.writeFileSync(photo, fs.readFileSync(photo).subarray(0, 10));
  const site = makeTmpDir('site');
  const result = copyTweetMedia(tweets, archive.mediaDir, site);
  assert.deepEqual(result.skipped, ['101-photoA.jpg']);
  assert.equal(result.count, 2);
  assert.ok(!fs.existsSync(path.join(site, 'tweets_media', '101-photoA.jpg')));
  assert.ok(result.warnings.includes('Image not published (metadata could not be removed): tweets_media/101-photoA.jpg'));
});

test('a profile image whose metadata cannot be removed is null', () => {
  const archive = readArchive(createFixtureArchive());
  const avatar = path.join(archive.profileMediaDir, '1000-avatarX.jpg');
  fs.writeFileSync(avatar, fs.readFileSync(avatar).subarray(0, 10));
  const site = makeTmpDir('site');
  const images = copyProfileImages(archive, site);
  assert.deepEqual(images, { avatar: null, header: 'assets/images/header.jpg' });
  assert.ok(!fs.existsSync(path.join(site, 'assets', 'images', 'avatar.jpg')));
});
