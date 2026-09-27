#!/usr/bin/env node
/**
 * process_tweets.js
 * 
 * Processa l'archivio Twitter originale e genera file JSON filtrati
 * per il sito pubblico twitter-archive.marcomaroni.it
 * 
 * - Filtra le risposte ad altri utenti
 * - Rimuove tutti i dati sensibili
 * - Divide i tweet per anno
 * - Genera il manifest.json
 * 
 * Usage: node scripts/process_tweets.js
 */

const fs = require('fs');
const path = require('path');

// ── Paths ────────────────────────────────────────────────
const ROOT        = path.resolve(__dirname, '..');
const ARCHIVE     = path.join(ROOT, 'original-archive', 'data');
const MEDIA_DIR   = path.join(ARCHIVE, 'tweets_media');
const DOCS        = path.join(ROOT, 'docs');
const OUT_DATA    = path.join(DOCS, 'data');

// ── Config ───────────────────────────────────────────────
const ACCOUNT_ID  = '15570883';
const USERNAME    = 'marcomaroni';

// ── Helpers ──────────────────────────────────────────────

/** Parse Twitter's date format → ISO 8601 */
function parseTwitterDate(dateStr) {
  // "Sat Apr 06 11:26:25 +0000 2024"
  try {
    return new Date(dateStr).toISOString().replace('.000Z', 'Z');
  } catch {
    return dateStr;
  }
}

/** Get local media path if file exists in tweets_media/ */
function getLocalMediaPath(tweetId, mediaUrlHttps) {
  // URL: https://pbs.twimg.com/media/FILENAME.EXT[?params]
  const urlPath = mediaUrlHttps.split('?')[0];
  const filename = urlPath.split('/').pop();
  const localName = `${tweetId}-${filename}`;
  const localFull = path.join(MEDIA_DIR, localName);
  return fs.existsSync(localFull) ? `tweets_media/${localName}` : null;
}

/** Decode HTML entities (Twitter encodes < > & in full_text) */
function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/** Load a .js data file (strips window.YTD.xxx.partN = prefix) */
function loadDataFile(filename) {
  const filePath = path.join(ARCHIVE, filename);
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const jsonStart = content.indexOf('[');
  if (jsonStart === -1) return null;
  return JSON.parse(content.slice(jsonStart));
}

// ── Tweet filtering ──────────────────────────────────────

function shouldInclude(tweet) {
  const replyTo = tweet.in_reply_to_status_id || '';
  const replyToUser = tweet.in_reply_to_user_id || '';
  const text = tweet.full_text || '';

  // Exclude Retweets (content from other users)
  if (text.startsWith('RT @')) {
    return { include: false, reason: 'rt' };
  }

  // Exclude replies to others (keep: own original tweets & thread self-replies)
  if (replyTo && replyToUser !== ACCOUNT_ID) {
    return { include: false, reason: 'reply' };
  }

  return { include: true };
}

// ── Tweet processing ─────────────────────────────────────

