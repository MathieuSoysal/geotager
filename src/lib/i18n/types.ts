/**
 * The translation contract: one shape, two fillings.
 *
 * Everything the user reads passes through here. The engine never returns a
 * sentence: it returns a reason or a code, and the interface picks the words.
 * That is what makes a second language possible without touching a line of
 * binary surgery, and what makes a forgotten sentence a compile error rather
 * than a French word on an English page.
 */

import type { Motif } from '../exif/capacites.ts';
import type { Format } from '../exif/types.ts';

export type Langue = 'en' | 'fr';

/** Error codes the user can see. */
export type CodeErreur =
  | 'AJOUT_IMPOSSIBLE'
  | 'COPIE_DU_LIEU_SUBSISTE'
  | 'EFFACEMENT_TOTAL_IMPOSSIBLE'
  | 'ERREUR_INATTENDUE'
  | 'EXIF_CORROMPU'
  | 'EXIF_TROP_VOLUMINEUX'
  | 'FICHIER_CORROMPU'
  | 'FICHIER_TRONQUE'
  | 'FORMAT_NON_MODIFIABLE'
  | 'FORMAT_NON_PRIS_EN_CHARGE'
  | 'OCTETS_HORS_PLAGE'
  | 'PAS_UN_JPEG'
  | 'PLAGES_CHEVAUCHANTES'
  | 'RELECTURE_CROISEE_DIVERGENTE'
  | 'STRUCTURE_INATTENDUE'
  | 'VERIFICATION_ECHOUEE';

export interface Dictionnaire {
  langue: Langue;
  /** The document's language tag, and the Open Graph locale. */
  htmlLang: string;
  ogLocale: string;
  /** Root path for this language. English is at the root. */
  base: string;

  meta: {
    titre: string;
    description: string;
    /** Alternative text for the share image. */
    imageAlt: string;
    nomLangue: string;
    sousCategorie: string;
    systeme: string;
    fonctions: string[];
  };

  nav: { viePrivee: string; modeEmploi: string; verifier: string; sections: string; aller: string };

  etapes: { titre: string; deposer: string; choisir: string; telecharger: string };

  hero: {
    deposez: string;
    ouCollez: string;
    titre: string;
    titreEm: string;
    sous: string;
    formats: string;
    defiler: string;
  };

  app: {
    /** Hidden title of the active state: focus target after loading. */
    titreActif: string;
    changer: string;
    ouPrise: string;
    aideCoords: string;
    aideCoordsFort: string;
    /** Input the parser refuses: error text, announced and displayed. */
    coordsInvalides: string;
    /** The location picker map, folded away until it is asked for. */
    ouvrirCarte: string;
    fermerCarte: string;
    avisCarte: string;
    carteLabel: string;
    carteAide: string;
    zoomAvant: string;
    zoomArriere: string;
    contributeurs: string;
    repereOrigine: string;
    positionChoisie: (p: string) => string;
    telecharger: string;
    effacer: string;
    effacerTout: string;
    autres: string;
    aucuneChargee: string;
    actuellement: string;
    illisible: string;
    positionLue: string;
    sansPosition: string;
    effacementSeul: string;
    lectureSeule: string;
    fichiers: string;
    modifiables: string;
    lecturePlurielle: (n: number) => string;
    traitement: (i: number, n: number) => string;
    photoLue: (p: string) => string;
    photoLueSansPosition: string;
    illisibleAlerte: string;
    aucunProduit: string;
    aucunProduitAnnonce: string;
    sansRienDeplacer: string;
    ecrit: string;
    /** Decimal separator, and file size units. */
    virgule: string;
    octets: [string, string, string];
    nomVideo: string;
    nomInconnu: string;
    telechargerPhotos: (n: number) => string;
    depuisOrigine: (d: string) => string;
    nouvellePosition: string;
    pretsVerifies: (n: number) => string;
    pretsAvecEchecs: (n: number, e: number) => string;
    /** Update banner, never automatic. See `sw-modele.js`. */
    majDispo: string;
    majTravaux: string;
    majRecharger: string;
    majPlusTard: string;
    zip: string;
    /** Suffixes appended to the produced file's name. */
    suffixeLieu: string;
    suffixeSansLieu: string;
    suffixeSansInfos: string;
  };

  /** Labels for the collapsed panel. The engine returns keys only. */
  infos: Record<string, string>;

  /** One sentence per reason: the interface announces the route beforehand. */
  motifs: Record<Motif, string>;

  /** One sentence per error code. The engine returns only the code. */
  erreurs: Record<CodeErreur, string>;

  matrice: {
    /** Table caption, read before it by assistive technology. */
    legende: string;
    format: string;
    colonnes: [string, string, string, string];
    oui: string;
    pasEncore: string;
    /** Label and note for each row, keyed by the row's leading format. */
    lignes: Partial<Record<Format, { libelle: string; mention?: string }>>;
  };

  /** The article below the fold keeps its headings here: the build check looks
   *  for them, so they must be named in one place. */
  titres: {
    pourquoiPrive: string;
    modeEmploi: string;
    limites: string;
    exif: string;
    viePrivee: string;
    verifier: string;
  };

  pitch: Array<{ titre: string; texte: string }>;

  pied: string;
}
