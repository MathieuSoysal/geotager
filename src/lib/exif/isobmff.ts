/**
 * Conteneur HEIC / AVIF — localiser le bloc TIFF parmi les items.
 *
 * Une photo d'iPhone range son bloc TIFF dans un item de sa boîte `meta`, au
 * milieu de cinquante autres items qui portent les tuiles de l'image. Une fois
 * ce bloc localisé, `tiff.ts` fait exactement le travail qu'il fait sur un
 * JPEG. Vérifié sur de vraies photos : corriger un lieu déjà présent y coûte
 * quinze octets, l'effacer cent quatre, et rien d'autre ne bouge.
 *
 * Ce module ne sait PAS écrire un conteneur ISOBMFF, et n'a pas à le savoir.
 * Toutes les opérations offertes ici sont à longueur strictement constante :
 * la longueur de l'item ne change pas, donc la table des emplacements ne change
 * pas, donc aucun décalage d'aucun autre item ne devient faux. `iloc` n'est
 * jamais écrit — il sert de carte, et on vérifie ensuite qu'il est intact.
 *
 * D'où l'absence de `reconstruire` : ajouter un lieu à une photo qui n'en porte
 * aucune ferait grandir l'item, et c'est la seule opération qui demanderait un
 * écrivain. Elle reste hors de portée, et l'interface le dit avant l'action.
 */

import { lireEntierBE, readU16, readU32 } from './octets.ts';
import { type Conteneur, type Emplacement, type Plage } from './conteneurs.ts';
import { detecterFormat } from './conteneurs.ts';

interface Boite {
  type: string;
  debut: number;
  /** Longueur de l'en-tête, charge utile exclue. */
  entete: number;
  /** Longueur totale, en-tête compris. */
  taille: number;
}

const texte = (b: Uint8Array, o: number, n: number) =>
  String.fromCharCode(...b.subarray(o, o + n));

/**
 * Parcourt une suite de boîtes.
 *
 * Trois formes d'en-tête existent et se rencontrent toutes dans la nature :
 * une taille sur 32 bits, la valeur 1 qui renvoie à une taille sur 64 bits, et
 * la valeur 0 qui signifie « jusqu'à la fin du fichier » — courante sur les
 * grosses boîtes de données écrites en flux. Un parcours qui ignore les deux
 * dernières s'arrête trop tôt et conclut qu'il n'y a pas de métadonnées.
 */
function boites(b: Uint8Array, debut: number, fin: number): Boite[] {
  const out: Boite[] = [];
  let o = debut;
  while (o + 8 <= fin) {
    let taille = readU32(b, o, 'BE');
    const type = texte(b, o + 4, 4);
    let entete = 8;
    if (taille === 1) {
      if (o + 16 > fin) break;
      taille = lireEntierBE(b, o + 8, 8);
      entete = 16;
    } else if (taille === 0) {
      taille = fin - o;
    }
    if (type === 'uuid') entete += 16;
    if (taille < entete || o + taille > fin) break;
    out.push({ type, debut: o, entete, taille });
    o += taille;
  }
  return out;
}

/**
 * Sous-boîtes de `meta`.
 *
 * `meta` est une FullBox : quatre octets de version et de drapeaux précèdent
 * ses enfants. Des outils dérivés de QuickTime l'écrivent pourtant comme une
 * boîte ordinaire. Plutôt que de deviner, on essaie les deux et on retient
 * celle qui produit une table des emplacements.
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
  /** Renseigné pour les items de type `mime` : le type du contenu. */
  contenu: string;
}

/** Table des descriptions d'items (`iinf` / `infe`). */
function lireIinf(b: Uint8Array, iinf: Boite): Map<number, Item> {
  const out = new Map<number, Item>();
  const version = b[iinf.debut + iinf.entete];
  let p = iinf.debut + iinf.entete + 4;
  p += version === 0 ? 2 : 4; // entry_count
  const fin = iinf.debut + iinf.taille;

  for (const boite of boites(b, p, fin)) {
    if (boite.type !== 'infe') continue;
    const v = b[boite.debut + boite.entete];
    // Les versions 0 et 1 ne portent pas de type d'item : elles décrivent des
    // ressources d'un autre âge, jamais un bloc de position. On les ignore
    // plutôt que d'inventer un type.
    if (v < 2) continue;
    let q = boite.debut + boite.entete + 4;
    const tailleId = v === 3 ? 4 : 2;
    const id = tailleId === 4 ? readU32(b, q, 'BE') : readU16(b, q, 'BE');
    q += tailleId + 2; // + item_protection_index
    const type = texte(b, q, 4);
    q += 4;
    let contenu = '';
    if (type === 'mime') {
      // item_name, puis content_type, l'un et l'autre terminés par un zéro.
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
  /** Position dans le fichier. Renseignée pour la méthode 0 seulement. */
  debut: number;
  longueur: number;
}

interface Emplacements {
  id: number;
  /** 0 = décalage dans le fichier, 1 = dans `idat`, 2 = dans un autre item. */
  methode: number;
  extents: Extent[];
}

/** Table des emplacements (`iloc`). */
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
    // Le décalage de base s'AJOUTE à celui de chaque plage. L'oublier fait lire
    // à côté sur tout fichier qui s'en sert.
    const base = lire(tailleBase);
    const nbExtents = readU16(b, p, 'BE');
    p += 2;
    const extents: Extent[] = [];
    for (let k = 0; k < nbExtents; k++) {
      if (tailleIndex > 0 && version >= 1) p += tailleIndex;
      const decalage = lire(tailleOffset);
      const longueur = lire(tailleLongueur);
      extents.push({ debut: base + decalage, longueur });
    }
    out.push({ id, methode, extents });
  }
  return out;
}

