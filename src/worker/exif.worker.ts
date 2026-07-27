/// <reference lib="webworker" />
/**
 * Worker de métadonnées.
 *
 * Tout le travail binaire vit ici : le thread principal ne fait que passer des
 * octets et recevoir des résultats. Aucune requête réseau n'est émise depuis ce
 * fichier, et il n'en émettra jamais — c'est vérifiable dans le dépôt public.
 */
import exifr from 'exifr';
import '../lib/exif/formats.ts';
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
} from '../lib/exif/conteneurs.ts';
import { type Capacites, type Motif, capacitesDe, phraseDe } from '../lib/exif/capacites.ts';
import { ecrirePositionSurPlace } from '../lib/exif/tiff.ts';
import { ExifError } from '../lib/exif/erreurs.ts';
import { distanceMetres } from '../lib/exif/coords.ts';
import type {
  Format,
  FromWorker,
  LatLon,
  PhotoRead,
  ToWorker,
  WriteResult,
} from '../lib/exif/types.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

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
interface Sonde {
  format: Format;
  conteneur: Conteneur | null;
  blocs: BlocLu[];
  position: LatLon | null;
  capacites: Capacites;
  motif: Motif;
  phrase: string;
}

function sonder(bytes: Uint8Array): Sonde {
  const format = detecterFormat(bytes);
  const statiques = capacitesDe(format);
  const vide = { format, conteneur: null, blocs: [], position: null };

  if (format === 'inconnu') {
    return { ...vide, capacites: statiques, motif: 'inconnu', phrase: phraseDe('inconnu') };
  }
  if (format === 'video') {
    return { ...vide, capacites: statiques, motif: 'video', phrase: phraseDe('video') };
  }

  const conteneur = conteneurDe(bytes);
  // Un format que le tableau donne en lecture seule, ou pour lequel aucun
  // conteneur n'est encore écrit, s'arrête ici : la phrase le dit sans jargon.
  if (!conteneur || !(statiques.corriger || statiques.ajouter || statiques.effacer)) {
    const motif: Motif = format === 'gif' ? 'sans-lieu-possible' : 'lecture-seule';
    return { ...vide, capacites: { ...statiques, corriger: false, ajouter: false, effacer: false },
      motif, phrase: phraseDe(motif) };
  }

  let blocs: BlocLu[] = [];
  try {
    blocs = lireBlocs(conteneur, bytes);
  } catch {
    // Un fichier dont la structure est illisible n'est pas modifiable ; il
    // reste lisible par ailleurs, via l'autre lecteur.
    return { ...vide, conteneur, capacites: { ...statiques, corriger: false, ajouter: false, effacer: false },
      motif: 'rangement-inconnu', phrase: phraseDe('rangement-inconnu') };
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

  const capacites: Capacites = {
    lire: statiques.lire,
    corriger: statiques.corriger && (surPlace || statiques.ajouter),
    ajouter: statiques.ajouter,
    effacer: statiques.effacer,
    effacerTout: statiques.effacerTout,
  };

  let motif: Motif;
  if (position !== null) {
    motif = capacites.corriger ? 'ok' : 'forme-inhabituelle';
  } else if (capacites.ajouter) {
    motif = 'ok';
  } else if (blocs.length === 0 && !statiques.ajouter) {
    motif = 'sans-emplacement';
  } else {
    motif = 'sans-lieu';
  }

  return { format, conteneur, blocs, position, capacites, motif, phrase: phraseDe(motif) };
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

function texteDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.valueOf())) return v.toISOString();
  if (typeof v === 'string' && v.trim()) return v;
  return null;
}

