// Stato condiviso dell'app + funzioni pure di calcolo/salvataggio locale.

export const LOCAL_CACHE_KEY = "gap-soci-cache-v1";

export const state = {
  meta: {
    annoAttivo: new Date().getFullYear(),
    limiteSoci: 90,
    ultimaModifica: null,
    modificatoDa: null,
    fonte: "",
  },
  soci: [],
  // Archivio per anno dei soci attivi passati: [{ anno, soci: [...snapshot] }, ...]
  storicoAttivi: [],
  dirty: false, // ci sono modifiche non ancora salvate su Drive
};

export function genId() {
  return "soc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

export function calcolaEta(dataISO) {
  if (!dataISO) return null;
  const d = new Date(dataISO + "T00:00:00");
  if (isNaN(d)) return null;
  const oggi = new Date();
  let eta = oggi.getFullYear() - d.getFullYear();
  const m = oggi.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && oggi.getDate() < d.getDate())) eta--;
  return eta;
}

export function calcolaAnzianita(dataISO) {
  return calcolaEta(dataISO); // stessa logica: anni interi trascorsi da una data
}

export function formatDataIt(dataISO) {
  if (!dataISO) return "";
  const [y, m, d] = dataISO.split("-");
  return `${d}.${m}.${y}`;
}

export function annoNascita(dataISO) {
  if (!dataISO) return "";
  return dataISO.split("-")[0];
}

/** Restituisce l'insieme dei numeri di tessera (non vuoti) usati da piu' di un socio. */
export function tessereDuplicate(soci) {
  const conteggio = {};
  for (const s of soci) {
    if (!s.tessera) continue;
    conteggio[s.tessera] = (conteggio[s.tessera] || 0) + 1;
  }
  return new Set(Object.keys(conteggio).filter((t) => conteggio[t] > 1));
}

export function loadFromLocalCache() {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.soci)) return false;
    state.meta = parsed.meta || state.meta;
    state.soci = parsed.soci;
    state.storicoAttivi = Array.isArray(parsed.storicoAttivi) ? parsed.storicoAttivi : [];
    return true;
  } catch (e) {
    console.error("Errore lettura cache locale", e);
    return false;
  }
}

export function saveToLocalCache() {
  const payload = { meta: state.meta, soci: state.soci, storicoAttivi: state.storicoAttivi };
  localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(payload));
}

export function setData(meta, soci, storicoAttivi) {
  state.meta = meta;
  state.soci = soci;
  state.storicoAttivi = Array.isArray(storicoAttivi) ? storicoAttivi : state.storicoAttivi || [];
  saveToLocalCache();
}

export function upsertSocio(socio) {
  const idx = state.soci.findIndex((s) => s.id === socio.id);
  if (idx === -1) {
    state.soci.push(socio);
  } else {
    state.soci[idx] = socio;
  }
  markDirty();
}

export function deleteSocio(id) {
  state.soci = state.soci.filter((s) => s.id !== id);
  markDirty();
}

/**
 * Chiude l'anno sociale corrente: archivia un'istantanea indipendente dei
 * soci attualmente attivi sotto l'anno in corso, poi azzera gli attivi e
 * avanza l'anno di uno. Se esiste gia' un archivio per quell'anno, lo
 * sostituisce (evita doppioni in caso di click ripetuti).
 */
export function chiudiAnno() {
  const anno = state.meta.annoAttivo;
  const istantanea = state.soci
    .filter((s) => s.attivo)
    .map((s) => ({ ...s })); // copia indipendente, non cambia piu' se lo storico vivo viene modificato
  const idxEsistente = state.storicoAttivi.findIndex((a) => a.anno === anno);
  if (idxEsistente !== -1) {
    state.storicoAttivi[idxEsistente] = { anno, soci: istantanea };
  } else {
    state.storicoAttivi.push({ anno, soci: istantanea });
  }
  state.storicoAttivi.sort((a, b) => b.anno - a.anno);
  state.soci.forEach((s) => (s.attivo = false));
  state.meta.annoAttivo = anno + 1;
  markDirty();
  return anno;
}

export function markDirty() {
  state.dirty = true;
  state.meta.ultimaModifica = new Date().toISOString();
  saveToLocalCache();
  document.dispatchEvent(new CustomEvent("gap:dirty"));
}

export function clearDirty() {
  state.dirty = false;
  document.dispatchEvent(new CustomEvent("gap:saved"));
}

export function contaAttivi() {
  return state.soci.filter((s) => s.attivo).length;
}

export function exportCsv(rows, columns) {
  const header = columns.map((c) => c.label).join(";");
  const lines = rows.map((r) =>
    columns
      .map((c) => {
        let v = c.value(r);
        if (v === null || v === undefined) v = "";
        v = String(v);
        // Protezione da "CSV injection": se il valore inizia con uno di
        // questi caratteri, Excel/Sheets potrebbe interpretarlo come una
        // formula quando il file viene aperto. Prefisso con un apice per
        // forzarne la lettura come testo semplice.
        if (/^[=+\-@]/.test(v)) v = "'" + v;
        v = v.replace(/"/g, '""');
        if (v.includes(";") || v.includes("\n") || v.includes('"')) v = `"${v}"`;
        return v;
      })
      .join(";")
  );
  const csv = "﻿" + [header, ...lines].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `soci-gruppo-piave-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadJsonBackup() {
  const payload = { meta: state.meta, soci: state.soci, storicoAttivi: state.storicoAttivi };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `soci-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
