/**
 * Le parcours de boîtes, commun aux images et aux vidéos.
 *
 * HEIC, AVIF, MOV et MP4 sont le même emballage : une suite de boîtes qui se
 * contiennent les unes les autres. Ce qu'elles portent n'a rien à voir — une
 * photo range un bloc TIFF dans un item, une vidéo range une chaîne de
 * coordonnées dans `moov` — mais la façon d'y descendre est identique, et elle
 * a assez de pièges pour ne mériter qu'une seule implémentation.
 *
 * Ce module ne connaît donc AUCUN des deux usages. Il ne sait que lire des
 * en-têtes et descendre d'un cran ; qui cherche quoi est l'affaire de
 * `isobmff.ts` et de `quicktime.ts`.
 */

import { lireEntierBE, readU32 } from './octets.ts';

export interface Boite {
  type: string;
  debut: number;
  /** Longueur de l'en-tête, charge utile exclue. */
  entete: number;
  /** Longueur totale, en-tête compris. */
  taille: number;
  /**
   * Taille telle qu'elle est ÉCRITE dans le fichier, avant interprétation.
   *
   * La valeur 0 signifie « jusqu'à la fin du fichier ». Une fois résolue en
   * longueur effective, cette nuance disparaît — et elle est décisive pour
   * l'ajout : ajouter une boîte derrière une boîte qui s'étend jusqu'à la fin
   * la ferait avaler par elle.
   */
  declaree: number;
}

export const texte = (b: Uint8Array, o: number, n: number) =>
  String.fromCharCode(...b.subarray(o, o + n));

/** Premier octet de la charge utile d'une boîte. */
export const charge = (x: Boite) => x.debut + x.entete;

/** Premier octet APRÈS la boîte. */
export const finDe = (x: Boite) => x.debut + x.taille;

/**
 * Parcourt une suite de boîtes.
 *
 * Trois formes d'en-tête existent et se rencontrent toutes dans la nature :
 * une taille sur 32 bits, la valeur 1 qui renvoie à une taille sur 64 bits, et
 * la valeur 0 qui signifie « jusqu'à la fin du fichier » — courante sur les
 * grosses boîtes de données écrites en flux. Un parcours qui ignore les deux
 * dernières s'arrête trop tôt et conclut qu'il n'y a pas de position.
 */
export function boites(b: Uint8Array, debut: number, fin: number): Boite[] {
  const out: Boite[] = [];
  let o = debut;
  while (o + 8 <= fin) {
    const declaree = readU32(b, o, 'BE');
    let taille = declaree;
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
    out.push({ type, debut: o, entete, taille, declaree });
    o += taille;
  }
  return out;
}

/**
 * Combien d'octets séparent l'en-tête d'une boîte de ses enfants.
 *
 * Presque toujours zéro. Trois exceptions, et les trois se rencontrent dans les
 * fichiers réels : `meta` est une FullBox — quatre octets de version et de
 * drapeaux d'abord — et `stsd` et `dref` font suivre ces quatre octets d'un
 * compte sur quatre octets de plus.
 */
function preambule(type: string): number {
  if (type === 'meta') return 4;
  if (type === 'stsd' || type === 'dref') return 8;
  return 0;
}

/**
 * Enfants directs d'une boîte.
 *
 * **L'appelant doit savoir que cette boîte en CONTIENT d'autres.** Cette
 * fonction lit des octets ; elle n'a aucun moyen de deviner qu'on lui présente
 * une feuille, et elle ne prétendra jamais le savoir. La charge utile d'un
 * `tkhd` ou d'un `stsz` est faite de nombres, et des nombres se lisent très
 * bien comme des en-têtes plausibles : on obtient alors des boîtes qui
 * n'existent pas. `contientDesBoites` est là pour cette question, et un
 * parcours d'arbre doit s'en servir avant de descendre.
 *
 * `meta` mérite une précaution : c'est une FullBox, mais des outils dérivés de
 * QuickTime l'écrivent comme une boîte ordinaire — `QuickTime.mov` d'ExifTool
 * en est un. Plutôt que de deviner, on essaie les deux préambules et on retient
 * celui qui produit une suite de boîtes qui remplit exactement le parent. Une
 * lecture décalée de quatre octets produit des tailles absurdes, donc s'arrête
 * court : c'est ce qui les départage.
 */
export function enfants(b: Uint8Array, parent: Boite): Boite[] {
  const fin = finDe(parent);
  const candidats = parent.type === 'meta' ? [4, 0] : [preambule(parent.type)];
  let repli: Boite[] = [];
  for (const decalage of candidats) {
    const debut = charge(parent) + decalage;
    if (debut > fin) continue;
    const liste = boites(b, debut, fin);
    if (liste.length && finDe(liste[liste.length - 1]) === fin) return liste;
    if (liste.length > repli.length) repli = liste;
  }
  return repli;
}

/**
 * Descend un chemin de types, par exemple `moov/udta`.
 *
 * Rend la première boîte de chaque cran — un fichier bien formé n'a qu'un
 * `moov` et qu'un `udta`. Rend `null` dès qu'un cran manque, plutôt que de
 * chercher plus loin : une boîte trouvée au mauvais endroit ne veut rien dire.
 */
export function chemin(b: Uint8Array, route: string, racine?: Boite[]): Boite | null {
  let niveau = racine ?? boites(b, 0, b.length);
  let trouvee: Boite | null = null;
  for (const cran of route.split('/')) {
    const suivante = niveau.find((x) => x.type === cran);
    if (!suivante) return null;
    trouvee = suivante;
    niveau = enfants(b, suivante);
  }
  return trouvee;
}

/**
 * Les boîtes qui en contiennent d'autres.
 *
 * Entrer dans `mdat` — les images et le son, l'essentiel du poids — reviendrait
 * à interpréter des octets de pixels comme des en-têtes : on y trouverait des
 * boîtes qui n'existent pas, sur des mégaoctets, à chaque appel. Le même
 * raisonnement vaut pour toutes les feuilles, `tkhd` et `stsz` comprises, dont
 * la charge est faite de nombres qui se lisent hélas très bien comme des
 * en-têtes.
 *
 * Cette liste est donc la réponse à une seule question, et TOUT parcours
 * d'arbre doit la poser avant de descendre d'un cran. Elle a été privée
 * pendant un lot, et le contrôle d'après écriture des vidéos — qui descendait
 * dans les feuilles — refusait de ce fait toutes les vidéos réelles.
 */
const CONTENEUSES = new Set([
  'moov', 'trak', 'edts', 'mdia', 'minf', 'dinf', 'stbl', 'mvex', 'moof',
  'traf', 'mfra', 'udta', 'meta', 'ilst', 'stsd', 'gmhd', 'tapt',
]);

/** Vrai si une boîte de ce type contient d'autres boîtes plutôt que des données. */
export function contientDesBoites(type: string): boolean {
  return CONTENEUSES.has(type);
}

/** Toutes les boîtes d'un type donné, à n'importe quelle profondeur. */

export function toutesLesBoites(
  b: Uint8Array,
  type: string,
  racine?: Boite[],
): Boite[] {
  const out: Boite[] = [];
  const descendre = (niveau: Boite[], profondeur: number) => {
    // Une profondeur bornée : un fichier abîmé peut décrire une imbrication
    // qui ne finit pas, et le parcours doit s'arrêter avant la pile.
    if (profondeur > 12) return;
    for (const x of niveau) {
      if (x.type === type) out.push(x);
      if (CONTENEUSES.has(x.type)) descendre(enfants(b, x), profondeur + 1);
    }
  };
  descendre(racine ?? boites(b, 0, b.length), 0);
  return out;
}
