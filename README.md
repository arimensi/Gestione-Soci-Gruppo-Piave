# Gestione Soci - Gruppo Aeromodellistico Piave

App web (statica, nessun server/database) per gestire lo storico dei soci del
gruppo: elenco completo filtrabile/ordinabile, soci attivi dell'anno in corso
(con limite di legge di 90), aggiunta e modifica dei dati anagrafici.

I dati vengono salvati in un **file JSON su Google Drive**, condiviso tra le
persone autorizzate: non serve un server ne' un database, Google Drive fa da
"archivio comune".

## Prima di iniziare: cosa serve

1. Un account Google (va bene anche uno nuovo creato apposta per il gruppo,
   es. `gruppopiave@gmail.com`, cosi' il file resta di proprieta' del gruppo
   e non di una singola persona).
2. Un account GitHub (gratuito) per pubblicare la pagina web - oppure, se
   preferisci, l'app funziona anche aperta localmente dal computer (vedi
   sotto "Uso senza pubblicazione online").

---

## Passo 1 - Creare le credenziali Google (una tantum)

Questo passaggio lo deve fare una persona con un account Google, tramite il
browser (io non posso farlo al posto vostro: richiede il login al vostro
account).

1. Vai su [Google Cloud Console](https://console.cloud.google.com/) e crea un
   nuovo progetto (es. "Gruppo Piave Soci").
2. Nel menu, vai su **API e servizi > Libreria**, cerca **Google Drive API**
   e clicca **Abilita**.
3. Vai su **API e servizi > Schermata consenso OAuth**:
   - Tipo utente: **Esterno**.
   - Nome app: "Gestione Soci Gruppo Piave", email di contatto: la vostra.
   - Nella sezione **Ambiti (scopes)** non serve aggiungere nulla qui.
   - Nella sezione **Utenti di test**, aggiungi gli indirizzi email Google di
     tutte le persone che useranno l'app (es. tuo padre, altri consiglieri).
     Finche' l'app resta in modalita' "Testing" (impostazione di default,
     va benissimo per questo uso) solo questi account potranno accedere.
   - Salva. Non serve pubblicare/verificare l'app presso Google.
4. Vai su **API e servizi > Credenziali > Crea credenziali > ID client
   OAuth**:
   - Tipo applicazione: **Applicazione web**.
   - Nome: "Gestione Soci - web".
   - In **Origini JavaScript autorizzate** aggiungi l'indirizzo dove sara'
     pubblicata la pagina, es. `https://<tuonomeutente>.github.io` (vedi
     Passo 3). Se vuoi provarla anche in locale, aggiungi anche
     `http://localhost:8765`.
   - Crea. Copia il **Client ID** generato (una stringa che finisce con
     `.apps.googleusercontent.com`).

5. Apri il file [`js/drive.js`](js/drive.js) di questo progetto e sostituisci
   la riga:
   ```js
   export const GOOGLE_CLIENT_ID = "INSERISCI_QUI_IL_TUO_CLIENT_ID.apps.googleusercontent.com";
   ```
   con il Client ID copiato al punto 4.

> Nota: l'app chiede il permesso di accesso completo a Google Drive
> dell'account con cui si accede (non solo ai file creati dall'app). E' una
> scelta fatta per semplicita' (evita di dover integrare il "selettore file"
> di Google), accettabile perche' l'app resta in modalita' Testing e solo le
> persone che aggiungete come utenti di test possono accedervi.

---

## Passo 2 - Primo avvio e importazione dello storico

1. Apri `index.html` (vedi Passo 3 per pubblicarlo online, oppure aprilo
   anche solo facendo doppio clic, anche se alcune funzioni di Google
   potrebbero richiedere che la pagina sia servita da un indirizzo
   `http://` o `https://` e non da un file locale `file://`).
2. Vai nella scheda **Impostazioni / Sync**.
3. In "Importa dati iniziali", seleziona il file
   `soci-dati-iniziali-GAP.json` che trovi nella cartella **Download** del
   computer (e' stato generato automaticamente a partire dai PDF storici che
   avevi fornito: 409 soci, di cui 90 segnati come attivi per il 2026).
