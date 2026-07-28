# CREDITS.md

Toute dépendance de Geotager doit être sous **MIT, BSD ou Apache-2.0**, avec sa version et sa licence
consignées ici avant d'être installée.

> **État : V0 installée.** Les dépendances ci-dessous sont réellement présentes dans
> `package-lock.json`. Les lignes marquées « candidat » restent des choix du plan, non encore
> installés. Vérifications faites sur `registry.npmjs.org` et `crates.io` le **27 juillet 2026**.

## Amendement demandé à la règle de licence

Deux licences sortent de l'allowlist littérale et sont demandées à l'admission :

- **OFL-1.1** — licence de *fonte*, pas de logiciel. Elle autorise explicitement la redistribution
  embarquée, ce qui est exactement l'usage ici. Sans cet amendement, les polices du §8 sont
  inutilisables et la direction visuelle tombe.
- **ISC** — fonctionnellement équivalente à MIT (même permissions, formulation raccourcie).
  Susceptible d'apparaître en dépendance transitive.

## Dépendances JavaScript — installées

| Paquet | Version | Licence | Rôle |
|---|---|---|---|
| `astro` | ^7.1.4 | MIT | Générateur statique, `output: 'static'` |
| `exifr` | ^7.1.3 | MIT | Lecture des métadonnées, et **relecture croisée** après écriture |
| `client-zip` | ^2.5.0 | MIT | Export ZIP en mode lot |

**Poids réel mesuré sur la build : 52 708 o gzip, soit 34,3 % du budget de 150 Ko.** Dont 1 640 o
pour la carte, dans un module à part que rien ne télécharge tant que personne ne l'ouvre.

### Développement seulement

| Paquet | Version | Licence | Rôle |
|---|---|---|---|
| `playwright` | ^1.62.0 | Apache-2.0 | Parcours complet en navigateur réel |

`exiftool` (Perl, Artistic/GPL) est utilisé comme **oracle de test externe**. Il n'entre pas dans le
produit : aucune ligne de son code n'est distribuée, et il n'est requis que pour lancer les tests.
Il sert aussi à **inscrire le lieu de départ** dans les fichiers de test des formats où aucun corpus
public n'en fournit.

### Corpus de test — licences

Ces fichiers ne sont **pas committés** et ne sont téléchargés que pour les tests. Trois régimes,
aucun inventé :

| Source | Licence | Réserve |
|---|---|---|
| `ianare/exif-samples` | CC BY-SA 4.0 | Déclaration du `README.rst`, pas de fichier de licence. Dépôt **archivé** depuis avril 2025. |
| `drewnoakes/metadata-extractor-images` | **indéterminée** | Aucun fichier de licence ; autorisation explicite du dépôt : « You are free to use these media files however you wish. » **Hors de l'allowlist**, |
| `AOMediaCodec/libavif` | BSD-2-Clause | — |
| `gstatic.com/webp/gallery` | CC BY-SA 3.0 | Galerie de démonstration Google. |
| `raw.pixls.us` | CC0 | Négatifs numériques réels (DNG, NEF, CR2, et un Kodak DCS au nom de fichier « .TIF »), qui éprouvent le refus d'ajout sur un TIFF. Fichiers garantis non retouchés. |

### Écrit à la main plutôt qu'emprunté

Le moteur EXIF pour JPEG (`src/lib/exif/jpeg.ts`) n'utilise aucune bibliothèque. `piexifjs` et son
fork TypeScript, envisagés au Gate 1, réécrivent le bloc TIFF en entier : cela déplace les octets et
casse les MakerNote à offsets absolus. L'édition sur place à longueur constante était l'objectif
produit&nbsp;; elle imposait d'écrire le code.

## Dépendance Rust — candidate, sous condition

| Crate | Version | Licence | Rôle |
|---|---|---|---|
| `little_exif` | 0.6.23 | MIT OR Apache-2.0 | Écriture EXIF en ISOBMFF (HEIC/AVIF) et TIFF, compilé en WASM |

Retenue **uniquement si** le spike valide le budget de 400 Ko compressé.
Ses dépendances transitives sont toutes conformes : `brotli` 8.0.4 (BSD-3-Clause AND MIT), `crc`
3.4.0, `log` 0.4.33, `miniz_oxide` 0.9.1 (MIT OR Zlib OR Apache-2.0), `paste` 1.0.15, `quick-xml`
0.37.5 (MIT). Aucune dépendance C, aucun thread, `#![forbid(unsafe_code)]`.

