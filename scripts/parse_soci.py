import pdfplumber
import json
import re

SCRATCH = r"C:\Users\Alessio\AppData\Local\Temp\claude\C--Users-Alessio-Documents-App-Gruppo-Piave\9155eaa8-a1b2-423e-a7fd-3fce192f4990\scratchpad"
BASE_DIR = r"C:\Users\Alessio\Downloads\allegati"

STREET_KEYWORDS = (
    "Via", "Viale", "Piazza", "Vicolo", "Corso", "Strada", "Riviera",
    "Largo", "Calle", "Borgo", "Contrada", "Piazzale", "Fondamenta",
)

DATE_RE = r"\d{1,2}\.\d{1,2}\.\d{2,4}"

ROW_RE = re.compile(
    r"^(?P<tessera>\d+(?:/[A-Z])?|---)\s+"
    r"(?P<socio>.+?)\s+"
    r"\d{1,3}\s+"                                   # eta (discarded, computed later)
    r"(?:(?P<natoil>" + DATE_RE + r")\s+)?"
    r"(?P<rest>.*?)"
    r"(?:\s*(?:(?P<entratoil>" + DATE_RE + r")|202)\s*)?"
    r"(?:\s+-?\d{1,3}\s*)?"                         # anzianita (discarded)
    r"\s*(?P<attivo>[!√])\s*$"
)


def split_luogo_indirizzo(rest):
    rest = rest.strip()
    if not rest:
        return "", ""
    tokens = rest.split(" ")
    for i, tok in enumerate(tokens):
        if tok in STREET_KEYWORDS:
            return " ".join(tokens[:i]).strip(), " ".join(tokens[i:]).strip()
    return rest, ""


def parse_date(raw):
    raw = (raw or "").strip()
    if not raw:
        return None, None
    m = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$", raw)
    if not m:
        return None, raw
    d, mo, y = m.groups()
    if len(y) != 4:
        return None, raw
    try:
        d, mo, y = int(d), int(mo), int(y)
        if not (1 <= d <= 31 and 1 <= mo <= 12 and 1900 <= y <= 2026):
            return None, raw
        return f"{y:04d}-{mo:02d}-{d:02d}", None
    except ValueError:
        return None, raw


SKIP_SUBSTR = (
    "ASD Gruppo", "Listino base", "Pagina", "Nbr. socci", "Elenco soci",
    "Tessera Socio",
)


def iter_data_lines(pdf_path):
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for line in text.split("\n"):
                line = line.strip()
                if not line:
                    continue
                if any(s in line for s in SKIP_SUBSTR):
                    continue
                yield line


def extract_base():
    records = []
    warnings = []
    for line in iter_data_lines(fr"{BASE_DIR}\RCP Reperto soci base.pdf"):
        m = ROW_RE.match(line)
        if not m:
            warnings.append(f"RIGA NON RICONOSCIUTA: {line!r}")
            continue
        tessera = m.group("tessera")
        socio = m.group("socio").strip()
        dn_iso, dn_raw = parse_date(m.group("natoil"))
        luogo, indirizzo = split_luogo_indirizzo(m.group("rest") or "")
        de_iso, de_raw = parse_date(m.group("entratoil"))
        if dn_raw:
            warnings.append(f"base: tessera={tessera!r} socio={socio!r} data nascita non valida: {dn_raw!r}")
        if de_raw:
            warnings.append(f"base: tessera={tessera!r} socio={socio!r} data entrata non valida: {de_raw!r}")
        records.append({
            "tessera": tessera if tessera != "---" else "",
            "cognomeNome": socio,
            "dataNascita": dn_iso,
            "luogoNascita": luogo,
            "indirizzo": indirizzo,
            "dataEntrata": de_iso,
        })
    # Known source-PDF rendering glitch: tessera 502's name run into the age
    # ("Paolo51") with no space in the original PDF text stream, breaking the
    # column split for that single row. Patch using the clean values visible
    # in the source document.
    for r in records:
        if r["tessera"] == "502":
            r["cognomeNome"] = "Cotticelli Francesco Paolo"
            r["dataNascita"] = "1974-08-06"
            r["luogoNascita"] = "Castellammare D..."
            r["indirizzo"] = "Vicolo Piemonte 1 - 31010 Mareno Di Piave(TV)"
    return records, warnings


ATTIVI_ROW_RE = re.compile(
    r"^(?P<num>\d+)\s+"
    r"(?P<tessera>\d+)\s+"
    r"(?P<socio>.+?)\s+"
    r"(?P<natoil>" + DATE_RE + r")\s+"
    r"\d{1,3}\s+"                                    # eta (discarded)
    r"(?P<rest>.*?)\s+"
    r"(?P<quota>\d+\.\d{2})\s+"
    r"(?P<flags>.*)$"
)


