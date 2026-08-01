/**
 * Le lieu d'une vidéo — MOV et MP4.
 *
 * Rien ici ne ressemble au reste du moteur, et c'est voulu. Une photo range sa
 * position dans un bloc TIFF, en rationnels, à un seul endroit. Une vidéo la
 * range en TEXTE — une chaîne ISO 6709 comme `+43.9493+004.8055/` — et elle la
 * range à PLUSIEURS endroits à la fois, selon qui l'a écrite : Apple, Samsung
 * et Google ne choisissent pas le même. C'est cette multiplicité qui a tenu la
 * ligne du tableau fermée si longtemps, et c'est elle que ce module traite.
 *
 * Trois règles gouvernent tout ce qui suit, et elles comptent plus que le code.
 *
 *   1. TOUT OU RIEN. Un fichier dont un rangement dit un lieu et un autre en
 *      dit un second est un mensonge. On les réécrit tous, ou aucun.
 *   2. LA LONGUEUR NE CHANGE PAS. Une chaîne ISO 6709 peut s'écrire avec plus
 *      ou moins de décimales : on choisit le nombre de décimales qui retombe
 *      sur la longueur exacte de la chaîne d'origine. Aucun octet ne bouge,
 *      donc aucun décalage du fichier ne devient faux.
 *   3. ON REFUSE PLUTÔT QUE DE MENTIR. Une caméra d'action enregistre le lieu
 *      en continu, image par image, dans la piste des données. Nous savons le
 *      LIRE et nous ne savons pas le retirer. Effacer la seule copie visible
 *      rendrait un fichier que l'utilisateur croirait propre et qui ne l'est
 *      pas : c'est le pire résultat possible pour cet outil. On rend donc
 *      l'original intact, et on le dit.
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

/* ------------------------------------------------------------------ */
/* La chaîne ISO 6709                                                  */
/* ------------------------------------------------------------------ */

/**
 * Une position telle qu'une vidéo l'écrit : signe obligatoire, largeur fixe,
 * barre oblique finale.
 *
 * Les trois largeurs de la norme se rencontrent toutes : `+43.9493` est en
 * degrés, `+4356.958` en degrés et minutes, `+435657.5` en degrés, minutes et
 * secondes. Le nombre de chiffres AVANT la virgule est le seul indice — d'où
 * la lecture par groupes de deux, et non un `Number()` naïf qui rendrait
 * « 4356.958 degrés » et donc une position invalide, ou pire, valide et fausse.
 */
const ISO6709 =
  /^([+-])(\d{2,7}(?:\.\d+)?)([+-])(\d{3,8}(?:\.\d+)?)((?:[+-]\d+(?:\.\d+)?)?)\/?$/;

