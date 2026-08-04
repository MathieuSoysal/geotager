/**
 * HEIC / AVIF container: locating the TIFF block among the items.
 *
 * An iPhone photo keeps its TIFF block in an item of its `meta` box, among
 * fifty others carrying the image tiles. Once that block is located, `tiff.ts`
 * does exactly the work it does on a JPEG. Measured on real photos: correcting
 * an existing location costs fifteen bytes, erasing it a hundred and four, and
 * nothing else moves.
 *
 * This module cannot write an ISOBMFF container, and still does not need to.
 * Correcting and erasing are strictly constant length: the item length does not
 * change, so the item location table does not change, so no other item's offset
 * becomes wrong.
 *
 * Adding would grow the item, but nothing is grown in place. The new block goes
 * into a box appended at the end of the file, and the single `iloc` entry
 * concerned is repointed. No other byte moves; the old content becomes dead
 * space, exactly like the old IFD0 in P2. `iloc` is therefore written only
 * there, on two fields, and never moved or resized.
 *
 * What this route cannot do: give a location to a file with no location item at
 * all. That would mean adding a description to the item table, and so growing
 * the box containing it. The interface says so before the action rather than
 * failing after the click.
 */

import { ecrireEntierBE, lireEntierBE, readU16, readU32, writeU32 } from './octets.ts';
import { type Conteneur, type Emplacement, type Plage, type Pose } from './conteneurs.ts';
import { AJOUT_IMPOSSIBLE, detecterFormat } from './conteneurs.ts';
import { MARQUEURS_DE_LIEU } from './xmp.ts';
import { type Boite, boites, texte } from './bmff.ts';

/**
 * Sub-boxes of `meta`.
 *
 * `meta` is a FullBox: four bytes of version and flags precede its children.
 * QuickTime-derived tools nevertheless write it as an ordinary box. Rather than
 * guess, both are tried and the one producing an item location table wins.
 *
 * `bmff.ts` can descend into an arbitrary `meta`; here the tie-breaker is not
 * "which one fills the parent" but "which one carries an `iloc`", the only
 * correct criterion when the item location table is what you are looking for.
 */
function enfantsDeMeta(b: Uint8Array, meta: Boite): Boite[] {
  const fin = meta.debut + meta.taille;
  for (const decalage of [4, 0]) {
    const enfants = boites(b, meta.debut + meta.entete + decalage, fin);
    if (enfants.some((x) => x.type === 'iloc')) return enfants;
  }
  return [];
}

interface Item {
  id: number;
  type: string;
  /** Set for items of type `mime`: the content type. */
  contenu: string;
}

/** Item description table (`iinf` / `infe`). */
function lireIinf(b: Uint8Array, iinf: Boite): Map<number, Item> {
  const out = new Map<number, Item>();
  const version = b[iinf.debut + iinf.entete];
  let p = iinf.debut + iinf.entete + 4;
  p += version === 0 ? 2 : 4; // entry_count
  const fin = iinf.debut + iinf.taille;

  for (const boite of boites(b, p, fin)) {
    if (boite.type !== 'infe') continue;
    const v = b[boite.debut + boite.entete];
    // Versions 0 and 1 carry no item type: they describe resources of another
    // era, never a location block. They are ignored rather than given an
    // invented type.
    if (v < 2) continue;
    let q = boite.debut + boite.entete + 4;
    const tailleId = v === 3 ? 4 : 2;
    const id = tailleId === 4 ? readU32(b, q, 'BE') : readU16(b, q, 'BE');
    q += tailleId + 2; // + item_protection_index
    const type = texte(b, q, 4);
    q += 4;
    let contenu = '';
    if (type === 'mime') {
      // item_name, then content_type, both zero-terminated.
      const finBoite = boite.debut + boite.taille;
      let z = q;
      while (z < finBoite && b[z] !== 0) z++;
      z++;
      let z2 = z;
      while (z2 < finBoite && b[z2] !== 0) z2++;
      contenu = texte(b, z, z2 - z);
    }
    out.set(id, { id, type, contenu });
  }
  return out;
}

interface Extent {
  /** Position in the file. Set for method 0 only. */
  debut: number;
  longueur: number;
  /**
   * Where the two fields describing this range live in the file.
   *
   * Without them, `iloc` can only serve as a map. With them, a range can be
   * repointed without touching anything else, which is what makes adding
   * possible.
   */
  posOffset: number;
  largeurOffset: number;
  posLongueur: number;
  largeurLongueur: number;
}

interface Emplacements {
  id: number;
  /** 0 = offset in the file, 1 = in `idat`, 2 = in another item. */
  methode: number;
  /** Base offset, added to each range's own. */
  base: number;
  extents: Extent[];
}

