import {
  state,
  genId,
  calcolaEta,
  calcolaAnzianita,
  formatDataIt,
  loadFromLocalCache,
  saveToLocalCache,
  setData,
  upsertSocio,
  deleteSocio,
  markDirty,
  clearDirty,
  contaAttivi,
  exportCsv,
  downloadJsonBackup,
} from "./core.js";

import * as Drive from "./drive.js";

function annoCorrente() {
  return new Date().getFullYear();
}

function datiVuoti() {
  return {
    meta: { annoAttivo: annoCorrente(), limiteSoci: 90, ultimaModifica: null, modificatoDa: null, fonte: "" },
    soci: [],
  };
}

// ===================== TOAST =====================
let toastTimer = null;
function toast(msg, type = "") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (type ? " " + type : "");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

// ===================== TABS =====================
document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
  const tab = btn.dataset.tab;
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + tab));
});

// ===================== SORT / FILTER STATE =====================
const storicoState = { sort: { col: "nominativo", dir: "asc" }, search: "", filtro: "tutti" };
const attiviState = { sort: { col: "nominativo", dir: "asc" }, search: "" };

function cmp(a, b) {
  if (a === null || a === undefined || a === "") return b === null || b === undefined || b === "" ? 0 : 1;
  if (b === null || b === undefined || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "it", { numeric: true, sensitivity: "base" });
}

function getSortValue(socio, col) {
  switch (col) {
    case "eta":
      return calcolaEta(socio.dataNascita);
    case "anzianita":
      return calcolaAnzianita(socio.dataEntrata);
    case "attivo":
      return socio.attivo ? 1 : 0;
    case "pagamentoBonifico":
      return socio.pagamentoBonifico ? 1 : 0;
    case "quotaPagata":
      return socio.quotaPagata ? 1 : 0;
    case "ricevutaConsegnata":
      return socio.ricevutaConsegnata ? 1 : 0;
    default:
      return socio[col];
  }
}

function sortSoci(list, sort) {
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => dir * cmp(getSortValue(a, sort.col), getSortValue(b, sort.col)));
}

