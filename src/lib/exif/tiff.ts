/**
 * Chirurgie sur un bloc TIFF, sans savoir quel fichier le porte.
 *
 * C'est la couche qui fait tout le travail. Un JPEG range son bloc TIFF dans un
 * segment APP1, un HEIC dans un item de sa boîte `meta`, un PNG dans un chunk
 * `eXIf`, un WebP dans un chunk `EXIF` — et un TIFF *est* ce bloc. À chaque
 * fois, une fois le bloc localisé, les opérations sont exactement les mêmes.
 *
 * Deux voies seulement, et aucune ne déplace un octet existant :
 *
 *   P1 — édition sur place, à longueur constante. Les octets de la valeur GPS
 *        sont modifiés là où ils sont. MakerNote, vignette, profil ICC, MPF,
 *        segments Photoshop : préservés par construction, pas par vigilance.
 *
 *   P2 — ajout par recopie d'IFD0 en fin de bloc. Quand il faut créer un GPS IFD
 *        qui n'existe pas, on n'insère rien au milieu : on ajoute un nouvel IFD0
 *        à la fin du bloc et on fait pointer l'en-tête dessus. Les offsets de
 *        valeurs étant absolus depuis le début du bloc, tout le reste reste
 *        valide au bit près — y compris un MakerNote à offsets absolus, qui est
 *        précisément ce qu'une réécriture classique casse.
 *
 * Tous les offsets manipulés ici sont relatifs au début du bloc TIFF. C'est au
 * conteneur de les ramener en coordonnées fichier.
 */

import { ExifError } from './erreurs.ts';
import { type Endian, readU16, readU32, writeU16, writeU32 } from './octets.ts';

export type { Endian };

export interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Position absolue de l'entrée de 12 octets, depuis le début du bloc TIFF. */
  entryOffset: number;
  /** Position absolue de la valeur si elle est hors-ligne, sinon null. */
  valueOffset: number | null;
  /** Longueur de la valeur en octets. */
  valueLength: number;
}

export interface Ifd {
  offset: number;
  entries: Entry[];
  /** Position absolue du pointeur « IFD suivant ». */
  nextPointerOffset: number;
  next: number;
}

export interface TiffView {
  /** Le bloc TIFF seul (à partir de « II » / « MM »). */
  bytes: Uint8Array;
  endian: Endian;
  ifd0: Ifd;
  exifIfd: Ifd | null;
  gpsIfd: Ifd | null;
  interopIfd: Ifd | null;
  ifd1: Ifd | null;
}

/** Taille en octets d'une composante, par type TIFF 6.0. */
const TYPE_SIZE: Record<number, number> = {
  1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8,
};

export const TAG_EXIF_IFD = 0x8769;
export const TAG_GPS_IFD = 0x8825;
export const TAG_INTEROP_IFD = 0xa005;

export const GPS = {
  VersionID: 0x0000,
  LatitudeRef: 0x0001,
  Latitude: 0x0002,
  LongitudeRef: 0x0003,
  Longitude: 0x0004,
  AltitudeRef: 0x0005,
  Altitude: 0x0006,
  HPositioningError: 0x001f,
} as const;

/* ------------------------------------------------------------------ */
/* Lecture de la structure                                             */
/* ------------------------------------------------------------------ */

function parseIfd(bytes: Uint8Array, offset: number, e: Endian): Ifd {
  if (offset + 2 > bytes.length) {
    throw new ExifError('EXIF_CORROMPU', "Les informations du fichier sont illisibles.");
  }
  const count = readU16(bytes, offset, e);
  const entries: Entry[] = [];
  const end = offset + 2 + count * 12;
  if (end + 4 > bytes.length) {
    throw new ExifError('EXIF_CORROMPU', "Les informations du fichier sont illisibles.");
  }
  for (let k = 0; k < count; k++) {
    const eo = offset + 2 + k * 12;
    const tag = readU16(bytes, eo, e);
    const type = readU16(bytes, eo + 2, e);
    const cnt = readU32(bytes, eo + 4, e);
    const size = TYPE_SIZE[type];
    // Un type inconnu n'est pas une erreur fatale : on garde l'entrée telle
    // quelle et on refusera simplement d'y toucher.
    const valueLength = size ? size * cnt : 0;
    const inline = valueLength <= 4;
    entries.push({
      tag,
      type,
      count: cnt,
      entryOffset: eo,
      valueOffset: inline ? null : readU32(bytes, eo + 8, e),
      valueLength,
    });
  }
  return { offset, entries, nextPointerOffset: end, next: readU32(bytes, end, e) };
}

