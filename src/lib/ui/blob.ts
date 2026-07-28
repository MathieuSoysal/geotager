/*
 * Animated decoration.
 *
 * A `requestAnimationFrame` loop rewrites the `d` attribute of three <path>
 * elements. Nothing else is touched: no CSS property is animated, no layout
 * measurement is read inside the loop, no allocation happens per frame. The
 * layer is composited on its own, so the page behind it is never repainted.
 *
 * What makes that cost acceptable is not its size, it is that the loop stops as
 * soon as it serves no purpose: hero off screen, photo loaded, tab in the
 * background. And it never starts if the visitor asked for less motion. The
 * stylesheet's blanket rule only cuts CSS animations and transitions, it has no
 * hold over `rAF`.
 */
import { COUCHES, cheminBlob } from './blob-path.ts';

const hote = document.getElementById('decor');
const chemins = hote ? Array.from(hote.querySelectorAll<SVGPathElement>('path[data-blob]')) : [];

  /* A loaded photo: the panel is opaque, so every frame would be spent behind
     it, precisely while the worker analyses the file, which is when
     responsiveness matters most. We learn it by watching the attribute, without
     adding a line to `app.ts`. */
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
    /* Bounded: a tab returning to the foreground must not make the shape jump
       by the half minute it spent in the background. */
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

  /* The layer is `fixed`: it is always in frame, so observing it would never
     say anything. The stage is what to watch. */
  if (scene) {
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      hote.classList.toggle('parti', !visible);
      if (visible) demarrer();
      else arreter();
    }).observe(scene);
  }

/*
 * Animated decor.
 *
 * A `requestAnimationFrame` loop rewrites the `d` attribute of three <path>
 * elements. Nothing else is touched: no CSS property is animated, no layout
 * measurement is read inside the loop, no allocation happens per frame. The
 * layer is composited separately, so the page behind it is never repainted.
 *
 * What makes that cost acceptable is not its smallness but that the loop stops
 * as soon as it serves no purpose: hero off screen, photo loaded, tab in the
 * background. And it never starts if the visitor asked for less motion, since
 * the stylesheet's blanket rule only cuts CSS animations and transitions and
 * has no purchase on `rAF`.
 */
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

  /* The motion does not compete with the first paint for the main thread: the
     served HTML already carries frame zero, so the loop can wait for idle. */
  if (!moins.matches) {
    const oisif = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (oisif) oisif(() => demarrer(), { timeout: 1000 });
    else setTimeout(demarrer, 300);
  }
}