function matchesSearch(socio, q) {
  if (!q) return true;
  const hay = [socio.tessera, socio.nominativo, socio.luogoNascita, socio.indirizzo, socio.email, socio.telefono]
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

// ===================== RENDER: STORICO =====================
function filteredStorico() {
  let list = state.soci.filter((s) => matchesSearch(s, storicoState.search));
  if (storicoState.filtro === "attivi") list = list.filter((s) => s.attivo);
  else if (storicoState.filtro === "nonattivi") list = list.filter((s) => !s.attivo);
  else if (storicoState.filtro === "note") list = list.filter((s) => s.note && s.note.trim());
  return sortSoci(list, storicoState.sort);
}

function renderStorico() {
  const list = filteredStorico();
  const body = document.getElementById("storicoBody");
  body.innerHTML = list
    .map((s) => {
      const eta = calcolaEta(s.dataNascita);
      const anz = calcolaAnzianita(s.dataEntrata);
      const noteIcon = s.note && s.note.trim() ? `<span class="row-note-icon" title="${escapeAttr(s.note)}">⚠</span>` : "";
      return `<tr data-id="${s.id}" class="${s.note && s.note.trim() ? "row-note" : ""}">
        <td>${escapeHtml(s.tessera)}</td>
        <td>${noteIcon}${escapeHtml(s.nominativo)}</td>
        <td>${eta ?? ""}</td>
        <td>${formatDataIt(s.dataNascita)}</td>
        <td>${escapeHtml(s.luogoNascita)}</td>
        <td>${escapeHtml(s.indirizzo)}</td>
        <td>${formatDataIt(s.dataEntrata)}</td>
        <td>${anz ?? ""}</td>
        <td>${s.attivo ? '<span class="check-yes">&check;</span>' : '<span class="check-no">—</span>'}</td>
        <td class="col-actions"><button class="btn btn-small btn-edit">Modifica</button></td>
      </tr>`;
    })
    .join("");
  document.getElementById("storicoCount").textContent = `${list.length} di ${state.soci.length} soci`;
  updateSortHeaders(document.getElementById("tableStorico"), storicoState.sort);
}

// ===================== RENDER: ATTIVI =====================
function filteredAttivi() {
  let list = state.soci.filter((s) => s.attivo && matchesSearch(s, attiviState.search));
  return sortSoci(list, attiviState.sort);
}

function renderAttivi() {
  const list = filteredAttivi();
  const body = document.getElementById("attiviBody");
  body.innerHTML = list
    .map((s) => {
      const eta = calcolaEta(s.dataNascita);
      const anz = calcolaAnzianita(s.dataEntrata);
      const check = (v) => (v ? '<span class="check-yes">&check;</span>' : '<span class="check-no">—</span>');
      return `<tr data-id="${s.id}">
        <td>${escapeHtml(s.tessera)}</td>
        <td>${escapeHtml(s.nominativo)}</td>
        <td>${eta ?? ""}</td>
        <td>${escapeHtml(s.email)}</td>
        <td>${escapeHtml(s.telefono)}</td>
        <td>${anz ?? ""}</td>
        <td>${s.quota != null ? "€ " + Number(s.quota).toFixed(2) : ""}</td>
        <td>${check(s.pagamentoBonifico)}</td>
        <td>${check(s.quotaPagata)}</td>
        <td>${check(s.ricevutaConsegnata)}</td>
        <td class="col-actions">
          <button class="btn btn-small btn-edit">Modifica</button>
          <button class="btn btn-small btn-danger-outline btn-rimuovi">Rimuovi</button>
        </td>
      </tr>`;
    })
    .join("");
  document.getElementById("attiviCount").textContent = `${list.length} di ${contaAttivi()} soci attivi`;
  updateSortHeaders(document.getElementById("tableAttivi"), attiviState.sort);

  const totale = contaAttivi();
  const limite = state.meta.limiteSoci || 90;
  const badge = document.getElementById("attiviCountBadge");
  badge.textContent = `${annoCorrente()} · ${totale}/${limite}`;
  badge.className = "badge" + (totale >= limite ? " badge-full" : totale >= limite - 5 ? " badge-near" : "");
  const hint = document.getElementById("limiteSociHint");
  if (totale > limite) {
    hint.textContent = `Attenzione: ${totale} soci attivi superano il limite di legge di ${limite}.`;
    hint.style.color = "var(--red-600)";
  } else if (totale === limite) {
    hint.textContent = `Limite di ${limite} soci raggiunto.`;
    hint.style.color = "var(--amber-600)";
  } else {
    hint.textContent = `${limite - totale} posti ancora disponibili su ${limite}.`;
    hint.style.color = "";
  }
}

function updateSortHeaders(table, sort) {
  table.querySelectorAll("th[data-col]").forEach((th) => {
    th.classList.remove("sorted-asc", "sorted-desc");
    if (th.dataset.col === sort.col) th.classList.add(sort.dir === "asc" ? "sorted-asc" : "sorted-desc");
  });
}

function wireSorting(tableId, sortStateObj, renderFn) {
  document.getElementById(tableId).querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-col]");
    if (!th) return;
    const col = th.dataset.col;
    if (sortStateObj.sort.col === col) sortStateObj.sort.dir = sortStateObj.sort.dir === "asc" ? "desc" : "asc";
    else {
      sortStateObj.sort.col = col;
      sortStateObj.sort.dir = "asc";
    }
    renderFn();
  });
}
wireSorting("tableStorico", storicoState, renderStorico);
wireSorting("tableAttivi", attiviState, renderAttivi);

document.getElementById("storicoSearch").addEventListener("input", (e) => {
  storicoState.search = e.target.value;
  renderStorico();
});
document.getElementById("storicoFiltroAttivo").addEventListener("change", (e) => {
  storicoState.filtro = e.target.value;
  renderStorico();
});
document.getElementById("attiviSearch").addEventListener("input", (e) => {
  attiviState.search = e.target.value;
  renderAttivi();
});

