/**
 * Le contrat commun à tous les fichiers qui portent un bloc TIFF.
 *
 * Un JPEG, un HEIC, un PNG, un WebP portent le même bloc TIFF, rangé chacun à
 * sa façon. Une fois le bloc localisé, `tiff.ts` fait exactement le même
 * travail. Ce qui change d'un format à l'autre tient en trois questions :
 *
 *   1. où est le bloc ? — `localiser`, qui rend un TABLEAU : un HEIC peut
 *      porter deux blocs, dont un rattaché à sa vignette. N'en nettoyer qu'un
 *      rendrait un fichier que l'utilisateur croirait propre.
 *   2. à qui appartiennent les autres octets ? — `plagesRevendiquees`, sans
 *      laquelle aucune zéroïsation n'est défendable.
 *   3. le format tolère-t-il que le bloc change de longueur ? — c'est
 *      l'ABSENCE de `reconstruire`, et rien d'autre, qui ferme l'ajout.
 *
 * Un conteneur ne fait que poser des octets ; il ne décide de rien. Toute la
 * comptabilité des plages, et les trois refus qui protègent le fichier, vivent
 * dans la façade en bas de ce module. Les plages qu'elle produit sont toujours
 * en COORDONNÉES FICHIER — c'est ce qui rend la vérification « à l'octet près »
 * exploitable : on compare l'entrée et la sortie hors de ces plages.
 */

import { ExifError } from './erreurs.ts';
import type { Format, LatLon } from './types.ts';
import { boites, texte } from './bmff.ts';
import { readU32 } from './octets.ts';
import {
  type TiffView,
  type Edit,
  parseTiff,
  readPosition,
  deletePositionInTiff,
  ecrirePositionSurPlace,
  ecrirePositionParAjout,
  emptyTiff,
  TAG_GPS_IFD,
} from './tiff.ts';

export type Plage = [number, number];

export interface Emplacement {
  /** Le bloc TIFF : une vue sur les octets du fichier, pas une copie. */
  tiff: Uint8Array;
  /** Position du premier octet du bloc TIFF dans le FICHIER. */
  debut: number;
  /** Données propres au conteneur, opaques pour tout le reste. */
  interne?: unknown;
}

/** Ce qu'un conteneur rend quand il a dû restructurer le fichier. */
export interface Pose {
  bytes: Uint8Array;
  /** Plages modifiées, en coordonnées fichier. */
  changed: Plage[];
}

export interface Conteneur {
  readonly format: Format;
  reconnait(b: Uint8Array): boolean;

  /** Tous les blocs TIFF du fichier, dans l'ordre où ils apparaissent. */
  localiser(b: Uint8Array): Emplacement[];

  /**
   * Plages du fichier revendiquées par autre chose que `vise`. Une écriture qui
   * en recoupe une n'a pas lieu : l'original est rendu intact.
   */
  plagesRevendiquees(b: Uint8Array, vise: Emplacement): Plage[];

  /**
   * Remet à sa place un bloc de MÊME longueur. Aucun octet ne se déplace, donc
   * rien à recalculer : toujours défini, sur tous les formats.
   */
  reecrireSurPlace(b: Uint8Array, vise: Emplacement, tiff: Uint8Array): Uint8Array;

  /**
   * Remet un bloc de longueur différente, ou en crée un là où il n'y en avait
   * pas.
   *
   * ABSENT = le format ne tolère pas qu'on touche à la longueur, donc l'ajout
   * d'une position est impossible, et l'interface l'annonce AVANT l'action.
   */
  reconstruire?(b: Uint8Array, vise: Emplacement | null, tiff: Uint8Array): Pose;

  /**
   * Affine `reconstruire` fichier par fichier, quand le format lui-même ne
   * tranche pas : un WebP étendu tolère de grandir, la forme simple non, et
   * c'est le même format.
   */
  accepteAjout?(b: Uint8Array): boolean;