interface Structure {
  hautNiveau: Boite[];
  meta: Boite | null;
  metaEnfants: Boite[];
  items: Map<number, Item>;
  emplacements: Emplacements[];
}

function lireStructure(b: Uint8Array): Structure {
  const hautNiveau = boites(b, 0, b.length);
  const meta = hautNiveau.find((x) => x.type === 'meta') ?? null;
  if (!meta) return { hautNiveau, meta: null, metaEnfants: [], items: new Map(), emplacements: [] };
  const metaEnfants = enfantsDeMeta(b, meta);
  const iinf = metaEnfants.find((x) => x.type === 'iinf');
  const iloc = metaEnfants.find((x) => x.type === 'iloc');
  return {
    hautNiveau,
    meta,
    metaEnfants,
    items: iinf ? lireIinf(b, iinf) : new Map(),
    emplacements: iloc ? lireIloc(b, iloc) : [],
  };
}

/** Données que le conteneur garde pour lui d'un appel à l'autre. */
interface Interne {
  extent: Extent;
  /** Octets qui précèdent le bloc TIFF dans l'item, à préserver. */
  longueurPrefixe: number;
}

const MARQUEURS_DE_LIEU = [
  'exif:GPSLatitude',
  'exif:GPSLongitude',
  'Iptc4xmpExt:LocationCreated',
  'photoshop:City',
  'photoshop:State',
  'photoshop:Country',
];

/**
 * Vrai si le fichier range une copie du lieu ailleurs que dans le bloc
 * principal, sous une forme que nous ne savons pas retirer.
 *
 * Effacer le bloc principal en laissant cette copie rendrait un fichier que
 * l'utilisateur croirait propre : c'est le pire résultat possible pour cet
 * outil. On refuse l'effacement plutôt que de le produire.
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
    // Décodage par TextDecoder : étaler 256 Ko d'octets en arguments de
    // String.fromCharCode ferait déborder la pile d'appels.
    const contenu = new TextDecoder('utf-8', { fatal: false }).decode(
      b.subarray(extent.debut, extent.debut + Math.min(extent.longueur, 256 * 1024)),
    );
    if (MARQUEURS_DE_LIEU.some((m) => contenu.includes(m))) return true;
  }
  return false;
}

// Une seule implémentation pour HEIC et AVIF : la structure est la même boîte
// à boîte, seule la marque de tête change. Le champ `format` est informatif.
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
      // Les méthodes 1 et 2 rangent la charge utile ailleurs que dans le
      // fichier lui-même. Aucun fichier public ne les exerce sur un bloc de
      // position : livrer une écriture qu'on ne peut pas éprouver serait
      // exactement ce que la règle du projet interdit.
      if (emp.methode !== 0) continue;
      // Plusieurs plages voudraient dire un bloc discontinu, dont nos décalages
      // internes ne savent rien.
      if (emp.extents.length !== 1) continue;

      const extent = emp.extents[0];
      if (extent.debut < 0 || extent.debut + extent.longueur > b.length) continue;
      if (extent.longueur < 12) continue;

      // La charge utile commence par le nombre d'octets qui séparent la fin de
      // ce champ du début de l'en-tête TIFF. Apple et Sony y mettent 6 et
      // écrivent « Exif\0\0 » ; libavif y met 0.
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
        interne: { extent, longueurPrefixe } satisfies Interne,
      });
    }
    return out;
  },

  /**
   * La carte est bâtie sur les PLAGES DES ITEMS, jamais sur les boîtes de haut
   * niveau : le bloc de position vit à l'intérieur de la grande boîte de
   * données, qui revendiquerait sinon tout le fichier et interdirait la moindre
   * écriture. Toutes les plages des autres items sont revendiquées sans
   * exception — c'est ce qui protège la vignette et les images secondaires,
   * qu'on sache ou non ce qu'elles sont.
   */
  plagesRevendiquees(b, vise) {
    const s = lireStructure(b);
    const plages: Plage[] = [];

    for (const boite of s.hautNiveau) {
      // L'en-tête de chaque boîte, toujours ; et les boîtes de description en
      // entier, car un item ne s'y range jamais.
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
          // L'item visé : seul son préfixe est revendiqué, le bloc TIFF est la
          // zone autorisée.
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

  // Pas de `reconstruire` : voir l'en-tête du module. C'est cette absence, et
  // rien d'autre, qui ferme la colonne « Ajouter » du tableau.
  // Pas de `toutEffacer` non plus : retirer toutes les informations d'un tel
  // fichier demanderait de le reconstruire.

  copieDuLieuAilleurs,
};

/** Empreinte de la table des emplacements, pour prouver qu'elle n'a pas bougé. */
export function empreinteDesEmplacements(b: Uint8Array): string {
  const s = lireStructure(b);
  return s.emplacements
    .map((e) => `${e.id}:${e.methode}:${e.extents.map((x) => `${x.debut}+${x.longueur}`).join(',')}`)
    .join('|');
}

/** Les items du fichier, pour un contrôle avant/après. */
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
