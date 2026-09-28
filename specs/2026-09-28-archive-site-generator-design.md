# Generatore di siti statici da archivio Twitter — Design

Data: 2026-09-28
Stato: approvato in brainstorming, in attesa di revisione della spec

## Obiettivo

Trasformare questo progetto, oggi legato all'archivio di @marcomaroni, in uno
strumento che chiunque possa usare per generare un sito statico pubblico a
partire dal proprio archivio esportato da Twitter, nel rispetto della privacy.

Formato supportato: l'export di Twitter com'era ad aprile 2024, riconoscibile da
`data/manifest.js` che definisce `window.__THAR_CONFIG`.

## Destinatari e vincoli

- Utenti con un minimo di dimestichezza tecnica: sanno installare Node.js e
  incollare comandi nel terminale.
- Requisito: Node.js 18 o superiore.
- I comandi devono essere il minimo indispensabile.
- Il sito generato è pubblico: nessun dato privato del proprietario deve
  finire nell'output, per nessuna combinazione di opzioni.
- Nessuna chiamata di rete durante la build.

## Flusso utente

1. Scarica o clona il repository.
2. Copia lo zip dell'archivio Twitter (o più zip, se diviso in parti, oppure la
   cartella già estratta) dentro `archive/`.
3. `npm install`
4. `npm run build`: la procedura guidata fa poche domande, premendo Invio si
   accettano i default prudenti. Le risposte vengono salvate in `config.json`.
5. Apre `site/index.html` con doppio clic per verificare il risultato
   (funziona da `file://`).
6. Pubblica la cartella `site/` dove preferisce (GitHub Pages, Netlify, server).

Build successive: `npm run build` riusa `config.json` senza fare domande.

Opzioni della CLI:
- `--reconfigure`: ripropone la procedura guidata.
- `--yes`: nessuna domanda; usa `config.json` se esiste, altrimenti i default.
- `--debug`: mostra lo stack trace degli errori inattesi.

## Struttura del repository

```
archive/            gitignored — input dell'utente
site/               gitignored — output generato
config.json         gitignored — risposte della procedura guidata
src/
  cli.js            punto d'ingresso (npm run build), parsing flag, orchestrazione
  wizard.js         domande interattive, lettura/scrittura config.json
  archive/
    locate.js       individua zip o cartella in archive/, estrae in temp
    read.js         legge solo i file in allowlist, guidato da manifest.js
  pipeline/
    filter.js       regole di inclusione
    transform.js    tweet grezzo → tweet pubblico (allowlist di campi)
    media.js        copia media inclusi, rimozione metadati
  privacy/
    guard.js        scansione finale dell'output
  site/
    write.js        copia template, compila index.html, scrive i dati
template/           frontend statico generico (derivato da docs/)
  index.html
  assets/css/style.css
  assets/js/app.js
  assets/images/defaultAvatar.svg, favicon.ico
  i18n/it.js, i18n/en.js
test/
  fixtures/         archivio finto minimo, creato a mano
  *.test.js         test con node:test
specs/              documenti di design
README.md           in inglese
README.it.md        in italiano
```

Migrazione del sito esistente: `docs/` (dati, media, `CNAME`) esce da questo
repository. Il sito twitter-archive.marcomaroni.it viene rigenerato con lo
strumento e pubblicato da un repository separato. Gli script
`scripts/process_tweets.js` e `scripts/copy_media.js` vengono rimossi, sostituiti
dalla pipeline.

Dipendenze npm previste: una libreria per leggere zip in streaming (es.
`yauzl`) e una per i prompt interattivi (es. `prompts`). Nessuna libreria per
le immagini.

## Pipeline

### 1. locate (`src/archive/locate.js`)

- Se in `archive/` ci sono file `.zip`, li considera parti dello stesso archivio
  e li estrae tutti nella stessa cartella temporanea di sistema
  (`os.tmpdir()`). La cartella viene rimossa a fine build, anche in caso di
  errore.
- Se non ci sono zip, cerca `data/manifest.js` in `archive/` fino a due livelli
  di profondità (gestisce la cartella annidata tipica dell'estrazione su
  Windows).
- Errori con messaggio e azione suggerita: `archive/` vuota o assente; più
  archivi distinti (due `manifest.js` con `accountId` diversi, o sia zip sia
  cartella estratta); zip corrotto.
- Restituisce il percorso della radice dell'archivio (la cartella che contiene
  `data/`).

### 2. read (`src/archive/read.js`)

- Interpreta `data/manifest.js` rimuovendo il prefisso
  `window.__THAR_CONFIG =` e facendo il parse del JSON. Se il prefisso manca:
  errore "formato non supportato".
