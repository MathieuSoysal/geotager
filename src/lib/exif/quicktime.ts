/**
 * The location of a video, MOV and MP4.
 *
 * Nothing here resembles the rest of the engine, and that is intended. A photo
 * keeps its position in a TIFF block, as rationals, in one place. A video keeps
 * it as text, an ISO 6709 string such as `+43.9493+004.8055/`, and it keeps it
 * in several places at once depending on who wrote it: Apple, Samsung and
 * Google do not pick the same one.
 *
 * Three rules govern everything below, and they matter more than the code.
 *
 *   1. All or nothing. A file whose one slot says one location and whose other
 *      says a second is a lie. Either all are rewritten, or none is.
 *   2. The length does not change. An ISO 6709 string can be written with more
 *      or fewer decimals, so the number of decimals is chosen to land on the
 *      exact length of the original. No byte moves, so no offset in the file
 *      becomes wrong.
 *   3. Refuse rather than lie. An action camera records the location
 *      continuously, frame by frame, in the data track. We can read that and we
 *      cannot remove it. Erasing the one visible copy would hand back a file
 *      the user believes is clean and which is not, so the original is returned
 *      intact and the reason is given.
 */

import { ExifError } from './erreurs.ts';
import { type LatLon, distanceMetres, validerPosition } from './coords.ts';
import { type Plage, type Pose } from './conteneurs.ts';
import { lireLieuXmp, porteUnLieu, purgerLeLieu } from './xmp.ts';
import {
  type Boite,
  boites,
  charge,
  chemin,
  contientDesBoites,
  enfants,
  finDe,
  texte,
  toutesLesBoites,
} from './bmff.ts';
import { lireEntierBE, readU16, readU32, writeU32 } from './octets.ts';

// The ISO 6709 string

/**
 * A position as a video writes it: mandatory sign, fixed width, trailing slash.
 *
 * All three widths in the standard occur: `+43.9493` is degrees, `+4356.958`
 * degrees and minutes, `+435657.5` degrees, minutes and seconds. The number of
 * digits before the point is the only clue, hence reading in groups of two
 * rather than a naive `Number()`, which would yield "4356.958 degrees" and so a
 * position that is invalid, or worse, valid and wrong.
 *
 * What follows the coordinates is not a coordinate: the trailing slash, and the
 * optional coordinate reference system name (`CRSWGS_84`) the standard allows
 * and some devices write. It is kept verbatim so it can be rewritten untouched,
 * like the altitude, but it is not parsed. Requiring it to be absent made the
 * location invisible on those files.
 *
 * The canonical width, two degree digits for latitude and three for longitude,
 * is not required either. Tools write `+4.86387` where the standard asks for
 * `+004.86387`, and phone readers read them: refusing would have silenced the
 * tool on a file everyone else understands.
 */
const ISO6709 =
  /^([+-])(\d{1,7}(?:\.\d+)?)([+-])(\d{1,8}(?:\.\d+)?)((?:[+-]\d+(?:\.\d+)?)?)((?:\/[A-Za-z][\w.+-]*)?\/?)$/;

/**
 * Strips what is not part of the string: whitespace, and above all control
 * bytes.
 *
 * Plenty of tools terminate the string with a NUL byte, C style, and count that
 * zero in the length they declare. `trim()` only removes whitespace: the zero
 * survived, the regular expression failed, and the file appeared to have no
 * location while every other reader showed one.
 */
const nettoyerChaine = (s: string) =>
  s.replace(/^[\s\u0000-\u001f\u007f]+|[\s\u0000-\u001f\u007f]+$/g, '');

function sexagesimal(chiffres: string, largeurDegres: number): number | null {
  const point = chiffres.indexOf('.');
  const entiers = point < 0 ? chiffres.length : point;
  const supplement = entiers - largeurDegres;
  /*
   * Fewer digits than the canonical width means degrees, and nothing else. Two
   * minute digits would not fit in what is missing, so there is no ambiguity to
   * resolve, which is the whole subject of this function. `+4.86387` is 4.86387
   * degrees, as other tools read it.
   */
  if (supplement < 0) {
    const v = Number(chiffres);
    return Number.isFinite(v) ? v : null;
  }
  // 0: degrees only. 2: degrees and minutes. 4: degrees, minutes and seconds.
  if (supplement !== 0 && supplement !== 2 && supplement !== 4) return null;
  const degres = Number(chiffres.slice(0, largeurDegres));
  const reste = chiffres.slice(largeurDegres);
  if (!Number.isFinite(degres)) return null;
  if (supplement === 0) return degres + (reste ? Number(`0${reste}`) : 0);
  const minutes = Number(reste.slice(0, 2) + (supplement === 2 ? reste.slice(2) : ''));
  if (supplement === 2) return degres + minutes / 60;
  const secondes = Number(reste.slice(2));
  return degres + Number(reste.slice(0, 2)) / 60 + secondes / 3600;
}

/** Decodes a video position string. Returns null rather than guess. */
export function lireIso6709(s: string): LatLon | null {
  const m = ISO6709.exec(nettoyerChaine(s));
  if (!m) return null;
  const lat = sexagesimal(m[2], 2);
  const lon = sexagesimal(m[4], 3);
  if (lat === null || lon === null) return null;
  return validerPosition({
    lat: m[1] === '-' ? -lat : lat,
    lon: m[3] === '-' ? -lon : lon,
  });
}

/**
 * What the string carries beside the coordinates, and must be returned intact.
 *
 * The altitude first: rewriting it would invent a height nobody measured. Then
 * the tail: the trailing slash, the coordinate reference system name if there
 * is one, and any control bytes the original tool left. All of it counts
 * towards the declared length, so all of it must come back identical, or a byte
 * moves.
 */
function formeDe(s: string): { altitude: string; queue: string } {
  const propre = nettoyerChaine(s);
  const m = ISO6709.exec(propre);
  if (!m) return { altitude: '', queue: '/' };
  // What `nettoyerChaine` stripped from the end belongs to the tail: it counts
  // in the slot's length, and returning it changes its size.
  const rogne = s.slice(s.indexOf(propre) + propre.length);
  return { altitude: m[5], queue: m[6] + rogne };
}

/** The number of decimals that places both coordinates to the metre. */
const DECIMALES_AU_METRE = 12;

/**
 * Writes a position at an imposed length.
 *
 * The simple form is `10 + a + b` characters: sign, two digits, point and `a`
 * decimals for latitude; sign, three digits, point and `b` decimals for
 * longitude; the trailing slash. Choosing `a + b` therefore gives any length
 * from twelve upwards, and every string a real device writes is longer.
 *
 * `queue` replaces that trailing slash when the file wrote more: a coordinate
 * reference system name, a terminating NUL byte. It is returned verbatim; we do
 * not always understand what it says, which is no reason to erase it.
 *
 * Returns null when the requested length cannot be met exactly. Approximating
 * would be the one place in this module where a location nobody asked for gets
 * written.
 */
