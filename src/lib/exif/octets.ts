/**
 * Lecture et écriture d'entiers, boutisme toujours explicite.
 *
 * Aucun `DataView` : le boutisme est un paramètre, jamais une valeur par
 * défaut. C'est délibéré. L'inversion de boutisme est le bug classique de ce
 * domaine — un iPhone écrit son bloc TIFF en gros-boutiste — et un paramètre
 * qu'on est obligé de nommer à chaque appel ne peut pas être oublié.
 */

export type Endian = 'LE' | 'BE';

export function readU16(b: Uint8Array, off: number, e: Endian): number {
  return e === 'LE' ? b[off] | (b[off + 1] << 8) : (b[off] << 8) | b[off + 1];
}

export function readU32(b: Uint8Array, off: number, e: Endian): number {
  return e === 'LE'
    ? (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0
    : ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}

export function writeU16(b: Uint8Array, off: number, v: number, e: Endian): void {
  if (e === 'LE') {
    b[off] = v & 0xff;
    b[off + 1] = (v >>> 8) & 0xff;
  } else {
    b[off] = (v >>> 8) & 0xff;
    b[off + 1] = v & 0xff;
  }
}

export function writeU32(b: Uint8Array, off: number, v: number, e: Endian): void {
  if (e === 'LE') {
    b[off] = v & 0xff;
    b[off + 1] = (v >>> 8) & 0xff;
    b[off + 2] = (v >>> 16) & 0xff;
    b[off + 3] = (v >>> 24) & 0xff;
  } else {
    b[off] = (v >>> 24) & 0xff;
    b[off + 1] = (v >>> 16) & 0xff;
    b[off + 2] = (v >>> 8) & 0xff;
    b[off + 3] = v & 0xff;
  }
}
