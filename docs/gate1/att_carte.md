# CONTRADICTION — Fond de carte niveau 0/1, budget contours, cohérence avec le centroïde

**Méthode.** Les distances `centre`↔`mairie` (§4) sont **MESURÉES** dans cette session (60 communes tirées au sort, geo.api.gouv.fr, 27/07/2026). Les `Content-Length` des fichiers de contours et la description du jeu de données data.gouv sont **MESURÉS/DOCUMENTÉS** aujourd'hui. Les résolutions, couvertures d'écran et probabilités sont **ESTIMÉES**, calcul montré, à partir de la formule Web Mercator dérivée ci-dessous.

**Base de calcul commune.** Circonférence équatoriale WGS84 = 2π × 6 378 137 = 40 075 016,686 m. À un zoom `z`, le monde fait 256 × 2^z px CSS, donc la résolution à la latitude φ vaut `156 543,034 × cos φ / 2^z`. À φ = 46,5° (France métropolitaine médiane), cos φ = 0,68835 → **r(z) = 107 753 / 2^z m/px**.

| z | 12 | 13 | **14 (maxZoom retenu)** | 16 | 17 |
|---|---|---|---|---|---|
| m/px | 26,31 | 13,15 | **6,58** | 1,64 | 0,82 |

Écran de référence : téléphone 360 px CSS de large (D3 empile carte et panneau sous 920 px), donc **2 369 m de champ à z14**, demi-écran = 1 184 m.

---

## 1. BLOQUANT — Le geste « affiner sur la carte » est géométriquement impossible. Aucun niveau de zoom entier ne le permet.

**Affirmation attaquée.** D2 §2.7 : « Clic pour placer — `map.on('click', e => emit(e.latlng))` — natif ». D3 §2.2, texte affiché sous la carte : « Cliquez sur la carte, ou faites glisser le repère ». Le parcours produit est : chercher une commune → repère posé sur le centroïde → affiner.

**Pourquoi c'est faux.** Le geste exige deux conditions **simultanées** sur la résolution `r` :

- **Voir l'erreur à corriger.** Le repère est posé au centroïde. Distance moyenne d'un point tiré au hasard au centre d'un carré de côté `a` = 0,38260·a (constante exacte : (1/6)[√2 + ln(1+√2)]). Commune moyenne = 551 695 / 34 875 = **15,82 km²** → côté équivalent 3,977 km → **erreur moyenne 1 522 m**. Pour que le point de départ et la cible tiennent dans le demi-écran (180 px) : `r ≥ 1522/180 = 8,46 m/px`.
- **Pouvoir viser.** Même avec une exigence très lâche — 10 m de précision pour 1 px de prise — il faut `r ≤ 10 m/px`.

Fenêtre utilisable : `r ∈ [8,46 ; 10]`, soit **z ∈ [13,40 ; 13,64]**. Leaflet est en `zoomSnap: 1` par défaut. **z13 donne 13,15 m/px (hors fenêtre par le haut), z14 donne 6,58 m/px (hors fenêtre par le bas). Aucun zoom entier ne satisfait les deux conditions.** À z13 le jardin fait 1,1 px ; à z14 le centroïde est à 231 px, hors écran.

Et cela avant le doigt : la cible tactile minimale normalisée est 44 × 44 px CSS. À z14, **le doigt occulte un disque de 290 m de diamètre** ; à z12, **1 158 m**. L'utilisateur ne voit pas ce qu'il vise.

**Gravité : BLOQUANT.** Ce n'est pas un réglage à ajuster, c'est une contradiction arithmétique dans le parcours principal.

**Correctif.**
1. **Supprimer le clic-pour-placer et le glisser** en dessous d'un seuil de zoom où un repère existe (soit : partout, tant qu'il n'y a pas de fond de carte). Ne garder que le déplacement fin au clavier/boutons, avec un pas déclaré en mètres.
2. **Ne jamais déplacer un repère existant.** Si la photo a déjà une position, la sélection d'une commune ne doit pas écraser la position lue — proposer « remplacer » comme action explicite, jamais comme effet de bord.
3. **Déclarer l'imprécision dans le fichier.** D1 §3.1 spécifie déjà `GPSHPositioningError` (0x001F, RATIONAL64U). Personne ne l'a relié à la carte. Quand la position vient d'une commune, écrire `round(√(surface/π))` en mètres — geo.api renvoie déjà `surface` (en hectares). Sarlat : 4 859 ha → 3 933 m. Commune moyenne → 2 244 m. C'est la seule façon honnête de livrer une position de qualité communale sans mentir sur sa précision.