document.getElementById("storicoBody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-id]");
  if (!tr) return;
  if (e.target.closest(".btn-edit") || !e.target.closest(".col-actions")) openModalSocio(tr.dataset.id);
});
document.getElementById("attiviBody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-id]");
  if (!tr) return;
  const id = tr.dataset.id;
  if (e.target.closest(".btn-rimuovi")) {
    const s = state.soci.find((x) => x.id === id);
    if (s && confirm(`Rimuovere ${s.nominativo} dai soci attivi ${annoCorrente()}?\n\nRestera' comunque nello storico.`)) {
      s.attivo = false;
      markDirty();
      renderAll();
      toast("Socio rimosso dagli attivi");
    }
  } else if (e.target.closest(".btn-edit") || !e.target.closest(".col-actions")) {
    openModalSocio(id);
  }
});

function renderAll() {
  renderStorico();
  renderAttivi();
}

// ===================== MODAL: NUOVO / MODIFICA SOCIO =====================
const modalSocio = document.getElementById("modalSocio");
const formSocio = document.getElementById("formSocio");

function openModalSocio(id) {
  const s = id ? state.soci.find((x) => x.id === id) : null;
  document.getElementById("modalSocioTitle").textContent = s ? "Modifica socio" : "Nuovo socio";
  document.getElementById("fId").value = s ? s.id : "";
  document.getElementById("fTessera").value = s?.tessera || "";
  document.getElementById("fNominativo").value = s?.nominativo || "";
  document.getElementById("fDataNascita").value = s?.dataNascita || "";
  document.getElementById("fLuogoNascita").value = s?.luogoNascita || "";
  document.getElementById("fIndirizzo").value = s?.indirizzo || "";
  document.getElementById("fDataEntrata").value = s?.dataEntrata || "";
  document.getElementById("fAttivo").checked = !!s?.attivo;
  document.getElementById("fEmail").value = s?.email || "";
  document.getElementById("fTelefono").value = s?.telefono || "";
  document.getElementById("fQuota").value = s?.quota ?? "";
  document.getElementById("fPagamentoBonifico").checked = !!s?.pagamentoBonifico;
  document.getElementById("fQuotaPagata").checked = !!s?.quotaPagata;
  document.getElementById("fRicevutaConsegnata").checked = !!s?.ricevutaConsegnata;
  document.getElementById("fNote").value = s?.note || "";
  document.getElementById("btnEliminaSocio").hidden = !s;
  modalSocio.hidden = false;
  document.getElementById("fNominativo").focus();
}

function closeModalSocio() {
  modalSocio.hidden = true;
}

document.getElementById("btnNuovoSocio").addEventListener("click", () => openModalSocio(null));
document.getElementById("btnAnnullaSocio").addEventListener("click", closeModalSocio);
modalSocio.addEventListener("click", (e) => {
  if (e.target === modalSocio) closeModalSocio();
});

formSocio.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = document.getElementById("fId").value || genId();
  const quotaRaw = document.getElementById("fQuota").value;
  const socio = {
    id,
    tessera: document.getElementById("fTessera").value.trim(),
    nominativo: document.getElementById("fNominativo").value.trim(),
    dataNascita: document.getElementById("fDataNascita").value || null,
    luogoNascita: document.getElementById("fLuogoNascita").value.trim(),
    indirizzo: document.getElementById("fIndirizzo").value.trim(),
    dataEntrata: document.getElementById("fDataEntrata").value || null,
    attivo: document.getElementById("fAttivo").checked,
    email: document.getElementById("fEmail").value.trim(),
    telefono: document.getElementById("fTelefono").value.trim(),
    quota: quotaRaw === "" ? null : Number(quotaRaw),
    pagamentoBonifico: document.getElementById("fPagamentoBonifico").checked,
    quotaPagata: document.getElementById("fQuotaPagata").checked,
    ricevutaConsegnata: document.getElementById("fRicevutaConsegnata").checked,
    note: document.getElementById("fNote").value.trim(),
  };
  if (!socio.nominativo) {
    toast("Il nome e cognome e' obbligatorio", "error");
    return;
  }
  upsertSocio(socio);
  closeModalSocio();
  renderAll();
  toast("Socio salvato");
});

