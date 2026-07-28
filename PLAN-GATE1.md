# Geotagor — Plan Gate 1

## Contexte

Le dépôt `MathieuSoysal/geotager` est vide : un seul fichier, `maquette-geotagor-v7.html`, maquette
visuelle non fonctionnelle. Aucun code à réutiliser, aucune convention à respecter — tout est à poser.

Objectif double, et les deux moitiés se contraignent : un outil réellement utile (voir, modifier,
supprimer la position GPS d'une photo, entièrement dans le navigateur) **et** un actif SEO français.
La contrainte « zéro serveur, zéro requête tierce » n'est pas une préférence d'architecture, c'est
l'argument produit : **les 20 concurrents audités échouent tous sur ce point** (AdSense, GTM,
Microsoft Clarity, Google Fonts, cdnjs, unpkg, tuiles OSM, Nominatim). C'est le seul axe où Geotagor
peut être factuellement le meilleur plutôt qu'« encore un outil ».

**Méthode.** 16 agents ont travaillé : 7 de recherche (faits vérifiés sur sources primaires),
4 de conception, 5 de contradiction. Tout chiffre ci-dessous est marqué **MESURÉ** (relevé),
**DOCUMENTÉ** (la source l'affirme) ou **ESTIMÉ** (calculé). Rapports complets en annexe : [`docs/gate1/`](docs/gate1/).

Une vérification complémentaire (3 agents) a couvert l'hébergement ; sa passe adverse a été bloquée
par un classifieur, ce qui est signalé au §7. Elle a d'abord porté sur Cloudflare **Pages** avant que
l'intégration réelle se révèle être **Workers** — le §7 a été recorrigé sur la doc Workers et signale
ce qui reste à revérifier.

**Ce plan corrige le cahier des charges sur quatorze points.** Chacun est signalé par ⚠️ et ouvre une
entrée `QUESTIONS.md`. Aucun n'a été tranché en silence.

---

## 0. Les cinq constats qui changent le projet

### C1 — Le spike n'est pas « Rust ou JS », c'est « little_exif sait-il écrire dans un HEIC ? »

`little_exif` **sait écrire le GPS IFD** : les 32 tags GPS sont déclarés `writable = true` et groupe
`GPS` dans `src/exif_tag/mod.rs` l. 500-536, avec le pointeur `GPSInfo` (0x8825) typé
`IFD_OFFSET(ExifTagGroup::GPS)` l. 717. La question bloquante du §13.0 est **résolue positivement,
sur pièces**. Licence `MIT OR Apache-2.0`, v0.6.23 du 13/01/2026, aucune dépendance C, aucun thread,
`#![forbid(unsafe_code)]` (MESURÉ).

Mais le Rust n'apporte rien sur JPEG : `piexif-ts` fait le travail en **12 374 o gzip** (MESURÉ)
contre plusieurs centaines de Ko de WASM. **Le seul gain net du Rust est l'écriture ISOBMFF
(HEIC/AVIF/TIFF)** — et c'est le format par défaut de tout iPhone depuis iOS 11.

**Le risque n'est pas la fonctionnalité, c'est le poids.** `little_exif` déclare `"features": {}`
(MESURÉ) : impossible d'exclure `brotli` (751 794 o de source, appelé uniquement par `src/jxl.rs`)
ni `quick-xml` (190 481 o, appelé uniquement par `src/xmp.rs`, dont l'unique fonction est
`pub(crate)`). **942 275 o de source non désactivable et non appelable depuis notre chemin, soit
11,1× la taille du crate cible.** Une taille de tarball n'est pas une taille de wasm, mais l'indice
ne pointe que dans une direction.

⚠️ **Correction de l'ordre du spike.** Le §13.0 fait passer la fonctionnalité avant le budget.
C'est économiquement faux : mesurer le poids coûte **35 minutes** et ne dépend d'aucun corpus, alors
que la matrice fonctionnelle exige d'installer ExifTool, de réunir un corpus et d'écrire 29 fichiers
d'attendus. **On mesure le poids d'abord.**

### C2 — Le vrai noyau n'est pas un écrivain EXIF, c'est P1 : l'édition sur place

L'idée la plus solide du dossier, et elle survit à cinq contradicteurs : **pour supprimer ou corriger
une position, on n'a pas besoin de réécrire le fichier.** On modifie les octets de la valeur GPS
là où ils sont, à longueur constante. Conséquences :

- MakerNote, MPF, APP13, vignette, profil ICC, ordre des octets : **préservés par construction**,
  pas par vigilance.
- Un RAW de 120 Mo coûte le même pic mémoire qu'un JPEG de 2 Mo.
- Le chemin fonctionne sur **tous** les conteneurs, indépendamment de tout écrivain de format.
- Il rend le cas d'usage n°1 (supprimer) **indépendant du résultat du spike**.

⚠️ **Mais la description initiale de P1 comporte une erreur bloquante.** « Décrémenter `count` et
laisser 12 octets morts » casse le chaînage IFD : TIFF 6.0 place le pointeur next-IFD à l'adresse
`A + 2 + count×12` (texte officiel extrait du PDF ITU dans cette session). Décrémenter `count`
déplace ce pointeur 12 octets plus tôt, au milieu de l'entrée précédente — offset de vignette
aléatoire. La suppression correcte est : décaler les entrées de tag supérieur, réécrire le pointeur
next-IFD à sa nouvelle adresse avec sa valeur d'origine, zéroïser les 12 derniers octets.
De même, « la zone de valeurs » n'existe pas : TIFF 6.0 dit que les valeurs *« need not be in any
particular order in the file »*. Toute zéroïsation exige une **carte des plages d'octets** prouvée
disjointe, sinon on détruit un MakerNote en croyant nettoyer.

### C3 — La carte ne peut pas être un viseur, et le prétendre serait mentir

Calcul (ESTIMÉ, opérations montrées ; `r(z) = 107 753 / 2^z` m/px à 46,5° N) :

| Contrainte | Exigence |
|---|---|
| Voir l'erreur à corriger (centroïde à 1 522 m en moyenne, dans un demi-écran de 180 px) | `r ≥ 8,46` m/px |
| Pouvoir viser (10 m par pixel de prise, très lâche) | `r ≤ 10` m/px |
| Fenêtre utilisable | **z ∈ [13,40 ; 13,64]** |

Leaflet est en `zoomSnap: 1`. **z13 = 13,15 m/px, z14 = 6,58 m/px : aucun zoom entier ne satisfait
les deux conditions.** Et le doigt occulte 290 m de diamètre à z14. Par ailleurs, sans tuiles,
l'écran est **vide 77 % du temps au zoom par défaut, 94 % au zoom maximal** (probabilité qu'une
frontière départementale soit visible). Passer aux contours communaux remplit l'écran sans
l'informer : une limite communale est une abstraction juridique, en moyenne à 663 m du jardin.

⚠️ **Décision.** La carte **situe et vérifie**, elle ne vise pas. `maxZoom = 11`. Le mot
« cliquez » disparaît du parcours. La saisie précise passe par la recherche de commune et par le
collage de coordonnées (« ouvrez Google Maps, clic droit, collez ici »). Et l'imprécision est
**inscrite dans le fichier** via `GPSHPositioningError = round(√(surface/π))` — la seule façon
honnête de livrer une position de qualité communale.

Corollaire mesuré, gratuit : `geo.api.gouv.fr` expose `geometry=mairie` en plus du centroïde.
Sur 60 communes tirées au sort, l'écart médian centre↔mairie est de **792 m**, p90 1 744 m,
max 3 936 m (MESURÉ). La mairie est dans le bourg, le centroïde dans un bois. **On utilise la mairie.**

### C4 — Le décor de la maquette est un problème de performance bloquant

