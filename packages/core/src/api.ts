/**
 * La façade publique du paquet.
 *
 * Tout ce qui est en dessous parle la langue du dépôt — `lirePosition`,
 * `ecrirePosition`, `sonder`. Ce module-ci parle celle de l'écosystème npm, et
 * c'est délibéré : un paquet publié est lu par des gens, et par des agents, qui
 * n'ouvriront jamais `conteneurs.ts`. Les noms d'ici sont donc ceux qu'on
 * devine sans documentation — `readGps`, `setGps`, `stripGps` — et `lng` plutôt
 * que `lon`, parce que c'est ce que les cartes du Web écrivent.
 *
 * Deux principes gouvernent cette frontière :
 *
 *   1. ON REND DES OCTETS, JAMAIS UN CHEMIN. Rien ici n'ouvre un fichier. Ce
 *      module fonctionne à l'identique dans Node, dans un navigateur, dans un
 *      Worker, dans une fonction de bord — parce qu'il n'a aucune idée d'où
 *      viennent les octets qu'on lui donne.
 *   2. ON LÈVE PLUTÔT QUE DE RENDRE UN FICHIER DOUTEUX. Le moteur ne produit un
 *      fichier que s'il a pu prouver, sur les octets produits, que l'opération
 *      a bien eu lieu et que RIEN d'autre n'a bougé. Quand la preuve manque,
 *      l'original est rendu intact — ce qui, au niveau d'une fonction, se dit
 *      en levant. Un appelant qui préfère décider lui-même a `applyGps`, qui
 *      rend le refus au lieu de le lever.
 */

import { appliquer, lire, sonder } from './moteur.ts';
import { type Motif, capacitesDe } from './capacites.ts';
import { readAltitude, parseTiff } from './tiff.ts';
import { conteneurDe } from './conteneurs.ts';
import { GeotagError } from './erreurs.ts';
import type { Format, PhotoRead, WriteResult } from './types.ts';

/* ------------------------------------------------------------------ */
/* Ce qui entre                                                        */
/* ------------------------------------------------------------------ */

/**
 * Les octets d'un fichier, sous n'importe laquelle des formes courantes.
 *
 * `Buffer` — ce que rend `fs.readFile` — est un `Uint8Array`, donc il entre
 * sans mention spéciale. `ArrayBufferView` couvre les vues fenêtrées, dont le
 * décalage est respecté plutôt qu'ignoré.
 */
export type ImageInput = Uint8Array | ArrayBuffer | ArrayBufferView;

/** Un lieu, tel que le reste du Web l'écrit. */
export interface GpsCoordinates {
  lat: number;
  lng: number;
  /** Mètres, positive au-dessus du niveau de la mer. Absente si le fichier n'en porte pas. */
  alt?: number;
}

/** Un lieu à écrire. `lon` est accepté comme synonyme de `lng`. */
export interface GpsInput {
  lat: number;
  lng?: number;
  lon?: number;
  alt?: number;
}

export interface WriteOptions {
  /**
   * Précision du geste qui a désigné le lieu, en mètres.
   *
   * Inscrite dans `GPSHPositioningError`. À ne renseigner que si elle a été
   * MESURÉE : un chiffre inventé dans ce champ est pire que son absence.
   */
  accuracyMetres?: number;
}

function octets(input: ImageInput): Uint8Array {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new GeotagError(
    'ENTREE_INVALIDE',
    'Expected image bytes: a Uint8Array, Buffer, ArrayBuffer or ArrayBufferView.',
  );
}

/** La longitude, quel que soit le nom sous lequel on l'a passée. */
function longitudeDe(gps: GpsInput): number {
  const v = gps.lng ?? gps.lon;
  if (typeof v !== 'number') {
    throw new GeotagError('ENTREE_INVALIDE', 'Missing longitude: pass either `lng` or `lon`.');
  }
  return v;
}

