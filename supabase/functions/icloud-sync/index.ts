// icloud-sync: copies new photos from an iCloud shared album (public link) onto the wall,
// and removes ones that were taken out of the album. Parents only; the wall calls it about hourly.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
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
// deno-lint-ignore no-explicit-any
type Any = any;

function tokenOf(url: string): string | null {
  const m = String(url).trim().match(/icloud\.com\/sharedalbum\/[^#]*#([A-Za-z0-9]+)/) ?? String(url).trim().match(/^([A-Za-z0-9]{10,20})$/);
  return m ? m[1] : null;
}
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function partition(token: string) {
  const n = (s: string) => [...s].reduce((a, c) => a * 62 + BASE62.indexOf(c), 0);
  const p = token[0] === "A" ? n(token[1]) : n(token.slice(1, 3));
  return `p${String(p).padStart(2, "0")}-sharedstreams.icloud.com`;
}
async function post(host: string, token: string, path: string, body: unknown): Promise<{ host: string; data: Any }> {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`https://${host}/${token}/sharedstreams/${path}`, { method: "POST", headers: { "Content-Type": "text/plain", Origin: "https://www.icloud.com" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (r.status === 330) { const j = await r.json().catch(() => ({})); const h = j["X-Apple-MMe-Host"]; if (h && /^p\d+-sharedstreams\.icloud\.com$/.test(h)) { host = h; continue; } }
    if (!r.ok) throw new Error(r.status === 404 ? "That shared album link doesn't work. Check that Public Website is turned on for the album." : `iCloud answered ${r.status}.`);
    return { host, data: await r.json() };
  }
  throw new Error("iCloud kept redirecting.");
}

Deno.serve(withCors(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: ok } = await db.rpc("wb_is_member");
  if (ok !== true) return json({ error: "Sign in to the wallboard first." }, 401);
  let body: Any = {}; try { body = await req.json(); } catch { /* */ }
  const { data: st } = await db.from("wb_state").select("value").eq("key", "icloud").maybeSingle();
  const url = typeof body.url === "string" ? body.url.slice(0, 300) : st?.value?.url; const token = url && tokenOf(url);
  if (!token) return json({ error: "Paste the album's public link, like https://www.icloud.com/sharedalbum/#B0aB…" }, 400);
  try {
    const first = await post(partition(token), token, "webstream", { streamCtag: null });
    const host = first.host, stream = first.data;
    const all = (stream.photos ?? []).filter((p: Any) => p.mediaAssetType !== "video" && p.derivatives);
    const keep = new Set(all.map((p: Any) => "icloud:" + p.photoGuid));
    const { data: have } = await db.from("wb_photos").select("id,path,source_id").like("source_id", "icloud:%");
    const haveIds = new Set((have ?? []).map((h: Any) => h.source_id));
    // removed from the album -> remove from the wall
    let removed = 0;
    for (const h of have ?? []) if (!keep.has(h.source_id)) { await db.from("wb_photos").delete().eq("id", h.id); await db.storage.from("wallboard").remove([h.path]); removed++; }
    const fresh = all.filter((p: Any) => !haveIds.has("icloud:" + p.photoGuid)).slice(0, 15);
    let added = 0;
    if (fresh.length) {
      const pickDer = (p: Any) => { const ds = Object.values(p.derivatives) as Any[]; const ok = ds.filter((d) => +d.width <= 2200).sort((a, b) => +b.width - +a.width); return ok[0] ?? ds.sort((a, b) => +a.width - +b.width)[0]; };
      const urls = (await post(host, token, "webasseturls", { photoGuids: fresh.map((p: Any) => p.photoGuid) })).data.items ?? {};
      for (const p of fresh) {
        try {
          const d = pickDer(p); const u = urls[d?.checksum]; if (!u || !/^[a-z0-9.-]+\.(icloud-content\.com|icloud\.com|apple\.com)$/i.test(String(u.url_location)) || !String(u.url_path).startsWith("/")) continue;
          const img = await fetch(`https://${u.url_location}${u.url_path}`, { redirect: "error", signal: AbortSignal.timeout(20000) }); if (!img.ok) continue;
          const type = (img.headers.get("content-type") ?? "image/jpeg").split(";")[0]; if (!/^image\/(jpeg|png|heic|webp)$/.test(type)) continue;
          const buf = new Uint8Array(await img.arrayBuffer()); if (buf.length > 15_000_000) continue;
          const path = `photos/icloud-${p.photoGuid}.${type === "image/png" ? "png" : "jpg"}`;
          const up = await db.storage.from("wallboard").upload(path, buf, { contentType: type, upsert: true }); if (up.error) continue;
          const taken = (p.exifDateTimeOriginal || p.dateCreated || "").slice(0, 10) || null;
          const ins = await db.from("wb_photos").insert({ path, uploaded_by_name: p.contributorFirstName || "iCloud album", taken_at: taken, source_id: "icloud:" + p.photoGuid });
          if (!ins.error) added++;
        } catch { /* next photo */ }
      }
    }
    const val = { url, album: stream.streamName ?? null, last_sync: new Date().toISOString(), total: all.length, pending: Math.max(0, all.length - (haveIds.size - removed) - added) };
    await db.from("wb_state").upsert({ key: "icloud", value: val, updated_at: new Date().toISOString() });
    return json({ ...val, added, removed });
  } catch (e) { return json({ error: (e as Error).message }, 502); }
}));