document.getElementById("btnEliminaSocio").addEventListener("click", () => {
  const id = document.getElementById("fId").value;
  const s = state.soci.find((x) => x.id === id);
  if (!s) return;
  if (confirm(`Eliminare definitivamente ${s.nominativo} dallo storico?\n\nQuesta azione non si puo' annullare (dopo il salvataggio su Drive).`)) {
    deleteSocio(id);
    closeModalSocio();
    renderAll();
    toast("Socio eliminato");
  }
});

// ===================== MODAL: PICKER (aggiungi attivo) =====================
const modalPicker = document.getElementById("modalPicker");
let pickerSearchVal = "";

function renderPicker() {
  const q = pickerSearchVal.toLowerCase();
  const list = state.soci
    .filter((s) => !s.attivo)
    .filter((s) => !q || (s.nominativo + " " + s.tessera).toLowerCase().includes(q))
    .sort((a, b) => cmp(a.nominativo, b.nominativo))
    .slice(0, 200);
  document.getElementById("pickerBody").innerHTML = list
    .map(
      (s) => `<tr data-id="${s.id}">
        <td>${escapeHtml(s.tessera)}</td>
        <td>${escapeHtml(s.nominativo)}</td>
        <td>${escapeHtml(s.indirizzo)}</td>
        <td class="col-actions"><button class="btn btn-small btn-primary btn-aggiungi">Aggiungi</button></td>
      </tr>`
    )
    .join("");
}

document.getElementById("btnAggiungiAttivo").addEventListener("click", () => {
  pickerSearchVal = "";
  document.getElementById("pickerSearch").value = "";
  renderPicker();
  modalPicker.hidden = false;
});
document.getElementById("btnChiudiPicker").addEventListener("click", () => (modalPicker.hidden = true));
modalPicker.addEventListener("click", (e) => {
  if (e.target === modalPicker) modalPicker.hidden = true;
});
document.getElementById("pickerSearch").addEventListener("input", (e) => {
  pickerSearchVal = e.target.value;
  renderPicker();
});
document.getElementById("pickerBody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-id]");
  if (!tr || !e.target.closest(".btn-aggiungi")) return;
  const s = state.soci.find((x) => x.id === tr.dataset.id);
  if (!s) return;
  const limite = state.meta.limiteSoci || 90;
  if (contaAttivi() >= limite) {
    if (!confirm(`Hai gia' raggiunto il limite di ${limite} soci attivi.\nAggiungere comunque ${s.nominativo}?`)) return;
  }
  s.attivo = true;
  markDirty();
  renderAll();
  renderPicker();
  toast(`${s.nominativo} aggiunto ai soci attivi`);
});

// ===================== NUOVO ANNO =====================
document.getElementById("btnNuovoAnno").addEventListener("click", () => {
  if (
    !confirm(
      `Avviare un nuovo anno sociale?\n\nTutti i ${contaAttivi()} soci attualmente attivi verranno spostati tra i non-attivi. Lo storico non viene toccato: potrai riaggiungere i soci confermati per il nuovo anno (${annoCorrente()}) dalla lista storico.\n\nProcedere?`
    )
  )
    return;
  state.soci.forEach((s) => (s.attivo = false));
  markDirty();
  renderAll();
  toast(`Soci attivi azzerati per l'anno ${annoCorrente()}`);
});

// ===================== EXPORT CSV / BACKUP =====================
document.getElementById("btnExportCsv").addEventListener("click", () => {
  const columns = [
    { label: "Tessera", value: (s) => s.tessera },
    { label: "Socio", value: (s) => s.nominativo },
    { label: "Eta", value: (s) => calcolaEta(s.dataNascita) },
    { label: "Nato il", value: (s) => formatDataIt(s.dataNascita) },
    { label: "Luogo di nascita", value: (s) => s.luogoNascita },
    { label: "Indirizzo", value: (s) => s.indirizzo },
    { label: "Entrato il", value: (s) => formatDataIt(s.dataEntrata) },
    { label: "Anzianita", value: (s) => calcolaAnzianita(s.dataEntrata) },
    { label: "Attivo", value: (s) => (s.attivo ? "si" : "no") },
    { label: "e-Mail", value: (s) => s.email },
    { label: "Telefono", value: (s) => s.telefono },
    { label: "Quota", value: (s) => s.quota },
    { label: "Note", value: (s) => s.note },
  ];
  exportCsv(filteredStorico(), columns);
  toast("CSV esportato");
});