function subIfd(bytes: Uint8Array, ifd: Ifd, tag: number, e: Endian): Ifd | null {
  const entry = ifd.entries.find((x) => x.tag === tag);
  if (!entry) return null;
  const target = entry.valueOffset ?? readU32(bytes, entry.entryOffset + 8, e);
  if (target === 0 || target >= bytes.length) return null;
  try {
    return parseIfd(bytes, target, e);
  } catch {
    return null;
  }
}

/** Construit une vue exploitable d'un bloc TIFF. */
export function parseTiff(tiff: Uint8Array): TiffView {
  if (tiff.length < 8) {
    throw new ExifError('EXIF_CORROMPU', "Les informations du fichier sont illisibles.");
  }
  let endian: Endian;
  if (tiff[0] === 0x49 && tiff[1] === 0x49) endian = 'LE';
  else if (tiff[0] === 0x4d && tiff[1] === 0x4d) endian = 'BE';
  else throw new ExifError('EXIF_CORROMPU', "Les informations du fichier sont illisibles.");

  if (readU16(tiff, 2, endian) !== 42) {
    throw new ExifError('EXIF_CORROMPU', "Les informations du fichier sont illisibles.");
  }
  const ifd0Offset = readU32(tiff, 4, endian);
  const ifd0 = parseIfd(tiff, ifd0Offset, endian);
  const exifIfd = subIfd(tiff, ifd0, TAG_EXIF_IFD, endian);
  const gpsIfd = subIfd(tiff, ifd0, TAG_GPS_IFD, endian);
  const interopIfd = exifIfd ? subIfd(tiff, exifIfd, TAG_INTEROP_IFD, endian) : null;
  let ifd1: Ifd | null = null;
  if (ifd0.next !== 0 && ifd0.next < tiff.length) {
    try {
      ifd1 = parseIfd(tiff, ifd0.next, endian);
    } catch {
      ifd1 = null;
    }
  }
  return { bytes: tiff, endian, ifd0, exifIfd, gpsIfd, interopIfd, ifd1 };
}

/**
 * Carte des plages d'octets revendiquées par autre chose que le GPS IFD.
 *
 * TIFF 6.0 précise que « the values to which directory entries point need not
 * be in any particular order in the file » : rien ne garantit que les valeurs
 * du GPS IFD forment une région contiguë et exclusive. Avant de zéroïser quoi
 * que ce soit, il faut donc prouver que la plage visée n'appartient à personne
 * d'autre — sinon on détruit un MakerNote en croyant nettoyer.
 */
function claimedRanges(view: TiffView, exclude: Ifd | null): Array<[number, number]> {
  const ranges: Array<[number, number]> = [[0, 8]];
  const ifds = [view.ifd0, view.exifIfd, view.gpsIfd, view.interopIfd, view.ifd1];
  for (const ifd of ifds) {
    if (!ifd || ifd === exclude) continue;
    ranges.push([ifd.offset, ifd.nextPointerOffset + 4]);
    for (const en of ifd.entries) {
      if (en.valueOffset !== null && en.valueLength > 0) {
        ranges.push([en.valueOffset, en.valueOffset + en.valueLength]);
      }
    }
  }
  // La vignette est référencée par IFD1 et doit rester intacte.
  if (view.ifd1) {
    const off = view.ifd1.entries.find((x) => x.tag === 0x0201);
    const len = view.ifd1.entries.find((x) => x.tag === 0x0202);
    if (off && len && off.valueOffset === null && len.valueOffset === null) {
      const o = readU32(view.bytes, off.entryOffset + 8, view.endian);
      const l = readU32(view.bytes, len.entryOffset + 8, view.endian);
      if (o > 0 && l > 0 && o + l <= view.bytes.length) ranges.push([o, o + l]);
    }
  }
  return ranges;
}

