/**
 * WebP container: the TIFF block lives in an `EXIF` chunk.
 *
 * A WebP comes in two forms. The extended form starts with a header chunk
 * declaring what the file contains, and it is the only one with room for a
 * location. The simple form has none: creating one would mean re-reading the
 * dimensions out of the compressed stream, with two distinct header decoders
 * depending on the encoding mode, for a file that by construction never has
 * anything to correct. It stays read-only, and the interface says so before
 * the action.
 *
 * Three quirks of real files, all met in the corpus:
 *   - the `EXIF` chunk sometimes carries a JPEG preamble before the TIFF
 *     block, which the specification forbids. It is accepted on read and
 *     returned as is, never written;
 *   - the descriptive text chunk is sometimes named `XMP\0` instead of `XMP `;
 *   - the header flags lie: one file in the corpus carries a text chunk its
 *     flags do not declare. The real chunk list is read, never the flags alone.
 */

import { ExifError } from './erreurs.ts';
import { readU32, writeU32 } from './octets.ts';
import { porteUnLieu, purgerLeLieu } from './xmp.ts';
import type { Conteneur, Emplacement, Plage, Pose } from './conteneurs.ts';

const PREFIXE_EXIF = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // « Exif\0\0 »

// Extended header flags, checked against the libwebp source.
const DRAPEAU_EXIF = 0x08;
const DRAPEAU_XMP = 0x04;

interface Morceau {
  type: string;
  /** Start of the type field. */
  debut: number;
  /** Start of the data. */
  donnees: number;
  longueur: number;
  /** Exclusive end, padding byte included. */
  fin: number;
}

function morceaux(b: Uint8Array): Morceau[] {
  const out: Morceau[] = [];
  let o = 12;
  const limite = Math.min(b.length, 8 + readU32(b, 4, 'LE'));
  while (o + 8 <= limite) {
    const type = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    const longueur = readU32(b, o + 4, 'LE');
    if (o + 8 + longueur > limite) break;
    // A chunk of odd length is followed by a padding byte, which counts
    // towards the file size but not towards the chunk's.
    out.push({ type, debut: o, donnees: o + 8, longueur, fin: o + 8 + longueur + (longueur & 1) });
    o = out[out.length - 1].fin;
  }
  return out;
}

const estXmp = (m: Morceau) => m.type === 'XMP ' || m.type === 'XMP\0';

/** True if the size declared by the header matches the file received. */
function tailleCoherente(b: Uint8Array): boolean {
  return b.length === 8 + readU32(b, 4, 'LE');
}

function assembler(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, x) => n + x.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const x of parts) {
    out.set(x, p);
    p += x.length;
  }
  return out;
}

function fabriquer(type: string, donnees: Uint8Array): Uint8Array {
  const bourrage = donnees.length & 1;
  const out = new Uint8Array(8 + donnees.length + bourrage);
  for (let i = 0; i < 4; i++) out[i] = type.charCodeAt(i);
  writeU32(out, 4, donnees.length, 'LE');
  out.set(donnees, 8);
  return out;
}

/** Rebuilds the file from a list of already-serialised chunks. */
function reconstruireFichier(b: Uint8Array, corps: Uint8Array[]): Uint8Array {
  const entete = new Uint8Array(12);
  entete.set(b.subarray(0, 12), 0);
  const bytes = assembler([entete, ...corps]);
  // The declared size covers the chunks that follow, plus the four bytes of
  // the "WEBP" tag.
  writeU32(bytes, 4, bytes.length - 8, 'LE');
  return bytes;
}

interface Interne {
  morceau: Morceau;
  prefixe: Uint8Array;
}

