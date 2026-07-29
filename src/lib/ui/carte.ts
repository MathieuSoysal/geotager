/**
 * Carte glissante, écrite à la main.
 *
 * Leaflet pèse 42 353 o gzip — 42 % du budget JS total — pour un widget dont on
 * n'utilise ici que le déplacement, le zoom et un repère (`CREDITS.md`). Ce
 * fichier fait les trois, et la projection vit dans `coords.ts` où elle est
 * testable sans navigateur.
 *
 * Deux contraintes du projet dictent la forme :
 *
 * 1. `style-src 'self'` n'admet pas `'unsafe-inline'`. Aucun attribut `style`
 *    ne peut donc être SERVI dans le HTML — un l'a été une fois, et le
 *    navigateur l'a refusé en silence (voir `global.css`). Écrire depuis le
 *    JavaScript, en revanche, passe par le CSSOM et n'est pas soumis à la
 *    politique : tout le positionnement d'ici est fait ainsi.
 * 2. Les tuiles sont des `<img>`, et non un `<canvas>`. Le navigateur garde
 *    alors le décodage, le cache HTTP et la densité d'écran ; le déplacement
 *    est une seule écriture de `transform` sur le calque, au lieu d'une boucle
 *    de redessin.
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
 * Le fournisseur de fond, en un seul endroit.
 *
 * La politique d'usage de la fondation OpenStreetMap tolère les usages légers
 * mais décourage les applications distribuées. Passer à un service dont les
 * conditions couvrent explicitement le web doit rester une modification d'une
 * ligne : c'est pourquoi ces deux constantes sont exportées, et pourquoi
 * `scripts/check-build.mjs` connaît l'hôte par son nom.
 */
export const TUILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const HOTE_TUILES = 'tile.openstreetmap.org';

/** En deçà, le geste est un clic ; au-delà, c'est un déplacement. */
const SEUIL_CLIC = 5;

/** Un clic ne vaut pas le pixel : on lui accorde ce rayon d'incertitude. */
const RAYON_CLIC_PX = 8;

export interface Carte {
  /** Recentre, sans prévenir l'appelant : ce n'est pas un choix de l'utilisateur. */
  centrer(p: LatLon, zoom?: number): void;
  /** Zoome d'un cran. Là, en revanche, c'est bien l'utilisateur qui a agi. */
  zoomer(delta: number): void;
  /** Le repère grisé de la position déjà inscrite dans la photo. */
  marquerOrigine(p: LatLon | null): void;
  /** Précision d'un clic au zoom courant, en mètres. */
  precisionMetres(): number;
  detruire(): void;
}

export interface OptionsCarte {
  /** Appelé quand l'utilisateur, lui, désigne un point. */
  onChoix: (p: LatLon, precisionMetres: number) => void;
  /** Libellés déjà traduits : ce module ne connaît aucune langue. */
  textes: { origine: string };
}

const div = (classe: string): HTMLDivElement => {
  const e = document.createElement('div');
  e.className = classe;
  return e;
};

