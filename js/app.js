import {
  state,
  genId,
  calcolaEta,
  calcolaAnzianita,
  formatDataIt,
  tessereDuplicate,
  loadFromLocalCache,
  saveToLocalCache,
  setData,
  upsertSocio,
  deleteSocio,
  chiudiAnno,
  markDirty,
  clearDirty,
  contaAttivi,
  exportCsv,
  downloadJsonBackup,
} from "./core.js";

import * as Drive from "./drive.js";

function datiVuoti() {
  return {
    meta: { annoAttivo: new Date().getFullYear(), limiteSoci: 90, ultimaModifica: null, modificatoDa: null, fonte: "" },
    soci: [],
    storicoAttivi: [],
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
// Scheda unica per lo switch, richiamata sia dalla barra schede (Lista soci /
// Soci attivi / Storico soci attivi) sia dal pulsante Accedi/Impostazioni,
// che ora vive nell'intestazione in alto a destra e non e' piu' dentro #tabs.
function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + tab));
  if (tab === "storicoattivi") renderStoricoAttivi();
}
document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  switchTab(btn.dataset.tab);
});
document.getElementById("tabBtnImpostazioni").addEventListener("click", () => switchTab("impostazioni"));

// ===================== NOTE DINAMICHE (tessera duplicata si auto-risolve) =====================
// Il testo "tessera duplicata" importato dai PDF storici restava scritto per
// sempre nel campo note anche dopo aver sistemato il duplicato (es.
// eliminando una delle due righe). Per questo il controllo duplicati va
// sempre ricalcolato dal vivo, non letto dal testo salvato.
const PREFISSO_NOTA_DUPLICATO = /^Numero tessera duplicato nello storico: verificare(; )?/;

function notaEffettiva(s, duplicati) {
  const resto = (s.note || "").replace(PREFISSO_NOTA_DUPLICATO, "").trim();
  const parti = [];
  if (s.tessera && duplicati.has(s.tessera)) parti.push("Numero tessera duplicato: verificare");
  if (resto) parti.push(resto);
  return parti.join("; ");
}

// ===================== SORT / FILTER STATE =====================
const storicoState = { sort: { col: "nominativo", dir: "asc" }, search: "", filtro: "tutti" };
const attiviState = { sort: { col: "nominativo", dir: "asc" }, search: "" };
const storicoAttiviState = { sort: { col: "nominativo", dir: "asc" }, search: "" };

function cmp(a, b) {
  if (a === null || a === undefined || a === "") return b === null || b === undefined || b === "" ? 0 : 1;
  if (b === null || b === undefined || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "it", { numeric: true, sensitivity: "base" });
}