def extract_attivi():
    records = []
    warnings = []
    for line in iter_data_lines(fr"{BASE_DIR}\RCP Reperto soci 2026 (3).pdf"):
        if line.startswith("#") or line.startswith("Nbr. socci") or "Totale quote" in line \
           or "Quote pagate" in line or "Soci con ass" in line or line.startswith("O ") \
           or line.startswith("B ") or line.startswith("!") or "Quota pagata" in line \
           or "da incassare" in line:
            continue
        m = ATTIVI_ROW_RE.match(line)
        if not m:
            warnings.append(f"RIGA NON RICONOSCIUTA (attivi2026): {line!r}")
            continue
        tessera = m.group("tessera")
        socio = m.group("socio").strip()
        dn_iso, dn_raw = parse_date(m.group("natoil"))
        rest = (m.group("rest") or "").strip()
        quota = float(m.group("quota"))
        flags = (m.group("flags") or "").strip().split()
        pagato = len(flags) >= 1 and flags[0] == "√"
        ricevuta = len(flags) >= 2 and flags[1] == "√"

        bonifico = bool(re.search(r"\sB$", rest))
        rest = re.sub(r"\sB$", "", rest).strip()
        rest = re.sub(r"\s\d{1,3}$", "", rest).strip()  # strip trailing Anz.
        phone_m = re.search(r"(\d{3}\s\d{3}\s\d{4})$", rest)
        telefono = phone_m.group(1) if phone_m else ""
        if phone_m:
            rest = rest[:phone_m.start()].strip()
        email_m = re.search(r"([\w.+-]+@[\w.-]+\.\w+)$", rest)
        email = email_m.group(1) if email_m else ""

        if dn_raw:
            warnings.append(f"attivi2026: tessera={tessera!r} socio={socio!r} data nascita non valida: {dn_raw!r}")
        records.append({
            "tessera": tessera,
            "cognomeNome": socio,
            "dataNascita": dn_iso,
            "email": email,
            "telefono": telefono,
            "quota": quota,
            "pagamentoBonifico": bonifico,
            "quotaPagata": pagato,
            "ricevutaConsegnata": ricevuta,
        })
    return records, warnings


if __name__ == "__main__":
    base_records, w1 = extract_base()
    attivi_records, w2 = extract_attivi()

    def norm(name):
        return re.sub(r"\s+", " ", name).strip().casefold()

    # tessera is NOT a reliable unique key in the club's own data: 20 numbers are
    # reused across different people even within the 409-row historical list, and
    # tessera 358 is shared by two different people *within the 90 active members
    # themselves* (Andreetta Claudio / Cittolin Domenico). Match on full name instead.
    attivi_by_name = {norm(r['cognomeNome']): r for r in attivi_records}
    base_tessere = {r['tessera'] for r in base_records if r['tessera']}

    merged = []
    matched_names = set()
    for rec in base_records:
        att = attivi_by_name.get(norm(rec['cognomeNome']))
        entry = dict(rec)
        entry['attivo'] = att is not None
        if att:
            matched_names.add(norm(rec['cognomeNome']))
        if att:
            entry['email'] = att['email']
            entry['telefono'] = att['telefono']
            entry['quota'] = att['quota']
            entry['pagamentoBonifico'] = att['pagamentoBonifico']
            entry['quotaPagata'] = att['quotaPagata']
            entry['ricevutaConsegnata'] = att['ricevutaConsegnata']
        else:
            entry['email'] = ""
            entry['telefono'] = ""
            entry['quota'] = None
            entry['pagamentoBonifico'] = False
            entry['quotaPagata'] = False
            entry['ricevutaConsegnata'] = False
        merged.append(entry)

    missing = [r['cognomeNome'] for r in attivi_records if norm(r['cognomeNome']) not in matched_names]
    dup_tessere = sorted({r['tessera'] for r in base_records if r['tessera'] and
                           sum(1 for x in base_records if x['tessera'] == r['tessera']) > 1})

    out = {
        "soci": merged,
        "count_base": len(base_records),
        "count_attivi2026": len(attivi_records),
        "count_matched_active": sum(1 for r in merged if r['attivo']),
        "missing_from_base": missing,
        "duplicate_tessere": dup_tessere,
        "warnings": w1 + w2,
    }
    with open(fr"{SCRATCH}\soci_parsed.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print("count_base:", out["count_base"])
    print("count_attivi2026:", out["count_attivi2026"])
    print("count_matched_active:", out["count_matched_active"])
    print("missing_from_base:", out["missing_from_base"])
    print("duplicate_tessere:", out["duplicate_tessere"])
    print("warnings:", len(out["warnings"]))
    for w in out["warnings"][:80]:
        print(" -", w)
