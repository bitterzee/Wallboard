// Pulls ingredients and steps out of free text: YouTube descriptions, Instagram captions.
// Works with English and Indonesian ("Bahan", "Cara membuat", "sdm", "siung"…).

export type FreeRecipe = { ingredients: string[]; steps: string[]; notes: string | null; links: string[] };

const ING_H = /^(ingredients?|ingredient list|bahan(?:[\s-]*bahan)?(?:\s+(?:utama|lainnya|pelengkap|isian|kuah|saus|sambal|adonan|marinasi))?|bumbu(?:\s+(?:halus|iris|lainnya|marinasi|cemplung))?|bumbu yang dihaluskan|what you(?:'ll)? need|you(?:'ll)? need|shopping list|for the [a-z ]{2,30}|untuk [a-z ]{2,30}|pelengkap|topping|garnish|sauce|marinade)\b/i;
const STEP_H = /^(steps?|method|directions?|instructions?|preparation|how to (?:make|cook)(?: it)?|cara (?:membuat|memasak|masak|buat|bikin|pembuatan)|langkah(?:[\s-]*langkah)?(?: membuat| memasak)?|cara)\b/i;
const NOTE_H = /^(notes?|tips?|catatan|tip|chef'?s? notes?)\b/i;
const STOP_H = /^(follow|subscribe|music|song|lagu|camera|kamera|equipment|alat(?:[\s-]*alat)?|tools|business|contact|kontak|email|sponsor|affiliate|disclaimer|chapters?|timestamps?|social|find me|connect|shop|merch|support|instagram|tiktok|facebook|website|blog|cookbook|order|pre-?order|kerjasama|endorse)\b/i;

const UNIT = "kg|g|gr|grm|gram|grams|mg|l|ltr|liter|litre|liters|ml|cc|tbsp|tbs|tsp|tablespoons?|teaspoons?|sdm|sdt|sdk|cups?|gelas|mangkuk|cm|cloves?|siung|buah|bh|butir|btr|lembar|lbr|batang|btg|ruas|ikat|bungkus|bks|sachets?|pcs?|pieces?|slices?|iris|cans?|tins?|packs?|pinch(?:es)?|sejumput|handfuls?|genggam|sprigs?|knobs?|stalks?|bunch(?:es)?|ons?|oz|lb|lbs";
const QTY_START = new RegExp(`^(?:\\d+(?:[.,/]\\d+)?|[½¼¾⅓⅔⅛]|\\d+\\s*[½¼¾])\\s*(?:-\\s*\\d+\\s*)?(?:(?:${UNIT})\\b)?`, "i");
const AMOUNT_ANY = new RegExp(`(\\b\\d+(?:[.,/]\\d+)?\\s*(?:${UNIT})\\b|secukupnya|sejumput|to taste|as needed|optional|\\bsdm\\b|\\bsdt\\b)`, "i");
const STAMP = /^\(?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\)?\s*[-–—:|]?\s*(.*)$/;
const URL_RE = /https?:\/\/[^\s)>\]]+/g;

function stripDeco(l: string): string {
  return l
    .replace(/^[\s\p{Extended_Pictographic}‍️•●○◦▪▫◾◽■□►▶➤➡→⇒✓✔☑✅*·\-–—~>|]+/u, "")
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " ")
    .replace(URL_RE, "")
    .replace(/[\p{Extended_Pictographic}‍️]+\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}
