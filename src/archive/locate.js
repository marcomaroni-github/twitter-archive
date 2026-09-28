'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const yauzl = require('yauzl');
const { UserError } = require('../errors');
const { readManifest } = require('./read');

const COPY_HINT = 'Copy the .zip file downloaded from Twitter/X into the "archive" folder, then run "npm run build" again.';

/** Folders (up to maxDepth levels below dir, dir included) that contain data/manifest.js. */
function findManifestRoots(dir, maxDepth) {
  const roots = [];
  const visit = (current, depth) => {
    if (fs.existsSync(path.join(current, 'data', 'manifest.js'))) {
      roots.push(current);
      return;
    }
    if (depth >= maxDepth) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) visit(path.join(current, entry.name), depth + 1);
    }
  };
  visit(dir, 0);
  return roots;
}

function extractZip(zipPath, destDir) {
  const corrupted = () => new UserError(
    `Cannot read the zip file "${path.basename(zipPath)}".`,
    'The file may be corrupted or incomplete: download the archive again from Twitter/X.'
  );
  const base = path.resolve(destDir) + path.sep;
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zip) => {
      if (openErr) return reject(corrupted());
      zip.on('error', () => reject(corrupted()));
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        const dest = path.resolve(destDir, entry.fileName);
        if (!dest.startsWith(base)) {
          zip.readEntry(); // never write outside the temp folder
          return;
        }
        if (entry.fileName.endsWith('/')) {
          fs.mkdirSync(dest, { recursive: true });
          zip.readEntry();
          return;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        zip.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr) return reject(corrupted());
          const writeStream = fs.createWriteStream(dest);
          readStream.on('error', () => reject(corrupted()));
          writeStream.on('error', reject);
          writeStream.on('finish', () => zip.readEntry());
          readStream.pipe(writeStream);
        });
      });
      zip.readEntry();
    });
  });
}

function accountIdAt(root) {
  return String((readManifest(root).userInfo || {}).accountId || '');
}

async function extractZips(zips) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'twitter-archive-'));
  const cleanup = async () => fs.rmSync(tmp, { recursive: true, force: true });
  try {
    let accountId = null;
    for (const zipPath of zips) {
      await extractZip(zipPath, tmp);
      const roots = findManifestRoots(tmp, 2);
      if (roots.length > 1) throw new UserError('The zip files contain more than one archive.', 'Keep only the zip files of one archive in the "archive" folder.');
      if (roots.length === 1) {
        const current = accountIdAt(roots[0]);
        if (accountId !== null && current !== accountId) {
          throw new UserError('The zip files belong to different accounts.', 'Keep only the zip files of one archive in the "archive" folder.');
        }
        accountId = current;
      }
    }
    const roots = findManifestRoots(tmp, 2);
    if (roots.length === 0) {
      throw new UserError('The zip file does not contain a Twitter archive (data/manifest.js not found).', COPY_HINT);
    }
    return { root: roots[0], cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

async function locateArchive(archiveDir) {
  if (!fs.existsSync(archiveDir)) {
    throw new UserError(`Folder not found: ${archiveDir}`, COPY_HINT);
  }
  const zips = fs.readdirSync(archiveDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.zip'))
    .map((e) => path.join(archiveDir, e.name))
    .sort();
  const folders = findManifestRoots(archiveDir, 2);

  if (zips.length > 0 && folders.length > 0) {
    throw new UserError(
      'The "archive" folder contains both zip files and an extracted archive.',
      'Keep only one of them: either the zip file(s) or the extracted folder.'
    );
  }
  if (zips.length > 0) return extractZips(zips);
  if (folders.length === 0) throw new UserError('No Twitter archive found in the "archive" folder.', COPY_HINT);
  if (folders.length > 1) {
    throw new UserError('More than one extracted archive found in the "archive" folder.', 'Keep only one archive in the "archive" folder.');
  }
  return { root: folders[0], cleanup: async () => {} };
}

module.exports = { locateArchive };
