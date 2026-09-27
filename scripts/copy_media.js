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
  console.log('📁 Copia file media tweet...\n');

  if (!fs.existsSync(SRC_DIR)) {
    console.error('❌ Cartella tweets_media non trovata:', SRC_DIR);
    process.exit(1);
  }

  fs.mkdirSync(DST_DIR, { recursive: true });

  const files = fs.readdirSync(SRC_DIR);
  const total = files.length;

  console.log(`Trovati: ${total.toLocaleString()} file\n`);

  let copied  = 0;
  let skipped = 0;
  let errors  = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const src  = path.join(SRC_DIR, file);
    const dst  = path.join(DST_DIR, file);

    try {
      // Skip if already exists and same size
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

    // Progress every 500 files
    if ((i + 1) % 500 === 0 || i === files.length - 1) {
      const pct = Math.round(((i + 1) / total) * 100);
      process.stdout.write(`\r  Progresso: ${i + 1}/${total} (${pct}%) — copiati: ${copied}, saltati: ${skipped}`);
    }
  }

  console.log('\n');
  console.log(`✅ Completato!`);
  console.log(`   Copiati:  ${copied.toLocaleString()}`);
  console.log(`   Saltati:  ${skipped.toLocaleString()} (già esistenti)`);
  if (errors > 0) console.log(`   Errori:   ${errors}`);

  // Calculate total size
  const totalBytes = files.reduce((acc, f) => {
    try { return acc + fs.statSync(path.join(DST_DIR, f)).size; } catch { return acc; }
  }, 0);
  console.log(`   Dimensione totale: ${(totalBytes / 1024 / 1024).toFixed(1)} MB\n`);
}

main().catch(err => {
  console.error('❌ Errore:', err);
  process.exit(1);
});