function overlaps(a: [number, number], ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => a[0] < e && s < a[1]);
}

/* ------------------------------------------------------------------ */
/* Conversion de coordonnées                                           */
/* ------------------------------------------------------------------ */

/** Degrés décimaux vers trois rationnels DMS, secondes au 1/10000e. */
export function degreesToDms(value: number): Array<[number, number]> {
  const abs = Math.abs(value);
  const d = Math.floor(abs);
  const minFloat = (abs - d) * 60;
  const m = Math.floor(minFloat);
  const s = Math.round((minFloat - m) * 60 * 10000);
  return [
    [d, 1],
    [m, 1],
    [s, 10000],
  ];
}

function dmsToDegrees(parts: Array<[number, number]>, ref: string): number | null {
  if (parts.length < 3) return null;
  // Un dénominateur nul n'est pas « zéro degré », c'est une valeur qu'on ne
  // sait pas lire. La remplacer par zéro annoncerait une position au large du
  // golfe de Guinée pour un fichier qui n'en porte aucune — et un Galaxy S10
  // écrit exactement cela quand il n'a pas eu de relevé.
  if (parts.some(([, den]) => den === 0)) return null;
  const [d, m, s] = parts.map(([n, den]) => n / den);
  const value = d + m / 60 + s / 3600;
  if (!Number.isFinite(value)) return null;
  return ref === 'S' || ref === 'W' ? -value : value;
}

function readRationals(view: TiffView, entry: Entry): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const base = entry.valueOffset;
  if (base === null) return out;
  for (let k = 0; k < entry.count; k++) {
    out.push([
      readU32(view.bytes, base + k * 8, view.endian),
      readU32(view.bytes, base + k * 8 + 4, view.endian),
    ]);
  }
  return out;
}

function readAscii(view: TiffView, entry: Entry): string {
  const bytes =
    entry.valueOffset === null
      ? view.bytes.subarray(entry.entryOffset + 8, entry.entryOffset + 8 + entry.valueLength)
      : view.bytes.subarray(entry.valueOffset, entry.valueOffset + entry.valueLength);
  return String.fromCharCode(...bytes).replace(/\0.*$/, '');
}

/** Lit la position d'une vue TIFF, ou null si elle n'en porte pas. */
export function readPosition(view: TiffView): { lat: number; lon: number } | null {
  const gps = view.gpsIfd;
  if (!gps) return null;
  const lat = gps.entries.find((x) => x.tag === GPS.Latitude);
  const latRef = gps.entries.find((x) => x.tag === GPS.LatitudeRef);
  const lon = gps.entries.find((x) => x.tag === GPS.Longitude);
  const lonRef = gps.entries.find((x) => x.tag === GPS.LongitudeRef);
  if (!lat || !lon || lat.type !== 5 || lon.type !== 5) return null;
  const latDeg = dmsToDegrees(readRationals(view, lat), latRef ? readAscii(view, latRef) : 'N');
  const lonDeg = dmsToDegrees(readRationals(view, lon), lonRef ? readAscii(view, lonRef) : 'E');
  if (latDeg === null || lonDeg === null) return null;
  if (Math.abs(latDeg) > 90 || Math.abs(lonDeg) > 180) return null;
  // Latitude ET longitude exactement nulles : ce n'est pas un lieu, c'est ce
  // que laisse un logiciel qui a purgé les coordonnées sans retirer les
  // entrées. Le point (0, 0) est en pleine mer ; aucun appareil ne l'écrit
  // pour de bon. Mieux vaut annoncer « aucun lieu » que le golfe de Guinée.
  if (latDeg === 0 && lonDeg === 0) return null;
  return { lat: latDeg, lon: lonDeg };
}

/* ------------------------------------------------------------------ */
/* Résultat d'une opération                                            */
/* ------------------------------------------------------------------ */

export interface Edit {
  bytes: Uint8Array;
  /** Voie réellement empruntée. */
  route: 'P1' | 'P2';
  /** Plages d'octets modifiées, pour la vérification « à l'octet près ». */
  changed: Array<[number, number]>;
}

