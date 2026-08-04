/**
 * Le moteur, sans navigateur.
 *
 * Ce module est né par extraction de `src/worker/exif.worker.ts`, où il vivait
 * soudé au protocole de messages d'un Web Worker. Rien de ce qu'il fait n'avait
 * besoin d'un navigateur — le travail est entièrement binaire — mais il ne
 * pouvait s'exécuter QUE dans un navigateur, faute d'être séparé de `self` et
 * de `postMessage`.
 *
 * La séparation n'est pas cosmétique. Elle a une conséquence qui compte plus
 * que la portabilité : la sonde de capacités, la vérification à trois étages et
 * la relecture croisée sont désormais atteignables par un test ordinaire. Le
 * commentaire de `verifierVideo` racontait déjà ce que coûtait l'inverse — un
 * contrôle qui refusait TOUTES les vidéos avait été livré au vert, parce
 * qu'aucun test ne pouvait importer un module qui tire `self` et `exifr`.
 *
 * Aucune requête réseau n'est émise d'ici, et il n'en émettra jamais. Aucun
 * accès au système de fichiers non plus : ce module reçoit des octets et rend
 * des octets. C'est l'appelant — la ligne de commande, le worker — qui décide
 * d'où ils viennent.
 */
import exifr from 'exifr';
import './formats.ts';
import {
  type BlocLu,
  type Conteneur,
  type Ecriture,
  conteneurDe,
  detecterFormat,
  ecrirePosition,
  effacerPosition,
  lireBlocs,
  lirePosition,
  memesOctetsHorsPlages,
  toutEffacer,
} from './conteneurs.ts';
import { type Capacites, type Motif, capacitesDe } from './capacites.ts';
import {
  ecrirePositionVideo,
  infosVideo,
  effacerPositionVideo,
  lirePositionVideo,
  sonderVideo,
  videoCoherente,
} from './quicktime.ts';
import { ecrirePositionSurPlace, parseTiff, readAltitude } from './tiff.ts';
import { ExifError } from './erreurs.ts';
import { distanceMetres, validerPosition } from './coords.ts';
import type { Format, LatLon, Operation, PhotoRead, WriteResult } from './types.ts';

/**
 * Les options passées à `exifr`, et pourquoi elles ont besoin d'un cast.
 *
 * `exifr` accepte `ifd0: true` — son propre README le documente — et son
 * `index.d.ts` déclare pourtant `ifd0?: FormatOptions` là où les onze blocs
 * voisins acceptent `FormatOptions | boolean`. Le commentaire de l'auteur sur
 * cette ligne, « cannot be disabled », explique l'oubli : il a écarté le
 * booléen en pensant à `false`, ce qui écarte aussi `true`. La déclaration
 * contredit la documentation de la bibliothèque, pas notre appel.
 *
 * On rectifie donc le type, sans toucher à la valeur transmise. Remplacer
 * `true` par `{}` ferait taire le vérificateur en changeant ce qu'on demande au
 * lecteur de métadonnées : ce fichier n'est pas l'endroit où l'on modifie un
 * comportement pour faire plaisir à un type.
 *
 * Le double cast est l'outil le plus étroit disponible : `exifr` n'exporte pas
 * son interface `Options`, qu'on ne peut donc ni augmenter ni corriger champ par
 * champ depuis ici. Le cast est concentré sur ces deux constantes, et non
 * dispersé sur les appels — si la bibliothèque corrige sa déclaration, il y a
 * deux lignes à supprimer et le vérificateur dira lesquelles.
 */
type OptionsExifr = NonNullable<Parameters<typeof exifr.parse>[1]>;

/** Lecture complète : position, date, appareil, et les détails affichés. */
const OPTIONS_COMPLETES = {
  tiff: true,
  exif: true,
  gps: true,
  ifd0: true,
  translateValues: true,
  reviveValues: true,
} as unknown as OptionsExifr;

