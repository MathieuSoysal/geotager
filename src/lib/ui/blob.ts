/*
 * Décor animé.
 *
 * Une boucle `requestAnimationFrame` réécrit l'attribut `d` de trois <path>.
 * Rien d'autre n'est touché : aucune propriété CSS n'est animée, aucune mesure
 * de mise en page n'est lue dans la boucle, aucune allocation n'a lieu par
 * image. Le calque est composé à part, si bien que la page derrière lui n'est
 * jamais repeinte.
 *
 * Ce qui rend ce coût acceptable n'est pas sa petitesse, c'est que la boucle
 * s'arrête dès qu'elle ne sert plus : héros hors de l'écran, photo chargée,
 * onglet au second plan. Et elle ne démarre jamais si le visiteur a demandé
 * moins de mouvement — la règle générale de la feuille de style ne coupe que
 * les animations et les transitions CSS, elle n'a aucune prise sur `rAF`.
 */
import { COUCHES, cheminBlob } from './blob-path.ts';

const hote = document.getElementById('decor');
const chemins = hote ? Array.from(hote.querySelectorAll<SVGPathElement>('path[data-blob]')) : [];

/* Une décoration absente n'est pas une panne : on s'en va sans un mot. Le test
   de bout en bout refuse la moindre erreur de console, et il a raison. */
if (hote && chemins.length === COUCHES.length) {
  const scene = document.querySelector('.stage');
  const actif = document.getElementById('etat-actif');
  const moins = matchMedia('(prefers-reduced-motion: reduce)');

  let brut = 0; // identifiant rAF ; 0 signifie « à l'arrêt »
  let dernier = 0; // horodatage de l'image précédente
  let ecoule = 0; // temps d'animation accumulé, en millisecondes
  let visible = true; // le héros est-il à l'écran ?
  let repos = false; // une photo est-elle chargée ?

  function dessiner(t: number): void {
    for (let i = 0; i < chemins.length; i++) {
      chemins[i].setAttribute('d', cheminBlob(COUCHES[i], t));
    }
  }

  function image(t: number): void {
    brut = requestAnimationFrame(image);
    /* Borne : un onglet qui revient au premier plan ne doit pas faire sauter
       la forme de la demi-minute qu'il a passée en arrière-plan. */
    if (dernier) ecoule += Math.min(t - dernier, 50);
    dernier = t;
    dessiner(ecoule);
  }

  function arreter(): void {
    if (brut) {
      cancelAnimationFrame(brut);
      brut = 0;
      dernier = 0;
    }
  }

  function demarrer(): void {
    if (brut || moins.matches || !visible || repos) return;
    if (document.visibilityState === 'hidden') return;
    dernier = 0;
    brut = requestAnimationFrame(image);
  }

  /* Le calque est `fixed` : il est toujours dans le cadre, l'observer lui-même
     ne dirait jamais rien. C'est la scène qu'il faut regarder. */
  if (scene) {
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      hote.classList.toggle('parti', !visible);
      if (visible) demarrer();
      else arreter();
    }).observe(scene);
  }

  /* Une photo chargée : l'îlot est opaque, chaque image serait dépensée
     derrière lui — et précisément pendant que le worker analyse le fichier,
     c'est-à-dire quand la réactivité compte le plus. On l'apprend en observant
     l'attribut, sans ajouter une ligne à `app.ts`. */
  if (actif) {
    const lire = () => {
      repos = !actif.hidden;
      hote.classList.toggle('repos', repos);
      if (repos) arreter();
      else demarrer();
    };
    new MutationObserver(lire).observe(actif, { attributes: true, attributeFilter: ['hidden'] });
    lire();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') demarrer();
    else arreter();
  });
  addEventListener('pagehide', arreter);
  addEventListener('pageshow', demarrer);

  moins.addEventListener('change', () => {
    if (moins.matches) {
      arreter();
      dessiner(0); // retour exact à l'image gravée dans le HTML
    } else {
      demarrer();
    }
  });

  /* Le mouvement ne dispute pas le fil principal à la première peinture : le
     HTML servi porte déjà l'image zéro, la boucle peut attendre un temps mort. */
  if (!moins.matches) {
    const oisif = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (oisif) oisif(() => demarrer(), { timeout: 1000 });
    else setTimeout(demarrer, 300);
  }
}
