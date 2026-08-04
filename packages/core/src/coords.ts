/**
 * Lecture et écriture de coordonnées, dans les formes que les gens utilisent
 * réellement — y compris le collage brut depuis Google Maps.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

const NOMBRES_DMS =
  "(\\d+(?:[.,]\\d+)?)\\s*[°d]\\s*(?:(\\d+(?:[.,]\\d+)?)\\s*['′m]\\s*)?" +
  "(?:(\\d+(?:[.,]\\d+)?)\\s*(?:''|[\"″s])?\\s*)?";

/*
 * Deux dispositions, essayées dans cet ordre, et jamais mélangées.
 *
 * La lettre suit les nombres — `43°54′29.2″N` — ou les précède — `N 43°54′29.2″`.
 * Une seule expression qui rendrait la lettre facultative des deux côtés
 * prendrait, sur la seconde disposition, le « E » de la longitude pour la
 * lettre de la latitude, et laisserait la longitude sans hémisphère. Deux
 * lectures franches valent mieux qu'une lecture qui se trompe d'axe.
 */
const DMS_LETTRE_APRES = new RegExp(`${NOMBRES_DMS}\\s*([NSEOW])`, 'giu');
const DMS_LETTRE_AVANT = new RegExp(`([NSEOW])\\s*${NOMBRES_DMS}`, 'giu');

function num(s: string | undefined): number {
  return s ? Number(s.replace(',', '.')) : 0;
}

/** Une composante lue : sa valeur signée, et l'axe que sa lettre désigne. */
interface Composante {
  v: number;
  ref: string;
}

/**
 * Les composantes d'une écriture en degrés, dans la disposition qui s'applique.
 *
 * Rend une liste vide quand aucune ne s'applique. Les minutes et les secondes
 * au-delà de soixante disqualifient la lecture : c'est ce qui distingue une
 * position d'une suite de nombres qui lui ressemble.
 */
function composantesDms(texte: string): Composante[] {
  const lire = (motif: RegExp, ordre: [number, number, number, number]): Composante[] => {
    motif.lastIndex = 0;
    const out: Composante[] = [];
    for (const m of texte.matchAll(motif)) {
      const [iL, iD, iM, iS] = ordre;
      const minutes = num(m[iM]);
      const secondes = num(m[iS]);
      if (minutes >= 60 || secondes >= 60) return [];
      const v = num(m[iD]) + minutes / 60 + secondes / 3600;
      const ref = (m[iL] ?? '').toUpperCase();
      // « O » pour Ouest en français, « W » en anglais.
      out.push({ v: ref === 'S' || ref === 'W' || ref === 'O' ? -v : v, ref });
    }
    return out;
  };
  const apres = lire(DMS_LETTRE_APRES, [4, 1, 2, 3]);
  return apres.length >= 2 ? apres : lire(DMS_LETTRE_AVANT, [1, 2, 3, 4]);
}

/**
 * Une position écrite en degrés, minutes et secondes — et rien d'autre.
 *
 * `parseCoordinates` accepte aussi la paire de nombres nue, ce qui est juste
 * pour une saisie où quelqu'un COLLE délibérément deux nombres. Ce n'est pas
 * juste pour un champ de fichier : un titre où traînent deux nombres n'est pas
 * un lieu, et en tirer une position est la seule faute qu'un outil de
 * confidentialité ne peut pas se permettre. D'où cette porte séparée, qui EXIGE
 * les symboles, et le comptage qui va avec.
 */
export function lireDms(entree: string): LatLon | null {
  const texte = entree.trim();
  // Deux marques de degré, exactement : c'est la structure d'un lieu. Une
  // chaîne à trois coordonnées doit être refusée sur sa STRUCTURE, et non sur
  // le fait qu'une lecture veuille bien en tirer deux nombres quelconques.
  if ((texte.match(/[°d]/giu) ?? []).length !== 2) return null;
  const parts = composantesDms(texte);
  if (parts.length !== 2) return null;
  const lat = parts.filter((x) => x.ref === 'N' || x.ref === 'S');
  const lon = parts.filter((x) => x.ref === 'E' || x.ref === 'W' || x.ref === 'O');
  // Un axe donné deux fois, ou pas du tout : on refuse plutôt que de choisir.
  if (lat.length !== 1 || lon.length !== 1) return null;
  return validerPosition({ lat: lat[0].v, lon: lon[0].v });
}

/**
 * Analyse une saisie libre. Accepte le décimal, le DMS, et ce que produit un
 * clic droit dans Google Maps. Renvoie null plutôt que de deviner.
 */
export function parseCoordinates(input: string): LatLon | null {
  const texte = input.trim();
  if (!texte) return null;

  // 1) Forme DMS, éventuellement avec hémisphères.
  const parts = composantesDms(texte);
  if (parts.length >= 2) {
    const deux = parts.slice(0, 2);
    const lat = deux.find((x) => x.ref === 'N' || x.ref === 'S');
    const lon = deux.find((x) => x.ref === 'E' || x.ref === 'W' || x.ref === 'O');
    if (lat && lon) return validerPosition({ lat: lat.v, lon: lon.v });
    return validerPosition({ lat: deux[0].v, lon: deux[1].v });
  }

  // 2) Forme décimale. On isole deux nombres signés, en tolérant la virgule
  //    décimale française quand elle n'est pas ambiguë.
  const normalise = texte.replace(/(\d),(\d)/g, '$1.$2');
  const nombres = normalise.match(/-?\d+(?:\.\d+)?/g);
  if (nombres && nombres.length >= 2) {
    return validerPosition({ lat: Number(nombres[0]), lon: Number(nombres[1]) });
  }
  return null;
}

