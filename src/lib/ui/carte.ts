/**
 * A slippy map, written by hand.
 *
 * Leaflet weighs 42,353 bytes gzipped, 42% of the total JS budget, for a widget
 * of which only panning, zooming and one marker are used here. This file does
 * those three, and the projection lives in `coords.ts` where it is testable
 * without a browser.
 *
 * Two project constraints dictate the shape:
 *
 * 1. `style-src 'self'` does not allow `'unsafe-inline'`. No `style` attribute
 *    can therefore be served in the HTML; one was, once, and the browser
 *    refused it silently. Writing from JavaScript goes through the CSSOM and is
 *    not subject to the policy, so all positioning here is done that way.
 * 2. The tiles are `<img>` elements rather than a `<canvas>`. The browser then
 *    keeps decoding, HTTP caching and screen density; panning is a single
 *    `transform` write on the layer instead of a redraw loop.
 */
import {
  TAILLE_TUILE,
  ZOOM_MAX,
  ZOOM_MIN,
  depuisPixels,
  metresParPixel,
  versPixels,
  type LatLon,
} from '../exif/coords.ts';

/**
 * The tile provider, in one place.
 *
 * The OpenStreetMap Foundation's usage policy tolerates light use but
 * discourages distributed applications. Moving to a service whose terms
 * explicitly cover the web must stay a one-line change: that is why these two
 * constants are exported, and why `scripts/check-build.mjs` knows the host by
 * name.
 */
export const TUILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const HOTE_TUILES = 'tile.openstreetmap.org';

/** Below this, the gesture is a click; above it, a pan. */
const SEUIL_CLIC = 5;

/** A click is not worth the pixel: it is allowed this radius of uncertainty. */
const RAYON_CLIC_PX = 8;

export interface Carte {
  /** Recentres without telling the caller: this is not a user choice. */
  centrer(p: LatLon, zoom?: number): void;
  /** Zooms one level. Here, by contrast, the user did act. */
  zoomer(delta: number): void;
  /** The greyed marker of the location already recorded in the photo. */
  marquerOrigine(p: LatLon | null): void;
  /** Precision of a click at the current zoom, in metres. */
  precisionMetres(): number;
  detruire(): void;
}

export interface OptionsCarte {
  /** Called when the user does point at somewhere. */
  onChoix: (p: LatLon, precisionMetres: number) => void;
  /** Already-translated labels: this module knows no language. */
  textes: { origine: string };
}

const div = (classe: string): HTMLDivElement => {
  const e = document.createElement('div');
  e.className = classe;
  return e;
};

