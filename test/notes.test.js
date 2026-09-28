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
