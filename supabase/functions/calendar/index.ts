// calendar: returns the household's events for the next days from their iCal links.
// Members only. Links live in wb_calendars (row-level security: household only).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { expand } from "./ics.ts";
import { assertPublic } from "./net.ts";

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

async function getIcs(raw: string): Promise<string> {
  let url = new URL(raw.replace(/^webcals?:\/\//i, "https://"));
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(url);
    const res = await fetch(url, { redirect: "manual", headers: { Accept: "text/calendar,*/*", "User-Agent": "Wallboard/1.0" }, signal: AbortSignal.timeout(12000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location")!, url); continue; }
    if (!res.ok) throw new Error(`status ${res.status}`);
    const t = await res.text();
    if (!t.includes("BEGIN:VCALENDAR")) throw new Error("not a calendar");
    return t.slice(0, 8_000_000);
  }
  throw new Error("too many redirects");
}

Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const URL_ = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sb = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: ok, error: e1 } = await sb.rpc("wb_is_member");
  if (e1 || ok !== true) return json({ error: "Sign in to the wallboard first." }, 401);

  let body: { days?: number; tz?: string; test_url?: string } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const tz = body.tz || "Asia/Jakarta";
  const days = Math.min(Math.max(Number(body.days) || 8, 1), 31);
  const from = Date.now() - 12 * 36e5, to = Date.now() + days * 864e5;

  // "Test this link" from Settings, before saving it.
  if (body.test_url) {
    try { const ev = expand(await getIcs(body.test_url), from, to, tz); return json({ ok: true, count: ev.length }); }
    catch (e) { return json({ ok: false, error: (e as Error).message === "blocked" ? "That link can't be used." : "Couldn't read a calendar from that link. Use the secret address in iCal format." }); }
  }

  const { data: cals, error: e2 } = await sb.from("wb_calendars").select("id,name,color,ics_url,owner_name");
  if (e2) return json({ error: "Couldn't load calendars." }, 500);
  const results = await Promise.allSettled((cals ?? []).map(async (c) => {
    const ev = expand(await getIcs(c.ics_url), from, to, tz);
    return ev.map((x) => ({ ...x, cal: c.id, calName: c.name, color: c.color }));
  }));
  const events = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const failed = (cals ?? []).filter((_, i) => results[i].status === "rejected").map((c) => c.name);
  return json({ events, failed });
}));
