# CREDITS.md

Toute dépendance de Geotagor doit être sous **MIT, BSD ou Apache-2.0**, avec sa version et sa licence
consignées ici avant d'être installée.

> **État : Gate 1.** Aucune dépendance n'est encore installée — le dépôt ne contient pas de
> `package.json`. Ce fichier liste les **candidats retenus**, chacun vérifié sur sa source primaire
> (`registry.npmjs.org` ou `crates.io/api/v1/crates`) le **27 juillet 2026**. Il devient le registre
> définitif au premier `npm install`, et sera alors aligné sur le `package-lock.json`.

## Amendement demandé à la règle de licence

Deux licences sortent de l'allowlist littérale et sont demandées à l'admission (voir `QUESTIONS.md`,
entrée Q-012) :

- **OFL-1.1** — licence de *fonte*, pas de logiciel. Elle autorise explicitement la redistribution
  embarquée, ce qui est exactement l'usage ici. Sans cet amendement, les polices du §8 sont
  inutilisables et la direction visuelle tombe.
- **ISC** — fonctionnellement équivalente à MIT (même permissions, formulation raccourcie).
  Susceptible d'apparaître en dépendance transitive.

## Dépendances JavaScript — candidates

| Paquet | Version | Licence | Poids gzip | Rôle |
|---|---|---|---|---|
| `astro` | 7.1.3 | MIT | — (build) | Générateur statique, `output: 'static'` |
| `exifr` | 7.1.3 | MIT | 14 766 o (`lite.esm.mjs`) | Lecture EXIF/GPS/XMP — JPEG, HEIC, TIFF |
| `piexif-ts` | 2.1.0 | MIT | 12 374 o | Écriture et suppression du GPS IFD en JPEG |
| `client-zip` | 2.5.0 | MIT | 2 676 o | Export ZIP en mode lot |
| `workbox-window` | 7.4.1 | MIT | 2 380 o | Contrôle du service worker |

Poids relevés par `gzip -9` sur le fichier de distribution réellement téléchargé, pas estimés.

## Dépendance Rust — candidate, sous condition

| Crate | Version | Licence | Rôle |
|---|---|---|---|
| `little_exif` | 0.6.23 | MIT OR Apache-2.0 | Écriture EXIF en ISOBMFF (HEIC/AVIF) et TIFF, compilé en WASM |

Retenue **uniquement si** le spike valide le budget de 400 Ko compressé (voir `PLAN-GATE1.md` §4).
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
| `geo.api.gouv.fr` — communes | Licence Ouverte (à confirmer dans les mentions légales du service) | Index de lieux : nom, INSEE, code postal, mairie, population, surface |
| data.gouv.fr — contours administratifs 2025 | ODbL | Contours départementaux et communaux |
| `raw.pixls.us` | CC0 | Corpus de test, fichiers garantis non retouchés |

L'ODbL des contours impose une attribution et une clause de partage à l'identique sur les données
dérivées : à honorer dans le pied de page et dans `public/geo/LICENSE`.

## Écartés, avec la raison

| Candidat | Raison |
|---|---|
| `maplibre-gl` 6.0.0 | BSD-3-Clause, mais **273 Ko gzip** = 1,8× le budget JS total |
| `leaflet` 1.9.4 | BSD-2-Clause, mais 42 353 o = 42 % du budget, pour un widget dont on n'utilise presque rien (Q-008) |
| `exifreader` 4.41.3 | **MPL-2.0** — hors allowlist |
| `rexiv2` (Rust) | **GPL-3.0-or-later**, et lie `gexiv2`/Exiv2 en C : inutilisable en `wasm32-unknown-unknown` |
| `libheif-js` / `heic2any` | LGPL, et 337 Ko gzip |
| `@vite-pwa/astro` 1.2.0 | MIT, mais sa peerDep plafonne à `astro ^5` alors qu'Astro est en 7.1.3, sans version plus récente publiée. Service worker écrit à la main |
| `fst` (Rust) | Écarté sur le fond, pas sur la licence : un automate de préfixes ne fait pas de recherche par sous-chaîne (`PLAN-GATE1.md` §3) |

## Hébergement

Cloudflare Pages, en intégration Git. Aucun code Cloudflare n'entre dans le produit : le rôle de
l'hébergeur est de servir des fichiers statiques, rien de plus. Trois fonctionnalités qui injectent
du script ou modifient le HTML sont **actives par défaut** et doivent être coupées — voir
`QUESTIONS.md`, entrée Q-020. Le contrôle post-déploiement qui le vérifie fait partie des gates.

## Inspiration

La valeur `#FF3385` de la couleur principale est relevée sur la `theme-color` de
[squoosh.app](https://squoosh.app), projet Apache-2.0 de l'équipe Chrome. Aucun code n'en est repris.
