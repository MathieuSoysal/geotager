/**
 * Conteneur PNG — le bloc TIFF vit dans un morceau `eXIf`.
 *
 * C'est le seul des formats traités ici où l'AJOUT est pleinement sûr : un PNG
 * ne contient aucun décalage absolu interne, donc insérer un morceau ou en
 * agrandir un n'invalide rien. D'où la présence de `reconstruire`, absente de
 * HEIC et de TIFF.
 *
 * Deux conséquences du format à ne pas perdre de vue :
 *   - chaque morceau porte une somme de contrôle, qu'il faut refaire dès qu'on
 *     touche à son contenu. Cette somme est hors du bloc TIFF : le conteneur la
 *     déclare comme une plage de service, sinon la vérification « à l'octet
 *     près » la verrait comme une modification inexpliquée ;
 *   - un logiciel de retouche peut avoir rangé le lieu une seconde fois dans un
 *     morceau de texte. Effacer le premier en laissant le second rendrait un
 *     fichier que l'utilisateur croirait propre.
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
  /** Début du champ de longueur. */
  debut: number;
  /** Début des données. */
  donnees: number;
  longueur: number;
  /** Fin exclusive du morceau, somme de contrôle comprise. */
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

/** Mot-clé d'un morceau de texte, en tête de ses données. */
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
 * Un paquet de texte compressé n'est pas lisible par ce moteur, qui est
 * synchrone : `zTXt` l'est toujours, `iTXt` l'est quand son drapeau le dit.
 */
function estCompresse(b: Uint8Array, m: Morceau): boolean {
  if (m.type === 'zTXt') return true;
  if (m.type !== 'iTXt') return false;
  const cle = motCle(b, m);
  return b[m.donnees + cle.length + 1] === 1;
}

/** Début et longueur du texte d'un `iTXt` non compressé. */
function texteDeITXt(b: Uint8Array, m: Morceau): { debut: number; longueur: number } | null {
  if (m.type !== 'iTXt') return null;
  // mot-clé\0 drapeau(1) méthode(1) langue\0 mot-clé traduit\0 texte
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

/** Fabrique un morceau complet : longueur, type, données, somme. */
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
  /** Octets du préfixe « Exif\0\0 », si le fichier en portait un. */
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
      // La spécification veut un bloc TIFF nu ; certains outils y laissent
      // quand même le préambule d'un JPEG. On l'accepte en lecture et on le
      // rend tel quel, mais on n'en écrit jamais.
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

  // La somme de contrôle du morceau touché vit hors du bloc TIFF. Sans cette
  // déclaration, la vérification « à l'octet près » la verrait comme une
  // modification que personne n'a annoncée — et refuserait le fichier.
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

    // La spécification autorise `eXIf` partout entre l'en-tête et la fin, hors
    // des données d'image ; sa troisième édition resserre à « avant les données
    // d'image ». Juste après l'en-tête satisfait les deux, et n'entre en
    // conflit ni avec la palette ni avec une animation.
    const ihdr = liste.find((m) => m.type === 'IHDR');
    if (!ihdr) {
      throw new ExifError('FICHIER_CORROMPU', 'La structure de cette image est incohérente.');
    }
    const bytes = assembler([b.subarray(0, ihdr.fin), neuf, b.subarray(ihdr.fin)]);
    return { bytes, changed: [[ihdr.fin, Math.max(b.length, bytes.length)]] };
  },

  /**
   * Retire les informations descriptives, et garde le profil de couleurs.
   *
   * Perdre le profil décalerait visiblement les couleurs dans toute application
   * gérée en couleur : ce serait une dégradation de l'image, alors que
   * l'utilisateur a demandé le retrait d'informations.
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
        // On ne sait pas l'ouvrir : on ne peut donc ni affirmer qu'il porte un
        // lieu, ni affirmer le contraire. Le doute vaut refus.
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
