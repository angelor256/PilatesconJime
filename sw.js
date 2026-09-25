// sw.js — Pilates con Jime
//
// Su único trabajo es evitar que la app instalada en el celular se quede
// pegada a una versión vieja: cuando se abre una página (index.html,
// app.html, panel.html) siempre intenta traerla de la red primero, y solo
// usa una copia guardada si no hay conexión. No toca fuentes, imágenes ni
// las llamadas a Supabase: esas pasan de largo, sin cachear.
//
// Si alguna vez algo queda "pegado" y querés forzar que todos los
// celulares limpien su copia guardada, alcanza con subir este número.
const CACHE_NAME = 'pcj-shell-v1';
 
self.addEventListener('install', () => {
  // Activa esta versión del service worker apenas termina de instalarse,
  // sin esperar a que se cierren todas las pestañas/ventanas abiertas.
  self.skipWaiting();
});
 
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    );
    // Toma control de las páginas ya abiertas sin necesidad de recargarlas.
    await self.clients.claim();
  })());
});
 
self.addEventListener('fetch', (event) => {
  const req = event.request;
 
  // Solo intervenimos en navegaciones (cuando se abre o refresca una
  // página completa). Todo lo demás sigue su camino normal.
  if (req.mode !== 'navigate') return;
 
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      // Sin conexión: mostramos la última versión que se haya guardado.
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      return cached || Response.error();
    }
  })());
});
 