## Polices — candidates

| Paquet | Version | Licence | Poids woff2 | Rôle |
|---|---|---|---|---|
| `@fontsource-variable/bricolage-grotesque` | 5.3.0 | OFL-1.1 | 41 344 o | Titrage (axe `wght`) |
| `@fontsource/dm-mono` | 5.3.0 | OFL-1.1 | 14 820 o | Coordonnées et données |

Les woff2 embarquent déjà Brotli : les recompresser ne gagne rien (−0,5 %).
`@fontsource-variable/dm-mono` **n'existe pas** — DM Mono n'a pas de version variable.

## Données

| Source | Licence | Usage |
|---|---|---|
| `tile.openstreetmap.org` — tuiles rendues | Données **ODbL**, rendu © les contributeurs OpenStreetMap | Fond de la carte de choix du lieu. **Chargé depuis un serveur tiers, et le seul du projet.** |
| `geo.api.gouv.fr` — communes | Licence Ouverte (à confirmer dans les mentions légales du service) | Index de lieux : nom, INSEE, code postal, mairie, population, surface |
| data.gouv.fr — contours administratifs 2025 | ODbL | Contours départementaux et communaux |
| `raw.pixls.us` | CC0 | Corpus de test, fichiers garantis non retouchés |

### Les tuiles OpenStreetMap, et ce qu'elles coûtent

Ce n'est pas un paquet npm : aucune ligne de code tierce n'entre dans la build. Ce sont des **images
chargées à la demande** depuis `tile.openstreetmap.org`, et elles sont à ce titre la seule exception
au « zéro requête tierce » — inerte tant que l'utilisateur n'ouvre pas la carte.

Trois obligations, toutes tenues dans le produit :

- **Attribution visible** dès que la carte l'est : « © OpenStreetMap contributors », liée à
  `openstreetmap.org/copyright`. C'est la condition de l'ODbL comme de la politique d'usage.
- **Volume faible.** La politique de la fondation tolère les usages légers et décourage les
  applications distribuées qui tapent sur ses serveurs. Une ouverture de carte coûte une dizaine de
  tuiles ; le zoom d'ouverture est volontairement bas.
- **Réversibilité.** Le gabarit d'URL est une constante unique (`TUILES`, dans
  `src/lib/ui/carte.ts`). Changer de fournisseur pour un service dont les conditions couvrent
  explicitement l'usage web est une modification d'une ligne, et c'est à faire avant que le trafic
  n'arrive.

Écartés pour ce rôle : les fournisseurs à clé d'API (la clé serait publique dans le bundle) et
`maps.wikimedia.org` (réservé aux projets Wikimedia).

L'ODbL des contours impose une attribution et une clause de partage à l'identique sur les données
dérivées : à honorer dans le pied de page et dans `public/geo/LICENSE`.

## Écartés, avec la raison

| Candidat | Raison |
|---|---|
| `maplibre-gl` 6.0.0 | BSD-3-Clause, mais **273 Ko gzip** = 1,8× le budget JS total |
| `leaflet` 1.9.4 | BSD-2-Clause, mais 42 353 o = 42 % du budget, pour un widget dont on n'utilise presque rien |
| `exifreader` 4.41.3 | **MPL-2.0** — hors allowlist |
| `rexiv2` (Rust) | **GPL-3.0-or-later**, et lie `gexiv2`/Exiv2 en C : inutilisable en `wasm32-unknown-unknown` |
| `libheif-js` / `heic2any` | LGPL, et 337 Ko gzip |
| `@vite-pwa/astro` 1.2.0 | MIT, mais sa peerDep plafonne à `astro ^5` alors qu'Astro est en 7.1.3, sans version plus récente publiée. Service worker écrit à la main |
| `fst` (Rust) | Écarté sur le fond, pas sur la licence : un automate de préfixes ne fait pas de recherche par sous-chaîne |

## Hébergement

Cloudflare Pages, en intégration Git. Aucun code Cloudflare n'entre dans le produit : le rôle de
l'hébergeur est de servir des fichiers statiques, rien de plus. Trois fonctionnalités qui injectent
du script ou modifient le HTML sont **actives par défaut** et doivent être coupées. Le contrôle post-déploiement qui le vérifie fait partie des gates.

## Inspiration

La valeur `#FF3385` de la couleur principale est relevée sur la `theme-color` de
[squoosh.app](https://squoosh.app), projet Apache-2.0 de l'équipe Chrome. Aucun code n'en est repris.