document.getElementById("btnScaricaBackup").addEventListener("click", () => {
  downloadJsonBackup();
  toast("Backup scaricato");
});

// ===================== IMPOSTAZIONI: ANNO / LIMITE =====================
document.getElementById("btnSalvaImpostazioniAnno").addEventListener("click", () => {
  state.meta.limiteSoci = Number(document.getElementById("inputLimiteSoci").value) || state.meta.limiteSoci;
  markDirty();
  renderAll();
  toast("Impostazioni salvate");
});

// ===================== IMPORTAZIONE DATI INIZIALI =====================
document.getElementById("inputImportFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById("importStatus");
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.soci)) throw new Error("Formato file non valido");
    if (state.soci.length > 0) {
      if (
        !confirm(
          `Sono gia' presenti ${state.soci.length} soci nei dati correnti.\n\nImportare comunque il file (${parsed.soci.length} soci) e SOSTITUIRE i dati attuali?`
        )
      ) {
        e.target.value = "";
        return;
      }
    }
    setData(parsed.meta || state.meta, parsed.soci);
    markDirty();
    renderAll();
    syncInputsFromState();
    statusEl.textContent = `Importati ${parsed.soci.length} soci. Ricordati di premere "Salva su Drive" per sincronizzare.`;
    toast("Dati importati");
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Errore durante l'importazione: " + err.message;
    toast("Errore importazione file", "error");
  } finally {
    e.target.value = "";
  }
});

function syncInputsFromState() {
  const inputAnno = document.getElementById("inputAnnoAttivo");
  inputAnno.value = annoCorrente();
  inputAnno.readOnly = true;
  inputAnno.title = "Calcolato automaticamente dalla data del computer";
  document.getElementById("inputLimiteSoci").value = state.meta.limiteSoci;
}

// ===================== GOOGLE DRIVE SYNC UI =====================
const syncStatusText = document.getElementById("syncStatusText");
const btnSyncNow = document.getElementById("btnSyncNow");

// Pulsante "Ricarica dati" creato dinamicamente accanto a "Salva su Drive",
// per riprendere i dati piu' recenti da Drive senza dover ricaricare tutta
// la pagina (e quindi senza perdere l'accesso Google).
const btnReloadDrive = document.createElement("button");
btnReloadDrive.id = "btnReloadDrive";
btnReloadDrive.className = "btn btn-small";
btnReloadDrive.textContent = "Ricarica dati";
btnReloadDrive.hidden = true;
btnSyncNow.insertAdjacentElement("afterend", btnReloadDrive);

function updateSyncStatusUI() {
  const signedIn = Drive.isSignedIn();
  const fileId = Drive.getStoredFileId();

  if (!signedIn) {
    syncStatusText.textContent = "Non connesso a Google Drive";
    syncStatusText.className = "sync-text sync-offline";
    btnSyncNow.hidden = true;
  } else if (!fileId) {
    syncStatusText.textContent = "Connesso - nessun file collegato (vai in Impostazioni)";
    syncStatusText.className = "sync-text sync-pending";
    btnSyncNow.hidden = true;
  } else if (state.dirty) {
    syncStatusText.textContent = "Modifiche non salvate su Drive";
    syncStatusText.className = "sync-text sync-pending";
    btnSyncNow.hidden = false;
  } else {
    syncStatusText.textContent = "Sincronizzato con Google Drive";
    syncStatusText.className = "sync-text sync-online";
    btnSyncNow.hidden = true;
  }

  btnReloadDrive.hidden = !(signedIn && fileId);

  document.getElementById("driveFileArea").hidden = !signedIn;
  const info = document.getElementById("driveFileInfo");
  if (signedIn && fileId) {
    info.innerHTML = `File collegato: <code>${fileId}</code>. <a href="https://drive.google.com/file/d/${fileId}/view" target="_blank" rel="noopener">Apri su Google Drive</a> per condividerlo con altri account.`;
  } else if (signedIn) {
    info.textContent = "Nessun file collegato. Creane uno nuovo oppure connettiti a un file esistente condiviso da un altro socio.";
  } else {
    info.textContent = "";
  }
}

