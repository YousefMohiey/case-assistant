/* عامل الخدمة: تثبيت الموقع كتطبيق + عمل أساسي دون اتصال (الشبكة أولًا) */
const CACHE = "qa-shell-v7";
const SHELL = ["./", "./index.html", "./app.css?v=6", "./app.js?v=6", "./docx.js?v=6", "./pdfgen.js?v=6", "./manifest.json", "./version.json", "./favicon.svg", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png", "./vendor/pdf.min.mjs"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" }).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
  );
});