/** Simple question d'ouverture : le second lecteur sait-il lire ce fichier ? */
const OPTIONS_OUVERTURE = { tiff: true, ifd0: true } as unknown as OptionsExifr;

/**
 * Les octets, sous la forme qu'`exifr` préfère, sans copie quand c'est possible.
 *
 * Dans le worker, ce module recevait un `ArrayBuffer` transféré et le passait
 * tel quel. Ici il reçoit une vue, qui peut parfaitement être une FENÊTRE sur un
 * tampon plus grand — c'est ce que rend `Buffer.subarray`, et c'est ce que rend
 * une lecture de fichier groupée. Passer `vue.buffer` sans regarder l'offset
 * donnerait au second lecteur des octets qui ne sont pas ceux qu'on vérifie.
 */
function commeArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer;
}

/* ---------------------------------------------------------------- */

/**
 * Une sonde unique, et une seule.
 *
 * `capsOf` était appelé deux fois avec des connaissances différentes : à la
 * lecture, puis à l'application. Rien n'empêchait structurellement l'annonce et
 * le comportement de diverger — c'est-à-dire d'annoncer une écriture que le
 * moteur refuserait ensuite. Les deux passent désormais par ici.
 *
 * L'interface annonce la voie AVANT l'action. On ne promet jamais une écriture
 * qu'on ne sait pas tenir : mieux vaut dire « nous ne savons pas encore » que
 * rendre un fichier que l'utilisateur croira nettoyé.
 */
export interface Sonde {
  format: Format;
  conteneur: Conteneur | null;
  blocs: BlocLu[];
  position: LatLon | null;
  capacites: Capacites;
  motif: Motif;
}

export function sonder(bytes: Uint8Array): Sonde {
  const format = detecterFormat(bytes);
  const statiques = capacitesDe(format);
  const vide = { format, conteneur: null, blocs: [], position: null };

  if (format === 'inconnu') {
    return { ...vide, capacites: statiques, motif: 'inconnu' };
  }

  // Une vidéo ne porte pas de bloc TIFF : son lieu est une chaîne de texte,
  // rangée à plusieurs endroits à la fois. Elle a donc sa propre sonde, et
  // c'est LA MÊME que celle du test — l'annonce et le comportement ne peuvent
  // pas diverger.
  if (format === 'video') {
    const s = sonderVideo(bytes);
    const capacites: Capacites = {
      lire: statiques.lire && s.capacites.lire,
      corriger: statiques.corriger && s.capacites.corriger,
      ajouter: statiques.ajouter && s.capacites.ajouter,
      effacer: statiques.effacer && s.capacites.effacer,
      effacerTout: statiques.effacerTout && s.capacites.effacerTout,
    };
    return { ...vide, position: s.position, capacites, motif: motifVideo(s, capacites) };
  }

  const conteneur = conteneurDe(bytes);
  // Un format que le tableau donne en lecture seule, ou pour lequel aucun
  // conteneur n'est encore écrit, s'arrête ici : la phrase le dit sans jargon.
  if (!conteneur || !(statiques.corriger || statiques.ajouter || statiques.effacer)) {
    const motif: Motif = format === 'gif' ? 'sans-lieu-possible' : 'lecture-seule';
    return { ...vide, capacites: { ...statiques, corriger: false, ajouter: false, effacer: false },
      motif };
  }

  let blocs: BlocLu[] = [];
  try {
    blocs = lireBlocs(conteneur, bytes);
  } catch {
    // Un fichier dont la structure est illisible n'est pas modifiable ; il
    // reste lisible par ailleurs, via l'autre lecteur.
    return { ...vide, conteneur, capacites: { ...statiques, corriger: false, ajouter: false, effacer: false },
      motif: 'rangement-inconnu' };
  }

  const position = blocs.find((b) => b.position)?.position ?? null;
  const principal = blocs[0] ?? null;

  // « Corriger » demande soit que les champs existent déjà avec la bonne forme
  // — c'est alors une écriture à longueur constante — soit que le format
  // tolère de grandir. Sur une photo d'iPhone, seule la première voie existe.
  const surPlace =
    principal !== null &&
    position !== null &&
    ecrirePositionSurPlace(principal.vue, position.lat, position.lon) !== null;

  // Une copie du lieu ailleurs dans le fichier ferme l'effacement : le retirer
  // du bloc principal rendrait un fichier que l'utilisateur croirait propre.
  const copieAilleurs = conteneur.copieDuLieuAilleurs?.(bytes) ?? false;

  // Certains formats ne tranchent pas au niveau du format : un WebP étendu
  // tolère de grandir, la forme simple non, et c'est le même format.
  const peutGrandir =
    statiques.ajouter && Boolean(conteneur.reconstruire) && (conteneur.accepteAjout?.(bytes) ?? true);

  const capacites: Capacites = {
    lire: statiques.lire,
    corriger: statiques.corriger && (surPlace || peutGrandir) && !copieAilleurs,
    ajouter: peutGrandir && !copieAilleurs,
    effacer: statiques.effacer && !copieAilleurs,
    effacerTout: statiques.effacerTout && !copieAilleurs,
  };

  let motif: Motif;
  if (copieAilleurs) {
    motif = 'copie-ailleurs';
  } else if (position !== null) {
    motif = capacites.corriger ? 'ok' : 'forme-inhabituelle';
  } else if (capacites.ajouter) {
    motif = 'ok';
  } else if (blocs.length === 0 && !statiques.ajouter) {
    motif = 'sans-emplacement';
  } else if (statiques.ajouter) {
    // Le format saurait grandir, mais pas cette variante-là.
    motif = 'sans-lieu-possible';
  } else {
    motif = 'sans-lieu';
  }

  return { format, conteneur, blocs, position, capacites, motif };
}

