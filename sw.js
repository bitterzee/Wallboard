// Wallboard service worker: keeps a copy of the app itself so the wall still opens when the internet is down.
// Network first (so updates arrive straight away), cached copy only as a fallback. Household data is never cached here.
const CACHE = "wallboard-shell-v1";
const SHELL = ["./", "./index.html", "./vendor/supabase-js-2.119.0.js", "./manifest.json", "./icon.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // Supabase, weather, fonts: straight to the network
  if (url.searchParams.has("check")) return;                // the wall's own update check
  e.respondWith((async () => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(req, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(url.pathname.endsWith("/") ? "./" : req, copy)).catch(() => {}); }
      return res;
    } catch (err) {
      clearTimeout(t);
      const hit = await caches.match(req, { ignoreSearch: true }) || (req.mode === "navigate" ? await caches.match("./") || await caches.match("./index.html") : null);
      if (hit) return hit;
      throw err;
    }
  })());
});
