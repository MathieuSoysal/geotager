# CONTRE-EXPERTISE — budget JS et budgets de performance

**Méthode.** J'ai relu et refait toutes les additions de D3 §4, D2 §1.7 et §2.3, et j'ai lu intégralement `/home/user/geotager/maquette-geotagor-v7.html` (20 579 o, MESURÉ). Les additions de D3 sont **arithmétiquement exactes** (100 478 et 113 389 se recomposent au chiffre près, j'ai vérifié le facteur 5,832 o/ligne). Le problème n'est pas dans les additions. Il est dans **ce qui n'est pas dans le tableau**, et surtout dans le fait que **personne, de R1 à D4, n'a examiné le coût de rendu de la maquette** — 100 % du raisonnement performance porte sur des octets transférés, 0 % sur du travail CPU/GPU par image.

Référence « mobile milieu de gamme » : profil d'émulation Lighthouse mobile (1 638 kbit/s, RTT 150 ms, ralentissement CPU ×4, 412×915 CSS @ DPR 2,625). Les caractéristiques GPU réelles d'un téléphone sont **NON VÉRIFIÉ** (aucun appareil ici) ; je le signale à chaque fois.

---

## 1. BLOQUANT — Les blobs animent `border-radius` : l'animation décorative est non compositable et tourne sur le thread principal en permanence

**Affirmation attaquée.** D3 §5.5 : « `backdrop-filter: blur(26px)` sur un panneau posé au-dessus de trois blobs animés en `mix-blend-mode: screen` rend le contraste **non déterministe** ». D3 traite le sujet **uniquement** sous l'angle du contraste, conclut « pire cas gris 4,98:1 → conforme », et conserve `Blobs.astro` + le jeton `--panel: rgba(31,29,37,.82)` dans l'arborescence. Le coût d'exécution n'est évalué nulle part.

**Pourquoi c'est faux.** Voici le code réel (MESURÉ, maquette lignes 20-26) :

```css
.blobs{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;filter:blur(70px)}
.blob{position:absolute;mix-blend-mode:screen}
.b1{width:64vw;height:64vw;...;animation:m1 21s ease-in-out infinite}
@keyframes m1{0%,100%{border-radius:62% 38% 44% 56%/58% 46% 54% 42%;transform:translate(0,0) scale(1)}
              50%{border-radius:38% 62% 58% 42%/44% 58% 42% 56%;transform:translate(4vw,4vh) scale(1.1)}}
```

Le point décisif n'est pas le flou, c'est **`border-radius` dans les keyframes**. Les seules propriétés animables par le compositeur sont `transform`, `opacity`, `filter` et `backdrop-filter` (DOCUMENTÉ, contrat de compositing de Blink/WebKit). `border-radius` n'en fait pas partie : **son animation invalide le paint à chaque image, sur le thread principal.**

Conséquence en chaîne, à 60 Hz, en continu, sur **toutes** les pages du site (`.blobs` est `position:fixed`, hors de `.app`) :

1. 3 blobs repeints (nouveau `border-radius` + `scale`) — thread principal ;
2. blending `screen` des 3 → surface de rendu obligatoire (le blend exige la lecture du backdrop) ;
3. `filter: blur(70px)` sur cette surface **plein viewport** — le résultat **ne peut pas être mis en cache** puisque la source change à chaque image ;
4. `.bubble` (ligne 53) anime **le même keyframe `m1`** et porte `box-shadow: 0 0 110px -14px` — une ombre à 110 px de flou repeinte à chaque image ;
5. `.island { backdrop-filter: blur(26px) }` + `.maptip` blur(10px) + 3 × `.card` blur(22px) + `.note` blur(22px) = **jusqu'à 6 surfaces `backdrop-filter` recalculées à chaque image**, parce que leur backdrop bouge.

Coût mémoire, **ESTIMÉ, calcul montré** : viewport 412×915 @ DPR 2,625 = 1 081×2 402 ≈ 2,60 Mpx ; RGBA8 → **10,4 Mo par surface plein écran**. En admettant le sous-échantillonnage de Skia pour σ élevé (÷8 linéaire), une passe de flou coûte encore la lecture pleine résolution (10,4 Mo) + les passes réduites + le composite pleine résolution (10,4 Mo) ≈ **25 Mo/image** pour les blobs, et ≈ 18 Mo/image pour le `backdrop-filter` de `.island` (1 081×~1 900 = 2,05 Mpx). Soit **≈ 2,5 à 3 Go/s de bande passante mémoire soutenue**, contre 10 à 12 Go/s réellement atteignables sur un SoC LPDDR4X milieu de gamme partagés entre CPU, GPU et affichage — **20 à 30 % de la bande passante système, en permanence, pour de la décoration**. (Le facteur de sous-échantillonnage exact et le SoC sont **NON VÉRIFIÉ**.)

Mais le chiffre GPU est le point secondaire. Le point dur, lui, ne dépend d'aucun modèle : **le thread principal ne repasse jamais en idle.** L'INP se décompose en délai d'entrée + durée du gestionnaire + délai de présentation. Avec 4 animations non compositées permanentes, le délai d'entrée est structurellement d'au moins une image et le délai de présentation d'au moins une autre, **avant même que votre code s'exécute**. Le budget de 200 ms est attaqué par le fond d'écran.

Trois aggravations :
- `prefers-reduced-motion` ne sauve pas : il coupe les animations (et D3 a raison de corriger l'oubli de `.bubble` dans la maquette), mais **le `filter: blur(70px)` fixe et les 6 `backdrop-filter` restent recalculés à chaque image de défilement**, puisque les cartes défilent au-dessus d'un fond `fixed`. Or tout le contenu SEO du lot E est sous la ligne de flottaison : c'est exactement là qu'on défile.
- `html{scroll-behavior:smooth}` sans garde (ligne 18) + `.scrollcue` déclenche un défilement animé long au-dessus de ce pipeline.
- `.island{overflow:hidden; border-radius:42px 30px 38px 26px}` + `backdrop-filter` : le clip du backdrop devient un masque à rayons non uniformes, plus cher qu'un rect.

**Gravité : BLOQUANT.** C'est la seule objection du lot qui met simultanément en cause INP, LCP et l'autonomie de la batterie, et elle est indépendante du code applicatif : aucune optimisation JS ne la rattrape.

**Correctif.** Trois changements, aucun ne modifie l'identité visuelle :

1. **Supprimer `filter: blur(70px)` et `mix-blend-mode` — remplacer les 3 blobs par 3 `radial-gradient` empilés sur `body`.** Un dégradé radial *est* mathématiquement un flou : à 70 px de flou, il ne reste aucun détail au-dessus de ~35 px, donc la forme organique est invisible. Coût : une passe de shader, zéro surface de rendu, zéro blend, zéro invalidation. Bonus : les dégradés CSS **ne sont pas candidats LCP**, contrairement à une image de fond bakée.
2. **Si le mouvement est jugé indispensable : n'animer que `transform`.** Forme figée en SVG, rotation/translation lentes. Compositeur seul, 0 travail thread principal.
3. **Remplacer `backdrop-filter: blur(26px)` par une couleur solide.** D3 §5.5 a *déjà* calculé les composites (`#1E1C23`, `#32202E`, `#242133`, `#1E2D33`). Dès que le fond est statique, le composite est déterministe : **un panneau solide est visuellement identique au panneau flouté**, et ce seul changement résout à la fois le problème de coût et le « contraste non déterministe » que D3 documente comme son point d'attention structurel. Deux problèmes pour un correctif.

---

## 2. BLOQUANT — Le budget JS oublie le moteur P1, qui est pourtant désigné par D1 comme « la colonne vertébrale du produit ». La marge réelle est de 14 à 34 ko, pas de 40 à 53 ko

**Affirmation attaquée.** D3 §4.4 : « **Les 150 Ko gzip tiennent, avec 40 à 53 ko de marge. Aucun arbitrage n'est nécessaire.** »

**Pourquoi c'est faux.** D1 §0 pose P1 (édition sur place à longueur constante) comme chemin principal et le chiffre lui-même : « **P1 (suppression, correction) — tous formats | JS pur, écrit par nous | initial, ~8 Ko gzip ESTIME** ». Le tableau de D3 §4.3 alloue au lot A : worker 380 l., chargeur WASM 150 l., « adaptateurs JS (retrait GPS ciblé) » 320 l., XMP 150 l., PNG chunks 240 l. **Aucune de ces lignes n'est P1** : P1 exige la localisation par octets du bloc GPS dans JPEG, PNG, TIFF (deux boutismes), ISOBMFF (HEIC/AVIF/CR3/MP4/MOV/JXL), RIFF/WebP et RAF, plus la neutralisation en place. Les 8 ko de D1 ne sont dans aucune case de D3.

Quatre autres postes de D1 sont également absents du tableau, alors qu'ils sont spécifiés en détail :

| Poste D1 | Où c'est spécifié | Lignes ESTIMÉ | o gzip central |
|---|---|---|---|
| Moteur P1, tous conteneurs | D1 §0, §2.2 | (≈1 372) | **8 000** (chiffre de D1) |
| Balayage résiduel Boyer-Moore, 4 familles de motifs × 2 boutismes | D1 §5.4 | 250 | 1 458 |
| Pipeline de vérification V0–V6 + rapport de diagnostic téléchargeable | D1 §5.2, §5.3 | 350 | 2 041 |
| `detect.ts` (≈20 formats) + lecteurs par tranches par format | D1 §4.2 | 180 | 1 050 |
| Live Photo / arrière-fichier MP4 après EOI, `©xyz`→`free` | D1 §6.4 | 150 | 875 |
| Glue JS de `wasm-bindgen` — **c'est du JavaScript**, D1 §S3 la compte dans le budget WASM | D1 §1.2 | — | 4 000 |
| Manifeste de précache du SW + divers | D3 §1.2 | — | 500 |
| **Total omis** | | | **17 924** |

Refonte des totaux :

| | D3 | corrigé | % de 153 600 | % de 150 000 |
|---|---|---|---|---|
| Central | 100 478 | **118 402** | 77,1 % | 78,9 % |
| Pessimiste | 113 389 | **139 347** | 90,7 % | **92,9 %** |
| Pessimiste + dépassement ×1,5 du comptage de lignes | — | **168 615** | **109,8 %** | 112,4 % |

Deux remarques sur la colonne « pessimiste » de D3 : elle ne fait varier **que** le facteur o/ligne (5,832 → 8,8), jamais le **nombre de lignes**. Or tout le risque est là : 4 350 lignes pour un moteur de métadonnées multi-conteneurs, un pool de workers, un décodeur d'index front-codé/varint, une combobox ARIA et une carte, c'est optimiste — R2 chiffrait à lui seul « ~2 000 lignes de manipulation binaire » pour les conteneurs. Un dépassement de 1,5 % ne se voit pas ; un dépassement de 1,5× est la norme sur du parsing binaire.

Et « 150 Ko » : D3 lit 153 600 o (Kio). Si le cahier des charges dit kilo-octets, il manque 3 600 o de marge assumée.

Deux erreurs de détail dans la même section :
- D3 justifie `exifr/lite` par « mini ne lit ni HEIC ni XMP ni **PNG** », ce qui suppose que `lite` lit le PNG. R2 cite le README verbatim : *lite = « Reads JPEG and HEIC. Parses TIFF/EXIF and XMP. »* **`lite` ne lit pas le PNG.** Soit `full` (+11 284 o), soit vous écrivez le lecteur PNG (les 240 lignes budgétées couvrent l'écriture, pas la lecture).
- D3 annonce un chemin initial de « ~660 lignes → 3 849 o », mais les deux composants qu'il nomme (coquille+machine 550, dropzone 220) font 770 lignes. Mineur, mais c'est le chiffre le plus important de la section.

**Gravité : BLOQUANT** — non pas parce que le budget est dépassé aujourd'hui, mais parce que la phrase « aucun arbitrage n'est nécessaire » est celle qui fera dire oui, dans six semaines, à `exifr full` puis à une dépendance de carte, alors qu'il ne restera plus 40 ko mais 14.

**Correctif — un seul levier, et il est décisif : supprimer Leaflet.** Leaflet pèse **42 706 o gzip, soit 42,5 % du total central et 57 % des vendors**, et le projet n'utilise presque rien de ce qu'il paie :

- pas de tuiles (contrainte zéro tiers) ;
- pas de `L.geoJSON` — l'objection n°3 démontre qu'il ne faut justement **pas** l'utiliser ;
- **la navigation clavier de la carte, seul argument a11y invoqué par D2 §2.6 pour préférer Leaflet, est explicitement désactivée par D3 §5.3 : « Le panoramique clavier de Leaflet est désactivé (`keyboard:false`) ».** D2 et D3 se contredisent, et c'est D3 qui spécifie l'accessibilité. D2 §2.7 reconnaît par ailleurs que le déplacement du repère au clavier est « ~40 lignes, non fourni par Leaflet ».

Ce qui reste de Leaflet après cela : un `<div>` focusable déplaçable et une formule de Mercator. Une carte SVG maison — projection Mercator pré-calculée au build, un `<path>` composé, une matrice de transformation pour pan/zoom, un `<g>` focusable pour le repère — fait **350 à 450 lignes ≈ 2 300 à 3 500 o gzip**, et permet de pré-projeter au build, ce qui supprime aussi `topojson-client` (2 587 o).

Effet net : **−41 800 à −42 900 o**. Le tableau devient :

| | avec Leaflet | sans Leaflet |
|---|---|---|
| Central corrigé | 118 402 (77 %) | **75 442 (49 %)** |
| Pessimiste corrigé | 139 347 (91 %) | **97 574 (64 %)** |
| Pessimiste + ×1,5 lignes | 168 615 (**dépassement**) | **126 842 (83 %)** |

C'est ce swap, et lui seul, qui transforme un budget à 91 % en un budget qui survit à un dépassement de 50 % du volume de code.

---

## 3. SERIEUX — INP : 887 couches Leaflet créées à l'intérieur de la tâche d'interaction qui sélectionne la commune

**Affirmation attaquée.** D2 §2.3 : « Contours communaux, shard du département visé, propriétés réduites à `{code, nom}`, GeoJSON | **lazy** | médiane 9,8 Ko, max 24,6 Ko ». Le budget est présenté en octets, avec « marge conservée : ~79 % ».

**Pourquoi c'est fragile.** R4 a mesuré que le département 62 contient **887 communes**. `L.geoJSON(data)` instancie **un objet `L.Path` par feature**, chacun avec un élément DOM `<path>`, une entrée dans `map._layers`, et l'attachement d'écouteurs. C'est une classe de coût que ni R4, ni D2, ni D3 n'a mesurée — le raisonnement s'arrête aux octets transférés.

Décomposition, **ESTIMÉ** :
- `JSON.parse` d'environ 100–150 ko de GeoJSON : ~2 ms sur x86, **8 à 15 ms** avec le ralentissement CPU ×4 ;
- création de 887 couches Leaflet : l'ordre de grandeur usuel est 0,1 à 0,3 ms par polygone simple sur desktop, soit 90 à 270 ms, → **360 à 1 600 ms sur mobile milieu de gamme** ;
- le tout dans **la tâche qui répond au clic sur un résultat de recherche**.

INP mesuré = 400 à 1 600 ms contre un budget de 200 ms. Et ce n'est pas un cas limite : c'est le chemin nominal du produit (« choisir une commune »). Les chiffres de coût par couche sont **NON VÉRIFIÉ** faute d'appareil, mais l'ordre de grandeur ne peut pas être inférieur d'un facteur 5.

**Gravité : SERIEUX.** L'INP est violé sur l'interaction centrale, et le correctif est structurel, pas paramétrique.

**Correctif.**
1. **Ne jamais passer par `L.geoJSON`.** Construire une **seule chaîne `d`** contenant les 887 polygones (un `<path>` composé) + un second `<path>` pour la commune sélectionnée. 2 nœuds DOM au lieu de 887. Cohérent avec le correctif n°2 (carte maison).
2. **Projeter et construire la chaîne `d` dans un worker**, puis `postMessage` d'une string. Le thread principal ne fait qu'une affectation d'attribut.
3. Si vous gardez Leaflet malgré tout : `preferCanvas: true` obligatoire, et découpage avec `scheduler.yield()` pour que la première peinture post-interaction ait lieu avant le rendu du shard.
4. **Mesurer avant d'arbitrer** : `performance.measure` autour de la création de couches sur le dept 62, sous ralentissement CPU ×4. C'est un test de 20 minutes qui décide de la conception.

---

## 4. SERIEUX — INP : D2 suppose un worker pour l'index, l'arborescence de D3 n'en contient pas

**Affirmations attaquées, en contradiction directe.**
D2 §1.7 : « Normaliser les 35 014 noms au chargement | **29,3 ms** (une fois, **dans le worker**) », et D2 §NON VÉRIFIÉ : « rejouer le scan dans un Web Worker sur un Android d'entrée de gamme ; **provisionner ×5 à ×10** ».
D3 §1.2, arborescence : `src/worker/` contient exactement `exif.worker.ts`, `queue.ts`, `abort.ts` — **lot A exclusif**. `src/lib/places/` (index, shard, normalize, search, rank, cache) est un module ordinaire, au même niveau que `lib/map/`, sans point d'entrée worker.

**Pourquoi c'est grave.** Si le décodage de l'index tourne sur le thread principal, le coût est, en appliquant la provision de D2 elle-même :

- reconstruction du blob normalisé de 35 014 noms : 29,3 × 5 à 10 = **147 à 293 ms** ;
- plus le décodage front-coding (35 014 concaténations produisant 421 ko de chaînes) et 35 014 varints delta-zigzag, non mesurés par D2 ;
- déclenché par **`focus` sur le champ de recherche** (D2 §1.7 : « Tier 1 chargé dès que le champ de recherche reçoit le focus »), c'est-à-dire par une interaction utilisateur.

INP de la première frappe : **150 à 400 ms au minimum**, sur un thread déjà occupé par les animations de l'objection n°1.

Corollaire à ne pas rater si le worker est ajouté : **ne jamais renvoyer le tableau des 35 014 chaînes au thread principal.** Les strings ne sont pas transférables ; un `structuredClone` de 421 ko de chaînes se paie côté récepteur, sur le thread principal, exactement là où on voulait l'éviter. Le worker doit garder l'index et ne renvoyer que les 8 résultats.

**Gravité : SERIEUX.**

**Correctif.** Déclarer explicitement `src/worker/places.worker.ts` dans l'arborescence (et régler la question de propriété : lot B écrit dans un répertoire aujourd'hui marqué « lot A exclusif ») ; budgéter ses lignes ; interdire par revue tout transfert de l'index vers le thread principal ; et déclencher le chargement de Tier 1 sur `pointerenter`/`requestIdleCallback` **avant** le focus, pas au focus.

---

## 5. SERIEUX — CLS : le filet de sécurité de D3 n'existe pas pour le glisser-déposer, et l'insertion de la file d'attente vaut à elle seule 0,20

**Affirmation attaquée.** D3 §2.4, couche 3, point 2 : « La spécification Layout Instability marque `hadRecentInput = true` pour tout décalage survenant dans les **500 ms** suivant une interaction, et ces décalages sont exclus du CLS. **Le seul décalage possible est donc, par construction, exclu de la métrique.** »

**Pourquoi c'est faux.** `hadRecentInput` n'est pas armé par « une interaction » au sens large : il l'est par des événements d'entrée discrets observés **par le document** (`pointerdown`, `mousedown`, `keydown`). Un fichier glissé depuis le Finder, l'Explorateur ou la galerie du téléphone produit `dragenter` / `dragover` / `drop` — **le geste a commencé hors de la page, il n'y a aucun `pointerdown` dans le document**. La fenêtre d'exclusion ne s'ouvre jamais.

Or le glisser-déposer **est** l'interaction phare du produit : le hero entier est une bulle « Déposez une photo ». Les deux autres chemins sont couverts (le collage arme `keydown`, le bouton arme `pointerdown`) ; celui qui est mis en avant ne l'est pas.

**Et il y a un vrai décalage.** D3 §2.2 : « État ACTIF en lot : **une FileQueue s'insère entre `.steps` et `.island`** ». `.steps` n'existe pas non plus à l'état vide. Les deux poussent le contenu de l'îlot vers le bas dans une scène à hauteur verrouillée — la scène ne bouge pas, mais **tout ce qu'elle contient bouge**, et le CLS se mesure sur les éléments, pas sur la racine.

Calcul, **ESTIMÉ, viewport 412×915 CSS** :
- `.steps` : `padding .36rem`, `font-size .83rem`, `margin-bottom .6rem` → **≈ 42 px** ;
- FileQueue plafonnée à 8 lignes ≈ **200 px** ;
- déplacement maximal : **242 px** → distance fraction = 242 / 915 = **0,264** ;
- la scène occupe ~805 px sur 915 → impact fraction ≈ **0,75** ;
- **score = 0,75 × 0,264 = 0,198**.

**Deux fois le budget CLS, sur un seul dépôt, sans exclusion possible.** Même le cas mono-fichier (`.steps` seule, 42 px) donne 0,034 — un tiers du budget consommé par une interaction, alors que le CLS de terrain retient la pire fenêtre glissante de 5 s.

**Gravité : SERIEUX.** Le mécanisme géométrique de D3 (§2.4 couche 1) est par ailleurs correct — voir la section « ce qui tient » — mais il ne couvre pas les insertions *à l'intérieur* de la scène, et le filet censé rattraper ce cas n'existe pas.

**Correctif.**
1. Rendre `.steps` **en SSR dès l'état vide**, dans sa rangée de grille, avec ses trois puces à l'état inactif (ou `visibility:hidden` + hauteur réservée). Sa hauteur ne doit jamais apparaître.
2. Sortir la FileQueue du flux : soit une rangée de grille de hauteur réservée dès l'état vide, soit un panneau à l'intérieur de `.island` dans une zone `max-height` fixe, de sorte que **la boîte de `.island` ne change jamais**.
3. Instrumenter `PerformanceObserver({type:'layout-shift'})` en journalisant `hadRecentInput` sur un **vrai glisser-déposer depuis l'OS** avant de faire confiance à l'exclusion. C'est un test de 10 lignes qui invalide ou confirme la couche 3 de D3.

---

## 6. SERIEUX — LCP/CLS : `max-width: 22ch` sur l'élément LCP + `font-display: swap` = un reflow garanti au swap

**Affirmation attaquée.** R5 §5 : « `font-display: swap` + `<link rel="preload">` sur ces deux fichiers uniquement + Metrics-based fallback (`size-adjust`, `ascent-override`) pour éviter le CLS au swap ». D3 reprend la mesure sans la discuter.

**Pourquoi c'est fragile.** Maquette, lignes 61-64 (MESURÉ) :

```css
h1{font-family:var(--display);font-size:clamp(1.5rem,3.6vw,2.25rem);
   letter-spacing:-.035em;max-width:22ch}
.sub{max-width:40ch}
```

L'unité `ch` est **l'avance du glyphe « 0 » de la police effective**. Georgia (le repli déclaré, ligne 15) et Bricolage Grotesque n'ont pas la même avance de « 0 ». Au swap, `22ch` change de valeur, le `<h1>` **se re-découpe en lignes**, sa boîte change de hauteur, et :

- le `<h1>` est très probablement **l'élément LCP** (la bulle a un `background-color` uni, pas une image de fond — elle n'est pas candidate LCP ; à 412 px de viewport le `clamp` retombe à 1,5 rem, mais le bloc de texte du `<h1>` reste le plus grand candidat texte). Un changement de taille de l'élément LCP **enregistre une nouvelle entrée LCP au moment du swap**, pas au premier paint ;
- `.sub` et `.formats`, en dessous dans la colonne flex, se décalent → **layout shift, plus de 500 ms après la navigation, sans aucune entrée utilisateur : compté intégralement dans le CLS.**

`size-adjust` **atténue** mais n'élimine pas : il est calibré sur la largeur moyenne des glyphes, pas sur l'avance du « 0 » ; `ascent-override`/`descent-override` n'affectent pas `ch` du tout. Et R5 marque lui-même l'`optimizedFallbacks` d'Astro comme non testé.

**Gravité : SERIEUX.** C'est le seul risque LCP *et* CLS non mitigé du plan, et il est mécanique, pas probabiliste.

**Correctif.**
1. **Remplacer `22ch` et `40ch` par des `rem` ou des `px`.** Une largeur de mesure exprimée en unité dépendante de la police sur l'élément LCP est une erreur de conception, indépendamment du budget.
2. **Passer `font-display: swap` → `optional` sur les deux familles, avec preload.** Avec `optional`, soit la police arrive dans la fenêtre de blocage (~100 ms) et est utilisée, soit elle ne l'est pas de cette navigation et reste en cache pour la suivante : **zéro reflow de swap, garanti par la spécification**, pas par la qualité d'un `size-adjust`. Sur un site où l'élément LCP est du texte et où la promesse est la sobriété, c'est le bon compromis.
3. Vérifier expérimentalement le `ch` des deux polices avant de figer quoi que ce soit : `document.createElement('span').style.font` + `measureText('0')`, 5 lignes.

---

## 7. SERIEUX — La clause « hors index et contours » vide le budget de son sens : la charge réelle de première utilisation est de ~940 ko, pas de 150

**Affirmation attaquée.** Contrainte projet : « budget JS total ≤ 150 Ko gzip **hors index de lieux et contours de carte** », et D3 §4.4 : « Les 150 Ko gzip tiennent ».

**Pourquoi c'est fragile.** L'exclusion porte sur des données qui sont malgré tout **téléchargées, décompressées et décodées par le client**. Addition de la charge réelle d'un utilisateur qui dépose un HEIC et cherche une commune (chiffres MESURÉS par D2/R4/R5, sauf HTML/CSS ESTIMÉ) :

| Poste | Octets |
|---|---|
| HTML + CSS (7 blocs de contenu, ESTIMÉ, brotli) | ~20 000 |
| Polices woff2 (incompressibles) | 56 164 |
| JS chemin initial | 3 849 |
| JS chargé au premier dépôt (Leaflet, topojson, client-zip, exifr, piexif, code) | ~96 000 |
| **Index Tier 1** (au focus du champ de recherche) | **189 992** |
| **Index Tier 2 `coord`** (à la première sélection) | **123 115** |
| Contours départements + shard communal | 52 700 |
| **Sous-total sans WASM** | **541 820 (≈ 529 Kio)** |
| Module WASM EXIF (plafond du cahier des charges) | 400 000 |
| **Total** | **941 820 (≈ 920 Kio)** |

Le budget vedette de 150 ko couvre **18 %** de ce qui est réellement transféré. L'index Tier 1 à lui seul, **189 992 o, vaut 1,9 fois l'intégralité du budget JS** — et il est chargé sur une interaction.

Ce n'est pas une accusation de mauvaise foi : la clause d'exclusion est dans le cahier des charges. C'est un constat que **le nombre suivi n'est pas celui auquel LCP et INP répondent**. On peut respecter les 150 ko à la lettre et livrer une page à 940 ko.

Ajoutons une réserve mesurée par D2 §1.1 et jamais provisionnée : **la qualité Brotli servie par Cloudflare est inconnue.** D2 a mesuré q11 = 357 910 o contre q5 = 391 312 o sur l'index, soit **+9,3 % (≈ +33 ko) si le CDN compresse à la volée en qualité moyenne**. R5 a confirmé que Cloudflare négocie `br` mais pas à quelle qualité, et n'a pas pu vérifier si un `.br` pré-compressé est servi (page de doc en 404).

**Gravité : SERIEUX.**

**Correctif.**
1. **Ajouter deux budgets contrôlés au build, à côté du budget JS** : (a) « transfert de première utilisation ≤ X ko », mesuré sur le scénario dépôt + recherche ; (b) « travail thread principal sur le chemin dépôt → prêt ≤ Y ms », mesuré sous ralentissement CPU ×4. Ce sont les deux grandeurs auxquelles LCP et INP répondent ; le budget JS n'en est qu'un proxy partiel.
2. **Étendre le sous-ensemble chaud inliné.** D2 a mesuré que 300 communes = 4 200 o couvrent 33,2 % de la population, et **2 000 communes = 24 770 o couvrent 61,3 %**. Inliner 2 000 au lieu de 300 diffère **165 ko pour 61 % des requêtes** et supprime l'INP de l'objection n°4 dans la majorité des cas. C'est le meilleur rapport coût/bénéfice de tout le lot B.
3. Vérifier la qualité Brotli servie dès le premier déploiement (`curl -H 'Accept-Encoding: br' -sI`, comparer `content-length` à la mesure q11 locale) et provisionner +9,3 % tant que ce n'est pas fait.

---

# Ce qui tient — et c'est une information utile

Trois décisions que j'ai attaquées et qui résistent :

**1. Leaflet plutôt que MapLibre : décision correcte, et pour la bonne raison.** MapLibre GL 6 à **280 431 o gzip** (MESURÉ deux fois, R2 et R4 concordants) consomme 183 % du budget total avant la première ligne applicative. Le chiffre tranche seul. Mon objection n°2 va *plus loin* dans la même direction (supprimer aussi Leaflet), elle ne l'infirme pas. Et le refus de prendre MapLibre « au cas où PMTiles » est justifié : R4 a raison, une bascule PMTiles fait exploser le budget quel que soit le moteur, donc ce n'est pas un critère de choix aujourd'hui.

**2. Les trois familles de polices : le problème posé n'existe plus, R5 l'a déjà réglé.** La question porte sur trois familles ; R5 a supprimé Outfit et retenu Bricolage Grotesque Variable (axe `wght`, 41 344 o) + DM Mono 400 (14 820 o) = **56 164 o MESURÉ**, incompressibles (woff2 embarque déjà Brotli : gzip −0,5 %). Sur le profil Lighthouse mobile (200 ko/s), avec preload et une connexion déjà chaude, cela représente ≈ 280 ms de transfert et une arrivée vers ~950 ms — **le poids des polices n'est pas la menace sur le LCP de 2,5 s.** La menace est le mécanisme de swap (objection n°6), pas les octets. Deux réserves à consigner malgré tout : (a) la maquette charge encore 3 familles depuis `fonts.googleapis.com` avec deux `preconnect` (lignes 8-10) — le `guard-third-party` de R5 l'attrapera, mais quelqu'un copiera ce `<head>` ; (b) Bricolage Grotesque en corps de texte est un choix **typographique**, pas seulement budgétaire, puisque la maquette utilise Outfit partout (`--sans`) — à acter comme décision, sinon Outfit reviendra à l'implémentation.

**3. La géométrie anti-CLS de `.stage` est solide.** J'ai vérifié le raisonnement de D3 §2.4 couche 1 : `.app{min-height:100svh;display:flex}` fixe une hauteur définie, `.stage{flex:1 1 auto;min-height:0}` la reçoit, et une piste `grid-template-rows:1fr` d'un conteneur à hauteur définie est dimensionnée par le conteneur, jamais par son contenu. Le `min-height:0` — que D3 souligne à juste titre — est ce qui empêche la taille minimale automatique de faire remonter le contenu, et c'est l'erreur classique. Le choix de `svh` plutôt que `dvh` ou `vh` est également correct et pour la bonne raison. **Ce mécanisme n'est pas ce qui casse le CLS ; ce qui le casse, ce sont les insertions à l'intérieur de la scène (objection n°5) et le swap de police (objection n°6).**

---

# Réponses directes aux trois questions posées

**« Le budget tient-il vraiment une fois tout additionné ? »** — Oui, mais pas avec la marge annoncée. Honnêtement compté, **118 402 o en central et 139 347 o en pessimiste** (77 % et 91 %), et non 100 478 / 113 389. Un dépassement de 1,5× du volume de code — routine sur du parsing binaire — met à **168 615 o, soit 10 % au-dessus**. La phrase « aucun arbitrage n'est nécessaire » est fausse et dangereuse. Supprimer Leaflet ramène à 49 % / 64 %, et c'est le seul arbitrage qui rend le budget robuste plutôt que juste.

**« Un LCP de 2,5 s est-il atteignable avec les polices et les blobs ? »** — Les polices ne sont pas le problème (2 familles, 56 ko, ~280 ms). Le problème est double : le pipeline de flou retarde la première peinture et sature ensuite le thread principal en permanence, et **`max-width: 22ch` sur l'élément LCP avec `font-display: swap` produit une seconde entrée LCP au swap**. Avec les correctifs 1 et 6, oui, largement. Sans, le LCP sera mesuré au swap de police et non au premier paint, et rien ne garantit qu'il tienne.

**« Le flou de 70 px sur trois formes de la taille du viewport est-il tenable ? »** — Le flou lui-même serait tenable s'il était statique : une seule rastérisation, mise en cache par le compositeur. **Ce qui n'est pas tenable, c'est que les keyframes animent `border-radius`**, propriété non compositable, ce qui invalide le paint à chaque image et interdit toute mise en cache du flou, sur 4 éléments simultanés, en boucle infinie, sur toutes les pages, plus jusqu'à 6 `backdrop-filter` recalculés par-dessus un fond mobile. Ce n'est pas une question de puissance GPU, c'est une erreur de catégorie de propriété. **La réponse est non en l'état, et oui à coût nul avec trois `radial-gradient` statiques et un panneau de couleur solide** — correctif qui résout par la même occasion le « contraste non déterministe » que D3 documente comme son point d'attention structurel.