function sexagesimal(chiffres: string, largeurDegres: number): number | null {
  const point = chiffres.indexOf('.');
  const entiers = point < 0 ? chiffres.length : point;
  const supplement = entiers - largeurDegres;
  // 0 : degrés seuls. 2 : degrés et minutes. 4 : degrés, minutes et secondes.
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

/** Décode une chaîne de position de vidéo. Rend null plutôt que de deviner. */
export function lireIso6709(s: string): LatLon | null {
  const m = ISO6709.exec(s.trim());
  if (!m) return null;
  const lat = sexagesimal(m[2], 2);
  const lon = sexagesimal(m[4], 3);
  if (lat === null || lon === null) return null;
  return validerPosition({
    lat: m[1] === '-' ? -lat : lat,
    lon: m[3] === '-' ? -lon : lon,
  });
}

/** L'altitude éventuelle, telle quelle, pour la réécrire sans y toucher. */
function altitudeDe(s: string): string {
  return ISO6709.exec(s.trim())?.[5] ?? '';
}

/**
 * Écrit une position sur une longueur IMPOSÉE.
 *
 * La forme simple mesure `10 + a + b` caractères : signe, deux chiffres, point
 * et `a` décimales pour la latitude ; signe, trois chiffres, point et `b`
 * décimales pour la longitude ; la barre oblique finale. Choisir `a + b` donne
 * donc n'importe quelle longueur à partir de douze — et toute chaîne écrite
 * par un appareil réel est plus longue que cela.
 *
 * Rend null quand la longueur demandée ne peut pas être tenue exactement.
 * Approcher serait le seul endroit du module où l'on écrirait un lieu que
 * personne n'a demandé.
 */
export function ecrireIso6709(p: LatLon, longueur: number, altitude = ''): string | null {
  const decimales = longueur - 10 - altitude.length;
  // Neuf décimales valent moins d'un dixième de millimètre : au-delà, la
  // précision affichée serait une invention pure.
  if (decimales < 2 || decimales > 18) return null;
  const a = Math.min(9, Math.ceil(decimales / 2));
  const b = decimales - a;
  if (b < 1 || b > 9) return null;
  const signe = (v: number) => (v < 0 ? '-' : '+');
  const bloc = (v: number, entiers: number, d: number) =>
    signe(v) + Math.abs(v).toFixed(d).padStart(entiers + 1 + d, '0');
  const s = `${bloc(p.lat, 2, a)}${bloc(p.lon, 3, b)}${altitude}/`;
  return s.length === longueur ? s : null;
}

/* ------------------------------------------------------------------ */
/* Les rangements                                                      */
/* ------------------------------------------------------------------ */

/**
 * Un endroit du fichier qui porte une copie du lieu.
 *
 * `debutTexte`/`longueurTexte` désignent la chaîne SEULE, en coordonnées
 * fichier : c'est ce qu'on réécrit. `boite` désigne l'enveloppe entière, qui
 * est ce qu'on neutralise à l'effacement.
 */
export interface Porteur {
  sorte: 'xyz-udta' | 'xyz-ilst' | 'keys' | 'loci';
  boite: Boite;
  debutTexte: number;
  longueurTexte: number;
  texte: string;
  /** Coordonnées binaires d'un `loci`, en virgule fixe — pas de chaîne. */
  binaire?: { lon: number; lat: number };
  /** Le lieu écrit EN TOUTES LETTRES, quand le rangement en porte un. */
  nomDeLieu: { debut: number; longueur: number } | null;
}

/** Les quatre lettres que les rangements de type texte emploient pour le lieu. */
const TYPES_XYZ = ['©xyz', '@xyz'];

const CLE_APPLE = 'com.apple.quicktime.location.ISO6709';
const CLE_APPLE_NOM = 'com.apple.quicktime.location.name';

/**
 * `moov/udta/©xyz` et son cousin Samsung `@xyz`.
 *
 * Disposition : l'en-tête de huit octets, puis la longueur de la chaîne sur
 * deux octets, puis un code de langue sur deux octets, puis la chaîne.
 */
/**
 * La chaîne d'un atome texte d'`udta`, et où elle se trouve.
 *
 * Cette disposition sert au lieu comme au reste — `©mak`, `©mod`, `©ART` la
 * partagent avec `©xyz`. Elle est donc lue à un seul endroit : ce qui distingue
 * ces atomes est leur NOM, jamais leur forme.
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
 * `moov/udta/loci` — le rangement 3GPP, et le seul qui écrive le lieu EN
 * TOUTES LETTRES à côté des coordonnées.
 *
 * Disposition : version et drapeaux (4), langue (2), le NOM du lieu terminé
 * par un zéro, le rôle (1), puis longitude, latitude et altitude en virgule
 * fixe 16.16, quatre octets chacune.
 *
 * C'est le « Avignon » du registre : un fichier qui n'a plus de coordonnées
 * mais dit encore le nom de la ville n'est pas effacé.
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
 * Les listes d'éléments : `moov/udta/meta/ilst`, écrite par Google Photos, et
 * `moov/meta` d'Apple, dont les entrées sont numérotées et dont les noms
 * vivent dans une boîte `keys` séparée.
 *
 * Dans les deux cas la valeur est dans une boîte `data` : quatre octets de
 * type, quatre de langue, puis la charge.
 */
/**
 * La charge d'une entrée de liste : elle vit dans une boîte `data`, précédée de
 * quatre octets de type et de quatre de langue.
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
 * Les clés nommées d'Apple, appariées à leurs valeurs.
 *
 * `keys` porte les NOMS dans l'ordre, `ilst` porte les VALEURS numérotées : le
 * lien entre les deux est le RANG, et c'est la seule subtilité du rangement.
 * Elle est écrite ici une fois — le lecteur du lieu et celui des informations
 * s'en servent tous les deux, et ne peuvent donc pas en donner deux lectures
 * différentes.
 */
function entreesDesKeys(
  b: Uint8Array,
  racine: Boite[],
): Array<{ nom: string; entree: Boite; valeur: { debut: number; longueur: number } }> {
  const out: Array<{ nom: string; entree: Boite; valeur: { debut: number; longueur: number } }> = [];
  // TOUS les `meta` du fichier, et non le seul `moov/meta`. Un couple
  // nom/valeur reste un couple où qu'il soit accroché.
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

  // Clé en quatre lettres — ce qu'écrit Google Photos. Dans TOUS les `ilst` :
  // celui de `moov/udta/meta` est le plus courant, mais un fichier peut
  // accrocher le sien à `moov/meta`, et le lieu s'y lit tout aussi bien.
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

  // Apple : `keys` nomme, `ilst` numérote — l'appariement vit dans
  // `entreesDesKeys`, qui sert aussi à lire les informations du fichier.
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
      // Pas de coordonnées ici, seulement le lieu en toutes lettres. Il n'a
      // rien à porter à la lecture, mais il doit disparaître à l'effacement.
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

/** Les noms de clés, dans l'ordre : c'est leur RANG qui les relie aux valeurs. */
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

/** Toutes les copies du lieu que ce fichier porte, quel qu'en soit l'auteur. */
export function porteursDeLieu(b: Uint8Array): Porteur[] {
  const racine = boites(b, 0, b.length);
  // TOUS les `udta`, et non le seul `moov/udta` : une piste peut avoir le sien,
  // et un fichier peut en porter plusieurs. Un rangement compte où qu'il soit.
  const udtas = toutesLesBoites(b, 'udta', racine);
  return [
    ...udtas.flatMap((u) => porteursUdta(b, u)),
    ...udtas.flatMap((u) => porteurLoci(b, u)),
    ...porteursIlst(b, racine),
  ];
}

/* ------------------------------------------------------------------ */
/* Ce que la vidéo dit d'elle-même                                     */
/* ------------------------------------------------------------------ */

/**
 * Les informations affichables d'une vidéo.
 *
 * Le volet « autres informations » ne tenait qu'au second lecteur, celui écrit
 * par d'autres — et il n'ouvre ni MOV ni MP4. Quatre de ses cinq sources
 * étaient donc mortes pour une vidéo : elle n'avait rien à dire, et le volet
 * disparaissait. Ce qui suit va chercher, dans les boîtes que ce module sait
 * déjà parcourir, ce que le fichier porte réellement.
 *
 * UNE SEULE RÈGLE, et c'est celle de tout le moteur : on n'invente aucune
 * ligne. Un champ absent, vide, ou une date à zéro — ce que valent les
 * fichiers d'essai et les vidéos réencodées — ne produit rien du tout. Mieux
 * vaut un volet court qu'un volet qui affirme.
 */
export interface InfosVideo {
  takenAt: string | null;
  camera: string | null;
  details: Array<{ cle: string; value: string }>;
}

/** Secondes écoulées entre le début du calendrier QuickTime et celui d'Unix. */
const EPOQUE_QUICKTIME = Date.UTC(1904, 0, 1) / 1000;

/** Virgule fixe 16.16, telle que `tkhd` et `loci` l'écrivent tous les deux. */
const virguleFixe = (b: Uint8Array, o: number) => (readU32(b, o, 'BE') | 0) / 65536;

/** `h:mm:ss` ou `m:ss` — des chiffres, pas des mots : le worker n'a pas de dictionnaire. */
function duree(secondes: number): string {
  const t = Math.round(secondes);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const deux = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${deux(m)}:${deux(s)}` : `${m}:${deux(s)}`;
}

/**
 * Vrai si ce texte est affichable tel quel.
 *
 * Les atomes d'`udta` sont écrits dans un jeu de caractères que rien ne
 * déclare, et les fichiers anciens emploient celui du Macintosh. Nous n'avons
 * pas la table qui le convertit, et l'afficher octet pour octet donnerait du
 * charabia. Un champ qu'on ne sait pas lire ne s'affiche pas : c'est la même
 * règle que pour le reste du moteur, appliquée au texte.
 */
function affichable(s: string): boolean {
  for (const c of s) {
    const n = c.codePointAt(0)!;
    if (n < 0x20 || (n >= 0x7f && n <= 0x9f)) return false;
  }
  return s.length > 0;
}

/**
 * Les atomes texte d'`udta`, par nom.
 *
 * Deux dispositions se rencontrent, et il faut les deux : la forme QuickTime —
 * longueur sur deux octets, langue, chaîne — et la forme en boîte `data`, que
 * les outils dérivés d'iTunes emploient. `©day` est écrit tantôt dans l'une,
 * tantôt dans l'autre.
 */
function textesDUdta(b: Uint8Array, racine: Boite[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const udta of toutesLesBoites(b, 'udta', racine)) {
  for (const x of enfants(b, udta)) {
    const c = chaineDAtome(b, x) ?? valeurDeLEntree(b, x);
    if (!c) continue;
    const valeur = texte(b, c.debut, c.longueur).replace(/\0+$/, '').trim();
    // Le premier trouvé gagne : celui du film prime sur celui d'une piste.
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

  // L'appareil. Apple le nomme par clés, les autres par atomes texte.
  const marque = premier(cles.get('com.apple.quicktime.make'), atomes.get('©mak'));
  const modele = premier(cles.get('com.apple.quicktime.model'), atomes.get('©mod'));
  camera = [marque, modele].filter(Boolean).join(' ') || null;

  // La date. Celle qu'un appareil écrit vaut mieux que celle du conteneur : la
  // seconde est parfois l'heure du réencodage, et souvent à zéro.
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
     * Une date de conteneur n'est crédible que si elle est plausible.
     *
     * Zéro n'est pas le 1er janvier 1904, c'est une date absente — et beaucoup
     * d'outils écrivent à la place la valeur qui retombe pile sur le 1er
     * janvier 1970, ce qui est un remplissage tout autant. Le format QuickTime
     * date de 1991 : rien d'antérieur ne peut être une prise de vue. On
     * s'abstient donc plutôt que d'afficher une date que personne n'a vécue.
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

  // Les dimensions : celles de la première piste qui en déclare — la première
  // piste tout court peut être le son, qui n'en a pas.
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

  return { takenAt, camera, details };
}

/* ------------------------------------------------------------------ */
/* Le lieu qui bouge — ce qu'on ne sait pas retirer                     */
/* ------------------------------------------------------------------ */

/**
 * Descriptions de piste qui signalent un lieu enregistré en CONTINU.
 *
 * `gpmd` est le format des caméras GoPro, `camm` celui de Google, `mett` et
 * `rtmd` ceux de plusieurs fabricants. Les échantillons vivent dans la piste
 * des données, que ce moteur ne réécrit jamais — c'est ce qui permet de
 * travailler sur un fichier de plusieurs mégaoctets sans le décoder, et c'est
 * aussi ce qui rend leur effacement hors de portée.
 */
const PISTES_DE_LIEU = ['gpmd', 'camm', 'mett', 'rtmd', 'gps ', 'CAMM'];

/** Boîtes de `udta` qui portent un enregistrement continu que nous ne lisons pas. */
const CHARGES_OPAQUES = ['GPMF'];

/**
 * Vrai si ce fichier garde le lieu à un endroit que nous ne savons pas nettoyer.
 *
 * C'est la question qui décide de tout : elle ferme l'écriture ET l'effacement,
 * parce que corriger la copie visible en laissant la piste intacte produirait
 * un fichier qui AFFICHE un lieu et en RÉVÈLE un autre.
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

/* ------------------------------------------------------------------ */
/* Lire                                                                */
/* ------------------------------------------------------------------ */

/** Le lieu que porte un rangement, quelle que soit sa forme. */
function positionDe(p: Porteur): LatLon | null {
  return p.binaire
    ? validerPosition({ lat: p.binaire.lat, lon: p.binaire.lon })
    : lireIso6709(p.texte);
}

/**
 * La position d'une vidéo : celle du premier rangement qui en porte une.
 *
 * Et à défaut, celle du paquet de texte descriptif. Il vient en dernier parce
 * qu'on ne sait pas le réécrire — mais l'ignorer laissait l'outil dire « aucun
 * lieu » sur un fichier dont tous les autres lecteurs affichent le lieu.
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

/* ------------------------------------------------------------------ */
/* Les décalages absolus du fichier                                    */
/* ------------------------------------------------------------------ */

interface TableDeDecalages {
  /** Position fichier de chaque entrée, et sa largeur. */
  entrees: { pos: number; largeur: number; valeur: number }[];
}

/**
 * Toutes les entrées qui désignent un octet du fichier par son RANG absolu.
 *
 * Ce sont les tables `stco` (32 bits) et `co64` (64 bits) : elles disent où
 * commence chaque tronçon d'image et de son. Rien d'autre dans un fichier non
 * fragmenté ne porte un décalage absolu — c'est ce qui rend l'ajout possible,
 * et c'est ce qui le rendrait dangereux si on les oubliait.
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
 * Vrai si ce fichier tolère qu'on fasse grandir sa description.
 *
 * Deux refus, et ils sont de nature différente :
 *
 *   - Un fichier FRAGMENTÉ range des décalages absolus dans des endroits que
 *     ce module ne réécrit pas. On n'y touche pas.
 *   - Un décalage qui ne pointe nulle part — au-delà de la fin du fichier —
 *     signale une description qu'on n'a pas comprise. Le corriger serait
 *     empiler une conjecture sur une autre.
 *
 * Un fichier sans aucune entrée passe : il n'y a rien à corriger.
 */
export function accepteAjoutVideo(b: Uint8Array): boolean {
  const racine = boites(b, 0, b.length);
  const moov = racine.find((x) => x.type === 'moov');
  if (!moov) return false;
  if (racine.some((x) => x.type === 'moof' || x.type === 'sidx' || x.type === 'mfra')) {
    return false;
  }
  // Une boîte qui s'étend « jusqu'à la fin du fichier » avalerait tout ce
  // qu'on ajouterait derrière elle.
  if (racine.some((x) => x.declaree === 0 && finDe(x) === b.length)) return false;
  // Les boîtes dont nous remontons la taille doivent porter la leur sur quatre
  // octets. Une taille sur soixante-quatre bits s'écrit ailleurs — les quatre
  // premiers octets ne portent alors qu'un marqueur —, et la remonter à cet
  // endroit-là écraserait le marqueur au lieu de la taille. C'est assez rare
  // sur un `moov` pour n'avoir aucun fichier témoin, donc on refuse.
  const aResizer = [moov, ...enfants(b, moov).filter((x) => x.type === 'udta')];
  if (aResizer.some((x) => x.entete !== 8)) return false;
  const { entrees } = tableDeDecalages(b, racine);
  return entrees.every((e) => e.valeur > 0 && e.valeur < b.length);
}

/* ------------------------------------------------------------------ */
/* Écrire                                                              */
/* ------------------------------------------------------------------ */

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
 * Longueur d'une chaîne que nous écrivons nous-mêmes : `+DD.dddddd+DDD.dddddd/`.
 *
 * Six décimales valent onze centimètres. C'est délibérément plus fin que la
 * tolérance d'un mètre du contrôle final : une écriture ne doit pas passer de
 * justesse, elle doit passer largement.
 */
const LONGUEUR_NEUVE = 22;

/**
 * Écart au-delà duquel une réécriture sur place n'est plus acceptable.
 *
 * Le nombre de décimales est imposé par la longueur de la chaîne d'origine, et
 * une chaîne courte ne peut pas tout dire : `+43.9493+004.8055/` n'a que quatre
 * décimales, soit une grille de onze mètres. Sur un lieu qui tombe pile, la
 * réécriture est exacte ; sur un autre, elle rendrait un lieu voisin de celui
 * qu'on a demandé. On mesure donc ce qu'on vient d'écrire, et on change de voie
 * plutôt que d'inscrire un à-peu-près.
 */
const ECART_TOLERE_METRES = 0.5;

/**
 * Réécrit chaque copie du lieu, sans qu'aucun octet ne se déplace.
 *
 * Tout ou rien : on calcule d'abord les remplacements des porteurs, TOUS, et
 * l'on n'écrit qu'une fois qu'ils sont tous tenables. Un fichier à demi
 * corrigé porterait deux lieux différents.
 */
function corrigerSurPlace(b: Uint8Array, porteurs: Porteur[], p: LatLon): Pose | null {
  const remplacements: { debut: number; octets: Uint8Array }[] = [];

  for (const porteur of porteurs) {
    if (porteur.binaire) {
      // Un `loci` qui nomme encore l'ancienne ville mentirait, et le vider
      // raccourcirait la boîte.
      if (porteur.nomDeLieu) return null;
      const octets = new Uint8Array(8);
      const fixe = (v: number) => Math.round(v * 65536) | 0;
      writeU32(octets, 0, fixe(p.lon) >>> 0, 'BE');
      writeU32(octets, 4, fixe(p.lat) >>> 0, 'BE');
      // Même exigence que pour le texte, et elle n'est pas théorique : la
      // virgule fixe 16.16 avance par pas d'un soixante-cinq-millième de degré,
      // soit UN MÈTRE SEPT en latitude. Le pas de la grille est donc plus large
      // que la tolérance du contrôle final, et ce rangement-là ne peut pas
      // porter n'importe quel lieu.
      const relu = validerPosition({ lat: fixe(p.lat) / 65536, lon: fixe(p.lon) / 65536 });
      if (!relu || distanceMetres(relu, p) > ECART_TOLERE_METRES) return null;
      remplacements.push({ debut: porteur.debutTexte, octets });
      continue;
    }
    // Une entrée qui ne porte qu'un nom de lieu ne peut pas recevoir de
    // coordonnées : elle n'en a pas la place, et la vider raccourcirait la
    // boîte. On refuse la correction plutôt que de laisser le nom en place.
    if (porteur.longueurTexte === 0) return null;
    const s = ecrireIso6709(p, porteur.longueurTexte, altitudeDe(porteur.texte));
    if (s === null) return null;
    // On RELIT ce qu'on vient d'écrire. La longueur d'origine impose le nombre
    // de décimales, et une chaîne trop courte ne peut pas porter le lieu
    // demandé : mieux vaut changer de voie que d'inscrire son voisin.
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
 * Crée un lieu là où le fichier n'en portait aucun.
 *
 * Le nouveau rangement va dans `moov/udta`, qui est le seul que tous les
 * lecteurs comprennent. Le fichier grandit, donc tout ce qui suit le point
 * d'insertion se décale — d'où la reprise, une par une, des tables qui
 * désignent un octet par son rang. C'est exactement le travail que l'ajout
 * d'un HEIC évite en écrivant en fin de fichier ; une vidéo ne l'autorise pas,
 * parce que le lieu doit vivre DANS la description des pistes.
 */
function ajouterLeLieu(b: Uint8Array, p: LatLon, aNeutraliser: Porteur[] = []): Pose {
  const racine = boites(b, 0, b.length);
  const moov = racine.find((x) => x.type === 'moov');
  if (!moov) throw REFUS_ECRITURE();

  const s = ecrireIso6709(p, LONGUEUR_NEUVE);
  if (s === null) throw REFUS_ECRITURE();
  const chaine = Uint8Array.from(s, (c) => c.charCodeAt(0));

  // La boîte `©xyz` : en-tête, longueur de la chaîne, code de langue, chaîne.
  // 0x15c7 est le code de langue « non déterminée », celui qu'écrivent les
  // appareils réels.
  const xyz = new Uint8Array(12 + chaine.length);
  writeU32(xyz, 0, xyz.length, 'BE');
  xyz.set([0xa9, 0x78, 0x79, 0x7a], 4);
  xyz[8] = 0;
  xyz[9] = chaine.length;
  xyz[10] = 0x15;
  xyz[11] = 0xc7;
  xyz.set(chaine, 12);

  const udta = enfants(b, moov).find((x) => x.type === 'udta') ?? null;
  // On insère À LA FIN de `udta` quand elle existe, et à la fin de `moov`
  // sinon : dans les deux cas, aucune boîte SŒUR ne change de place à
  // l'intérieur de son parent.
  const insertions: Insertion[] = [
    udta
      ? { a: finDe(udta), octets: xyz, dans: [udta, moov] }
      : { a: finDe(moov), octets: nouvelleUdta(xyz), dans: [moov] },
  ];

  // La seconde copie, celle que lisent les logiciels d'Apple. Voir `metaApple`
  // pour ce qui la borne.
  const apple = metaApple(b, moov, racine, s);
  if (apple) insertions.push({ a: finDe(moov), octets: apple, dans: [moov] });

  const { out, deplacer } = inserer(b, insertions);

  // Les anciens rangements partent AVANT que le nouveau ne serve : laisser en
  // place une copie que nous n'avons pas su réécrire ferait dire deux lieux au
  // même fichier. Ils sont tous avant les points d'insertion, donc leurs
  // positions restent valables.
  const changed: Plage[] = [];
  for (const porteur of aNeutraliser) neutraliser(out, porteur.boite, changed);

  /*
   * Les parents grandissent de ce qui a été inséré CHEZ EUX — et chaque
   * insertion DIT chez qui elle va, plutôt que de le laisser déduire de sa
   * position.
   *
   * La déduction géométrique est fausse dans un cas parfaitement ordinaire :
   * quand `udta` est la dernière boîte de `moov`, les deux finissent au MÊME
   * octet, et rien dans la position ne distingue « dans udta » de « après udta,
   * dans moov ». `udta` avalait alors le rangement d'Apple, qui devenait
   * invisible pour tout le monde — nous compris.
   */
  for (const parent of udta ? [udta, moov] : [moov]) {
    const ajoute = insertions
      .filter((i) => i.dans.includes(parent))
      .reduce((n, i) => n + i.octets.length, 0);
    if (!ajoute) continue;
    writeU32(out, deplacer(parent.debut), parent.taille + ajoute, 'BE');
    changed.push([deplacer(parent.debut), deplacer(parent.debut) + 4]);
  }

  // Et les décalages absolus, un par un. Chacun avance de ce qui a été inséré
  // AVANT l'octet qu'il désigne — rien de plus.
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

/** Un bloc d'octets à glisser devant l'octet `a` du fichier d'origine. */
interface Insertion {
  a: number;
  octets: Uint8Array;
  /** Les boîtes dont la taille doit grandir d'autant. Dites, jamais devinées. */
  dans: Boite[];
}

/**
 * Glisse plusieurs blocs d'un coup, et rend de quoi traduire les positions.
 *
 * Un seul point d'insertion suffisait tant qu'il n'y avait qu'un rangement à
 * écrire. Il y en a deux depuis que le lieu s'écrit aussi à la façon d'Apple,
 * et ils ne sont pas au même endroit : d'où cette généralisation, plutôt que
 * deux passes dont la seconde travaillerait sur des positions déjà fausses.
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

  // Un octet d'origine avance de tout ce qui a été glissé AVANT lui. À égalité
  // — une insertion pile sur sa position — le bloc passe devant, donc il compte.
  const deplacer = (o: number) =>
    o + tri.filter((i) => i.a <= o).reduce((n, i) => n + i.octets.length, 0);
  return { out, deplacer };
}

/** Une boîte quelconque : en-tête de huit octets, puis la charge. */
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
 * La seconde copie du lieu, celle que lisent les logiciels d'Apple.
 *
 * `moov/udta/©xyz` est ce que lisent Android, FFmpeg, VLC et MediaInfo — c'est
 * de loin le rangement le plus répandu, et c'est celui qu'écrivent les
 * appareils. Les logiciels d'Apple, eux, ne lisent que la clé nommée
 * `com.apple.quicktime.location.ISO6709`, dans un `moov/meta` où les noms
 * vivent dans `keys` et les valeurs dans `ilst`, appariés par leur RANG.
 *
 * Deux bornes, et elles sont volontaires :
 *
 *   - **Seulement quand `moov/meta` n'existe pas encore.** S'il existe, il
 *     faudrait allonger `keys` ET `ilst` à deux endroits distincts, et
 *     renuméroter. Aucun fichier du corpus n'a cette forme, donc rien ne
 *     l'éprouverait : le lieu s'écrit alors dans le seul rangement simple, ce
 *     qui reste vrai et lisible partout.
 *   - **Seulement sur la famille MP4.** Un vrai QuickTime écrit son `meta`
 *     sans les quatre octets de version, un MP4 avec — et c'est le second cas
 *     qu'un appareil d'Apple produit. Plutôt que de deviner dans un fichier
 *     dont la forme est déjà inhabituelle, on s'abstient : `©xyz` est de toute
 *     façon le rangement natif de QuickTime.
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

  // `hdlr` annonce que les noms de ce `meta` sont des clés nommées : « mdta ».
  const hdlr = boite(
    'hdlr',
    versionEtDrapeaux, new Uint8Array(4), ascii('mdta'), new Uint8Array(12 + 1),
  );

  // `keys` : le compte, puis une entrée par nom.
  const nom = boite('mdta', ascii(CLE_APPLE));
  const compte = new Uint8Array(4);
  writeU32(compte, 0, 1, 'BE');
  const keys = boite('keys', versionEtDrapeaux, compte, nom.subarray(0));

  // `ilst` : une entrée dont le TYPE est le rang de la clé, portant une boîte
  // `data`. Le type de charge vaut 1 — du texte.
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
   * `meta` s'écrit ici SANS les quatre octets de version et de drapeaux.
   *
   * La norme ISO en fait pourtant une « FullBox », qui les porterait. Mais ce
   * rangement-là n'existe que pour être lu par les logiciels d'Apple, et la
   * question n'est donc pas ce que dit la norme : c'est ce qu'ils lisent.
   * Mesuré, les deux formes écrites dans le même fichier et données à l'oracle
   * indépendant : la forme longue ne rend RIEN, la forme courte rend le lieu.
   * C'est aussi celle qu'ExifTool écrit lui-même quand on lui demande d'inscrire
   * cette clé. On suit le lecteur, pas le texte.
   */
  return boite('meta', hdlr, keys, ilst);
}

/** Une `udta` toute neuve, qui n'enveloppe que la boîte qu'on vient d'écrire. */
function nouvelleUdta(contenu: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + contenu.length);
  writeU32(out, 0, out.length, 'BE');
  out.set([0x75, 0x64, 0x74, 0x61], 4); // « udta »
  out.set(contenu, 8);
  return out;
}

/** Écrit une position dans une vidéo, en corrigeant ou en créant. */
export function ecrirePositionVideo(b: Uint8Array, lat: number, lon: number): Pose {
  const p = validerPosition({ lat, lon });
  if (!p) throw REFUS_ECRITURE();
  if (lieuEnMouvement(b)) throw REFUS_MOUVEMENT();

  const porteurs = porteursDeLieu(b);
  // Le lieu peut n'exister QUE dans un paquet de texte : il n'y a alors aucun
  // rangement à corriger, mais il y a bien un lieu à ne pas laisser derrière.
  const aPurger = paquetsDeTexte(b).some((x) => porteUnLieu(lireTexte(b, x)));

  // La copie du paquet de texte part dans tous les cas : nous ne savons pas la
  // tenir à jour, et la laisser ferait dire deux lieux au même fichier.
  const avecPurge = (pose: Pose): Pose => {
    if (!aPurger) return pose;
    const changed = [...pose.changed];
    purgerLesPaquets(pose.bytes, changed);
    return { bytes: pose.bytes, changed };
  };

  if (porteurs.length) {
    // Première voie : réécrire chaque rangement là où il est. Aucun octet ne
    // bouge, donc rien de ce que le fichier désigne par son rang ne devient
    // faux — et le fichier produit fait exactement la taille de l'original.
    const pose = corrigerSurPlace(b, porteurs, p);
    if (pose) return avecPurge(pose);
    // Seconde voie, quand les rangements en place sont trop courts pour porter
    // le lieu demandé : on les efface tous et l'on en écrit UN seul, assez
    // long. Le fichier grandit, ce qui demande la même permission qu'un ajout.
    if (!accepteAjoutVideo(b)) throw REFUS_ECRITURE();
    return avecPurge(ajouterLeLieu(b, p, porteurs));
  }

  if (!accepteAjoutVideo(b)) throw REFUS_ECRITURE();
  return avecPurge(ajouterLeLieu(b, p));
}

/* ------------------------------------------------------------------ */
/* Effacer                                                             */
/* ------------------------------------------------------------------ */

/**
 * Neutralise une boîte sans la déplacer : on la renomme en `free` — l'espace
 * libre, que tout lecteur saute — et on met sa charge à zéro.
 *
 * Le renommage seul ne suffirait pas : les octets seraient toujours là, et un
 * outil qui balaye le fichier au lieu de suivre sa structure les retrouverait.
 */
function neutraliser(out: Uint8Array, x: Boite, changed: Plage[]): void {
  out.set([0x66, 0x72, 0x65, 0x65], x.debut + 4); // « free »
  out.fill(0, charge(x), finDe(x));
  changed.push([x.debut + 4, finDe(x)]);
}

/**
 * Les paquets de texte descriptif d'une vidéo.
 *
 * Un logiciel de retouche y range le lieu une seconde fois, et en toutes
 * lettres : `photoshop:City`, `Iptc4xmpExt:LocationCreated`. C'est le cas que
 * le registre appelle « Avignon » — un fichier qui n'a plus de coordonnées mais
 * nomme encore la ville n'est pas effacé.
 */
const UUID_XMP = 'be7acfcb97a942e89c71999491e3afac';

function paquetsDeTexte(b: Uint8Array): Boite[] {
  const racine = boites(b, 0, b.length);
  const out: Boite[] = [];

  // La forme QuickTime : une boîte `XMP_` dans un `udta`, n'importe lequel.
  for (const udta of toutesLesBoites(b, 'udta', racine)) {
    out.push(...enfants(b, udta).filter((x) => x.type === 'XMP_' || x.type === 'uuid'));
  }

  /*
   * Et la forme que la norme prévoit pour un MP4 : une boîte `uuid` de PREMIER
   * NIVEAU, reconnue à son identifiant.
   *
   * C'est là qu'ExifTool écrit, et c'est là que nous ne regardions pas. Le
   * défaut ne se voyait pas seulement à l'affichage : le balayage résiduel ne
   * voyait pas ce paquet non plus, si bien qu'un effacement pouvait rendre un
   * fichier annoncé propre qui disait encore où il avait été tourné. C'est le
   * résultat que ce moteur existe pour empêcher.
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
 * Retire le lieu d'une vidéo, ou rend l'original.
 *
 * L'ordre compte : on refuse AVANT de toucher un octet. Un effacement à moitié
 * fait est pire que pas d'effacement du tout, parce que l'utilisateur croirait
 * le fichier propre.
 */
/**
 * Retire les propriétés de lieu des paquets de texte descriptif, sur place.
 *
 * Un paquet ne se neutralise pas en bloc : il porte aussi le titre, l'auteur,
 * l'historique de retouche. `xmp.ts` sait n'en blanchir que le lieu, à longueur
 * constante, et échouer plutôt que d'en laisser une trace.
 *
 * Appelé à l'EFFACEMENT comme à la CORRECTION. À la correction, c'est la règle
 * du tout ou rien qui l'exige : les nombres y ont une longueur variable, donc
 * les réécrire déplacerait des octets, et les laisser ferait dire deux lieux
 * différents au même fichier. On retire donc la copie que nous ne savons pas
 * tenir à jour, plutôt que de la laisser contredire celles que nous tenons.
 */
function purgerLesPaquets(out: Uint8Array, changed: Plage[]): void {
  for (const paquet of paquetsDeTexte(out)) {
    const avant = lireTexte(out, paquet);
    if (!porteUnLieu(avant)) continue;
    const apres = purgerLeLieu(avant);
    // On repasse par les octets, et l'on exige la même longueur. `purgerLeLieu`
    // ne remplace que par des espaces, donc elle est due — mais un paquet
    // tronqué ou mal encodé la ferait varier, et il vaut mieux échouer là que
    // décaler tout ce qui suit.
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

  // Et l'on repasse derrière soi. Une purge qui se croit sur parole est une
  // purge qu'on ne peut pas défendre.
  if (copieDuLieuAilleursVideo(out)) {
    throw new ExifError(
      'COPIE_DU_LIEU_SUBSISTE',
      "Une copie du lieu subsiste dans cette vidéo, sous une forme que nous ne savons pas retirer. Nous préférons vous rendre l'original intact.",
    );
  }
  return { bytes: out, changed };
}

/**
 * Vrai s'il reste une trace du lieu après l'effacement.
 *
 * Deux balayages, et le second est celui qui manquait au registre : on cherche
 * les coordonnées, ET les champs dont nous SAVONS qu'ils portent un nom de
 * ville. Un fichier qui n'a plus de latitude mais dit encore « Avignon » n'est
 * pas effacé.
 *
 * Ce que cette garantie ne couvre pas, et il faut le dire : un nom de ville
 * glissé dans un champ de commentaire libre passerait. Nous garantissons que
 * les champs PRÉVUS pour un lieu sont vides, pas qu'aucun mot du fichier ne
 * désigne un endroit du monde.
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

/* ------------------------------------------------------------------ */
/* Le contrôle d'après écriture                                        */
/* ------------------------------------------------------------------ */

/**
 * Vrai si la description du fichier se tient encore debout.
 *
 * Sur une photo, la garantie d'après écriture tient à un SECOND lecteur, écrit
 * par d'autres. Pour une vidéo il n'existe pas dans un navigateur, et ceci le
 * remplace : chaque boîte qui en contient d'autres doit être exactement remplie
 * par ses enfants. Cela vise le défaut réellement redouté ici — non pas le
 * boutisme, puisque nous écrivons du texte, mais l'ARITHMÉTIQUE DES TAILLES :
 * une boîte agrandie dont un parent aurait gardé son ancienne taille.
 *
 * Deux choix, et le premier a coûté un lot entier :
 *
 *   1. **On ne descend que dans les boîtes qui en contiennent.** La version
 *      précédente descendait partout, y compris dans `tkhd` et `stsz`, dont la
 *      charge est faite de nombres qui se lisent comme des en-têtes plausibles.
 *      Elle rendait donc `false` sur toute vidéo réelle, ce qui refusait
 *      l'écriture et l'effacement de TOUTES les vidéos.
 *   2. **Une conteneuse sans enfant analysable passe.** L'asymétrie des risques
 *      l'impose : un faux négatif interdit toute écriture — le défaut qu'on
 *      vient de réparer —, tandis qu'un faux positif reste rattrapé par les
 *      deux contrôles voisins, la preuve à l'octet près et la relecture de la
 *      position.
 *
 * Cette fonction vit ici, et non dans le worker, pour une raison qui vaut d'être
 * écrite : dans le worker, aucun test ne pouvait l'atteindre. C'est très
 * exactement pourquoi le défaut a été livré.
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

/** Vrai si tous les rangements du fichier s'accordent sur le même lieu. */
export function porteursConcordent(b: Uint8Array): boolean {
  const lus = porteursDeLieu(b)
    .map(positionDe)
    .filter((x): x is LatLon => x !== null);
  // Un rangement qui dirait autre chose que les autres serait précisément le
  // mensonge que ce module existe pour empêcher.
  return lus.every((x) => distanceMetres(x, lus[0]) < 1);
}

/* ------------------------------------------------------------------ */
/* Ce que l'on sait faire de CE fichier                                */
/* ------------------------------------------------------------------ */

/**
 * Vrai si le paquet de texte, s'il nomme un lieu, se laisse nettoyer.
 *
 * Posée AVANT l'action, et par le même code qui la répondra pendant : c'est ce
 * qui empêche l'interface de proposer un effacement que le moteur refusera.
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
 * Un rangement assez long pour porter n'importe quel lieu au mètre près.
 *
 * Six décimales de chaque côté, soit vingt-deux caractères hors altitude. Une
 * chaîne plus courte peut tomber juste sur un lieu et pas sur son voisin : ce
 * n'est pas une propriété du fichier, donc elle ne peut pas être annoncée.
 */
function assezLong(p: Porteur): boolean {
  // Un rangement en virgule fixe n'est JAMAIS assez fin : son pas vaut un mètre
  // sept en latitude, plus large que la tolérance que nous nous imposons. Un
  // fichier qui range son lieu ainsi passe donc par la voie qui fait grandir,
  // laquelle le remplace par une chaîne assez longue.
  if (p.binaire) return false;
  // Et l'on pose la question à `ecrireIso6709` elle-même plutôt que de
  // reproduire ses bornes ici. Elle en a DEUX — une chaîne peut être trop
  // longue autant que trop courte, au-delà de dix-huit décimales —, et n'en
  // vérifier qu'une revenait à annoncer une correction que l'écriture
  // refuserait ensuite. C'est la famille de défauts de Q-051.
  const utile = p.longueurTexte - altitudeDe(p.texte).length;
  return utile >= LONGUEUR_NEUVE
    && ecrireIso6709({ lat: 0, lon: 0 }, p.longueurTexte, altitudeDe(p.texte)) !== null;
}

/** Ce que l'outil sait faire de CETTE vidéo, avec la raison qui va avec. */
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
  // La MÊME lecture que celle affichée, et non une seconde qui en diverge : la
  // sonde recalculait le lieu sur les seuls rangements ordinaires, si bien
  // qu'une vidéo dont le lieu vit dans le paquet de texte s'annonçait sans
  // lieu alors que le lecteur savait le lire.
  const position = lirePositionVideo(b);

  if (enMouvement) {
    // Le lieu est aussi écrit tout au long de la vidéo, dans les données que ce
    // moteur ne réécrit jamais. Lire reste juste ; tout le reste mentirait.
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
      // Retirer TOUT d'une vidéo demanderait de la reconstruire, ce que ce
      // module ne sait pas faire — même raison que pour un HEIC.
      effacerTout: false,
    },
  };
}