function processTweet(raw) {
  const t = raw.tweet || raw;

  const tweetId   = t.id_str || t.id || '';
  const createdAt = parseTwitterDate(t.created_at);
  const text      = decodeEntities(t.full_text || '');

  // URLs
  const urls = (t.entities?.urls || []).map(u => ({
    url:          u.url || '',
    expanded_url: u.expanded_url || '',
    display_url:  u.display_url || ''
  }));

  // Mentions
  const mentions = (t.entities?.user_mentions || []).map(m => ({
    name:        m.name || '',
    screen_name: m.screen_name || ''
  }));

  // Hashtags
  const hashtags = (t.entities?.hashtags || []).map(h => h.text || '');

  // Media — prefer extended_entities (has all images for multi-photo tweets)
  const mediaItems = t.extended_entities?.media || t.entities?.media || [];
  const media = mediaItems.map(m => {
    const mediaUrl = m.media_url_https || m.media_url || '';
    const type     = m.type || 'photo';
    const local    = getLocalMediaPath(tweetId, mediaUrl);

    const entry = { type, url: mediaUrl, local };

    if (type === 'video' || type === 'animated_gif') {
      const variants = m.video_info?.variants || [];
      const mp4s     = variants.filter(v => v.content_type === 'video/mp4');
      if (mp4s.length > 0) {
        const best = mp4s.reduce((a, b) => (a.bitrate || 0) >= (b.bitrate || 0) ? a : b);
        entry.video_url = best.url || '';
      }
    }

    return entry;
  });

  // Reply info
  const inReplyToStatusId    = t.in_reply_to_status_id    || null;
  const inReplyToScreenName  = t.in_reply_to_screen_name  || null;

  return {
    id:                      tweetId,
    created_at:              createdAt,
    text,
    urls,
    mentions,
    hashtags,
    media,
    in_reply_to_status_id:   inReplyToStatusId,
    in_reply_to_screen_name: inReplyToScreenName,
    retweet_count:           parseInt(t.retweet_count  || 0, 10),
    favorite_count:          parseInt(t.favorite_count || 0, 10),
    lang:                    t.lang || ''
  };
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  console.log('🐦 Twitter Archive Processor');
  console.log('════════════════════════════\n');

  // 1. Load tweets.js
  console.log('📂 Lettura tweets.js (74MB)...');
  const tweetsRaw = loadDataFile('tweets.js');
  if (!tweetsRaw) {
    console.error('❌ tweets.js non trovato!');
    process.exit(1);
  }
  console.log(`   Trovati: ${tweetsRaw.length.toLocaleString()} tweet totali\n`);

  // 2. Filter & process
  console.log('🔍 Filtro e processamento...');
  const byYear          = {};
  let excludedReplies   = 0;
  let excludedRTs       = 0;
  let included          = 0;

  for (const raw of tweetsRaw) {
    const t = raw.tweet || raw;
    const filter = shouldInclude(t);
    if (!filter.include) {
      if (filter.reason === 'rt') excludedRTs++;
      else excludedReplies++;
      continue;
    }
    const processed = processTweet(raw);
    const year = processed.created_at.slice(0, 4);
    if (!byYear[year]) byYear[year] = [];
    byYear[year].push(processed);
    included++;
  }

  console.log(`   ✅ Inclusi: ${included.toLocaleString()} tweet (originali e thread personali)`);
  console.log(`   ❌ Esclusi: ${excludedRTs.toLocaleString()} retweet (RT di terzi)`);
  console.log(`   ❌ Esclusi: ${excludedReplies.toLocaleString()} risposte ad altri utenti\n`);

  // Sort each year newest-first
  for (const year of Object.keys(byYear)) {
    byYear[year].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // 3. Create output dirs
  fs.mkdirSync(OUT_DATA, { recursive: true });

  // 4. Write year files
  console.log('💾 Scrittura file per anno...');
  const years      = Object.keys(byYear).sort().reverse(); // newest first
  const yearCounts = {};

  for (const year of Object.keys(byYear)) {
    const tweets     = byYear[year];
    const jsonStr    = JSON.stringify(tweets);
    const outFile    = path.join(OUT_DATA, `tweets-${year}.json`);
    const outJsFile  = path.join(OUT_DATA, `tweets-${year}.js`);
    fs.writeFileSync(outFile, jsonStr, 'utf8');
    fs.writeFileSync(outJsFile, `window.ARCHIVE_TWEETS = window.ARCHIVE_TWEETS || {};\nwindow.ARCHIVE_TWEETS["${year}"] = ${jsonStr};\n`, 'utf8');
    yearCounts[year] = tweets.length;
    console.log(`   ${year}: ${tweets.length.toLocaleString().padStart(6)} tweet → tweets-${year}.json & .js`);
  }

  // 5. Load profile (public fields only — NO email, NO IP)
  console.log('\n👤 Lettura profilo...');
  const profileData  = loadDataFile('profile.js');
  const accountData  = loadDataFile('account.js');

  const profile = profileData?.[0]?.profile || {};
  const account = accountData?.[0]?.account || {};

  // Avatar: check local profile_media first
  const profileMediaDir = path.join(ARCHIVE, 'profile_media');
  let avatarLocal = null;
  if (fs.existsSync(profileMediaDir)) {
    const avatarFiles = fs.readdirSync(profileMediaDir)
      .filter(f => f.includes('edpovFA7')); // avatar file (not header)
    if (avatarFiles.length > 0) {
      avatarLocal = `assets/images/${avatarFiles[0]}`;
    }
  }

  // 6. Write manifest.json and manifest.js (ONLY public, non-sensitive data)
  const manifest = {
    profile: {
      username:    account.username    || USERNAME,
      displayName: account.accountDisplayName || 'Marco Maroni',
      createdAt:   account.createdAt   || '',
      bio:         profile.description?.bio      || '',
      website:     profile.description?.website  || '',
      location:    profile.description?.location || '',
      avatarLocal,
      avatarUrl:   profile.avatarMediaUrl  || '',
      headerUrl:   profile.headerMediaUrl  || ''
    },
    years,
    tweetCounts: yearCounts,
    totalTweets: included,
    generatedAt: new Date().toISOString()
  };

  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestFile = path.join(OUT_DATA, 'manifest.json');
  fs.writeFileSync(manifestFile, manifestJson, 'utf8');
  const manifestJsFile = path.join(OUT_DATA, 'manifest.js');
  fs.writeFileSync(manifestJsFile, `window.ARCHIVE_MANIFEST = ${manifestJson};\n`, 'utf8');
  console.log(`   Manifest scritto: ${included.toLocaleString()} tweet, ${years.length} anni`);

  // 7. Copy avatar image
  console.log('\n🖼️  Copia avatar...');
  const imgDir = path.join(DOCS, 'assets', 'images');
  fs.mkdirSync(imgDir, { recursive: true });

  if (fs.existsSync(profileMediaDir)) {
    const files = fs.readdirSync(profileMediaDir);
    for (const f of files) {
      const src = path.join(profileMediaDir, f);
      const dst = path.join(imgDir, f);
      fs.copyFileSync(src, dst);
      console.log(`   Copiato: ${f}`);
    }
  }

  console.log('\n✅ Processing completato!');
  console.log('\nProssimi passi:');
  console.log('  1. Esegui: node scripts/copy_media.js   (copia i 4648 file media)');
  console.log('  2. Apri:   docs/index.html              (verifica il sito)');
  console.log('  3. Deploy: GitHub Pages → /docs folder\n');
}

main().catch(err => {
  console.error('❌ Errore:', err);
  process.exit(1);
});