  /**
   * Plages que le conteneur doit lui-même réécrire pour que le fichier reste
   * cohérent : somme de contrôle d'un morceau PNG, taille globale d'un RIFF,
   * drapeaux d'un en-tête étendu. Elles sont hors du bloc TIFF, et sans cette
   * déclaration la vérification « à l'octet près » les verrait comme des
   * modifications que personne n'a annoncées.
   */
  plagesDeService?(b: Uint8Array, vise: Emplacement): Plage[];

  /** Retire toutes les informations, sans réencoder l'image. */
  toutEffacer?(b: Uint8Array): Pose;

  /**
   * Retire les copies du lieu rangées hors du bloc principal, à longueur
   * constante. Échoue plutôt que d'en laisser une.
   */
  purgerCopiesDuLieu?(b: Uint8Array): Pose;

  /**
   * Vrai si le fichier range une copie du lieu ailleurs que dans le bloc
   * principal, sous une forme que nous ne savons pas retirer.
   *
   * Effacer le bloc principal en laissant cette copie rendrait un fichier que
   * l'utilisateur croirait propre. C'est le pire résultat possible pour cet
   * outil : on refuse l'effacement plutôt que de le produire.
   */
  copieDuLieuAilleurs?(b: Uint8Array): boolean;
}

export interface Ecriture {
  bytes: Uint8Array;
  route: 'P1' | 'P2';
  /** Plages modifiées, en coordonnées fichier. */
  changed: Plage[];
  /** Vrai si la précision demandée a réellement pu être inscrite. */
  precisionEcrite: boolean;
}

/* ------------------------------------------------------------------ */
/* Détection de format                                                 */
/* ------------------------------------------------------------------ */

const BRANDS_HEIC = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis', 'mif2'];
const BRANDS_AVIF = ['avif', 'avis'];
const BRANDS_VIDEO = [
  'qt  ', 'mp41', 'mp42', 'isom', 'iso2', 'M4V ', '3gp4', '3gp5',
  // Marques rencontrées sur des fichiers réels que la première liste laissait
  // passer pour « inconnu » : Android récent écrit « 3gp6 », les appareils
  // CDMA « 3g2a », et les marques génériques montent jusqu'à « iso6 ».
  '3gp6', '3g2a', 'mmp4', 'avc1', 'iso4', 'iso5', 'iso6', 'dash',
];

/**
 * Boîtes par lesquelles un fichier QuickTime peut commencer.
 *
 * La boîte de type est FACULTATIVE en QuickTime — c'est une invention MP4,
 * arrivée après. Un vrai `.mov` commence directement par l'une de celles-ci,
 * et l'exiger le rendait « inconnu ».
 */
const TETES_QUICKTIME = ['moov', 'mdat', 'wide', 'pnot', 'skip', 'free'];

/**
 * Reconnaît un format à ses seuls octets de tête.
 *
 * L'ordre n'est pas indifférent : AVIF et HEIC passent AVANT la vidéo, parce
 * que les deux familles partagent l'emballage et que les marques génériques —
 * `isom`, `iso2` — peuvent coiffer l'une comme l'autre. Quand la marque ne
 * trancherait pas, c'est la structure qui tranche, et jamais la devinette.
 */
