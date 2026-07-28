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
    if (lat && lon) return valider({ lat: lat.v, lon: lon.v });
    return valider({ lat: valeurs[0].v, lon: valeurs[1].v });
  }

  // 2) Decimal form. Isolate two signed numbers, tolerating the French decimal
  //    comma where it is unambiguous.
  const normalise = texte.replace(/(\d),(\d)/g, '$1.$2');
  const nombres = normalise.match(/-?\d+(?:\.\d+)?/g);
  if (nombres && nombres.length >= 2) {
    return valider({ lat: Number(nombres[0]), lon: Number(nombres[1]) });
  }
  return null;
}

function valider(p: LatLon): LatLon | null {
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
