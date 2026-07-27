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
 * Pas de `reconstruire`, donc pas d'ajout. Faire grandir le fichier serait
 * structurellement correct, mais un DNG ou un fichier brut d'appareil est un
 * TIFF : on ajouterait des octets à un fichier que des chaînes de développement
 * traitent comme un tout. Distinguer un TIFF ordinaire d'un négatif numérique
 * demanderait une heuristique qu'on ne saurait pas rendre fiable, et une
 * heuristique fausse détruirait ici un original irremplaçable. On ne devine
 * pas : on n'ajoute pas.
 */

import { ExifError } from './erreurs.ts';
import { readU16 } from './octets.ts';
import type { Conteneur } from './conteneurs.ts';

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
};