/**
 * Pourquoi l'outil peut, ou ne peut pas, agir sur CETTE vidéo.
 *
 * Le lieu en mouvement passe avant tout le reste : c'est la seule raison qui
 * ferme les trois opérations d'un coup, et celle que l'utilisateur doit lire
 * même quand le lieu principal s'affiche très bien.
 */
function motifVideo(s: ReturnType<typeof sonderVideo>, c: Capacites): Motif {
  if (s.lieuEnMouvement) return 'lieu-en-mouvement';
  if (!c.effacer) return 'copie-ailleurs';
  if (s.position !== null) return c.corriger ? 'ok' : 'forme-inhabituelle';
  return c.ajouter ? 'ok' : 'sans-lieu-possible';
}

/**
 * Projette les capacités sur le contrat que l'interface consomme.
 *
 * « Modifier » veut dire deux choses selon le fichier : remplacer un lieu déjà
 * présent, ou en créer un. L'interface n'a qu'un champ de saisie — il n'est
 * actif que si l'opération que l'utilisateur va réellement déclencher est à
 * notre portée sur CE fichier.
 */
function projeter(s: Sonde): PhotoRead['can'] {
  return {
    read: s.capacites.lire,
    write: s.position ? s.capacites.corriger : s.capacites.ajouter,
    erase: s.capacites.effacer,
    eraseAll: s.capacites.effacerTout,
  };
}

