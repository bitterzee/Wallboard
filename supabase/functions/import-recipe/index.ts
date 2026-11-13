// import-recipe: given a link, returns title, ingredients, steps, photo.
// Recipe websites: schema.org Recipe data. YouTube: the video description (and any
// recipe page it links to). Instagram: the post caption. Household members only.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseRecipe, meta } from "./parse.ts";
import { parseFreeText, cleanTitle, decodeEntities } from "./freetext.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

function blockedHost(h: string): boolean {
  h = h.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || (h.endsWith(".supabase.co") && h.includes("db."))) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h)) return true;
  if (/^(::1?$|fc|fd|fe80:)/.test(h)) return true;
  return false;
}
async function safeFetch(raw: string, accept: string, maxBytes: number, extra: Record<string, string> = {}): Promise<{ res: Response; body: Uint8Array; url: URL }> {
  let url = new URL(raw);
  for (let hop = 0; hop < 6; hop++) {
    if (!/^https?:$/.test(url.protocol) || blockedHost(url.hostname)) throw new Error("blocked");
    const res = await fetch(url, { redirect: "manual", headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "en,id;q=0.8", ...extra }, signal: AbortSignal.timeout(12000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = new URL(res.headers.get("location")!, url); continue; }
    const reader = res.body?.getReader(); const chunks: Uint8Array[] = []; let n = 0;
    while (reader) { const { done, value } = await reader.read(); if (done) break; if (n + value.length > maxBytes) { chunks.push(value.subarray(0, maxBytes - n)); n = maxBytes; reader.cancel(); break; } chunks.push(value); n += value.length; }
    const body = new Uint8Array(n); let o = 0; for (const c of chunks) { body.set(c, o); o += c.length; }
    return { res, body, url };
  }
  throw new Error("too many redirects");
}

const ytId = (u: URL): string | null => {
  const h = u.hostname.replace(/^(www|m|music)\./, "");
  if (h === "youtu.be") return u.pathname.slice(1, 12) || null;
  if (h.endsWith("youtube.com") || h === "youtube-nocookie.com") {
    const v = u.searchParams.get("v"); if (v) return v.slice(0, 11);
    const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/); if (m) return m[1];
  }
  return null;
};
const igCode = (u: URL): string | null => (/(^|\.)instagram\.com$/.test(u.hostname) ? u.pathname.match(/\/(?:p|reel|reels|tv)\/([\w-]+)/)?.[1] ?? null : null);
const NOT_RECIPE = /(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|facebook\.com|fb\.me|fb\.watch|twitter\.com|x\.com|threads\.net|amzn\.|amazon\.|shopee\.|tokopedia\.|lazada\.|linktr\.ee|spotify\.|patreon\.|discord\.|wa\.me|whatsapp\.|t\.me|epidemicsound|music\.|soundcloud\.|paypal\.|ko-fi\.|bento\.me|beacons\.ai)/i;