document.addEventListener("gap:dirty", updateSyncStatusUI);
document.addEventListener("gap:saved", updateSyncStatusUI);

async function doSaveToDrive() {
  const fileId = Drive.getStoredFileId();
  if (!fileId) {
    toast("Nessun file Drive collegato: vai in Impostazioni", "error");
    return;
  }
  try {
    const { changed } = await Drive.hasRemoteChangedSinceLastSync(fileId);
    if (changed) {
      const ricarica = confirm(
        "Qualcun altro ha modificato i dati su Drive dopo l'ultimo caricamento.\n\nOK = ricarica i dati da Drive (perderai le modifiche locali non salvate)\nAnnulla = salva comunque le tue modifiche, sovrascrivendo quelle remote"
      );
      if (ricarica) {
        await loadFromDrive(fileId);
        toast("Dati ricaricati da Drive. Riapplica le tue modifiche se necessario.", "error");
        return;
      }
    }
    const payload = { meta: state.meta, soci: state.soci };
    await Drive.driveUpdateFileContent(fileId, payload);
    clearDirty();
    updateSyncStatusUI();
    toast("Dati salvati su Google Drive", "success");
  } catch (err) {
    console.error(err);
    toast("Errore nel salvataggio su Drive: " + err.message, "error");
  }
}
btnSyncNow.addEventListener("click", doSaveToDrive);

btnReloadDrive.addEventListener("click", async () => {
  const fileId = Drive.getStoredFileId();
  if (!fileId) return;
  if (state.dirty && !confirm("Hai modifiche non salvate. Ricaricare comunque da Drive?\n\nLe modifiche locali andranno perse.")) {
    return;
  }
  try {
    await loadFromDrive(fileId);
    toast("Dati ricaricati da Drive", "success");
  } catch (err) {
    console.error(err);
    toast("Impossibile ricaricare i dati: " + err.message, "error");
  }
});

async function loadFromDrive(fileId) {
  const content = await Drive.driveGetFileContent(fileId);
  if (!content || !Array.isArray(content.soci)) throw new Error("Il file su Drive non ha un formato valido");
  const meta = await Drive.driveGetFileMetadata(fileId);
  Drive.noteSyncedTime(meta.modifiedTime);
  setData(content.meta || state.meta, content.soci);
  clearDirty();
  renderAll();
  syncInputsFromState();
  updateSyncStatusUI();
}

// ===================== VISIBILITA' SCHEDA IMPOSTAZIONI (SOLO ADMIN) =====================
function applyAdminVisibility(email) {
  const tabBtn = document.querySelector('[data-tab="impostazioni"]');
  const restricted = !!Drive.ADMIN_EMAIL;
  // Finche' non conosciamo l'email (prima del login) la scheda resta visibile,
  // altrimenti nessuno (nemmeno l'admin) potrebbe mai cliccare "Accedi con Google".
  const shouldHide = restricted && email && email.toLowerCase() !== Drive.ADMIN_EMAIL.toLowerCase();
  tabBtn.hidden = shouldHide;
  if (shouldHide && document.getElementById("tab-impostazioni").classList.contains("active")) {
    document.querySelector('[data-tab="storico"]').click();
  }
}

// ===================== VISIBILITA' CARD IMPOSTAZIONI (SOLO SE CONNESSI) =====================
// La prima card ("Connessione a Google Drive", con il pulsante Accedi) resta
// sempre visibile. Le altre (import dati, anno sociale, backup) compaiono
// solo dopo il login, per non confondere chi apre la scheda senza essere
// ancora connesso.
function applySettingsCardsVisibility() {
  const cards = document.querySelectorAll(".settings-grid > .card");
  const signedIn = Drive.isSignedIn();
  cards.forEach((card, i) => {
    if (i === 0) return;
    card.hidden = !signedIn;
  });
}