/** Item location table (`iloc`). */
function lireIloc(b: Uint8Array, iloc: Boite): Emplacements[] {
  const version = b[iloc.debut + iloc.entete];
  let p = iloc.debut + iloc.entete + 4;
  const tailleOffset = b[p] >> 4;
  const tailleLongueur = b[p] & 0x0f;
  const tailleBase = b[p + 1] >> 4;
  const tailleIndex = version < 2 ? 0 : b[p + 1] & 0x0f;
  p += 2;
  const nombre = version < 2 ? readU16(b, p, 'BE') : readU32(b, p, 'BE');
  p += version < 2 ? 2 : 4;

  const lire = (n: number) => {
    const v = lireEntierBE(b, p, n);
    p += n;
    return v;
  };

  const out: Emplacements[] = [];
  const fin = iloc.debut + iloc.taille;
  for (let i = 0; i < nombre && p < fin; i++) {
    const id = version < 2 ? readU16(b, p, 'BE') : readU32(b, p, 'BE');
    p += version < 2 ? 2 : 4;
    let methode = 0;
    if (version >= 1) {
      methode = readU16(b, p, 'BE') & 0x0f;
      p += 2;
    }
    p += 2; // data_reference_index
    // The base offset is added to each range's own. Forgetting it reads in the
    // wrong place on any file that uses one.
    const base = lire(tailleBase);
    const nbExtents = readU16(b, p, 'BE');
    p += 2;
    const extents: Extent[] = [];
    for (let k = 0; k < nbExtents; k++) {
      if (tailleIndex > 0 && version >= 1) p += tailleIndex;
      const posOffset = p;
      const decalage = lire(tailleOffset);
      const posLongueur = p;
      const longueur = lire(tailleLongueur);
      extents.push({
        debut: base + decalage,
        longueur,
        posOffset,
        largeurOffset: tailleOffset,
        posLongueur,
        largeurLongueur: tailleLongueur,
      });
    }
    out.push({ id, methode, base, extents });
  }
  return out;
}

interface Structure {
  hautNiveau: Boite[];
  meta: Boite | null;
  metaEnfants: Boite[];
  /** The `iloc` box itself, to prove we only write inside it. */
  iloc: Boite | null;
  items: Map<number, Item>;
  emplacements: Emplacements[];
}

function lireStructure(b: Uint8Array): Structure {
  const hautNiveau = boites(b, 0, b.length);
  const meta = hautNiveau.find((x) => x.type === 'meta') ?? null;
  if (!meta) {
    return { hautNiveau, meta: null, metaEnfants: [], iloc: null, items: new Map(), emplacements: [] };
  }
  const metaEnfants = enfantsDeMeta(b, meta);
  const iinf = metaEnfants.find((x) => x.type === 'iinf');
  const iloc = metaEnfants.find((x) => x.type === 'iloc') ?? null;
  return {
    hautNiveau,
    meta,
    metaEnfants,
    iloc,
    items: iinf ? lireIinf(b, iinf) : new Map(),
    emplacements: iloc ? lireIloc(b, iloc) : [],
  };
}

/** Data the container keeps to itself between calls. */
interface Interne {
  extent: Extent;
  /** Bytes preceding the TIFF block in the item, to be preserved. */
  longueurPrefixe: number;
  /** The entry's base offset. Must be zero before we dare repoint. */
  base: number;
}

/**
 * True if this file tolerates a box being appended at the end and the entry
 * describing `interne` being repointed.
 *
 * All the safety of adding lives here. `reconstruire` bypasses the facade's
 * range accounting, which is the interface's contract, so the refusals that
 * protect the file must be carried by this module, explicitly, and before a
 * byte is written.
 */
function tolereLAjout(b: Uint8Array, interne: Interne, tailleCharge: number): boolean {
  const s = lireStructure(b);
  if (!s.iloc) return false;

  const derniere = s.hautNiveau[s.hautNiveau.length - 1];
  if (!derniere) return false;
  // A box declaring size 0 extends to the end of the file: it would swallow
  // the box we append behind it, and our location block would become image
  // data as far as any reader is concerned.
  if (derniere.declaree === 0) return false;
  // Bytes no box claims mean our reading of the structure is wrong somewhere.
  // Nothing is built on a doubtful map.
  if (derniere.debut + derniere.taille !== b.length) return false;

  const { extent, base } = interne;
  // Measured as zero on all six files in the corpus. A non-zero base offset
  // can be handled in theory; we have no file to test it on.
  if (base !== 0) return false;
  if (extent.largeurOffset === 0 || extent.largeurLongueur === 0) return false;

  // The two fields we are about to rewrite must fall strictly inside `iloc`.
  // Without that proof, a miscalculated offset would write into an item.
  const dedans = (p: number, w: number) =>
    p >= s.iloc!.debut + s.iloc!.entete && p + w <= s.iloc!.debut + s.iloc!.taille;
  if (!dedans(extent.posOffset, extent.largeurOffset)) return false;
  if (!dedans(extent.posLongueur, extent.largeurLongueur)) return false;

  // The new offset and length must fit in the width the table declares for its
  // own fields. Widening it would move the table itself, and so everything
  // else, which is exactly what we refuse to do.
  if (b.length + 8 > 256 ** extent.largeurOffset - 1) return false;
  if (tailleCharge > 256 ** extent.largeurLongueur - 1) return false;
  return true;
}

