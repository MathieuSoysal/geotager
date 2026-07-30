/**
 * Reading and writing coordinates in the forms people actually use, including
 * a raw paste from Google Maps.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

const DMS =
  /(\d+(?:[.,]\d+)?)\s*[°d]\s*(?:(\d+(?:[.,]\d+)?)\s*['′m]\s*)?(?:(\d+(?:[.,]\d+)?)\s*["″s]?\s*)?\s*([NSEOW])/giu;

function num(s: string | undefined): number {
  return s ? Number(s.replace(',', '.')) : 0;
}

/**
 * Parses free-form input. Accepts decimal, DMS, and what a right-click in
 * Google Maps produces. Returns null rather than guessing.
 */
export function parseCoordinates(input: string): LatLon | null {
  const texte = input.trim();
  if (!texte) return null;

  // 1) DMS form, optionally with hemispheres.
  DMS.lastIndex = 0;
  const dms = [...texte.matchAll(DMS)];
  if (dms.length >= 2) {
    const valeurs = dms.slice(0, 2).map((m) => {
      const v = num(m[1]) + num(m[2]) / 60 + num(m[3]) / 3600;
      const ref = m[4].toUpperCase();
      // "O" for Ouest in French, "W" in English.
      return { v: ref === 'S' || ref === 'W' || ref === 'O' ? -v : v, ref };
    });
    const lat = valeurs.find((x) => x.ref === 'N' || x.ref === 'S');
    const lon = valeurs.find((x) => x.ref === 'E' || x.ref === 'W' || x.ref === 'O');
    if (lat && lon) return validerPosition({ lat: lat.v, lon: lon.v });
    return validerPosition({ lat: valeurs[0].v, lon: valeurs[1].v });
  }

  // 2) Decimal form. Isolate two signed numbers, tolerating the French decimal
  //    comma where it is unambiguous.
  const normalise = texte.replace(/(\d),(\d)/g, '$1.$2');
  const nombres = normalise.match(/-?\d+(?:\.\d+)?/g);
  if (nombres && nombres.length >= 2) {
    return validerPosition({ lat: Number(nombres[0]), lon: Number(nombres[1]) });
  }
  return null;
}

/**
 * The one definition of a usable position, and the only place it lives.
 *
 * `NaN` is a number as far as `typeof` is concerned, which defeats the naive
 * guard. A `NaN` position then crosses the whole interface without tripping
 * anything, displays as "NaN, NaN" through `toFixed`, and projects the map onto
 * `NaN` pixels, so marker and tiles vanish at once. There is no error message
 * at the end of that path, only an empty view.
 *
 * The range check is here for the same reason: a latitude of 500 is as
 * unusable as an absent one, and comes from the same place, a third-party
 * reader nobody asked for guarantees from.
 *
 * Returning `null` is the intended behaviour, never a fallback position.
 * Substituting a value would have a file with no location announce one, which
 * is the single lie this tool cannot afford.
 */
export function validerPosition(p: LatLon): LatLon | null {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null;
  return p;
}

/** Decimal display, five decimals, roughly one metre. */
export function formatDecimal(p: LatLon): string {
  return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
}

/** Display in degrees, minutes, seconds. */
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

// Web Mercator projection

/**
 * The location picker map works in tile pixels: 256 px at zoom 0, doubling at
 * each level. These three functions live here with the rest of the coordinate
 * code rather than in the interface, because they are pure, which is what makes
 * them testable without a browser.
 */

export const TAILLE_TUILE = 256;
export const ZOOM_MIN = 2;
export const ZOOM_MAX = 19;

/**
 * Highest representable latitude: beyond it the projection runs to infinity.
 * This is the value that makes the map square, not a rounded convenience.
 */
export const LAT_MAX = 85.05112878;

const borner = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Wraps a longitude into [-180, 180] rather than clamping it. */
export function normaliserLon(lon: number): number {
  const t = ((lon + 180) % 360 + 360) % 360;
  return t - 180;
}

/** Coordinates to absolute pixels, at the given zoom. */
export function versPixels(p: LatLon, zoom: number): { x: number; y: number } {
  const echelle = TAILLE_TUILE * 2 ** zoom;
  const lat = borner(p.lat, -LAT_MAX, LAT_MAX) * (Math.PI / 180);
  const sin = Math.sin(lat);
  return {
    x: echelle * ((normaliserLon(p.lon) + 180) / 360),
    y: echelle * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)),
  };
}

/** Absolute pixels to coordinates. The exact inverse of `versPixels`. */
export function depuisPixels(x: number, y: number, zoom: number): LatLon {
  const echelle = TAILLE_TUILE * 2 ** zoom;
  const lat = 90 - (360 * Math.atan(Math.exp(((y / echelle) - 0.5) * 2 * Math.PI))) / Math.PI;
  return {
    lat: borner(lat, -LAT_MAX, LAT_MAX),
    lon: normaliserLon((x / echelle) * 360 - 180),
  };
}

/**
 * Metres covered by one pixel, at this latitude and zoom.
 *
 * This is the only honest measure of what a click is worth: aiming at the
 * right city block at zoom 13 is not the same precision as aiming at a door at
 * zoom 19, and the file has to say which of the two was written to it.
 */
export function metresParPixel(lat: number, zoom: number): number {
  const circonference = 40_075_016.686;
  return (
    (circonference * Math.cos(borner(lat, -LAT_MAX, LAT_MAX) * (Math.PI / 180))) /
    (TAILLE_TUILE * 2 ** zoom)
  );
}

/** Approximate distance between two points, in metres. */
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

/** Distance made readable, without false precision. */
export function formatDistance(m: number, virgule = '.'): string {
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 100_000) return `${(m / 1000).toFixed(1).replace('.', virgule)} km`;
  return `${Math.round(m / 1000)} km`;
}