const headerText = (l: string) => stripDeco(l).replace(/[:：\-–—.]+\s*$/, "").replace(/[*_]/g, "").trim();
const isHeaderLike = (l: string) => { const h = headerText(l); return h.length > 0 && h.length < 42 && !/\d{2,}/.test(h) && (/[:：]\s*$/.test(stripDeco(l)) || /^[A-Z\s&']+$/.test(h) || h.split(" ").length <= 4); };
const stepNum = /^(?:step\s*|langkah\s*)?(\d{1,2})\s*[.):\-–]\s*/i;

export function parseFreeText(raw: string): FreeRecipe {
  const links = [...new Set((raw.match(URL_RE) ?? []).map((u) => u.replace(/[.,;]+$/, "")))];
  // Some captions put "1. … 2. …" on one line: split those.
  const lines = raw.replace(/\r/g, "")
    // put inline headers ("… Bahan: 6 pisang, … Cara: 1. …") on their own line
    .replace(/\s(?=(?:bahan(?:[\s-]*bahan)?|bumbu(?: halus)?|ingredients?|cara(?: membuat| memasak| masak| buat)?|langkah(?:[\s-]*langkah)?|steps?|method|directions?|instructions?)\s*[:：])/gi, "\n")
    .split("\n")
    .flatMap((l) => (/\s\d{1,2}\.\s+\S/.test(l) && (l.match(/\s\d{1,2}\.\s/g) ?? []).length >= 2 ? l.split(/\s(?=\d{1,2}\.\s)/) : [l]))
    .map((l) => l.trim());

  const ing: string[] = [], steps: string[] = [], notes: string[] = [], chapters: string[] = [];
  const candIng: string[] = [], candSteps: string[] = [];
  let section: "none" | "ing" | "step" | "note" | "stop" = "none";
  let sawHeader = false;

  for (const rawLine of lines) {
    if (!rawLine) continue;
    const st = rawLine.match(STAMP);
    if (st && st[2] && !/^\d/.test(st[2])) { chapters.push(stripDeco(st[2])); continue; }
    const h = headerText(rawLine);
    const afterColon = stripDeco(rawLine).split(/[:：]/).slice(1).join(":").trim();

    if (isHeaderLike(rawLine) || (afterColon && h.split(/[:：]/)[0].length < 30)) {
      const head = h.split(/[:：]/)[0].trim();
      if (STEP_H.test(head)) { section = "step"; sawHeader = true; if (afterColon) steps.push(afterColon); continue; }
      if (ING_H.test(head)) {
        section = "ing"; sawHeader = true;
        if (afterColon) afterColon.split(/[,;]\s*/).map((x) => x.trim().replace(/[.。]+$/, "")).filter(Boolean).forEach((x) => ing.push(x));
        continue;
      }
      if (NOTE_H.test(head)) { section = "note"; if (afterColon) notes.push(afterColon); continue; }
      if (STOP_H.test(head)) { section = "stop"; continue; }
      if (section === "ing" && /[:：]\s*$/.test(stripDeco(rawLine)) && !QTY_START.test(stripDeco(rawLine))) continue; // sub-heading like "Bumbu halus:"
    }

    const line = stripDeco(rawLine);
    if (!line || line.length < 2) continue;

    if (section === "ing") {
      // a long numbered sentence means the steps started without a header
      if (stepNum.test(line) && line.length > 45 && !QTY_START.test(line.replace(stepNum, ""))) { section = "step"; steps.push(line.replace(stepNum, "")); continue; }
      if (line.length <= 120) ing.push(line);
      continue;
    }
    if (section === "step") { const s = line.replace(stepNum, "").trim(); if (s.length > 2) steps.push(s); continue; }
    if (section === "note") { notes.push(line); continue; }
    if (section === "stop") continue;

    // No header yet: collect likely lines.
    if ((QTY_START.test(line) || AMOUNT_ANY.test(line)) && line.length <= 80 && !stepNum.test(rawLine.trim())) candIng.push(line);
    else if (stepNum.test(line) && line.length > 20) candSteps.push(line.replace(stepNum, ""));
  }

  let I = ing, S = steps;
  if (!sawHeader || (!I.length && !S.length)) { if (candIng.length >= 3) I = candIng; if (candSteps.length >= 2) S = candSteps; }
  if (!S.length && chapters.length >= 3) S = chapters.filter((c) => c && !/^(intro|outro|ending|end|opening|pembukaan|penutup|taste test|mukbang)\b/i.test(c));
  const dedupe = (a: string[]) => [...new Set(a.map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length > 1))];
  return { ingredients: dedupe(I).slice(0, 60), steps: dedupe(S).slice(0, 40), notes: notes.length ? notes.join(" ").slice(0, 500) : null, links };
}

export function cleanTitle(t: string): string {
  return t.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " ").replace(/\s*[|｜]\s*[^|｜]{0,60}$/u, "").replace(/\s*[-–—]\s*(?:resep|recipe)\s*$/i, "").replace(/\s+/g, " ").trim().slice(0, 90);
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
export function decodeEntities(s: string): string {
  return s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}
