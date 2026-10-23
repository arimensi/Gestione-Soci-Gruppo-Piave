// Integrazione con Google Drive: autenticazione (Google Identity Services)
// e lettura/scrittura del file JSON condiviso usato come "database".
//
// IMPORTANTE: prima di usare l'app vera e propria, sostituisci GOOGLE_CLIENT_ID
// con il Client ID OAuth creato su Google Cloud Console (vedi README.md).

export const GOOGLE_CLIENT_ID = "49504779196-gi4m2atmjnemvg2sa6inbutc6f5cu4i4.apps.googleusercontent.com";

// Scope "drive" completo: scelto per semplicita' (nessuna integrazione del
// Picker API necessaria). Con questo scope, chiunque acceda con un account
// Google autorizzato nella schermata di consenso OAuth (vedi README) puo'
// leggere/scrivere qualunque file di Drive a cui quell'account ha accesso,
// incluso il file soci condiviso dagli altri componenti del gruppo.
const SCOPE = "https://www.googleapis.com/auth/drive";

const DRIVE_FILE_ID_KEY = "gap-drive-file-id";
const DRIVE_LAST_SYNC_KEY = "gap-drive-last-sync-modified-time";

let tokenClient = null;
let accessToken = null;
let onAuthChange = () => {};

export function isSignedIn() {
  return !!accessToken;
}

export function getStoredFileId() {
  return localStorage.getItem(DRIVE_FILE_ID_KEY) || "";
}

export function setStoredFileId(id) {
  localStorage.setItem(DRIVE_FILE_ID_KEY, id);
}

export function clearStoredFileId() {
  localStorage.removeItem(DRIVE_FILE_ID_KEY);
  localStorage.removeItem(DRIVE_LAST_SYNC_KEY);
}

export function getLastSyncedModifiedTime() {
  return localStorage.getItem(DRIVE_LAST_SYNC_KEY) || "";
}

function setLastSyncedModifiedTime(t) {
  localStorage.setItem(DRIVE_LAST_SYNC_KEY, t || "");
}

export function initGoogleAuth(onChange) {
  onAuthChange = onChange || (() => {});
  if (!window.google || !window.google.accounts) {
    console.warn("Google Identity Services non ancora caricato");
    return;
  }
  if (GOOGLE_CLIENT_ID.startsWith("INSERISCI_QUI")) {
    console.warn("GOOGLE_CLIENT_ID non configurato in js/drive.js");
    return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPE,
    callback: (resp) => {
      if (resp.error) {
        console.error("Errore autenticazione Google", resp);
        onAuthChange(false);
        return;
      }
      accessToken = resp.access_token;
      onAuthChange(true);
    },
  });
}

export function signIn() {
  if (!tokenClient) {
    alert(
      "Configurazione Google non completa.\n\nApri js/drive.js e inserisci il GOOGLE_CLIENT_ID (vedi README.md per le istruzioni)."
    );
    return;
  }
  tokenClient.requestAccessToken({ prompt: "" });
}

export function signOut() {
  if (accessToken && window.google) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  onAuthChange(false);
}

function authHeaders() {
  if (!accessToken) throw new Error("Non autenticato con Google");
  return { Authorization: "Bearer " + accessToken };
}

export function extractFileId(idOrUrl) {
  if (!idOrUrl) return "";
  const s = idOrUrl.trim();
  const m = s.match(/\/d\/([a-zA-Z0-9_-]{10,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  return s; // probabilmente gia' un ID grezzo
}

export async function driveCreateFile(name, jsonPayload) {
  const metadata = { name, mimeType: "application/json" };
  const boundary = "gap_boundary_" + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    "Content-Type: application/json\r\n\r\n" +
    JSON.stringify(jsonPayload) +
    `\r\n--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime,webViewLink",
    {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }
  );
  if (!res.ok) throw new Error("Creazione file Drive fallita: " + (await res.text()));
  const data = await res.json();
  setStoredFileId(data.id);
  setLastSyncedModifiedTime(data.modifiedTime);
  return data;
}

export async function driveGetFileMetadata(fileId) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,modifiedTime,webViewLink`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new Error("Impossibile leggere le informazioni del file: " + (await res.text()));
  return res.json();
}

export async function driveGetFileContent(fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Impossibile leggere il contenuto del file: " + (await res.text()));
  return res.json();
}

export async function driveUpdateFileContent(fileId, jsonPayload) {
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,modifiedTime`,
    {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(jsonPayload),
    }
  );
  if (!res.ok) throw new Error("Salvataggio su Drive fallito: " + (await res.text()));
  const data = await res.json();
  setLastSyncedModifiedTime(data.modifiedTime);
  return data;
}

/**
 * Controlla se il file su Drive e' stato modificato da quando l'abbiamo
 * caricato l'ultima volta (controllo di conflitto semplice, "ottimistico").
 */
export async function hasRemoteChangedSinceLastSync(fileId) {
  const meta = await driveGetFileMetadata(fileId);
  const last = getLastSyncedModifiedTime();
  return { changed: !!last && meta.modifiedTime !== last, meta };
}

export function noteSyncedTime(modifiedTime) {
  setLastSyncedModifiedTime(modifiedTime);
}