export function ecrireIso6709(
  p: LatLon,
  longueur: number,
  altitude = '',
  queue = '/',
): string | null {
  const decimales = longueur - 9 - queue.length - altitude.length;
  // Nine decimals is less than a tenth of a millimetre: beyond that, the
  // precision shown would be pure invention.
  if (decimales < 2 || decimales > 18) return null;
  const a = Math.min(9, Math.ceil(decimales / 2));
  const b = decimales - a;
  if (b < 1 || b > 9) return null;
  const signe = (v: number) => (v < 0 ? '-' : '+');
  const bloc = (v: number, entiers: number, d: number) =>
    signe(v) + Math.abs(v).toFixed(d).padStart(entiers + 1 + d, '0');
  const s = `${bloc(p.lat, 2, a)}${bloc(p.lon, 3, b)}${altitude}${queue}`;
  return s.length === longueur ? s : null;
}

// The storage slots

/**
 * A place in the file that carries a copy of the location.
 *
 * `debutTexte`/`longueurTexte` address the string alone, in file coordinates:
 * that is what gets rewritten. `boite` addresses the whole envelope, which is
 * what gets neutralised on erase.
 */
export interface Porteur {
  sorte: 'xyz-udta' | 'xyz-ilst' | 'keys' | 'loci';
  boite: Boite;
  debutTexte: number;
  longueurTexte: number;
  texte: string;
  /** Binary coordinates of a `loci`, fixed point, with no string. */
  binaire?: { lon: number; lat: number };
  /** The place name in words, when the slot carries one. */
  nomDeLieu: { debut: number; longueur: number } | null;
}

/** The four-letter names the text slots use for the location. */
const TYPES_XYZ = ['©xyz', '@xyz'];

const CLE_APPLE = 'com.apple.quicktime.location.ISO6709';
const CLE_APPLE_NOM = 'com.apple.quicktime.location.name';

/**
 * `moov/udta/©xyz` and its Samsung cousin `@xyz`.
 *
 * Layout: the eight-byte header, the string length in two bytes, a two-byte
 * language code, then the string.
 */
/**
 * The string of a `udta` text atom, and where it sits.
 *
 * This layout serves the location as it serves the rest: `©mak`, `©mod` and
 * `©ART` share it with `©xyz`. It is therefore read in one place, since what
 * distinguishes these atoms is their name, never their shape.
 */
function chaineDAtome(b: Uint8Array, x: Boite): { debut: number; longueur: number } | null {
  const debut = charge(x);
  if (debut + 4 > finDe(x)) return null;
  const longueur = readU16(b, debut, 'BE');
  if (longueur < 1 || debut + 4 + longueur > finDe(x)) return null;
  return { debut: debut + 4, longueur };
}

function porteursUdta(b: Uint8Array, udta: Boite | null): Porteur[] {
  if (!udta) return [];
  const out: Porteur[] = [];
  for (const x of enfants(b, udta)) {
    if (!TYPES_XYZ.includes(x.type)) continue;
    const c = chaineDAtome(b, x);
    if (!c) continue;
    out.push({
      sorte: 'xyz-udta',
      boite: x,
      debutTexte: c.debut,
      longueurTexte: c.longueur,
      texte: texte(b, c.debut, c.longueur),
      nomDeLieu: null,
    });
  }
  return out;
}

/**
 * `moov/udta/loci`, the 3GPP slot, and the only one that writes the place name
 * in words next to the coordinates.
 *
 * Layout: version and flags (4), language (2), the NUL-terminated place name,
 * the role (1), then longitude, latitude and altitude as 16.16 fixed point,
 * four bytes each.
 *
 * This is the "Avignon" case: a file with no coordinates left that still names
 * the town is not erased.
 */
function porteurLoci(b: Uint8Array, udta: Boite | null): Porteur[] {
  if (!udta) return [];
  const out: Porteur[] = [];
  for (const x of enfants(b, udta)) {
    if (x.type !== 'loci') continue;
    const fin = finDe(x);
    let o = charge(x) + 6;
    const debutNom = o;
    while (o < fin && b[o] !== 0) o++;
    if (o >= fin) continue;
    const longueurNom = o - debutNom;
    o += 1 + 1; // le zéro final, puis le rôle
    if (o + 8 > fin) continue;
    const fixe = (p: number) => (readU32(b, p, 'BE') | 0) / 65536;
    out.push({
      sorte: 'loci',
      boite: x,
      debutTexte: o,
      longueurTexte: 8,
      texte: '',
      binaire: { lon: fixe(o), lat: fixe(o + 4) },
      nomDeLieu: longueurNom > 0 ? { debut: debutNom, longueur: longueurNom } : null,
    });
  }
  return out;
}

/**
 * The item lists: `moov/udta/meta/ilst`, written by Google Photos, and Apple's
 * `moov/meta`, whose entries are numbered and whose names live in a separate
 * `keys` box.
 *
 * In both cases the value is in a `data` box: four bytes of type, four of
 * language, then the payload.
 */
/**
 * The payload of a list entry: it lives in a `data` box, preceded by four bytes
 * of type and four of language.
 */
function valeurDeLEntree(
  b: Uint8Array,
  entree: Boite,
): { debut: number; longueur: number } | null {
  const data = enfants(b, entree).find((d) => d.type === 'data');
  if (!data) return null;
  const debut = charge(data) + 8;
  const longueur = finDe(data) - debut;
  return longueur > 0 ? { debut, longueur } : null;
}

/**
 * Apple's named keys, paired with their values.
 *
 * `keys` holds the names in order, `ilst` holds the numbered values: the link
 * between them is the rank, and that is the only subtlety of the slot. It is
 * written once here, so the location reader and the information reader cannot
 * read it two different ways.
 */
function entreesDesKeys(
  b: Uint8Array,
  racine: Boite[],
): Array<{ nom: string; entree: Boite; valeur: { debut: number; longueur: number } }> {
  const out: Array<{ nom: string; entree: Boite; valeur: { debut: number; longueur: number } }> = [];
  // Every `meta` in the file, not just `moov/meta`. A name/value pair is a pair
  // wherever it is attached.
  for (const meta of toutesLesBoites(b, 'meta', racine)) {
    const filles = enfants(b, meta);
    const keys = filles.find((x) => x.type === 'keys');
    const ilst = filles.find((x) => x.type === 'ilst');
    if (!keys || !ilst) continue;

    const parIndex = new Map<number, Boite>();
    for (const entree of enfants(b, ilst)) {
      parIndex.set(readU32(b, entree.debut + 4, 'BE'), entree);
    }
    for (const [i, nom] of listerKeys(b, keys).entries()) {
      const entree = parIndex.get(i + 1);
      if (!entree) continue;
      const valeur = valeurDeLEntree(b, entree);
      if (valeur) out.push({ nom, entree, valeur });
    }
  }
  return out;
}

