import pdfplumber

SCRATCH = r"C:\Users\Alessio\AppData\Local\Temp\claude\C--Users-Alessio-Documents-App-Gruppo-Piave\9155eaa8-a1b2-423e-a7fd-3fce192f4990\scratchpad"

def dump(path, label, outname):
    lines = [f"\n{'='*80}\n{label}: {path}\n{'='*80}"]
    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages):
            lines.append(f"\n--- Page {i+1} ---")
            text = page.extract_text(layout=True) or ""
            lines.append(text)
    out = "\n".join(lines)
    with open(fr"{SCRATCH}\{outname}", "w", encoding="utf-8") as f:
        f.write(out)
    print(f"Wrote {outname}: {len(out)} chars")

if __name__ == "__main__":
    base = r"C:\Users\Alessio\Downloads\allegati"
    dump(fr"{base}\RCP Reperto soci base.pdf", "BASE (alfabetico)", "base_raw.txt")
    dump(fr"{base}\RCP Reperto soci 2026 (3).pdf", "2026 (attivi)", "attivi2026_raw.txt")