---

## 2. BLOQUANT — Le niveau 0 est un écran blanc dans 94 % des cas à z14 ; et augmenter la résolution ne corrige rien, parce que l'échec est catégoriel.

**Affirmation attaquée.** R4 : « le niveau 0 seul ne permet pas à un utilisateur de placer un repère sur sa maison » — puis conclut au niveau 1 comme si le problème était réglé. D2 reprend : « Le niveau 1 permet de *reconnaître sa commune*, ce qui est différent et suffisant ».

**Chiffres.** Modèle : point au centre de l'écran, frontières traitées comme les côtés d'un carré d'aire équivalente ; probabilité qu'une frontière soit à moins d'un demi-écran.

| | Département (5 747 km², côté 75,8 km) | Commune (15,82 km², côté 3,98 km) |
|---|---|---|
| Distance moyenne à la frontière la plus proche | **12,6 km** = 1 916 px à z14 | **663 m** = 101 px à z14 |
| Probabilité qu'une ligne soit à l'écran à **z12** (vue par défaut) | **23 %** | ~100 % |
| Probabilité qu'une ligne soit à l'écran à **z14** | **6 %** | 84 % |

Donc, **niveau 0 sur téléphone : écran totalement vide 77 % du temps au zoom par défaut, 94 % au zoom maximal.** Le marqueur flotte sur du blanc.

Le niveau 1 remplit l'écran — et n'apporte rien. Une limite communale est une abstraction juridique invisible au sol. Elle ne dit pas où est la rue, le toit, la haie. Elle est en moyenne à 663 m du jardin : trop loin pour servir de repère, trop près pour situer.

**Et la résolution n'est pas le problème.** J'ai vérifié les tailles réelles aujourd'hui (`Content-Length`, HTTP 200) : `communes-1000m.geojson` = 10 039 047 o, `communes-100m` = 32 511 174 o (×3,24), `communes-5m` = 292 360 530 o (×29,1). En appliquant le ratio brotli mesuré par R4 sur le fichier 1000m, **ESTIMÉ** :

| Niveau | Shard médian | Shard max | Corpus total |
|---|---|---|---|
| 1000m (retenu) | 9,8 Ko | 24,6 Ko | 1 084 Ko |
| 100m | ~32 Ko | ~80 Ko | ~3,5 Mo |
| 5m | ~285 Ko | ~717 Ko | ~31,6 Mo |

Le niveau 100m tient dans n'importe quel budget raisonnable **par vue**. On peut donc s'offrir des contours géométriquement fidèles — et l'utilisateur verra toujours un écran sans rue, sans bâtiment, sans repère. **Le défaut n'est pas paramétrique, il est catégoriel : les contours administratifs ne contiennent aucune information à l'échelle où le produit prétend opérer.**

Correction factuelle au passage : R4 estime un PMTiles France « 0,5 à 1,5 Go » et en déduit que l'alternative est hors de portée. C'était pour un fond Protomaps (routes, bâtiments). **data.gouv publie déjà, automatiquement, un PMTiles des contours communaux 5m : 35 340 043 o (MESURÉ dans la métadonnée du jeu de données), soit 33,7 MiB.** C'est 1,35× la limite de 25 MiB par actif de Cloudflare Pages — donc R2 requis — mais ce n'est pas un gigaoctet. Cela ne sauve pas le niveau 1 pour autant : c'est le même vide, en plus précis.

**Gravité : BLOQUANT** pour le cas d'usage « ajouter une position ». **MINEUR** pour « supprimer une position », où la carte n'a qu'à montrer « on sait où vous étiez ».