async function fromYouTube(id: string) {
  let title = "", desc = "", author = "";
  try {
    const p = await safeFetch(`https://www.youtube.com/watch?v=${id}&hl=en`, "text/html", 4_000_000, { Cookie: "CONSENT=YES+cb; SOCS=CAI" });
    const html = dec(p.body);
    const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;\s*(?:var\s|<\/script>|const\s|let\s)/);
    if (m) { try { const j = JSON.parse(m[1]); title = j.videoDetails?.title ?? ""; desc = j.videoDetails?.shortDescription ?? ""; author = j.videoDetails?.author ?? ""; } catch { /* fall through */ } }
    if (!desc) { const sd = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/); if (sd) { try { desc = JSON.parse(`"${sd[1]}"`); } catch { /* */ } } }
    if (!title) title = meta(html, "og:title") ?? "";
    if (!desc) desc = meta(html, "og:description") ?? "";
  } catch { /* try oEmbed below */ }
  if (!title || !author) {
    try { const o = await safeFetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}`, "application/json", 200_000); const j = JSON.parse(dec(o.body)); title ||= j.title ?? ""; author ||= j.author_name ?? ""; } catch { /* */ }
  }
  return { title, text: desc, author, images: [`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`] };
}

async function fromInstagram(code: string) {
  let caption = "", image: string | null = null, author = "";
  try {
    const p = await safeFetch(`https://www.instagram.com/p/${code}/embed/captioned/`, "text/html", 3_000_000);
    const html = dec(p.body);
    const cm = html.match(/class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments"/) ?? html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/);
    if (cm) {
      let c = cm[1];
      author = c.match(/class="CaptionUsername"[^>]*>([^<]+)</)?.[1]?.trim() ?? "";
      c = c.replace(/<a[^>]*class="CaptionUsername"[^>]*>[\s\S]*?<\/a>/, "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
      caption = decodeEntities(c).trim();
    }
    const im = html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/) ?? html.match(/<img[^>]+src="([^"]+)"[^>]*class="EmbeddedMediaImage"/);
    if (im) image = decodeEntities(im[1]);
    author ||= html.match(/class="UsernameText"[^>]*>([^<]+)</)?.[1]?.trim() ?? "";
  } catch { /* fall back to the post page */ }
  if (!caption) {
    try {
      const p = await safeFetch(`https://www.instagram.com/p/${code}/`, "text/html", 3_000_000);
      const html = dec(p.body);
      const d = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i)?.[1] ?? html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1] ?? "";
      const t = decodeEntities(d);
      caption = t.match(/:\s*[“"]([\s\S]*)[”"]\s*\.?$/)?.[1] ?? t;
      image ||= meta(html, "og:image");
      author ||= t.match(/-\s*([\w.]+)\s+on\s/)?.[1] ?? "";
    } catch { /* */ }
  }
  return { caption, image, author };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: ok, error: authErr } = await userClient.rpc("wb_is_member");
  if (authErr || ok !== true) return json({ error: "Sign in to the wallboard first." }, 401);

  let body: { url?: string; text?: string } = {};
  try { body = await req.json(); } catch { /* */ }

  // Text read from a photo or screenshot on the device
  if (typeof body.text === "string" && body.text.trim()) {
    const text = body.text.slice(0, 30000);
    const fr = parseFreeText(text);
    const looksLikeIngredient = (l: string) => /^\s*(\d|[½¼¾])/.test(l) || /\b(sdm|sdt|gr|gram|cup|tbsp|tsp|siung|butir)\b/i.test(l);
    const titleLine = text.split("\n").map((l) => l.replace(/[^\p{L}\p{N}\s'&,()-]/gu, "").trim())
      .find((l) => l.length >= 3 && l.length <= 70 && !/^(bahan|ingredients?|cara|steps?|method|instructions?|langkah)\b/i.test(l) && !looksLikeIngredient(l)) ?? "";
    const partial = !fr.ingredients.length || !fr.steps.length;
    return json({ title: cleanTitle(titleLine) || "Recipe from a photo", category: null, cook_time: null, serves: null,
      ingredients: fr.ingredients, steps: fr.steps, notes: fr.notes, source_url: null, source_kind: "photo", photo_path: null, partial,
      message: !fr.ingredients.length && !fr.steps.length ? "Couldn't find a recipe in that picture. Try a sharper, straight-on photo, or type it in." : partial ? "Part of the recipe wasn't readable. Check it and fill in the rest." : "Read from your picture. Check for typos, then save." });
  }

  const target = String(body.url ?? "").trim();
  if (!/^https?:\/\//i.test(target)) return json({ error: "Paste a full link that starts with https://" }, 400);
  let u: URL; try { u = new URL(target); } catch { return json({ error: "That isn't a valid link." }, 400); }
  if (blockedHost(u.hostname)) return json({ error: "That link can't be imported." }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  async function savePhoto(urls: (string | null | undefined)[], base: URL): Promise<string | null> {
    for (const raw of urls) {
      if (!raw) continue;
      try {
        const img = await safeFetch(new URL(raw, base).toString(), "image/avif,image/webp,image/jpeg,image/png,image/*", 8_000_000);
        const type = img.res.headers.get("content-type")?.split(";")[0] ?? "";
        if (!img.res.ok || !/^image\/(jpeg|png|webp|gif|avif)$/.test(type) || img.body.length < 5000) continue;
        const path = `recipes/import-${crypto.randomUUID()}.${type.split("/")[1].replace("jpeg", "jpg")}`;
        const { error } = await admin.storage.from("wallboard").upload(path, img.body, { contentType: type });
        if (!error) return path;
      } catch { /* try next */ }
    }
    return null;
  }
  async function linkedRecipe(links: string[]) {
    for (const l of links.filter((x) => !NOT_RECIPE.test(x)).slice(0, 3)) {
      try { const pg = await safeFetch(l, "text/html", 3_000_000); if (!pg.res.ok) continue; const r = parseRecipe(dec(pg.body)); if (!r.partial) return { ...r, url: pg.url.toString() }; } catch { /* */ }
    }
    return null;
  }

  const vid = ytId(u), ig = igCode(u);
  if (vid || ig) {
    const kind = vid ? "youtube" : "instagram";
    const src = vid ? await fromYouTube(vid) : await fromInstagram(ig!);
    const text = vid ? (src as Awaited<ReturnType<typeof fromYouTube>>).text : (src as Awaited<ReturnType<typeof fromInstagram>>).caption;
    const author = src.author;
    if (!text && !(vid && (src as { title: string }).title)) return json({ error: kind === "instagram" ? "Instagram didn't share this post. It may be private. You can still add the recipe by hand." : "Couldn't open that video. Check the link." }, 400);
    const fr = parseFreeText(text || "");
    let ingredients = fr.ingredients, steps = fr.steps, notes = fr.notes, via: string | null = null;
    if (ingredients.length < 2 || steps.length < 2) {
      const lr = await linkedRecipe(fr.links);
      if (lr) { if (ingredients.length < 2) ingredients = lr.ingredients; if (steps.length < 2) steps = lr.steps; via = lr.url; }
    }
    const firstLine = (text || "").split("\n").map((l) => l.trim()).find((l) => l.replace(/[\p{Extended_Pictographic}\s#@]/gu, "").length > 3) ?? "";
    const title = cleanTitle(vid ? (src as { title: string }).title : firstLine.split(/(?:bahan|ingredients?|cara)\s*[:：]/i)[0]) || (author ? `Recipe from ${author}` : "Imported recipe");
    const photo_path = await savePhoto(vid ? (src as { images: string[] }).images : [(src as { image: string | null }).image], u);
    const partial = !ingredients.length || !steps.length;
    const message = !ingredients.length && !steps.length
      ? (kind === "youtube" ? "This video's description doesn't include the recipe, so add the ingredients and steps while you watch. The video stays linked to the recipe." : "This post's caption doesn't include the recipe. The link stays saved with it.")
      : partial ? "Part of the recipe was missing from the " + (kind === "youtube" ? "description" : "caption") + ". Fill in the rest." : null;
    const credit = [author && `${kind === "youtube" ? "Video" : "Post"} by ${author}.`, via && `Full recipe from ${new URL(via).hostname.replace(/^www\./, "")}.`].filter(Boolean).join(" ");
    return json({ title, category: null, cook_time: null, serves: null, ingredients, steps, notes: [notes, credit].filter(Boolean).join(" ") || null,
      source_url: target, source_kind: kind, photo_path, partial, message });
  }

  // Ordinary recipe websites
  let page;
  try { page = await safeFetch(target, "text/html,application/xhtml+xml", 3_000_000); }
  catch (e) { return json({ error: (e as Error).message === "blocked" ? "That link can't be imported." : "Couldn't open that page. Check the link and try again." }, 400); }
  if (!page.res.ok) return json({ error: `That site answered with an error (${page.res.status}). Some sites block importing, so add it by hand.` }, 400);
  const html = dec(page.body);
  const r = parseRecipe(html);
  let { ingredients, steps } = r;
  if (r.partial) { // blog without recipe data: try reading the page text
    const text = html.replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, " ").replace(/<\/(p|li|h\d|div|br)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
    const fr = parseFreeText(decodeEntities(text).split("\n").map((l) => l.trim()).filter(Boolean).join("\n"));
    if (!ingredients.length) ingredients = fr.ingredients; if (!steps.length) steps = fr.steps;
  }
  const photo_path = await savePhoto([r.image], page.url);
  const partial = !ingredients.length || !steps.length;
  return json({ title: r.title, category: r.category, cook_time: r.cook_time, serves: r.serves, ingredients, steps, notes: r.notes,
    source_url: page.url.toString(), source_kind: "web", photo_path, partial, message: partial ? "Part of the recipe wasn't on that page. Fill in the rest." : null });
});