function getSortValue(socio, col) {
  switch (col) {
    case "id":
      return null; // gestito separatamente (posizione nell'elenco)
    case "eta":
      return calcolaEta(socio.dataNascita);
    case "annoNascita":
      return socio.dataNascita || "";
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
  if (sort.col === "id") return list; // "ID" segue l'ordine gia' presente
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

// ===================== RENDER: LISTA SOCI (anagrafica) =====================
function filteredStorico() {
  let list = state.soci.filter((s) => matchesSearch(s, storicoState.search));
  const duplicati = tessereDuplicate(state.soci);
  if (storicoState.filtro === "attivi") list = list.filter((s) => s.attivo);
  else if (storicoState.filtro === "nonattivi") list = list.filter((s) => !s.attivo);
  else if (storicoState.filtro === "note") list = list.filter((s) => notaEffettiva(s, duplicati));
  return sortSoci(list, storicoState.sort);
}

function renderStorico() {
  const list = filteredStorico();
  const duplicati = tessereDuplicate(state.soci);
  const body = document.getElementById("storicoBody");
  body.innerHTML = list
    .map((s) => {
      const eta = calcolaEta(s.dataNascita);
      const anz = calcolaAnzianita(s.dataEntrata);
      const nota = notaEffettiva(s, duplicati);
      const noteIcon = nota ? `<span class="row-note-icon" title="${escapeAttr(nota)}">⚠</span>` : "";
      return `<tr data-id="${s.id}" class="${nota ? "row-note" : ""}">
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

// ===================== RENDER: SOCI ATTIVI (anno corrente) =====================
function filteredAttivi() {
  let list = state.soci.filter((s) => s.attivo && matchesSearch(s, attiviState.search));
  return sortSoci(list, attiviState.sort);
}

function renderAttivi() {
  const list = filteredAttivi();
  const body = document.getElementById("attiviBody");
  body.innerHTML = list
    .map((s, idx) => {
      const check = (v) => (v ? '<span class="check-yes">&check;</span>' : '<span class="check-no">—</span>');
      return `<tr data-id="${s.id}">
        <td>${idx + 1}</td>
        <td>${escapeHtml(s.tessera)}</td>
        <td>${escapeHtml(s.nominativo)}</td>
        <td>${formatDataIt(s.dataNascita)}</td>
        <td>${escapeHtml(s.indirizzo)}</td>
        <td>${escapeHtml(s.email)}</td>
        <td>${escapeHtml(s.telefono)}</td>
        <td>${check(s.pagamentoBonifico)}</td>
        <td>${check(s.quotaPagata)}</td>
        <td>${check(s.ricevutaConsegnata)}</td>
        <td>${s.quota != null ? "€ " + Number(s.quota).toFixed(2) : ""}</td>
        <td class="col-actions">
          <button class="btn btn-small btn-edit">Modifica</button>
          <button class="btn btn-small btn-danger-outline btn-rimuovi">Rimuovi</button>
        </td>
      </tr>`;
    })
    .join("");
  document.getElementById("attiviCount").textContent = `${list.length} di ${contaAttivi()} soci attivi`;
  updateSortHeaders(document.getElementById("tableAttivi"), attiviState.sort);
  document.getElementById("attiviTotaleQuota").textContent =
    "€ " + list.reduce((sum, s) => sum + (Number(s.quota) || 0), 0).toFixed(2);

  const totale = contaAttivi();
  const limite = state.meta.limiteSoci || 90;
  const badge = document.getElementById("attiviCountBadge");
  badge.textContent = `${state.meta.annoAttivo} · ${totale}/${limite}`;
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

// ===================== RENDER: STORICO SOCI ATTIVI (anni passati) =====================
function popolaSelettoreAnniStoricoAttivi() {
  const sel = document.getElementById("storicoAttiviAnno");
  const annoSelezionato = sel.value;
  const anni = state.storicoAttivi.map((a) => a.anno);
  sel.innerHTML = anni.length
    ? anni.map((a) => `<option value="${a}">${a}</option>`).join("")
    : `<option value="">Nessun anno archiviato</option>`;
  if (anni.includes(Number(annoSelezionato))) sel.value = annoSelezionato;
}

function annoStoricoSelezionato() {
  const sel = document.getElementById("storicoAttiviAnno");
  const v = Number(sel.value);
  return state.storicoAttivi.find((a) => a.anno === v) || null;
}

function renderStoricoAttivi() {
  popolaSelettoreAnniStoricoAttivi();
  const archivio = annoStoricoSelezionato();
  const body = document.getElementById("storicoAttiviBody");
  const hint = document.getElementById("storicoAttiviHint");

  if (!archivio) {
    body.innerHTML = "";
    document.getElementById("storicoAttiviCount").textContent = "";
    document.getElementById("storicoAttiviTotaleQuota").textContent = "";
    hint.textContent =
      state.storicoAttivi.length === 0
        ? "Nessun anno ancora archiviato: usa \"Chiudi anno\" nella scheda Soci attivi quando un anno sociale si conclude."
        : "";
    updateSortHeaders(document.getElementById("tableStoricoAttivi"), storicoAttiviState.sort);
    return;
  }
  hint.textContent = "";

  let list = archivio.soci.filter((s) => matchesSearch(s, storicoAttiviState.search));
  list = sortSoci(list, storicoAttiviState.sort);

  body.innerHTML = list
    .map((s, idx) => {
      const check = (v) => (v ? '<span class="check-yes">&check;</span>' : '<span class="check-no">—</span>');
      return `<tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(s.tessera)}</td>
        <td>${escapeHtml(s.nominativo)}</td>
        <td>${formatDataIt(s.dataNascita)}</td>
        <td>${escapeHtml(s.indirizzo)}</td>
        <td>${escapeHtml(s.email)}</td>
        <td>${escapeHtml(s.telefono)}</td>
        <td>${check(s.pagamentoBonifico)}</td>
        <td>${check(s.quotaPagata)}</td>
        <td>${check(s.ricevutaConsegnata)}</td>
        <td>${s.quota != null ? "€ " + Number(s.quota).toFixed(2) : ""}</td>
      </tr>`;
    })
    .join("");
  document.getElementById("storicoAttiviCount").textContent = `${list.length} di ${archivio.soci.length} soci (anno ${archivio.anno})`;
  document.getElementById("storicoAttiviTotaleQuota").textContent =
    "€ " + list.reduce((sum, s) => sum + (Number(s.quota) || 0), 0).toFixed(2);
  updateSortHeaders(document.getElementById("tableStoricoAttivi"), storicoAttiviState.sort);
}

document.getElementById("storicoAttiviAnno").addEventListener("change", renderStoricoAttivi);
document.getElementById("storicoAttiviSearch").addEventListener("input", (e) => {
  storicoAttiviState.search = e.target.value;
  renderStoricoAttivi();
});

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
wireSorting("tableStoricoAttivi", storicoAttiviState, renderStoricoAttivi);

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
    if (s && confirm(`Rimuovere ${s.nominativo} dai soci attivi ${state.meta.annoAttivo}?\n\nRestera' comunque nello storico.`)) {
      s.attivo = false;
      markDirty();
      renderAll();
      toast("Socio rimosso dagli attivi");
    }
  } else if (e.target.closest(".btn-edit") || !e.target.closest(".col-actions")) {
    openModalSocio(id, "attivi");
  }
});

