/**
 * Le service worker — modèle.
 *
 * Ce fichier n'est pas servi tel quel : `scripts/gen-sw.mjs` remplace les deux
 * marqueurs ci-dessous par la version et par la liste réelle des fichiers
 * produits par la build, empreintes comprises, et écrit le résultat dans
 * `dist/sw.js`. Écrire cette liste à la main serait la garantie qu'elle mente
 * au premier renommage. (Les marqueurs ne sont nommés nulle part dans cette
 * prose : le remplacement porte sur la PREMIÈRE occurrence, et une mention en
 * commentaire la lui volerait.)
 *
 * TROIS RÈGLES, et aucune n'est décorative.
 *
 * 1. RIEN QUI NE SOIT DE L'ORIGINE. La première ligne du gestionnaire `fetch`
 *    rend la main pour tout ce qui vient d'ailleurs. Deux raisons, et chacune
 *    suffirait : la politique de sécurité servie avec CE fichier limite
 *    `connect-src` à 'self', donc un `fetch(requête)` de passe-plat sur une
 *    tuile serait refusé et casserait la carte ; et surtout une tuile mise en
 *    cache écrirait sur le disque la trace durable des lieux consultés, ce que
 *    le site promet précisément de ne pas faire. Une promesse que le cache
 *    contredit n'est plus une promesse.
 *
 * 2. AUCUN `skipWaiting()` INCONDITIONNEL. Quelqu'un peut avoir quarante photos
 *    chargées et rien d'exporté : rien n'est persisté, donc un rechargement
 *    imposé détruit son travail. Le nouveau worker attend, et ne prend la main
 *    que sur un message explicite envoyé par la page — c'est-à-dire après que
 *    l'utilisateur a dit oui.
 *
 * 3. PAS DE PAGE « HORS LIGNE ». Les deux vraies pages sont préchargées : il ne
 *    reste aucune navigation qu'un secours pourrait rattraper. Mieux vaut
 *    l'application elle-même que son faire-part de décès.
 *
 * ARRÊT D'URGENCE. Pour retirer le service worker du parc, remplacer le contenu
 * de `dist/sw.js` par :
 *
 *     self.addEventListener('install', () => self.skipWaiting());
 *     self.addEventListener('activate', async () => {
 *       await self.registration.unregister();
 *       for (const c of await caches.keys()) await caches.delete(c);
 *     });
 *
 * L'ancien worker cherche `sw.js` à chaque navigation : le désarmement se
 * propage tout seul, sans que personne ait à vider quoi que ce soit.
 */

const VERSION = '__VERSION__';
const CACHE = `geotager-${VERSION}`;

/** La coquille : les deux pages, la feuille, l'îlot, le worker de lecture. */
const PRECACHE = __PRECACHE__;

/*
 * Le code de la carte n'est PAS préchargé. Il est chargé à la demande, et c'est
 * tout l'accord du site : tant que personne n'ouvre la carte, pas un octet de
 * ce qui sait parler aux tuiles n'est demandé. Le précharger reviendrait à le
 * télécharger pour tout le monde et à défaire cette garantie par la bande.
 *
 * Il est en revanche gardé APRÈS usage, par la règle d'exécution plus bas : qui
 * a ouvert la carte une fois la retrouve hors ligne — vide de tuiles, ce que
 * l'application sait déjà dire.
 */

self.addEventListener('install', (event) => {
  // `addAll` est atomique : un seul fichier manquant et rien n'est installé.
  // C'est la propriété qu'on veut — un cache à moitié rempli sait afficher la
  // page sans savoir lire une photo, ce qui est pire que pas de cache du tout.
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

self.addEventListener('message', (event) => {
  // Le seul chemin par lequel une mise à jour prend la main. Voir règle 2.
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const requete = event.request;
  if (requete.method !== 'GET') return;

  const url = new URL(requete.url);
  // Règle 1. Ne rien toucher de ce qui n'est pas à nous.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      /*
       * Une navigation est servie depuis le cache d'abord. Les deux pages sont
       * statiques et préchargées ; aller voir le réseau en premier ferait
       * attendre le temps du délai d'expiration à chaque ouverture hors ligne.
       */
      if (requete.mode === 'navigate') {
        const enCache = await cache.match(requete, { ignoreSearch: true });
        if (enCache) return enCache;
        try {
          return await fetch(requete);
        } catch {
          // Dernier recours : la racine, qui est toujours préchargée.
          const racine = await cache.match('/');
          if (racine) return racine;
          throw new Error('hors ligne');
        }
      }

      const enCache = await cache.match(requete);
      if (enCache) return enCache;

      const reponse = await fetch(requete);
      /*
       * Ce qui porte une empreinte dans son nom ne peut pas changer de contenu
       * sans changer d'adresse : on le garde sans réserve. C'est par ici que la
       * carte entre dans le cache, une fois qu'on l'a ouverte pour de bon.
       */
      if (reponse.ok && reponse.type === 'basic' && url.pathname.startsWith('/_astro/')) {
        cache.put(requete, reponse.clone());
      }
      return reponse;
    })(),
  );
});
