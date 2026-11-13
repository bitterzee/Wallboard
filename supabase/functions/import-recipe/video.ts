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

async function tracksViaApp(id: string): Promise<Track[]> {
  // The watch page sometimes hides captions from servers; the mobile app's API usually lists them.
  try {
    const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": ANDROID_UA, "X-YouTube-Client-Name": "3", "X-YouTube-Client-Version": "20.10.38" },
      body: JSON.stringify({ videoId: id, context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, hl: "en", gl: "ID" } } }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return [];
    return tracksFrom(await r.json());
  } catch { return []; }
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
      if (!r.ok) continue;
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
  for (const list of [pageTracks, await tracksViaApp(id)]) {
    const t = pick(list); if (!t) continue;
    const text = await download(t);
    if (text.length > 80) return { text: text.slice(0, 60000), lang: t.languageCode, auto: t.kind === "asr" };
  }
  return null;
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

export async function recipeFromVideo(key: string, v: { title: string; author: string; description: string; transcript: string; lang: string }) {
  const model = Deno.env.get("IMPORT_MODEL") || "claude-sonnet-5-5";
  const prompt =
    `Here is a cooking video's title, description and transcript (the transcript may be auto-generated, so expect mis-heard words).\n` +
    `Write the recipe that is cooked in it. Use English, but keep common Indonesian ingredient and dish names (with the English in brackets the first time if helpful). ` +
    `Only include what the video supports; don't add ingredients that aren't mentioned. Fix obvious mis-hearings (for example 'garlic' heard as 'gar lick').\n\n` +
    `Title: ${v.title}\nChannel: ${v.author}\nTranscript language: ${v.lang}\n\nDescription:\n${v.description.slice(0, 4000) || "(none)"}\n\nTranscript:\n${v.transcript}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 3000, tools: [TOOL], tool_choice: { type: "tool", name: "report_recipe" }, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(90000),
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
