// Minimal iCalendar (.ics) parser with recurrence expansion for a short window.
// Supports: DTSTART/DTEND/DURATION (UTC, TZID, floating, all-day), RRULE
// (DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, COUNT, UNTIL, BYDAY for weekly),
// EXDATE, RECURRENCE-ID overrides and cancelled events.

export type Ev = { title: string; start: string; end: string; allDay: boolean; location?: string };

type DT = { y: number; m: number; d: number; h: number; mi: number; s: number; tz: string | null; utc: boolean; date: boolean };

function tzOffsetMs(ts: number, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ts))) p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ts;
}
function validTz(tz: string | null): boolean {
  if (!tz) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
export function toUtc(dt: DT, fallbackTz: string): number {
  const guess = Date.UTC(dt.y, dt.m - 1, dt.d, dt.h, dt.mi, dt.s);
  if (dt.utc) return guess;
  const tz = validTz(dt.tz) ? dt.tz! : fallbackTz;
  let ts = guess - tzOffsetMs(guess, tz);
  const o2 = tzOffsetMs(ts, tz);
  if (guess - o2 !== ts) ts = guess - o2;
  return ts;
}
function parseDT(value: string, params: string): DT | null {
  const tz = params.match(/TZID=("?)([^;:"]+)\1/i)?.[2] ?? null;
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const date = !m[4] || /VALUE=DATE(?!-)/i.test(params);
  return { y: +m[1], m: +m[2], d: +m[3], h: date ? 0 : +m[4], mi: date ? 0 : +m[5], s: date ? 0 : +(m[6] || 0), tz, utc: !!m[7], date };
}
function addDays(dt: DT, n: number): DT { const x = new Date(Date.UTC(dt.y, dt.m - 1, dt.d + n)); return { ...dt, y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }; }
function addMonths(dt: DT, n: number): DT | null {
  const x = new Date(Date.UTC(dt.y, dt.m - 1 + n, 1)); const y = x.getUTCFullYear(), m = x.getUTCMonth() + 1;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate(); if (dt.d > dim) return null; return { ...dt, y, m };
}
const ymd = (dt: DT) => `${dt.y}-${String(dt.m).padStart(2, "0")}-${String(dt.d).padStart(2, "0")}`;
function durMs(v: string): number {
  const m = v.match(/^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/); if (!m) return 0;
  return (m[1] ? -1 : 1) * ((+(m[2] || 0)) * 7 * 864e5 + (+(m[3] || 0)) * 864e5 + (+(m[4] || 0)) * 36e5 + (+(m[5] || 0)) * 6e4 + (+(m[6] || 0)) * 1e3);
}
const unesc = (s: string) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
const WD: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export function expand(ics: string, fromMs: number, toMs: number, fallbackTz: string): Ev[] {
  const text = ics.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const blocks = text.split("BEGIN:VEVENT").slice(1).map((b) => b.split("END:VEVENT")[0]);
  type Raw = { uid: string; props: Record<string, { v: string; p: string }[]> };
  const raws: Raw[] = blocks.map((b) => {
    const props: Raw["props"] = {};
    for (const line of b.split("\n")) {
      const i = line.indexOf(":"); if (i < 1) continue;
      const head = line.slice(0, i), v = line.slice(i + 1); const [name, ...ps] = head.split(";");
      (props[name.toUpperCase()] ||= []).push({ v, p: ps.join(";") });
    }
    return { uid: props.UID?.[0]?.v ?? Math.random().toString(36), props };
  });
  const overridden = new Map<string, Set<number>>();
  for (const r of raws) if (r.props["RECURRENCE-ID"]) {
    const d = parseDT(r.props["RECURRENCE-ID"][0].v, r.props["RECURRENCE-ID"][0].p); if (!d) continue;
    (overridden.get(r.uid) ?? overridden.set(r.uid, new Set()).get(r.uid)!).add(d.date ? Date.UTC(d.y, d.m - 1, d.d) : toUtc(d, fallbackTz));
  }
  const out: Ev[] = [];
  for (const r of raws) {
    const P = r.props;
    if (/CANCELLED/i.test(P.STATUS?.[0]?.v ?? "")) continue;
    const st = P.DTSTART && parseDT(P.DTSTART[0].v, P.DTSTART[0].p); if (!st) continue;
    const title = unesc(P.SUMMARY?.[0]?.v ?? "(No title)");
    const location = P.LOCATION?.[0]?.v ? unesc(P.LOCATION[0].v) : undefined;
    const startKey = (dt: DT) => dt.date ? Date.UTC(dt.y, dt.m - 1, dt.d) : toUtc(dt, fallbackTz);
    const en = P.DTEND && parseDT(P.DTEND[0].v, P.DTEND[0].p);
    const length = en ? startKey(en) - startKey(st) : P.DURATION ? durMs(P.DURATION[0].v) : (st.date ? 864e5 : 0);
    const ex = new Set<number>();
    for (const e of P.EXDATE ?? []) for (const v of e.v.split(",")) { const d = parseDT(v, e.p); if (d) ex.add(startKey({ ...d, tz: d.tz ?? st.tz })); }
    const skip = P["RECURRENCE-ID"] ? new Set<number>() : (overridden.get(r.uid) ?? new Set<number>());
    const push = (dt: DT) => {
      const k = startKey(dt); if (ex.has(k) || skip.has(k)) return;
      if (dt.date) {
        const endDt = addDays(dt, Math.max(1, Math.round(length / 864e5)));
        // all-day: window check in the display time zone
        const s = toUtc({ ...dt, tz: fallbackTz, utc: false }, fallbackTz), e = toUtc({ ...endDt, tz: fallbackTz, utc: false }, fallbackTz);
        if (e > fromMs && s < toMs) out.push({ title, start: ymd(dt), end: ymd(endDt), allDay: true, location });
      } else {
        const s = k, e = k + Math.max(length, 0);
        if ((e > fromMs || s >= fromMs) && s < toMs) out.push({ title, start: new Date(s).toISOString(), end: new Date(e).toISOString(), allDay: false, location });
      }
    };
    const rr = P.RRULE?.[0]?.v;
    if (!rr || P["RECURRENCE-ID"]) { push(st); continue; }
    const R: Record<string, string> = Object.fromEntries(rr.split(";").map((kv) => kv.split("=") as [string, string]));
    const freq = R.FREQ, interval = Math.max(1, +(R.INTERVAL || 1)), count = R.COUNT ? +R.COUNT : Infinity;
    const untilDt = R.UNTIL ? parseDT(R.UNTIL, R.UNTIL.endsWith("Z") ? "" : (st.tz ? `TZID=${st.tz}` : "")) : null;
    const until = untilDt ? (untilDt.date ? Date.UTC(untilDt.y, untilDt.m - 1, untilDt.d, 23, 59, 59) : toUtc(untilDt, fallbackTz)) : Infinity;
    let n = 0;
    const emit = (dt: DT) => { const k = startKey(dt); if (k > until || n >= count) return false; n++; push(dt); return k < toMs; };
    if (freq === "WEEKLY") {
      const days = (R.BYDAY ? R.BYDAY.split(",").map((x) => WD[x.slice(-2)]) : [new Date(Date.UTC(st.y, st.m - 1, st.d)).getUTCDay()]).sort((a, b) => a - b);
      const wd0 = new Date(Date.UTC(st.y, st.m - 1, st.d)).getUTCDay();
      for (let w = 0; w < 2000; w++) {
        let go = true;
        for (const wd of days) {
          const dt = addDays(st, w * 7 * interval + (wd - wd0));
          if (startKey(dt) < startKey(st)) continue;
          if (!emit(dt)) { go = false; break; }
        }
        if (!go) break;
      }
    } else {
      for (let i = 0; i < 5000; i++) {
        const dt = freq === "DAILY" ? addDays(st, i * interval) : freq === "MONTHLY" ? addMonths(st, i * interval) : freq === "YEARLY" ? addMonths(st, i * 12 * interval) : (i === 0 ? st : null);
        if (!dt) { if (freq === "MONTHLY" || freq === "YEARLY") continue; break; }
        if (!emit(dt)) break;
      }
    }
  }
  return out.sort((a, b) => (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || a.start.localeCompare(b.start));
}