**Correctif.**
1. **Cesser de traiter la carte comme un composant du chemin critique.** Elle sert à *situer*, à z5–z11, où elle est réellement informative. Verrouiller `maxZoom` à **11 ou 12**, pas 14 : au-delà, la carte ne fait qu'inviter à un geste qu'elle ne peut pas soutenir.
2. **Réécrire la page 4 (`/modifier-localisation-photo/`) autour de la saisie de coordonnées et du collage depuis une carte tierce** (« ouvrez Google Maps ou l'IGN, clic droit, collez ici »). C'est ce que fait déjà `kontakts.pro` (relevé par R7) et c'est honnête : on n'a pas de fond de carte, on l'assume et on outille le contournement.
3. Si la précision métrique devient une exigence, l'instruire comme un projet distinct avec son propre budget — pas comme un « niveau 2 » du même lot.

---

## 3. BLOQUANT — Le plan expédie simultanément la promesse et son démenti.

**Affirmations attaquées, toutes du même corpus.**
- D3 §2.2, texte affiché à l'utilisateur : « **Cliquez sur la carte, ou faites glisser le repère** ».
- D3 §5.3 : « Le libellé sous la carte le dit franchement : « **Repère placé sur Avignon** » — et non « Placez votre repère ». »
- D2 §2.3, titre de section : « Niveau retenu : niveau 1, et **la carte n'est pas un viseur** ».
- R4 : « il faut **arrêter de vendre la carte comme un outil de placement précis** ».

**Pourquoi c'est grave.** D3 contient les deux textes, à trois sections d'écart. Et D2 §2.7 câble le gestionnaire `map.on('click')` qui rend la promesse opérante. Ce n'est pas une divergence de rédaction : **le code livre le geste, la spécification dit que le geste ne marche pas, et l'UI l'annonce quand même.** C'est exactement le reproche que R7 adresse aux 20 concurrents audités — promettre ce que la technique ne tient pas — sur un produit dont le seul avantage défendable est la véracité vérifiable.

**Gravité : BLOQUANT.** Pas techniquement, éditorialement. Un utilisateur qui clique et constate que rien ne l'aide à viser conclut que l'outil est bâclé, et il a raison.

**Correctif.** Choisir, et propager la décision dans les trois documents et dans `guard-plain-language` : soit la carte est un viseur et il faut un fond de carte, soit elle ne l'est pas et **le mot « cliquez » disparaît du parcours**. Texte de remplacement : « Repère placé au centre de la commune d'Avignon. Pour une position exacte, saisissez les coordonnées ci-dessous. »

---

## 4. SERIEUX — Le point de départ est faux de 792 m en médiane, gratuitement : le plan utilise le centroïde alors que la position de la mairie est dans la même API.

**Affirmation attaquée.** R3 §1 : « geo.api le fournit déjà pour 34 969/34 969 communes (100 %) » à propos de `centre`. D2 stocke la colonne `coord` = ce `centre`. Aucun des sept rapports ne mentionne l'existence d'une autre géométrie.

**Ce que dit la source (DOCUMENTÉ, lu aujourd'hui sur `geo.api.gouv.fr/decoupage-administratif/communes`), verbatim :**

> « Le format GeoJSON implique de choisir une géométrie principale. Par défaut il s'agit du centre. Cela peut être changé en ajoutant le paramètre `geometry=contour`. **Il est aussi possible de retourner la mairie avec `geometry=mairie`** et le rectangle de l'étendue de la commune avec `geometry=bbox` »

Et la description du jeu de données data.gouv, verbatim : « la position des mairies est issue du produit d'AdminExpress de l'IGN ».

**Mesure faite dans cette session.** Distance haversine entre `centre` et `mairie`, échantillon **aléatoire de 60 communes** (seed 20260727) :

| médiane | moyenne | p90 | max | > 500 m | > 1 km |
|---|---|---|---|---|---|
| **792 m** | 965 m | 1 744 m | 3 936 m | **75 %** | **40 %** |

Sur un échantillon dirigé de grandes communes : Sarlat 2 260 m, Gap 2 744 m, Marseille 2 002 m, Chamonix 4 672 m, La Teste-de-Buch 5 659 m.

**Pourquoi ça compte.** La mairie est dans le bourg, là où les gens habitent et prennent leurs photos. Le centroïde est un barycentre géométrique qui, dans une commune forestière, littorale ou montagnarde, tombe dans un bois, dans l'eau ou sur un glacier. Le produit n'a **qu'un seul** mécanisme de précision (la recherche de commune) et il le dégrade de 792 m en médiane pour rien.

**Gravité : SERIEUX.** Correctif à coût nul qui améliore le seul chemin de précision existant.

**Correctif.**
1. Basculer la colonne `coord` de l'index sur `geometry=mairie`, en conservant `centre` **uniquement** pour cadrer la vue (`fitBounds` sur `geometry=bbox` serait encore mieux : recentrer sur le bourg mais cadrer sur la commune).
2. Vérifier la couverture : la description data.gouv indique que pour les COM, faute de position de mairie, « utilisation du centroïde à la place ». Compter les communes sans mairie avant de figer le pipeline. **NON VÉRIFIÉ.**
3. Ajouter `surface` à l'index (colonne `u8` logarithmique, ~26 Ko brotli comme `pop`) pour alimenter le `GPSHPositioningError` de l'objection 1.

---

## 5. SERIEUX — Le budget de 250 Ko Brotli n'existe pas. Il a été inventé par R4 et repris par D2 comme une contrainte du projet.

**Affirmations attaquées.** R4 : « **Total ~53 KB brotli au pire, contre 250 KB autorisés.** Il reste 80 % de marge. » D2 §2.3 : « Pire cas simultané — **52,7 Ko sur 250 Ko autorisés** — Marge conservée : ~79 %. »

**Pourquoi c'est faux.** La contrainte du projet, littéralement : « budget JS total ≤ 150 Ko gzip **hors index de lieux et contours de carte**, budget WASM ≤ 400 Ko ». Les contours sont **exclus** du budget, ce qui veut dire **non budgétés**, pas « budgétés à 250 Ko ». Aucune source ne contient ce nombre. Il est apparu dans R4, a été repris tel quel par D2, et produit une « marge de 79 % » sur un dénominateur fictif — exactement le mécanisme qui fait passer une décision non instruite pour une décision validée.

**Deuxième fragilité, mesurable.** Toutes les tailles de contours sont des brotli q11 calculés localement avec `node:zlib`. Or R5 a mesuré que Cloudflare **ne sert pas toujours brotli** (`astro.build` renvoie `gzip` malgré `Accept-Encoding: br`, et rien du tout avec `br` seul), et D2 a mesuré +9,3 % entre q11 et q5 sur l'index. R4 a mesuré, sur le même fichier, gzip 97,2 Ko contre brotli 58,3 Ko, soit **×1,667**. Si Cloudflare sert gzip, le « pire cas 52,7 Ko » devient **88 Ko** — et 170 Ko avec le correctif de l'objection 7.

Aggravant, sur le vrai budget qui existe, lui : Leaflet 42 706 + topojson-client 2 587 = **45 293 o gzip, soit 45 % des 100 478 o que D3 prévoit d'expédier**. Près de la moitié du JS livré sert un widget dont D2 désactive le clavier natif (`keyboard:false`), réécrit le déplacement du repère (~40 lignes) et remplace les boutons de zoom. L'argument d'accessibilité qui a justifié Leaflet contre MapLibre est en grande partie vidé par la conception elle-même.

**Gravité : SERIEUX.**

**Correctif.**
1. **Fixer un budget contours réel et opposable dans `src/lib/core/budget.json`**, en octets, contrôlé par `guard-js-budget`. Proposition défendable : 120 Ko pour ce qui est chargé simultanément dans une vue, 1,5 Mo pour le corpus total précaché.
2. **Mesurer ce que Cloudflare sert réellement**, sur le domaine du projet, et budgéter dans cette unité : `curl -H 'Accept-Encoding: br,gzip' -sI` puis comparer `content-length` à la taille q11 locale. C'est le contrôle L de D4, à étendre aux fichiers de données.
3. Avant de figer Leaflet, prototyper un rendu SVG/Canvas maison (projection Mercator = 10 lignes, rendu de polygones + pan/zoom ≈ 350 lignes ≈ 4 Ko gzip d'après le calibrage de D3) et **mesurer**. Un gain potentiel de ~42 Ko gzip, soit 27 % du budget total, mérite une demi-journée.

---

## 6. SERIEUX — « PWA offline complète » est incompatible avec le chargement paresseux des shards. L'une des deux promesses est fausse.

**Affirmations attaquées.** Contrainte du projet : « **PWA offline complète** ». R5 §4, stratégie de cache : « Shards d'index de communes — cache-first, **à la demande** — ne précacher que ceux réellement demandés » ; « Contours de carte — **idem shards** ». R4 : « 101 shards, somme totale 1 083,6 Ko, mais **on n'en charge qu'un seul à la fois** ».

**Pourquoi c'est contradictoire.** Hors ligne, le service worker ne peut servir que ce qu'il a déjà. Un utilisateur qui installe l'application chez lui puis l'ouvre en vacances, sans réseau, obtient : une carte vide (shard du département absent) et une recherche de commune muette (morceaux d'index absents). Ce n'est pas « offline complet », c'est « offline pour ce que vous avez déjà consulté ».

**Le coût de tenir la promesse, chiffré :** 1 083,6 Ko (contours communaux) + 28,1 Ko (départements) + 349,4 Ko (index, D2) = **1 461 Ko brotli**, soit ~2,4 Mo si Cloudflare sert gzip. Sur un outil dont l'argument est la sobriété, précacher 1,4 Mo à la première visite est un choix lourd — et il faut le décider, pas le subir.

**Gravité : SERIEUX.** Une promesse invérifiable détruit la crédibilité des autres, qui sont, elles, vérifiables.

**Correctif.** Trois options, à trancher explicitement dans `DECISIONS.md` :
- **A.** Reformuler la contrainte : « l'outil fonctionne intégralement hors ligne ; la carte et la recherche se limitent aux zones déjà consultées », **et le dire dans l'UI** au moment du basculement hors ligne, pas dans une note de bas de page.
- **B.** Précacher l'index complet (349,4 Ko) mais pas les contours, et supprimer la carte en mode hors ligne. Cohérent avec l'objection 2 : l'index est le vrai mécanisme de précision, la carte est décorative.
- **C.** Précacher les 1,43 Mo, sur action explicite de l'utilisateur (« Télécharger les données pour l'usage hors ligne — 1,4 Mo »). C'est l'option la plus honnête, et elle est mesurable.

---

## 7. SERIEUX — Un seul shard départemental : la carte a un trou visible pour environ une position sur quatre, et le « pire cas » annoncé est faux d'un facteur 2.

**Affirmation attaquée.** D2 §2.8, contrat d'interface : `fetchContours: (depCode: string) => Promise<GeoJSON>` — **un seul code département**. D2 §2.3 : « Contours communaux, **shard du département visé** — pire cas simultané 52,7 Ko ».

**Pourquoi c'est faux.** Le viewport ne s'arrête pas à la frontière départementale. À z12, il fait 9,47 km de large ; la fraction du territoire d'un département située à moins d'un demi-écran (4,74 km) de sa frontière vaut `1 − ((75,8 − 9,47)/75,8)² = 23,4 %`. **Environ une photo française sur quatre affichera donc une carte dont une partie est vide** — des communes dessinées d'un côté de la ligne, rien de l'autre. Et c'est un artefact visible exactement là où l'œil cherche un repère.

Le pire cas réel n'est pas 1 shard mais 3 (un tripoint départemental, cas fréquent) : `28,1 + 3 × 24,6 = 101,9 Ko` brotli, soit **1,93× la valeur annoncée**, et **170 Ko** si Cloudflare sert gzip (objection 5).

**Gravité : SERIEUX.**

**Correctif.**
1. Changer la signature : `fetchContours: (depCodes: string[]) => Promise<GeoJSON[]>`, et charger tous les départements intersectant le viewport plus une marge d'un demi-écran.
2. Précalculer au build une **table d'adjacence départementale** (~100 lignes, quelques centaines d'octets) pour anticiper le chargement au panoramique.
3. Recalculer le budget de l'objection 5 sur le pire cas à 3 shards, pas à 1.

---

## 8. MINEUR — Le contour dessiné peut être à 150 px de sa vraie place au zoom maximal, ce qui compromet la seule fonction restante de la carte : vérifier.

**Affirmation attaquée.** D2 §2.4 : « elle part du niveau **1000m** déjà généralisé publié par data.gouv, ce qui évite d'avoir à régler un seuil. »

**Ce que dit la source (DOCUMENTÉ, lu aujourd'hui), verbatim :**

> « Si vous avez des besoins **avec peu de précision** (déterminer des points dans des contours, etc.), il est possible d'utiliser des données fortement généralisées […] Si vous avez des besoins **avec beaucoup de précision**, il est recommandé d'utiliser des fichiers avec une faible généralisation. Les niveaux de généralisation disponibles sont : **1000m (moins précis)**, 100m, 50m, **5m (plus précis)** »

Le plan retient le niveau explicitement documenté comme le moins précis, pour un **affichage au zoom maximal** — l'inverse de la recommandation de l'éditeur.

**Ordre de grandeur.** Si « 1000m » désigne une tolérance de 1 000 m, l'écart entre le trait dessiné et la limite réelle atteint **152 px à z14**, soit 42 % de la largeur d'un écran de téléphone. Même à un dixième de la tolérance, c'est 15 px. Conséquence concrète : une photo prise à 300 m à l'intérieur de la commune A peut apparaître, sur le tracé, à l'intérieur de la commune B — pendant que le libellé, lui, affiche correctement « commune A » (il vient de l'index, pas du polygone). **L'outil se contredit lui-même à l'écran**, et c'est le genre de détail qu'un utilisateur repère et retient.

Sémantique exacte du suffixe : **NON VÉRIFIÉ** — la description ne dit pas quelle métrique il recouvre. R4 a mesuré, sur les départements simplifiés, une longueur médiane de segment passant de 265 m à 2 752 m et un écart estimé de 100 à 700 m.

**Gravité : MINEUR** si `maxZoom` descend à 11–12 comme proposé en objection 2 ; **SERIEUX** si `maxZoom` reste à 14.

**Correctif.**
1. Mesurer réellement l'écart : télécharger `communes-1000m` et `communes-5m` pour deux départements contrastés (62, plat et découpé ; 04, montagneux), calculer la distance de Hausdorff par commune, et en déduire le zoom au-delà duquel l'erreur dépasse 2 px.
2. Poser ce zoom comme `maxZoom` réel, ou basculer sur `communes-100m` pour le seul shard affiché (~32 Ko brotli médian, ~80 Ko max — abordable, cf. objection 2).
3. Ne jamais laisser cohabiter un libellé issu de l'index et un polygone qui le dément : si le point tombe hors du polygone dessiné, ne pas dessiner le polygone.

---

## Ce qui tient, après examen

Il faut le dire, parce que c'est une information utile et que je n'ai rien trouvé pour l'attaquer :

- **Leaflet contre MapLibre est tranché correctement, et par le chiffre.** 42 706 o contre 280 431 o gzip (R2 et R4 concordent à 0,8 % près). MapLibre consomme 183 % du budget JS total à lui seul. Le débat est clos, quel que soit le sort de la carte.
- **Le rejet de `france-geojson` est solide.** Millésime 2018 contre un index de lieux au COG 2026 : on aurait produit des communes sans contour et des contours orphelins. Le choix de `contours-administratifs` 2025 est le bon, et j'ai reconfirmé aujourd'hui sa licence `odc-odbl` et sa fréquence annuelle.
- **Le refus de PMTiles en v1 est solide**, même si la justification chiffrée était fausse (35,3 Mo pour les contours 5m, pas 0,5–1,5 Go — le vrai obstacle est la limite de 25 MiB par actif de Cloudflare Pages, qui impose R2, plus le coût JS du moteur de rendu).
- **Le sharding par département est le bon principe**, même s'il faut en charger plusieurs (objection 7). Le déséquilibre est faible et la médiane à 9,8 Ko est excellente.
- **Le diagnostic de R4 sur le niveau 0 était juste et courageux** (« l'utilisateur voit un écran vide »). Mon désaccord ne porte pas sur ce constat mais sur la conclusion : le niveau 1 a été adopté comme s'il levait l'objection, alors qu'il ne fait que remplir l'écran sans le rendre informatif.

---

## Ce qu'il faudrait vérifier avant de figer quoi que ce soit

| Point | Comment |
|---|---|
| Couverture de `geometry=mairie` (communes sans mairie, COM) | Compter sur le dump complet ; la description data.gouv annonce un repli sur le centroïde pour les COM |
| Sémantique exacte du suffixe « 1000m » | Hausdorff `communes-1000m` vs `communes-5m` sur 2 départements |
| Compression réellement servie par Cloudflare sur `.geojson`/`.json` | `curl -H 'Accept-Encoding: br,gzip' -sI` après déploiement |
| Ratio brotli des shards à 100m (mes ×3,24 sont ESTIMÉS) | Télécharger `communes-100m`, sharder, mesurer |
| Hauteur réelle disponible pour le panneau sur un 375×667 (D3 impose `min-height: 400px` à la carte) | Rendu réel, pas calcul |