/**
 * La position rapportée par le second lecteur, soumise aux mêmes règles que la
 * nôtre.
 *
 * Cette voie de repli ne s'ouvre que si notre moteur n'a rien trouvé, et c'est
 * précisément ce qui la rendait dangereuse : elle pouvait rapporter d'un fichier
 * exactement ce que le moteur venait d'en écarter, sans rien appliquer de ses
 * règles.
 *
 * Deux valeurs passaient. `NaN` d'abord, que `typeof` tient pour un nombre : un
 * rationnel GPS au dénominateur nul — ce qu'écrit un Galaxy S10 sans relevé —
 * ressortait en « NaN, NaN » à l'affichage, puis vidait la carte, la projection
 * propageant `NaN` jusqu'aux pixels des tuiles. Le zéro exact ensuite : notre
 * `readPosition` l'écarte nommément parce que c'est la trace d'un logiciel qui a
 * purgé les coordonnées sans retirer les entrées, et annoncer le golfe de Guinée
 * pour un fichier sans lieu est le mensonge que cet outil ne peut pas se
 * permettre. Les deux règles valent maintenant pour les deux lecteurs.
 *
 * Le refus est une absence, jamais un lieu de repli : l'interface a déjà un état
 * « sans position », dit avec des mots, et la carte s'ouvre alors sur une vue
 * d'ensemble.
 */
function positionDuSecondLecteur(lat: unknown, lon: unknown): LatLon | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const p = validerPosition({ lat, lon });
  if (!p || (p.lat === 0 && p.lon === 0)) return null;
  return p;
}

function texteDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.valueOf())) return v.toISOString();
  if (typeof v === 'string' && v.trim()) return v;
  return null;
}

/**
 * L'altitude, lue par NOTRE moteur d'abord.
 *
 * C'est la même règle que pour la position, et pour la même raison : c'est
 * notre moteur qui écrit, donc c'est lui qui doit dire ce qu'il voit. Le second
 * lecteur reste en repli, pour les fichiers dont nous ne localisons pas le bloc.
 *
 * La différence n'est pas théorique. `GPSAltitude` est un rationnel toujours
 * positif et c'est `GPSAltitudeRef` qui porte le signe : une photo prise au
 * bord de la mer Morte est à −430 m, et une lecture qui ignore l'octet de
 * référence l'annonce à +430 m — soit 860 m d'erreur, du bon côté du zéro.
 */
function altitudeNative(bytes: Uint8Array, sonde: Sonde): number | null {
  for (const bloc of sonde.blocs) {
    const v = readAltitude(bloc.vue);
    if (v !== null) return v;
  }
  // Les blocs de la sonde suffisent dans tous les cas ordinaires ; ce repli ne
  // sert que si l'appelant a construit la sonde autrement.
  if (sonde.blocs.length === 0 && sonde.conteneur) {
    for (const e of sonde.conteneur.localiser(bytes)) {
      try {
        const v = readAltitude(parseTiff(e.tiff));
        if (v !== null) return v;
      } catch {
        /* un bloc illisible n'est pas une erreur de lecture du fichier */
      }
    }
  }
  return null;
}