function renderAll() {
  renderStorico();
  renderAttivi();
  if (document.getElementById("tab-storicoattivi").classList.contains("active")) renderStoricoAttivi();
}

// ===================== MODAL: NUOVO / MODIFICA SOCIO =====================
const modalSocio = document.getElementById("modalSocio");
const formSocio = document.getElementById("formSocio");

function openModalSocio(id, context = "storico") {
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
  // I campi relativi a contatti/pagamento si vedono solo aprendo la scheda
  // dalla sezione Soci attivi: dalla Lista soci (semplice anagrafica) restano
  // nascosti, cosi' non si rischia di doverli compilare per forza.
  document.querySelectorAll(".campo-attivi").forEach((el) => {
    el.hidden = context !== "attivi";
  });
  modalSocio.hidden = false;
  document.getElementById("fNominativo").focus();
}

function closeModalSocio() {
  modalSocio.hidden = true;
}

document.getElementById("btnNuovoSocio").addEventListener("click", () => openModalSocio(null, "storico"));
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

// ===================== CHIUDI ANNO =====================
document.getElementById("btnNuovoAnno").addEventListener("click", () => {
  const annoInChiusura = state.meta.annoAttivo;
  const numAttivi = contaAttivi();
  if (
    !confirm(
      `Chiudere l'anno sociale ${annoInChiusura}?\n\nI ${numAttivi} soci attualmente attivi verranno salvati nello Storico soci attivi (anno ${annoInChiusura}). L'elenco "Soci attivi" verra' svuotato e il nuovo anno sara' il ${annoInChiusura + 1}.\n\nProcedere?`
    )
  )
    return;
  const annoChiuso = chiudiAnno();
  renderAll();
  syncInputsFromState();
  toast(`Anno ${annoChiuso} archiviato. Nuovo anno attivo: ${state.meta.annoAttivo}`);
});

// ===================== EXPORT CSV / EXCEL / PDF / BACKUP =====================
function storicoColumns() {
  return [
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
    { label: "Note", value: (s) => notaEffettiva(s, tessereDuplicate(state.soci)) },
  ];
}

