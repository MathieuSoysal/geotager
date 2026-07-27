/**
 * Les copies du lieu rangées hors du bloc principal.
 *
 * Un fichier peut porter le lieu deux fois : dans le bloc principal, et dans un
 * paquet de texte descriptif ajouté par un logiciel de retouche. Effacer le
 * premier en laissant le second rend un fichier que l'utilisateur croit propre
 * — le pire résultat possible pour cet outil.
 *
 * Deux décisions gouvernent ce module :
 *
 *   1. On retire les seules propriétés de lieu, pas le paquet entier. Le paquet
 *      porte aussi le titre, la légende, l'auteur, l'historique de retouche :
 *      les supprimer serait une perte que personne n'a demandée.
 *   2. On repasse derrière soi. Si un marqueur subsiste après la purge — forme
 *      imbriquée, encodage inattendu, paquet compressé —, l'opération ÉCHOUE.
 *      C'est ce qui transforme une purge incomplète en échec visible plutôt
 *      qu'en fuite silencieuse.
 *
 * Le remplacement se fait par des espaces : la longueur ne change pas, donc
 * rien ne se déplace, et l'espace est légal partout où ces propriétés vivent.
 */

/**
 * Propriétés qui désignent un lieu.
 *
 * `Iptc4xmpExt:LocationCreated` est là parce que Q-001 l'exige : l'IPTC ne
 * porte pas de coordonnées, mais cette structure-là si, et il serait absurde de
 * retirer les degrés en laissant le nom de la ville.
 */
export const MARQUEURS_DE_LIEU = [
  'exif:GPSLatitude',
  'exif:GPSLongitude',
  'exif:GPSAltitude',
  'exif:GPSAltitudeRef',
  'exif:GPSTimeStamp',
  'exif:GPSDateStamp',
  'exif:GPSVersionID',
  'exif:GPSMapDatum',
  'exif:GPSImgDirection',
  'exif:GPSImgDirectionRef',
  'Iptc4xmpExt:LocationCreated',
  'Iptc4xmpExt:LocationShown',
  'photoshop:City',
  'photoshop:State',
  'photoshop:Country',
];

/** Vrai si ce texte annonce un lieu. */
export function porteUnLieu(texte: string): boolean {
  return MARQUEURS_DE_LIEU.some((m) => texte.includes(m));
}

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Retire les propriétés de lieu d'un paquet de texte, à longueur constante.
 *
 * Rend `null` s'il reste un marqueur après coup : l'appelant doit alors refuser
 * l'opération plutôt que de rendre un fichier à moitié nettoyé.
 */
export function purgerLeLieu(texte: string): string | null {
  let out = texte;
  const blanchir = (motif: RegExp) => {
    out = out.replace(motif, (trouve) => ' '.repeat(trouve.length));
  };

  for (const marqueur of MARQUEURS_DE_LIEU) {
    const m = echapper(marqueur);
    // Forme élément, contenu imbriqué compris.
    blanchir(new RegExp(`<${m}(\\s[^>]*)?>[\\s\\S]*?</${m}>`, 'g'));
    // Forme élément vide.
    blanchir(new RegExp(`<${m}(\\s[^>]*)?/>`, 'g'));
    // Forme attribut, guillemets doubles ou simples.
    blanchir(new RegExp(`${m}\\s*=\\s*"[^"]*"`, 'g'));
    blanchir(new RegExp(`${m}\\s*=\\s*'[^']*'`, 'g'));
  }

  if (out.length !== texte.length) return null; // invariant : longueur constante
  return porteUnLieu(out) ? null : out;
}
