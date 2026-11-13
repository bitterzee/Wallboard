// Reading a recipe out of a YouTube video when the description doesn't have it.
// 1. Get the video's captions (made by the uploader, or YouTube's automatic ones).
// 2. Ask Claude to write the recipe from what's said, plus the title and description.

type Track = { baseUrl: string; languageCode: string; kind?: string; name?: { simpleText?: string } };

const ANDROID_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip";

export function tracksFrom(player: unknown): Track[] {
  // deno-lint-ignore no-explicit-any
  const t = (player as any)?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(t) ? t.filter((x: Track) => typeof x?.baseUrl === "string") : [];
}

// deno-lint-ignore no-explicit-any
let appPlayer: any = null;
async function tracksViaApp(id: string): Promise<Track[]> {
  // The watch page sometimes hides captions from servers; the mobile app's API usually lists them.
  try {
    const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": ANDROID_UA, "X-YouTube-Client-Name": "3", "X-YouTube-Client-Version": "20.10.38" },
      body: JSON.stringify({ videoId: id, context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, hl: "en", gl: "ID" } } }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) { console.log("yt app player", r.status); return []; }
    appPlayer = await r.json();
    console.log("yt app player ok, tracks:", tracksFrom(appPlayer).length, "status:", appPlayer?.playabilityStatus?.status);
    return tracksFrom(appPlayer);
  } catch (e) { console.log("yt app player failed", String(e)); return []; }
}

function pick(tracks: Track[]): Track | null {
  const score = (t: Track) => (t.kind === "asr" ? 0 : 10) + (/^(en|id|ms)/.test(t.languageCode) ? 5 : 0);
  return [...tracks].sort((a, b) => score(b) - score(a))[0] ?? null;
}

const decodeXml = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