function renderGoogleSigninArea() {
  const area = document.getElementById("googleSigninArea");
  area.innerHTML = "";
  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  if (Drive.isSignedIn()) {
    btn.textContent = "Disconnetti account Google";
    btn.addEventListener("click", () => {
      Drive.signOut();
      // Svuota i dati visualizzati/salvati in locale: da disconnessi non
      // deve restare visibile nulla che possa sembrare "dato corrente".
      const vuoto = datiVuoti();
      setData(vuoto.meta, vuoto.soci);
      clearDirty();
      renderAll();
      syncInputsFromState();
      renderGoogleSigninArea();
      updateSyncStatusUI();
      applyAdminVisibility("");
      applySettingsCardsVisibility();
    });
  } else {
    btn.textContent = "Accedi con Google";
    btn.addEventListener("click", () => Drive.signIn());
  }
  area.appendChild(btn);
}

document.getElementById("btnCreaFileDrive").addEventListener("click", async () => {
  if (!confirm("Creare un nuovo file 'soci-gruppo-piave.json' su Google Drive con i dati attuali?")) return;
  try {
    const payload = { meta: state.meta, soci: state.soci };
    const data = await Drive.driveCreateFile("soci-gruppo-piave.json", payload);
    clearDirty();
    updateSyncStatusUI();
    toast("File creato su Drive. Condividilo con gli altri componenti del gruppo.", "success");
  } catch (err) {
    console.error(err);
    toast("Errore nella creazione del file: " + err.message, "error");
  }
});

document.getElementById("btnApriFileDrive").addEventListener("click", () => {
  document.getElementById("apriFileForm").hidden = false;
});

document.getElementById("btnConfermaFileId").addEventListener("click", async () => {
  const raw = document.getElementById("inputDriveFileId").value;
  const fileId = Drive.extractFileId(raw);
  if (!fileId) {
    toast("Inserisci un link o un ID file valido", "error");
    return;
  }
  try {
    await Drive.driveGetFileMetadata(fileId); // verifica accesso
    Drive.setStoredFileId(fileId);
    if (state.soci.length === 0 || confirm("Caricare ora i dati da questo file Drive (sovrascrivendo quelli locali)?")) {
      await loadFromDrive(fileId);
    }
    document.getElementById("apriFileForm").hidden = true;
    toast("Connesso al file Drive", "success");
  } catch (err) {
    console.error(err);
    toast("Impossibile accedere al file: " + err.message, "error");
  }
});

// ===================== UTIL =====================
function escapeHtml(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(v) {
  return escapeHtml(v).replace(/"/g, "&quot;");
}

// ===================== AVVIO =====================
function initGoogleWhenReady() {
  let tries = 0;
  const tryInit = () => {
    tries++;
    if (window.google && window.google.accounts) {
      Drive.initGoogleAuth((signedIn) => {
        renderGoogleSigninArea();
        updateSyncStatusUI();
        applySettingsCardsVisibility();
        if (signedIn) {
          Drive.getUserEmail().then((email) => applyAdminVisibility(email));
          const fileId = Drive.getStoredFileId();
          if (fileId) {
            loadFromDrive(fileId).catch((err) => {
              console.error(err);
              toast("Impossibile caricare i dati da Drive: " + err.message, "error");
            });
          }
        } else {
          applyAdminVisibility("");
        }
      });
      renderGoogleSigninArea();
    } else if (tries < 40) {
      setTimeout(tryInit, 250);
    }
  };
  tryInit();
}

function main() {
  // Non si ricarica la cache locale all'avvio: finche' non si fa di nuovo
  // accesso con Google, l'app parte vuota (niente dati "vecchi" visibili da
  // disconnessi, es. dopo un refresh della pagina - l'accesso Google non
  // sopravvive al ricaricamento).
  syncInputsFromState();
  renderAll();
  updateSyncStatusUI();
  applyAdminVisibility("");
  applySettingsCardsVisibility();
  initGoogleWhenReady();

  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

main();
