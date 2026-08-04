/**
 * CRC-32 (IEEE), as required by every PNG chunk.
 *
 * The table is built on first use rather than hard-coded: it costs nothing in
 * the shipped bundle, and building it is negligible next to the work around it,
 * since checksums are only ever computed over a chunk we rewrite, never over
 * image data. The checksum covers the chunk type and data, not its length.
 */

let table: Uint32Array | null = null;

function construire(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}

export function crc32(b: Uint8Array, debut = 0, fin = b.length): number {
  if (!table) table = construire();
  let c = 0xffffffff;
  for (let i = debut; i < fin; i++) c = table[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
