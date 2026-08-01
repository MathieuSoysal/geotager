/**
 * Ce que l'outil sait faire, format par format — source unique.
 *
 * Le tableau de chaque page est RENDU à partir de cette constante, et le
 * moteur la lit aussi. Le tableau ne peut donc plus dériver du code : la règle
 * « une case ne passe à oui qu'une fois son test vert » cesse d'être une
 * discipline pour devenir une propriété mécanique.
 *
 * Quatre colonnes, pas trois. « Corriger » et « Ajouter » sont deux opérations
 * différentes, et sur une photo d'iPhone la première est possible quand la
 * seconde ne l'est pas : remplacer un lieu déjà écrit ne change pas la longueur
 * du fichier, en créer un de toutes pièces oui. Une colonne « Modifier » unique
 * obligerait à mentir dans un sens ou dans l'autre.
 */

import type { Format } from './types.ts';

export interface Capacites {
  lire: boolean;
  /** Remplacer un lieu déjà présent. */
  corriger: boolean;
  /** En créer un là où il n'y en a pas. */
  ajouter: boolean;
  effacer: boolean;
  /** Retirer toutes les informations, pas seulement le lieu. */
  effacerTout: boolean;
}

const RIEN: Capacites = {
  lire: false,
  corriger: false,
  ajouter: false,
  effacer: false,
  effacerTout: false,
};

export interface LigneMatrice {
  /** Formats couverts par la ligne, dans l'ordre d'affichage. */
  formats: Format[];
  capacites: Capacites;
}

/**
 * La matrice format × opération. Chaque « oui » est adossé à un test qui passe
 * dans `test/engine.test.ts` — c'est la condition pour l'écrire ici.
 */
export const MATRICE: LigneMatrice[] = [
  {
    formats: ['jpeg'],
    capacites: { lire: true, corriger: true, ajouter: true, effacer: true, effacerTout: true },
  },
  {
    formats: ['heic', 'avif'],
    // « Ajouter » n'agrandit rien sur place : le nouveau bloc va dans une boîte
    // ajoutée en fin de fichier, et la seule entrée de la table des emplacements
    // qui le concerne est repointée. Le fichier grandit, aucun octet existant ne
    // bouge. Reste fermé fichier par fichier quand il n'y a aucun emplacement à
    // repointer — le conteneur le dit avant l'action.
    capacites: { lire: true, corriger: true, ajouter: true, effacer: true, effacerTout: false },
  },
  {
    formats: ['png'],
    // Aucun décalage absolu interne : agrandir un morceau n'invalide rien,
    // donc l'ajout est sûr. C'est le seul format de ce lot dans ce cas.
    capacites: { lire: true, corriger: true, ajouter: true, effacer: true, effacerTout: true },
  },
  {
    formats: ['webp'],
    // La forme simple n'a aucun emplacement prévu pour un lieu : il n'y a rien
    // à y lire ni à y corriger, et lui en créer un est hors de portée.
    // L'interface le dit fichier par fichier, avant l'action.
    capacites: { lire: true, corriger: true, ajouter: true, effacer: true, effacerTout: true },
  },
  {
    formats: ['tiff'],
    // Dit en mot de tous les jours : un fichier brut d'appareil photo est un
    // TIFF, et la ligne annoncerait sinon un ajout qu'elle refuse sur ceux-là.
    // Un négatif numérique est un TIFF, et lui ajouter des octets abîmerait un
    // original irremplaçable. « Ajouter » ne s'ouvre donc que sur les fichiers
    // qui PROUVENT être une image ordinaire — liste blanche éprouvée dans les
    // deux sens sur de vrais DNG, NEF, CR2 et de vrais TIFF. Sur un négatif, le
    // conteneur le dit avant l'action.
    capacites: { lire: true, corriger: true, ajouter: true, effacer: true, effacerTout: false },
  },
  {
    formats: ['video'],
    // Ces quatre cases ont passé six mois à « pas encore » faute d'un FICHIER,
    // pas faute de code : la recherche de corpus de Q-006 avait conclu qu'aucune
    // vidéo réelle sous licence libre n'existait, et c'était inexact. Trois en
    // ont été trouvées, et chaque case est désormais exécutée sur l'une d'elles.
    //
    // Une vidéo range son lieu en TEXTE, à plusieurs endroits à la fois. Corriger
    // ne déplace aucun octet quand les rangements sont assez longs ; sinon, le
    // fichier grandit, ce qui demande la même permission qu'un ajout. Et quand
    // le lieu est aussi écrit tout au long de l'enregistrement — une caméra
    // d'action le fait —, les trois opérations d'écriture se ferment fichier par
    // fichier plutôt que de rendre un fichier faussement propre. Voir Q-050.
    capacites: { lire: true, corriger: true, ajouter: true, effacer: true, effacerTout: false },
  },
];

/** Ce que l'outil sait faire d'un format, indépendamment du fichier reçu. */
export function capacitesDe(format: Format): Capacites {
  const ligne = MATRICE.find((l) => l.formats.includes(format));
  if (ligne) return ligne.capacites;
  // Un GIF ne peut pas porter de lieu, un format inconnu ne se lit pas.
  return RIEN;
}

/**
 * Les quatre cases d'une ligne, dans l'ordre des colonnes.
 *
 * Rend des booléens, pas des mots : le tableau dit la même vérité dans toutes
 * les langues, et c'est le dictionnaire qui choisit comment la dire.
 */
export function cellules(c: Capacites): boolean[] {
  return [c.lire, c.corriger, c.ajouter, c.effacer];
}

/* ------------------------------------------------------------------ */
/* Les phrases                                                         */
/* ------------------------------------------------------------------ */

/**
 * Pourquoi l'outil peut, ou ne peut pas, agir sur CE fichier-là.
 *
 * L'interface annonce la voie AVANT l'action. On ne promet jamais une écriture
 * qu'on ne sait pas tenir : mieux vaut dire « nous ne savons pas encore » que
 * rendre un fichier que l'utilisateur croira nettoyé.
 */
export type Motif =
  | 'ok'
  | 'sans-lieu'
  | 'sans-emplacement'
  | 'forme-inhabituelle'
  | 'rangement-inconnu'
  | 'copie-compressee'
  | 'copie-ailleurs'
  | 'lecture-seule'
  | 'sans-lieu-possible'
  // Une vidéo qui enregistre le lieu tout au long de son déroulement. La seule
  // raison qui ferme les trois écritures d'un coup en laissant la lecture
  // ouverte : le lieu principal s'affiche très bien, et c'est justement
  // pourquoi il faut dire qu'il n'est pas le seul.
  | 'lieu-en-mouvement'
  | 'inconnu';

// Les phrases elles-mêmes vivent dans src/lib/i18n/ : le moteur rend un motif,
// l'interface choisit les mots. C'est ce qui permet une seconde langue sans
// toucher une ligne de chirurgie binaire — et ce qui garantit qu'une phrase
// manquante est une erreur de compilation, pas un mot français dans une page
// anglaise.
