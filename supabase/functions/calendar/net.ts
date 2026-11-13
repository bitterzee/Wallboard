// net.ts: only let the server fetch public internet addresses (no localhost, private networks or cloud metadata).
// Checks the hostname and, where possible, what it resolves to, so tricks like 127.0.0.1.nip.io are refused too.
function v4Private(ip: string): boolean {
  const p = ip.split(".").map(Number); if (p.length !== 4 || p.some((n) => !(n >= 0 && n <= 255))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
function v6Private(ip: string): boolean {
  const h = ip.toLowerCase();
  if (h === "::" || h === "::1") return true;
  const m = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return v4Private(m[1]);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(h)) return true; // mapped v4 in hex form
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(h) || h.startsWith("64:ff9b:") || h.startsWith("2001:db8");
}
export function blockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h.endsWith(".home.arpa")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return v4Private(h);
  if (h.includes(":")) return v6Private(h);
  if (/^[\d.]+$/.test(h) || /^0x/i.test(h)) return true; // odd numeric forms
  return false;
}
export async function assertPublic(url: URL): Promise<void> {
  if (!/^https?:$/.test(url.protocol) || (url.port && !["80", "443", "8080", "8443"].includes(url.port)) || url.username || url.password) throw new Error("blocked");
  if (blockedHost(url.hostname)) throw new Error("blocked");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(host) || host.includes(":")) return;
  for (const t of ["A", "AAAA"] as const) {
    let ips: string[] = [];
    try { ips = await Deno.resolveDns(host, t); } catch (e) { if ((e as Error).name === "NotSupported" || e instanceof TypeError) return; continue; }
    if (ips.some((ip) => (t === "A" ? v4Private(ip) : v6Private(ip)))) throw new Error("blocked");
  }
}