Les keyframes animent `border-radius`. **Ce n'est pas une propriété compositable** : son animation
invalide le paint à chaque image, sur le thread principal, sur toutes les pages, en boucle infinie —
sur 4 éléments (3 blobs + la bulle), sous un `filter: blur(70px)` plein viewport qui ne peut donc
jamais être mis en cache, plus jusqu'à 6 `backdrop-filter` recalculés par-dessus un fond mobile.
Le budget INP de 200 ms est attaqué par le fond d'écran, avant que notre code s'exécute.

⚠️ **Correctif, sans perte d'identité visuelle** : à 70 px de flou il ne reste aucun détail
au-dessus de ~35 px — la forme organique est **invisible**. Trois `radial-gradient` statiques sur
`body` sont mathématiquement équivalents, pour une passe de shader et zéro invalidation. Et les
`backdrop-filter: blur(26px)` deviennent des couleurs solides pré-calculées, ce qui résout du même
coup le contraste non déterministe. Si le mouvement est jugé indispensable : n'animer que `transform`.

En V1.2 le mouvement a été jugé indispensable, et la voie retenue est plus étroite que « n'animer que
`transform` » : **rien n'est animé en CSS du tout**. Une boucle `requestAnimationFrame` recalcule la
géométrie d'un SVG borné et composé à part, sans flou, sans `mix-blend-mode` et sans `backdrop-filter`.
Conditions, coûts mesurés et plafond de contraste : **Q-040**.

### C5 — Ce n'est pas un site de 4 pages, et il n'y a aucune donnée de marché

**Charge estimée : 24 à 41 semaines-homme** (6 à 10 mois à plein temps), dérivée des volumes de code
du dossier à la cadence de 15-25 lignes/jour sur du parsing binaire à spécification. Le corpus seul
(29 fichiers + un attendu rédigé avant implémentation pour chacun) vaut 1 à 2 semaines avant la
première ligne.

Et **Ahrefs est indisponible** : 7 endpoints, 7 × `Insufficient plan` (MESURÉ). Google Trends 429,
DuckDuckGo 202 anti-bot. **Aucun volume de recherche n'a pu être mesuré, aucun SERP google.fr
observé.** Le plan initial engage ~11 000 mots de rédaction sur des mots-clés dont personne ne sait
s'ils font 200 ou 20 000 recherches par mois. Ce qui a pu être mesuré, c'est Google Suggest (FR/FR,
23 requêtes) : **le mot que tapent les Français est « localisation », pas « géolocalisation »**, et
`iphone` est le modificateur d'appareil dominant.

⚠️ **Décision : phasage en V0 / V1 / V2**, détaillé au §8.

---

## 1. Pile technique — arrêtée

| Poste | Décision | Justification chiffrée |
|---|---|---|
| Build | **Astro 7.1.3**, `output: 'static'` | MIT. 3-5 j économisés vs Vite nu (sitemap, collections, images) |
| Interactivité | ⚠️ **`<script type="module">` + custom elements**, PAS `client:idle` | **−2 093 o gzip** de runtime Astro (MESURÉ), et aucun framework UI |
| Lecture EXIF | **exifr 7.1.3**, build `lite.esm.mjs` | MIT, **14 766 o gzip** (MESURÉ). JPEG + HEIC + TIFF + XMP |
| Écriture JPEG | **piexif-ts 2.1.0** (fork TS de piexifjs) | MIT, **12 374 o gzip** (MESURÉ) |
| Écriture ISOBMFF | **little_exif 0.6.23** en WASM, **si et seulement si** le spike passe | MIT OR Apache-2.0 |
| Carte | ⚠️ **SVG maison**, pas Leaflet | Leaflet = 42 353 o gzip, **42 % du budget JS**, pour un widget dont on désactive le clavier natif et réécrit le déplacement du repère. La carte étant démotée (C3), 350-450 lignes ≈ 3 500 o suffisent |
| ZIP | **client-zip 2.5.0** | MIT, **2 676 o gzip** (MESURÉ) |
| PWA | ⚠️ **Service worker écrit à la main** | `@vite-pwa/astro@1.2.0` plafonne sa peerDep à `astro ^5`, Astro est en 7.1.3, aucune version plus récente (MESURÉ) |
| Polices | ⚠️ **2 familles**, pas 3 : Bricolage Grotesque Variable (41 344 o) + DM Mono 400 (14 820 o) | **56 164 o** woff2, incompressibles. Outfit supprimé : −31,5 Kio |

**Écartés, avec la raison :** MapLibre GL 6.0.0 (**273 Ko gzip** = 1,8× le budget total, MESURÉ) ·
`exifreader` (MPL-2.0, hors allowlist) · `fst`/Rust pour l'index (voir §3) · PMTiles (v1) ·
`france-geojson` (millésime 2018, incompatible avec un index au COG 2026).

⚠️ **Deux corrections d'inventaire.** `@fontsource-variable/dm-mono` **n'existe pas** (registre :
`{"error":"Not found"}`) — utiliser `@fontsource/dm-mono@5.3.0`, statique. Et les polices sont en
**OFL-1.1**, hors de l'allowlist littérale MIT/BSD/Apache : à amender explicitement ou renoncer.

### Budget JS — recompté honnêtement

Le compte initial (100 478 o) **omettait 17 924 o** : le moteur P1 lui-même (~8 000 o), le balayage
résiduel, le pipeline de vérification, la détection de format, et **la glue `wasm-bindgen`, qui est
du JavaScript et doit être comptée ici, pas dans les 400 Ko de WASM**.

| | avec Leaflet | **sans Leaflet (retenu)** |
|---|---|---|
| Central | 118 402 o (77 %) | **75 442 o (49 %)** |
| Pessimiste | 139 347 o (91 %) | **97 574 o (64 %)** |
| Pessimiste + dépassement ×1,5 du volume de code | 168 615 o (**dépassement**) | **126 842 o (83 %)** |

⚠️ **Le budget de 150 Ko gouverne 26 % des octets réellement transférés.** Parcours de référence
complet (dépôt + recherche + export) : **≈ 542 Ko sans WASM, ≈ 942 Ko avec**. On ajoute donc **deux
budgets contraignants** à côté : (a) *octets du parcours de référence ≤ 400 Ko*, (b) *travail thread
principal sur le chemin dépôt → prêt ≤ 500 ms sous ralentissement CPU ×4*. Ce sont les grandeurs
auxquelles LCP et INP répondent.

---

## 2. Les six contrats — à figer, puis plus discutés

⚠️ **Ils se gèlent à la fin du spike, pas au jalon 0.** Le type `Chemin` ne prend son sens qu'après
S1 ; geler avant, c'est garantir soit que le gel casse, soit que B/C/D construisent contre une
fiction. **Le lot A précède les autres de 2 à 3 semaines** — la parallélisation annoncée au §12 du
cahier des charges n'est pas tenable telle quelle.

