/**
 * CRC-32 (IEEE), tel que le réclame chaque morceau d'un fichier PNG.
 *
 * La table est construite au premier appel plutôt qu'écrite en dur : elle ne
 * pèse alors rien dans le fichier livré, et le coût de sa construction est sans
 * commune mesure avec ce qui l'entoure — on ne calcule jamais de somme de
 * contrôle sur les données d'image, seulement sur le morceau qu'on réécrit.
 *
 * La somme couvre le TYPE et les DONNÉES du morceau, jamais sa longueur.
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
