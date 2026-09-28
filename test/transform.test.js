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