- Da `manifest.dataTypes` legge l'elenco dei file per: `tweets`, `noteTweet`,
  `profile`, `account`; e `tweets.mediaDirectory` per i media. Ogni file YTD
  viene interpretato rimuovendo il prefisso `window.YTD.<nome>.partN =`.
- Legge l'elenco dei file di `profile_media/` (avatar e header).
- Nessun altro file viene aperto da questo modulo. L'allowlist è una costante
  esplicita nel codice ed è coperta da test. L'unico altro modulo che legge
  dall'archivio è `guard` (vedi sotto), con una propria allowlist separata.
- Restituisce `{ user, tweets, noteTweets, profile, account, mediaDir, profileMedia }`.
  `user` contiene `accountId`, `userName`, `displayName` da `userInfo`.

### 3. filter (`src/pipeline/filter.js`)

Funzione pura `shouldInclude(tweet, user, options) → { include, reason }`.

- Retweet (`full_text` inizia con `RT @` oppure `retweeted` è vero): esclusi,
  salvo `options.includeRetweets`.
- Risposte ad altri utenti (`in_reply_to_status_id` presente e
  `in_reply_to_user_id` diverso da `user.accountId`): escluse, salvo
  `options.includeReplies`.
- Tweet originali e risposte a se stessi (thread): sempre inclusi.
- `reason` è uno tra `retweet`, `reply`, usato per il riepilogo.

Post lunghi: per ogni tweet incluso, se esiste in `note-tweet.js` una nota con
lo stesso `createdAt` (confronto al secondo), il testo del tweet viene
sostituito con `noteTweet.core.text`.

### 4. transform (`src/pipeline/transform.js`)

Funzione pura che produce il tweet pubblico con questi soli campi:

| Campo | Origine |
|---|---|
| `id` | `id_str` |
| `created_at` | `created_at` convertito in ISO 8601 |
| `text` | `full_text` (o testo della nota) con entità HTML decodificate |
| `urls` | `entities.urls` → `{ url, expanded_url, display_url }` |
| `mentions` | `entities.user_mentions` → `{ name, screen_name }` |
| `hashtags` | `entities.hashtags` → testo |
| `media` | `extended_entities.media` (o `entities.media`) → `{ type, url, local, video_url? }` |
| `in_reply_to_status_id` | solo se è una risposta a se stessi; altrimenti `null` |
| `in_reply_to_screen_name` | solo se `includeReplies` e la risposta è ad altri; altrimenti `null` |
| `retweet_count`, `favorite_count` | interi |
| `lang` | `lang` |

Tutto il resto viene scartato, in particolare `source`, `geo`, `coordinates`,
`place`, `edit_info`, `display_text_range`, `in_reply_to_user_id`.

Le menzioni di terzi restano così come sono (erano già pubbliche). Un'opzione
di anonimizzazione è fuori ambito per questa versione.

`media.local` è `tweets_media/<id>-<nomefile>` se il file esiste nella cartella
media dell'archivio, altrimenti `null` (il frontend usa `url` remoto come
ripiego).

### 5. media (`src/pipeline/media.js`)

- Copia in `site/tweets_media/` solo i file referenziati da `media.local` dei
  tweet inclusi.
- JPEG: rimuove i segmenti APP1 (EXIF/XMP), APP13 (IPTC) e COM. PNG: rimuove i
  chunk `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME`. Implementato senza librerie,
  operando sui byte. Se il file non è riconosciuto come JPEG/PNG valido, viene
  copiato così com'è (video e GIF di Twitter sono già ricodificati dalla
  piattaforma).
- Stessa pulizia per avatar e header, copiati come
  `site/assets/images/avatar.<ext>` e `site/assets/images/header.<ext>`.
  L'avatar è il file di `profile_media/` il cui nome contiene l'ultimo segmento
  di `profile.avatarMediaUrl` (senza estensione); l'header quello che contiene
  l'ultimo segmento di `profile.headerMediaUrl`.
- Avvisi (non bloccanti): singolo file oltre 100 MB; totale oltre 1 GB.

### 6. guard (`src/privacy/guard.js`)

- Prima della build, legge in memoria dall'archivio: email da `account.js`,
  numeri da `phone-number.js`, IP da `account-creation-ip.js` e `ip-audit.js`.
  Questi valori non vengono passati ad alcun altro modulo, né loggati.
- Dopo la scrittura di `site/`, scansiona tutti i file di testo (`.html`,
  `.js`, `.css`, `.json`, `.txt`) cercando quei valori (confronto senza
  distinzione maiuscole/minuscole; per i telefoni anche con le sole cifre).
- Se trova una corrispondenza: cancella `site/`, termina con codice di uscita
  diverso da zero e un messaggio che indica il tipo di dato e il file, mai il
  valore.
- Se un file sensibile manca nell'archivio, il relativo controllo viene saltato
  senza errore.