export async function lire(id: string, name: string, bytes: Uint8Array): Promise<PhotoRead> {
  const sonde = sonder(bytes);
  const format = sonde.format;

  // C'est notre moteur qui écrira, donc c'est lui qui doit dire ce qu'il voit.
  let position: LatLon | null = sonde.position;
  let altitude: number | null = format === 'video' ? null : altitudeNative(bytes, sonde);
  let takenAt: string | null = null;
  let camera: string | null = null;
  const details: Array<{ cle: string; value: string }> = [];

  // Une vidéo dit ce qu'elle est, mais pas au même endroit qu'une photo : voir
  // `infosVideo`, qui explique pourquoi le volet restait vide.
  if (format === 'video') {
    const infos = infosVideo(bytes);
    takenAt = infos.takenAt;
    camera = infos.camera;
    details.push(...infos.details);
  }

  try {
    // L'appeler sur une vidéo lui ferait balayer plusieurs mégaoctets pour
    // rien. Pire, s'il apprenait un jour à les lire, deux lecteurs répondraient
    // sans qu'aucune règle ne dise lequel fait foi — alors que sur une vidéo,
    // c'est le nôtre qui écrit.
    const tags = (format === 'video'
      ? undefined
      : await exifr.parse(commeArrayBuffer(bytes), OPTIONS_COMPLETES)) as
      | Record<string, unknown>
      | undefined;

    if (tags) {
      if (!position) position = positionDuSecondLecteur(tags.latitude, tags.longitude);
      if (
        altitude === null &&
        typeof tags.GPSAltitude === 'number' &&
        Number.isFinite(tags.GPSAltitude)
      ) {
        altitude = tags.GPSAltitude;
      }
      takenAt = texteDate(tags.DateTimeOriginal ?? tags.CreateDate ?? tags.ModifyDate);
      const make = typeof tags.Make === 'string' ? tags.Make.trim() : '';
      const model = typeof tags.Model === 'string' ? tags.Model.trim() : '';
      camera = [make, model].filter(Boolean).join(' ') || null;

      // Des CLÉS, pas des libellés : l'interface les traduit dans sa langue.
      const interessants = [
        'Orientation', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength',
        'LensModel', 'Software', 'Artist', 'Copyright',
      ];
      for (const cle of interessants) {
        const v = tags[cle];
        if (v !== undefined && v !== null && String(v).trim()) {
          details.push({ cle, value: String(v) });
        }
      }
    }
  } catch {
    // exifr échoue sur les fichiers sans métadonnées : ce n'est pas une erreur.
  }

  return {
    id,
    name,
    size: bytes.length,
    format,
    can: projeter(sonde),
    motif: sonde.motif,
    position,
    altitude,
    takenAt,
    camera,
    details,
  };
}

/**
 * Vérification après écriture — non négociable, et à trois étages.
 *
 * Une auto-relecture est structurellement aveugle à la classe de défaut la plus
 * dangereuse : un encodeur et un décodeur symétriquement faux passent avec un
 * écart de exactement zéro. Il faut donc un second lecteur, écrit par d'autres.
 *
 * Sauf que ce second lecteur ne connaît pas tous les formats — il ignore le
 * WebP — et qu'il refuse certains fichiers pour des raisons sans rapport avec
 * nous. D'où trois étages :
 *
 *   A. notre propre relecture, en repartant des octets produits et en
 *      relocalisant le bloc depuis zéro : si la structure avait été abîmée, on
 *      ne retrouverait rien ;
 *   B. le second lecteur sur le BLOC extrait. Un bloc de position est un
 *      fichier TIFF valide à lui seul, et le second lecteur l'accepte tel quel.
 *      C'est exactement la couche où vit le défaut de boutisme, donc l'étage
 *      qui compte. Il est exigible sur tous les formats ;
 *   C. le second lecteur sur le FICHIER entier, soumis à une règle de symétrie :
 *      s'il savait ouvrir l'entrée, il doit savoir ouvrir la sortie et être
 *      d'accord. S'il ne savait pas ouvrir l'entrée, son silence sur la sortie
 *      ne prouve rien et ne vaut pas échec.
 *
 * Cette règle est exacte par construction sur les formats où nous ne touchons
 * ni l'en-tête, ni la table des emplacements, ni aucune longueur : la capacité
 * du second lecteur à traiter le fichier y est invariante par notre opération.
 */

/** Ce que le second lecteur trouve dans un fichier, ou dans un bloc nu. */
async function gpsParExifr(octets: Uint8Array): Promise<LatLon | null> {
  try {
    const t = (await exifr.gps(octets.slice().buffer)) as
      | { latitude: number; longitude: number }
      | undefined;
    // Finitude et plage seulement, PAS la règle du zéro exact.
    //
    // Cette fonction sert la relecture croisée, dont toute la valeur tient à
    // son indépendance : lui faire appliquer nos politiques la ferait acquiescer
    // à nos propres erreurs. `NaN` et une latitude de 500 ne sont une position
    // pour personne, et les écarter n'entame pas ce témoignage — décider qu'un
    // zéro exact n'est pas un lieu, si.
    if (t) return validerPosition({ lat: t.latitude, lon: t.longitude });
  } catch {
    /* le second lecteur ne sait pas ouvrir ce fichier */
  }
  return null;
}