export const conteneurRiff: Conteneur = {
  format: 'webp',

  reconnait(b) {
    return (
      b.length > 12 &&
      String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' &&
      String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP'
    );
  },

  localiser(b) {
    const out: Emplacement[] = [];
    for (const m of morceaux(b)) {
      if (m.type !== 'EXIF' || m.longueur < 8) continue;
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

  reecrireSurPlace(b, vise, tiff) {
    const out = new Uint8Array(b);
    out.set(tiff, vise.debut);
    return out;
  },

  /**
   * Adding is only open to the extended form, and only when the declared size
   * matches the file received: trailing junk bytes are common, and we do not
   * know whether some third-party reader gives them meaning.
   */
  accepteAjout(b) {
    return morceaux(b).some((m) => m.type === 'VP8X') && tailleCoherente(b);
  },

  reconstruire(b, vise, tiff): Pose {
    const liste = morceaux(b);
    const vp8x = liste.find((m) => m.type === 'VP8X');
    if (!vp8x || !tailleCoherente(b)) {
      throw new ExifError(
        'AJOUT_IMPOSSIBLE',
        "Cette image n'a pas d'emplacement prévu pour un lieu, et nous ne savons pas encore lui en créer un.",
      );
    }

    const prefixe = vise ? (vise.interne as Interne).prefixe : new Uint8Array(0);
    const donnees = new Uint8Array(prefixe.length + tiff.length);
    donnees.set(prefixe, 0);
    donnees.set(tiff, prefixe.length);
    const neuf = fabriquer('EXIF', donnees);

    const ancien = vise ? (vise.interne as Interne).morceau : null;
    const corps: Uint8Array[] = [];
    let pose = false;
    let debutChange = b.length;

    for (const m of liste) {
      if (ancien && m.debut === ancien.debut) {
        debutChange = Math.min(debutChange, m.debut);
        corps.push(neuf);
        pose = true;
        continue;
      }
      // The specification requires the location chunk to precede the
      // descriptive text one, so it is inserted just before it if there is one.
      if (!pose && !ancien && estXmp(m)) {
        debutChange = Math.min(debutChange, m.debut);
        corps.push(neuf);
        pose = true;
      }
      corps.push(b.subarray(m.debut, m.fin));
    }
    if (!pose) {
      const dernier = liste[liste.length - 1];
      debutChange = Math.min(debutChange, dernier ? dernier.fin : 12);
      corps.push(neuf);
    }

    const bytes = reconstruireFichier(b, corps);
    // The flags must describe what is actually there.
    const nouveauVp8x = morceaux(bytes).find((m) => m.type === 'VP8X');
    if (nouveauVp8x) bytes[nouveauVp8x.donnees] |= DRAPEAU_EXIF;

    return {
      bytes,
      // The overall size is at the head, the added chunk further on: both
      // ranges are declared, nothing else moves.
      changed: [
        [4, 8],
        [nouveauVp8x ? nouveauVp8x.donnees : 12, nouveauVp8x ? nouveauVp8x.donnees + 1 : 12],
        [debutChange, Math.max(b.length, bytes.length)],
      ],
    };
  },

  toutEffacer(b): Pose {
    const liste = morceaux(b);
    const jetes = liste.filter((m) => m.type === 'EXIF' || estXmp(m));
    if (!jetes.length) return { bytes: b, changed: [] };
    // The colour profile (`ICCP`) is kept: losing it would visibly shift
    // colours, which nobody asked for.
    const corps = liste
      .filter((m) => m.type !== 'EXIF' && !estXmp(m))
      .map((m) => b.subarray(m.debut, m.fin));
    const bytes = reconstruireFichier(b, corps);
    const vp8x = morceaux(bytes).find((m) => m.type === 'VP8X');
    if (vp8x) bytes[vp8x.donnees] &= ~(DRAPEAU_EXIF | DRAPEAU_XMP);
    return { bytes, changed: [[4, 8], [jetes[0].debut, Math.max(b.length, bytes.length)]] };
  },

  copieDuLieuAilleurs(b) {
    for (const m of morceaux(b)) {
      if (!estXmp(m)) continue;
      const texte = new TextDecoder('utf-8', { fatal: false }).decode(
        b.subarray(m.donnees, m.donnees + m.longueur),
      );
      if (porteUnLieu(texte)) return true;
    }
    return false;
  },

  purgerCopiesDuLieu(b): Pose {
    const out = new Uint8Array(b);
    const changed: Plage[] = [];
    for (const m of morceaux(b)) {
      if (!estXmp(m)) continue;
      const texte = new TextDecoder('utf-8', { fatal: false }).decode(
        b.subarray(m.donnees, m.donnees + m.longueur),
      );
      if (!porteUnLieu(texte)) continue;
      const purge = purgerLeLieu(texte);
      const octets = purge === null ? null : new TextEncoder().encode(purge);
      if (!octets || octets.length !== m.longueur) {
        throw new ExifError(
          'COPIE_DU_LIEU_SUBSISTE',
          "Cette image range aussi le lieu sous une forme que nous ne savons pas retirer entièrement. Nous préférons ne rien changer plutôt que d'en oublier une copie.",
        );
      }
      out.set(octets, m.donnees);
      changed.push([m.donnees, m.donnees + m.longueur]);
    }
    return { bytes: out, changed };
  },
};
