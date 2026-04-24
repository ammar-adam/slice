from pathlib import Path
p = Path("lib/whatsapp/conversation-state.ts")
s = p.read_text(encoding="utf-8")
old = "import { createAdminClient } from \"@/lib/supabase/admin\";"
new = "import type { Json } from \"@/types/database\";\nimport { createAdminClient } from \"@/lib/supabase/admin\";"
if old not in s:
    raise SystemExit("missing import block")
s = s.replace(old, new, 1)
s = s.replace("context_json: context,", "context_json: context as Json,", 1)
p.write_text(s, encoding="utf-8")
print("patched")