function porteursIlst(b: Uint8Array, racine: Boite[]): Porteur[] {
  const out: Porteur[] = [];
  const valeurDe = (entree: Boite) => valeurDeLEntree(b, entree);

  // Four-letter key, what Google Photos writes. In every `ilst`: the one under
  // `moov/udta/meta` is the most common, but a file may hang its own off
  // `moov/meta`, and the location reads just as well there.
  for (const ilst of toutesLesBoites(b, 'ilst', racine)) {
    for (const entree of enfants(b, ilst)) {
      if (!TYPES_XYZ.includes(entree.type)) continue;
      const v = valeurDe(entree);
      if (!v) continue;
      out.push({
        sorte: 'xyz-ilst',
        boite: entree,
        debutTexte: v.debut,
        longueurTexte: v.longueur,
        texte: texte(b, v.debut, v.longueur),
        nomDeLieu: null,
      });
    }
  }

  // Apple: `keys` names, `ilst` numbers. The pairing lives in `entreesDesKeys`,
  // which also serves reading the file's information.
  for (const { nom, entree, valeur: v } of entreesDesKeys(b, racine)) {
    if (nom === CLE_APPLE) {
      out.push({
        sorte: 'keys',
        boite: entree,
        debutTexte: v.debut,
        longueurTexte: v.longueur,
        texte: texte(b, v.debut, v.longueur),
        nomDeLieu: null,
      });
    } else if (nom === CLE_APPLE_NOM) {
      // No coordinates here, only the place name in words. It has nothing to
      // contribute on read, but it must disappear on erase.
      out.push({
        sorte: 'keys',
        boite: entree,
        debutTexte: v.debut,
        longueurTexte: 0,
        texte: '',
        nomDeLieu: v,
      });
    }
  }
  return out;
}

/** The key names, in order: their rank is what links them to the values. */
function listerKeys(b: Uint8Array, keys: Boite): string[] {
  const out: string[] = [];
  const fin = finDe(keys);
  let o = charge(keys) + 8; // version et drapeaux, puis le compte
  while (o + 8 <= fin) {
    const taille = readU32(b, o, 'BE');
    if (taille < 8 || o + taille > fin) break;
    out.push(texte(b, o + 8, taille - 8));
    o += taille;
  }
  return out;
}

/** Every copy of the location this file carries, whoever wrote it. */
export function porteursDeLieu(b: Uint8Array): Porteur[] {
  const racine = boites(b, 0, b.length);
  // Every `udta`, not just `moov/udta`: a track can have its own, and a file
  // can carry several. A slot counts wherever it is.
  const udtas = toutesLesBoites(b, 'udta', racine);
  return [
    ...udtas.flatMap((u) => porteursUdta(b, u)),
    ...udtas.flatMap((u) => porteurLoci(b, u)),
    ...porteursIlst(b, racine),
  ];
}

// What the video says about itself

/**
 * The displayable information of a video.
 *
 * The details panel depended entirely on the second reader, written by somebody
 * else, and it opens neither MOV nor MP4. Four of its five sources were dead
 * for a video: it had nothing to say, and the panel disappeared. What follows
 * looks for what the file actually carries, in the boxes this module already
 * knows how to walk.
 *
 * One rule, the engine's throughout: no line is invented. A field that is
 * absent, empty, or a date of zero, which is what test files and re-encoded
 * videos amount to, produces nothing at all. A short panel beats one that
 * asserts.
 */
export interface InfosVideo {
  takenAt: string | null;
  camera: string | null;
  details: Array<{ cle: string; value: string }>;
}

/** Seconds between the start of the QuickTime calendar and Unix's. */
const EPOQUE_QUICKTIME = Date.UTC(1904, 0, 1) / 1000;

/** 16.16 fixed point, as both `tkhd` and `loci` write it. */
const virguleFixe = (b: Uint8Array, o: number) => (readU32(b, o, 'BE') | 0) / 65536;