/** Vrai si le second lecteur sait ouvrir ce fichier, position ou non. */
async function exifrSaitOuvrir(octets: Uint8Array): Promise<boolean> {
  try {
    const t = await exifr.parse(octets.slice().buffer, OPTIONS_OUVERTURE);
    return t != null;
  } catch {
    return false;
  }
}

/** Le premier bloc de position du fichier, tel qu'on le retrouve après coup. */
function blocNu(octets: Uint8Array): Uint8Array | null {
  try {
    const c = conteneurDe(octets);
    if (!c) return null;
    const e = c.localiser(octets)[0];
    return e ? e.tiff : null;
  } catch {
    return null;
  }
}

/** L'altitude relue dans le fichier produit, par notre moteur. */
function altitudeRelue(octets: Uint8Array): number | null {
  try {
    const c = conteneurDe(octets);
    if (!c) return null;
    for (const e of c.localiser(octets)) {
      try {
        const v = readAltitude(parseTiff(e.tiff));
        if (v !== null) return v;
      } catch {
        /* bloc illisible */
      }
    }
  } catch {
    /* structure illisible */
  }
  return null;
}

const accord = (a: LatLon | null, b: LatLon | null): boolean =>
  (a === null && b === null) || (a !== null && b !== null && distanceMetres(a, b) < 1);

interface Verification {
  verified: LatLon | null;
  drift: number;
  croise: boolean;
  croiseComplet: boolean;
}

/**
 * Le contrôle croisé d'une vidéo, et ce qu'il ne peut pas être.
 *
 * Sur une photo, la garantie tient à un SECOND lecteur, écrit par d'autres, qui
 * relit ce que nous venons d'écrire. Pour une vidéo, ce second lecteur n'existe
 * pas dans un navigateur : `exifr` n'ouvre ni MOV ni MP4. Le dire est plus
 * honnête que de laisser croire à une garantie qui n'a pas lieu.
 *
 * Ce qui le remplace n'est pas rien, et vise le défaut réellement redouté ici —
 * non pas le boutisme, puisque nous écrivons du texte, mais l'ARITHMÉTIQUE DES
 * TAILLES : une boîte agrandie dont un parent aurait gardé son ancienne taille.
 *
 *   1. La structure se reparcourt entière depuis le premier octet, et chaque
 *      parent doit être exactement rempli par ses enfants.
 *   2. TOUS les rangements du lieu doivent s'accorder sur la même réponse.
 *
 * Le vrai lecteur indépendant — ExifTool — passe en intégration continue, sur
 * de vrais fichiers, colonne par colonne. Voir Q-050 et Q-051.
 */
function verifierVideo(produit: Uint8Array, attendu: LatLon | null): Verification {
  const sansLever = <T>(f: () => T, repli: T): T => {
    try {
      return f();
    } catch {
      return repli;
    }
  };
  const parNous = sansLever(() => lirePositionVideo(produit), null);
  return {
    verified: parNous,
    // Un écart infini dit « ce n'est pas ce qui était demandé » dans les deux
    // sens : on attendait un lieu et il n'y en a pas, ou l'inverse.
    drift: attendu === null
      ? (parNous === null ? 0 : Infinity)
      : (parNous === null ? Infinity : distanceMetres(parNous, attendu)),
    croise: sansLever(() => videoCoherente(produit), false),
    // Le second lecteur n'ouvre ni MOV ni MP4 : le croisement ne peut pas être
    // complet, et le prétendre serait mentir sur la force du contrôle.
    croiseComplet: false,
  };
}