```ts
// 1 — Position
export type LatLon = { lat: number; lon: number };            // degrés décimaux, WGS84

// 2 — Chemin d'écriture retenu (§4 du cahier des charges)
export type Chemin =
  | 'P1'          // édition sur place, longueur constante — pixels et voisins intacts
  | 'P2'          // réécriture du conteneur, sans réencoder les pixels
  | 'P3'          // fichier compagnon .xmp
  | 'P4';         // conversion en JPEG, sur confirmation explicite

// 3 — Résultat de lecture
export type PhotoRead = {
  file: File;
  format: 'jpeg' | 'png' | 'tiff' | 'webp' | 'heic' | 'avif' | 'jxl' | 'raw' | 'video' | 'inconnu';
  chemins: { lire: boolean; ecrire: Chemin | null; supprimer: Chemin | null };
  cheminRaison: string;           // phrase affichable, sans jargon de conteneur
  position: LatLon | null;
  precisionMetres: number | null; // GPSHPositioningError lu, ou null
  altitude: number | null;
  takenAt: string | null;         // ISO 8601
  camera: { make: string; model: string } | null;
  espaces: { exif: boolean; xmp: boolean; iptcXmp: boolean };  // où la position a été trouvée
  drapeaux: {
    bigEndian: boolean; mpf: boolean; arriereFichier: boolean;  // Live Photo / photo animée
    app12: boolean; app13: boolean; apercuIntegre: boolean; tronque: boolean;
  };
  rawTags: Record<string, unknown>;
};

// 4 — Demande d'écriture
export type WriteRequest = {
  file: File;
  operation: 'ecrire' | 'effacerPosition' | 'effacerTout';
  position?: LatLon;
  precisionMetres?: number;       // écrit en GPSHPositioningError
  confirmations: { conversionJpeg?: boolean; traiterArriereFichier?: boolean };
};

// 5 — Résultat d'écriture, toujours vérifié (§4)
export type WriteResult =
  | { ok: true;  blob: Blob; nom: string; chemin: Chemin;
      verification: { relu: LatLon | null; ecartMetres: number;
                      plagesModifiees: Array<[number, number]>; residus: string[] } }
  | { ok: false; raison: FailureReason; message: string; originalIntact: true };

export type FailureReason =
  | 'FORMAT_INCONNU' | 'FICHIER_TRONQUE' | 'PLAGES_CHEVAUCHANTES' | 'TROP_VOLUMINEUX'
  | 'VERIFICATION_ECHOUEE' | 'RELECTURE_CROISEE_DIVERGENTE' | 'MOTEUR_INDISPONIBLE' | 'ANNULE';

// 6 — Lieu
export type Place = {
  nom: string; norm: string; insee: string; departement: string;
  cp: string[]; pos: LatLon; surfaceHa: number; population: number;
};
```

---

## 3. Index de lieux — mesuré, pas estimé

**Source unique : `geo.api.gouv.fr/communes`**, snapshot committé avec sa date. 35 014 entrées,
aucune jointure. Le jeu La Poste est écarté comme source de noms (latin-1, capitales sans accents).

**Cinq encodages ont été implémentés et mesurés.** Le retenu, « G » : noms front-codés,
coordonnées en delta-zigzag-varint à 1e-4, INSEE en delta-varint base36, population en `u8`
logarithmique, CP en delta au département.

| | A′ tableaux typés | B front coding | D TSV | **G retenu** |
|---|---|---|---|---|
| Brut | 1 051 695 | 683 000 | 1 550 992 | **657 691** |
| **Brotli q11 (MESURÉ)** | 499 708 | 406 459 | 524 598 | **346 121** |

Deux résultats négatifs mesurés, qui valent d'être publiés : les **tableaux typés sont 9,4 % pires
qu'un TSV après Brotli** (LZ77 exploite mieux le décimal que l'entier quasi aléatoire), et
l'encodage par dictionnaire de tokens (`Saint` → 1 octet) donne **−0,1 %, soit aucun gain**.

**`fst`/Rust : NO-GO, trois fois.** (1) Un fst est un automate de **préfixes** — il ne fait pas de
sous-chaîne, exigée par le cahier des charges ; l'indexation de tous les suffixes multiplie le corpus
par 6,4. (2) Il ne remplacerait que la colonne des noms, 43 % du total : atteindre les 30 % de gain
exigés supposerait de compresser les toponymes 3,3× mieux. (3) Le problème n'existe pas : le scan
`indexOf` complet sur les 35 014 entrées coûte **3,97 ms** (MESURÉ), soit 2 % du budget INP.

### ⚠️ Le shard par lettre initiale est abandonné

Trois mesures indépendantes le condamnent :

| Requête | Résultats | **Shards à charger** |
|---|---|---|
| `ille` | 2 853 | **26 / 26** |
| `remy` | 59 | **11 / 26** (81 % de l'index, pour 59 résultats) |
| `sarlat` | 1 | 1 / 26 |

Fan-out moyen sur 2 710 sous-chaînes tirées au sort : **10,75 shards sur 26**. Un shard par préfixe
et une requête par sous-chaîne sont deux partitions orthogonales du même ensemble. Et le seuil de
40 Ko est de toute façon inatteignable ainsi : le shard `s` pèse **88 222 o brotli** (×2,15), et la
découpe récursive jusqu'à convergence produit **132 fichiers dont 59 sous 1 Ko**, sans résoudre le
fan-out. L'index de trigrammes a été testé : il sélectionne 13,68 shards sur 16 en moyenne.

**Retenu : découpe par colonne × 6 plages de rang INSEE équilibrées = 30 fichiers.**

| Colonne | Tier | Total Brotli | Plus gros |
|---|---|---|---|
| `noms`, `pop`, `insee` | **T1** — au focus du champ | 189 992 o | 27 250 o |
| `coord`, `cp` | T2 — à la première sélection | 167 751 o | 20 733 o |
| **TOTAL** | | **357 743 o (349,4 Ko)** | **26,6 Ko = 65 % du plafond** |

### ⚠️ Trois pièges d'acheminement, tous mesurés, tous corrigés ici

1. **`no-transform` annule la compression.** Doc Cloudflare, verbatim : *« This directive prevents
   Cloudflare from altering compression on responses »*. Coût mesuré : **338 010 → 664 351 o**, soit
   ×1,97 — un écart supérieur au budget JS total. Et les règles `_headers` **se concatènent** :
   `/*` + `/data/*` produirait un `Cache-Control` à deux `max-age` contradictoires.
2. **`application/octet-stream` n'est pas dans la liste des 47 types que Cloudflare compresse.**
   Un `.bin` ne serait **pas compressé du tout**. Forcer `Content-Type: application/json` via
   `_headers`.
3. **L'algorithme dépend du plan de la zone** (Free → Zstandard, Pro/Business → Brotli,
   Enterprise → Gzip, DOCUMENTÉ). Et la qualité dynamique coûte +18,2 % (q5) à +26,3 % (q4) sur ce
   corpus (MESURÉ).

**Correctif structurel : on ne dépend pas du CDN.** Pré-compression brotli q11 au build, servie en
`.br` `immutable`, décompressée dans le worker par `DecompressionStream('brotli')` — que MDN
documente désormais, avec repli gzip détecté par `try { new DecompressionStream('brotli') } catch {}`
(+23,8 % pour les navigateurs sans brotli). **Le budget devient vérifiable au build.**

**Recherche.** Normalisation validée 10/10 sur données réelles : minuscules → ligatures `œ/æ` →
NFD + suppression des `Mn` → apostrophes typographiques → `[^a-z0-9]+` → espace → collapse.
« st remy », « saint-rémy » et « SAINT REMY » trouvent tous Saint-Rémy-de-Provence.
Piège mesuré : **1 482 clés normalisées en collision, 3 774 entrées concernées** — `Sainte-Colombe`
existe **12 fois**. Le département est donc obligatoire à l'affichage, ce qui interdit l'index
« nom + coordonnées seules » sur lequel reposait l'estimation initiale de 1 Mo brut.

---

## 4. Noyau de métadonnées — lot A

### Le spike, dans le bon ordre

| Étape | Contenu | Critère d'arrêt |
|---|---|---|
| **S0** | `rustup target add wasm32-unknown-unknown`, `cargo install wasm-pack`, installer ExifTool | outils présents |
| **S1** | `wasm-pack build --release`, `wasm-opt -Oz`, mesurer `brotli(wasm) + brotli(glue)` | **> 400 Ko ⇒ voie JS, on s'arrête ici.** Mesurer aussi avec un fork retirant `mod jxl;` et `mod xmp;` |
| **S2** | Instancier dans un Web Worker, écrire un GPS IFD sur un JPEG, relire à `exiftool` | panic ⇒ voie JS |
| **S3** | **HEIC iPhone + AVIF** : écrire, relire, ouvrir dans une visionneuse | échec ⇒ le Rust ne sert à rien |
| **S4** | PNG, TIFF, WebP lossless ; brancher `get_dimension_info_from_vp8_chunk` pour VP8 → VP8X | facultatif |