async function download(t: Track): Promise<string> {
  const u = new URL(t.baseUrl);
  if (!/(^|\.)youtube\.com$/.test(u.hostname)) return "";
  // json3 first, then the default XML
  for (const fmt of ["json3", ""]) {
    try {
      if (fmt) u.searchParams.set("fmt", fmt); else u.searchParams.delete("fmt");
      const r = await fetch(u, { headers: { "User-Agent": ANDROID_UA }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) { console.log("captions", fmt || "xml", r.status); continue; }
      const body = await r.text(); if (!body.trim()) continue;
      if (fmt === "json3") {
        const j = JSON.parse(body);
        // deno-lint-ignore no-explicit-any
        const txt = (j.events ?? []).map((e: any) => (e.segs ?? []).map((s: any) => s.utf8 ?? "").join("")).join(" ");
        if (txt.trim()) return txt.replace(/\s+/g, " ").trim();
      } else {
        const parts = [...body.matchAll(/<(?:text|p)[^>]*>([\s\S]*?)<\/(?:text|p)>/g)].map((m) => decodeXml(m[1].replace(/<[^>]+>/g, "")));
        if (parts.length) return parts.join(" ").replace(/\s+/g, " ").trim();
      }
    } catch { /* try the next format */ }
  }
  return "";
}

export async function transcript(id: string, pageTracks: Track[]): Promise<{ text: string; lang: string; auto: boolean } | null> {
  console.log("caption tracks on page:", pageTracks.length);
  for (const list of [pageTracks, await tracksViaApp(id)]) {
    const t = pick(list); if (!t) continue;
    const text = await download(t);
    if (text.length > 80) return { text: text.slice(0, 60000), lang: t.languageCode, auto: t.kind === "asr" };
  }
  return null;
}

// ---- Pictures from the video: YouTube's storyboard sheets (grids of frames across the whole video) plus its auto thumbnails.
// deno-lint-ignore no-explicit-any
export function storyboardSpec(player: any): string | null { return player?.storyboards?.playerStoryboardSpecRenderer?.spec ?? null; }
function sheetUrls(spec: string, want = 3): string[] {
  const parts = spec.split("|"); const base = parts[0]; const levels = parts.slice(1);
  if (!levels.length) return [];
  const li = levels.length - 1; const f = levels[li].split("#"); // width#height#count#cols#rows#interval#name#sigh
  const count = +f[2], per = (+f[3]) * (+f[4]), name = f[6], sigh = f[7];
  if (!count || !per || !name) return [];
  const sheets = Math.ceil(count / per), pick = [...new Set(Array.from({ length: Math.min(want, sheets) }, (_, i) => Math.round(i * (sheets - 1) / Math.max(1, Math.min(want, sheets) - 1))))];
  return pick.map((n) => base.replace("$L", String(li)).replace("$N", name.replace("$M", String(n))) + (sigh ? (base.includes("?") ? "&" : "?") + "sigh=" + sigh : ""));
}
async function img64(url: string): Promise<{ data: string; type: string } | null> {
  try {
    const u = new URL(url); if (!/(^|\.)ytimg\.com$/.test(u.hostname)) return null;
    const r = await fetch(u, { signal: AbortSignal.timeout(10000) }); if (!r.ok) return null;
    const type = (r.headers.get("content-type") ?? "image/jpeg").split(";")[0]; if (!/^image\/(jpeg|png|webp)$/.test(type)) return null;
    const b = new Uint8Array(await r.arrayBuffer()); if (b.length < 2500 || b.length > 4_000_000) return null;
    let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return { data: btoa(s), type };
  } catch { return null; }
}
export async function videoFrames(id: string, pageSpec: string | null) {
  const spec = pageSpec ?? storyboardSpec(appPlayer);
  const urls = [...(spec ? sheetUrls(spec, 4) : []), `https://i.ytimg.com/vi/${id}/hq1.jpg`, `https://i.ytimg.com/vi/${id}/hq2.jpg`, `https://i.ytimg.com/vi/${id}/hq3.jpg`, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`];
  const got = (await Promise.all(urls.map(img64))).filter(Boolean) as { data: string; type: string }[];
  console.log("frames: storyboard", spec ? "yes" : "no", "images", got.length);
  return { images: got.slice(0, 8), storyboard: !!spec };
}

const TOOL = {
  name: "report_recipe",
  description: "Report the recipe cooked in the video.",
  input_schema: {
    type: "object",
    properties: {
      found: { type: "boolean", description: "False if the video doesn't actually show how to cook a dish." },
      title: { type: "string", description: "Short dish name, e.g. 'Ayam Bakar Madu'. No channel names, emojis or clickbait." },
      ingredients: { type: "array", items: { type: "string" }, description: "One ingredient per line with amount first when known, e.g. '2 tbsp kecap manis' or '5 bawang merah (shallots)'. If an amount isn't said, write the ingredient alone. Never invent precise amounts." },
      steps: { type: "array", items: { type: "string" }, description: "Clear numbered-style cooking steps in order, one per item, without numbers. Include times and heat levels that are said." },
      serves: { type: "string", description: "e.g. '4', or empty if not said." },
      cook_time: { type: "string", description: "Total time like '45 min', or empty if not said." },
      category: { type: "string", enum: ["Breakfast", "Dinner", "Soup", "Snack", "Dessert", "Drink", "Kids", "Side", ""] },
      tips: { type: "string", description: "One or two short tips from the video, or empty." },
    },
    required: ["found", "title", "ingredients", "steps", "serves", "cook_time", "category", "tips"],
  },
};

export async function recipeFromVideo(key: string, v: { title: string; author: string; description: string; transcript: string; lang: string; images?: { data: string; type: string }[]; photos?: boolean }) {
  const model = Deno.env.get("IMPORT_MODEL") || "claude-sonnet-5-5";
  const pics = v.images ?? [];
  const prompt = v.photos ?
    `These pictures show one recipe: a cookbook page, a handwritten card, a website screenshot, or screenshots of a cooking video with the recipe written on screen. ` +
    `Read all the text in them, in order, and write out the recipe. Use English, but keep common Indonesian ingredient and dish names (with the English in brackets the first time if helpful). ` +
    `Keep the amounts exactly as written. Combine information that is spread across several pictures. If the pictures don't contain a recipe, set found to false. Answer only by calling report_recipe.` :
    (pics.length ? `The images are frames from the video in time order: the first ones are grids of small frames across the whole video (read them left to right, top to bottom), the last are single frames. Read on-screen text such as ingredient names and amounts, and watch what is added at each step.\n` : "") +
    `Here is a cooking video's title, description` + (v.transcript ? ` and transcript (the transcript may be auto-generated, so expect mis-heard words)` : ` (it has no speech)`) + `.\n` +
    `Write the recipe that is cooked in it. Use English, but keep common Indonesian ingredient and dish names (with the English in brackets the first time if helpful). ` +
    `Only include what the video supports; don't add ingredients that aren't mentioned. Fix obvious mis-hearings (for example 'garlic' heard as 'gar lick').\n\n` +
    `Only give amounts that are said or shown; otherwise list the ingredient without an amount. If you can't tell what is cooked or how, set found to false. Answer only by calling report_recipe.\n\n` +
    `Title: ${v.title}\nChannel: ${v.author}\n${v.transcript ? `Transcript language: ${v.lang}\n` : ""}\nDescription:\n${v.description.slice(0, 4000) || "(none)"}\n\n${v.transcript ? `Transcript:\n${v.transcript}` : "(no transcript)"}`;
  const content = [...pics.map((p) => ({ type: "image", source: { type: "base64", media_type: p.type, data: p.data } })), { type: "text", text: prompt }];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 8000, tools: [TOOL], tool_choice: { type: "auto" }, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(110000),
  });
  if (!r.ok) {
    const t = await r.text(); console.error("anthropic", r.status, t.slice(0, 400));
    if (r.status === 401) throw new Error("The Anthropic API key isn't valid. Check the ANTHROPIC_API_KEY secret.");
    if (/credit|billing/i.test(t)) throw new Error("The Anthropic account is out of credit.");
    throw new Error("Claude couldn't read the video right now. Try again in a minute.");
  }
  const out = await r.json();
  // deno-lint-ignore no-explicit-any
  const use = (out.content ?? []).find((c: any) => c.type === "tool_use")?.input;
  if (!use) return null;
  const clean = (a: unknown) => (Array.isArray(a) ? a.map((x) => String(x).trim()).filter(Boolean).slice(0, 60) : []);
  return {
    found: !!use.found,
    title: String(use.title ?? "").slice(0, 100),
    ingredients: clean(use.ingredients),
    steps: clean(use.steps),
    serves: String(use.serves ?? "").slice(0, 20) || null,
    cook_time: String(use.cook_time ?? "").slice(0, 30) || null,
    category: String(use.category ?? "") || null,
    tips: String(use.tips ?? "").slice(0, 400),
  };
}
