/**
 * Integer reads and writes, endianness always explicit.
 *
 * No `DataView`: endianness is a required parameter, never a default. Getting
 * byte order wrong is the classic bug in this domain (an iPhone writes its TIFF
 * block big-endian), and a parameter the caller must name cannot be forgotten.
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

/**
 * Big-endian integer of 0 to 8 bytes, as an ISOBMFF container writes them: the
 * item location table declares the width of its own fields.
 *
 * Multiplication rather than shifting, because beyond 32 bits JavaScript's
 * shift operators silently fall back to signed integers.
 */
export function lireEntierBE(b: Uint8Array, off: number, taille: number): number {
  let v = 0;
  for (let i = 0; i < taille; i++) v = v * 256 + b[off + i];
  return v;
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
