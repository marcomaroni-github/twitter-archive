#!/usr/bin/env node
'use strict';

// Keep this check before any require that may use newer syntax.
const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (NODE_MAJOR < 18) {
  console.error(`✖ Node.js ${process.versions.node} is too old: version 18 or newer is required.`);
  console.error('  → Install the current LTS version from https://nodejs.org and try again.');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const { UserError } = require('./errors');
const { locateArchive, removeStaleExtractions } = require('./archive/locate');
const { readArchive } = require('./archive/read');
const { collectSensitive, containsSensitive, guardSite } = require('./privacy/guard');
const { resolveConfig } = require('./wizard');
const { shouldInclude } = require('./pipeline/filter');
const { buildNoteIndex, findNote } = require('./pipeline/notes');
const { toPublicTweet } = require('./pipeline/transform');
const { listMediaFiles, copyTweetMedia, copyProfileImages } = require('./pipeline/media');
const { prepareSiteDir, writeSite, copyExtra } = require('./site/write');

const ROOT = path.resolve(__dirname, '..');
const FLAGS = { '--yes': 'yes', '--reconfigure': 'reconfigure', '--debug': 'debug' };

function parseArgs(argv) {
  const flags = { yes: false, reconfigure: false, debug: false };
  for (const arg of argv) {
    if (!FLAGS[arg]) throw new UserError(`Unknown option: ${arg}`, 'Supported options: --yes, --reconfigure, --debug.');
    flags[FLAGS[arg]] = true;
  }
  return flags;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function printSummary(log, summary, siteDir, fixed) {
  const rel = path.relative(process.cwd(), siteDir) || siteDir;
  log('');
  log(`✔ Site generated in ${rel}${path.sep}`);
  log(`  Tweets published: ${summary.included}`);
  const { retweet, reply, private: priv } = summary.excluded;
  log(`  Excluded: ${retweet} retweets, ${reply} replies to other users, ${priv} tweets containing your private contact data`);
  log(`  Media files: ${summary.media.count} (${mb(summary.media.bytes)})`);
  if (fixed.length) log(`  config.json: invalid values replaced with defaults for ${fixed.join(', ')}`);
  if (summary.extraFiles > 0) log(`  Extra files copied: ${summary.extraFiles}`);
  for (const w of summary.media.warnings) log(`  ⚠ ${w}`);
  log('');
  log('Next steps:');
  log(`  1. Open ${path.join(rel, 'index.html')} in your browser to check the result.`);
  log(`  2. Upload the ${rel}${path.sep} folder to your hosting (see README).`);
}

/**
 * While a temp extraction exists, Ctrl+C or closing the terminal must not leave the
 * full private archive in the temp folder. Returns a function removing the handlers.
 */
function removeOnInterrupt(located) {
  if (!located.tempDir) return () => {};
  const onSignal = () => {
    located.cleanupSync();
    console.error('\nBuild interrupted: temporary files removed.');
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  return () => {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  };
}

async function build({
  archiveDir = path.join(ROOT, 'archive'),
  siteDir = path.join(ROOT, 'site'),
  configPath = path.join(ROOT, 'config.json'),
  templateDir = path.join(ROOT, 'template'),
  extraDir = path.join(ROOT, 'extra'),
  flags = { yes: false, reconfigure: false },
  prompt,
  log = console.log,
} = {}) {
  removeStaleExtractions();
  log('Looking for your archive…');
  const located = await locateArchive(archiveDir);
  const removeHandlers = removeOnInterrupt(located);
  try {
    const archive = readArchive(located.root);
    const sensitive = collectSensitive(located.root);
    log(`Found the archive of @${archive.user.userName} (${archive.tweets.length} tweets).`);

    const { config, fixed } = await resolveConfig({
      configPath, archive, reconfigure: flags.reconfigure, yes: flags.yes, prompt,
    });

    const options = { includeRetweets: config.includeRetweets, includeReplies: config.includeReplies };
    const mediaFiles = listMediaFiles(archive.mediaDir);
    const noteIndex = buildNoteIndex(archive.noteTweets);
    const excluded = { retweet: 0, reply: 0, private: 0 };
    const tweets = [];
    for (const raw of archive.tweets) {
      const decision = shouldInclude(raw, archive.user, options);
      if (!decision.include) {
        excluded[decision.reason] += 1;
        continue;
      }
      const publicTweet = toPublicTweet(raw, {
        user: archive.user,
        options,
        hasLocalMedia: (name) => mediaFiles.has(name),
        note: findNote(raw, noteIndex),
      });
      // The owner's own email/phone/IP in a tweet: hide the tweet instead of blocking the build.
      if (containsSensitive(JSON.stringify(publicTweet), sensitive)) {
        excluded.private += 1;
        continue;
      }
      tweets.push(publicTweet);
    }
    // Same for the profile: blank the field for this build only (config.json is not rewritten).
    if (containsSensitive(archive.profile.bio, sensitive)) archive.profile.bio = '';
    const siteConfig = containsSensitive(config.website, sensitive) ? { ...config, website: '' } : config;

    log('Writing the site…');
    prepareSiteDir(siteDir);
    let media;
    let years;
    let extraFiles;
    try {
      const images = copyProfileImages(archive, siteDir);
      media = copyTweetMedia(tweets, archive.mediaDir, siteDir);
      ({ years } = writeSite({ siteDir, templateDir, archive, config: siteConfig, tweets, images }));
      extraFiles = copyExtra(extraDir, siteDir);

      log('Checking that no private data was published…');
      guardSite(siteDir, sensitive);
    } catch (err) {
      // Never leave a partial site that the privacy check has not approved.
      try {
        fs.rmSync(siteDir, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        // Best effort: the original error matters more.
      }
      throw err;
    }

    const summary = { included: tweets.length, excluded, media, years, extraFiles };
    printSummary(log, summary, siteDir, fixed);
    return summary;
  } finally {
    removeHandlers();
    await located.cleanup();
  }
}

async function main(argv) {
  let flags = { debug: argv.includes('--debug') };
  try {
    flags = parseArgs(argv);
    await build({ flags });
    return 0;
  } catch (err) {
    if (err instanceof UserError) {
      console.error(`\n✖ ${err.message}`);
      if (err.hint) console.error(`  → ${err.hint}`);
    } else if (err && err.code === 'ENOSPC') {
      console.error('\n✖ Not enough disk space to generate the site.');
      console.error('  → Free some space and run "npm run build" again.');
    } else {
      console.error('\n✖ Unexpected error while generating the site.');
      if (flags.debug) console.error(err && err.stack ? err.stack : err);
      else console.error('  → Run "npm run build -- --debug" for details.');
    }
    return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { build, parseArgs, main };