async function verifier(
  original: Uint8Array,
  produit: Uint8Array,
  attendu: LatLon | null,
): Promise<Verification> {
  if (detecterFormat(produit) === 'video') return verifierVideo(produit, attendu);

  // A — notre relecture, structure relocalisée depuis le premier octet.
  const parNous = (() => {
    try {
      const c = conteneurDe(produit);
      return c ? lirePosition(c, produit) : null;
    } catch {
      return null;
    }
  })();

  // B — le second lecteur sur le bloc extrait. Exigible partout.
  const bloc = blocNu(produit);
  const parBloc = bloc ? await gpsParExifr(bloc) : null;
  const croiseBloc = bloc === null ? parNous === null : accord(parNous, parBloc);

  // C — le second lecteur sur le fichier entier, sous condition de symétrie.
  const temoin = await exifrSaitOuvrir(original);
  const parFichier = temoin ? await gpsParExifr(produit) : null;
  const croiseFichier = !temoin || accord(parNous, parFichier);

  const croise = croiseBloc && croiseFichier;

  if (attendu === null) {
    return { verified: parNous, drift: parNous === null ? 0 : Infinity, croise, croiseComplet: temoin };
  }
  if (!parNous) return { verified: null, drift: Infinity, croise, croiseComplet: temoin };
  return { verified: parNous, drift: distanceMetres(parNous, attendu), croise, croiseComplet: temoin };
}

