#!/usr/bin/env node
/**
 * copy_media.js
 * 
 * Copia i file media dei tweet (4648 file) da original-archive/ a docs/
 * Esegui dopo process_tweets.js
 * 
 * Usage: node scripts/copy_media.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT     = path.resolve(__dirname, '..');
const SRC_DIR  = path.join(ROOT, 'original-archive', 'data', 'tweets_media');
const DST_DIR  = path.join(ROOT, 'docs', 'tweets_media');

async function main() {
  console.log('📁 Sincronizzazione file media tweet...\n');

  if (!fs.existsSync(SRC_DIR)) {
    console.error('❌ Cartella tweets_media non trovata:', SRC_DIR);
    process.exit(1);
  }

  const dataDir = path.join(ROOT, 'docs', 'data');
  if (!fs.existsSync(dataDir)) {
    console.error('❌ docs/data non trovata! Esegui prima process_tweets.js');
    process.exit(1);
  }

  // 1. Raccoglie tutti i media referenziati dai tweet inclusi
  const jsonFiles = fs.readdirSync(dataDir).filter(f => f.startsWith('tweets-') && f.endsWith('.json'));
  const neededMedia = new Set();

  for (const jf of jsonFiles) {
    const tweets = JSON.parse(fs.readFileSync(path.join(dataDir, jf), 'utf8'));
    for (const t of tweets) {
      if (t.media && t.media.length) {
        for (const m of t.media) {
          if (m.local) {
            neededMedia.add(path.basename(m.local));
          }
        }
      }
    }
  }

  console.log(`Media referenziati nei tweet inclusi: ${neededMedia.size.toLocaleString()} file\n`);

  fs.mkdirSync(DST_DIR, { recursive: true });

  // 2. Rimuove i file non più necessari in docs/tweets_media/
  const existingFiles = fs.readdirSync(DST_DIR);
  let removed = 0;
  for (const f of existingFiles) {
    if (!neededMedia.has(f)) {
      try {
        fs.unlinkSync(path.join(DST_DIR, f));
        removed++;
      } catch (err) {
        console.warn(`  Non posso rimuovere ${f}: ${err.message}`);
      }
    }
  }
  if (removed > 0) {
    console.log(`🗑️  Rimossi ${removed.toLocaleString()} file media non più utilizzati (ex-RT o risposte)`);
  }

  // 3. Copia i file necessari se mancanti
  let copied  = 0;
  let skipped = 0;
  let errors  = 0;

  const neededList = Array.from(neededMedia);
  for (let i = 0; i < neededList.length; i++) {
    const file = neededList[i];
    const src  = path.join(SRC_DIR, file);
    const dst  = path.join(DST_DIR, file);

    if (!fs.existsSync(src)) {
      continue; // media not in original archive
    }

    try {
      if (fs.existsSync(dst)) {
        const srcStat = fs.statSync(src);
        const dstStat = fs.statSync(dst);
        if (srcStat.size === dstStat.size) {
          skipped++;
          continue;
        }
      }
      fs.copyFileSync(src, dst);
      copied++;
    } catch (err) {
      console.error(`  ❌ Errore su ${file}: ${err.message}`);
      errors++;
    }

    if ((i + 1) % 500 === 0 || i === neededList.length - 1) {
      const pct = Math.round(((i + 1) / neededList.length) * 100);
      process.stdout.write(`\r  Progresso: ${i + 1}/${neededList.length} (${pct}%) — copiati: ${copied}, mantenuti: ${skipped}`);
    }
  }

  console.log('\n');
  console.log(`✅ Completato!`);
  console.log(`   Mantenuti esistenti: ${skipped.toLocaleString()}`);
  console.log(`   Nuovi copiati:       ${copied.toLocaleString()}`);
  console.log(`   Rimossi obsoleti:    ${removed.toLocaleString()}`);
  if (errors > 0) console.log(`   Errori:              ${errors}`);

  const remainingFiles = fs.readdirSync(DST_DIR);
  const totalBytes = remainingFiles.reduce((acc, f) => {
    try { return acc + fs.statSync(path.join(DST_DIR, f)).size; } catch { return acc; }
  }, 0);
  console.log(`   File totali presenti: ${remainingFiles.length.toLocaleString()}`);
  console.log(`   Dimensione totale:    ${(totalBytes / 1024 / 1024).toFixed(1)} MB\n`);
}

main().catch(err => {
  console.error('❌ Errore:', err);
  process.exit(1);
});