export function creerCarte(hote: HTMLElement, opts: OptionsCarte): Carte {
  let zoom = 13;
  /** Centre de la vue, en pixels absolus au zoom courant. */
  let cx = 0;
  let cy = 0;
  let origine: LatLon | null = null;

  const calque = div('carte-tuiles');
  const repere = div('carte-repere');
  const marqueOrigine = div('carte-origine');
  marqueOrigine.title = opts.textes.origine;
  marqueOrigine.hidden = true;
  hote.replaceChildren(calque, marqueOrigine, repere);

  /** Les `<img>` vivantes, par clé `z/x/y`, pour les réutiliser d'une image à l'autre. */
  const tuiles = new Map<string, HTMLImageElement>();

  const largeur = () => hote.clientWidth || 1;
  const hauteur = () => hote.clientHeight || 1;

  /* --- rendu ------------------------------------------------------- */

  function dessiner(): void {
    const w = largeur();
    const h = hauteur();
    const echelle = TAILLE_TUILE * 2 ** zoom;

    // Coin haut-gauche de la vue, en pixels absolus.
    const x0 = cx - w / 2;
    const y0 = cy - h / 2;

    const n = 2 ** zoom;
    const tx0 = Math.floor(x0 / TAILLE_TUILE);
    const ty0 = Math.floor(y0 / TAILLE_TUILE);
    const tx1 = Math.floor((x0 + w) / TAILLE_TUILE);
    const ty1 = Math.floor((y0 + h) / TAILLE_TUILE);

    // Le calque porte le décalage sous-pixel ; chaque tuile n'a plus qu'une
    // position entière, ce qui évite de réécrire son style à chaque image.
    calque.style.transform = `translate3d(${-x0}px, ${-y0}px, 0)`;

    const vivantes = new Set<string>();
    for (let ty = ty0; ty <= ty1; ty++) {
      // Hors des pôles il n'y a pas de tuile : ne rien demander vaut mieux
      // qu'une requête qui répondra 404.
      if (ty < 0 || ty >= n) continue;
      for (let tx = tx0; tx <= tx1; tx++) {
        // La longitude fait le tour, elle : la tuile -1 est la tuile n-1.
        const wrap = ((tx % n) + n) % n;
        const cle = `${zoom}/${wrap}/${ty}@${tx}`;
        vivantes.add(cle);
        if (tuiles.has(cle)) continue;

        const img = document.createElement('img');
        img.className = 'carte-tuile';
        img.alt = '';
        img.decoding = 'async';
        img.draggable = false;
        // Le site envoie `Referrer-Policy: no-referrer`. La politique d'usage
        // de la fondation OpenStreetMap demande à l'inverse que le client
        // s'identifie, faute de quoi elle se réserve de couper le service.
        // `origin` est le plus petit accord possible entre les deux : la
        // requête dit « geotager.app », et rien d'autre — pas l'adresse de la
        // page, pas le nom du fichier, rien de la photo. C'est écrit dans les
        // deux pages « Pourquoi vos fichiers ne partent pas ».
        img.referrerPolicy = 'origin';
        // Une tuile absente ne doit jamais faire de bruit : le parcours
        // complet est vérifié « sans aucune erreur de console ».
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
      // Retirer l'attribut annule le chargement en cours. Écrire `src = ''` ne
      // le ferait pas : la chaîne vide se résout en l'adresse du document, et
      // certains navigateurs vont alors la RE-demander. On enlève, on ne vide
      // pas.
      img.removeAttribute('src');
      img.remove();
      tuiles.delete(cle);
    }

    // Le repère est au centre de la vue par construction : c'est ce qui rend
    // « cliquer » et « faire glisser la carte sous le repère » équivalents.
    repere.style.transform = `translate3d(${w / 2}px, ${h / 2}px, 0)`;

    if (origine) {
      const p = versPixels(origine, zoom);
      // Le tour du monde : montrer l'origine dans la copie la plus proche.
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

  /* --- déplacement ------------------------------------------------- */

  let pointeur: number | null = null;
  let departX = 0;
  let departY = 0;
  let parcours = 0;

  /*
   * Le pincement.
   *
   * La carte ne suivait qu'un seul doigt : `touch-action: none` coupe le zoom
   * du navigateur, et rien ne le remplaçait — deux doigts sur la carte ne
   * faisaient donc rigoureusement rien. Les seules commandes de zoom étaient
   * deux boutons, ce qui est le geste que personne n'emploie sur un téléphone.
   *
   * On garde tous les pointeurs actifs. À deux, l'écart entre eux pilote le
   * zoom : chaque doublement de cet écart vaut un cran, et le cran est franchi
   * quand on dépasse la moitié — sans quoi il faudrait écarter les doigts de
   * toute la largeur de l'écran pour gagner un niveau.
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
    // La capture lève si le pointeur n'est plus actif — un doigt relevé entre
    // l'émission de l'événement et son traitement suffit. Ce n'est pas une
    // raison de perdre le geste : la carte suit très bien sans la capture.
    try {
      hote.setPointerCapture(e.pointerId);
    } catch {
      /* tant pis pour la capture */
    }

    if (pointeurs.size === 2) {
      // Le second doigt met fin au déplacement en cours : on ne fait pas les
      // deux à la fois, et un pincement n'est jamais un clic.
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
      /* déjà relâché */
    }

    // Le doigt qui reste après un pincement ne doit ni déplacer la carte d'un
    // bond, ni compter pour un clic : on repart proprement de sa position.
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
      // Un clic : le point visé devient le centre, donc le repère.
      const r = hote.getBoundingClientRect();
      cx += e.clientX - r.left - largeur() / 2;
      cy += e.clientY - r.top - hauteur() / 2;
      contraindre();
      dessiner();
    }
    annoncerChoix();
  }

  /** La vue ne sort ni par le haut ni par le bas ; elle fait le tour de côté. */
  function contraindre(): void {
    const echelle = TAILLE_TUILE * 2 ** zoom;
    cy = Math.min(echelle, Math.max(0, cy));
    cx = ((cx % echelle) + echelle) % echelle;
  }

  /* --- zoom -------------------------------------------------------- */

  function zoomer(delta: number, ancreX?: number, ancreY?: number): void {
    const cible = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + delta));
    if (cible === zoom) return;

    // Zoomer à la molette doit garder sous le curseur le point qui s'y trouve.
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

  /* --- clavier ----------------------------------------------------- */

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

  /* --- cycle de vie ------------------------------------------------ */

  hote.addEventListener('pointerdown', surDescente);
  hote.addEventListener('pointermove', surMouvement);
  hote.addEventListener('pointerup', surRemontee);
  hote.addEventListener('pointercancel', surRemontee);
  hote.addEventListener('wheel', surMolette, { passive: false });
  hote.addEventListener('keydown', surTouche);

  // La taille de la vue dépend de la mise en page : elle n'est connue qu'une
  // fois la carte affichée, et elle change à la rotation de l'écran.
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