export async function appliquer(
  id: string,
  name: string,
  bytes: Uint8Array,
  operation: Operation,
): Promise<WriteResult> {
  // On resonde les octets reçus plutôt que de faire confiance à la lecture
  // précédente : l'annonce et le comportement lisent ainsi la même source.
  const sonde = sonder(bytes);

  const echec = (code: string, message: string, motif?: Motif): WriteResult => ({
    ok: false,
    id,
    name,
    code,
    message,
    motif,
  });

  const { capacites, conteneur } = sonde;
  const permise =
    operation.kind === 'set'
      ? sonde.position
        ? capacites.corriger
        : capacites.ajouter
      : operation.kind === 'erase'
        ? capacites.effacer
        : capacites.effacerTout;

  // Le refus reprend le MOTIF déjà annoncé avant l'action : ce que l'utilisateur
  // a lu et ce qu'il obtient ne peuvent pas se contredire, quelle que soit la
  // langue dans laquelle il l'a lu.
  // Une vidéo n'a pas de conteneur au sens du bloc TIFF : c'est normal, et ce
  // n'est pas un refus.
  const video = sonde.format === 'video';
  if (!permise || (!conteneur && !video)) {
    return echec('FORMAT_NON_MODIFIABLE', 'Opération non permise sur ce fichier.', sonde.motif);
  }

  const altitudeVoulue =
    operation.kind === 'set' && typeof operation.altitudeMetres === 'number' &&
    Number.isFinite(operation.altitudeMetres)
      ? operation.altitudeMetres
      : null;

  try {
    let produit: Ecriture;
    let attendu: LatLon | null = null;

    if (video) {
      if (operation.kind === 'set') {
        // Une vidéo range son lieu en TEXTE, dans une notation qui n'a pas de
        // place pour une altitude. La demander sur une vidéo n'est pas une
        // approximation qu'on peut arrondir : c'est un champ qui n'existe pas.
        if (altitudeVoulue !== null) {
          throw new ExifError(
            'ALTITUDE_IMPOSSIBLE',
            "Ce format range son lieu sous une forme qui ne porte pas d'altitude. Nous préférons vous rendre l'original intact.",
          );
        }
        const pose = ecrirePositionVideo(bytes, operation.position.lat, operation.position.lon);
        // La voie est P1 quand rien n'a bougé, P2 quand le fichier a grandi.
        produit = { ...pose, route: pose.bytes.length === bytes.length ? 'P1' : 'P2',
          precisionEcrite: false, altitudeEcrite: false };
        attendu = operation.position;
      } else if (operation.kind === 'erase') {
        produit = { ...effacerPositionVideo(bytes), route: 'P1', precisionEcrite: false,
          altitudeEcrite: false };
      } else {
        throw new ExifError(
          'EFFACEMENT_TOTAL_IMPOSSIBLE',
          'Nous ne savons pas encore retirer toutes les informations de ce type de fichier.',
        );
      }
    } else if (operation.kind === 'set') {
      produit = ecrirePosition(
        conteneur!,
        bytes,
        operation.position.lat,
        operation.position.lon,
        operation.accuracyMetres,
        altitudeVoulue ?? undefined,
      );
      attendu = operation.position;
    } else if (operation.kind === 'erase') {
      produit = effacerPosition(conteneur!, bytes);
    } else {
      produit = toutEffacer(conteneur!, bytes);
    }

    // « À l'octet près » n'est pas une figure de style. Une comparaison de
    // tailles ne prouve rien : un défaut qui zéroïse 200 Ko de MakerNote la
    // passe sans un mot. On exige que le fichier produit soit identique à
    // l'original PARTOUT hors des plages que le moteur a lui-même annoncées.
    if (!memesOctetsHorsPlages(bytes, produit.bytes, produit.changed)) {
      return echec(
        'OCTETS_HORS_PLAGE',
        "Le fichier produit diffère de l'original ailleurs qu'à l'endroit de la position. Nous préférons vous rendre l'original intact.",
      );
    }

    const { verified, drift, croise } = await verifier(bytes, produit.bytes, attendu);

    // Tolérance de 1 mètre. Les coordonnées EXIF sont stockées en rationnels
    // degrés/minutes/secondes ; la conversion perd un peu de précision. Au-delà
    // d'un mètre, ce n'est plus de l'arrondi, c'est un défaut d'encodage.
    if (attendu && drift > 1) {
      return echec(
        'VERIFICATION_ECHOUEE',
        "La position relue dans le fichier produit ne correspond pas à celle demandée. Nous préférons vous rendre l'original intact.",
      );
    }
    if (!attendu && verified !== null) {
      return echec(
        'VERIFICATION_ECHOUEE',
        "Une position subsiste dans le fichier produit. Nous préférons vous rendre l'original intact.",
      );
    }
    if (!croise) {
      return echec(
        'RELECTURE_CROISEE_DIVERGENTE',
        "Deux lecteurs indépendants ne lisent pas la même chose dans le fichier produit. Nous préférons vous rendre l'original intact.",
      );
    }

    /*
     * L'altitude passe le même examen que la position, et pour la même raison.
     *
     * Le refus ici n'est PAS une prudence excessive : la voie « sans rien
     * déplacer » ne sait écrire l'altitude que dans un fichier qui lui avait
     * déjà réservé la place, et il existe des formats où l'autre voie est
     * fermée. Rendre alors le fichier en silence donnerait très exactement ce
     * que cet outil refuse de produire — un fichier auquel il manque ce qu'on
     * avait demandé d'y mettre, et que rien ne signale.
     */
    if (altitudeVoulue !== null) {
      const relue = produit.altitudeEcrite ? altitudeRelue(produit.bytes) : null;
      // Le champ est écrit au millimètre ; un centimètre de tolérance couvre
      // l'arrondi sans rien laisser passer d'autre.
      if (relue === null || Math.abs(relue - altitudeVoulue) > 0.01) {
        return echec(
          'ALTITUDE_NON_ECRITE',
          "L'altitude demandée n'a pas pu être inscrite dans ce fichier. Nous préférons vous rendre l'original intact.",
        );
      }
    }

    return {
      ok: true,
      id,
      name,
      bytes: produit.bytes,
      route: produit.route,
      verified,
      driftMetres: attendu ? drift : 0,
      sameLength: produit.bytes.length === bytes.length,
    };
  } catch (e) {
    if (e instanceof ExifError) return echec(e.code, e.message);
    return echec('ERREUR_INATTENDUE', "Ce fichier n'a pas pu être traité. Il n'a pas été modifié.");
  }
}
