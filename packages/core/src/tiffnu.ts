/**
 * Conteneur TIFF — le fichier EST le bloc.
 *
 * Structurellement, c'est le cas le plus simple : il n'y a rien à localiser.
 * C'est aussi le plus dangereux, et pour la même raison. Sur les autres
 * formats, tout ce qui n'est pas le bloc de position appartient visiblement à
 * quelqu'un d'autre, et le conteneur le déclare. Ici, il n'y a pas de « reste
 * du fichier » : les pixels vivent DANS le bloc, désignés par des adresses
 * rangées dans les répertoires. La carte des plages de `tiff.ts` est donc la
 * seule chose qui les protège — d'où son parcours de toutes les pages, de tous
 * les sous-répertoires, et des adresses de bandes et de tuiles.
 *
 * Faire grandir le fichier est structurellement sans risque — les adresses de
 * bandes sont absolues et rien ne bouge — mais un DNG ou un fichier brut
 * d'appareil est un TIFF, et lui ajouter des octets abîmerait un original
 * irremplaçable. L'ajout n'est donc ouvert qu'aux fichiers qui PROUVENT être
 * une image ordinaire : c'est `estUneImageOrdinaire` qui l'établit, sur une
 * liste blanche éprouvée dans les deux sens sur de vrais négatifs et de vrais
 * TIFF. On ne devine toujours pas ; on exige la preuve.
 */

import { ExifError } from './erreurs.ts';
import { readU16 } from './octets.ts';
import { AJOUT_IMPOSSIBLE, type Conteneur, type Pose } from './conteneurs.ts';
import { estUneImageOrdinaire, parseTiff } from './tiff.ts';

export const conteneurTiffNu: Conteneur = {
  format: 'tiff',

  reconnait(b) {
    if (b.length < 8) return false;
    const li = b[0] === 0x49 && b[1] === 0x49;
    const be = b[0] === 0x4d && b[1] === 0x4d;
    if (!li && !be) return false;
    const magie = readU16(b, 2, li ? 'LE' : 'BE');
    if (magie === 42) return true;
    // 43 est la magie du TIFF « large », dont les adresses tiennent sur 64
    // bits. Ce n'est pas le même format ; le reconnaître pour échouer ensuite
    // vaut mieux que de le lire de travers.
    if (magie === 43) {
      throw new ExifError(
        'FORMAT_NON_PRIS_EN_CHARGE',
        "Cette image utilise une variante que nous ne savons pas encore ouvrir. Elle n'a pas été touchée.",
      );
    }
    return false;
  },

  localiser(b) {
    return [{ tiff: b, debut: 0 }];
  },

  // Rien n'est revendiqué au niveau du fichier : il n'y a pas de fichier autour
  // du bloc. Toute la protection vient de la carte interne de `tiff.ts`.
  plagesRevendiquees() {
    return [];
  },

  reecrireSurPlace(_b, _vise, tiff) {
    return new Uint8Array(tiff);
  },

  /**
   * Le bloc a grandi, et le fichier EST le bloc : il n'y a rien à réassembler.
   *
   * `ecrirePositionParAjout` a ajouté le nouvel IFD0 en fin de bloc et repointé
   * l'en-tête ; les adresses de bandes, absolues, restent valides sans avoir
   * bougé. Les deux plages annoncées sont celles de cette chirurgie : le
   * pointeur de tête, et tout ce qui a été ajouté au bout.
   */
  reconstruire(b, vise, tiff): Pose {
    // `vise` nul signifie qu'aucun bloc n'a pu être lu — donc que `parseTiff` a
    // échoué. Écrire ici remplacerait le fichier entier par un bloc vide.
    if (!vise) throw AJOUT_IMPOSSIBLE();
    return { bytes: new Uint8Array(tiff), changed: [[4, 8], [b.length, tiff.length]] };
  },

  /**
   * L'ajout ne s'ouvre que sur une image ordinaire, jamais sur un négatif.
   *
   * L'interface annonce donc la voie AVANT l'action : sur un DNG, le champ de
   * saisie est inactif et la phrase le dit, plutôt que d'échouer après le clic.
   */
  accepteAjout(b) {
    try {
      return estUneImageOrdinaire(parseTiff(b));
    } catch {
      // Un bloc qu'on ne sait pas lire n'a rien prouvé du tout.
      return false;
    }
  },
};
