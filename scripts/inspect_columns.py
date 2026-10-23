import pdfplumber

path = r"C:\Users\Alessio\Downloads\allegati\RCP Reperto soci 2026 (3).pdf"
with pdfplumber.open(path) as pdf:
    page = pdf.pages[0]
    words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
    for w in words:
        if w['top'] < 115:
            print(f"{w['text']!r:25} x0={w['x0']:.1f} x1={w['x1']:.1f} top={w['top']:.1f}")
