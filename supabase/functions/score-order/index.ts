// Enrichment + V1 model at bet creation — implement Thu milestone.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(() =>
  new Response(JSON.stringify({ ok: true, message: "score-order stub" }), {
    headers: { "content-type": "application/json" },
  })
);
