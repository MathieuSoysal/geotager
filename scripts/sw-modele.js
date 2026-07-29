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

/* --- partage entrant ----------------------------------------------- */

/*
 * Une photo partagée depuis le système arrive ici, en `POST`, parce que c'est
 * la seule forme que l'API du partage accepte pour des fichiers. Il n'y a aucun
 * serveur pour la recevoir : ce worker l'intercepte, et doit la faire parvenir
 * à la page qui va s'ouvrir juste après.
 *
 * ELLE NE TOUCHE PAS LE DISQUE. Le chemin habituel — et celui de toutes les
 * applications qui font ceci — est de la déposer dans le stockage de cache, de
 * rediriger, puis de la relire et de l'effacer. Cela marche à tous les coups.
 * Cela écrit aussi la photo de quelqu'un sur son disque, ne serait-ce qu'un
 * instant, et ce site affirme partout que rien n'y est écrit. Une promesse dont
 * il faut retrancher un cas n'est plus la même promesse.
 *
 * Les octets restent donc dans cette variable, et la vie du worker est
 * prolongée par `waitUntil` le temps que la page vienne les réclamer. Le prix
 * est honnête : si le navigateur arrête tout de même le worker — mémoire
 * basse, arbitrage du système — la photo est perdue et la page le dit. On perd
 * alors un geste, jamais un fichier : l'original n'a pas bougé de la galerie.
 */
let partageEnAttente = null;
let reclame = null;

/** Le worker reste éveillé tant que la page n'a pas réclamé, sans excéder 45 s. */
function attendreLaPage() {
  return new Promise((resoudre) => {
    reclame = resoudre;
    setTimeout(() => {
      // Personne n'est venu : on relâche la mémoire plutôt que de la garder.
      partageEnAttente = null;
      resoudre();
    }, 45_000);
  });
}

async function recevoirPartage(event, url) {
  // La page d'accueil de la langue par laquelle le partage est arrivé.
  const page = url.pathname.startsWith('/fr/') ? '/fr/' : '/';
  try {
    const formulaire = await event.request.formData();
    const fichiers = formulaire
      .getAll('photos')
      .filter((f) => typeof f === 'object' && f && 'size' in f && f.size > 0);
    if (!fichiers.length) return Response.redirect(page, 303);

    partageEnAttente = fichiers;
    event.waitUntil(attendreLaPage());
    // 303 : le navigateur repart en GET sur la page, et un rechargement
    // ultérieur ne repostera pas le formulaire.
    return Response.redirect(`${page}?partage=1`, 303);
  } catch {
    return Response.redirect(page, 303);
  }
}

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message) return;

  // Le seul chemin par lequel une mise à jour prend la main. Voir règle 2.
  if (message.type === 'SKIP_WAITING') self.skipWaiting();

  if (message.type === 'RECLAMER_PARTAGE') {
    const fichiers = partageEnAttente;
    // Rendus une fois, et une seule : un rechargement ne doit pas faire
    // réapparaître une photo que l'utilisateur croyait avoir refermée.
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

  // Règle 1. Ne rien toucher de ce qui n'est pas à nous. En tête, avant même le
  // filtre sur la méthode : ce qui vient d'ailleurs ne nous regarde jamais.
  if (url.origin !== self.location.origin) return;

  /*
   * La cible du partage. C'est le seul `POST` que ce site connaisse, et il
   * n'atteint aucun serveur — `/partager` n'existe pas dans `dist/`, il n'a
   * d'existence que dans ce gestionnaire.
   */
  if (requete.method === 'POST' && /^\/(fr\/)?partager$/.test(url.pathname)) {
    event.respondWith(recevoirPartage(event, url));
    return;
  }

  if (requete.method !== 'GET') return;

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