function valider(lat: number, lng: number, alt?: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new GeotagError('ENTREE_INVALIDE', 'Latitude and longitude must be finite numbers.');
  }
  if (Math.abs(lat) > 90) {
    throw new GeotagError('ENTREE_INVALIDE', `Latitude out of range: ${lat} (expected -90..90).`);
  }
  if (Math.abs(lng) > 180) {
    throw new GeotagError('ENTREE_INVALIDE', `Longitude out of range: ${lng} (expected -180..180).`);
  }
  if (alt !== undefined && !Number.isFinite(alt)) {
    throw new GeotagError('ENTREE_INVALIDE', 'Altitude must be a finite number of metres.');
  }
  /*
   * Le point (0, 0), refusé À L'ENTRÉE et non au bout de la vérification.
   *
   * Notre lecteur écarte nommément ce couple : il est la trace d'un logiciel
   * qui a purgé les coordonnées sans retirer les entrées, et annoncer le golfe
   * de Guinée pour un fichier sans lieu est le mensonge que cet outil ne peut
   * pas se permettre. L'écrire produirait donc un fichier que l'outil
   * lui-même déclarerait sans lieu — et le refus tombait effectivement, mais
   * douze étapes plus loin, sous un « la position relue ne correspond pas »
   * qui accuse l'encodeur au lieu de nommer la vraie raison.
   *
   * Le refuser ici coûte une comparaison et rend un message exploitable. La
   * borne est l'égalité EXACTE : 0,00001° est un lieu au large du Ghana, et
   * quelqu'un qui l'écrit sait ce qu'il fait.
   */
  if (lat === 0 && lng === 0) {
    throw new GeotagError(
      'ENTREE_INVALIDE',
      'Refusing to write exactly 0, 0: this tool reads that pair as "no location" — ' +
        'it is what software leaves behind after wiping coordinates without removing the ' +
        'fields — so the file would come back reporting no location at all. ' +
        'Use stripGps() to remove a location, or pass real coordinates.',
    );
  }
}

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

/**
 * Le lieu inscrit dans un fichier, ou `null`.
 *
 * Synchrone, et c'est notre moteur seul qui répond. `null` est une réponse à
 * part entière et la seule honnête quand le fichier ne porte rien : ce paquet
 * n'invente jamais un lieu de repli. Deux cas se rendent `null` alors qu'un
 * lecteur naïf annoncerait une position — un dénominateur nul, qu'un Galaxy S10
 * écrit sans relevé, et la latitude ET longitude exactement nulles, que laisse
 * un logiciel ayant purgé les coordonnées sans retirer les entrées. Le golfe de
 * Guinée n'est le lieu de personne.
 *
 * Pour les fichiers dont notre moteur ne localise pas le bloc, `readMetadata`
 * consulte en plus un second lecteur et trouve parfois là où celle-ci rend
 * `null`.
 */
export function readGps(input: ImageInput): GpsCoordinates | null {
  const bytes = octets(input);
  const sonde = sonder(bytes);
  if (!sonde.position) return null;

  const out: GpsCoordinates = { lat: sonde.position.lat, lng: sonde.position.lon };
  for (const bloc of sonde.blocs) {
    const alt = readAltitude(bloc.vue);
    if (alt !== null) {
      out.alt = alt;
      break;
    }
  }
  return out;
}

/** Tout ce que le fichier dit de lui-même, second lecteur compris. */
export interface Metadata {
  /** Format reconnu aux seuls octets de tête, jamais à l'extension du nom. */
  format: Format;
  size: number;
  gps: GpsCoordinates | null;
  takenAt: string | null;
  camera: string | null;
  /**
   * Ce que l'outil sait faire de CE fichier — pas de son format.
   *
   * La nuance est toute la valeur du champ : sur une photo d'iPhone,
   * `replaceLocation` est vrai et `addLocation` faux, parce que remplacer un
   * lieu déjà écrit ne change pas la longueur du fichier et en créer un oui.
   */
  can: {
    read: boolean;
    /** Remplacer un lieu déjà présent. */
    replaceLocation: boolean;
    /** En créer un là où il n'y en a pas. */
    addLocation: boolean;
    removeLocation: boolean;
    removeAllMetadata: boolean;
  };
  /** POURQUOI l'outil peut ou ne peut pas agir. Une clé stable, pas une phrase. */
  reason: Motif;
  details: Array<{ key: string; value: string }>;
}