**Ce que le spike n'a plus à découvrir** (déjà établi sur le code source) : le GPS IFD est
inscriptible ; l'API mémoire (`new_from_vec` / `write_to_vec`) évite tout accès disque ;
**WebP lossy → VP8X n'est pas implémenté** (`io_error!(Other, "…not yet implemented!")` dans
`src/webp/vec.rs`) mais la fonction manquante `get_dimension_info_from_vp8_chunk` **existe déjà**,
simplement non câblée — PR upstream ou patch de quelques lignes ; **XMP et IPTC sont absents**
(`remove_exif_from_xmp` est `pub(crate)`, non exposé). Surface de panic par fichier : `jpg.rs` **0**,
`tiff/mod.rs` 0, `heif/mod.rs` 0, `png/mod.rs` 5, `webp/vec.rs` 3 — le chemin JPEG est le plus sûr.

**Architecture retenue quel que soit le résultat : hybride, pas exclusive.** JS toujours chargé
(~27 Ko gzip, JPEG + PNG + lecture) ; WASM chargé en lazy **uniquement** à l'ouverture d'un
HEIC/AVIF/TIFF.

### ⚠️ L'IPTC ne porte pas de coordonnées

L'exigence « écrire simultanément en EXIF, XMP et IPTC » est techniquement infondée pour l'IPTC :
**l'IIM n'a pas de champ de latitude**. Le seul équivalent est `Iptc4xmpExt:LocationCreated`, qui
vit dans le XMP, et dont ExifTool documente que *« the GPS elements of this structure are in the
"exif" namespace »*. **Retenu pour la v1 : EXIF + XMP seulement** (le moins engageant). En
suppression, on purge **aussi** `Iptc4xmpExt:LocationCreated` s'il est présent — une purge XMP
consciente des espaces de noms, testée sur les quatre sérialisations RDF/XML (attribut, élément,
`parseType="Resource"`, `rdf:Bag`), et non un remplacement d'attributs par des espaces.

### ⚠️ La vérification après écriture doit être croisée, pas réflexive

Une auto-relecture est **structurellement aveugle** à la classe de bug la plus dangereuse : un
encodeur et un décodeur symétriquement faux passent avec un écart de exactement zéro. Le cas est
concret — `Metadata::new()` de `little_exif` force `Endian::Little` ; sur un JPEG iPhone `MM`, notre
lecteur renverrait la valeur demandée au bit près pendant qu'ExifTool afficherait une latitude
aberrante.

**Retenu :** la relecture croisée par `exifr` (déjà au bundle, 0 o supplémentaire) devient
**obligatoire et bloquante**. Plus un vecteur de test à valeur connue, avec les 24 octets de
`GPSLatitude` écrits à la main en `II` et en `MM`, contrôlés par comparaison binaire.

**Tolérance :** `1e-7 °` ≈ 1,11 cm est un **détecteur de bug de l'encodeur**, pas une garantie de
précision — l'entrée n'est connue qu'à 1e-4 ° quand elle vient d'une commune. À ne pas présenter
comme une précision. Note terrain : ExifTool documente que *« Google Photos may ignore this if the
coordinates have more than 5 digits after the decimal »*.

**Et « à l'octet près » devient un invariant vérifié par machine** : l'écrivain retourne la liste
exacte des `(offset, longueur)` écrits, la vérification échoue si **un seul octet hors de cet
ensemble** a changé. Une comparaison de tailles ne prouve rien — un bug qui zéroïse 200 Ko de
MakerNote la laisse passer. Étendu à : profil ICC présent avant ⇒ présent après avec la même
empreinte (APP2 `ICC_PROFILE` / PNG `iCCP` / WebP `ICCP`), `Orientation`, vignette IFD1, et
inventaire complet des tags — écart attendu = le seul delta GPS.

### ⚠️ Trois corrections de périmètre

- **La vidéo sort de la v1 en écriture et en suppression.** Renommer `©xyz` en `free` ne supprime
  pas : restent au minimum `@xyz` (Samsung), `com.apple.quicktime.location.ISO6709`, et surtout
  **`location.name`** — le lieu **en toutes lettres**. Le balayage résiduel cherche des coordonnées,
  pas des toponymes : il rendrait « aucun résidu » sur un fichier qui dit « Avignon » en clair. Pire,
  les pistes GPS temporisées vivent dans `mdat`, que l'architecture saute par optimisation.
  **Lecture conservée**, avec le message : « Nous savons lire le lieu d'une vidéo mais nous ne savons
  pas encore le retirer de façon sûre. »
- **« Aucun cul-de-sac » est faux et doit être reformulé.** La lecture n'en a pas ; la **suppression
  en a un** quand P1 échoue, car un fichier compagnon peut ajouter une information, jamais en
  retirer une. Et un navigateur ne peut pas poser un `.xmp` **à côté** d'un `.CR2` — il le dépose
  dans Téléchargements. Correctif : livrer un **ZIP contenant les deux fichiers** (`client-zip` est
  déjà au budget), et dire que le compagnon ne sert **qu'à ajouter**.
- **P1 récursif sur l'aperçu intégré.** Quasiment tous les RAW contiennent un aperçu JPEG avec son
  propre GPS IFD complet. Le même code P1 le nettoie ; sans cela, le produit **détecte une fuite
  pour laquelle il n'offre aucune action**.

### Le cas nominal, écrit en toutes lettres

Fichier sans aucune métadonnée : créer les IFD depuis zéro, GPS IFD inclus → c'est P2, jamais P1.
Big-endian : les JPEG iPhone sont en `MM`, cause classique de corruption silencieuse → vecteur de
test dédié. MPF (mode portrait) : ne pas casser les images secondaires → P1 obligatoire, P2 interdit.
Live Photo / photo animée Android : vidéo embarquée ou collée après `EOI` → détectée, et l'utilisateur
décide. APP12/APP13 : détectés et signalés, jamais réécrits silencieusement. Tronqué : `Err` typé,
jamais un fichier plus abîmé que l'original. > 100 Mo : lecture par tranches, sortie composée par
`Blob`, pic mémoire = taille du correctif. Lot : file d'attente, progression, annulation, échec
unitaire non bloquant.

⚠️ **Le plafond mémoire ne se prédit pas.** `navigator.deviceMemory` est absent de **Firefox et de
Safari** (MESURÉ, `mdn/browser-compat-data`), pas seulement de Safari. Et **la mémoire linéaire WASM
ne décroît jamais** — `WebAssembly.Memory` n'expose que `grow()`. Après un fichier de 120 Mo,
l'instance garde ~360 Mo pour toute la session. Retenu : tenter l'allocation, rattraper le
`RangeError`, et **recréer l'instance WASM** après tout fichier au-delà d'un seuil.

---

## 5. Interface — lot D

### Deux états, zéro saut de mise en page

Le mécanisme géométrique tient et doit être conservé tel quel : `.app { min-height: 100svh;
display: flex }` fixe une hauteur définie, `.stage { flex: 1 1 auto; min-height: 0 }` la reçoit, et
une piste `grid-template-rows: 1fr` d'un conteneur à hauteur définie est dimensionnée par le
conteneur, jamais par son contenu. Le `min-height: 0` est ce qui empêche la taille minimale
automatique de faire remonter le contenu. `svh` plutôt que `dvh` ou `vh`, pour la bonne raison.

⚠️ **Mais deux fuites de CLS restent, et le filet supposé n'existe pas.** `hadRecentInput` est armé
par des événements d'entrée observés **par le document** ; un fichier glissé depuis le Finder produit
`dragenter`/`drop` sans aucun `pointerdown` — **la fenêtre d'exclusion ne s'ouvre jamais** sur
l'interaction phare du produit. Et l'insertion de `.steps` (42 px) puis de la file d'attente
(≈ 200 px) vaut **0,198 de CLS**, soit deux fois le budget. Correctif : `.steps` rendue en SSR dès
l'état vide avec ses trois puces inactives, et la file d'attente en rangée de grille de hauteur
réservée. À vérifier par `PerformanceObserver({type:'layout-shift'})` sur un **vrai** glisser-déposer
depuis l'OS.

