/**
 * PNG container: the TIFF block lives in an `eXIf` chunk.
 *
 * This is the only format handled here where adding is fully safe: a PNG holds
 * no internal absolute offsets, so inserting a chunk or growing one invalidates
 * nothing. Hence `reconstruire`, which HEIC and TIFF do not have.
 *
 * Two consequences of the format worth keeping in mind:
 *   - every chunk carries a checksum that must be recomputed whenever its
 *     content changes. That checksum lives outside the TIFF block, so the
 *     container declares it as a service range; otherwise the byte-exact check
 *     would see it as an unexplained modification;
 *   - an editor may have stored the location a second time in a text chunk.
 *     Erasing the first and leaving the second would hand back a file the user
 *     believes is clean.
 */

import { ExifError } from './erreurs.ts';
import { readU32, writeU32 } from './octets.ts';
import { crc32 } from './crc32.ts';
import { porteUnLieu, purgerLeLieu } from './xmp.ts';
import type { Conteneur, Emplacement, Plage, Pose } from './conteneurs.ts';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PREFIXE_EXIF = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // « Exif\0\0 »
const MOT_CLE_XMP = 'XML:com.adobe.xmp';

interface Morceau {
  type: string;
  /** Start of the length field. */
  debut: number;
  /** Start of the data. */
  donnees: number;
  longueur: number;
  /** Exclusive end of the chunk, checksum included. */
  fin: number;
}

function morceaux(b: Uint8Array): Morceau[] {
  const out: Morceau[] = [];
  let o = 8;
  while (o + 12 <= b.length) {
    const longueur = readU32(b, o, 'BE');
    if (o + 12 + longueur > b.length) break;
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    out.push({ type, debut: o, donnees: o + 8, longueur, fin: o + 12 + longueur });
    o += 12 + longueur;
    if (type === 'IEND') break;
  }
  return out;
}

/** Keyword of a text chunk, at the head of its data. */
function motCle(b: Uint8Array, m: Morceau): string {
  let z = m.donnees;
  const max = Math.min(m.donnees + 80, m.donnees + m.longueur);
  while (z < max && b[z] !== 0) z++;
  return String.fromCharCode(...b.subarray(m.donnees, z));
}

function estXmp(b: Uint8Array, m: Morceau): boolean {
  return (
    (m.type === 'iTXt' || m.type === 'tEXt' || m.type === 'zTXt') && motCle(b, m) === MOT_CLE_XMP
  );
}

/**
 * A compressed text packet is unreadable to this engine, which is synchronous:
 * `zTXt` always is, `iTXt` is when its flag says so.
 */
function estCompresse(b: Uint8Array, m: Morceau): boolean {
  if (m.type === 'zTXt') return true;
  if (m.type !== 'iTXt') return false;
  const cle = motCle(b, m);
  return b[m.donnees + cle.length + 1] === 1;
}

/** Start and length of the text of an uncompressed `iTXt`. */
function texteDeITXt(b: Uint8Array, m: Morceau): { debut: number; longueur: number } | null {
  if (m.type !== 'iTXt') return null;
  // keyword\0 flag(1) method(1) language\0 translated keyword\0 text
  let p = m.donnees;
  const fin = m.donnees + m.longueur;
  const sauterChaine = () => {
    while (p < fin && b[p] !== 0) p++;
    p++;
  };
  sauterChaine(); // mot-clé
  p += 2; // drapeau de compression + méthode
  sauterChaine(); // langue
  sauterChaine(); // mot-clé traduit
  if (p >= fin) return null;
  return { debut: p, longueur: fin - p };
}

function refaireLaSomme(out: Uint8Array, m: Morceau): void {
  writeU32(out, m.fin - 4, crc32(out, m.debut + 4, m.fin - 4), 'BE');
}

function assembler(morceaux: Uint8Array[]): Uint8Array {
  const total = morceaux.reduce((n, x) => n + x.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const x of morceaux) {
    out.set(x, p);
    p += x.length;
  }
  return out;
}

/** Builds a complete chunk: length, type, data, checksum. */
function fabriquer(type: string, donnees: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + donnees.length);
  writeU32(out, 0, donnees.length, 'BE');
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(donnees, 8);
  writeU32(out, out.length - 4, crc32(out, 4, out.length - 4), 'BE');
  return out;
}

interface Interne {
  morceau: Morceau;
  /** Bytes of the "Exif\0\0" prefix, if the file carried one. */
  prefixe: Uint8Array;
}

