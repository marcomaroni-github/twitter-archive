# Twitter Archive Site

Trasforma l'archivio scaricato da Twitter/X in un sito statico da pubblicare
dove vuoi, senza esporre i tuoi dati privati.

Formato supportato: l'archivio di Twitter come esportato ad aprile 2024.

## Cosa serve

- [Node.js](https://nodejs.org) 18 o successivo
- L'archivio di Twitter (`.zip`), da richiedere su Twitter/X in
  *Impostazioni → Il tuo account → Scarica un archivio dei tuoi dati*

## Crea il tuo sito

1. Scarica questo progetto (pulsante verde **Code** → **Download ZIP**, poi estrailo) oppure clonalo con git.
2. Copia lo `.zip` dell'archivio nella cartella `archive`. Se Twitter l'ha diviso in più zip, copiali tutti.
3. Apri un terminale nella cartella del progetto e lancia:

   ```
   npm install
   npm run build
   ```

4. Rispondi a poche domande. Premendo Invio accetti il default prudente.
5. Apri `site/index.html` con un doppio clic per controllare il risultato.
6. Pubblica la cartella `site` (vedi [Pubblicazione](#pubblicazione)).

Le risposte vengono salvate in `config.json`: il `npm run build` successivo non chiede nulla.

La cartella `site` viene cancellata e ricreata a ogni build: non aggiungerci
file a mano. Mettili invece nella cartella `extra`: tutto quello che contiene
(tranne il suo README) viene copiato in `site` a ogni build.

| Comando | Cosa fa |
|---|---|
| `npm run build` | Genera il sito (fa domande solo la prima volta) |
| `npm run build -- --reconfigure` | Ripropone le domande |
| `npm run build -- --yes` | Non chiede mai; usa `config.json` o i default |
| `npm run build -- --debug` | Mostra i dettagli tecnici in caso di errore |

Se interrompi una build (Ctrl+C o chiudendo il terminale), la copia temporanea
dell'archivio viene cancellata; quello che eventualmente resta viene cancellato
all'avvio della build successiva.

**Git Bash su Windows:** il suo terminale (mintty) non mostra le domande
iniziali. Lancia `npm run build` da PowerShell, Prompt dei comandi o Windows
Terminal, oppure modifica `config.json` a mano, oppure lancia
`npm run build -- --reconfigure` da uno di quei terminali.

## Cosa viene pubblicato e cosa no

Pubblicato:
- I tuoi tweet e le risposte che hai scritto nei tuoi thread
- Le loro foto e i video (dalle immagini vengono tolti posizione e dati della fotocamera)
- Nome, username, bio, avatar e copertina come appaiono nel profilo
- Retweet e risposte ad altri utenti **solo se lo scegli** (default: no)

Mai pubblicato, qualunque cosa tu scelga:
- Messaggi diretti, email, numero di telefono, indirizzi IP
- Follower, seguiti, like, blocchi, silenziati, liste, dati pubblicitari
- Tweet cancellati
- Il dispositivo da cui hai twittato e la posizione associata ai tweet

Lo strumento legge dall'archivio solo i file che gli servono. Se un tuo tweet
contiene la tua email, il tuo numero di telefono o un tuo indirizzo IP, quel
tweet viene nascosto; se li contiene la bio o il sito web che hai scelto, quel
campo resta vuoto. Il riepilogo finale indica quanti tweet sono stati nascosti
(mai i valori). Come ultima protezione, dopo la generazione cerca nel sito la
tua email, il tuo numero di telefono e i tuoi indirizzi IP: se li trova,
cancella il sito e si ferma.

Le menzioni di altre persone (`@nome`) dentro i tuoi tweet restano come sono,
perché erano già pubbliche.

Per default il sito chiede ai motori di ricerca di non indicizzarlo. Puoi
cambiarlo durante le domande iniziali.

## Pubblicazione

La cartella `site` è un normale sito statico: caricala dove preferisci.

- **GitHub Pages**: crea un nuovo repository, mettici il contenuto di `site`,
  poi *Settings → Pages → Deploy from a branch*. GitHub rifiuta file oltre
  100 MB e consiglia siti sotto 1 GB: la build ti avvisa se li superi.
  Per un dominio personalizzato, crea un file `extra/CNAME` che contiene solo il
  tuo dominio (es. `tweets.example.org`): viene copiato in `site` a ogni build.
- **Netlify**: trascina la cartella `site` su <https://app.netlify.com/drop>.
- **Un tuo server**: copia il contenuto di `site` nella cartella pubblica.

Non pubblicare mai la cartella `archive` né `config.json`.

## Sviluppo

```
npm test
```

I test usano un piccolo archivio finto in `test/helpers/fixture.js`, mai dati reali.
