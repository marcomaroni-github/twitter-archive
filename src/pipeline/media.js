'use strict';

const fs = require('fs');
const path = require('path');
const { stripMetadata } = require('./strip');

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png']);

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function listMediaFiles(mediaDir) {
  return new Set(fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : []);
}

/**
 * Copy one file, removing image metadata. Returns the number of bytes written,
 * or null when the image metadata cannot be removed (nothing is written).
 */
function copyClean(src, dest) {
  if (IMAGE_EXT.has(path.extname(src).toLowerCase())) {
    const cleaned = stripMetadata(fs.readFileSync(src));
    if (cleaned === null) return null;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, cleaned);
    return cleaned.length;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return fs.statSync(dest).size;
}

function copyTweetMedia(tweets, mediaDir, siteDir) {
  const needed = new Set();
  for (const t of tweets) for (const m of t.media || []) if (m.local) needed.add(path.basename(m.local));

  const warnings = [];
  const skipped = [];
  let count = 0;
  let bytes = 0;
  for (const name of needed) {
    const src = path.join(mediaDir, name);
    if (!fs.existsSync(src)) continue;
    const size = copyClean(src, path.join(siteDir, 'tweets_media', name));
    if (size === null) {
      skipped.push(name);
      warnings.push(`Image not published (metadata could not be removed): tweets_media/${name}`);
      continue;
    }
    if (size > MAX_FILE_BYTES) {
      warnings.push(`Large file (${mb(size)}): tweets_media/${name} — GitHub Pages rejects files over 100 MB.`);
    }
    count += 1;
    bytes += size;
  }
  if (bytes > MAX_TOTAL_BYTES) {
    warnings.push(`Media total is ${mb(bytes)} — GitHub Pages sites should stay under 1 GB.`);
  }
  return { count, bytes, warnings, skipped };
}

/** Last path segment of a URL without extension, e.g. ".../profile_images/1/abc.jpg" → "abc". */
function mediaKey(url) {
  const last = (url || '').split('?')[0].split('/').pop() || '';
  return last.replace(/\.[^.]+$/, '');
}

function copyProfileImage(archive, url, baseName, siteDir) {
  const key = mediaKey(url);
  if (!key) return null;
  const file = archive.profileMediaFiles.find((f) => f.replace(/\.[^.]+$/, '').endsWith(`-${key}`));
  if (!file) return null;
  const rel = `assets/images/${baseName}${path.extname(file).toLowerCase()}`;
  const size = copyClean(path.join(archive.profileMediaDir, file), path.join(siteDir, rel));
  return size === null ? null : rel;
}

function copyProfileImages(archive, siteDir) {
  return {
    avatar: copyProfileImage(archive, archive.profile.avatarMediaUrl, 'avatar', siteDir),
    header: copyProfileImage(archive, archive.profile.headerMediaUrl, 'header', siteDir),
  };
}

module.exports = { listMediaFiles, copyTweetMedia, copyProfileImages, MAX_FILE_BYTES, MAX_TOTAL_BYTES };
