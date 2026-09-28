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