/**
 * True if the file stores a copy of the location outside the main block, in a
 * form we cannot remove.
 *
 * Erasing the main block and leaving that copy would hand back a file the user
 * believes is clean. The erase is refused rather than produced.
 */
export function copieDuLieuAilleurs(b: Uint8Array): boolean {
  const s = lireStructure(b);
  for (const emp of s.emplacements) {
    if (emp.methode !== 0 || emp.extents.length === 0) continue;
    const item = s.items.get(emp.id);
    if (!item || item.type !== 'mime') continue;
    if (!/xml|xmp|rdf/i.test(item.contenu)) continue;
    const extent = emp.extents[0];
    if (extent.debut + extent.longueur > b.length) continue;
    // Decoded through TextDecoder: spreading 256 KB of bytes as arguments to
    // String.fromCharCode would overflow the call stack.
    const contenu = new TextDecoder('utf-8', { fatal: false }).decode(
      b.subarray(extent.debut, extent.debut + Math.min(extent.longueur, 256 * 1024)),
    );
    if (MARQUEURS_DE_LIEU.some((m) => contenu.includes(m))) return true;
  }
  return false;
}

// One implementation for both HEIC and AVIF: the structure is the same box by
// box, only the leading brand differs. The `format` field is informative.
export const conteneurIsobmff: Conteneur = {
  format: 'heic',

  reconnait(b) {
    const f = detecterFormat(b);
    return f === 'heic' || f === 'avif';
  },

  localiser(b) {
    const s = lireStructure(b);
    if (!s.meta) return [];
    const out: Emplacement[] = [];

    for (const emp of s.emplacements) {
      const item = s.items.get(emp.id);
      if (!item || item.type !== 'Exif') continue;
      // Methods 1 and 2 store the payload somewhere other than the file
      // itself. No public file exercises them on a location block, and
      // shipping a write we cannot test is exactly what this project does not
      // do.
      if (emp.methode !== 0) continue;
      // Several ranges would mean a discontiguous block, which our internal
      // offsets know nothing about.
      if (emp.extents.length !== 1) continue;

      const extent = emp.extents[0];
      if (extent.debut < 0 || extent.debut + extent.longueur > b.length) continue;
      if (extent.longueur < 12) continue;

      // The payload starts with the number of bytes between the end of that
      // field and the start of the TIFF header. Apple and Sony put 6 there and
      // write "Exif\0\0"; libavif puts 0.
      const saut = readU32(b, extent.debut, 'BE');
      const longueurPrefixe = 4 + saut;
      const debut = extent.debut + longueurPrefixe;
      if (longueurPrefixe > extent.longueur - 8) continue;
      const ok =
        (b[debut] === 0x49 && b[debut + 1] === 0x49) || (b[debut] === 0x4d && b[debut + 1] === 0x4d);
      if (!ok) continue;

      out.push({
        tiff: b.subarray(debut, extent.debut + extent.longueur),
        debut,
        interne: { extent, longueurPrefixe, base: emp.base } satisfies Interne,
      });
    }
    return out;
  },

  /**
   * The map is built from the item ranges, never from the top-level boxes: the
   * location block lives inside the large data box, which would otherwise claim
   * the whole file and forbid any write. Every other item's ranges are claimed
   * without exception, which is what protects the thumbnail and the secondary
   * images whether or not we know what they are.
   */
  plagesRevendiquees(b, vise) {
    const s = lireStructure(b);
    const plages: Plage[] = [];

    for (const boite of s.hautNiveau) {
      // Every box header, always; and the description boxes whole, since an
      // item is never stored in one.
      plages.push([boite.debut, boite.debut + boite.entete]);
      if (boite.type === 'ftyp' || boite.type === 'meta' || boite.type === 'free') {
        plages.push([boite.debut, boite.debut + boite.taille]);
      }
    }
    for (const enfant of s.metaEnfants) {
      if (enfant.type === 'idat') plages.push([enfant.debut, enfant.debut + enfant.taille]);
    }

    const interne = vise.interne as Interne;
    for (const emp of s.emplacements) {
      for (const extent of emp.extents) {
        if (emp.methode !== 0) continue;
        if (extent.debut === interne.extent.debut && extent.longueur === interne.extent.longueur) {
          // The targeted item: only its prefix is claimed, the TIFF block is
          // the permitted area.
          plages.push([extent.debut, extent.debut + interne.longueurPrefixe]);
          continue;
        }
        plages.push([extent.debut, extent.debut + extent.longueur]);
      }
    }
    return plages;
  },

  reecrireSurPlace(b, vise, tiff) {
    const out = new Uint8Array(b);
    out.set(tiff, vise.debut);
    return out;
  },

  /**
   * Adds a location to a photo that carries none, without growing anything in
   * place.
   *
   * The new block goes into an `mdat` box appended at the end of the file, and
   * the single `iloc` entry for the location item is repointed. No other offset
   * becomes wrong, since no other byte moves: the old content becomes dead
   * space, exactly like the old IFD0 in P2. Three bytes change outside the
   * appended box, the offset and length of that one entry, and they are
   * declared.
   *
   * Measured on four real photos before this method was written: ExifTool reads
   * the location back at its new place and validates the file, libheif decodes
   * it, and Chromium's AVIF decoder accepts it.
   */
  reconstruire(b, vise, tiff): Pose {
    // Creating a location item where there is none would need one more
    // description in the item table, so growing the box containing it, so
    // shifting everything after. It is the only operation this route cannot
    // do, and the interface says so beforehand.
    if (!vise) throw AJOUT_IMPOSSIBLE();
    const interne = vise.interne as Interne;
    const { extent } = interne;

    const charge = new Uint8Array(interne.longueurPrefixe + tiff.length);
    charge.set(b.subarray(extent.debut, extent.debut + interne.longueurPrefixe), 0);
    charge.set(tiff, interne.longueurPrefixe);

    if (!tolereLAjout(b, interne, charge.length)) throw AJOUT_IMPOSSIBLE();

    const out = new Uint8Array(b.length + 8 + charge.length);
    out.set(b, 0);
    writeU32(out, b.length, 8 + charge.length, 'BE');
    out.set([0x6d, 0x64, 0x61, 0x74], b.length + 4); // « mdat »
    out.set(charge, b.length + 8);

    ecrireEntierBE(out, extent.posOffset, extent.largeurOffset, b.length + 8);
    ecrireEntierBE(out, extent.posLongueur, extent.largeurLongueur, charge.length);

    return {
      bytes: out,
      changed: [
        [extent.posOffset, extent.posOffset + extent.largeurOffset],
        [extent.posLongueur, extent.posLongueur + extent.largeurLongueur],
        [b.length, out.length],
      ],
    };
  },

  /**
   * Adding is decided file by file rather than format by format: it depends on
   * how this file arranges its items. The interface therefore announces the
   * route before the action, and never offers a write we cannot deliver.
   */
  accepteAjout(b) {
    const vise = conteneurIsobmff.localiser(b)[0];
    if (!vise) return false;
    const interne = vise.interne as Interne;
    // A generous margin: the exact payload is only known at write time, and
    // `reconstruire` is what proves it. Here we announce without overpromising.
    return tolereLAjout(b, interne, interne.longueurPrefixe + vise.tiff.length + 512);
  },

  // No `toutEffacer`: removing all information from such a file would mean
  // rebuilding it, which this module cannot do.

  copieDuLieuAilleurs,
};

/** Fingerprint of the item location table, to prove it has not moved. */
export function empreinteDesEmplacements(b: Uint8Array): string {
  const s = lireStructure(b);
  return s.emplacements
    .map((e) => `${e.id}:${e.methode}:${e.extents.map((x) => `${x.debut}+${x.longueur}`).join(',')}`)
    .join('|');
}

/** The file's items, for a before and after check. */
export function itemsDuFichier(b: Uint8Array): Array<{ id: number; type: string; debut: number; longueur: number }> {
  const s = lireStructure(b);
  const out: Array<{ id: number; type: string; debut: number; longueur: number }> = [];
  for (const emp of s.emplacements) {
    if (emp.methode !== 0) continue;
    for (const x of emp.extents) {
      out.push({ id: emp.id, type: s.items.get(emp.id)?.type ?? '?', debut: x.debut, longueur: x.longueur });
    }
  }
  return out.sort((a, z) => a.debut - z.debut);
}
