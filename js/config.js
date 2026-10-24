// Configurazione del gruppo: le uniche righe da modificare per personalizzare
// l'app (nessun valore qui e' un segreto: l'ID client OAuth e' pensato per
// essere pubblico, vedi README.md per i dettagli di sicurezza).

// Identificativo dell'app OAuth creata su Google Cloud Console.
export const GOOGLE_CLIENT_ID = "223079985709-imr1aidpeoc3cmh1p3m4iv6ast93fbes.apps.googleusercontent.com";

// ID del file soci "canonico" su Google Drive (quello creato una tantum con
// "Crea nuovo file dati su Drive").
export const DRIVE_FILE_ID = "1_zJSxSsA-nfg_VnjsskauJOHqj1Iwzlo";

// Indirizzo email che vede la scheda "Impostazioni / Sync" ed e' sempre
// autorizzato a modificare i dati, anche se non e' elencato in EDITOR_EMAILS.
export const ADMIN_EMAIL = "gruppopiave.internal@gmail.com";

// Indirizzi email autorizzati a creare, modificare, eliminare soci e a
// chiudere l'anno sociale (scrivere un indirizzo per riga, tra virgolette,
// separati da virgola). Chi accede con un indirizzo Google NON presente qui
// (e diverso da ADMIN_EMAIL) puo' comunque collegarsi e consultare tutte le
// tabelle in ogni scheda, ma in sola lettura: i pulsanti di creazione,
// modifica, eliminazione e chiusura anno restano nascosti.
export const EDITOR_EMAILS = [
  "gruppopiave.internal@gmail.com",
  "michaellonghi98@gmail.com",
];