⚠️ **Et le `h1` est probablement l'élément LCP** : `max-width: 22ch` + `font-display: swap` ⇒ au swap,
`22ch` change de valeur (l'unité dépend de l'avance du « 0 » de la police effective), le `h1` se
re-découpe, une **seconde entrée LCP** est enregistrée et tout ce qui suit se décale. Correctif :
`22ch`/`40ch` → `rem`, et `font-display: optional` (zéro reflow garanti par la spécification).

### ⚠️ Le héros doit fonctionner sans JavaScript

Un `<button type="button">` sans JS ne fait rien, et l'`<input type="file">` associé est `hidden` +
`aria-hidden`. Avec un `requestIdleCallback(boot, {timeout: 2000})` sur un thread saturé par le
décor, le contrôle principal peut rester mort plusieurs secondes — et un clic pendant cette fenêtre
est **perdu silencieusement**. Correctifs : envelopper la bulle dans un `<label for="picker">` (le
sélecteur s'ouvre nativement dès le premier paint, sans une ligne de JS) ; **hydrater sur intention**
(`pointerdown`, `dragenter`, `paste`, `change`), l'idle n'étant plus qu'un préchargement ; et **mettre
l'intention en file** si un fichier arrive avant que le worker soit prêt.

### Ordre de tabulation, état vide

`1` lien d'évitement · `2` logo · `3-5` navigation · **`6` bulle de dépôt** (`<label>` + input
réel, activation Entrée/Espace) · `7` lien « en savoir plus ». Le `h1` précède la bulle dans le DOM
et la suit visuellement, via `grid-template-areas` — pas `order`. Un seul élément focalisable dans le
conteneur, donc SC 2.4.3 intact, et la séquence DOM reste signifiante (SC 1.3.2).

### État actif

`…` · `6` bouton « changer de photo » · `7` **champ de recherche de commune** (combobox ARIA,
`aria-expanded`, `aria-activedescendant`) · `8-9` latitude / longitude (`step="0.00001"`) ·
`10` **bouton principal unique** « Télécharger la photo » · `11-12` actions secondaires
(« Effacer la position », « Tout effacer ») · `13` repliable « autres informations » ·
`14` carte (`<svg>` focusable, déplacement du repère aux flèches, pas déclaré en mètres).

`aria-live="polite"` sur : position lue, chemin retenu, déplacement du repère (throttlé 700 ms),
progression du lot, résultat de la vérification. La carte n'est **jamais** le seul moyen de saisir
une position.

### Langage — zéro terme technique dans le parcours

| Interdit dans le parcours | Remplacement |
|---|---|
| EXIF, métadonnées, balise, IFD | « informations », « position » |
| DMS, décimal, WGS84 | « coordonnées » |
| conteneur, VP8X, sidecar, ISOBMFF | « la position sera écrite dans le fichier » / « un second fichier sera créé » / « la photo sera convertie » |
| upload, parser, worker | — |

Contrôle au build `guard-plain-language` : échec si un de ces mots apparaît hors des zones repliées
et du contenu éditorial.

⚠️ **Contraste** : à vérifier au calcul, pas à l'œil. Le gris `#9E96A6` sur `#17161B` et le
`#1A0A12` sur le rose `#FF3385` doivent être recalculés une fois les `backdrop-filter` remplacés par
des couleurs solides — c'est précisément ce que le remplacement rend déterministe.

---

## 6. Contenu et SEO — lot E

### ⚠️ Trois corrections avant d'écrire une ligne

1. **`/supprimer-geolocalisation-photo` → `/supprimer-localisation-photo`.** Google Suggest (23
   requêtes, MESURÉ) : le mot que tapent les Français est « localisation ». « Géolocalisation » reste
   dans le corps de texte comme synonyme.
2. **Aucune balise `hreflang`, aucun `x-default`, tant que `/en/` n'existe pas.** Déclarer un
   hreflang vers une page inexistante est une erreur, pas une préparation.
3. **3 blocs canoniques + 4 blocs propres**, au lieu de 7 blocs × 4 pages. La règle initiale impose
   **8 500 à 13 700 mots** (11 à 27 jours-homme de prose sourcée) et **interdit la mutualisation qui
   rendrait le coût soutenable** — sur un projet dont la promesse est la rigueur factuelle, écrire
   quatre variantes du même fait est un générateur d'incohérences. Les blocs « pourquoi vos fichiers
   ne partent pas », « vie privée » et « vérifier avec ExifTool » sont rédigés **une fois**, sur une
   page dédiée, et résumés en trois lignes propres à chaque page. Contrôle de build remplacé :
   *chaque page possède ≥ 400 mots qui n'existent nulle part ailleurs*.

### JSON-LD

`SoftwareApplication` seul. **Google exige `aggregateRating` pour le rich result de ce type**
(DOCUMENTÉ) — le projet interdisant d'inventer une note, **il n'y aura pas de rich result, et c'est
la bonne décision** : le balisage reste utile aux moteurs de réponse. `FAQPage` : le retrait de
mai 2026 est **confirmé sur la source officielle**. Ni `Review`, ni `HowTo`.

Titles et metas repris du cahier des charges, **comptés caractère par caractère** au build : échec
si un title > 60 ou une meta > 155.

### Contrôles au build (bloquants)

