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
