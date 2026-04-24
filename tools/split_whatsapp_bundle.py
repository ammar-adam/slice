import re
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
text = (ROOT / "docs" / "whatsapp-source-bundle.md").read_text(encoding="utf-8")
pattern = r"<!-- FILE: (.+?) -->\s*~~~[^\n]*\r?\n(.*?)~~~"
for m in re.finditer(pattern, text, re.DOTALL):
    rel = m.group(1).strip()
    body = m.group(2).lstrip("\n").rstrip("\n") + "\n"
    out = ROOT / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(body, encoding="utf-8", newline="\n")
    print("wrote", rel)
print("done")
