'use strict';

const fs = require('fs');
const path = require('path');
const { parseManifest, parseYtd } = require('./parse');
const { UserError } = require('../errors');

/**
 * The only data types the pipeline is allowed to read. Anything else in the
 * archive (DMs, IP logs, followers, ads, deleted tweets, ...) is never opened here.
 */
const PIPELINE_TYPES = ['tweets', 'noteTweet', 'profile', 'account'];

function filesOf(manifest, type) {
  const dataType = manifest.dataTypes && manifest.dataTypes[type];
  if (!dataType || !Array.isArray(dataType.files)) return [];
  return dataType.files.map((f) => f.fileName).filter(Boolean);
}

function readManifest(root) {
  const file = path.join(root, 'data', 'manifest.js');
  if (!fs.existsSync(file)) {
    throw new UserError(
      'Unsupported archive format: data/manifest.js not found.',
      'Make sure you copied the archive downloaded from Twitter/X, not a single file from it.'
    );
  }
  return parseManifest(fs.readFileSync(file, 'utf8'));
}

function readType(root, manifest, type, key) {
  if (!PIPELINE_TYPES.includes(type)) throw new Error(`Data type not allowlisted: ${type}`);
  const out = [];
  for (const rel of filesOf(manifest, type)) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    for (const entry of parseYtd(fs.readFileSync(full, 'utf8'), rel)) {
      if (entry && entry[key]) out.push(entry[key]);
    }
  }
  return out;
}

function readArchive(root) {
  const manifest = readManifest(root);
  const userInfo = manifest.userInfo || {};
  if (!userInfo.accountId || !userInfo.userName) {
    throw new UserError('Unsupported archive format: account information missing in data/manifest.js.');
  }

  const tweets = readType(root, manifest, 'tweets', 'tweet');
  if (tweets.length === 0) {
    throw new UserError('No tweets found in the archive.', 'Check that the archive is complete (data/tweets.js).');
  }
  const noteTweets = readType(root, manifest, 'noteTweet', 'noteTweet');
  const profileEntry = readType(root, manifest, 'profile', 'profile')[0] || {};
  const accountEntry = readType(root, manifest, 'account', 'account')[0] || {};
  const description = profileEntry.description || {};

  const tweetsType = manifest.dataTypes.tweets || {};
  const profileType = manifest.dataTypes.profile || {};
  const mediaDir = path.join(root, tweetsType.mediaDirectory || 'data/tweets_media');
  const profileMediaDir = path.join(root, profileType.mediaDirectory || 'data/profile_media');
  const profileMediaFiles = fs.existsSync(profileMediaDir) ? fs.readdirSync(profileMediaDir) : [];

  return {
    user: {
      accountId: String(userInfo.accountId),
      userName: userInfo.userName,
      displayName: userInfo.displayName || accountEntry.accountDisplayName || userInfo.userName,
    },
    generationDate: (manifest.archiveInfo && manifest.archiveInfo.generationDate) || '',
    tweets,
    noteTweets,
    profile: {
      bio: description.bio || '',
      website: description.website || '',
      avatarMediaUrl: profileEntry.avatarMediaUrl || '',
      headerMediaUrl: profileEntry.headerMediaUrl || '',
    },
    // Only the creation date: account.js also holds the email, which must not leave this module.
    account: { createdAt: accountEntry.createdAt || '' },
    mediaDir,
    profileMediaDir,
    profileMediaFiles,
  };
}

module.exports = { readArchive, readManifest, PIPELINE_TYPES };