/* ------------------------------------------------------------------ */
/* Suppression de la position — toujours P1                            */
/* ------------------------------------------------------------------ */

/**
 * Retire la position d'un bloc TIFF sans en déplacer un seul octet.
 *
 * Deux opérations : zéroïser le GPS IFD et ses valeurs hors-ligne exclusives,
 * puis retirer l'entrée GPSInfo d'IFD0.
 *
 * Le retrait d'une entrée n'est pas « décrémenter le compteur » : TIFF 6.0
 * place le pointeur « IFD suivant » à l'adresse `offset + 2 + count * 12`.
 * Décrémenter le compteur sans rien d'autre ferait lire ce pointeur douze
 * octets plus tôt, au milieu de l'entrée précédente — et l'offset de la
 * vignette deviendrait arbitraire. Il faut donc décaler les entrées suivantes,
 * réécrire le pointeur à sa nouvelle adresse avec sa valeur d'origine, et
 * zéroïser les douze octets devenus morts.
 */
export function deletePositionInTiff(view: TiffView): Edit {
  const out = new Uint8Array(view.bytes);
  const changed: Array<[number, number]> = [];
  const e = view.endian;

  if (view.gpsIfd) {
    const gps = view.gpsIfd;
    const others = claimedRanges(view, gps);

    const zeroiser = (range: [number, number]) => {
      // Un offset qui sort du bloc signifie que notre lecture de la structure
      // est fausse quelque part. Poursuivre une zéroïsation avec une carte
      // partiellement fausse est précisément ce que ce dispositif existe pour
      // empêcher : on refuse, on ne saute pas.
      if (range[0] < 0 || range[1] > out.length || range[1] < range[0]) {
        throw new ExifError(
          'STRUCTURE_INATTENDUE',
          "Ce fichier a une structure que nous ne savons pas modifier sans risque. Il n'a pas été touché.",
        );
      }
      if (overlaps(range, others)) {
        throw new ExifError(
          'PLAGES_CHEVAUCHANTES',
          "Ce fichier a une structure inhabituelle : effacer la position risquerait d'abîmer d'autres informations. Nous préférons ne pas y toucher.",
        );
      }
      out.fill(0, range[0], range[1]);
      changed.push(range);
    };

    for (const en of gps.entries) {
      if (en.valueOffset === null || en.valueLength === 0) continue;
      zeroiser([en.valueOffset, en.valueOffset + en.valueLength]);
    }

    // La structure du GPS IFD passe par le même contrôle que ses valeurs : sur
    // un TIFF à plusieurs pages, deux pages peuvent légitimement pointer sur le
    // même IFD, et la zéroïser sans vérifier détruirait la seconde.
    zeroiser([gps.offset, gps.nextPointerOffset + 4]);
  }

  // Retrait de l'entrée GPSInfo d'IFD0.
  const ifd0 = view.ifd0;
  const idx = ifd0.entries.findIndex((x) => x.tag === TAG_GPS_IFD);
  if (idx >= 0) {
    const first = ifd0.offset + 2;
    const n = ifd0.entries.length;
    const from = first + (idx + 1) * 12;
    const to = first + idx * 12;
    const tailLength = (n - idx - 1) * 12;
    out.copyWithin(to, from, from + tailLength);

    const newNextPointer = first + (n - 1) * 12;
    writeU32(out, newNextPointer, ifd0.next, e);
    out.fill(0, newNextPointer + 4, newNextPointer + 4 + 12);
    writeU16(out, ifd0.offset, n - 1, e);
    changed.push([ifd0.offset, newNextPointer + 4 + 12]);
  }

  return { bytes: out, route: 'P1', changed };
}

/* ------------------------------------------------------------------ */
/* Écriture de la position                                             */
/* ------------------------------------------------------------------ */

interface GpsField {
  tag: number;
  type: number;
  count: number;
  /** Valeur sérialisée, hors-ligne si > 4 octets. */
  data: Uint8Array;
}

