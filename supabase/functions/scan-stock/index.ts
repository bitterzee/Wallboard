// scan-stock: looks at photos of the fridge, freezer or cupboards and lists the food it can see.
// Uses Claude's vision through the Anthropic API. Household members only.
// Needs the ANTHROPIC_API_KEY secret (Supabase Dashboard → Edge Functions → Secrets).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Only the wallboard's own site may call this from a browser.
const ALLOWED_ORIGIN = /^https:\/\/bitterzee\.github\.io$|^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
function withCors(h: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const o = req.headers.get("Origin") ?? "";
    let res: Response;
    try { res = await h(req); } catch (e) { console.error(e); res = new Response(JSON.stringify({ error: "Something went wrong. Try again." }), { status: 500, headers: { "Content-Type": "application/json" } }); }
    const r = new Response(res.body, res);
    r.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN.test(o) ? o : "https://bitterzee.github.io");
    r.headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
    r.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    r.headers.set("Vary", "Origin"); r.headers.set("X-Content-Type-Options", "nosniff"); r.headers.set("Cache-Control", "no-store");
    return r;
  };
}
const MODEL = Deno.env.get("SCAN_MODEL") || "claude-sonnet-5-5";
const LOCS = ["Fridge", "Freezer", "Cupboard"];

const TOOL = {
  name: "report_items",
  description: "Report every food or cooking ingredient visible in the photos.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Short everyday ingredient name a home cook would write on a shopping list, e.g. 'Eggs', 'Spinach', 'Kecap manis', 'Chicken thighs'. Use the common Indonesian name when the product is Indonesian and has no usual English name (e.g. 'Tempeh', 'Sambal oelek')." },
            qty: { type: "string", description: "Rough visible amount, e.g. '6', '1 bunch', '2 bottles', 'half a bag'. Empty string if you can't tell." },
            location: { type: "string", enum: LOCS },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["name", "qty", "location", "confidence"],
        },
      },
      note: { type: "string", description: "One short sentence if the photos were too dark, blurry or didn't show food. Otherwise empty." },
    },
    required: ["items", "note"],
  },
};

Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: ok, error: authErr } = await userClient.rpc("wb_is_member");
  if (authErr || ok !== true) return json({ error: "Sign in to the wallboard first." }, 401);

  const KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!KEY) return json({ error: "Photo scanning isn't switched on yet. Add an ANTHROPIC_API_KEY secret in Supabase." }, 503);
  { const { data: allowed, error: capErr } = await userClient.rpc("wb_ai_tick"); if (!capErr && allowed === false) return json({ error: "You've used Claude a lot today. It'll be available again tomorrow." }, 429); }

  let body: { images?: { data: string; media_type?: string }[]; where?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  const imgs = (body.images ?? []).filter((i) => typeof i?.data === "string" && i.data.length > 100).slice(0, 4);
  if (!imgs.length) return json({ error: "Add at least one photo." }, 400);
  if (imgs.some((i) => i.data.length > 3_500_000)) return json({ error: "One of the photos is too large." }, 413);
  const where = LOCS.includes(body.where ?? "") ? body.where : "";

  const content: unknown[] = imgs.map((i) => ({ type: "image", source: { type: "base64", media_type: /^image\/(jpeg|png|webp|gif)$/.test(i.media_type ?? "") ? i.media_type : "image/jpeg", data: i.data } }));
  content.push({ type: "text", text:
    `These are photos of a family kitchen in Indonesia${where ? `, taken in the ${where.toLowerCase()}` : " (fridge, freezer or cupboards)"}. ` +
    `List the food and cooking ingredients you can actually see, one entry per distinct ingredient, merging duplicates across photos. ` +
    `Read labels where you can. Skip non-food items, dishes, cleaning products and anything you can only guess at. ` +
    `For location, use ${where ? `"${where}" unless an item is clearly elsewhere` : "where the item is in the photo; dry goods and jars on shelves are Cupboard"}. ` +
    `Call report_items once.` });

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, tools: [TOOL], tool_choice: { type: "auto" }, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(110000),
    });
  } catch { return json({ error: "The photo reader took too long. Try fewer photos." }, 504); }
  if (!res.ok) {
    const t = await res.text(); console.error("anthropic", res.status, t.slice(0, 500));
    if (res.status === 401) return json({ error: "The Anthropic API key isn't valid. Check the ANTHROPIC_API_KEY secret." }, 502);
    if (res.status === 429 || res.status === 529) return json({ error: "The photo reader is busy. Try again in a minute." }, 503);
    if (/credit|billing/i.test(t)) return json({ error: "The Anthropic account is out of credit." }, 502);
    return json({ error: "Couldn't read those photos. Try again." }, 502);
  }
  const out = await res.json();
  const use = (out.content ?? []).find((c: { type: string }) => c.type === "tool_use");
  const raw = use?.input ?? { items: [], note: "" };
  const seen = new Set<string>();
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map((x: Record<string, string>) => ({
      name: String(x.name ?? "").trim().slice(0, 60),
      qty: String(x.qty ?? "").trim().slice(0, 30),
      location: LOCS.includes(x.location) ? x.location : (where || "Fridge"),
      confidence: ["high", "medium", "low"].includes(x.confidence) ? x.confidence : "medium",
    }))
    .filter((x: { name: string }) => x.name && !seen.has(x.name.toLowerCase()) && seen.add(x.name.toLowerCase()))
    .slice(0, 80);
  return json({ items, note: String(raw.note ?? "").slice(0, 200) });
}));
