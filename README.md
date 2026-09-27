# twitter-archive.marcomaroni.it

Archivio pubblico dei tweet di [@marcomaroni](https://twitter.com/marcomaroni) (2008–2024).

Esportato da Twitter in aprile 2024, prima della migrazione a Bluesky.

## Struttura del progetto

```
.
├── docs/                   ← Sito pubblico (GitHub Pages source)
│   ├── index.html
│   ├── assets/
│   │   ├── css/style.css
│   │   └── js/app.js
│   ├── data/               ← Dati filtrati e anonimizzati (.js e .json)
│   │   ├── manifest.js / manifest.json
│   │   └── tweets-<anno>.js / tweets-<anno>.json
│   └── tweets_media/       ← Media allegati ai tweet (generato da copy_media.js)
├── scripts/
│   ├── process_tweets.js   ← Genera docs/data/ da original-archive/
│   └── copy_media.js       ← Copia i file media in docs/tweets_media/
└── original-archive/       ← ⚠️ GITIGNORED — archivio grezzo con dati sensibili
```

> **⚠️ IMPORTANTE**: La cartella `original-archive/` è esclusa da git (`.gitignore`).
> Contiene dati sensibili (email, IP, DM, blocchi, following) che non devono MAI
> essere pubblicati. Rimane solo in locale.

## Visualizzazione locale

Puoi visualizzare l'archivio semplicemente aprendo con un doppio clic il file `docs/index.html` nel browser (supportato nativamente senza bisogno di server web locale), oppure tramite qualsiasi web server locale.

## Setup locale

Per rigenerare i dati processati da zero:

```powershell
# 1. Processa i tweet (genera docs/data/)
node scripts/process_tweets.js

# 2. Copia i file media (4648 file → docs/tweets_media/)
node scripts/copy_media.js
```

## Tweet inclusi

Il sito mostra solo tweet pubblici:
- ✅ Tweet originali
- ✅ Retweet di altri utenti
- ✅ Continuazioni di thread propri (self-reply)
- ❌ Risposte ad altri utenti (escluse)

## Sito

🌐 [twitter-archive.marcomaroni.it](https://twitter-archive.marcomaroni.it)
