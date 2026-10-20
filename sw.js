// ---------------------------------------------------------------------------
// sw.js - Service worker: la app se guarda en el movil y funciona sin
// cobertura (modo avion) y sin el Mac encendido.
//
// Los DATOS no estan aqui: viven en IndexedDB, dentro del dispositivo.
// Aqui solo se cachean los archivos de la app (HTML, CSS, JS, iconos).
// ---------------------------------------------------------------------------
// Nombre de la copia guardada en el movil. Se cambia al publicar una
// version nueva: es lo que hace que se descarten los archivos viejos.
const VERSION = 'control-horas-v1.6.0';

// Rutas absolutas calculadas desde la ubicacion del propio service worker,
// para que funcione igual en la raiz del dominio o en un subdirectorio
// (por ejemplo https://usuario.github.io/control-horas/).
const BASE = new URL('./', self.location.href);
const INDEX = new URL('index.html', BASE).href;

const RECURSOS = [
  BASE.href,
  INDEX,
  new URL('manifest.webmanifest', BASE).href,
  new URL('assets/styles.css', BASE).href,
  new URL('assets/app.js', BASE).href,
  new URL('assets/calc.js', BASE).href,
  new URL('assets/db.js', BASE).href,
  new URL('assets/seed.js', BASE).href,
  new URL('assets/icon-192.png', BASE).href,
  new URL('assets/icon-512.png', BASE).href,
  new URL('assets/icon-maskable-512.png', BASE).href,
  new URL('assets/apple-touch-icon.png', BASE).href
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSION)
      // 'reload' fuerza a ir a la red: la copia guardada nunca queda vieja.
      .then((cache) => cache.addAll(RECURSOS.map((r) => new Request(r, { cache: 'reload' }))))
      .catch(() => self.skipWaiting())
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves.filter((c) => c !== VERSION).map((c) => caches.delete(c))
      ))
      .then(() => self.clients.claim())
  );
});

// La app pide activar la version nueva en cuanto esta lista.
self.addEventListener('message', (evento) => {
  if (evento.data && evento.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (evento) => {
  const req = evento.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;

  // Red primero (para coger siempre la ultima version) y, si no hay
  // conexion, se sirve desde la copia guardada en el movil.
  evento.respondWith((async () => {
    try {
      // 'no-cache' revalida con el servidor: siempre cogemos la ultima version.
      const res = await fetch(req, { cache: 'no-cache' });
      if (res && res.status === 200 && res.type === 'basic') {
        const copia = res.clone();
        const cache = await caches.open(VERSION);
        await cache.put(req, copia);
      }
      // Un 4xx/5xx (por ejemplo, un proxy que no llega al servidor) se
      // trata como si no hubiera red.
      if (!res || res.status >= 400) throw new Error('sin red');
      return res;
    } catch {
      const cache = await caches.open(VERSION);
      // Navegaciones (p.ej. con parametros): se devuelve el index.html.
      if (req.mode === 'navigate') {
        return (await cache.match(INDEX)) || (await cache.match(BASE.href)) || Response.error();
      }
      // Resto de archivos: la copia exacta.
      const guardada = await cache.match(req, { ignoreSearch: true });
      return guardada || Response.error();
    }
  })());
});
