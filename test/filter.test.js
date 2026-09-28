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
