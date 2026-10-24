import {
  state,
  genId,
  calcolaEta,
  calcolaAnzianita,
  formatDataIt,
  prossimoNumeroTessera,
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
import { ADMIN_EMAIL, EDITOR_EMAILS } from "./config.js";

// ===================== PERMESSI: MODIFICA VS SOLA LETTURA =====================
// Chi accede con ADMIN_EMAIL o con un indirizzo elencato in EDITOR_EMAILS puo'
// creare/modificare/eliminare soci e chiudere l'anno. Chiunque altro si puo'
// comunque collegare e vede tutte le tabelle, ma in sola lettura.
let canEdit = false;

function isEditor(email) {
  if (!email) return false;
  const e = email.toLowerCase();
  if (ADMIN_EMAIL && e === ADMIN_EMAIL.toLowerCase()) return true;
  return EDITOR_EMAILS.some((x) => x.toLowerCase() === e);
}

function applyEditPermissions() {
  document.getElementById("btnNuovoSocio").hidden = !canEdit;
  document.getElementById("btnAggiungiAttivo").hidden = !canEdit;
  document.getElementById("btnNuovoAnno").hidden = !canEdit;
  renderAll();
}

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
    case "contanti":
      return socio.contanti ? 1 : 0;
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
        <td>${escapeHtml(s.email)}</td>
        <td>${escapeHtml(s.telefono)}</td>
        <td>${formatDataIt(s.dataEntrata)}</td>
        <td>${anz ?? ""}</td>
        <td>${s.attivo ? '<span class="check-yes">&check;</span>' : '<span class="check-no">—</span>'}</td>
        <td class="col-actions">${canEdit ? '<button class="btn btn-small btn-edit">Modifica</button>' : ""}</td>
      </tr>`;
    })
    .join("");
  document.getElementById("storicoCount").textContent = `${list.length} di ${state.soci.length} soci`;
  updateSortHeaders(document.getElementById("tableStorico"), storicoState.sort);
}

// ===================== RENDER: SOCI ATTIVI (anno corrente) =====================
function sommaQuote(list) {
  return list.reduce((sum, s) => sum + (Number(s.quota) || 0), 0);
}

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
        <td>${check(s.contanti)}</td>
        <td>${s.quota != null ? "€ " + Number(s.quota).toFixed(2) : ""}</td>
        <td>${check(s.quotaPagata)}</td>
        <td class="col-actions">${
          canEdit
            ? '<button class="btn btn-small btn-edit">Modifica</button><button class="btn btn-small btn-danger-outline btn-rimuovi">Rimuovi</button>'
            : ""
        }</td>
      </tr>`;
    })
    .join("");
  document.getElementById("attiviCount").textContent = `${list.length} di ${contaAttivi()} soci attivi`;
  updateSortHeaders(document.getElementById("tableAttivi"), attiviState.sort);
  document.getElementById("attiviTotaleContanti").textContent =
    "€ " + sommaQuote(list.filter((s) => s.contanti)).toFixed(2);
  document.getElementById("attiviTotaleBonifico").textContent =
    "€ " + sommaQuote(list.filter((s) => s.pagamentoBonifico)).toFixed(2);
  document.getElementById("attiviTotaleQuota").textContent = "€ " + sommaQuote(list).toFixed(2);

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

