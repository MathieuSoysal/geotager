/**
 * Copies of the location stored outside the main block.
 *
 * A file can carry the location twice: in the main block, and in a descriptive
 * text packet added by an editor. Erasing the first and leaving the second
 * hands back a file the user believes is clean, which is the worst outcome
 * this tool can produce.
 *
 * Two decisions govern this module:
 *
 *   1. Only the location properties are removed, not the whole packet. The
 *      packet also carries title, caption, author and edit history; dropping
 *      those would be a loss nobody asked for.
 *   2. The purge checks its own work. If a marker survives it (nested form,
 *      unexpected encoding, compressed packet) the operation fails, which turns
 *      an incomplete purge into a visible error rather than a silent leak.
 *
 * Replacement is done with spaces so the length does not change, nothing
 * shifts, and a space is legal everywhere these properties live.
 */

/**
 * Properties that denote a location.
 *
 * `Iptc4xmpExt:LocationCreated` is included because IPTC IIM carries no
 * coordinates of its own but this structure does, and removing the degrees
 * while leaving the town name would be absurd.
 */
export const MARQUEURS_DE_LIEU = [
  'exif:GPSLatitude',
  'exif:GPSLongitude',
  'exif:GPSAltitude',
  'exif:GPSAltitudeRef',
  'exif:GPSTimeStamp',
  'exif:GPSDateStamp',
  'exif:GPSVersionID',
  'exif:GPSMapDatum',
  'exif:GPSImgDirection',
  'exif:GPSImgDirectionRef',
  'Iptc4xmpExt:LocationCreated',
  'Iptc4xmpExt:LocationShown',
  'photoshop:City',
  'photoshop:State',
  'photoshop:Country',
];

/** True if this text announces a location. */
export function porteUnLieu(texte: string): boolean {
  return MARQUEURS_DE_LIEU.some((m) => texte.includes(m));
}

/**
 * The location written in a text packet, if it carries one.
 *
 * The form is EXIF's, not the decimal degrees one might expect: `43,54.4866N`,
 * meaning degrees, comma, decimal minutes, then hemisphere. A
 * degrees-minutes-seconds variant exists too. Reading `43,54.4866` as a number
 * would yield 43, an error of a hundred kilometres that displays without
 * looking wrong.
 *
 * This module already detected a location here, in order to refuse an
 * incomplete erase; it could not read one, so the packet was invisible in what
 * the tool displays while other readers showed it.
 */
export function lireLieuXmp(texte: string): { lat: number; lon: number } | null {
  const valeur = (propriete: string): number | null => {
    const m = new RegExp(`<${propriete}>([^<]+)</${propriete}>`).exec(texte)
      ?? new RegExp(`${propriete}\\s*=\\s*["']([^"']+)["']`).exec(texte);
    if (!m) return null;
    const brut = m[1].trim();
    const hemisphere = /[NSEWns ew]$/.test(brut) ? brut.slice(-1).toUpperCase() : '';
    const chiffres = (hemisphere ? brut.slice(0, -1) : brut).split(',').map(Number);
    if (!chiffres.length || chiffres.some((n) => !Number.isFinite(n))) return null;
    // Degrees alone, degrees + minutes, or degrees + minutes + seconds.
    const v = (chiffres[0] ?? 0) + (chiffres[1] ?? 0) / 60 + (chiffres[2] ?? 0) / 3600;
    return hemisphere === 'S' || hemisphere === 'W' ? -v : v;
  };
  const lat = valeur('exif:GPSLatitude');
  const lon = valeur('exif:GPSLongitude');
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Removes the location properties from a text packet at constant length.
 *
 * Returns `null` if a marker survives, in which case the caller must refuse the
 * operation rather than hand back a half-cleaned file.
 */
export function purgerLeLieu(texte: string): string | null {
  let out = texte;
  const blanchir = (motif: RegExp) => {
    out = out.replace(motif, (trouve) => ' '.repeat(trouve.length));
  };

  for (const marqueur of MARQUEURS_DE_LIEU) {
    const m = echapper(marqueur);
    // Element form, including nested content.
    blanchir(new RegExp(`<${m}(\\s[^>]*)?>[\\s\\S]*?</${m}>`, 'g'));
    // Empty element form.
    blanchir(new RegExp(`<${m}(\\s[^>]*)?/>`, 'g'));
    // Attribute form, double or single quotes.
    blanchir(new RegExp(`${m}\\s*=\\s*"[^"]*"`, 'g'));
    blanchir(new RegExp(`${m}\\s*=\\s*'[^']*'`, 'g'));
  }

  if (out.length !== texte.length) return null; // invariant : longueur constante
  return porteUnLieu(out) ? null : out;
}