function buildGpsFields(lat: number, lon: number, e: Endian, accuracyMetres?: number): GpsField[] {
  const rat = (pairs: Array<[number, number]>) => {
    const b = new Uint8Array(pairs.length * 8);
    pairs.forEach(([n, d], k) => {
      writeU32(b, k * 8, n, e);
      writeU32(b, k * 8 + 4, d, e);
    });
    return b;
  };
  const ascii = (s: string) => {
    const b = new Uint8Array(s.length + 1);
    for (let k = 0; k < s.length; k++) b[k] = s.charCodeAt(k);
    return b;
  };

  const fields: GpsField[] = [
    { tag: GPS.VersionID, type: 1, count: 4, data: new Uint8Array([2, 3, 0, 0]) },
    { tag: GPS.LatitudeRef, type: 2, count: 2, data: ascii(lat >= 0 ? 'N' : 'S') },
    { tag: GPS.Latitude, type: 5, count: 3, data: rat(degreesToDms(lat)) },
    { tag: GPS.LongitudeRef, type: 2, count: 2, data: ascii(lon >= 0 ? 'E' : 'W') },
    { tag: GPS.Longitude, type: 5, count: 3, data: rat(degreesToDms(lon)) },
  ];
  // GPSTimeStamp et GPSDateStamp décrivent l'instant du relevé satellite, pas
  // celui où l'utilisateur clique. Y écrire « maintenant » serait un mensonge
  // inscrit dans le fichier : on ne les touche pas.
  if (accuracyMetres && accuracyMetres > 0) {
    fields.push({
      tag: GPS.HPositioningError,
      type: 5,
      count: 1,
      data: rat([[Math.round(accuracyMetres), 1]]),
    });
  }
  return fields.sort((a, b) => a.tag - b.tag); // TIFF 6.0 exige l'ordre croissant
}

/**
 * Écriture sur place (P1) : n'aboutit que si chaque champ visé existe déjà dans
 * le GPS IFD avec le bon type et la bonne cardinalité. C'est le seul cas où
 * l'on peut garantir que rien d'autre ne bouge — et donc la seule voie ouverte
 * aux conteneurs qui ne tolèrent aucun changement de longueur.
 *
 * Rend `null` quand l'écriture sur place est impossible ; c'est à l'appelant de
 * décider si le format autorise la voie P2.
 */
export function ecrirePositionSurPlace(
  view: TiffView,
  lat: number,
  lon: number,
  accuracyMetres?: number,
): Edit | null {
  const fields = buildGpsFields(lat, lon, view.endian, accuracyMetres);
  const gps = view.gpsIfd;
  if (!gps) return null;
  const plan: Array<{ entry: Entry; field: GpsField }> = [];
  for (const field of fields) {
    if (field.tag === GPS.HPositioningError || field.tag === GPS.VersionID) continue;
    const entry = gps.entries.find((x) => x.tag === field.tag);
    if (!entry) return null;
    if (entry.type !== field.type || entry.count !== field.count) return null;
    if (entry.valueLength !== field.data.length) return null;
    plan.push({ entry, field });
  }
  if (plan.length < 4) return null;

  const out = new Uint8Array(view.bytes);
  const changed: Array<[number, number]> = [];
  for (const { entry, field } of plan) {
    if (entry.valueOffset === null) {
      out.set(field.data, entry.entryOffset + 8);
      changed.push([entry.entryOffset + 8, entry.entryOffset + 8 + field.data.length]);
    } else {
      if (entry.valueOffset + field.data.length > out.length) return null;
      out.set(field.data, entry.valueOffset);
      changed.push([entry.valueOffset, entry.valueOffset + field.data.length]);
    }
  }
  return { bytes: out, route: 'P1', changed };
}

/**
 * Écriture par recopie d'IFD0 en fin de bloc (P2).
 *
 * On n'insère rien au milieu du bloc TIFF : le nouvel IFD0, le nouveau GPS IFD
 * et ses valeurs sont ajoutés à la fin, puis l'en-tête TIFF est repointé sur le
 * nouvel IFD0. Les offsets de valeurs sont absolus depuis le début du bloc, donc
 * tout ce qui existait — MakerNote compris — reste valide sans être déplacé.
 * L'ancien IFD0 devient de l'espace mort que plus rien ne référence.
 *
 * Le bloc s'allonge : cette voie n'est ouverte qu'aux conteneurs dont aucune
 * structure ne dépend de la longueur du bloc ni de ce qui le suit.
 */