function filteredStoricoAttivi() {
  const archivio = annoStoricoSelezionato();
  if (!archivio) return [];
  const list = archivio.soci.filter((s) => matchesSearch(s, storicoAttiviState.search));
  return sortSoci(list, storicoAttiviState.sort);
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

  const list = filteredStoricoAttivi();

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
        <td>${check(contantiEffettivo(s))}</td>
        <td>${s.quota != null ? "€ " + Number(s.quota).toFixed(2) : ""}</td>
        <td>${check(s.quotaPagata)}</td>
      </tr>`;
    })
    .join("");
  document.getElementById("storicoAttiviCount").textContent = `${list.length} di ${archivio.soci.length} soci (anno ${archivio.anno})`;
  document.getElementById("storicoAttiviTotaleContanti").textContent =
    "€ " + sommaQuote(list.filter((s) => contantiEffettivo(s))).toFixed(2);
  document.getElementById("storicoAttiviTotaleBonifico").textContent =
    "€ " + sommaQuote(list.filter((s) => s.pagamentoBonifico)).toFixed(2);
  document.getElementById("storicoAttiviTotaleQuota").textContent = "€ " + sommaQuote(list).toFixed(2);
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
  if (!canEdit) return;
  const tr = e.target.closest("tr[data-id]");
  if (!tr) return;
  if (e.target.closest(".btn-edit") || !e.target.closest(".col-actions")) openModalSocio(tr.dataset.id);
});
document.getElementById("attiviBody").addEventListener("click", (e) => {
  if (!canEdit) return;
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
  document.getElementById("fTessera").value = s ? s.tessera || "" : prossimoNumeroTessera(state.soci);
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
  document.getElementById("fContanti").checked = !!s?.contanti;
  document.getElementById("fQuotaPagata").checked = !!s?.quotaPagata;
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
// Inserire un importo in Quota spunta automaticamente "Quota pagata": nella
// grande maggioranza dei casi si registra il pagamento gia' avvenuto.
document.getElementById("fQuota").addEventListener("input", (e) => {
  if (e.target.value !== "") {
    document.getElementById("fQuotaPagata").checked = true;
  }
});
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
    contanti: document.getElementById("fContanti").checked,
    quotaPagata: document.getElementById("fQuotaPagata").checked,
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
  // I dati di pagamento non si riportano da un'eventuale attivazione
  // precedente: vanno re-inseriti per il nuovo anno dalla scheda Soci attivi.
  s.pagamentoBonifico = false;
  s.contanti = false;
  s.quotaPagata = false;
  s.quota = null;
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
// Nei PDF, le colonne si/no con pdfValue mostrano un segno di spunta verde
// (si) o di divieto grigio (no) al posto del testo; nowrap evita che mail e
// telefono vadano a capo in stampa.
function iconSiNo(v) {
  return v
    ? '<span style="color:#1f8a4c;font-weight:bold;">&#10003;</span>'
    : '<span style="color:#9aa3af;">&#8856;</span>';
}

// Negli anni storici piu' vecchi il campo "contanti" non esisteva ancora:
// chi aveva pagato in contanti risulta quindi con bonifico e contanti
// entrambi vuoti. Solo nello storico (mai nell'anno corrente, dove un campo
// vuoto e' un dato reale non ancora inserito) si considera pagato in
// contanti quando entrambi i campi risultano vuoti.
function contantiEffettivo(s) {
  return !s.pagamentoBonifico && !s.contanti ? true : !!s.contanti;
}

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
    { label: "e-Mail", value: (s) => s.email, nowrap: true },
    { label: "Telefono", value: (s) => s.telefono, nowrap: true },
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
    { label: "e-Mail", value: (s) => s.email, nowrap: true },
    { label: "Telefono", value: (s) => s.telefono, nowrap: true },
    { label: "Bonifico", value: (s) => (s.pagamentoBonifico ? "si" : "no"), pdfValue: (s) => iconSiNo(s.pagamentoBonifico) },
    { label: "Contanti", value: (s) => (s.contanti ? "si" : "no"), pdfValue: (s) => iconSiNo(s.contanti) },
    { label: "Quota", value: (s) => s.quota },
    { label: "Quota pagata", value: (s) => (s.quotaPagata ? "si" : "no"), pdfValue: (s) => iconSiNo(s.quotaPagata) },
  ];
}

// Colonne per l'export (Excel/PDF) dello storico soci attivi: identiche a
// attiviColumns(), con "Contanti" corretto da contantiEffettivo() per gli
// anni storici in cui il campo non esisteva ancora.
function storicoAttiviColumns() {
  return attiviColumns().map((c) =>
    c.label === "Contanti"
      ? { ...c, value: (s) => (contantiEffettivo(s) ? "si" : "no"), pdfValue: (s) => iconSiNo(contantiEffettivo(s)) }
      : c
  );
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

// Logo del gruppo incorporato come data URI: la finestra di stampa e' un
// documento "vuoto" (window.open("", ...)) senza indirizzo proprio, quindi
// un percorso relativo come assets/logo...png non si risolverebbe.
const PDF_LOGO_DATA_URI =
  "data:image/png;base64,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";

// --- PDF: nessuna libreria, si appoggia alla stampa nativa del browser ---
// "totali" e' un array di { label, value }: una riga di piede tabella per
// ciascuno (es. totale contanti, totale bonifico, totale quote), nell'ordine
// passato.
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
          const style = c.nowrap ? ' style="white-space:nowrap;"' : "";
          if (c.pdfValue) return `<td${style}>${c.pdfValue(r, i) ?? ""}</td>`;
          const v = c.value(r, i);
          return `<td${style}>${escapeHtml(v === null || v === undefined ? "" : v)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  const footerHtml =
    totali && totali.length
      ? `<tfoot>${totali
          .map((t) => `<tr><td colspan="${columns.length - 1}">${escapeHtml(t.label)}</td><td>${escapeHtml(t.value)}</td></tr>`)
          .join("")}</tfoot>`
      : "";
  const html = `<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8"><title>${escapeHtml(titolo)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:9.5px;margin:15px;color:#222;}
  .pdf-header{display:flex;align-items:center;gap:10px;margin-bottom:4px;}
  .pdf-header img{width:40px;height:40px;}
  h1{font-size:15px;margin:0;}
  p{margin:2px 0 0;color:#555;font-size:10px;}
  table{width:100%;border-collapse:collapse;margin-top:10px;}
  th,td{border:1px solid #ccc;padding:2px 5px;text-align:left;}
  th{background:#e8f1f8;}
  tr:nth-child(even){background:#f7f8fa;}
  /* display:table-row-group (invece del default table-footer-group) evita
     che il totale si ripeta in fondo a ogni pagina stampata: compare una
     sola volta, subito dopo l'ultima riga di dati. */
  tfoot{display:table-row-group;}
  tfoot td{font-weight:bold;background:#e8f1f8;}
  @media print{ @page{ size: landscape; margin: 8mm; } }
</style></head>
<body>
  <div class="pdf-header">
    <img src="${PDF_LOGO_DATA_URI}" alt="Logo">
    <div>
      <h1>${escapeHtml(titolo)}</h1>
      <p>Gruppo Aeromodellistico Piave &middot; generato il ${new Date().toLocaleDateString("it-IT")} &middot; ${rows.length} soci</p>
    </div>
  </div>
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
  (rows) => [
    { label: "Totale pagato in contanti", value: "€ " + sommaQuote(rows.filter((s) => s.contanti)).toFixed(2) },
    { label: "Totale pagato tramite bonifico", value: "€ " + sommaQuote(rows.filter((s) => s.pagamentoBonifico)).toFixed(2) },
    { label: "Totale quote incassate", value: "€ " + sommaQuote(rows).toFixed(2) },
  ]
);
aggiungiPulsantiExport(
  "storicoAttiviCount",
  filteredStoricoAttivi,
  storicoAttiviColumns,
  "storico-soci-attivi-gruppo-piave",
  () => `Storico soci attivi ${annoStoricoSelezionato()?.anno ?? ""} - Gruppo Aeromodellistico Piave`,
  (rows) => [
    { label: "Totale pagato in contanti", value: "€ " + sommaQuote(rows.filter((s) => contantiEffettivo(s))).toFixed(2) },
    { label: "Totale pagato tramite bonifico", value: "€ " + sommaQuote(rows.filter((s) => s.pagamentoBonifico)).toFixed(2) },
    { label: "Totale quote incassate", value: "€ " + sommaQuote(rows).toFixed(2) },
  ]
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
    { label: "e-Mail", value: (s) => s.email, nowrap: true },
    { label: "Telefono", value: (s) => s.telefono, nowrap: true },
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
  const restricted = !!ADMIN_EMAIL;
  const isAdmin = restricted && email && email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
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
      canEdit = false;
      applyEditPermissions();
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
          Drive.getUserEmail().then((email) => {
            applyAdminVisibility(email);
            canEdit = isEditor(email);
            applyEditPermissions();
          });
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
          canEdit = false;
          applyEditPermissions();
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
  applyEditPermissions();
  initGoogleWhenReady();

  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

main();
