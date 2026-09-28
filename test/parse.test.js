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
