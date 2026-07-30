/**
 * The service worker template.
 *
 * This file is not served as it stands: `scripts/gen-sw.mjs` replaces the two
 * markers below with the version and the real list of files the build produced,
 * hashes included, and writes the result to `dist/sw.js`. Writing that list by
 * hand would guarantee it lies at the first rename. (The markers are named
 * nowhere in this prose: the replacement targets the first occurrence, and a
 * mention in a comment would steal it.)
 *
 * Three rules, none of them decorative.
 *
 * 1. Nothing that is not same-origin. The first line of the `fetch` handler
 *    bows out for anything from elsewhere. Two reasons, either of which would
 *    suffice: the security policy served with this file limits `connect-src` to
 *    'self', so a pass-through `fetch(request)` on a tile would be refused and
 *    would break the map; and above all a cached tile would write to disk a
 *    durable trace of the places consulted, which the site promises not to do.
 *    A promise the cache contradicts is no longer a promise.
 *
 * 2. No unconditional `skipWaiting()`. Somebody may have forty photos loaded
 *    and nothing exported: nothing is persisted, so a forced reload destroys
 *    their work. The new worker waits, and only takes over on an explicit
 *    message from the page, that is, after the user has said yes.
 *
 * 3. No offline page. Every real page is precached, the tool in both languages
 *    and the guides: no navigation is left for a fallback to catch. The
 *    application itself beats its own death notice.
 *
 *    This rule is what forces `gen-sw.mjs`'s inventory to be derived. A page
 *    forgotten from the list would cause nothing visible: the fallback below
 *    would serve the home page in the right language, and a guide address would
 *    quietly answer with something other than the guide. A failure disguised as
 *    a valid page is the only kind that never announces itself.
 *
 * Emergency stop. To withdraw the service worker from the field, replace the
 * contents of `dist/sw.js` with:
 *
 *     self.addEventListener('install', () => self.skipWaiting());
 *     self.addEventListener('activate', async () => {
 *       await self.registration.unregister();
 *       for (const c of await caches.keys()) await caches.delete(c);
 *     });
 *
 * The old worker looks for `sw.js` on every navigation: the disarming spreads
 * on its own, with nobody having to clear anything.
 */

const VERSION = '__VERSION__';
const CACHE = `geotager-${VERSION}`;

/** The shell: every page, the stylesheet, the island, the reading worker. */
const PRECACHE = __PRECACHE__;

/*
 * The share targets declared by the manifests, spelled out rather than hidden
 * in a regular expression.
 *
 * `/partager` exists in no file: it has existence only in this handler. If the
 * worker stopped recognising the path, sharing would fall to a 404 while the
 * manifest went on promising it to the system, and the build check could not
 * see it, for want of being able to interrogate a regular expression. This list
 * it can read.
 */
const PARTAGE = ["/partager", "/fr/partager"];

/*
 * The map code is not precached. It is loaded on demand, and that is the
 * site's whole bargain: while nobody opens the map, not a byte of what talks to
 * tiles is requested. Precaching it would mean downloading it for everybody and
 * undoing that guarantee sideways.
 *
 * It is however kept after use, by the runtime rule below: whoever has opened
 * the map once finds it offline, empty of tiles, which the application already
 * knows how to say.
 */

self.addEventListener('install', (event) => {
  // `addAll` is atomic: one missing file and nothing is installed. That is the
  // property we want. A half-filled cache can show the page without being able
  // to read a photo, which is worse than no cache at all.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const nom of await caches.keys()) {
        if (nom.startsWith('geotager-') && nom !== CACHE) await caches.delete(nom);
      }
      await self.clients.claim();
    })(),
  );
});

// Incoming share

/*
 * A photo shared from the system arrives here as a `POST`, because that is the
 * only form the Share Target API accepts for files. There is no server to
 * receive it: this worker intercepts it, and has to get it to the page that is
 * about to open.
 *
 * It does not touch the disk. The usual path, and the one every application
 * doing this takes, is to put it in cache storage, redirect, then read it back
 * and delete it. That works every time. It also writes somebody's photo to their
 * disk, if only for a moment, and this site states everywhere that nothing is
 * written there. A promise you have to subtract a case from is no longer the
 * same promise.
 *
 * The bytes therefore stay in this variable, and the worker's life is extended
 * with `waitUntil` until the page comes to claim them. The price is honest: if
 * the browser stops the worker anyway, on low memory or system arbitration, the
 * photo is lost and the page says so. A gesture is lost, never a file: the
 * original has not moved from the gallery.
 */