### 7. write (`src/site/write.js`)

- Svuota e ricrea `site/`.
- Copia `template/` in `site/`, includendo solo `i18n/<lingua scelta>.js`.
- Compila `index.html` sostituendo segnaposto per: `lang`, `<title>`,
  meta description, meta `robots` (`noindex, nofollow` se l'opzione è attiva,
  altrimenti assente), nome e username iniziali, testo del footer.
  I valori vengono sottoposti a escape HTML.
- Scrive `site/data/manifest.js` (`window.ARCHIVE_MANIFEST = …`) con: profilo
  pubblico (username, displayName, createdAt, bio, website, location, percorsi
  locali di avatar e header), anni, conteggi per anno, totale, lingua,
  data di export dell'archivio.
- Scrive `site/data/tweets-<anno>.js` (`window.ARCHIVE_TWEETS["<anno>"] = …`),
  tweet ordinati dal più recente. Nessun file `.json` duplicato.

## Procedura guidata (`src/wizard.js`)

Domande, nell'ordine, con default:

1. Lingua del sito: `it` / `en`. Default: la più frequente tra i `lang` dei
   tweet se è `it`, altrimenti `en`.
2. Titolo del sito. Default: `<displayName> — Archivio Twitter` /
   `<displayName> — Twitter archive`.
3. Includere i retweet? Default: no.
4. Includere le risposte ad altri utenti? Default: no.
5. Nascondere il sito ai motori di ricerca? Default: sì.
6. Sito web da mostrare nel profilo. Default: vuoto (il valore in `profile.js`
   è un link `t.co` non espandibile senza rete).

Le risposte vengono salvate in `config.json`. Un `config.json` con campi
mancanti o non validi viene completato con i default, segnalando i campi
corretti.

## Frontend (`template/`)

Derivato dall'attuale `docs/`, con queste modifiche:

- Nessun riferimento scritto a mano al proprietario (nome, username,
  `ACCOUNT_ID`, nomi dei file di avatar e header): tutto da
  `window.ARCHIVE_MANIFEST`.
- Tutte le stringhe dell'interfaccia da `window.ARCHIVE_I18N`, definito in
  `i18n/<lingua>.js`, caricato prima di `app.js`.
- Date formattate con `Intl.DateTimeFormat` nella lingua del sito.
- Caricamento dei dati tramite tag `<script>` come oggi, così il sito funziona
  anche da `file://`.

## Errori e output

- Errori previsti (archivio assente, zip corrotto, formato non supportato,
  Node < 18, spazio su disco insufficiente, blocco di guard): messaggio di una
  o due righe con causa e azione suggerita, senza stack trace, codice di uscita
  diverso da zero.
- Errori inattesi: messaggio generico; stack trace solo con `--debug`.
- Riepilogo finale: tweet inclusi; esclusi per motivo; numero e dimensione dei
  media; avvisi; prossimi passi (aprire `site/index.html`, pubblicare `site/`).

## Test

Test runner integrato (`node --test`), eseguiti con `npm test`, su un archivio
finto in `test/fixtures/` creato a mano. L'archivio reale non viene mai usato
come fixture.

Copertura minima:
- `locate`: zip singolo, zip multipli, cartella estratta, cartella annidata,
  archivio assente, archivi distinti.
- `read`: file dei tweet divisi in parti; allowlist (un file non ammesso
  presente nella fixture, es. `direct-messages.js`, non viene mai aperto);
  formato non supportato.
- `filter`: retweet, risposta ad altri, risposta a se stessi, con opzioni
  attive e non; sostituzione del testo dei post lunghi.
- `transform`: nessun campo fuori allowlist nell'output, in particolare
  `geo`, `coordinates`, `place`, `source`.
- `media`: JPEG con EXIF GPS in input → nessun segmento APP1 in output; PNG
  con `tEXt` → chunk rimosso; file non riconosciuto copiato identico.
- `guard`: email del proprietario inserita nell'output → build bloccata e
  `site/` rimossa; il messaggio non contiene l'email.
- Build completa sulla fixture: `site/` contiene i file attesi e nessun dato
  sensibile della fixture.

## Documentazione

- `README.md` (inglese) e `README.it.md` (italiano): requisiti, i sei passi del
  flusso utente, opzioni della CLI, sezione "Cosa viene pubblicato e cosa no"
  scritta per non tecnici, guida breve alla pubblicazione su GitHub Pages e
  Netlify, avviso sui limiti di dimensione.

## Fuori ambito

- Distribuzione via `npx` o eseguibile autonomo.
- Anonimizzazione delle menzioni.
- Generazione del sito nel browser.
- Formati d'archivio successivi ad aprile 2024.
- Pagine HTML per singolo tweet.