/** `h:mm:ss` or `m:ss`. Digits, not words: the worker has no dictionary. */
function duree(secondes: number): string {
  const t = Math.round(secondes);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const deux = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${deux(m)}:${deux(s)}` : `${m}:${deux(s)}`;
}

/**
 * True if this text can be displayed as it stands.
 *
 * `udta` atoms are written in a character set nothing declares, and older files
 * use the Macintosh one. We do not have the table that converts it, and showing
 * it byte for byte would produce gibberish. A field we cannot read is not
 * displayed, the same rule the rest of the engine follows, applied to text.
 */
function affichable(s: string): boolean {
  for (const c of s) {
    const n = c.codePointAt(0)!;
    if (n < 0x20 || (n >= 0x7f && n <= 0x9f)) return false;
  }
  return s.length > 0;
}

/**
 * The `udta` text atoms, by name.
 *
 * Two layouts occur and both are needed: the QuickTime form (two-byte length,
 * language, string) and the `data` box form that iTunes-derived tools use.
 * `©day` is written sometimes in one, sometimes in the other.
 */
function textesDUdta(b: Uint8Array, racine: Boite[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const udta of toutesLesBoites(b, 'udta', racine)) {
  for (const x of enfants(b, udta)) {
    const c = chaineDAtome(b, x) ?? valeurDeLEntree(b, x);
    if (!c) continue;
    const valeur = texte(b, c.debut, c.longueur).replace(/\0+$/, '').trim();
    // First found wins: the movie's beats a track's.
    if (affichable(valeur) && !out.has(x.type)) out.set(x.type, valeur);
  }
  }
  return out;
}

export function infosVideo(b: Uint8Array): InfosVideo {
  const details: InfosVideo['details'] = [];
  let takenAt: string | null = null;
  let camera: string | null = null;

  const racine = boites(b, 0, b.length);
  const moov = racine.find((x) => x.type === 'moov');
  if (!moov) return { takenAt, camera, details };

  const cles = new Map(entreesDesKeys(b, racine).map((e) => [
    e.nom,
    texte(b, e.valeur.debut, e.valeur.longueur).trim(),
  ]));
  const atomes = textesDUdta(b, racine);
  const premier = (...candidats: (string | undefined)[]) =>
    candidats.find((v) => v && v.trim()) ?? null;

  // The device. Apple names it by key, the others by text atom.
  const marque = premier(cles.get('com.apple.quicktime.make'), atomes.get('©mak'));
  const modele = premier(cles.get('com.apple.quicktime.model'), atomes.get('©mod'));
  camera = [marque, modele].filter(Boolean).join(' ') || null;

  // The date. The one a device wrote beats the container's: the second is
  // sometimes the re-encoding time, and often zero.
  const datee = premier(cles.get('com.apple.quicktime.creationdate'), atomes.get('©day'));
  if (datee) takenAt = datee;

  const mvhd = enfants(b, moov).find((x) => x.type === 'mvhd');
  if (mvhd) {
    const v = b[charge(mvhd)];
    const o = charge(mvhd) + 4;
    const large = v === 1;
    const creee = large ? lireEntierBE(b, o + 8, 8) : readU32(b, o, 'BE');
    const echelle = readU32(b, o + (large ? 16 : 8), 'BE');
    const total = large ? lireEntierBE(b, o + 20, 8) : readU32(b, o + 12, 'BE');

    /*
     * A container date is only credible if it is plausible.
     *
     * Zero is not 1 January 1904, it is an absent date, and many tools write
     * instead the value that lands exactly on 1 January 1970, which is filler
     * just the same. The QuickTime format dates from 1991: nothing earlier can
     * be a capture time. So we abstain rather than show a date nobody lived.
     */
    if (!takenAt && creee > 0) {
      const quand = new Date((creee + EPOQUE_QUICKTIME) * 1000);
      if (!Number.isNaN(quand.valueOf()) && quand.getUTCFullYear() >= 1990) {
        takenAt = quand.toISOString();
      }
    }
    if (echelle > 0 && total > 0) {
      details.push({ cle: 'Duree', value: duree(total / echelle) });
    }
  }

  // Dimensions: those of the first track that declares any. The first track
  // outright may be the audio, which has none.
  for (const trak of enfants(b, moov).filter((x) => x.type === 'trak')) {
    const tkhd = enfants(b, trak).find((x) => x.type === 'tkhd');
    if (!tkhd) continue;
    const fin = finDe(tkhd);
    const l = virguleFixe(b, fin - 8);
    const h = virguleFixe(b, fin - 4);
    if (l >= 1 && h >= 1) {
      details.push({ cle: 'Dimensions', value: `${Math.round(l)} × ${Math.round(h)}` });
      break;
    }
  }

  const logiciel = premier(cles.get('com.apple.quicktime.software'), atomes.get('©swr'));
  if (logiciel) details.push({ cle: 'Software', value: logiciel });
  const auteur = premier(cles.get('com.apple.quicktime.author'), atomes.get('©ART'));
  if (auteur) details.push({ cle: 'Artist', value: auteur });

  /*
   * A location we found without being able to read it.
   *
   * This is the most important line in the function, and it comes from a bug
   * that cost five round trips: two common spellings escaped the reader, and
   * the tool then displayed nothing at all, no badge and no location line, even
   * though it knew exactly where the field was and what it contained. Phone
   * tools showed it.
   *
   * Staying silent when we do not understand is the worst choice: it makes the
   * disagreement invisible. The string is therefore shown exactly as written,
   * and a screenshot is now enough to name the spelling we are missing.
   *
   * One line, and only in this case: when the position decodes, the location
   * line already exists and repeating the string would be noise.
   */
  const illisible = porteursDeLieu(b)
    .map((porteur) => nettoyerChaine(porteur.texte))
    .find((brut) => brut !== '' && lireIso6709(brut) === null);
  if (illisible) details.push({ cle: 'LieuBrut', value: illisible });

  return { takenAt, camera, details };
}

// A location that moves, which we cannot remove

/**
 * Track descriptions that signal a location recorded continuously.
 *
 * `gpmd` is GoPro's format, `camm` Google's, `mett` and `rtmd` several
 * manufacturers'. The samples live in the data track, which this engine never
 * rewrites: that is what allows working on a multi-megabyte file without
 * decoding it, and it is also what puts removing them out of reach.
 */
const PISTES_DE_LIEU = ['gpmd', 'camm', 'mett', 'rtmd', 'gps ', 'CAMM'];

/** `udta` boxes carrying a continuous recording we do not read. */
const CHARGES_OPAQUES = ['GPMF'];

/**
 * True if this file keeps the location somewhere we cannot clean.
 *
 * This is the question that decides everything: it closes writing and erasing
 * alike, because correcting the visible copy while leaving the track intact
 * would produce a file that displays one location and reveals another.
 */
export function lieuEnMouvement(b: Uint8Array): boolean {
  const racine = boites(b, 0, b.length);
  for (const stsd of toutesLesBoites(b, 'stsd', racine)) {
    for (const description of enfants(b, stsd)) {
      if (PISTES_DE_LIEU.includes(description.type)) return true;
    }
  }
  for (const udta of toutesLesBoites(b, 'udta', racine)) {
    if (enfants(b, udta).some((x) => CHARGES_OPAQUES.includes(x.type))) return true;
  }
  return false;
}

// Reading

/** The location a slot carries, whatever its form. */
function positionDe(p: Porteur): LatLon | null {
  return p.binaire
    ? validerPosition({ lat: p.binaire.lat, lon: p.binaire.lon })
    : lireIso6709(p.texte);
}

/**
 * The location of a video: that of the first slot carrying one.
 *
 * And failing that, the descriptive text packet. It comes last because we
 * cannot rewrite it, but ignoring it left the tool saying "no location" on a
 * file every other reader shows a location for.
 */
export function lirePositionVideo(b: Uint8Array): LatLon | null {
  for (const p of porteursDeLieu(b)) {
    const position = positionDe(p);
    if (position) return position;
  }
  for (const paquet of paquetsDeTexte(b)) {
    const p = lireLieuXmp(lireTexte(b, paquet));
    if (p) {
      const valide = validerPosition(p);
      if (valide) return valide;
    }
  }
  return null;
}

// The file's absolute offsets

interface TableDeDecalages {
  /** File position of each entry, and its width. */
  entrees: { pos: number; largeur: number; valeur: number }[];
}

/**
 * Every entry that addresses a byte of the file by its absolute rank.
 *
 * These are the `stco` (32-bit) and `co64` (64-bit) tables: they say where each
 * chunk of picture and sound begins. Nothing else in an unfragmented file
 * carries an absolute offset, which is what makes adding possible, and what
 * would make it dangerous if they were forgotten.
 */
function tableDeDecalages(b: Uint8Array, racine: Boite[]): TableDeDecalages {
  const entrees: TableDeDecalages['entrees'] = [];
  for (const largeur of [4, 8] as const) {
    for (const table of toutesLesBoites(b, largeur === 4 ? 'stco' : 'co64', racine)) {
      const debut = charge(table);
      if (debut + 8 > finDe(table)) continue;
      const compte = readU32(b, debut + 4, 'BE');
      for (let i = 0; i < compte; i++) {
        const pos = debut + 8 + i * largeur;
        if (pos + largeur > finDe(table)) break;
        const valeur = largeur === 4
          ? readU32(b, pos, 'BE')
          : readU32(b, pos, 'BE') * 4294967296 + readU32(b, pos + 4, 'BE');
        entrees.push({ pos, largeur, valeur });
      }
    }
  }
  return { entrees };
}

/**
 * True if this file tolerates its description growing.
 *
 * Two refusals, different in kind:
 *
 *   - A fragmented file keeps absolute offsets in places this module does not
 *     rewrite. It is left alone.
 *   - An offset pointing past the end of the file signals a description we have
 *     not understood. Correcting it would stack one guess on another.
 *
 * A file with no entries at all passes: there is nothing to correct.
 */
export function accepteAjoutVideo(b: Uint8Array): boolean {
  const racine = boites(b, 0, b.length);
  const moov = racine.find((x) => x.type === 'moov');
  if (!moov) return false;
  if (racine.some((x) => x.type === 'moof' || x.type === 'sidx' || x.type === 'mfra')) {
    return false;
  }
  // A box extending to the end of the file would swallow anything appended
  // behind it.
  if (racine.some((x) => x.declaree === 0 && finDe(x) === b.length)) return false;
  // The boxes whose size we increase must carry it in four bytes. A 64-bit
  // size is written elsewhere, the first four bytes then holding only a marker,
  // and increasing it here would overwrite the marker instead of the size. That
  // is rare enough on a `moov` that no witness file exists, so we refuse.
  const aResizer = [moov, ...enfants(b, moov).filter((x) => x.type === 'udta')];
  if (aResizer.some((x) => x.entete !== 8)) return false;
  const { entrees } = tableDeDecalages(b, racine);
  return entrees.every((e) => e.valeur > 0 && e.valeur < b.length);
}

// Writing

const REFUS_MOUVEMENT = () =>
  new ExifError(
    'LIEU_EN_MOUVEMENT',
    "Cette vidéo enregistre le lieu tout au long de son déroulement, et pas seulement une fois. Nous ne savons pas encore le retirer partout : votre fichier vous est rendu tel quel.",
  );

const REFUS_ECRITURE = () =>
  new ExifError(
    'VIDEO_NON_MODIFIABLE',
    "Cette vidéo range son lieu d'une façon que nous ne savons pas réécrire sans risquer de l'abîmer. Elle n'a pas été touchée.",
  );

/**
 * The length of a string we write ourselves: `+DD.dddddd+DDD.dddddd/`.
 *
 * Six decimals is eleven centimetres, deliberately finer than the one-metre
 * tolerance of the final check: a write should not pass narrowly, it should
 * pass comfortably.
 */
const LONGUEUR_NEUVE = 10 + DECIMALES_AU_METRE;

/**
 * The distance beyond which an in-place rewrite is no longer acceptable.
 *
 * The number of decimals is imposed by the length of the original string, and a
 * short string cannot say everything: `+43.9493+004.8055/` has only four
 * decimals, an eleven-metre grid. On a location that lands exactly the rewrite
 * is exact; on another it would record a neighbour of what was asked for. So we
 * measure what we just wrote and change route rather than record an
 * approximation.
 */
const ECART_TOLERE_METRES = 0.5;

/**
 * Rewrites every copy of the location without moving a single byte.
 *
 * All or nothing: the replacements for every slot are computed first, and
 * nothing is written until all of them are achievable. A half-corrected file
 * would carry two different locations.
 */
function corrigerSurPlace(b: Uint8Array, porteurs: Porteur[], p: LatLon): Pose | null {
  const remplacements: { debut: number; octets: Uint8Array }[] = [];

  for (const porteur of porteurs) {
    if (porteur.binaire) {
      // A `loci` still naming the old town would lie, and emptying it would
      // shorten the box.
      if (porteur.nomDeLieu) return null;
      const octets = new Uint8Array(8);
      const fixe = (v: number) => Math.round(v * 65536) | 0;
      writeU32(octets, 0, fixe(p.lon) >>> 0, 'BE');
      writeU32(octets, 4, fixe(p.lat) >>> 0, 'BE');
      // The same requirement as for text, and it is not theoretical: 16.16
      // fixed point advances in steps of one sixty-five-thousandth of a degree,
      // one metre seven in latitude. The grid step is therefore wider than the
      // final check's tolerance, and this slot cannot carry any location.
      const relu = validerPosition({ lat: fixe(p.lat) / 65536, lon: fixe(p.lon) / 65536 });
      if (!relu || distanceMetres(relu, p) > ECART_TOLERE_METRES) return null;
      remplacements.push({ debut: porteur.debutTexte, octets });
      continue;
    }
    // An entry carrying only a place name cannot receive coordinates: there is
    // no room, and emptying it would shorten the box. The correction is refused
    // rather than leave the name in place.
    if (porteur.longueurTexte === 0) return null;
    const { altitude, queue } = formeDe(porteur.texte);
    const s = ecrireIso6709(p, porteur.longueurTexte, altitude, queue);
    if (s === null) return null;
    // We read back what we just wrote. The original length imposes the number
    // of decimals, and too short a string cannot carry the requested location:
    // better to change route than record its neighbour.
    const relu = lireIso6709(s);
    if (!relu || distanceMetres(relu, p) > ECART_TOLERE_METRES) return null;
    remplacements.push({
      debut: porteur.debutTexte,
      octets: Uint8Array.from(s, (c) => c.charCodeAt(0)),
    });
  }

  const out = b.slice();
  const changed: Plage[] = [];
  for (const r of remplacements) {
    out.set(r.octets, r.debut);
    changed.push([r.debut, r.debut + r.octets.length]);
  }
  return { bytes: out, changed };
}

/**
 * Creates a location where the file carried none.
 *
 * The new slot goes into `moov/udta`, the one every reader understands. The
 * file grows, so everything after the insertion point shifts, hence the pass
 * over the tables that address a byte by its rank. That is exactly the work
 * adding to a HEIC avoids by writing at the end of the file; a video does not
 * allow it, because the location has to live inside the track description.
 */
function ajouterLeLieu(b: Uint8Array, p: LatLon, aNeutraliser: Porteur[] = []): Pose {
  const racine = boites(b, 0, b.length);
  const moov = racine.find((x) => x.type === 'moov');
  if (!moov) throw REFUS_ECRITURE();

  const s = ecrireIso6709(p, LONGUEUR_NEUVE);
  if (s === null) throw REFUS_ECRITURE();
  const chaine = Uint8Array.from(s, (c) => c.charCodeAt(0));

  // The `©xyz` box: header, string length, language code, string. 0x15c7 is the
  // "undetermined" language code, the one real devices write.
  const xyz = new Uint8Array(12 + chaine.length);
  writeU32(xyz, 0, xyz.length, 'BE');
  xyz.set([0xa9, 0x78, 0x79, 0x7a], 4);
  xyz[8] = 0;
  xyz[9] = chaine.length;
  xyz[10] = 0x15;
  xyz[11] = 0xc7;
  xyz.set(chaine, 12);

  const udta = enfants(b, moov).find((x) => x.type === 'udta') ?? null;
  // Insertion goes at the end of `udta` when it exists, and at the end of
  // `moov` otherwise: either way no sibling box changes place inside its parent.
  const insertions: Insertion[] = [
    udta
      ? { a: finDe(udta), octets: xyz, dans: [udta, moov] }
      : { a: finDe(moov), octets: nouvelleUdta(xyz), dans: [moov] },
  ];

  // The second copy, the one Apple software reads. See `metaApple` for what
  // bounds it.
  const apple = metaApple(b, moov, racine, s);
  if (apple) insertions.push({ a: finDe(moov), octets: apple, dans: [moov] });

  const { out, deplacer } = inserer(b, insertions);

  // The old slots go before the new one is used: leaving a copy we could not
  // rewrite would have the same file state two locations. They all sit before
  // the insertion points, so their positions stay valid.
  const changed: Plage[] = [];
  for (const porteur of aNeutraliser) neutraliser(out, porteur.boite, changed);

  /*
   * Parents grow by what was inserted inside them, and each insertion states
   * which box it goes into rather than leaving it to be inferred from position.
   *
   * Geometric inference is wrong in a perfectly ordinary case: when `udta` is
   * the last box in `moov`, both end at the same byte, and nothing in the
   * position distinguishes "inside udta" from "after udta, inside moov". `udta`
   * then swallowed Apple's slot, which became invisible to everyone, us
   * included.
   */
  for (const parent of udta ? [udta, moov] : [moov]) {
    const ajoute = insertions
      .filter((i) => i.dans.includes(parent))
      .reduce((n, i) => n + i.octets.length, 0);
    if (!ajoute) continue;
    writeU32(out, deplacer(parent.debut), parent.taille + ajoute, 'BE');
    changed.push([deplacer(parent.debut), deplacer(parent.debut) + 4]);
  }

  // And the absolute offsets, one by one. Each advances by whatever was
  // inserted before the byte it addresses, and no more.
  for (const e of tableDeDecalages(b, racine).entrees) {
    const v = deplacer(e.valeur);
    if (v === e.valeur) continue;
    const pos = deplacer(e.pos);
    if (e.largeur === 4) writeU32(out, pos, v, 'BE');
    else {
      writeU32(out, pos, Math.floor(v / 4294967296), 'BE');
      writeU32(out, pos + 4, v >>> 0, 'BE');
    }
    changed.push([pos, pos + e.largeur]);
  }

  changed.push([Math.min(...insertions.map((i) => i.a)), out.length]);
  return { bytes: out, changed };
}

/** A block of bytes to slip in before byte `a` of the original file. */
interface Insertion {
  a: number;
  octets: Uint8Array;
  /** The boxes whose size must grow by as much. Stated, never guessed. */
  dans: Boite[];
}

/**
 * Inserts several blocks at once, and returns enough to translate positions.
 *
 * One insertion point was enough while there was only one slot to write. There
 * have been two since the location is also written Apple's way, and they are
 * not in the same place: hence this generalisation, rather than two passes
 * whose second would work on positions already wrong.
 */
function inserer(
  b: Uint8Array,
  insertions: Insertion[],
): { out: Uint8Array; deplacer: (o: number) => number } {
  const tri = [...insertions].sort((x, y) => x.a - y.a);
  const total = tri.reduce((n, i) => n + i.octets.length, 0);
  const out = new Uint8Array(b.length + total);
  let lu = 0;
  let ecrit = 0;
  for (const i of tri) {
    out.set(b.subarray(lu, i.a), ecrit);
    ecrit += i.a - lu;
    lu = i.a;
    out.set(i.octets, ecrit);
    ecrit += i.octets.length;
  }
  out.set(b.subarray(lu), ecrit);

  // An original byte advances by everything slipped in before it. On a tie, an
  // insertion exactly at its position, the block goes first, so it counts.
  const deplacer = (o: number) =>
    o + tri.filter((i) => i.a <= o).reduce((n, i) => n + i.octets.length, 0);
  return { out, deplacer };
}

/** Any box: an eight-byte header, then the payload. */
function boite(type: string, ...morceaux: Uint8Array[]): Uint8Array {
  const charge = morceaux.reduce((n, m) => n + m.length, 0);
  const out = new Uint8Array(8 + charge);
  writeU32(out, 0, out.length, 'BE');
  out.set(Uint8Array.from(type, (c) => c.charCodeAt(0)), 4);
  let o = 8;
  for (const m of morceaux) { out.set(m, o); o += m.length; }
  return out;
}

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/**
 * The second copy of the location, the one Apple software reads.
 *
 * `moov/udta/©xyz` is what Android, FFmpeg, VLC and MediaInfo read; it is by
 * far the most widespread slot and the one devices write. Apple software reads
 * only the named key `com.apple.quicktime.location.ISO6709`, in a `moov/meta`
 * where names live in `keys` and values in `ilst`, paired by rank.
 *
 * Two limits, both deliberate:
 *
 *   - Only when `moov/meta` does not exist yet. If it does, both `keys` and
 *     `ilst` would have to grow in two separate places and be renumbered. No
 *     file in the corpus has that shape, so nothing would test it: the location
 *     then goes into the single simple slot, which stays true and readable
 *     everywhere.
 *   - Only on the MP4 family. A true QuickTime writes its `meta` without the
 *     four version bytes and an MP4 with them, and the second is what an Apple
 *     device produces. Rather than guess inside a file whose shape is already
 *     unusual we abstain; `©xyz` is QuickTime's native slot anyway.
 */
function metaApple(
  b: Uint8Array,
  moov: Boite,
  racine: Boite[],
  iso: string,
): Uint8Array | null {
  if (enfants(b, moov).some((x) => x.type === 'meta')) return null;
  const ftyp = racine.find((x) => x.type === 'ftyp');
  if (!ftyp || texte(b, charge(ftyp), 4) === 'qt  ') return null;

  const versionEtDrapeaux = new Uint8Array(4);

  // `hdlr` announces that this `meta`'s names are named keys: "mdta".
  const hdlr = boite(
    'hdlr',
    versionEtDrapeaux, new Uint8Array(4), ascii('mdta'), new Uint8Array(12 + 1),
  );

  // `keys`: the count, then one entry per name.
  const nom = boite('mdta', ascii(CLE_APPLE));
  const compte = new Uint8Array(4);
  writeU32(compte, 0, 1, 'BE');
  const keys = boite('keys', versionEtDrapeaux, compte, nom.subarray(0));

  // `ilst`: an entry whose type is the key's rank, carrying a `data` box. The
  // payload type is 1, meaning text.
  const enTete = new Uint8Array(8);
  writeU32(enTete, 0, 1, 'BE'); // type de charge : texte
  writeU32(enTete, 4, 0, 'BE'); // langue
  const data = boite('data', enTete, ascii(iso));
  const entree = new Uint8Array(8 + data.length);
  writeU32(entree, 0, entree.length, 'BE');
  writeU32(entree, 4, 1, 'BE'); // le RANG de la clé, et non quatre lettres
  entree.set(data, 8);
  const ilst = boite('ilst', entree);

  /*
   * `meta` is written here without the four version and flag bytes.
   *
   * The ISO standard makes it a FullBox, which would carry them. But this slot
   * exists only to be read by Apple software, so the question is not what the
   * standard says, it is what they read. Measured, with both forms written into
   * the same file and given to the independent oracle: the long form returns
   * nothing, the short form returns the location. It is also what ExifTool
   * itself writes when asked to set this key.
   */
  return boite('meta', hdlr, keys, ilst);
}

/** A brand new `udta`, wrapping only the box we just wrote. */
function nouvelleUdta(contenu: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + contenu.length);
  writeU32(out, 0, out.length, 'BE');
  out.set([0x75, 0x64, 0x74, 0x61], 4); // « udta »
  out.set(contenu, 8);
  return out;
}

/** Writes a position into a video, correcting or creating. */
export function ecrirePositionVideo(b: Uint8Array, lat: number, lon: number): Pose {
  const p = validerPosition({ lat, lon });
  if (!p) throw REFUS_ECRITURE();
  if (lieuEnMouvement(b)) throw REFUS_MOUVEMENT();

  const porteurs = porteursDeLieu(b);
  // The location may exist only in a text packet: there is then no slot to
  // correct, but there is certainly a location not to leave behind.
  const aPurger = paquetsDeTexte(b).some((x) => porteUnLieu(lireTexte(b, x)));

  // The text packet copy goes in every case: we cannot keep it up to date, and
  // leaving it would have the same file state two locations.
  const avecPurge = (pose: Pose): Pose => {
    if (!aPurger) return pose;
    const changed = [...pose.changed];
    purgerLesPaquets(pose.bytes, changed);
    return { bytes: pose.bytes, changed };
  };

  if (porteurs.length) {
    // First route: rewrite each slot where it is. No byte moves, so nothing the
    // file addresses by rank becomes wrong, and the produced file is exactly
    // the size of the original.
    const pose = corrigerSurPlace(b, porteurs, p);
    if (pose) return avecPurge(pose);
    // Second route, when the slots in place are too short to carry the
    // requested location: they are all erased and one long enough slot is
    // written. The file grows, which needs the same permission as adding.
    if (!accepteAjoutVideo(b)) throw REFUS_ECRITURE();
    return avecPurge(ajouterLeLieu(b, p, porteurs));
  }

  if (!accepteAjoutVideo(b)) throw REFUS_ECRITURE();
  return avecPurge(ajouterLeLieu(b, p));
}

// Erasing

/**
 * Neutralises a box without moving it: it is renamed `free`, the free space
 * every reader skips, and its payload is zeroed.
 *
 * Renaming alone would not do: the bytes would still be there, and a tool that
 * scans the file rather than following its structure would find them.
 */
function neutraliser(out: Uint8Array, x: Boite, changed: Plage[]): void {
  out.set([0x66, 0x72, 0x65, 0x65], x.debut + 4); // « free »
  out.fill(0, charge(x), finDe(x));
  changed.push([x.debut + 4, finDe(x)]);
}

/**
 * The descriptive text packets of a video.
 *
 * An editor stores the location there a second time, and in words:
 * `photoshop:City`, `Iptc4xmpExt:LocationCreated`. This is the "Avignon" case:
 * a file with no coordinates left that still names the town is not erased.
 */
const UUID_XMP = 'be7acfcb97a942e89c71999491e3afac';

function paquetsDeTexte(b: Uint8Array): Boite[] {
  const racine = boites(b, 0, b.length);
  const out: Boite[] = [];

  // The QuickTime form: an `XMP_` box inside a `udta`, any of them.
  for (const udta of toutesLesBoites(b, 'udta', racine)) {
    out.push(...enfants(b, udta).filter((x) => x.type === 'XMP_' || x.type === 'uuid'));
  }

  /*
   * And the form the standard specifies for an MP4: a top-level `uuid` box,
   * recognised by its identifier.
   *
   * That is where ExifTool writes, and where we were not looking. The bug was
   * not only a display one: the residual sweep did not see the packet either,
   * so an erase could return a file announced as clean that still said where it
   * had been filmed. That is the outcome this engine exists to prevent.
   */
  for (const x of racine) {
    if (x.type !== 'uuid') continue;
    if (texteHexa(b, x.debut + 8, 16) === UUID_XMP) out.push(x);
  }
  return out;
}

const texteHexa = (b: Uint8Array, o: number, n: number) =>
  Array.from(b.subarray(o, o + n), (v) => v.toString(16).padStart(2, '0')).join('');

const lireTexte = (b: Uint8Array, x: Boite) =>
  new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(charge(x), finDe(x)));

/**
 * Removes the location from a video, or returns the original.
 *
 * Order matters: the refusal comes before a byte is touched. A half-finished
 * erase is worse than none, because the user would believe the file is clean.
 */
/**
 * Removes the location properties from descriptive text packets, in place.
 *
 * A packet is not neutralised wholesale: it also carries the title, the author
 * and the edit history. `xmp.ts` blanks only the location, at constant length,
 * and fails rather than leave a trace.
 *
 * Called on erase and on correction alike. On correction the all-or-nothing
 * rule requires it: the numbers there have variable length, so rewriting them
 * would move bytes, and leaving them would have the same file state two
 * different locations.
 */
function purgerLesPaquets(out: Uint8Array, changed: Plage[]): void {
  for (const paquet of paquetsDeTexte(out)) {
    const avant = lireTexte(out, paquet);
    if (!porteUnLieu(avant)) continue;
    const apres = purgerLeLieu(avant);
    // We go back through the bytes and require the same length. `purgerLeLieu`
    // only substitutes spaces, so it is owed, but a truncated or badly encoded
    // packet would make it vary, and failing here beats shifting everything
    // that follows.
    const octets = apres === null ? null : new TextEncoder().encode(apres);
    if (!octets || octets.length !== finDe(paquet) - charge(paquet)) {
      throw new ExifError(
        'COPIE_DU_LIEU_SUBSISTE',
        "Une copie du lieu subsiste dans cette vidéo, sous une forme que nous ne savons pas retirer. Nous préférons vous rendre l'original intact.",
      );
    }
    out.set(octets, charge(paquet));
    changed.push([charge(paquet), finDe(paquet)]);
  }
}

export function effacerPositionVideo(b: Uint8Array): Pose {
  if (lieuEnMouvement(b)) throw REFUS_MOUVEMENT();

  const porteurs = porteursDeLieu(b);
  const out = b.slice();
  const changed: Plage[] = [];
  for (const porteur of porteurs) neutraliser(out, porteur.boite, changed);

  purgerLesPaquets(out, changed);

  // And we check our own work afterwards. A purge taken on trust is a purge
  // that cannot be defended.
  if (copieDuLieuAilleursVideo(out)) {
    throw new ExifError(
      'COPIE_DU_LIEU_SUBSISTE',
      "Une copie du lieu subsiste dans cette vidéo, sous une forme que nous ne savons pas retirer. Nous préférons vous rendre l'original intact.",
    );
  }
  return { bytes: out, changed };
}

/**
 * True if a trace of the location survives the erase.
 *
 * Two sweeps, and the second is the one that was missing: it looks for the
 * coordinates, and for the fields we know carry a town name. A file with no
 * latitude left that still says "Avignon" is not erased.
 *
 * What this guarantee does not cover, and it should be said: a town name
 * slipped into a free comment field would pass. We guarantee the fields meant
 * for a location are empty, not that no word in the file names a place.
 */
export function copieDuLieuAilleursVideo(b: Uint8Array): boolean {
  if (lieuEnMouvement(b)) return true;
  for (const p of porteursDeLieu(b)) {
    if (p.nomDeLieu && p.nomDeLieu.longueur > 0) return true;
    if (p.binaire && (p.binaire.lat !== 0 || p.binaire.lon !== 0)) return true;
    if (p.texte && lireIso6709(p.texte)) return true;
  }
  for (const paquet of paquetsDeTexte(b)) {
    if (porteUnLieu(lireTexte(b, paquet))) return true;
  }
  return false;
}

// The post-write check

/**
 * True if the file's description still holds together.
 *
 * On a photo the post-write guarantee rests on a second reader written by
 * somebody else. For a video none exists in a browser, and this replaces it:
 * every box that contains others must be exactly filled by its children. It
 * targets the bug actually feared here, which is not byte order, since we write
 * text, but size arithmetic: a box that grew while a parent kept its old size.
 *
 * Two choices, and the first cost a whole release:
 *
 *   1. Only boxes that contain boxes are descended into. The previous version
 *      descended everywhere, including into `tkhd` and `stsz`, whose payloads
 *      are numbers that read as plausible headers. It returned false on every
 *      real video, which refused writing and erasing on all of them.
 *   2. A container with no parsable child passes. The asymmetry of risk
 *      requires it: a false negative forbids every write, the bug just fixed,
 *      while a false positive is still caught by the two neighbouring checks,
 *      the byte-exact proof and the location read-back.
 *
 * This function lives here rather than in the worker for a reason worth
 * writing down: in the worker no test could reach it, which is exactly why the
 * bug shipped.
 */
export function structureIntacte(b: Uint8Array): boolean {
  const haut = boites(b, 0, b.length);
  if (!haut.length || finDe(haut[haut.length - 1]) !== b.length) return false;
  const moov = haut.find((x) => x.type === 'moov');
  if (!moov) return false;

  const descendre = (parent: Boite, profondeur: number): boolean => {
    if (profondeur > 12) return true;
    const filles = enfants(b, parent);
    if (!filles.length) return true;
    if (finDe(filles[filles.length - 1]) !== finDe(parent)) return false;
    return filles
      .filter((f) => contientDesBoites(f.type))
      .every((f) => descendre(f, profondeur + 1));
  };
  return descendre(moov, 0);
}

/** True if every slot in the file agrees on the same location. */
export function porteursConcordent(b: Uint8Array): boolean {
  const lus = porteursDeLieu(b)
    .map(positionDe)
    .filter((x): x is LatLon => x !== null);
  // A slot saying something different from the others would be exactly the lie
  // this module exists to prevent.
  return lus.every((x) => distanceMetres(x, lus[0]) < 1);
}

// What we can do with this file

/**
 * True if the text packet, should it name a location, can be cleaned.
 *
 * Asked before the action, and by the same code that will answer during it,
 * which is what stops the interface offering an erase the engine will refuse.
 */
function texteNettoyable(b: Uint8Array): boolean {
  for (const paquet of paquetsDeTexte(b)) {
    const avant = lireTexte(b, paquet);
    if (!porteUnLieu(avant)) continue;
    const apres = purgerLeLieu(avant);
    if (apres === null) return false;
    const octets = new TextEncoder().encode(apres);
    if (octets.length !== finDe(paquet) - charge(paquet)) return false;
  }
  return true;
}

/**
 * A slot long enough to carry any location to the metre.
 *
 * Six decimals each side, twenty-two characters excluding altitude. A shorter
 * string may land exactly on one location and not on its neighbour: that is not
 * a property of the file, so it cannot be announced.
 */
function assezLong(p: Porteur): boolean {
  // A fixed-point slot is never fine enough: its step is one metre seven in
  // latitude, wider than the tolerance we impose on ourselves. A file that
  // stores its location that way therefore goes through the route that grows,
  // which replaces it with a long enough string.
  if (p.binaire) return false;
  // And the question is put to `ecrireIso6709` itself rather than restating its
  // limits here. It has two, since a string can be too long as readily as too
  // short, and checking only one meant announcing a correction the write would
  // then refuse.
  const { altitude, queue } = formeDe(p.texte);
  // Altitude and tail take up room without carrying a coordinate: what matters
  // is the number of decimals left to the two numbers.
  const decimales = p.longueurTexte - 9 - queue.length - altitude.length;
  return decimales >= DECIMALES_AU_METRE
    && ecrireIso6709({ lat: 0, lon: 0 }, p.longueurTexte, altitude, queue) !== null;
}

/** What the tool can do with this video, with the reason that goes with it. */
export interface SondeVideo {
  position: LatLon | null;
  lieuEnMouvement: boolean;
  capacites: {
    lire: boolean;
    corriger: boolean;
    ajouter: boolean;
    effacer: boolean;
    effacerTout: boolean;
  };
}

export function sonderVideo(b: Uint8Array): SondeVideo {
  const enMouvement = lieuEnMouvement(b);
  const porteurs = porteursDeLieu(b);
  // The same read as the one displayed, not a second that diverges from it:
  // the probe used to recompute the location from the ordinary slots alone, so
  // a video whose location lives in the text packet announced itself as having
  // none while the reader could read it.
  const position = lirePositionVideo(b);

  if (enMouvement) {
    // The location is also written throughout the video, in the data this
    // engine never rewrites. Reading stays honest; everything else would lie.
    return {
      position,
      lieuEnMouvement: true,
      capacites: { lire: true, corriger: false, ajouter: false, effacer: false, effacerTout: false },
    };
  }

  const peutGrandir = accepteAjoutVideo(b);
  const surPlace = porteurs.length > 0 && porteurs.every(assezLong);
  return {
    position,
    lieuEnMouvement: false,
    capacites: {
      lire: true,
      corriger: peutGrandir || surPlace,
      ajouter: peutGrandir,
      effacer: texteNettoyable(b),
      // Removing everything from a video would mean rebuilding it, which this
      // module cannot do, for the same reason as a HEIC.
      effacerTout: false,
    },
  };
}