async function lire(id: string, name: string, buffer: ArrayBuffer): Promise<PhotoRead> {
  const bytes = new Uint8Array(buffer);
  const sonde = sonder(bytes);
  const format = sonde.format;

  // C'est notre moteur qui écrira, donc c'est lui qui doit dire ce qu'il voit.
  let position: LatLon | null = sonde.position;
  let altitude: number | null = null;
  let takenAt: string | null = null;
  let camera: string | null = null;
  const details: Array<{ label: string; value: string }> = [];

  try {
    const tags = (await exifr.parse(buffer, {
      tiff: true,
      exif: true,
      gps: true,
      ifd0: true,
      translateValues: true,
      reviveValues: true,
    })) as Record<string, unknown> | undefined;

    if (tags) {
      if (!position && typeof tags.latitude === 'number' && typeof tags.longitude === 'number') {
        position = { lat: tags.latitude, lon: tags.longitude };
      }
      if (typeof tags.GPSAltitude === 'number') altitude = tags.GPSAltitude;
      takenAt = texteDate(tags.DateTimeOriginal ?? tags.CreateDate ?? tags.ModifyDate);
      const make = typeof tags.Make === 'string' ? tags.Make.trim() : '';
      const model = typeof tags.Model === 'string' ? tags.Model.trim() : '';
      camera = [make, model].filter(Boolean).join(' ') || null;

      const interessants: Array<[string, string]> = [
        ['Orientation', 'Orientation'],
        ['ExposureTime', "Temps de pose"],
        ['FNumber', 'Ouverture'],
        ['ISO', 'Sensibilité'],
        ['FocalLength', 'Focale'],
        ['LensModel', 'Objectif'],
        ['Software', 'Logiciel'],
        ['Artist', 'Auteur'],
        ['Copyright', 'Copyright'],
      ];
      for (const [cle, label] of interessants) {
        const v = tags[cle];
        if (v !== undefined && v !== null && String(v).trim()) {
          details.push({ label, value: String(v) });
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
    routeReason: sonde.phrase,
    position,
    altitude,
    takenAt,
    camera,
    details,
  };
}

/**
 * Vérification après écriture — non négociable.
 *
 * Le fichier produit est relu et la position comparée à celle demandée. Un
 * écart ou une absence fait échouer l'opération et rend l'original intact :
 * sur un outil de métadonnées, l'échec silencieux est le pire mode de
 * défaillance, parce que l'utilisateur publie en croyant avoir nettoyé.
 */
async function verifier(
  bytes: Uint8Array,
  attendu: LatLon | null,
): Promise<{ verified: LatLon | null; drift: number; croise: boolean }> {
  const parNous = (() => {
    try {
      const c = conteneurDe(bytes);
      return c ? lirePosition(c, bytes) : null;
    } catch {
      return null;
    }
  })();

  // Relecture croisée par un moteur indépendant. Deux implémentations
  // symétriquement fausses passeraient une auto-relecture sans écart.
  let parExifr: LatLon | null = null;
  try {
    const t = (await exifr.gps(bytes.slice().buffer)) as
      | { latitude: number; longitude: number }
      | undefined;
    if (t && Number.isFinite(t.latitude)) parExifr = { lat: t.latitude, lon: t.longitude };
  } catch {
    parExifr = null;
  }

  const croise =
    (parNous === null && parExifr === null) ||
    (parNous !== null && parExifr !== null && distanceMetres(parNous, parExifr) < 1);

  if (attendu === null) {
    return { verified: parNous, drift: parNous === null ? 0 : Infinity, croise };
  }
  if (!parNous) return { verified: null, drift: Infinity, croise };
  return { verified: parNous, drift: distanceMetres(parNous, attendu), croise };
}

async function appliquer(
  id: string,
  name: string,
  buffer: ArrayBuffer,
  operation: Extract<ToWorker, { type: 'apply' }>['operation'],
): Promise<WriteResult> {
  const bytes = new Uint8Array(buffer);
  // On resonde les octets reçus plutôt que de faire confiance à la lecture
  // précédente : l'annonce et le comportement lisent ainsi la même source.
  const sonde = sonder(bytes);

  const echec = (code: string, message: string): WriteResult => ({
    ok: false,
    id,
    name,
    code,
    message,
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

  // Le refus reprend mot pour mot la phrase déjà annoncée avant l'action : ce
  // que l'utilisateur a lu et ce qu'il obtient ne peuvent pas se contredire.
  if (!permise || !conteneur) return echec('FORMAT_NON_MODIFIABLE', sonde.phrase);

  try {
    let produit: Ecriture;
    let attendu: LatLon | null = null;

    if (operation.kind === 'set') {
      produit = ecrirePosition(
        conteneur,
        bytes,
        operation.position.lat,
        operation.position.lon,
        operation.accuracyMetres,
      );
      attendu = operation.position;
    } else if (operation.kind === 'erase') {
      produit = effacerPosition(conteneur, bytes);
    } else {
      produit = toutEffacer(conteneur, bytes);
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

    const { verified, drift, croise } = await verifier(produit.bytes, attendu);

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

/* ---------------------------------------------------------------- */

ctx.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  void (async () => {
    if (msg.type === 'read') {
      try {
        const payload = await lire(msg.id, msg.name, msg.buffer);
        post({ type: 'read:ok', payload });
      } catch (e) {
        const err = e instanceof ExifError ? e : null;
        post({
          type: 'read:fail',
          id: msg.id,
          name: msg.name,
          code: err?.code ?? 'ERREUR_INATTENDUE',
          message: err?.message ?? "Ce fichier n'a pas pu être lu.",
        });
      }
      return;
    }
    if (msg.type === 'apply') {
      const payload = await appliquer(msg.id, msg.name, msg.buffer, msg.operation);
      if (payload.ok) {
        post({ type: 'apply:done', payload }, [payload.bytes.buffer]);
      } else {
        post({ type: 'apply:done', payload });
      }
    }
  })();
});

function post(message: FromWorker, transfer: Transferable[] = []): void {
  ctx.postMessage(message, transfer);
}
