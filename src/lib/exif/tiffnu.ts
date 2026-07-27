/**
 * TIFF container: the file is the block.
 *
 * Structurally this is the simplest case, since there is nothing to locate. It
 * is also the most dangerous, for the same reason. In the other formats
 * everything that is not the location block visibly belongs to somebody else,
 * and the container declares it. Here there is no "rest of the file": the
 * pixels live inside the block, addressed by offsets held in the directories.
 * The range map in `tiff.ts` is the only thing protecting them, which is why it
 * walks every page, every sub-directory, and every strip and tile offset.
 *
 * No `reconstruire`, so no adding. Growing the file would be structurally
 * correct, but a DNG or a camera raw file is a TIFF, and that would add bytes
 * to a file entire toolchains treat as a whole. Telling an ordinary TIFF from a
 * digital negative would take a heuristic we could not make reliable, and a
 * wrong one would destroy an irreplaceable original here.
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
    // 43 is the magic of "big" TIFF, whose offsets are 64-bit. It is not the
    // same format; recognising it in order to fail is better than misreading it.
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

  // Nothing is claimed at file level, because there is no file around the
  // block. All the protection comes from the internal map in `tiff.ts`.
  plagesRevendiquees() {
    return [];
  },

  reecrireSurPlace(_b, _vise, tiff) {
    return new Uint8Array(tiff);
  },
};