export function ecrirePositionParAjout(
  view: TiffView,
  lat: number,
  lon: number,
  accuracyMetres?: number,
): Edit {
  const fields = buildGpsFields(lat, lon, view.endian, accuracyMetres);
  const e = view.endian;
  const old = view.bytes;
  const base = old.length + (old.length % 2); // alignement pair

  const gpsOutline = fields.filter((f) => f.data.length > 4);

  const oldEntries = view.ifd0.entries;
  const hasGpsEntry = oldEntries.some((x) => x.tag === TAG_GPS_IFD);
  const newIfd0Count = hasGpsEntry ? oldEntries.length : oldEntries.length + 1;

  const ifd0Size = 2 + newIfd0Count * 12 + 4;
  const gpsIfdOffset = base + ifd0Size;
  const gpsIfdSize = 2 + fields.length * 12 + 4;
  let cursor = gpsIfdOffset + gpsIfdSize;
  const outlinePos = new Map<number, number>();
  for (const f of gpsOutline) {
    outlinePos.set(f.tag, cursor);
    cursor += f.data.length + (f.data.length % 2);
  }

  const out = new Uint8Array(cursor);
  out.set(old, 0);

  // --- nouvel IFD0 ---
  writeU16(out, base, newIfd0Count, e);
  let w = base + 2;
  const sorted = [...oldEntries].sort((a, b) => a.tag - b.tag);
  let wroteGps = false;
  const writeGpsEntry = () => {
    writeU16(out, w, TAG_GPS_IFD, e);
    writeU16(out, w + 2, 4, e);
    writeU32(out, w + 4, 1, e);
    writeU32(out, w + 8, gpsIfdOffset, e);
    w += 12;
    wroteGps = true;
  };
  for (const en of sorted) {
    if (!wroteGps && en.tag > TAG_GPS_IFD) writeGpsEntry();
    if (en.tag === TAG_GPS_IFD) {
      writeGpsEntry();
      continue;
    }
    out.set(old.subarray(en.entryOffset, en.entryOffset + 12), w);
    w += 12;
  }
  if (!wroteGps) writeGpsEntry();
  writeU32(out, base + 2 + newIfd0Count * 12, view.ifd0.next, e);

  // --- GPS IFD ---
  writeU16(out, gpsIfdOffset, fields.length, e);
  let g = gpsIfdOffset + 2;
  for (const f of fields) {
    writeU16(out, g, f.tag, e);
    writeU16(out, g + 2, f.type, e);
    writeU32(out, g + 4, f.count, e);
    if (f.data.length <= 4) {
      out.set(f.data, g + 8);
    } else {
      const pos = outlinePos.get(f.tag)!;
      writeU32(out, g + 8, pos, e);
      out.set(f.data, pos);
    }
    g += 12;
  }
  writeU32(out, gpsIfdOffset + 2 + fields.length * 12, 0, e);

  // --- repointage de l'en-tête ---
  writeU32(out, 4, base, e);

  return { bytes: out, route: 'P2', changed: [[4, 8], [base, cursor]] };
}

/** Écrit une position dans un bloc TIFF, en choisissant la voie la plus sûre. */
export function writePositionInTiff(
  view: TiffView,
  lat: number,
  lon: number,
  accuracyMetres?: number,
): Edit {
  return (
    ecrirePositionSurPlace(view, lat, lon, accuracyMetres) ??
    ecrirePositionParAjout(view, lat, lon, accuracyMetres)
  );
}

/** Bloc TIFF minimal, pour un fichier dépourvu de toute métadonnée. */
export function emptyTiff(endian: Endian = 'LE'): Uint8Array {
  const b = new Uint8Array(8 + 2 + 4);
  if (endian === 'LE') {
    b[0] = 0x49;
    b[1] = 0x49;
  } else {
    b[0] = 0x4d;
    b[1] = 0x4d;
  }
  writeU16(b, 2, 42, endian);
  writeU32(b, 4, 8, endian);
  writeU16(b, 8, 0, endian); // IFD0 vide
  writeU32(b, 10, 0, endian); // pas d'IFD suivant
  return b;
}