export function detecterFormat(b: Uint8Array): Format {
  const a = (...codes: number[]) => codes.every((c, i) => b[i] === c);
  if (a(0xff, 0xd8, 0xff)) return 'jpeg';
  if (a(0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (a(0x47, 0x49, 0x46)) return 'gif';
  if (a(0x49, 0x49, 0x2a, 0x00) || a(0x4d, 0x4d, 0x00, 0x2a)) return 'tiff';
  if (b.length > 12 && a(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45) return 'webp';
  if (b.length > 12) {
    const mot = (o: number) => texte(b, o, 4);
    if (mot(4) === 'ftyp') {
      // La marque majeure ne suffit pas à deviner : un HEIC de Nokia s'annonce
      // « mif1 » et une séquence AVIF « avis ». On compare des chaînes
      // entières — « avis » ne doit pas être reconnu au milieu d'autre chose.
      const marques = [mot(8), ...marquesCompatibles(b)];
      if (marques.some((m) => BRANDS_AVIF.includes(m))) return 'avif';
      if (marques.some((m) => BRANDS_HEIC.includes(m))) return 'heic';
      // `isom` et ses voisines sont des marques génériques : elles coiffent
      // aussi bien une vidéo qu'une image de cette famille. Exiger la boîte qui
      // décrit des pistes, c'est demander à la STRUCTURE ce que la marque ne
      // dit pas — une image de cette famille n'en a aucune.
      if (marques.some((m) => BRANDS_VIDEO.includes(m)) && aUnMoov(b)) return 'video';
    }
    // Sans boîte de type, il reste la structure. Exiger un `moov` évite de
    // happer tout fichier qui commencerait par une boîte d'espace libre.
    if (TETES_QUICKTIME.includes(mot(4)) && aUnMoov(b)) return 'video';
  }
  return 'inconnu';
}

/**
 * Marques compatibles déclarées après la marque majeure.
 *
 * Un fichier peut s'annoncer sous une marque que nous ne connaissons pas et
 * lister juste après celle que nous connaissons. Les lire coûte quelques
 * octets et referme un trou que la seule marque majeure laissait ouvert.
 */
function marquesCompatibles(b: Uint8Array): string[] {
  const taille = readU32(b, 0, 'BE');
  if (taille < 16 || taille > b.length || taille > 1024) return [];
  const out: string[] = [];
  for (let o = 16; o + 4 <= taille; o += 4) out.push(texte(b, o, 4));
  return out;
}

/** Vrai si une boîte `moov` figure au premier niveau. */
function aUnMoov(b: Uint8Array): boolean {
  return boites(b, 0, b.length).some((x) => x.type === 'moov');
}

const registre: Conteneur[] = [];

/** Enregistre un conteneur. Appelé une fois par module de format. */
export function enregistrer(c: Conteneur): void {
  registre.push(c);
}

/** Le conteneur capable de traiter ce fichier, ou null. */
export function conteneurDe(b: Uint8Array): Conteneur | null {
  return registre.find((c) => c.reconnait(b)) ?? null;
}

/* ------------------------------------------------------------------ */
/* La preuve « à l'octet près »                                        */
/* ------------------------------------------------------------------ */

function fusionner(plages: Plage[]): Plage[] {
  const tri = plages.map((p) => [p[0], p[1]] as Plage).sort((x, y) => x[0] - y[0]);
  const out: Plage[] = [];
  for (const [s, e] of tri) {
    const dernier = out[out.length - 1];
    if (dernier && s <= dernier[1]) dernier[1] = Math.max(dernier[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * Vrai si `apres` est identique à `avant` partout hors des plages annoncées.
 *
 * C'est la garantie centrale du moteur, et la seule qui vaille sur un fichier
 * de plusieurs mégaoctets : on ne prouve pas que l'image est restée décodable,
 * on prouve que ses octets n'ont pas bougé — ce qui est strictement plus fort,
 * et ne demande aucun décodeur.
 *
 * Une comparaison de tailles ne prouve rien : un défaut qui zéroïse 200 Ko de
 * MakerNote la laisse passer sans un mot.
 */
export function memesOctetsHorsPlages(
  avant: Uint8Array,
  apres: Uint8Array,
  plages: Plage[],
): boolean {
  const fusion = fusionner(plages);
  const commun = Math.min(avant.length, apres.length);
  let curseur = 0;
  for (const [s, e] of fusion) {
    const fin = Math.min(s, commun);
    for (let i = curseur; i < fin; i++) if (avant[i] !== apres[i]) return false;
    curseur = Math.max(curseur, e);
    if (curseur >= commun) break;
  }
  for (let i = curseur; i < commun; i++) if (avant[i] !== apres[i]) return false;

  // Le fichier a changé de longueur : tout ce qui dépasse doit être couvert par
  // une plage annoncée, sinon des octets sont apparus ou ont disparu en silence.
  const plusLong = Math.max(avant.length, apres.length);
  for (let i = commun; i < plusLong; i++) {
    if (!fusion.some(([s, e]) => i >= s && i < e)) return false;
  }
  return true;
}

function seChevauchent(a: Plage, plages: Plage[]): boolean {
  return plages.some(([s, e]) => a[0] < e && s < a[1]);
}

const CHEVAUCHEMENT = () =>
  new ExifError(
    'PLAGES_CHEVAUCHANTES',
    "Ce fichier a une structure inhabituelle : le modifier risquerait d'abîmer d'autres informations. Nous préférons ne pas y toucher.",
  );

export const AJOUT_IMPOSSIBLE = () =>
  new ExifError(
    'AJOUT_IMPOSSIBLE',
    "Ce fichier ne porte pas de lieu, et nous ne savons pas encore lui en ajouter un sans risquer de l'abîmer.",
  );

/* ------------------------------------------------------------------ */
/* Opérations, tous conteneurs confondus                               */
/* ------------------------------------------------------------------ */

export interface BlocLu {
  emplacement: Emplacement;
  vue: TiffView;
  position: LatLon | null;
}

/** Lit tous les blocs d'un fichier, en ignorant ceux qui sont illisibles. */
export function lireBlocs(c: Conteneur, b: Uint8Array): BlocLu[] {
  const out: BlocLu[] = [];
  for (const emplacement of c.localiser(b)) {
    try {
      const vue = parseTiff(emplacement.tiff);
      out.push({ emplacement, vue, position: readPosition(vue) });
    } catch {
      // Un bloc illisible n'est pas une erreur de lecture du fichier : on
      // n'affichera rien pour lui, et on refusera d'y écrire.
    }
  }
  return out;
}

/** La position du fichier : celle du premier bloc qui en porte une. */
export function lirePosition(c: Conteneur, b: Uint8Array): LatLon | null {
  for (const bloc of lireBlocs(c, b)) if (bloc.position) return bloc.position;
  return null;
}

/**
 * Applique une modification à un bloc, après avoir prouvé que la plage visée
 * n'appartient à personne d'autre.
 *
 * Trois refus, dans cet ordre, et tous AVANT d'écrire un octet : le bloc visé
 * recoupe une plage revendiquée ; une plage écrite déborde du bloc ; une plage
 * écrite recoupe une plage revendiquée.
 */
function appliquerAuBloc(
  c: Conteneur,
  b: Uint8Array,
  bloc: BlocLu,
  produire: (vue: TiffView) => Edit,
): { pose: Pose; route: 'P1' | 'P2' } {
  const { emplacement } = bloc;
  const longueur = emplacement.tiff.length;
  const autres = c.plagesRevendiquees(b, emplacement);
  if (seChevauchent([emplacement.debut, emplacement.debut + longueur], autres)) throw CHEVAUCHEMENT();

  const edit = produire(bloc.vue);

  if (edit.bytes.length === longueur) {
    const plages = edit.changed.map(([s, e]) => {
      if (s < 0 || e > longueur || e < s) {
        throw new ExifError(
          'STRUCTURE_INATTENDUE',
          "Ce fichier a une structure que nous ne savons pas modifier sans risque. Il n'a pas été touché.",
        );
      }
      return [emplacement.debut + s, emplacement.debut + e] as Plage;
    });
    for (const p of plages) if (seChevauchent(p, autres)) throw CHEVAUCHEMENT();
    const service = c.plagesDeService?.(b, emplacement) ?? [];
    return {
      pose: {
        bytes: c.reecrireSurPlace(b, emplacement, edit.bytes),
        changed: [...plages, ...service],
      },
      route: edit.route,
    };
  }

  if (!peutGrandir(c, b)) throw AJOUT_IMPOSSIBLE();
  return { pose: c.reconstruire!(b, emplacement, edit.bytes), route: edit.route };
}

/**
 * Vrai si CE fichier tolère que son bloc change de longueur.
 *
 * Le format ne suffit pas à trancher : un WebP étendu tolère de grandir et la
 * forme simple non ; un TIFF ordinaire le tolère et un négatif numérique ne
 * doit pas. La question est donc posée deux fois — ici, avant d'écrire, et par
 * l'interface, avant de proposer. Ce sont les deux mêmes octets qui répondent,
 * donc les deux réponses ne peuvent pas diverger.
 */
function peutGrandir(c: Conteneur, b: Uint8Array): boolean {
  return Boolean(c.reconstruire) && (c.accepteAjout?.(b) ?? true);
}

/** Écrit une position, en choisissant la voie que le conteneur autorise. */
export function ecrirePosition(
  c: Conteneur,
  b: Uint8Array,
  lat: number,
  lon: number,
  precisionMetres?: number,
): Ecriture {
  const demandee = typeof precisionMetres === 'number' && precisionMetres > 0;
  const blocs = lireBlocs(c, b);
  // On écrit dans le bloc principal : le premier. Les blocs secondaires (une
  // vignette, par exemple) sont nettoyés à l'effacement, jamais garnis.
  const bloc = blocs[0];

  if (!bloc) {
    if (!peutGrandir(c, b)) throw AJOUT_IMPOSSIBLE();
    const edit = ecrirePositionParAjout(parseTiff(emptyTiff()), lat, lon, precisionMetres);
    const pose = c.reconstruire!(b, null, edit.bytes);
    return { ...pose, route: 'P2', precisionEcrite: demandee };
  }

  const { pose, route } = appliquerAuBloc(c, b, bloc, (vue) => {
    const surPlace = ecrirePositionSurPlace(vue, lat, lon, precisionMetres);
    if (surPlace) return surPlace;
    if (!peutGrandir(c, b)) throw AJOUT_IMPOSSIBLE();
    return ecrirePositionParAjout(vue, lat, lon, precisionMetres);
  });
  // La voie P1 ne peut pas ajouter d'entrée, donc pas inscrire une précision
  // que le fichier ne portait pas déjà. On ne l'annoncera pas.
  return { ...pose, route, precisionEcrite: demandee && route === 'P2' };
}

/** Retire la position de TOUS les blocs du fichier. */
export function effacerPosition(c: Conteneur, b: Uint8Array): Ecriture {
  let courant = b;
  const changed: Plage[] = [];

  // On relit le fichier à chaque tour : les emplacements sont recalculés sur
  // les octets courants, jamais réutilisés d'un tour à l'autre. La borne est un
  // garde-fou — si un effacement ne retirait pas le GPS IFD, la boucle
  // tournerait sans fin plutôt que d'échouer.
  for (let tour = 0; tour < 16; tour++) {
    // Un pointeur GPSInfo qui ne mène à rien compte aussi : l'entrée doit
    // partir d'IFD0, sinon un lecteur tiers ira lire des octets arbitraires.
    const bloc = lireBlocs(c, courant).find(
      (x) => x.vue.gpsIfd !== null || x.vue.ifd0.entries.some((en) => en.tag === TAG_GPS_IFD),
    );
    if (!bloc) break;
    const { pose } = appliquerAuBloc(c, courant, bloc, (vue) => deletePositionInTiff(vue));
    courant = pose.bytes;
    changed.push(...pose.changed);
  }

  // Une seconde copie du lieu, dans un paquet de texte descriptif, survivrait à
  // tout ce qui précède. La purger est la moitié du travail ; repasser derrière
  // soi est l'autre moitié, et c'est elle qui transforme une purge incomplète
  // en échec visible plutôt qu'en fuite silencieuse.
  if (c.purgerCopiesDuLieu) {
    const pose = c.purgerCopiesDuLieu(courant);
    courant = pose.bytes;
    changed.push(...pose.changed);
  }
  if (c.copieDuLieuAilleurs?.(courant)) {
    throw new ExifError(
      'COPIE_DU_LIEU_SUBSISTE',
      "Une copie du lieu subsiste dans ce fichier, sous une forme que nous ne savons pas retirer. Nous préférons vous rendre l'original intact.",
    );
  }

  return { bytes: courant, route: 'P1', changed, precisionEcrite: false };
}

/** Retire toutes les informations, si le conteneur sait le faire. */
export function toutEffacer(c: Conteneur, b: Uint8Array): Ecriture {
  if (!c.toutEffacer) {
    throw new ExifError(
      'EFFACEMENT_TOTAL_IMPOSSIBLE',
      "Nous ne savons pas encore retirer toutes les informations de ce type de fichier.",
    );
  }
  const pose = c.toutEffacer(b);
  return { ...pose, route: 'P2', precisionEcrite: false };
}
