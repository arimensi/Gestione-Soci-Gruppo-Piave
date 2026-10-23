import json
import re
from datetime import date

SCRATCH = r"C:\Users\Alessio\AppData\Local\Temp\claude\C--Users-Alessio-Documents-App-Gruppo-Piave\9155eaa8-a1b2-423e-a7fd-3fce192f4990\scratchpad"

with open(fr"{SCRATCH}\soci_parsed.json", encoding="utf-8") as f:
    parsed = json.load(f)

dup_tessere = set(parsed["duplicate_tessere"])

soci_out = []
for i, r in enumerate(parsed["soci"], start=1):
    note_bits = []
    if r["dataNascita"] is None and r.get("dataEntrata") is None and not r["luogoNascita"] and not r["indirizzo"]:
        note_bits.append("Scheda storica incompleta (nessun dato anagrafico)")
    else:
        if r["dataNascita"] is None and r["cognomeNome"] not in ():
            pass  # handled individually below if needed
    if r["tessera"] in dup_tessere:
        note_bits.append("Numero tessera duplicato nello storico: verificare")
    if r["cognomeNome"] == "Sovran Amorino":
        note_bits.append("Data di nascita nel documento originale non valida (05.05.1691): verificare")
    if r["cognomeNome"] == "Spalla Luigi":
        note_bits.append("Data di nascita nel documento originale incompleta (09.07.967): verificare")
    if r["luogoNascita"].endswith("..."):
        note_bits.append("Luogo di nascita troncato nel documento originale")

    soci_out.append({
        "id": f"soc-{i:04d}",
        "tessera": r["tessera"],
        "nominativo": r["cognomeNome"],
        "dataNascita": r["dataNascita"],
        "luogoNascita": r["luogoNascita"],
        "indirizzo": r["indirizzo"],
        "dataEntrata": r["dataEntrata"],
        "attivo": r["attivo"],
        "email": r["email"],
        "telefono": r["telefono"],
        "quota": r["quota"],
        "pagamentoBonifico": r["pagamentoBonifico"],
        "quotaPagata": r["quotaPagata"],
        "ricevutaConsegnata": r["ricevutaConsegnata"],
        "note": "; ".join(note_bits),
    })

out = {
    "meta": {
        "annoAttivo": 2026,
        "limiteSoci": 90,
        "ultimaModifica": None,
        "modificatoDa": None,
        "fonte": f"Importato dai PDF storici del 21.01.2026 il {date.today().isoformat()}",
    },
    "soci": soci_out,
}

parts = [json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in soci_out]
soci_block = "[\n" + ",\n".join(parts) + "\n]"
meta_block = json.dumps(out["meta"], ensure_ascii=False, separators=(",", ":"))
full_text = '{"meta":' + meta_block + ',"soci":' + soci_block + '}\n'

with open(fr"{SCRATCH}\soci-iniziali.json", "w", encoding="utf-8") as f:
    f.write(full_text)

# Also drop a copy in Downloads (next to the source PDFs) so it's easy for the
# user to find and use with the app's "Importa dati iniziali" button -
# Documents is blocked for direct process writes (Controlled Folder Access),
# Downloads is not.
with open(r"C:\Users\Alessio\Downloads\soci-dati-iniziali-GAP.json", "w", encoding="utf-8") as f:
    f.write(full_text)

# sanity: must still be valid JSON equal to `out`
reparsed = json.loads(full_text)
assert reparsed == out, "round-trip mismatch!"

print("Totale soci:", len(soci_out))
print("Attivi:", sum(1 for s in soci_out if s["attivo"]))
print("Con note:", sum(1 for s in soci_out if s["note"]))
print("File size (bytes):", len(full_text.encode("utf-8")))
print("Lines:", full_text.count("\n") + 1)
print("Round-trip OK")
