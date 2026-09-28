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