function attiviColumns() {
  return [
    { label: "ID", value: (s, i) => i + 1 },
    { label: "Tessera", value: (s) => s.tessera },
    { label: "Socio", value: (s) => s.nominativo },
    { label: "Data di nascita", value: (s) => formatDataIt(s.dataNascita) },
    { label: "Indirizzo", value: (s) => s.indirizzo },
    { label: "e-Mail", value: (s) => s.email },
    { label: "Telefono", value: (s) => s.telefono },
    { label: "Bonifico", value: (s) => (s.pagamentoBonifico ? "si" : "no") },
    { label: "Quota pagata", value: (s) => (s.quotaPagata ? "si" : "no") },
    { label: "Ricevuta consegnata", value: (s) => (s.ricevutaConsegnata ? "si" : "no") },
    { label: "Quota", value: (s) => s.quota },
  ];
}

// --- Excel: libreria SheetJS caricata al volo solo al primo utilizzo ---
let xlsxLoadPromise = null;
function loadXlsxLib() {
  if (window.XLSX) return Promise.resolve();
  if (xlsxLoadPromise) return xlsxLoadPromise;
  xlsxLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Impossibile caricare la libreria Excel"));
    document.head.appendChild(script);
  });
  return xlsxLoadPromise;
}

async function exportXlsx(rows, columns, filenamePrefix) {
  await loadXlsxLib();
  const data = rows.map((r, i) => {
    const obj = {};
    columns.forEach((c) => {
      const v = c.value(r, i);
      obj[c.label] = v === null || v === undefined ? "" : v;
    });
    return obj;
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Soci");
  XLSX.writeFile(wb, `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// --- PDF: nessuna libreria, si appoggia alla stampa nativa del browser ---
function exportPdf(rows, columns, titolo, totali) {
  const win = window.open("", "_blank");
  if (!win) {
    toast("Il browser ha bloccato l'apertura della finestra di stampa", "error");
    return;
  }
  win.opener = null;
  const headCells = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");
  const bodyRows = rows
    .map((r, i) => {
      const cells = columns
        .map((c) => {
          const v = c.value(r, i);
          return `<td>${escapeHtml(v === null || v === undefined ? "" : v)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  const footerHtml = totali
    ? `<tfoot><tr><td colspan="${columns.length - 1}">${escapeHtml(totali.label)}</td><td>${escapeHtml(totali.value)}</td></tr></tfoot>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8"><title>${escapeHtml(titolo)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:11px;margin:20px;color:#222;}
  h1{font-size:16px;margin-bottom:2px;}
  p{margin-top:0;color:#555;font-size:11px;}
  table{width:100%;border-collapse:collapse;margin-top:12px;}
  th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;}
  th{background:#e8f1f8;}
  tr:nth-child(even){background:#f7f8fa;}
  tfoot td{font-weight:bold;background:#e8f1f8;}
  @media print{ @page{ size: landscape; margin: 10mm; } }
</style></head>
<body>
  <h1>${escapeHtml(titolo)}</h1>
  <p>Gruppo Aeromodellistico Piave &middot; generato il ${new Date().toLocaleDateString("it-IT")} &middot; ${rows.length} soci</p>
  <table><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody>${footerHtml}</table>
</body></html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

document.getElementById("btnExportCsv").addEventListener("click", () => {
  exportCsv(filteredStorico(), storicoColumns());
  toast("CSV esportato");
});

document.getElementById("btnScaricaBackup").addEventListener("click", () => {
  downloadJsonBackup();
  toast("Backup scaricato");
});

function aggiungiPulsantiExport(risultatoId, rowsGetter, columnsGetter, filePrefix, titoloPdf, totaliPdf) {
  const anchor = document.getElementById(risultatoId);
  const btnXlsx = document.createElement("button");
  btnXlsx.className = "btn";
  btnXlsx.textContent = "Esporta Excel";
  btnXlsx.addEventListener("click", async () => {
    try {
      await exportXlsx(rowsGetter(), columnsGetter(), filePrefix);
      toast("Excel esportato");
    } catch (err) {
      console.error(err);
      toast("Errore nell'esportazione Excel: " + err.message, "error");
    }
  });
  const btnPdf = document.createElement("button");
  btnPdf.className = "btn";
  btnPdf.textContent = "Esporta PDF";
  btnPdf.addEventListener("click", () => {
    const titolo = typeof titoloPdf === "function" ? titoloPdf() : titoloPdf;
    const rows = rowsGetter();
    const totali = totaliPdf ? totaliPdf(rows) : null;
    exportPdf(rows, columnsGetter(), titolo, totali);
  });
  anchor.insertAdjacentElement("beforebegin", btnXlsx);
  anchor.insertAdjacentElement("beforebegin", btnPdf);
}

aggiungiPulsantiExport(
  "storicoCount",
  filteredStorico,
  storicoColumns,
  "lista-soci-gruppo-piave",
  "Lista soci - Gruppo Aeromodellistico Piave"
);
aggiungiPulsantiExport(
  "attiviCount",
  filteredAttivi,
  attiviColumns,
  "soci-attivi-gruppo-piave",
  () => `Soci attivi ${state.meta.annoAttivo} - Gruppo Aeromodellistico Piave`,
  (rows) => ({
    label: "Totale quote incassate",
    value: "€ " + rows.reduce((sum, s) => sum + (Number(s.quota) || 0), 0).toFixed(2),
  })
);

// --- Estrazione per assicurazione: PDF a formato fisso, sempre ordinato per nome ---
document.getElementById("btnEstrazioneAssicurazione").addEventListener("click", () => {
  const list = state.soci.filter((s) => s.attivo).sort((a, b) => cmp(a.nominativo, b.nominativo));
  if (list.length === 0) {
    toast("Nessun socio attivo da esportare", "error");
    return;
  }
  const columns = [
    { label: "ID", value: (s, i) => i + 1 },
    { label: "Tessera", value: (s) => s.tessera },
    { label: "Cognome e nome", value: (s) => s.nominativo },
    { label: "Data di nascita", value: (s) => formatDataIt(s.dataNascita) },
    { label: "Indirizzo", value: (s) => s.indirizzo },
    { label: "e-Mail", value: (s) => s.email },
    { label: "Telefono", value: (s) => s.telefono },
  ];
  exportPdf(list, columns, `Estrazione per assicurazione ${state.meta.annoAttivo} - Gruppo Aeromodellistico Piave`);
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
    setData(parsed.meta || state.meta, parsed.soci, parsed.storicoAttivi || []);
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
  inputAnno.value = state.meta.annoAttivo;
  inputAnno.readOnly = true;
  inputAnno.title = "Si aggiorna solo chiudendo l'anno dalla scheda Soci attivi";
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
    info.innerHTML = `File collegato: <code>${escapeHtml(fileId)}</code>. <a href="https://drive.google.com/file/d/${escapeAttr(fileId)}/view" target="_blank" rel="noopener">Apri su Google Drive</a> per condividerlo con altri account.`;
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
    const payload = { meta: state.meta, soci: state.soci, storicoAttivi: state.storicoAttivi };
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
  setData(content.meta || state.meta, content.soci, content.storicoAttivi || []);
  clearDirty();
  renderAll();
  syncInputsFromState();
  updateSyncStatusUI();
}

// ===================== VISIBILITA'/ETICHETTA SCHEDA IMPOSTAZIONI (SOLO ADMIN) =====================
const tabBtnImpostazioni = document.getElementById("tabBtnImpostazioni");

function applyAdminVisibility(email) {
  const restricted = !!Drive.ADMIN_EMAIL;
  const isAdmin = restricted && email && email.toLowerCase() === Drive.ADMIN_EMAIL.toLowerCase();
  // Finche' non conosciamo l'email (prima del login) la scheda resta visibile,
  // altrimenti nessuno (nemmeno l'admin) potrebbe mai cliccare "Accedi con Google".
  const shouldHide = restricted && email && !isAdmin;
  tabBtnImpostazioni.hidden = shouldHide;
  tabBtnImpostazioni.textContent = isAdmin ? "Impostazioni / Sync" : "Accedi";
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
      setData(vuoto.meta, vuoto.soci, vuoto.storicoAttivi);
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
    const payload = { meta: state.meta, soci: state.soci, storicoAttivi: state.storicoAttivi };
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
              toast(
                "Impossibile caricare i dati da Drive. Se e' la prima volta che accedi, vai in Impostazioni e usa \"Connetti a file esistente\" per autorizzare l'accesso.",
                "error"
              );
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
