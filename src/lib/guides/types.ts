/**
 * Le contrat des guides — une seule forme, deux remplissages.
 *
 * Même discipline que `i18n/types.ts` : ce fichier décrit ce qu'une fiche
 * DOIT porter, et `astro check` fait échouer la build quand une langue en
 * oublie une. Un guide anglais sans son jumeau français ne serait pas
 * seulement une page manquante : les deux pages du site déclarent leurs
 * `hreflang` réciproquement, et le contrôle de build exige que chaque page
 * indexable annonce TOUTES les langues. Une fiche esseulée casse la build,
 * ce qui est exactement ce qu'on veut.
 *
 * CE QUI VIT ICI, ET CE QUI N'Y VIT PAS. Ici : ce dont la structure a besoin —
 * l'adresse, le titre, la description, le résumé d'une ligne. Ces quatre-là
 * sont lus par le sommaire, par le plan du site, par les liens croisés et par
 * le `<head>` ; les écrire deux fois serait leur donner deux occasions de se
 * contredire. La PROSE, elle, reste dans la page qui la porte : c'est de la
 * prose, pas des étiquettes, et la découper en clés la rendrait illisible à
 * écrire comme à relire. C'est la règle déjà suivie par l'article sous la
 * ligne de flottaison de la page d'accueil.
 */

/**
 * L'identité d'un guide, stable d'une langue à l'autre.
 *
 * C'est elle qui apparie la version anglaise et la version française — jamais
 * l'adresse, qui diffère exprès : un lecteur francophone cherche « supprimer
 * la géolocalisation d'une photo », pas « remove-photo-location ». Une adresse
 * partagée serait une adresse fausse dans une des deux langues.
 */
export type IdGuide =
  | 'modifier'
  | 'verifier'
  | 'supprimer'
  | 'ajouter'
  | 'iphone'
  | 'reseaux';

/** L'ordre d'affichage, commun aux deux langues. */
export const ORDRE_GUIDES: IdGuide[] = [
  'modifier',
  'verifier',
  'supprimer',
  'ajouter',
  'iphone',
  'reseaux',
];

export interface FicheGuide {
  /**
   * Le segment d'adresse, dans la langue de la page, sans barre oblique.
   *
   * Il est écrit une fois et ne se réécrit plus : une adresse publiée qui
   * change devient une adresse morte pour tous ceux qui l'ont partagée, et ce
   * site n'a aucun moyen de rediriger une page vers une autre — l'hébergeur
   * ne sert que des fichiers statiques et une seule règle de redirection, qui
   * appartient au partage entrant.
   */
  segment: string;

  /**
   * Le corps du `<title>`. La coquille lui ajoute « — Geotager ».
   *
   * Le contrôle de build plafonne le titre RENDU à 60 caractères, suffixe
   * compris : il reste donc 49 caractères ici. Le plafond n'est pas décoratif
   * — au-delà, un moteur coupe la phrase et choisit lui-même où.
   */
  titre: string;

  /**
   * Le titre visible, qui n'est pas forcément le titre de l'onglet.
   *
   * Le `<title>` s'adresse à une page de résultats, où il est en concurrence
   * avec neuf autres lignes ; le `<h1>` s'adresse à quelqu'un qui est déjà
   * arrivé et veut savoir s'il est au bon endroit. Les confondre force à
   * écrire une phrase qui fait mal les deux métiers.
   */
  h1: string;

  /** La méta-description. Plafonnée à 155 caractères par le contrôle de build. */
  description: string;

  /**
   * Une ligne, au plus deux, pour le sommaire et les liens croisés.
   *
   * Elle vit ici et non dans la page parce qu'elle est lue AILLEURS que dans
   * la page : la recopier dans chaque guide qui pointe vers celui-ci serait
   * s'engager à corriger cinq copies le jour où la phrase change.
   */
  resume: string;
}

/** La page qui rassemble les guides. */
export interface SommaireGuides {
  /** Segment d'adresse du sommaire, sous la racine de la langue. */
  segment: string;
  titre: string;
  h1: string;
  description: string;
}

export interface Guides {
  sommaire: SommaireGuides;
  fiches: Record<IdGuide, FicheGuide>;
}
