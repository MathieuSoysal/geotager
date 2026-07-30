/**
 * Le contrat de traduction — une seule forme, deux remplissages.
 *
 * Tout ce que l'utilisateur lit passe par ici. Le moteur, lui, ne rend plus
 * jamais de phrase : il rend un MOTIF ou un CODE, et c'est l'interface qui
 * choisit les mots. C'est ce qui rend une seconde langue possible sans toucher
 * une ligne de chirurgie binaire — et ce qui garantit qu'une phrase oubliée est
 * une erreur de compilation, pas un mot français dans une page anglaise.
 *
 * Cette garantie tient parce que `npm run build` commence par `astro check`.
 * Pendant longtemps elle ne tenait pas : rien ne lisait ces types. `astro build`
 * transpile via esbuild, qui efface les annotations sans les vérifier, et les
 * tests tournent sous `--experimental-strip-types`, qui fait de même — le
 * contrat était donc écrit, jamais appliqué. Une clé ajoutée au mauvais objet a
 * livré une chaîne vide dans un élément lu par les seuls lecteurs d'écran ; le
 * paragraphe ci-dessus décrivait déjà exactement le contrôle qui l'aurait
 * arrêtée. Un type que personne ne vérifie est un commentaire.
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
    /** Texte de remplacement de l'image de partage. */
    imageAlt: string;
    nomLangue: string;
    sousCategorie: string;
    systeme: string;
    fonctions: string[];
  };

  nav: {
    viePrivee: string;
    modeEmploi: string;
    verifier: string;
    /** Le sommaire des guides — aussi le nom de sa marche du fil d'Ariane. */
    guides: string;
    sections: string;
    aller: string;
    /** Nom accessible du repère qui porte les cartes et l'article. */
    enSavoirPlus: string;
  };

  etapes: { titre: string; deposer: string; choisir: string; telecharger: string };

  hero: {
    deposez: string;
    ouCollez: string;
    titre: string;
    titreEm: string;
    sous: string;
    formats: string;
    /** Ce que voit quelqu'un dont le navigateur n'exécute pas de script. */
    sansJs: string;
    defiler: string;
  };

  app: {
    /** Titre masqué de l'état actif : cible du focus après le chargement. */
    titreActif: string;
    changer: string;
    ouPrise: string;
    aideCoords: string;
    aideCoordsFort: string;
    /** Saisie que l'analyseur refuse : texte d'erreur, annoncé et affiché. */
    coordsInvalides: string;
    /** La carte de choix du lieu — repliée tant qu'on ne la demande pas. */
    ouvrirCarte: string;
    fermerCarte: string;
    avisCarte: string;
    /** L'import du code de la carte a échoué — hors ligne, typiquement. */
    carteIndisponible: string;
    carteLabel: string;
    carteAide: string;
    zoomAvant: string;
    zoomArriere: string;
    contributeurs: string;
    repereOrigine: string;
    positionChoisie: (p: string) => string;
    telecharger: string;
    /** Pourquoi « Télécharger » est inactif tant qu'aucun lieu n'est choisi. */
    telechargerPourquoi: string;
    /** Partager la photo PRODUITE — jamais l'originale. */
    partagerSortie: string;
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
    /** Le partage est arrivé mais les octets n'ont pas survécu au trajet. */
    partagePerdu: string;
    /**
     * « Ouvrir avec » n'a rien apporté d'exploitable — fichier déplacé, effacé,
     * ou pas encore rapatrié depuis un espace distant.
     */
    ouverturePerdue: string;
    /** Une partie du lot seulement est arrivée ; le reste est chargé. */
    ouvertureIncomplete: (n: number) => string;
    /** Des photos rejoignent un lot déjà chargé, sans rien remplacer. */
    ajoutees: (n: number) => string;
    /** Le lot est plein : ce qui dépasse n'est pas ajouté, et c'est dit. */
    lotPlafonne: (n: number) => string;
    /** Bandeau de mise à jour — jamais automatique, voir `sw-modele.js`. */
    majDispo: string;
    majTravaux: string;
    majRecharger: string;
    majPlusTard: string;
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
    /** Légende du tableau, lue avant lui par les technologies d'assistance. */
    legende: string;
    format: string;
    colonnes: [string, string, string, string];
    oui: string;
    pasEncore: string;
    /** Libellé et mention de chaque ligne, par format meneur de la ligne. */
    lignes: Partial<Record<Format, { libelle: string; mention?: string }>>;
  };

  /**
   * Les étiquettes de la coquille des guides.
   *
   * Elles reviennent sur chacun des sept documents d'une langue : les écrire
   * dans les pages reviendrait à s'engager à corriger sept copies le jour où
   * une phrase change. La PROSE des guides, elle, reste dans les pages —
   * même règle que pour l'article sous la ligne de flottaison.
   */
  guides: {
    /** Nom accessible du fil d'Ariane, et nom de sa première marche. */
    filAriane: string;
    accueil: string;
    /** Le bloc qui ramène à l'outil, au milieu de chaque guide. */
    essayerTitre: string;
    essayerTexte: string;
    essayerBouton: string;
    /** La liste des autres guides, en fin de page. */
    autres: string;
    /** Le lien du sommaire vers un guide, et le mot du fil d'attente. */
    lire: string;
    /** Les deux dates déclarées, quand l'historique sait répondre. */
    publie: (d: string) => string;
    misAJour: (d: string) => string;
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

  /**
   * La page servie quand l'adresse ne mène nulle part.
   *
   * Elle vit hors de la coquille de l'outil : y afficher le sélecteur de photo
   * ferait croire que la page demandée existe et fonctionne.
   */
  introuvable: {
    titre: string;
    phrase: string;
    retour: string;
    autreLangue: string;
  };
}
