/**
 * Conteneur WebP — le bloc TIFF vit dans un morceau `EXIF`.
 *
 * Un WebP se présente sous deux formes. La forme étendue commence par un
 * morceau d'en-tête qui déclare ce que le fichier contient, et c'est la seule
 * qui prévoie une place pour un lieu. La forme simple n'en prévoit aucune : lui
 * en créer une demanderait de relire les dimensions dans le flux compressé,
 * avec deux décodeurs d'en-tête distincts selon le mode d'encodage — pour un
 * fichier où, par construction, il n'y a jamais rien à corriger. Elle reste
 * donc en lecture seule, et l'interface le dit avant l'action.
 *
 * Trois travers de vrais fichiers, tous rencontrés dans le corpus :
 *   - le morceau `EXIF` porte PARFOIS le préambule d'un JPEG avant le bloc
 *     TIFF, que la spécification interdit. On l'accepte en lecture et on le
 *     rend tel quel, on n'en écrit jamais ;
 *   - le morceau de texte descriptif s'appelle parfois `XMP\0` au lieu de
 *     `XMP ` ;
 *   - les drapeaux de l'en-tête MENTENT : un fichier du corpus porte un
 *     morceau de texte que ses drapeaux ne déclarent pas. On lit donc la liste
 *     réelle des morceaux, jamais les drapeaux seuls.
 */

import { ExifError } from './erreurs.ts';
import { readU32, writeU32 } from './octets.ts';
import { porteUnLieu, purgerLeLieu } from './xmp.ts';
import type { Conteneur, Emplacement, Plage, Pose } from './conteneurs.ts';

const PREFIXE_EXIF = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // « Exif\0\0 »

// Drapeaux de l'en-tête étendu, vérifiés contre la source de libwebp.
const DRAPEAU_EXIF = 0x08;
const DRAPEAU_XMP = 0x04;

interface Morceau {
  type: string;
  /** Début du champ de type. */
  debut: number;
  /** Début des données. */
  donnees: number;
  longueur: number;
  /** Fin exclusive, octet de bourrage compris. */
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
    // Un morceau de longueur impaire est suivi d'un octet de bourrage, qui
    // compte dans la taille du fichier mais pas dans celle du morceau.
    out.push({ type, debut: o, donnees: o + 8, longueur, fin: o + 8 + longueur + (longueur & 1) });
    o = out[out.length - 1].fin;
  }
  return out;
}

const estXmp = (m: Morceau) => m.type === 'XMP ' || m.type === 'XMP\0';

/** Vrai si la taille déclarée par l'en-tête correspond au fichier reçu. */
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

/** Reconstruit le fichier à partir d'une liste de morceaux déjà sérialisés. */
function reconstruireFichier(b: Uint8Array, corps: Uint8Array[]): Uint8Array {
  const entete = new Uint8Array(12);
  entete.set(b.subarray(0, 12), 0);
  const bytes = assembler([entete, ...corps]);
  // La taille déclarée couvre les morceaux qui suivent, plus les quatre octets
  // de la marque « WEBP ».
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
   * L'ajout n'est ouvert qu'à la forme étendue, et seulement quand la taille
   * déclarée correspond au fichier reçu : des octets parasites en queue sont
   * fréquents, et on ne sait pas si un lecteur tiers leur donne un sens.
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
      // La spécification impose que le morceau de position précède celui de
      // texte descriptif : on l'insère donc juste avant, s'il y en a un.
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
    // Les drapeaux doivent décrire ce qui est réellement là.
    const nouveauVp8x = morceaux(bytes).find((m) => m.type === 'VP8X');
    if (nouveauVp8x) bytes[nouveauVp8x.donnees] |= DRAPEAU_EXIF;

    return {
      bytes,
      // La taille globale est en tête, le morceau ajouté plus loin : les deux
      // plages sont annoncées, rien d'autre ne bouge.
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
    // Le profil de couleurs (`ICCP`) est conservé : le perdre décalerait
    // visiblement les couleurs, ce que personne n'a demandé.
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