/**
 * La seule définition d'une position utilisable — et le seul endroit où elle
 * vit.
 *
 * `NaN` est un nombre pour `typeof`, ce qui rend la garde naïve inopérante :
 * `typeof NaN === 'number'` est vrai. Une position `NaN` traverse alors toute
 * l'interface sans rien déclencher, s'affiche « NaN, NaN » à travers
 * `toFixed`, et projette la carte sur des pixels `NaN` — le repère et les
 * tuiles disparaissent d'un coup. Il n'y a aucun message d'erreur au bout de ce
 * chemin, juste une vue vide.
 *
 * La borne de plage est ici pour la même raison : une latitude de 500 est aussi
 * inutilisable qu'une latitude absente, et vient de la même source — un lecteur
 * tiers à qui l'on n'a pas demandé de garantie.
 *
 * Renvoyer `null` est le comportement voulu, jamais une position de repli. Voir
 * `dmsToDegrees` dans `tiff.ts` : substituer une valeur ferait annoncer un lieu
 * à un fichier qui n'en porte aucun, ce qui est le seul mensonge que cet outil
 * ne peut pas se permettre.
 */
export function validerPosition(p: LatLon): LatLon | null {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null;
  return p;
}

/** Affichage décimal, cinq décimales — environ un mètre. */
export function formatDecimal(p: LatLon): string {
  return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
}

/** Affichage en degrés, minutes, secondes. */
export function formatDms(p: LatLon): string {
  const part = (v: number, positif: string, negatif: string) => {
    const abs = Math.abs(v);
    const d = Math.floor(abs);
    const m = Math.floor((abs - d) * 60);
    const s = ((abs - d) * 60 - m) * 60;
    return `${d}° ${m}′ ${s.toFixed(2)}″ ${v >= 0 ? positif : negatif}`;
  };
  return `${part(p.lat, 'N', 'S')}  ${part(p.lon, 'E', 'O')}`;
}

/* --- projection Web Mercator -------------------------------------- */

/**
 * La carte de choix du lieu travaille en pixels de tuile : 256 px au zoom 0,
 * doublés à chaque niveau. Ces trois fonctions vivent ici, avec le reste des
 * coordonnées, et non dans l'interface — elles sont pures, et c'est ce qui
 * permet de les éprouver sans navigateur.
 */

export const TAILLE_TUILE = 256;
export const ZOOM_MIN = 2;
export const ZOOM_MAX = 19;

/**
 * Latitude maximale représentable : au-delà, la projection part à l'infini.
 * C'est la valeur qui rend la carte carrée, et non un arrondi de confort.
 */
export const LAT_MAX = 85.05112878;

const borner = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Ramène une longitude dans [-180, 180], en faisant le tour plutôt qu'en coupant. */
export function normaliserLon(lon: number): number {
  const t = ((lon + 180) % 360 + 360) % 360;
  return t - 180;
}

/** Coordonnées → pixels absolus, au zoom donné. */
export function versPixels(p: LatLon, zoom: number): { x: number; y: number } {
  const echelle = TAILLE_TUILE * 2 ** zoom;
  const lat = borner(p.lat, -LAT_MAX, LAT_MAX) * (Math.PI / 180);
  const sin = Math.sin(lat);
  return {
    x: echelle * ((normaliserLon(p.lon) + 180) / 360),
    y: echelle * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)),
  };
}

/** Pixels absolus → coordonnées. L'inverse exact de `versPixels`. */
export function depuisPixels(x: number, y: number, zoom: number): LatLon {
  const echelle = TAILLE_TUILE * 2 ** zoom;
  const lat = 90 - (360 * Math.atan(Math.exp(((y / echelle) - 0.5) * 2 * Math.PI))) / Math.PI;
  return {
    lat: borner(lat, -LAT_MAX, LAT_MAX),
    lon: normaliserLon((x / echelle) * 360 - 180),
  };
}

/**
 * Mètres couverts par un pixel, à cette latitude et ce zoom.
 *
 * C'est la seule mesure honnête de ce que vaut un clic : viser le bon pâté de
 * maisons au zoom 13 ne donne pas la même précision que viser une porte au
 * zoom 19, et le fichier doit dire laquelle des deux on lui a écrite.
 */
export function metresParPixel(lat: number, zoom: number): number {
  const circonference = 40_075_016.686;
  return (
    (circonference * Math.cos(borner(lat, -LAT_MAX, LAT_MAX) * (Math.PI / 180))) /
    (TAILLE_TUILE * 2 ** zoom)
  );
}

/** Distance approchée entre deux points, en mètres. */
export function distanceMetres(a: LatLon, b: LatLon): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance rendue lisible, sans fausse précision. */
export function formatDistance(m: number, virgule = '.'): string {
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 100_000) return `${(m / 1000).toFixed(1).replace('.', virgule)} km`;
  return `${Math.round(m / 1000)} km`;
}