export function creerCarte(hote: HTMLElement, opts: OptionsCarte): Carte {
  let zoom = 13;
  /** Centre of the view, in absolute pixels at the current zoom. */
  let cx = 0;
  let cy = 0;
  let origine: LatLon | null = null;

  const calque = div('carte-tuiles');
  const repere = div('carte-repere');
  const marqueOrigine = div('carte-origine');
  marqueOrigine.title = opts.textes.origine;
  marqueOrigine.hidden = true;
  hote.replaceChildren(calque, marqueOrigine, repere);

  /** The live `<img>` elements, keyed `z/x/y`, to reuse between frames. */
  const tuiles = new Map<string, HTMLImageElement>();

  const largeur = () => hote.clientWidth || 1;
  const hauteur = () => hote.clientHeight || 1;

  // Rendering

  function dessiner(): void {
    const w = largeur();
    const h = hauteur();
    const echelle = TAILLE_TUILE * 2 ** zoom;

    // Top-left corner of the view, in absolute pixels.
    const x0 = cx - w / 2;
    const y0 = cy - h / 2;

    const n = 2 ** zoom;
    const tx0 = Math.floor(x0 / TAILLE_TUILE);
    const ty0 = Math.floor(y0 / TAILLE_TUILE);
    const tx1 = Math.floor((x0 + w) / TAILLE_TUILE);
    const ty1 = Math.floor((y0 + h) / TAILLE_TUILE);

    // The layer carries the sub-pixel offset; each tile then has only an
    // integer position, which avoids rewriting its style every frame.
    calque.style.transform = `translate3d(${-x0}px, ${-y0}px, 0)`;

    const vivantes = new Set<string>();
    for (let ty = ty0; ty <= ty1; ty++) {
      // Outside the poles there is no tile: asking for nothing beats a request
      // that will answer 404.
      if (ty < 0 || ty >= n) continue;
      for (let tx = tx0; tx <= tx1; tx++) {
        // Longitude wraps: tile -1 is tile n-1.
        const wrap = ((tx % n) + n) % n;
        const cle = `${zoom}/${wrap}/${ty}@${tx}`;
        vivantes.add(cle);
        if (tuiles.has(cle)) continue;

        const img = document.createElement('img');
        img.className = 'carte-tuile';
        img.alt = '';
        img.decoding = 'async';
        img.draggable = false;
        // The site sends `Referrer-Policy: no-referrer`. The OpenStreetMap
        // Foundation's usage policy asks the opposite, that the client identify
        // itself, failing which it reserves the right to cut service. `origin`
        // is the smallest agreement possible between the two: the request says
        // "geotager.app" and nothing else, not the page address, not the file
        // name, nothing of the photo.
        img.referrerPolicy = 'origin';
        // A missing tile must never make noise: the whole journey is checked
        // for the absence of any console error.
        img.addEventListener('error', () => { img.hidden = true; });
        img.style.transform = `translate3d(${tx * TAILLE_TUILE}px, ${ty * TAILLE_TUILE}px, 0)`;
        img.src = TUILES.replace('{z}', String(zoom))
          .replace('{x}', String(wrap))
          .replace('{y}', String(ty));
        calque.append(img);
        tuiles.set(cle, img);
      }
    }

    for (const [cle, img] of tuiles) {
      if (vivantes.has(cle)) continue;
      // Removing the attribute cancels the load in progress. Writing `src = ''`
      // would not: the empty string resolves to the document's address, and
      // some browsers then request it again. Remove, do not empty.
      img.removeAttribute('src');
      img.remove();
      tuiles.delete(cle);
    }

    // The marker is at the centre of the view by construction: that is what
    // makes clicking and dragging the map under the marker equivalent.
    repere.style.transform = `translate3d(${w / 2}px, ${h / 2}px, 0)`;

    if (origine) {
      const p = versPixels(origine, zoom);
      // Wrapping the world: show the origin in the nearest copy.
      let dx = p.x - x0;
      while (dx < -echelle / 2) dx += echelle;
      while (dx > echelle / 2) dx -= echelle;
      const dy = p.y - y0;
      const visible = dx >= 0 && dx <= w && dy >= 0 && dy <= h;
      marqueOrigine.hidden = !visible;
      if (visible) marqueOrigine.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    } else {
      marqueOrigine.hidden = true;
    }
  }

  const centreCourant = (): LatLon => depuisPixels(cx, cy, zoom);

  function annoncerChoix(): void {
    const p = centreCourant();
    opts.onChoix(p, precision(p.lat));
  }

  const precision = (lat: number) =>
    Math.max(1, Math.round(metresParPixel(lat, zoom) * RAYON_CLIC_PX));

  // Panning

  let pointeur: number | null = null;
  let departX = 0;
  let departY = 0;
  let parcours = 0;

  /*
   * Pinch.
   *
   * The map followed only one finger: `touch-action: none` disables browser
   * zoom and nothing replaced it, so two fingers on the map did nothing at all.
   * The only zoom controls were two buttons, the gesture nobody uses on a
   * phone.
   *
   * All active pointers are kept. With two, the distance between them drives
   * the zoom: each doubling of that distance is worth one level, and the level
   * changes past the halfway point, without which you would have to spread your
   * fingers the full width of the screen to gain one.
   */
  const pointeurs = new Map<number, { x: number; y: number }>();
  let ecartDepart = 0;
  let zoomDepart = 0;

  const ecart = (): number => {
    const [a, b] = [...pointeurs.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const milieu = (): { x: number; y: number } => {
    const [a, b] = [...pointeurs.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  function surDescente(e: PointerEvent): void {
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Capture throws if the pointer is no longer active; a finger lifted
    // between the event being dispatched and handled is enough. That is no
    // reason to lose the gesture: the map follows perfectly well without it.
    try {
      hote.setPointerCapture(e.pointerId);
    } catch {
      /* capture not available */
    }

    if (pointeurs.size === 2) {
      // The second finger ends the pan in progress: we do not do both at once,
      // and a pinch is never a click.
      pointeur = null;
      parcours = Infinity;
      ecartDepart = ecart();
      zoomDepart = zoom;
      hote.classList.remove('glisse');
      return;
    }
    if (pointeurs.size > 2) return;

    pointeur = e.pointerId;
    departX = e.clientX;
    departY = e.clientY;
    parcours = 0;
    hote.classList.add('glisse');
  }

  function surMouvement(e: PointerEvent): void {
    if (pointeurs.has(e.pointerId)) pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointeurs.size === 2) {
      const courant = ecart();
      if (ecartDepart > 0 && courant > 0) {
        const crans = Math.round(Math.log2(courant / ecartDepart));
        const vise = zoomDepart + crans;
        if (vise !== zoom) {
          const r = hote.getBoundingClientRect();
          const m = milieu();
          zoomer(vise - zoom, m.x - r.left, m.y - r.top);
        }
      }
      return;
    }

    if (e.pointerId !== pointeur) return;
    const dx = e.clientX - departX;
    const dy = e.clientY - departY;
    parcours += Math.abs(dx) + Math.abs(dy);
    departX = e.clientX;
    departY = e.clientY;
    cx -= dx;
    cy -= dy;
    contraindre();
    dessiner();
  }

  function surRemontee(e: PointerEvent): void {
    pointeurs.delete(e.pointerId);
    try {
      if (hote.hasPointerCapture(e.pointerId)) hote.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }

    // The finger left after a pinch must neither jump the map nor count as a
    // click: we restart cleanly from its position.
    if (pointeurs.size === 1) {
      const [id] = [...pointeurs.keys()];
      const p = pointeurs.get(id)!;
      pointeur = id;
      departX = p.x;
      departY = p.y;
      parcours = Infinity;
      return;
    }

    if (e.pointerId !== pointeur) return;
    pointeur = null;
    hote.classList.remove('glisse');

    if (parcours < SEUIL_CLIC) {
      // A click: the point aimed at becomes the centre, and so the marker.
      const r = hote.getBoundingClientRect();
      cx += e.clientX - r.left - largeur() / 2;
      cy += e.clientY - r.top - hauteur() / 2;
      contraindre();
      dessiner();
    }
    annoncerChoix();
  }

  /** The view leaves neither top nor bottom; it wraps sideways. */
  function contraindre(): void {
    const echelle = TAILLE_TUILE * 2 ** zoom;
    cy = Math.min(echelle, Math.max(0, cy));
    cx = ((cx % echelle) + echelle) % echelle;
  }

  // Zoom

  function zoomer(delta: number, ancreX?: number, ancreY?: number): void {
    const cible = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + delta));
    if (cible === zoom) return;

    // Zooming with the wheel must keep the point under the cursor in place.
    const ax = ancreX ?? largeur() / 2;
    const ay = ancreY ?? hauteur() / 2;
    const avant = depuisPixels(cx - largeur() / 2 + ax, cy - hauteur() / 2 + ay, zoom);

    zoom = cible;
    const p = versPixels(avant, zoom);
    cx = p.x + largeur() / 2 - ax;
    cy = p.y + hauteur() / 2 - ay;
    contraindre();
    dessiner();
    annoncerChoix();
  }

  function surMolette(e: WheelEvent): void {
    e.preventDefault();
    const r = hote.getBoundingClientRect();
    zoomer(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
  }

  // Keyboard

  function surTouche(e: KeyboardEvent): void {
    const pas = e.shiftKey ? 40 : 8;
    switch (e.key) {
      case 'ArrowLeft': cx -= pas; break;
      case 'ArrowRight': cx += pas; break;
      case 'ArrowUp': cy -= pas; break;
      case 'ArrowDown': cy += pas; break;
      case '+': case '=': zoomer(1); return;
      case '-': case '_': zoomer(-1); return;
      default: return;
    }
    e.preventDefault();
    contraindre();
    dessiner();
    annoncerChoix();
  }

  // Lifecycle

  hote.addEventListener('pointerdown', surDescente);
  hote.addEventListener('pointermove', surMouvement);
  hote.addEventListener('pointerup', surRemontee);
  hote.addEventListener('pointercancel', surRemontee);
  hote.addEventListener('wheel', surMolette, { passive: false });
  hote.addEventListener('keydown', surTouche);

  // The view size depends on layout: it is only known once the map is
  // displayed, and it changes when the screen rotates.
  const observateur = new ResizeObserver(() => dessiner());
  observateur.observe(hote);

  return {
    centrer(p, z) {
      if (z !== undefined) zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
      const px = versPixels(p, zoom);
      cx = px.x;
      cy = px.y;
      contraindre();
      dessiner();
    },
    zoomer(delta) {
      zoomer(delta);
    },
    marquerOrigine(p) {
      origine = p;
      dessiner();
    },
    precisionMetres() {
      return precision(centreCourant().lat);
    },
    detruire() {
      observateur.disconnect();
      hote.removeEventListener('pointerdown', surDescente);
      hote.removeEventListener('pointermove', surMouvement);
      hote.removeEventListener('pointerup', surRemontee);
      hote.removeEventListener('pointercancel', surRemontee);
      hote.removeEventListener('wheel', surMolette);
      hote.removeEventListener('keydown', surTouche);
      for (const img of tuiles.values()) img.removeAttribute('src');
      tuiles.clear();
      hote.replaceChildren();
    },
  };
}