/** Lit tout ce qu'un fichier dit de lui-même. */
export async function readMetadata(input: ImageInput): Promise<Metadata> {
  const bytes = octets(input);
  const brut: PhotoRead = await lire('', '', bytes);
  const sonde = sonder(bytes);

  const gps: GpsCoordinates | null = brut.position
    ? { lat: brut.position.lat, lng: brut.position.lon }
    : null;
  if (gps && brut.altitude !== null) gps.alt = brut.altitude;

  return {
    format: brut.format,
    size: brut.size,
    gps,
    takenAt: brut.takenAt,
    camera: brut.camera,
    can: {
      read: sonde.capacites.lire,
      replaceLocation: sonde.capacites.corriger,
      addLocation: sonde.capacites.ajouter,
      removeLocation: sonde.capacites.effacer,
      removeAllMetadata: sonde.capacites.effacerTout,
    },
    reason: brut.motif,
    details: brut.details.map((d) => ({ key: d.cle, value: d.value })),
  };
}

/** Le format d'un fichier, reconnu à ses seuls octets de tête. */
export function detectFormat(input: ImageInput): Format {
  return sonder(octets(input)).format;
}

/**
 * Ce que l'outil sait faire de ce fichier — la même sonde que celle qui écrira.
 *
 * À interroger AVANT d'agir quand on traite un lot : elle dit, fichier par
 * fichier, ce qui aboutira. C'est la même fonction que celle du moteur, donc
 * l'annonce et le comportement ne peuvent pas diverger.
 */