let partageEnAttente = null;
let reclame = null;

/** The worker stays awake until the page claims, up to 45 s. */
function attendreLaPage() {
  return new Promise((resoudre) => {
    reclame = resoudre;
    setTimeout(() => {
      // Nobody came: release the memory rather than hold on to it.
      partageEnAttente = null;
      resoudre();
    }, 45_000);
  });
}

async function recevoirPartage(event, url) {
  // The home page of the language the share arrived through.
  const page = url.pathname.startsWith('/fr/') ? '/fr/' : '/';
  try {
    const formulaire = await event.request.formData();
    const fichiers = formulaire
      .getAll('photos')
      .filter((f) => typeof f === 'object' && f && 'size' in f && f.size > 0);
    if (!fichiers.length) return Response.redirect(page, 303);

    partageEnAttente = fichiers;
    event.waitUntil(attendreLaPage());
    // 303: the browser goes back to a GET on the page, so a later reload will
    // not repost the form.
    return Response.redirect(`${page}?partage=1`, 303);
  } catch {
    return Response.redirect(page, 303);
  }
}

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message) return;

  // The only path by which an update takes over. See rule 2.
  if (message.type === 'SKIP_WAITING') self.skipWaiting();

  if (message.type === 'RECLAMER_PARTAGE') {
    const fichiers = partageEnAttente;
    // Rendered once, and once only: a reload must not bring back a photo the
    // user thought they had closed.
    partageEnAttente = null;
    if (event.ports && event.ports[0]) event.ports[0].postMessage(fichiers || []);
    if (reclame) {
      reclame();
      reclame = null;
    }
  }
});

self.addEventListener('fetch', (event) => {
  const requete = event.request;
  const url = new URL(requete.url);

  // Rule 1. Do not touch anything that is not ours. First, ahead even of the
  // method filter: what comes from elsewhere is never our business.
  if (url.origin !== self.location.origin) return;

  /*
   * The share target. It is the only `POST` this site knows, and it reaches no
   * server. See `PARTAGE` at the head of the file.
   */
  if (requete.method === 'POST' && PARTAGE.includes(url.pathname)) {
    event.respondWith(recevoirPartage(event, url));
    return;
  }

  if (requete.method !== 'GET') return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      /*
       * A navigation is served from cache first. The pages are static and
       * precached; going to the network first would mean waiting out the
       * timeout on every offline opening.
       */
      if (requete.mode === 'navigate') {
        const enCache = await cache.match(requete, { ignoreSearch: true });
        if (enCache) return enCache;
        try {
          return await fetch(requete);
        } catch {
          /*
           * Last resort: the home page of the same language. Serving "/" for an
           * address under "/fr/" rendered the whole interface in English at a
           * French address, since the island reads `lang` from the served
           * document and does not infer the language from the address. The root
           * remains only the fallback's fallback, since it is always precached.
           */
          const langue = url.pathname.startsWith('/fr/') ? '/fr/' : '/';
          const page = (await cache.match(langue)) ?? (await cache.match('/'));
          if (page) return page;
          throw new Error('hors ligne');
        }
      }

      /*
       * The manifest is fetched from the network first, cache behind.
       *
       * It is the only file in the set the system reads for itself rather than
       * the page: it is where it gets the formats entrusted to us and the window
       * an arrival is placed in. Served from cache without revalidation, a fix
       * to "Open with" only reached an installed application after a manually
       * accepted update, for a file its owner never sees and has no idea about.
       * The browser checks the manifest itself; it still has to be allowed to
       * read something other than yesterday's copy.
       *
       * It stays in the precache list: that is what makes its content count
       * towards the worker's hash, so a fix does produce a new worker, and it is
       * what answers offline.
       */
      if (url.pathname.endsWith('.webmanifest')) {
        try {
          const frais = await fetch(requete);
          if (frais.ok) return frais;
        } catch {
        /* Offline: the cache answers, as it does for everything else. */
        }
      }

      const enCache = await cache.match(requete);
      if (enCache) return enCache;

      const reponse = await fetch(requete);
      /*
       * Anything with a hash in its name cannot change content without changing
       * address: it is kept without reservation. This is how the map enters the
       * cache, once it has been opened for real.
       */
      if (reponse.ok && reponse.type === 'basic' && url.pathname.startsWith('/_astro/')) {
        cache.put(requete, reponse.clone());
      }
      return reponse;
    })(),
  );
});
