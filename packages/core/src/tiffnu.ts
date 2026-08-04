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
 * Growing the file is structurally safe, since strip offsets are absolute and
 * nothing moves, but a DNG or a camera raw file is a TIFF, and adding bytes to
 * one would damage an irreplaceable original. Adding is therefore only open to
 * files that prove they are ordinary images: `estUneImageOrdinaire` decides
 * that, from an allowlist tested both ways on real negatives and real TIFFs.
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

  /**
   * The block has grown, and the file is the block, so there is nothing to
   * reassemble.
   *
   * `ecrirePositionParAjout` appended the new IFD0 at the end of the block and
   * repointed the header; the strip offsets, being absolute, stay valid without
   * having moved. The two declared ranges are those of that surgery: the head
   * pointer, and everything appended at the end.
   */
  reconstruire(b, vise, tiff): Pose {
    // A null `vise` means no block could be read, so `parseTiff` failed.
    // Writing here would replace the whole file with an empty block.
    if (!vise) throw AJOUT_IMPOSSIBLE();
    return { bytes: new Uint8Array(tiff), changed: [[4, 8], [b.length, tiff.length]] };
  },

  /**
   * Adding is only open on an ordinary image, never on a negative.
   *
   * The interface therefore announces the route before the action: on a DNG the
   * input field is inactive and says why, rather than failing after the click.
   */
  accepteAjout(b) {
    try {
      return estUneImageOrdinaire(parseTiff(b));
    } catch {
      // A block we cannot read has proved nothing at all.
      return false;
    }
  },
};