`guard-third-party` (aucune URL hors domaine dans `dist/` — la maquette charge encore Google Fonts
avec deux `preconnect`, quelqu'un copiera ce `<head>`) · `guard-title-meta` · `guard-blocks`
(les blocs obligatoires présents dans le HTML servi, JS désactivé) · `guard-js-budget` ·
`guard-index-budget` · `guard-plain-language` · `guard-headers` (simule la concaténation `_headers`
et échoue si un chemin hérite de deux `Cache-Control`) · **`guard-transfert`** (post-déploiement :
`GET` réel sur chaque actif de `/data/` et `/geo/` avec `Accept-Encoding: br, gzip, zstd`, échec si
un actif sort non compressé ou dépasse son budget).

---

## 7. Déploiement — Cloudflare Workers en intégration Git

Le dépôt est connecté à **Cloudflare Workers avec assets statiques** (Workers Builds), build et
déploiement automatiques à chaque push. Le Worker `geotager` a été créé le 27/07/2026 à 14:19 UTC.

⚠️ **Correction.** Cette section a d'abord été vérifiée contre la documentation **Pages** — Cloudflare
pousse désormais Workers pour les sites statiques et les deux documentations se ressemblent
dangereusement. Ce qui suit a été recorrigé sur la doc Workers. Ce qui relève de la **zone**
(§7.1, §7.3) était et reste valable dans les deux cas ; ce qui relève du **produit** (§7.2, §7.4)
a changé.

⚠️ **Cette section n'a pas subi de passe adverse** — l'agent contradicteur a été bloqué par un
classifieur de sécurité. Les points marqués « à tester » sont donc à trancher sur pièces au premier
déploiement, pas à croire sur parole.

**État actuel : la build échoue à chaque push, et c'est attendu.** Le dépôt ne contient aucune
application — ni `package.json`, ni `wrangler.jsonc`, ni répertoire de sortie. Workers Builds n'a
rien à publier. Corriger cela reviendrait à démarrer l'implémentation avant la validation du plan, et
à trancher au passage `workers_dev`, la date de compatibilité et la chaîne de build. En attendant :
désactiver les builds de branches non-production, ou déconnecter l'intégration Git jusqu'à la V0.

### 7.1 Ce que Cloudflare injecte tout seul — trois interrupteurs actifs par défaut

C'est le point le plus grave de la section : **le produit promet zéro requête tierce et zéro
télémétrie, et la configuration par défaut d'une zone Cloudflare gratuite viole les deux.**

| Fonctionnalité | Par défaut | Ce qu'elle fait |
|---|---|---|
| **Web Analytics / RUM** | **ACTIVE** sur les domaines Free depuis le 15 octobre 2025 | Injecte `<script src="https://static.cloudflareinsights.com/beacon.min.js">` — **requête tierce ET télémétrie** |
| **Speed Brain** | **ACTIVE** en Free | Ajoute un en-tête `Speculation-Rules` qui fait préfetcher des pages |
| **Email Address Obfuscation** | **ACTIVE dès l'inscription** | Réécrit les `mailto:` et injecte `email-decode.min.js` |
| Rocket Loader | à vérifier (`GET /zones/$ID/settings/rocket_loader`) | Réécrit les `<script>` et injecte son loader |
| Bot Fight Mode → JS Detections | à vérifier (`GET /zones/$ID/bot_management`) | Injecte un script `/cdn-cgi/challenge-platform/…` **et dépose un cookie `cf_clearance`** |
| Page Shield | opt-in | Ajoute un `content-security-policy-report-only` sur un échantillon de réponses |

Auto Minify (déprécié le 5 août 2024) et Mirage (déprécié le 15 septembre 2025) n'existent plus.
Early Hints est actif sur Pages mais **inoffensif** : il génère ses `Link` depuis nos propres
`<link>`, donc rien de tiers.

**Garantie retenue : une Configuration Rule unique, expression `true`**, qui force *Disable RUM* +
*Disable Zaraz* + *Email Obfuscation Off* + *Rocket Loader Off* + *Browser Integrity Check Off*.
Une règle survit à un changement de défaut côté Cloudflare ; un interrupteur coché une fois, non.

**Cookies — réponse franche.** Aucun cookie Cloudflare n'est inconditionnel : `__cf_bm` exige Bot
Management ou Bot Fight Mode, `cf_clearance` exige les JS Detections, `__cfruid` exige le Rate
Limiting. Bot Fight Mode coupé + aucune Rate Limiting Rule ⇒ **zéro cookie, et la bannière de
consentement est légitimement inutile**. Une réserve doit néanmoins figurer dans la page vie privée :
la protection DDoS peut servir un challenge en cas d'attaque, et poser alors un `cf_clearance`.
Formulation retenue : « aucun cookie déposé en fonctionnement normal ; un cookie technique de
sécurité peut être posé par notre hébergeur uniquement pour repousser une attaque ». **Mieux vaut
dire cela que prétendre l'impossible** — c'est exactement le genre de détail qu'un lecteur méfiant
vérifie.

### 7.2 L'indexation du domaine technique — Workers résout ce que Pages obligeait à colmater

Sur Pages, `<projet>.pages.dev` est indexable et **impossible à supprimer** : il fallait des règles
`_headers` scopées par hôte **plus** une Bulk Redirect 301 pour neutraliser un domaine dupliqué
qu'on ne pouvait qu'atténuer. Le site entier existait en double, sur un projet dont le seul canal
est le SEO.

**Sur Workers, l'hôte se supprime.** Une ligne suffit :

```jsonc
{ "workers_dev": false }
```

`geotager.<sous-domaine>.workers.dev` cesse d'exister. **Le risque de contenu dupliqué disparaît par
construction**, au lieu d'être colmaté par deux mécanismes qui pouvaient chacun sauter. C'est le seul
domaine où le choix de Workers plutôt que Pages est un gain net pour ce projet.

⚠️ **Contrepartie à ne pas subir.** Depuis Wrangler 4.44.0, `preview_urls` **suit par défaut le
réglage `workers_dev`** : couper l'un coupe l'autre. Or les prévisualisations sont ce qui rend le
Gate 2 exécutable avant la production (§7.7). Il faut donc les réactiver **explicitement** :

```jsonc
{ "workers_dev": false, "preview_urls": true }
```

**Et une question reste ouverte** : Pages documente un `X-Robots-Tag: noindex` **automatique** sur ses
prévisualisations. **Je n'ai pas trouvé l'équivalent documenté côté Workers.** Tant que ce n'est pas
vérifié par un `curl -I` sur une vraie URL de prévisualisation, on suppose qu'il n'existe pas, et on
protège les prévisualisations par **Cloudflare Access** — ce qui les rend inaccessibles aux robots
comme au public. Le comportement conservateur, pas l'optimiste.

**`robots.txt` doit rester permissif.** Un `Disallow: /` empêcherait Google de lire le moindre
`noindex`, et le même fichier est servi sur tous les hôtes.

⚠️ **Règle qui survit au changement de produit** : les règles `_headers` **se cumulent**, et *« if a
header is applied twice, the values are joined with a comma separator »*. Un `X-Robots-Tag` posé sur
un motif relatif produirait `index, follow, noindex` — comportement indéfini. **Contrôle de build
bloquant** : échouer si un `X-Robots-Tag` apparaît sous un motif ne commençant pas par `https://`.

### 7.3 Redirections

`_redirects` **ne sait pas faire de redirection au niveau du domaine** (la doc le liste
explicitement en ❌). Il matche un chemin, pas un hôte.

| Depuis | Vers | Mécanisme | Code |
|---|---|---|---|
| `www.geotagor.fr/*` | `geotagor.fr` | Single Redirect (zone) | 301 |
| `geotagor.com/*`, `www.geotagor.com/*` | `geotagor.fr` | Single Redirect (zone `.com`) | 301 |
| chemins internes | — | `public/_redirects` | **301 écrit à la main** (le défaut est 302) |

Prérequis souvent oublié : `geotagor.com` n'a aucune origine, il faut un enregistrement DNS
**proxifié** (`A 192.0.2.0` ou `AAAA 100::`, adresses réservées pour les montages sans origine) pour
que Cloudflare intercepte. Et le domaine **apex** `geotagor.fr` doit être géré par Cloudflare DNS
(CNAME flattening). Toujours ajouter le domaine dans l'interface Pages **avant** de toucher au DNS,
sinon 522.

### 7.4 La build tourne chez Cloudflare — quatre conséquences

**a. Aucune toolchain Rust dans l'image de build.** Établi sur l'image Pages v3 (Ubuntu 22.04,
Node 22.16.0, Python, Go, Ruby, Bun) : ni `cargo`, ni `rustup`, ni `wasm-pack`, ni `wasm-opt` —
Cloudflare a même un ticket de documentation ouvert sur le sujet. ⚠️ **L'image de Workers Builds
n'a pas été auditée séparément** ; la conclusion ci-dessous ne dépend de toute façon pas du produit,
puisqu'elle consiste à ne rien compiler chez Cloudflare. **Décision : si le spike valide la voie Rust, le
`.wasm` est compilé dans GitHub Actions et l'artefact est committé.** Ce n'est pas un pis-aller :
un binaire committé est diffable, et la chaîne de compilation est publique — donc *reproductible par
un tiers*, ce qui sert directement l'argument du produit.

**b. Le snapshot de communes devient obligatoire, pas recommandé.** L'accès réseau sortant de
l'environnement de build **n'est documenté nulle part**. Un script qui appellerait `geo.api.gouv.fr`
pendant la build rendrait chaque déploiement dépendant d'une API tierce, et deux builds du même
commit pourraient produire deux sites différents — incompatible avec « le dépôt est public,
vérifiez vous-même ». Le snapshot committé est l'unique source. Sa mise à jour se fait par un job
GitHub Actions planifié qui ouvre une **pull request**, donc revue et diffable.

**c. Les trois réglages du tableau de bord.**

| Réglage Pages | Valeur |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | *(vide — ce n'est pas un monorepo)* |

Tout le reste vit dans le dépôt, donc reste auditable. Le script `build` de `package.json` enchaîne
le travail réel, **en `&&` strict** :

```json
"scripts": {
  "build": "node scripts/build-index.mjs && node scripts/build-contours.mjs && astro build && node scripts/check-build.mjs"
}
```

- `build-index.mjs` (lot B) lit le **snapshot committé**, jamais le réseau, et produit les 30
  fichiers `.bin` pré-compressés.
- `build-contours.mjs` (lot C) simplifie les contours et écrit `public/geo/`.
- `astro build` produit `dist/`.
- `check-build.mjs` porte les gates bloquants : budget JS gzip, longueur des titles et metas, absence
  d'URL tierce dans `dist/`, `X-Robots-Tag` uniquement sous motif absolu, nombre de fichiers < 20 000,
  aucun fichier > 25 MiB. **Il sort en code non nul dès qu'un contrôle échoue.**

Les artefacts dérivés (index, contours) sont **reconstruits à chaque build** plutôt que committés :
le snapshot est la source unique, la dérivation est déterministe, et un artefact committé qui
diverge de sa source est une classe de bug qu'on s'évite. Si le plafond de 20 minutes devenait
contraignant, l'arbitrage inverse — dériver dans GitHub Actions et committer, comme pour le `.wasm` —
reste ouvert.

**d. Pages ne lit que le code de sortie de la commande de build.** Verbatim : *« An exit code of 0
will cause the Pages build to be marked as successful and assets will be uploaded regardless of if
error logs are written to standard error. »* Donc un `|| true`, un pipe sans `pipefail`, ou un script
Node qui attrape l'exception sans poser `exitCode = 1` **met un site cassé en production**. Les
contrôles bloquants doivent sortir en non-zéro, chaînés en `&&`.

⚠️ **e. Le `wrangler.jsonc` devient obligatoire — l'inverse de ce que ce plan disait.** Sous Pages,
il était déconseillé : il ne pouvait porter ni la commande de build ni la racine, et il verrouillait
les champs du tableau de bord. Sous Workers, c'est le fichier de configuration du Worker, et il porte
les décisions qui comptent ici :

```jsonc
{
  "name": "geotager",
  "compatibility_date": "2026-07-27",
  "assets": { "directory": "./dist" },
  "workers_dev": false,
  "preview_urls": true
}
```

Pas de champ `main` : un site d'assets seuls n'a pas de code Worker. C'est cohérent avec la contrainte
« zéro serveur » — **rien de nous ne s'exécute chez Cloudflare**, l'hébergeur ne fait que servir des
fichiers.

Limites d'assets en plan gratuit, **identiques sous Workers et sous Pages** (doc Workers vérifiée) :
**20 000 fichiers** par version, **25 MiB** par fichier, **100 règles** `_headers` à 2 000 caractères
par ligne, **2 100 redirections**. ⚠️ Les quotas de build (nombre par mois, durée, concurrence) ont
été relevés sur Pages et **n'ont pas été revérifiés pour Workers Builds** — à contrôler sur
`/workers/ci-cd/builds/limits-and-pricing/` avant de s'y fier.

Note de workflow : **les PR issues de forks n'obtiennent pas de prévisualisation.** Sur un dépôt
public, une CI GitHub Actions qui rejoue `npm run build` et les contrôles bloquants n'est donc pas un
luxe, c'est le seul garde-fou pour les contributions externes.

### 7.5 Compression de l'index — la stratégie se confirme, avec une correction de nommage

Deux constats du Gate 1 semblaient se contredire : « `application/octet-stream` n'est pas compressé
par Cloudflare » et « on pré-compresse l'index en brotli ». **Ils se réconcilient exactement** : nous
n'attendons aucune compression du CDN, nous expédions des octets **déjà** compressés (338 010 o) et
nous les décompressons nous-mêmes par `DecompressionStream`. Un type non compressible est donc
précisément ce que nous voulons.

⚠️ **Mais il ne faut pas nommer ces fichiers `.br`.** Si quoi que ce soit déduisait
`Content-Encoding: br` de l'extension, le navigateur décompresserait **notre** couche et
`DecompressionStream` recevrait des données déjà claires. Retenu : extension **`.bin`**,
`Content-Type: application/octet-stream`, `Cache-Control: …, immutable, no-transform`, et **jamais**
de `Content-Encoding` posé à la main. Ici `no-transform` ne coûte rien — contrairement au cas
généralisé, qui reste proscrit sur `/*`.

À tester au premier déploiement, c'est décisif et non documenté : cinq `curl` avec
`Accept-Encoding` valant `identity`, `gzip`, `br`, `zstd` puis les trois, et comparaison des
`sha256sum` au fichier de `dist/`. **Les cinq doivent être identiques.**

### 7.6 En-têtes

Pages envoie déjà `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin` et `Access-Control-Allow-Origin: *`. À notre charge : durcir le
`Referrer-Policy` en `no-referrer`, retirer le `Access-Control-Allow-Origin`, et poser une CSP.

Deux directives à ne pas rater : **`script-src 'wasm-unsafe-eval'`** (sans elle, le WebAssembly est
bloqué — et surtout pas `'unsafe-eval'`, plus large) et **`worker-src`** explicite dès lors que
`default-src 'none'`. Et **`build: { inlineStylesheets: 'never' }`** dans la config Astro : le défaut
`'auto'` inline les petites feuilles, qu'une CSP sans `'unsafe-inline'` bloquerait.

### 7.7 bis Obtenir l'URL de prévisualisation dans la PR

`preview_urls: true` dans le `wrangler.jsonc` est **nécessaire mais pas suffisant**. La doc Workers :
*« commits made on the production git branch will produce a Workers Build. If you want to take
advantage of preview URLs and pull request comments, you can additionally enable "non-production
branch builds" »*. C'est un réglage **de tableau de bord**, que Wrangler ne peut pas porter :
**Settings > Build > Branch control**. Configuration confirmée le 27/07/2026 —
branche de production `main`, builds de branches non-production activés.

⚠️ **Ce que le premier réglage cachait.** Jusque-là, la branche de production était la branche de
travail. Preuve : `main` ne contenait que la page d'attente quand le site public servait déjà
l'application. Deux conséquences — aucune prévisualisation n'était possible (une branche de
production n'est pas prévisualisée, elle *est* la production), et **chaque push mettait du code non
relu en ligne**. À surveiller si le projet change un jour de dépôt ou de compte : rien dans le
dépôt ne protège de ce réglage.

Une fois activé, Cloudflare publie automatiquement **deux** URL en commentaire de PR :

| Type | Forme | Usage |
|---|---|---|
| Prévisualisation de commit | `<prefixe-version>-geotager.<sous-domaine>.workers.dev` | fige une version précise |
| Prévisualisation de branche | `<branche>-geotager.<sous-domaine>.workers.dev` | **alias stable**, suit le dernier commit |

C'est l'alias de branche qui sert au Gate 2 : il ne change pas d'un commit à l'autre, donc les
contrôles peuvent le viser en dur.

⚠️ **Et la commande de déploiement n'est pas la même selon la branche.** Doc verbatim : *« For preview
builds (commits to branches other than your production branch), the deploy command is replaced with a
preview deploy command (defaults to `npx wrangler versions upload`), which creates a preview version
**without promoting it to production**. »* Autrement dit, tant que les builds de branches
non-production ne sont **pas** activés, une branche qui construit le fait par le chemin `production`.
**Il faut donc vérifier au même endroit que la branche de production est bien `main`** — sinon une
branche de travail se déploierait en production à chaque push, ce qui, sur un site public, est le
genre d'accident qu'on ne remarque qu'une fois.

Si l'URL n'apparaît toujours pas après activation, le suspect suivant est le **sous-domaine
`workers.dev` du compte** : les prévisualisations y sont servies. Nous posons `workers_dev: false`
pour l'hôte de production, mais `preview_urls: true` explicite les conserve — encore faut-il que le
compte ait un sous-domaine enregistré.

### 7.7 Le gain, réel : Gate 2 devient exécutable avant la mise en production

Chaque branche obtient une URL de prévisualisation. La preuve du zéro-tiers, Lighthouse mobile, le
contrôle de compression octet-pour-octet et le rapport axe-core peuvent donc tourner sur une **URL
réelle avant tout passage en production** — au lieu d'être repoussés après la mise en ligne, ce que
le Gate 2 tel qu'écrit supposait implicitement.

---

## 8. Corpus de test — sources publiques uniquement

Conformément à la réponse de Mathieu : aucun fichier personnel. Base **raw.pixls.us** (CC0,
non retouché, garanti), complétée par les corpus de test des bibliothèques EXIF et par Wikimedia.

**Chaque fichier reçoit son `attendu/<id>.json` rédigé AVANT l'implémentation**, avec la sortie
ExifTool de référence et le drapeau `redigeAvantImplementation: true`. C'est ce qui empêche le corpus
de devenir un enregistrement du comportement observé au lieu d'une spécification du comportement voulu.

⚠️ **Trois cases ne seront probablement pas couvrables en libre** : JPEG iPhone mode portrait
multi-images (MPF), Live Photo, JPEG passé par Photoshop (APP12/APP13). Entrée `QUESTIONS.md`
ouverte, comportement conservateur retenu : ces chemins **refusent l'écriture** tant qu'ils n'ont pas
de fichier de test, plutôt que de l'autoriser sans preuve.

---

## 9. Ordre d'exécution — phasé

**V0 — 4 à 6 semaines. JPEG seul.** Suppression et correction par P1, une page, aucune carte, aucun
index, aucun WASM. C'est le cas d'usage n°1, c'est le chemin où `little_exif` compte **0 panic** et
où `piexif-ts` est le mieux compris. **On apprend du terrain avant de dépenser 30 semaines.**

**V1.** + PNG/WebP · + index de communes · + carte SVG démotée · + PWA · + les 4 pages.

**V2.** + HEIC/AVIF selon le résultat du spike · + écriture vidéo si l'inventaire exhaustif est fait.

Séquence immédiate, dans cet ordre :

1. **S1 du spike** (35 min) : mesurer le poids WASM. C'est le critère qui tue le plus probablement
   la voie Rust, et il ne coûte rien.
2. **S3** (HEIC/AVIF sur cible hôte, ExifTool comme oracle) — **réalisable sans WASM**, 2 jours,
   et c'est lui qui débloque la décision produit.
3. Geler les six contrats.
4. Lots A puis B/C/E ; D en dernier.
5. Gate 2, par un agent qui n'a écrit aucun lot.

---

## 10. Vérification — comment on saura que ça marche

| Contrôle | Commande |
|---|---|
| Build propre | `npm run build`, sortie complète, zéro warning |
| Budget JS | `guard-js-budget` : somme gzip des bundles vs 150 Ko |
| Budget index | poids réel de **chacun** des 30 fichiers vs 40 Ko |
| Transfert réel | `curl -H 'Accept-Encoding: br,gzip,zstd' -sI <url>` sur chaque actif, comparé au q11 local |
| Contenu sans JS | `curl -s <url> \| grep` sur chaque bloc obligatoire |
| Zéro tiers | onglet Réseau sur un cycle complet dépôt → recherche → modification → export |
| Écriture | `exiftool -gps:all -n fichier.jpg` après modification |
| Suppression | `exiftool -a -G1 fichier.jpg` : il ne reste rien |
| Vidéo | `exiftool -a "-gps*" -ee video.mp4` (`-ee` pour les pistes temporisées) |
| Préservation | ICC, `Orientation`, vignette, MakerNote : empreintes identiques avant/après |
| a11y | axe-core : zéro violation critique ou sérieuse |
| Perf | Lighthouse mobile, 4 scores |

Tout ce qui précède tourne désormais sur **l'URL de prévisualisation de la branche**, avant la mise
en production. S'y ajoutent quatre contrôles propres à l'hébergement, à rejouer après chaque
déploiement :

| Contrôle | Commande |
|---|---|
| **Rien d'injecté** | `curl -s <url> \| grep -nEi 'cloudflareinsights\|beacon\.min\.js\|/cdn-cgi/\|rocket-\?loader\|email-decode\|challenge-platform\|zaraz'` → doit être **vide** |
| **Aucun cookie** | `curl -sD - -o /dev/null <url> \| grep -i '^set-cookie'` → **vide** |
| **Speed Brain coupé** | `curl -sI <url> \| grep -i 'speculation-rules'` → **vide** |
| **Index intact à l'octet près** | 5 `curl` (`Accept-Encoding` : `identity`, `gzip`, `br`, `zstd`, puis les trois) + `sha256sum`, comparés au fichier de `dist/` → **les cinq identiques** |
| **Indexation** | `curl -I https://geotagor.pages.dev/` → 301 ; `curl -I https://<branche>.geotagor.pages.dev/` → `x-robots-tag: noindex` ; `curl -I https://geotagor.fr/` → **ni l'un ni l'autre** |

---

## 11. Questions fermées pour Mathieu

Aucune n'a été tranchée à sa place ; le comportement le plus conservateur est indiqué.

| # | Question | Retenu provisoirement |
|---|---|---|
| Q1 | **Phasage V0 JPEG (4-6 sem.) avant tout le reste** — ou tout d'un bloc (24-41 sem.) ? | V0 d'abord |
| Q2 | **Si l'écriture HEIC n'est pas atteignable, on construit quand même ?** (A) oui, compagnon assumé et dit dès l'accueil ; (B) v1 = JPEG+PNG, HEIC en lecture/suppression seule ; (C) non | (B) |
| Q3 | **La carte est démotée** (situe, ne vise pas ; `maxZoom` 11 ; « cliquez » supprimé). Accepté ? | oui |
| Q4 | **IPTC retiré du périmètre d'écriture** (l'IIM n'a pas de coordonnées). Accepté ? | oui |
| Q5 | **Vidéo : lecture seule en v1**, pas de suppression. Accepté ? | oui |
| Q6 | **Décor : gradients statiques au lieu de blobs animés + flou.** Accepté ? | oui — révisé en V1.2 (Q-040) : un calque SVG borné reprend le mouvement, sans flou, sans blend, sans propriété CSS animée |
| Q7 | **Leaflet supprimé au profit d'une carte SVG maison** (−42 Ko gzip). Accepté ? | oui |
| Q8 | **URL renommée `/supprimer-localisation-photo`.** Accepté ? | oui |
| Q9 | **Allowlist de licences amendée** pour admettre OFL-1.1 (polices) — sinon on renonce aux Fontsource | amender |
| Q10 | **Volumes de recherche** : passer 1 h sur Google Keyword Planner avant d'écrire le contenu ? Ahrefs est inaccessible (plan insuffisant) | oui, avant le lot E |
| Q11 | **Domaine** : `geotagor.fr` + `.com` défensif. Les 9 variantes testées sont **toutes libres** au RDAP (27/07/2026). Confirmer et acheter ? | `.fr` + `.com` |
| Q12 | **Antériorité INPI** : non vérifiable ici (data.inpi.fr en 403). Classes 9 **et** 42 confirmées sur la classification de Nice. À faire manuellement (~20 min) | à faire avant dépôt |
| Q13 | **Mentions légales** : nom de l'éditeur et hébergeur à fournir — obligation légale même sans collecte | à fournir |
| Q14 | **Hors ligne** : (A) « fonctionne hors ligne pour ce que vous avez déjà consulté », dit dans l'UI ; (B) précacher l'index seul (349 Ko), pas de carte hors ligne ; (C) précacher 1,4 Mo sur action explicite | (B) |

---

## Annexe — ce qui a été attaqué et qui tient

Utile à savoir, pour ne pas rouvrir ces débats : le rejet de MapLibre (273 Ko contre 42 Ko gzip,
mesuré deux fois) · le refus de fabriquer un `aggregateRating` · l'édition sur place P1 comme colonne
vertébrale · la lecture par tranches et la composition par `Blob` · la détection des fuites Live Photo
et photo animée Android (**aucun des 20 concurrents ne les traite** — c'est le différenciateur le
plus démontrable du produit) · le refus d'inventer `GPSTimeStamp` (« y mettre "maintenant" serait un
mensonge inscrit dans le fichier ») · le rejet de `france-geojson` (millésime 2018) · la géométrie
anti-CLS de `.stage` · les résultats négatifs mesurés du lot B.