export const conteneurPng: Conteneur = {
  format: 'png',

  reconnait(b) {
    return b.length > 8 && SIGNATURE.every((x, i) => b[i] === x);
  },

  localiser(b) {
    const out: Emplacement[] = [];
    for (const m of morceaux(b)) {
      if (m.type !== 'eXIf' || m.longueur < 8) continue;
      // The specification wants a bare TIFF block; some tools leave a JPEG
      // preamble in it anyway. It is accepted on read and returned as is, but
      // never written.
      const avecPrefixe = PREFIXE_EXIF.every((x, i) => b[m.donnees + i] === x);
      const debut = m.donnees + (avecPrefixe ? 6 : 0);
      const ok =
        (b[debut] === 0x49 && b[debut + 1] === 0x49) || (b[debut] === 0x4d && b[debut + 1] === 0x4d);
      if (!ok) continue;
      out.push({
        tiff: b.subarray(debut, m.donnees + m.longueur),
        debut,
        interne: {
          morceau: m,
          prefixe: avecPrefixe ? b.slice(m.donnees, m.donnees + 6) : new Uint8Array(0),
        } satisfies Interne,
      });
    }
    return out;
  },

  plagesRevendiquees(b, vise) {
    const fin = vise.debut + vise.tiff.length;
    const plages: Plage[] = [];
    if (vise.debut > 0) plages.push([0, vise.debut]);
    if (fin < b.length) plages.push([fin, b.length]);
    return plages;
  },

  // The checksum of the touched chunk lives outside the TIFF block. Without
  // this declaration the byte-exact check would see it as a modification
  // nobody announced, and reject the file.
  plagesDeService(_b, vise) {
    const { morceau } = vise.interne as Interne;
    return [[morceau.fin - 4, morceau.fin]];
  },

  reecrireSurPlace(b, vise, tiff) {
    const out = new Uint8Array(b);
    out.set(tiff, vise.debut);
    refaireLaSomme(out, (vise.interne as Interne).morceau);
    return out;
  },

  reconstruire(b, vise, tiff): Pose {
    const liste = morceaux(b);
    const prefixe = vise ? (vise.interne as Interne).prefixe : new Uint8Array(0);
    const donnees = new Uint8Array(prefixe.length + tiff.length);
    donnees.set(prefixe, 0);
    donnees.set(tiff, prefixe.length);
    const neuf = fabriquer('eXIf', donnees);

    if (vise) {
      const ancien = (vise.interne as Interne).morceau;
      const bytes = assembler([b.subarray(0, ancien.debut), neuf, b.subarray(ancien.fin)]);
      return { bytes, changed: [[ancien.debut, Math.max(b.length, bytes.length)]] };
    }

    // The specification allows `eXIf` anywhere between the header and the end,
    // outside the image data; its third edition narrows that to "before the
    // image data". Right after the header satisfies both, and conflicts with
    // neither the palette nor an animation.
    const ihdr = liste.find((m) => m.type === 'IHDR');
    if (!ihdr) {
      throw new ExifError('FICHIER_CORROMPU', 'La structure de cette image est incohérente.');
    }
    const bytes = assembler([b.subarray(0, ihdr.fin), neuf, b.subarray(ihdr.fin)]);
    return { bytes, changed: [[ihdr.fin, Math.max(b.length, bytes.length)]] };
  },

  /**
   * Removes descriptive information and keeps the colour profile.
   *
   * Losing the profile would visibly shift colours in any colour-managed
   * application: that would degrade the image, when the user asked to remove
   * information.
   */
  toutEffacer(b): Pose {
    const aJeter = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);
    const liste = morceaux(b);
    const jetes = liste.filter((m) => aJeter.has(m.type));
    if (!jetes.length) return { bytes: b, changed: [] };
    const garde: Uint8Array[] = [b.subarray(0, 8)];
    for (const m of liste) if (!aJeter.has(m.type)) garde.push(b.subarray(m.debut, m.fin));
    const bytes = assembler(garde);
    return { bytes, changed: [[jetes[0].debut, Math.max(b.length, bytes.length)]] };
  },

  copieDuLieuAilleurs(b) {
    for (const m of morceaux(b)) {
      if (!estXmp(b, m)) continue;
      if (estCompresse(b, m)) {
        // We cannot open it, so we can neither claim it carries a location
        // nor claim it does not. Doubt means refusal.
        return true;
      }
      const t = texteDeITXt(b, m);
      if (!t) continue;
      const texte = new TextDecoder('utf-8', { fatal: false }).decode(
        b.subarray(t.debut, t.debut + t.longueur),
      );
      if (porteUnLieu(texte)) return true;
    }
    return false;
  },

  purgerCopiesDuLieu(b): Pose {
    const out = new Uint8Array(b);
    const changed: Plage[] = [];
    for (const m of morceaux(b)) {
      if (!estXmp(b, m) || estCompresse(b, m)) continue;
      const t = texteDeITXt(b, m);
      if (!t) continue;
      const brut = out.subarray(t.debut, t.debut + t.longueur);
      const texte = new TextDecoder('utf-8', { fatal: false }).decode(brut);
      if (!porteUnLieu(texte)) continue;
      const purge = purgerLeLieu(texte);
      if (purge === null) {
        throw new ExifError(
          'COPIE_DU_LIEU_SUBSISTE',
          "Cette image range aussi le lieu sous une forme que nous ne savons pas retirer entièrement. Nous préférons ne rien changer plutôt que d'en oublier une copie.",
        );
      }
      const octets = new TextEncoder().encode(purge);
      if (octets.length !== t.longueur) {
        throw new ExifError(
          'COPIE_DU_LIEU_SUBSISTE',
          "Cette image range aussi le lieu sous une forme que nous ne savons pas retirer entièrement. Nous préférons ne rien changer plutôt que d'en oublier une copie.",
        );
      }
      out.set(octets, t.debut);
      refaireLaSomme(out, m);
      changed.push([t.debut, t.debut + t.longueur], [m.fin - 4, m.fin]);
    }
    return { bytes: out, changed };
  },
};
