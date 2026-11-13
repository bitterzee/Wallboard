// import-recipe: given a recipe page URL, returns title, ingredients, steps etc.
// Only wallboard household members (wb_members) may call it.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseRecipe } from "./parse.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Block requests to private / internal addresses.
function blockedHost(h: string): boolean {
  h = h.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".supabase.co") && h.includes("db.")) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h)) return true;
  if (/^(::1?$|fc|fd|fe80:)/.test(h)) return true;
  return false;
}

async function safeFetch(raw: string, accept: string, maxBytes: number): Promise<{ res: Response; body: Uint8Array; url: URL }> {
  let url = new URL(raw);
  for (let hop = 0; hop < 5; hop++) {
    if (!/^https?:$/.test(url.protocol) || blockedHost(url.hostname)) throw new Error("blocked");
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", Accept: accept, "Accept-Language": "en,id;q=0.8" },
      signal: AbortSignal.timeout(12000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location")!, url); continue; }
    const reader = res.body?.getReader(); const chunks: Uint8Array[] = []; let n = 0;
    while (reader) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > maxBytes) { reader.cancel(); break; } chunks.push(value); }
    const body = new Uint8Array(n > maxBytes ? maxBytes : n); let o = 0; for (const c of chunks) { body.set(c.subarray(0, Math.min(c.length, body.length - o)), o); o += c.length; if (o >= body.length) break; }
    return { res, body, url };
  }
  throw new Error("too many redirects");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Members only: check through the caller's own session.
  const auth = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: ok, error: authErr } = await userClient.rpc("wb_is_member");
  if (authErr || ok !== true) return json({ error: "Sign in to the wallboard first." }, 401);

  let target = "";
  try { target = String((await req.json()).url ?? "").trim(); } catch { /* empty */ }
  if (!/^https?:\/\//i.test(target)) return json({ error: "Paste a full link that starts with https://" }, 400);

  let page;
  try { page = await safeFetch(target, "text/html,application/xhtml+xml", 3_000_000); }
  catch (e) { return json({ error: (e as Error).message === "blocked" ? "That link can't be imported." : "Couldn't open that page. Check the link and try again." }, 400); }
  if (!page.res.ok) return json({ error: `That site answered with an error (${page.res.status}). Some sites block importing — you can still add it by hand.` }, 400);

  const html = new TextDecoder().decode(page.body);
  const r = parseRecipe(html);

  // Copy the recipe photo into the private wallboard bucket.
  let photo_path: string | null = null;
  if (r.image) {
    try {
      const img = await safeFetch(new URL(r.image, page.url).toString(), "image/avif,image/webp,image/jpeg,image/png,image/*", 8_000_000);
      const type = img.res.headers.get("content-type")?.split(";")[0] ?? "";
      if (img.res.ok && /^image\/(jpeg|png|webp|gif|avif)$/.test(type) && img.body.length > 1000) {
        const ext = type.split("/")[1].replace("jpeg", "jpg");
        const path = `recipes/import-${crypto.randomUUID()}.${ext}`;
        const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
        const { error } = await admin.storage.from("wallboard").upload(path, img.body, { contentType: type });
        if (!error) photo_path = path;
      }
    } catch { /* photo is optional */ }
  }

  return json({
    title: r.title, category: r.category, cook_time: r.cook_time, serves: r.serves,
    ingredients: r.ingredients, steps: r.steps, notes: r.notes,
    source_url: page.url.toString(), photo_path, partial: r.partial,
  });
});