4. Clicca "Accedi con Google" e autorizza con l'account che avete scelto per
   il gruppo.
5. Clicca "Crea nuovo file dati su Drive": verra' creato il file
   `soci-gruppo-piave.json` su Google Drive con tutti i dati importati.
6. Apri il link al file su Google Drive (mostrato nella pagina) e
   condividilo (tasto "Condividi" di Drive) con gli account Google delle
   altre persone che useranno l'app - **devono essere anche loro negli
   "utenti di test"** aggiunti al Passo 1.
7. Le altre persone, al loro primo accesso, useranno "Connetti a file
   esistente" incollando il link del file condiviso, invece di crearne uno
   nuovo.

### Dati da verificare

Durante l'importazione automatica dai PDF sono stati segnalati con una nota
(icona ⚠ nella tabella, filtro "Solo con nota" nello Storico) 62 soci con
piccole anomalie nei dati originali, principalmente:
- **20 numeri di tessera duplicati** (assegnati per errore a due persone
  diverse nel corso degli anni) - conviene assegnare un nuovo numero a uno
  dei due.
- 2 date di nascita palesemente errate nel documento originale (es. anno
  "967" o "1691").
- Alcuni luoghi di nascita troncati nel documento originale (es.
  "Castellammare D...").

Nessuno di questi problemi blocca l'uso dell'app: sono solo da sistemare con
calma dalla scheda di modifica del socio.

---

## Passo 3 - Pubblicare la pagina online (GitHub Pages, gratuito)

1. Crea un account su [github.com](https://github.com) se non ne hai gia'
   uno.
2. Crea un nuovo repository (es. "soci-gruppo-piave"), anche privato.
3. Carica tutti i file di questa cartella nel repository (tramite il sito di
   GitHub con "Add file > Upload files", oppure con `git` da riga di
   comando: chiedi pure a me se vuoi che prepari i comandi).
4. Nel repository, vai su **Settings > Pages**, imposta "Deploy from a
   branch", branch `main`, cartella `/ (root)`. Salva.
5. Dopo un paio di minuti la pagina sara' raggiungibile su
   `https://<tuonomeutente>.github.io/soci-gruppo-piave/`.
6. Torna al Passo 1.4 e verifica che questo indirizzo sia tra le "Origini
   JavaScript autorizzate" del Client ID (altrimenti l'accesso Google non
   funzionera').

## Uso senza pubblicazione online

Se preferite non pubblicare nulla online, potete comunque usare l'app aprendo
`index.html` con un piccolo server locale (ad esempio, con Python gia'
installato sul PC: aprire il Prompt dei comandi nella cartella del progetto e
digitare `python -m http.server 8765`, poi aprire
`http://localhost:8765` nel browser). In questo caso ogni persona dovra'
avviare questo comando sul proprio computer con una copia dei file del
progetto. La sincronizzazione via Google Drive funziona comunque allo stesso
modo.

---

## Note tecniche

- Nessun server, nessun database: solo file statici (HTML/CSS/JS) + Google
  Drive come archivio dati condiviso.
- I dati restano salvati anche localmente nel browser (per continuare a
  lavorare offline); il pulsante **"Salva su Drive"** compare quando ci sono
  modifiche non ancora sincronizzate.
- Se due persone modificano i dati nello stesso momento, l'app se ne accorge
  al salvataggio e chiede se ricaricare i dati piu' recenti o sovrascriverli:
  non c'e' fusione automatica riga per riga, quindi conviene evitare di
  lavorare in contemporanea sugli stessi soci.
- In modalita' "Testing" di Google, l'accesso va rifatto ogni 7 giorni circa
  (richiesta di Google per le app non pubblicate): basta cliccare di nuovo
  "Accedi con Google", non si perde nulla.
- Eta' e anzianita' vengono ricalcolate automaticamente ad ogni apertura
  della pagina (non restano "congelate" alla data di importazione, a
  differenza dei vecchi PDF).
