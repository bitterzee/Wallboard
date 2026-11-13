// Pure parsing helpers for recipe pages (schema.org Recipe in JSON-LD).

export type Imported = {
  title: string; category: string | null; cook_time: string | null; serves: string | null;
  ingredients: string[]; steps: string[]; notes: string | null; image: string | null; partial: boolean;
};

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", deg: "°", frac12: "½", frac14: "¼", frac34: "¾", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
export function clean(s: unknown): string {
  return String(s ?? "")
    .replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/\s+/g, " ").replace(/\s+([.,;:!?)])/g, "$1").trim();
}

function* walk(node: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    yield o;
    if (o["@graph"]) yield* walk(o["@graph"]);
    if (o["mainEntity"]) yield* walk(o["mainEntity"]);
  }
}
const isRecipe = (o: Record<string, unknown>) => {
  const t = o["@type"]; return Array.isArray(t) ? t.includes("Recipe") : t === "Recipe";
};

export function isoDuration(d: unknown): string | null {
  const m = String(d ?? "").match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return null;
  const mins = (+(m[1] || 0)) * 1440 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
  if (!mins) return null;
  const h = Math.floor(mins / 60), mm = mins % 60;
  return [h ? `${h} hr` : "", mm ? `${mm} min` : ""].filter(Boolean).join(" ");
}

function steps(ins: unknown): string[] {
  const out: string[] = [];
  const add = (x: unknown) => {
    if (!x) return;
    if (typeof x === "string") { clean(x).split(/(?<=\.)\s+(?=\d+\.\s)|\n+/).forEach((s) => s.trim() && out.push(s.replace(/^\d+[.)]\s*/, "").trim())); return; }
    if (Array.isArray(x)) { x.forEach(add); return; }
    if (typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (o.itemListElement) { add(o.itemListElement); return; }
      if (o.text) { out.push(clean(o.text)); return; }
      if (o.name) out.push(clean(o.name));
    }
  };
  add(ins);
  return out.filter(Boolean);
}

function first(v: unknown): unknown { return Array.isArray(v) ? v[0] : v; }
function image(v: unknown): string | null {
  const f = first(v);
  if (!f) return null;
  if (typeof f === "string") return f;
  const o = f as Record<string, unknown>;
  return (o.url || o.contentUrl || null) as string | null;
}
function yieldText(v: unknown): string | null {
  const arr = Array.isArray(v) ? v : [v];
  const num = arr.map((x) => String(x ?? "")).find((x) => /\d/.test(x));
  const m = num?.match(/\d+(?:\s*[-–]\s*\d+)?/);
  return m ? m[0].replace(/\s/g, "") : null;
}
function meta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  const c = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return c ? clean(c) : null;
}

export function parseRecipe(html: string): Imported {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const b of blocks) {
    let data: unknown;
    try { data = JSON.parse(b.trim()); } catch { try { data = JSON.parse(b.trim().replace(/[\u0000-\u001f]+/g, " ")); } catch { continue; } }
    for (const o of walk(data)) {
      if (!isRecipe(o)) continue;
      const ing = (Array.isArray(o.recipeIngredient) ? o.recipeIngredient : Array.isArray(o.ingredients) ? o.ingredients : [])
        .map(clean).filter(Boolean) as string[];
      const cat = first(o.recipeCategory);
      return {
        title: clean(o.name) || meta(html, "og:title") || "Imported recipe",
        category: cat ? clean(cat) : null,
        cook_time: isoDuration(o.totalTime) || isoDuration(o.cookTime) || null,
        serves: yieldText(o.recipeYield),
        ingredients: ing,
        steps: steps(o.recipeInstructions),
        notes: o.description ? clean(o.description).slice(0, 400) : null,
        image: image(o.image) || meta(html, "og:image"),
        partial: !ing.length || !steps(o.recipeInstructions).length,
      };
    }
  }
  const t = meta(html, "og:title") || clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) || "Imported recipe";
  return { title: t, category: null, cook_time: null, serves: null, ingredients: [], steps: [], notes: meta(html, "og:description"), image: meta(html, "og:image"), partial: true };
}