export function inspect(input: ImageInput): {
  format: Format;
  reason: Motif;
  hasGps: boolean;
  can: Metadata['can'];
} {
  const sonde = sonder(octets(input));
  return {
    format: sonde.format,
    reason: sonde.motif,
    hasGps: sonde.position !== null,
    can: {
      read: sonde.capacites.lire,
      replaceLocation: sonde.capacites.corriger,
      addLocation: sonde.capacites.ajouter,
      removeLocation: sonde.capacites.effacer,
      removeAllMetadata: sonde.capacites.effacerTout,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Écriture                                                            */
/* ------------------------------------------------------------------ */

/** Le résultat détaillé d'une opération, refus compris. */
export type ApplyResult =
  | {
      ok: true;
      bytes: Uint8Array;
      /** `P1` : aucun octet déplacé. `P2` : le fichier a grandi en fin de bloc. */
      route: 'P1' | 'P2';
      /** La position RELUE dans le fichier produit, jamais celle demandée. */
      verified: GpsCoordinates | null;
      /** Écart entre le lieu demandé et le lieu relu, en mètres. */
      driftMetres: number;
      sameLength: boolean;
    }
  | { ok: false; code: string; message: string; reason?: Motif };

/** L'opération demandée, dans la langue de la façade. */
export type Operation =
  | { kind: 'set'; lat: number; lng: number; alt?: number; accuracyMetres?: number }
  | { kind: 'strip' }
  | { kind: 'stripAll' };

/**
 * Applique une opération et rend le refus AU LIEU DE LE LEVER.
 *
 * C'est la voie à prendre pour un lot : un fichier refusé n'y interrompt pas
 * les autres, et le code du refus est exploitable — `FORMAT_NON_MODIFIABLE`,
 * `COPIE_DU_LIEU_SUBSISTE`, `AJOUT_IMPOSSIBLE`. `setGps` et `stripGps` sont
 * cette fonction plus un `throw`.
 */
export async function applyGps(input: ImageInput, operation: Operation): Promise<ApplyResult> {
  const bytes = octets(input);

  let interne;
  if (operation.kind === 'set') {
    valider(operation.lat, operation.lng, operation.alt);
    interne = {
      kind: 'set' as const,
      position: { lat: operation.lat, lon: operation.lng },
      accuracyMetres: operation.accuracyMetres,
      altitudeMetres: operation.alt,
    };
  } else {
    interne = { kind: operation.kind === 'strip' ? ('erase' as const) : ('eraseAll' as const) };
  }

  const r: WriteResult = await appliquer('', '', bytes, interne);
  if (!r.ok) return { ok: false, code: r.code, message: r.message, reason: r.motif };

  const verified: GpsCoordinates | null = r.verified
    ? { lat: r.verified.lat, lng: r.verified.lon }
    : null;
  if (verified) {
    const alt = altitudeDe(r.bytes);
    if (alt !== null) verified.alt = alt;
  }
  return {
    ok: true,
    bytes: r.bytes,
    route: r.route,
    verified,
    driftMetres: r.driftMetres,
    sameLength: r.sameLength,
  };
}

function altitudeDe(bytes: Uint8Array): number | null {
  try {
    const c = conteneurDe(bytes);
    if (!c) return null;
    for (const e of c.localiser(bytes)) {
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

function lever(r: Extract<ApplyResult, { ok: false }>): never {
  throw new GeotagError(r.code, r.message, r.reason);
}

/**
 * Écrit un lieu et rend les octets du fichier produit.
 *
 * L'original n'est jamais modifié : ce sont de NOUVEAUX octets qui sortent.
 * Le fichier produit est identique à l'entrée partout hors de l'endroit du
 * lieu — c'est vérifié octet par octet avant de rendre, et un écart lève. Un
 * MakerNote, un profil ICC, une vignette traversent donc l'opération intacts.
 *
 * `alt` est écrite seulement si on la passe, et lève si le fichier ne peut pas
 * la porter — plutôt que de rendre un fichier où elle manque en silence.
 */
export async function setGps(
  input: ImageInput,
  gps: GpsInput,
  options: WriteOptions = {},
): Promise<Uint8Array> {
  const r = await applyGps(input, {
    kind: 'set',
    lat: gps.lat,
    lng: longitudeDe(gps),
    alt: gps.alt,
    accuracyMetres: options.accuracyMetres,
  });
  return r.ok ? r.bytes : lever(r);
}

/**
 * Retire le lieu, et rien d'autre : la date, l'appareil et les réglages restent.
 *
 * Le retrait couvre TOUS les rangements du fichier, pas seulement le principal
 * — un HEIC en porte un second rattaché à sa vignette, une vidéo en porte
 * plusieurs à la fois. Quand une copie subsiste sous une forme que le moteur ne
 * sait pas retirer, il lève plutôt que de rendre un fichier qu'on croirait
 * propre. C'est le pire résultat possible pour un outil de ce genre, et le seul
 * qu'il ne produira pas.
 */
export async function stripGps(input: ImageInput): Promise<Uint8Array> {
  const r = await applyGps(input, { kind: 'strip' });
  return r.ok ? r.bytes : lever(r);
}

/**
 * Retire TOUTES les informations, pas seulement le lieu — sans réencoder
 * l'image : les pixels sortent au bit près.
 *
 * Tous les formats ne le permettent pas ; `inspect().can.removeAllMetadata` le
 * dit avant d'essayer.
 */
export async function stripAllMetadata(input: ImageInput): Promise<Uint8Array> {
  const r = await applyGps(input, { kind: 'stripAll' });
  return r.ok ? r.bytes : lever(r);
}

/** Ce que l'outil sait faire d'un format, indépendamment du fichier reçu. */
export function formatCapabilities(format: Format) {
  const c = capacitesDe(format);
  return {
    read: c.lire,
    replaceLocation: c.corriger,
    addLocation: c.ajouter,
    removeLocation: c.effacer,
    removeAllMetadata: c.effacerTout,
  };
}
