/**
 * Le contrat de traduction — une seule forme, deux remplissages.
 *
 * Tout ce que l'utilisateur lit passe par ici. Le moteur, lui, ne rend plus
 * jamais de phrase : il rend un MOTIF ou un CODE, et c'est l'interface qui
 * choisit les mots. C'est ce qui rend une seconde langue possible sans toucher
 * une ligne de chirurgie binaire — et ce qui garantit qu'une phrase oubliée est
 * une erreur de compilation, pas un mot français dans une page anglaise.
 */

import type { Motif } from '../exif/capacites.ts';
import type { Format } from '../exif/types.ts';

export type Langue = 'en' | 'fr';

/** Codes d'erreur que l'utilisateur peut voir. */
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
  /** Étiquette de langue du document, et locale Open Graph. */
  htmlLang: string;
  ogLocale: string;
  /** Chemin racine de cette langue. L'anglais est à la racine. */
  base: string;

  meta: {
    titre: string;
    description: string;
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
    changer: string;
    ouPrise: string;
    aideCoords: string;
    aideCoordsFort: string;
    /** La carte de choix du lieu — repliée tant qu'on ne la demande pas. */
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
    /** Séparateur décimal, et unités de taille de fichier. */
    virgule: string;
    octets: [string, string, string];
    nomVideo: string;
    nomInconnu: string;
    telechargerPhotos: (n: number) => string;
    depuisOrigine: (d: string) => string;
    nouvellePosition: string;
    pretsVerifies: (n: number) => string;
    pretsAvecEchecs: (n: number, e: number) => string;
    zip: string;
    /** Suffixes ajoutés au nom du fichier rendu. */
    suffixeLieu: string;
    suffixeSansLieu: string;
    suffixeSansInfos: string;
  };

  /** Libellés de la zone repliée. Le moteur n'en rend que les clés. */
  infos: Record<string, string>;

  /** Une phrase par motif — l'interface annonce la voie AVANT l'action. */
  motifs: Record<Motif, string>;

  /** Une phrase par code d'erreur. Le moteur ne rend que le code. */
  erreurs: Record<CodeErreur, string>;

  matrice: {
    format: string;
    colonnes: [string, string, string, string];
    oui: string;
    pasEncore: string;
    /** Libellé et mention de chaque ligne, par format meneur de la ligne. */
    lignes: Partial<Record<Format, { libelle: string; mention?: string }>>;
  };

  /** L'article sous la ligne de flottaison a ses titres ici : le contrôle de
   *  build les cherche, et ils doivent donc être nommés une seule fois. */
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
