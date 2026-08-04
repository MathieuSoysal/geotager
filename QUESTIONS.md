# QUESTIONS.md

Registre des points non tranchés. Règle du projet : **un agent qui rencontre une ambiguïté, une
contrainte contradictoire ou une décision non couverte par le cahier des charges ne tranche pas.**
Il écrit une entrée ici, implémente le comportement le plus conservateur, et poursuit.

Règle ajoutée au Gate 1 : **toute divergence avec une contrainte nommée du cahier des charges ouvre
une entrée, même quand la divergence est manifestement justifiée.** C'est ce qui empêche le périmètre
de dériver par accumulation de bonnes décisions isolées.

État au 27 juillet 2026 — toutes ces entrées sont ouvertes par le Gate 1, aucune n'est validée.

---

## [GATE1] Q-001 — L'IPTC ne porte pas de coordonnées

**Contexte :** le §4 du cahier des charges exige d'écrire la position « dans EXIF, XMP et IPTC
simultanément » et de la retirer des trois. Or l'IPTC IIM **n'a pas de champ de latitude ni de
longitude**. Le seul équivalent est `Iptc4xmpExt:LocationCreated`, qui vit dans le XMP, et dont
ExifTool documente que *« the GPS elements of this structure are in the "exif" namespace »*
(source : `XMP2.pl` l. 332). L'exigence est donc techniquement infondée telle qu'elle est écrite.

**Options :**
- **A.** EXIF + XMP seulement. Deux copies à écrire, deux à purger. Aucune perte de lisibilité pour
  les lecteurs réels (Google Photos lit le XMP, les visionneuses système lisent l'EXIF).
- **B.** EXIF + XMP + `Iptc4xmpExt:LocationCreated`. Crée une **troisième** copie des coordonnées,
  donc un troisième endroit à ne pas oublier de purger. Exige une purge XMP consciente des espaces
  de noms, testée sur les quatre sérialisations RDF/XML (attribut, élément,
  `rdf:parseType="Resource"`, `rdf:Bag`) — un remplacement d'attributs par des espaces ne suffit pas.
- **C.** EXIF seulement. Écarté : laisser `exif:GPSLatitude` dans le XMP après avoir effacé le GPS
  IFD est une fuite de vie privée.

**Retenu provisoirement :** **A**, parce que c'est le moins engageant et que la suppression — le cas
d'usage n°1 — est d'autant plus fiable qu'il y a moins d'endroits où oublier une copie. En
suppression, on purge malgré tout `Iptc4xmpExt:LocationCreated` s'il est **déjà présent** dans le
fichier.

**Bloque :** non.

---

## [GATE1] Q-002 — Que fait-on si l'écriture HEIC n'est pas atteignable ?

**Contexte :** le HEIC est le format par défaut de tout iPhone depuis iOS 11, et `iphone` est le
modificateur d'appareil dominant dans les suggestions Google mesurées. La voie JS **ne sait pas
écrire dans un ISOBMFF** (mesuré : aucune bibliothèque MIT/BSD/Apache ne le fait). La voie Rust le
peut en principe, mais dépend d'un budget WASM non encore mesuré. Sans écriture HEIC, « modifier »
devient « nous créons un second fichier, gardez-les ensemble » — ce qui confie à l'utilisateur une
tâche de gestion de fichiers que l'outil devait lui épargner. **C'est la question qui décide si le
produit vaut la peine d'être construit, et elle doit être posée avant le spike, pas après.**

**Options :**
- **A.** On construit quand même, compagnon `.xmp` assumé et annoncé **dès la page d'accueil**.
  Risque : perçu comme un demi-produit sur le format le plus courant.
- **B.** v1 restreinte à JPEG + PNG. Le tableau des formats affiche « HEIC : lecture et suppression
  uniquement ». La suppression HEIC reste possible par P1 (édition sur place), qui ne dépend d'aucun
  écrivain de format.
- **C.** On ne construit pas.

**Retenu provisoirement :** **B**, parce que c'est la seule option qui ne promet rien qu'on ne
tienne. La suppression — le cas d'usage n°1 — reste intégralement couverte sur HEIC.

**TRANCHÉ le 27/07/2026 — par la mesure, et le spike Rust n'a plus d'objet.**

La prémisse « la voie JS ne sait pas écrire dans un ISOBMFF » était exacte mais mal employée : elle
conclut qu'on ne sait pas **réécrire** un conteneur, et on en avait déduit qu'on ne sait pas y
**ajouter**. Or l'astuce qui a rendu P2 sûr sur TIFF s'applique ici — on n'agrandit rien sur place.
Le nouveau bloc va dans une boîte `mdat` ajoutée **en fin de fichier**, et la seule entrée d'`iloc`
qui concerne l'item de position est repointée. Aucun autre décalage ne devient faux puisque aucun
autre octet ne bouge ; l'ancien contenu devient de l'espace mort, exactement comme l'ancien IFD0.

**Éprouvé avant d'écrire une ligne de produit**, par fabrication manuelle sur quatre photos réelles —
`iphone.heic`, `iphone-sans-lieu.heic`, `photo.avif`, `bloc-en-queue.heif` :

| Oracle | Verdict |
|---|---|
| `exiftool -GPSLatitude -GPSLongitude` | relit exactement la position écrite, à sa nouvelle place |
| `exiftool -validate -warning -a` | `Validate : OK` sur les quatre |
| `heif-info` / `heif-convert` (libheif 1.17) | décode encore, HEIC **et** AVIF |
| Chromium, `createImageBitmap` | décode l'AVIF repointé, 400×300, comme l'original |

Relevé au passage sur les six fichiers du corpus : `offset_size = 4`, `length_size = 4`,
`base_offset_size = 0`, aucun octet après la dernière boîte. Les cinq refus du code portent
précisément sur ces suppositions-là, pour qu'aucune ne soit tacite.

Ce que la voie ne sait toujours pas faire : donner un lieu à un fichier qui n'a **aucun** item de
position — il faudrait agrandir la table des items, donc décaler tout ce qui suit. Refusé
explicitement, et annoncé avant l'action.

**Bloque :** plus rien. Le spike Rust/WASM n'est pas lancé, et Q-018 (compiler le WASM ailleurs que
chez Cloudflare) devient sans objet tant qu'aucune autre raison ne le ressuscite.

---

## [GATE1] Q-003 — La carte n'est pas un viseur

**Contexte :** le §4 prévoit « clic pour placer, repère déplaçable ». Le calcul montre que le geste
exige `r ∈ [8,46 ; 10]` m/px simultanément (voir l'erreur du centroïde **et** pouvoir viser), soit
`z ∈ [13,40 ; 13,64]`. Les zooms entiers donnent 13,15 et 6,58 m/px : **aucun ne convient**. Sans
tuiles, l'écran est de surcroît vide 77 % du temps au zoom par défaut et 94 % au zoom maximal. Le
mockup et la conception se contredisent déjà entre eux : « Cliquez sur la carte » d'un côté,
« la carte n'est pas un viseur » de l'autre.

**Options :**
- **A.** La carte **situe et vérifie**. `maxZoom = 11`, le mot « cliquez » disparaît, la précision
  passe par la recherche de commune et le collage de coordonnées. L'imprécision est inscrite dans le
  fichier via `GPSHPositioningError`.
- **B.** On garde le clic-pour-placer en sachant qu'il ne peut pas fonctionner. Écarté : c'est
  exactement le reproche adressé aux 20 concurrents audités, sur un produit dont le seul avantage
  défendable est la véracité vérifiable.
- **C.** On ajoute un fond de tuiles. Viole la contrainte « zéro requête tierce » (niveau 2, sur
  activation explicite seulement) ou impose PMTiles sur R2 (hors périmètre v1).

**Retenu provisoirement :** **A**.

**Bloque :** non, mais conditionne la rédaction du lot E et le contrat du lot C.

---

## [GATE1] Q-004 — Le shard par lettre initiale est abandonné

**Contexte :** le §5 exige des « shards par lettre initiale, chargés à la demande » **et** une
recherche par sous-chaîne. Ce sont deux partitions orthogonales du même ensemble. Mesuré :
« remy » impose de charger **11 shards sur 26** (81 % de l'index pour 59 résultats), « ille » **26
sur 26** ; fan-out moyen sur 2 710 sous-chaînes tirées au sort : 10,75 shards. Le seuil de 40 Ko est
par ailleurs inatteignable ainsi (shard `s` = 88 222 o brotli), et la découpe récursive produit
132 fichiers dont 59 sous 1 Ko sans résoudre le fan-out. L'index de trigrammes a été testé : il
sélectionne 13,68 shards sur 16 en moyenne.

**Options :**
- **A.** Découpe par colonne × 6 plages de rang INSEE équilibrées. 30 fichiers, plus gros 26,6 Ko,
  total 349,4 Ko brotli. La colonne des noms se charge en entier ; le scan complet coûte 3,97 ms.
- **B.** Maintien du shard par lettre. Contredit par trois mesures indépendantes.

**Retenu provisoirement :** **A**.

**Bloque :** non.

---

## [GATE1] Q-005 — Îlots `client:idle` remplacés par des custom elements

**Contexte :** le §11 impose « Astro + îlots hydratés `client:idle`, jamais `client:only` ».
L'intention — la page reste lisible et indexable sans JS — est intégralement respectée par un
`<script type="module">` associé à un custom element, qui évite en plus **2 093 o gzip** de runtime
d'hydratation Astro (mesuré) et tout framework UI.

**Options :**
- **A.** Custom elements + `<script type="module">`. Même garantie d'indexabilité, moins de poids.
- **B.** `client:idle` littéral. Impose un framework UI (React, Preact, Svelte) qu'aucune autre
  contrainte ne justifie, sur un budget de 150 Ko.

**Retenu provisoirement :** **A**.

**Bloque :** non.

---

## [GATE1] Q-006 — La vidéo sort de la v1 en écriture et en suppression

**Contexte :** le §4 prévoit l'écriture vidéo par sidecar en v1. Mais la **suppression** décrite
(renommer l'atome `©xyz` en `free`) ne supprime pas : restent au minimum `@xyz` (Samsung),
`com.apple.quicktime.location.ISO6709`, et surtout **`location.name`** — le lieu en toutes lettres.
Le balayage résiduel cherche des coordonnées, pas des toponymes : il rendrait « aucun résidu » sur un
fichier qui dit « Avignon » en clair. Les pistes GPS temporisées vivent de plus dans `mdat`, que
l'architecture saute par optimisation.

**Options :**
- **A.** Lecture conservée, écriture et suppression retirées de la v1, avec le message : « Nous
  savons lire le lieu d'une vidéo mais nous ne savons pas encore le retirer de façon sûre. »
- **B.** On livre la suppression vidéo telle que décrite. **Le pire résultat possible pour ce
  produit** : un utilisateur convaincu d'avoir nettoyé une vidéo qui ne l'est pas.

**Retenu provisoirement :** **A**.

**MISE À JOUR du 27/07/2026 : A était encore trop généreuse — la lecture non plus n'existait pas.**

L'option A conservait la lecture. Vérifié en exécutant le moteur : **aucune ligne de code ne lit une
vidéo.** Le sondage court-circuite sur le format et rend « aucune position » sans consulter le
moindre lecteur, et le second lecteur — celui écrit par d'autres — n'ouvre ni MOV ni MP4. La case
« Lire » était donc à « oui » sans rien derrière depuis l'origine. Voir Q-039.

Ce qui manque pour rouvrir quoi que ce soit est **un fichier**, pas du code. Recherche menée le
27/07/2026, toutes négatives : `ianare/exif-samples`, `drewnoakes/metadata-extractor-images`,
`Exiv2/exiv2`, `exiftool/exiftool`, `gopro/gpmf-parser`, `google/spatial-media` ne contiennent aucun
`.mov`/`.mp4`/`.m4v`/`.3gp` ; Wikimedia Commons n'accepte ni `video/quicktime` ni `video/mp4` (0
résultat sur les deux types). Aucun corpus public sous licence libre ne fournit donc de vidéo réelle.

Une vidéo a bien été fournie pour ce lot — un vrai MP4 Android de 4 877 320 o — mais elle a été
**purgée à l'envoi** : ni `©xyz`, ni `@xyz`, ni `ISO6709`, ni `udta`, ni `location.name` ;
`moov/meta/ilst` ne porte plus que `com.android.version`, et les entrées voisines sont des boîtes
`skip` remises à zéro. Le conteneur reste réel et pourrait servir de support au précédent Q-035 —
lieu inscrit par ExifTool — mais il lui faudrait d'abord une **adresse durable** : le lien fourni
expire, et `test/fixtures/` n'est pas committé.

Ce qu'il faudrait pour ouvrir « Effacer », inchangé et toujours non tenu : un balayage résiduel qui
cherche des **toponymes** et pas seulement des coordonnées. Un fichier qui n'a plus de latitude mais
dit encore « Avignon » n'est pas effacé, et c'est le seul endroit du produit où l'effacement peut
mentir sans qu'aucun contrôle actuel ne s'en aperçoive.

**Bloque :** non. La ligne entière est à « pas encore », ce qui est désormais exact.

---

## [GATE1] Q-007 — « Aucun cul-de-sac » doit être reformulé

**Contexte :** le §4 pose « aucun cul-de-sac » comme règle produit. C'est vrai en lecture, faux
ailleurs. Un fichier compagnon peut **ajouter** une information, jamais en **retirer** une : si P1
échoue sur un RAW, la suppression n'a aucun repli. Et un navigateur ne peut pas poser un `.xmp`
**à côté** d'un `.CR2` — il le dépose dans le dossier de téléchargements.

**Options :**
- **A.** Reformuler : « la lecture n'a pas de cul-de-sac ; la suppression en a un quand P1 échoue ;
  l'ajout en a un quand ni P2 ni P3 ne conviennent », et **écrire le texte de ce cul-de-sac**.
  Livrer un ZIP contenant les deux fichiers pour le cas compagnon.
- **B.** Maintenir la formulation. Non défendable.

**Retenu provisoirement :** **A**.

**Bloque :** non.

---

## [GATE1] Q-008 — Leaflet remplacé par une carte SVG maison

**Contexte :** Leaflet pèse **42 353 o gzip**, soit 42 % du budget JS total, pour un widget dont la
conception désactive le panoramique clavier (`keyboard: false`), réécrit le déplacement du repère et
remplace les boutons de zoom. Une fois la carte démotée (Q-003), il ne reste de Leaflet qu'un `<div>`
focusable et une formule de Mercator.

**Options :**
- **A.** Carte SVG maison : projection pré-calculée au build, un `<path>` composé, une matrice de
  transformation. 350 à 450 lignes ≈ 3 500 o gzip. Supprime aussi `topojson-client` (2 587 o).
- **B.** Leaflet. Coût réel −42 000 o de marge, et impose `preferCanvas: true` plus un découpage par
  `scheduler.yield()` pour ne pas violer l'INP (887 couches créées pour le département 62).

**Retenu provisoirement :** **A**, mais **à mesurer avant de figer** : prototyper le rendu SVG et
comparer. Un gain de 27 % du budget total mérite une demi-journée de mesure.

**Bloque :** non.

---

## [GATE1] Q-009 — Le décor animé de la maquette

**Contexte :** le §8 fixe « formes liquides floutées animées en `border-radius`, `mix-blend-mode:
screen` ». Or `border-radius` **n'est pas une propriété compositable** : son animation invalide le
paint à chaque image, sur le thread principal, sur toutes les pages, en boucle infinie, sous un
`filter: blur(70px)` plein viewport qui ne peut donc jamais être mis en cache. À 70 px de flou, la
forme organique est de toute façon **invisible**.

**Options :**
- **A.** Trois `radial-gradient` statiques. Mathématiquement équivalent à l'œil, une passe de shader,
  zéro invalidation. Les `backdrop-filter: blur(26px)` deviennent des couleurs solides pré-calculées,
  ce qui rend le contraste déterministe.
- **B.** Formes figées en SVG, animées **uniquement** en `transform`. Garde le mouvement, compositeur
  seul.
- **C.** Maquette littérale. Attaque simultanément INP, LCP et l'autonomie, sans qu'aucune
  optimisation JS ne puisse le rattraper.

**Retenu : A**, appliqué — les trois `radial-gradient` statiques de `body` sont la réponse au décor de
la maquette, et ils le restent. **Le mouvement a ensuite été jugé indispensable**, et c'est la branche
**B qui a été ouverte, dans une variante qu'aucune des options ci-dessus ne décrit** : la forme n'est
pas figée puis translatée, elle est **recalculée** à chaque image. Cette variante ouvre donc son
entrée propre : voir **Q-040**.

**Bloque :** non.

---

## [GATE1] Q-010 — Trois blocs de contenu canoniques au lieu de 7 blocs × 4 pages

**Contexte :** le §7 impose 7 blocs de contenu. Déclinés sur 4 pages sans réécriture interdite, cela
représente **8 500 à 13 700 mots** de prose technique française dont chaque affirmation doit être
sourcée, soit 11 à 27 jours-homme de rédaction seule. Et réécrire quatre variantes d'un même fait est
un générateur d'incohérences sur un projet dont la promesse est la rigueur factuelle.

**Options :**
- **A.** Les blocs « pourquoi vos fichiers ne partent pas », « vie privée » et « vérifier avec
  ExifTool » sont **canoniques** : rédigés une fois, sur une page dédiée, résumés en trois lignes
  propres à chaque page. Contrôle de build remplacé par : *chaque page possède ≥ 400 mots qui
  n'existent nulle part ailleurs*.
- **B.** 7 blocs × 4 pages, réécrits.

**Retenu provisoirement :** **A**.

**Bloque :** non.

---

## [GATE1] Q-011 — Aucun volume de recherche n'a pu être mesuré

**Contexte :** le §7 fixe quatre pages cibles et leurs requêtes. Ahrefs est inaccessible sur cette
session : 7 endpoints appelés, 7 réponses `Insufficient plan` (mesuré). Google Trends répond 429,
DuckDuckGo 202 anti-bot. **Aucun volume, aucun SERP google.fr observé.** Ce qui a pu être mesuré,
c'est Google Suggest (FR/FR, 23 requêtes) : le mot que tapent les Français est « localisation », pas
« géolocalisation », et `iphone` est le modificateur d'appareil dominant.

**Options :**
- **A.** Obtenir les volumes via Google Keyword Planner (gratuit, compte Google Ads, ciblage
  France + français, ~1 h) **avant** d'écrire le contenu.
- **B.** Écrire les 4 pages sur les requêtes supposées. Engage 11 000 mots sur des mots-clés dont
  personne ne sait s'ils font 200 ou 20 000 recherches par mois.
- **C.** Souscrire un plan Ahrefs ouvrant l'API Keywords Explorer.

**Retenu provisoirement :** **A**, et en attendant : renommer
`/supprimer-geolocalisation-photo` → `/supprimer-localisation-photo`, seule correction que les
données mesurées soutiennent.

**Bloque :** **oui** pour le lot E, non pour les lots A, B, C.

---

## [GATE1] Q-012 — Allowlist de licences : les polices sont en OFL-1.1

**Contexte :** le §2 impose « MIT / BSD / Apache-2.0 » pour chaque dépendance. Les polices Fontsource
(Bricolage Grotesque, DM Mono) sont sous **OFL-1.1**, qui est une licence de fonte, pas de logiciel,
et qui autorise la redistribution embarquée. Prise au pied de la lettre, l'allowlist les exclut.
Note d'inventaire : `@fontsource-variable/dm-mono` **n'existe pas** (le registre répond
`{"error":"Not found"}`) — seul `@fontsource/dm-mono@5.3.0`, statique, existe.

**Options :**
- **A.** Amender l'allowlist pour admettre explicitement **OFL-1.1** (polices) et **ISC**
  (équivalent MIT), et le consigner dans `CREDITS.md`.
- **B.** Renoncer aux Fontsource et n'utiliser que des polices système. Perd la direction visuelle
  du §8.

**Retenu provisoirement :** **A**.

**Bloque :** non.

---

## [GATE1] Q-013 — Phasage : V0 JPEG avant tout le reste

**Contexte :** le cadrage « site statique de 4 pages » induit un projet de quelques semaines. La
charge estimée à partir des volumes de code du dossier, à la cadence de 15-25 lignes/jour sur du
parsing binaire à spécification, est de **24 à 41 semaines-homme**. Le corpus seul (fichiers réels +
un attendu rédigé avant implémentation pour chacun) vaut 1 à 2 semaines avant la première ligne de
code.

**Options :**
- **A.** V0 = JPEG seul, suppression et correction par P1, une page, aucune carte, aucun index,
  aucun WASM — livrable en 4 à 6 semaines. Puis V1 (PNG/WebP, index, carte, PWA, 4 pages), puis V2
  (HEIC/AVIF selon Q-002).
- **B.** Tout d'un bloc.

**Retenu provisoirement :** **A**, parce qu'on apprend du terrain avant de dépenser 30 semaines.

**Bloque :** non, mais c'est la décision qui structure tout le calendrier.

---

## [GATE1] Q-014 — Périmètre du fonctionnement hors ligne

**Contexte :** le §11 fait de la PWA hors ligne complète une fonctionnalité v1, au motif que
« fonctionner sans réseau *prouve* la promesse ». Mais l'index et les contours sont chargés à la
demande : hors ligne, un utilisateur qui ouvre l'outil en vacances obtient une recherche muette et
une carte vide. « Offline complet » et « chargement paresseux » sont incompatibles.

**Options :**
- **A.** Reformuler : « l'outil fonctionne intégralement hors ligne ; la recherche se limite aux
  zones déjà consultées », **et le dire dans l'UI** au basculement, pas en note de bas de page.
- **B.** Précacher l'index complet (349,4 Ko), pas les contours ; la carte est absente hors ligne.
  Cohérent avec Q-003 : l'index est le vrai mécanisme de précision, la carte ne fait que situer.
- **C.** Précacher les ~1,4 Mo, sur action explicite (« Télécharger les données pour l'usage hors
  ligne — 1,4 Mo »).

**Retenu provisoirement :** **B**.

**Bloque :** non.

---

## [GATE1] Q-015 — Corpus de test : trois cas probablement introuvables en libre

**Contexte :** le §13.12 exige au moins 14 fichiers **réels**, pas générés. La décision prise est de
n'utiliser que des sources publiques sous licence libre (base `raw.pixls.us`, CC0, non retouché).
Trois cas seront difficiles à couvrir ainsi : **JPEG iPhone mode portrait multi-images (MPF)**,
**Live Photo**, **JPEG passé par Photoshop (segments APP12/APP13)**.

**Options :**
- **A.** Ces chemins **refusent l'écriture** tant qu'ils n'ont pas de fichier de test, plutôt que de
  l'autoriser sans preuve. Ils restent lisibles et détectables.
- **B.** On les implémente sans test et on espère.
- **C.** Ces trois fichiers sont fournis par Mathieu (revient sur la décision « sources publiques
  uniquement »).

**Retenu provisoirement :** **A**, parce que c'est le comportement le moins engageant : un refus
explicite ne produit jamais un fichier abîmé.

**Bloque :** non.

---

## [GATE1] Q-016 — Mentions légales : identité de l'éditeur

**Contexte :** un site français doit publier des mentions légales même sans collecte de données.
Elles exigent un **nom d'éditeur** et un **hébergeur identifié**. C'est une information que seul
Mathieu peut fournir.

**Options :** aucune — il s'agit d'une donnée à fournir, pas d'un arbitrage.

**Retenu provisoirement :** page rédigée avec des marqueurs explicites en attente de l'information.
Le build échoue tant qu'un marqueur subsiste.

**Bloque :** **oui** pour la mise en ligne, non pour le développement.

---

## [GATE1] Q-017 — Nom et domaine

**Contexte :** les 9 variantes testées (`geotagor.fr`, `.com`, `.app`, `.net`, `.io`,
`geotaggor.fr/.com`, `geotager.fr/.com`) sont **toutes libres** au RDAP le 27/07/2026, double
vérification RDAP + DNS. « geotagor » n'est utilisé par aucun produit connu ; c'est un néologisme,
donc distinctif et protégeable. Risque résiduel réel : la **similarité phonétique** avec
« geotagger », terme générique employé par au moins 8 acteurs. L'antériorité INPI **n'a pas pu être
vérifiée** (data.inpi.fr en 403, TMview en POST seul, Justia en 403). Classes de Nice **9 et 42**
confirmées sur la classification officielle — les deux sont nécessaires, la 42 pour le service en
ligne, la 9 pour la PWA installable.

**Options :** aucune sur le nom lui-même ; deux actions manuelles à mener (~20 min chacune) :
recherche INPI + EUIPO, et vérification du statut premium des domaines chez un registrar.

**Retenu provisoirement :** `geotagor.fr` principal + `geotagor.com` défensif en 301.

**TRANCHÉ le 27/07/2026 par Mathieu : le nom est « Geotager ».** Le dépôt et le Worker portaient
déjà ce nom, mais la prose, le titre de la page, le balisage et le domaine disaient « Geotagor » —
173 occurrences contre 30. Le code, le contenu et la configuration sont alignés sur **Geotager** et
**geotager.fr**, y compris l'URL canonique, le sitemap, le balisage `SoftwareApplication`, la liste
d'hôtes autorisés du contrôle de build et les noms des fichiers rendus à l'utilisateur.

`PLAN-GATE1.md` et `docs/gate1/` **ne sont pas réécrits** : ce sont des pièces datées, et corriger
rétroactivement un dossier de preuves reviendrait à le falsifier. Ils continuent donc de dire
« Geotagor », ce qui est exact pour la date qu'ils portent. Même raison pour le nom du fichier de
maquette.

Le domaine retenu n'est **ni `.fr` ni `.com` mais `geotager.app`** : il est déjà acheté, sa zone
existe, et il est rattaché au Worker en production (constaté au tableau de bord le 27/07/2026, et
`https://geotager.app/` répond 200). L'URL canonique, le sitemap, le balisage et la liste d'hôtes
autorisés du contrôle de build pointent donc sur `geotager.app`.

Ce qui reste ouvert : la recherche d'antériorité INPI et EUIPO, et l'opportunité d'un domaine
défensif. La similarité phonétique avec « geotagger », terme générique, est plus forte avec cette
graphie qu'avec la précédente : c'est le prix de la lisibilité, et il est assumé.

**Bloque :** **oui** pour l'achat et le dépôt, non pour le développement.

---

## [GATE1] Q-018 — Le WASM ne peut pas être compilé par Cloudflare

**Contexte :** l'image de build Pages v3 (Ubuntu 22.04, Node 22.16.0, Python, Go, Ruby, Bun) **ne
contient ni `cargo`, ni `rustup`, ni `wasm-pack`, ni `wasm-opt`**. Le seul langage compilé jamais
listé était Swift, et il a disparu en v2. Cloudflare a un ticket de documentation ouvert sur
« document Rust and Swift installation process », ce qui confirme que le sujet est non documenté et
non supporté. Si le spike valide la voie Rust, il faut donc produire le `.wasm` ailleurs.

**Options :**
- **A.** Compiler dans **GitHub Actions** (rustup + wasm-pack + wasm-opt s'y installent sans
  ambiguïté) et **committer l'artefact `.wasm`**. La build Pages ne fait que le copier. Bénéfice
  aligné sur la promesse du produit : le binaire est diffable et la chaîne de compilation est
  publique, donc **reproductible par un tiers**.
- **B.** Installer rustup dans la commande de build. Rapporté comme fonctionnel par la communauté,
  **non documenté** par Cloudflare, lent (plafond de 20 min par build) et dépendant d'un accès
  réseau lui aussi non documenté.
- **C.** Renoncer à la voie Rust indépendamment du résultat du spike.

**Retenu provisoirement :** **A**.

**Bloque :** non — la décision ne se matérialise que si le spike passe.

---

## [GATE1] Q-019 — `geotagor.pages.dev` est indexable par défaut

**Contexte :** les déploiements de **prévisualisation** reçoivent `X-Robots-Tag: noindex`
automatiquement, c'est documenté. **Le déploiement de production sur `<projet>.pages.dev`, non.**
Le site entier existerait donc en double sur un sous-domaine, contenu strictement identique — sur un
projet dont le seul canal d'acquisition est le SEO. Un `robots.txt` avec `Disallow: /` ne résout
rien : Google ne lirait alors plus le `noindex`, et le même fichier est servi sur tous les hôtes.

**Options :**
- **A.** Deux règles `_headers` **scopées par hôte** (`https://:project.pages.dev/*` et
  `https://:version.:project.pages.dev/*`), qui ne touchent pas `geotagor.fr`, **plus** une Bulk
  Redirect 301 de `pages.dev` vers le domaine canonique (*Include subdomains* désactivé, sinon les
  prévisualisations sont redirigées et deviennent inutilisables). Défense en profondeur : si la
  redirection saute, le `noindex` reste.
- **B.** `_headers` seul. Fonctionne, mais laisse vivre un hôte dupliqué crawlable.
- **C.** Désactiver les déploiements de prévisualisation. Réponse disproportionnée : on perd tout
  garde-fou pré-merge alors que les previews sont déjà `noindex`.

**Retenu provisoirement :** **A**, avec un **contrôle de build bloquant** qui échoue si un
`X-Robots-Tag` apparaît sous un motif ne commençant pas par `https://`. Les règles `_headers` se
cumulent et les valeurs dupliquées sont jointes par une virgule : un `X-Robots-Tag` sur `/*`
produirait `index, follow, noindex`. C'est le garde-fou contre la régression qui désindexerait
`geotagor.fr` du jour au lendemain.

**Bloque :** **oui** pour la mise en ligne.

---

## [GATE1] Q-020 — Trois injecteurs Cloudflare sont actifs par défaut

**Contexte :** le produit promet zéro requête tierce et zéro télémétrie. Sur une zone Cloudflare
gratuite, **Web Analytics / RUM est activé par défaut depuis le 15 octobre 2025** et injecte
`<script src="https://static.cloudflareinsights.com/beacon.min.js">` — requête tierce **et**
télémétrie, double violation. **Speed Brain** est également actif par défaut, et **Email Address
Obfuscation** l'est « dès l'inscription ». Rocket Loader et Bot Fight Mode ont un état par défaut
non documenté ; ce dernier injecte un script `/cdn-cgi/challenge-platform/…` **et dépose un cookie
`cf_clearance`**.

**Options :**
- **A.** Couper chaque interrupteur dans le tableau de bord, **et** poser une **Configuration Rule**
  unique d'expression `true` forçant *Disable RUM* + *Disable Zaraz* + *Email Obfuscation Off* +
  *Rocket Loader Off* + *Browser Integrity Check Off*. Une règle survit à un changement de défaut
  côté Cloudflare ; un interrupteur coché une fois, non.
- **B.** Couper les interrupteurs seulement. Suffisant aujourd'hui, fragile demain — c'est
  exactement ainsi que le RUM est apparu sur des sites qui ne l'avaient jamais demandé.
- **C.** Poser `Cache-Control: public, no-transform` sur `/*`, ce qui empêche par construction toute
  injection edge dans le HTML. Documenté et efficace, mais Cloudflare cesse alors de compresser le
  HTML — coût direct sur le budget de performance.

**Retenu provisoirement :** **A**, plus un contrôle post-déploiement qui `grep` la réponse servie et
échoue si `cloudflareinsights`, `/cdn-cgi/`, `email-decode`, `challenge-platform` ou `zaraz`
apparaissent.

**Question annexe, à trancher pour la page vie privée :** la protection DDoS peut servir un challenge
en cas d'attaque et poser alors un `cf_clearance`. La formulation retenue est « aucun cookie déposé
en fonctionnement normal ; un cookie technique de sécurité peut être posé par notre hébergeur
uniquement pour repousser une attaque » — plutôt que de prétendre l'impossible. À faire relire si
l'enjeu juridique est jugé fort.

**Bloque :** **oui** pour la mise en ligne.

---

## [GATE1] Q-021 — Trois points d'hébergement non documentés, à tester au premier déploiement

**Contexte :** la vérification de l'hébergement n'a pas pu être confirmée par une passe adverse
(agent contradicteur bloqué par un classifieur de sécurité). Trois points restent non documentés par
Cloudflare et ne doivent pas être tenus pour acquis.

**Options :** aucune — ce sont des tests à exécuter, chacun de quelques minutes, sur une branche de
prévisualisation avant toute mise en production.

1. **`Content-Type` est-il réellement surchargeable via `_headers` ?** La doc énonce une règle
   générale d'écrasement mais ne nomme jamais `Content-Type`. **Bloquant pour la stratégie d'index
   pré-compressé.** Test : `curl -I` sur un fichier de `/data/` après déploiement.
2. **Un fichier pré-compressé arrive-t-il intact à l'octet près ?** Le danger est qu'un
   `Content-Encoding: br` soit déduit de l'extension : le navigateur décompresserait notre couche et
   `DecompressionStream` recevrait des données déjà claires. Parade préventive retenue : nommer les
   fichiers **`.bin`** et non `.br`, forcer `application/octet-stream`, ajouter `no-transform`, et
   ne **jamais** poser de `Content-Encoding` à la main. Test : cinq `curl` avec `Accept-Encoding`
   valant `identity`, `gzip`, `br`, `zstd` puis les trois, et comparaison des `sha256sum` au fichier
   de `dist/` — **les cinq doivent être identiques**.
3. **La build a-t-elle un accès réseau sortant ?** Non documenté. Sans objet si le snapshot committé
   reste l'unique source, ce que le plan impose désormais.

**Retenu provisoirement :** les trois parades préventives ci-dessus, appliquées **avant** les tests,
de sorte qu'un résultat négatif ne coûte rien.

**Bloque :** non, mais le point 2 conditionne le budget de l'index.

---

## [GATE1] Q-022 — L'hébergement est Workers, pas Pages

**Contexte :** le §7 du plan a été vérifié contre la documentation **Cloudflare Pages**. L'intégration
réellement mise en place le 27/07/2026 est **Workers avec assets statiques** (Workers Builds) — le
check GitHub s'appelle `Workers Builds: geotager` et le bot pointe vers
`/workers/ci-cd/builds/git-integration/`. Cloudflare pousse désormais Workers pour les sites
statiques et les deux documentations se ressemblent au point de s'échanger silencieusement.

**Ce qui tient sans changement** (vérifié sur la doc Workers) : `_headers` et `_redirects` sont
supportés nativement, avec les mêmes limites ; les plafonds d'assets sont identiques (20 000 fichiers,
25 MiB) ; toute la section sur les injecteurs Cloudflare relève de la **zone** et vaut dans les deux
cas.

**Ce qui change :**
- **`"workers_dev": false` supprime l'hôte technique.** Sur Pages, `<projet>.pages.dev` était
  indexable et indéracinable, ce qui imposait des règles `_headers` scopées par hôte plus une Bulk
  Redirect. Ici le domaine dupliqué **n'existe simplement pas**. Gain net.
- **`preview_urls` suit `workers_dev` par défaut** depuis Wrangler 4.44.0 : couper l'un coupe
  l'autre. Les prévisualisations doivent donc être réactivées explicitement, faute de quoi le Gate 2
  perd sa capacité à tourner avant la production.
- **Le `wrangler.jsonc` devient obligatoire**, à l'inverse de ce que le plan recommandait.

**Options sur le point ouvert — le `noindex` des prévisualisations :** Pages documente un
`X-Robots-Tag: noindex` automatique sur ses prévisualisations. **Aucun équivalent trouvé côté
Workers.**
- **A.** Supposer qu'il n'existe pas et protéger les prévisualisations par **Cloudflare Access**.
- **B.** Vérifier par `curl -I` sur une vraie URL de prévisualisation et n'agir qu'ensuite.
- **C.** Désactiver les prévisualisations (`preview_urls: false`) et perdre le bénéfice Gate 2.

**Retenu provisoirement :** **A**, parce que c'est le seul comportement qui ne parie pas sur une
garantie non documentée. **B** sera fait de toute façon au premier déploiement, et pourra alléger A.

**Bloque :** non pour le développement, **oui** pour la mise en ligne.

---

## [GATE1] Q-023 — La build échoue tant que le dépôt est documentaire

**Contexte :** l'intégration Git est active et le dépôt ne contient aucune application — ni
`package.json`, ni `wrangler.jsonc`, ni répertoire de sortie. Chaque push produit donc une build en
échec sur la PR. Ce n'est pas un défaut du livrable : c'est l'état prescrit par le Gate 1, où aucune
ligne de code n'est écrite avant validation.

**Options :**
- **A.** Laisser rouge. Le bruit est visible mais le périmètre est tenu.
- **B.** Désactiver les builds de branches non-production dans le tableau de bord.
- **C.** Déconnecter l'intégration Git jusqu'au démarrage de la V0.
- **D.** Committer un `wrangler.jsonc` et un `package.json` minimaux pour passer au vert. Écarté
  sans instruction contraire : cela démarrerait l'implémentation avant la validation du plan et
  trancherait au passage `workers_dev`, la date de compatibilité et la chaîne de build.

**TRANCHÉ le 27/07/2026 par Mathieu : D.** Un scaffold minimal est committé pour passer au vert.

Ce que le scaffold fige, et qu'il faut donc considérer comme décidé :
- `workers_dev: false` et `preview_urls: true` (cf. Q-022) ;
- `compatibility_date: 2026-07-27` ;
- la commande de build est `npm run build`, et elle porte les contrôles bloquants.

Ce que le scaffold **ne** fige pas, délibérément : aucune dépendance n'est installée, `package.json`
n'en déclare aucune, et rien n'est décidé sur Astro, la carte, l'index ni le noyau EXIF. `CREDITS.md`
reste donc exact.

Deux dettes explicites, à solder au premier commit de la V0 :
1. `assets.directory` pointe sur `./site`, committé, pour que le déploiement fonctionne **même si
   aucune commande de build n'est configurée** dans le tableau de bord — la configuration réelle du
   Worker n'est pas lisible par l'API. Quand Astro produira `./dist`, cette ligne change et `site/`
   disparaît.
2. `site/_headers` porte un `X-Robots-Tag: noindex` sur `/*` et `site/robots.txt` un `Disallow: /`.
   **Les deux sont contraires au plan** (§7.2) et doivent sauter dès que le site a du contenu réel :
   un `Disallow: /` empêcherait Google de lire le moindre `noindex`. Ils ne sont là que parce qu'une
   page d'attente indexée serait pire que pas de page. Le commentaire est écrit dans les deux
   fichiers.

**Bloque :** non.

---

## [V0] Q-024 — Polices système au lieu des polices de la maquette

**Contexte :** le §8 fixe Bricolage Grotesque, Outfit et DM Mono, auto-hébergées. Le plan avait déjà
ramené le compte à deux familles (56 164 o de woff2). La V0 n'en embarque **aucune** et utilise la
pile système.

**Options :**
- **A.** Pile système. Zéro octet de police, zéro risque de reflow au basculement, LCP non exposé.
  L'identité visuelle repose sur la couleur, la forme et la mise en page, qui sont conservées.
- **B.** Les deux familles auto-hébergées, `font-display: optional`. Fidèle à la maquette, +56 Ko
  incompressibles sur le chemin critique.

**Retenu provisoirement :** **A** pour la V0, parce que c'est le moins engageant et que le budget
sert d'abord au moteur. À rouvrir dès que le reste est stable — c'est un choix esthétique autant que
technique, et il appartient à Mathieu.

**Bloque :** non.

---

## [V0] Q-025 — Ni carte ni recherche de commune en V0

**Contexte :** le plan conclut (§0, C3) que la carte ne peut pas servir de viseur et qu'elle
*situe* sans permettre de *viser*. La V0 livre donc la saisie de coordonnées et le collage depuis une
carte tierce, sans carte intégrée ni index de communes.

**Options :**
- **A.** Coordonnées seules en V0. Le parcours est honnête : on ne montre pas une carte qui ne sait
  pas faire ce qu'on lui demanderait.
- **B.** Carte SVG maison dès la V0 (Q-008), sans index.
- **C.** Carte + index de communes (349,4 Ko), soit le périmètre V1 complet.

**Retenu provisoirement :** **A**. L'index de communes reste le vrai mécanisme de précision et
mérite d'arriver avec la carte, pas avant.

**Bloque :** non.

---

## [V0] Q-026 — La télémétrie d'Astro était active

**Contexte :** au premier build, Astro a annoncé collecter des données d'usage anonymes. C'est une
télémétrie de construction, pas d'exécution — elle ne touche pas les visiteurs — mais elle est
contraire à l'esprit du projet et n'avait été anticipée nulle part dans le plan.

**Retenu :** `ASTRO_TELEMETRY_DISABLED=1` est posé dans le script `build` de `package.json`, donc
committé et appliqué aussi sur le build Cloudflare. Un réglage global de la machine n'aurait pas
suivi le dépôt.

**Bloque :** non. Signalé parce que toute dépendance de build mérite la même question.

---

## [V0] Q-027 — L'hôte technique reste actif, avec noindex

**Contexte :** le plan (§7.2) retenait `workers_dev: false` pour supprimer l'hôte technique
indexable. À l'usage, cette valeur a un effet non anticipé : **tant qu'aucun domaine personnalisé
n'est rattaché, la production n'a aucune URL publique**. Le déploiement réussit et le site reste
inatteignable — ni pour Mathieu, ni pour les contrôles du Gate 2.

S'y ajoute une erreur découverte au même moment : les règles `X-Robots-Tag` de `public/_headers`
utilisaient la syntaxe **Pages** (`https://:project.pages.dev/*`, deux étiquettes). Sur Workers,
l'hôte est `<worker>.<sous-domaine>.workers.dev`, soit **trois** étiquettes, et un placeholder ne
traverse pas le point. **Ces règles ne matchaient donc rien** : le domaine technique aurait été
indexable sans protection si `workers_dev` avait été à `true`.

**Options :**
- **A.** `workers_dev: true` **plus** les règles `noindex` corrigées à la forme Workers. Le site
  devient consultable immédiatement, et le domaine technique est protégé par la parade que
  Cloudflare documente lui-même.
- **B.** `workers_dev: false` maintenu, et attendre le rattachement de `geotagor.fr`. Rien n'est
  consultable d'ici là, y compris pour vérifier le travail.

**Retenu : A**, et un contrôle de build bloquant refuse désormais tout motif `workers.dev` comptant
moins de deux étiquettes avant le domaine. Un motif d'hôte qui ne matche rien est pire qu'absent :
il donne l'impression d'une protection qui n'existe pas.

À repasser à **B** le jour où `geotagor.fr` est rattaché, si l'on préfère la ceinture aux bretelles.

**Bloque :** non.

---

## [V1] Q-028 — L'ajout d'un lieu reste hors périmètre sur HEIC, AVIF et TIFF

**Contexte :** Q-002 retenait « HEIC : lecture et suppression uniquement ». Le portage montre que
la **correction** d'un lieu déjà présent est également atteignable, et à longueur strictement
constante — donc sans aucun des risques qui motivaient l'exclusion. Mesuré sur une photo d'iPhone
de 833 Ko : corriger touche **15 octets**, effacer **104**, et **zéro octet ailleurs**. L'ajout,
lui, ferait grandir le bloc, donc bouger la table des emplacements, et c'est la seule opération qui
demanderait un écrivain de conteneur. Le tableau à trois colonnes ne savait pas exprimer
« corriger oui, ajouter non ».

**Options :**
- **A.** Quatre colonnes : Lire, Corriger, Ajouter, Effacer. Chaque case reste un oui ou un non, et
  le tableau reste l'état réel du code.
- **B.** Trois colonnes, la case « Modifier » portant « seulement si la photo en a déjà un ». Plus
  compact, mais une case qui n'est ni oui ni non ouvre la porte aux formulations molles.
- **C.** Implémenter l'ajout sur HEIC. Écarté : c'est le périmètre que Q-002 a écarté, et rien dans
  ce portage ne l'a rendu moins risqué.

**Retenu provisoirement :** **A**, parce que la quatrième colonne dit une vérité que la troisième ne
pouvait pas dire, et parce qu'elle rend le tableau vérifiable case par case par un test.

**MISE À JOUR du 27/07/2026 : l'option C n'est plus écartée, et les trois cases sont ouvertes.**

L'entrée disait « rien dans ce portage ne l'a rendu moins risqué ». C'était vrai du portage ; ce ne
l'est plus depuis qu'on a cessé de chercher à agrandir l'item sur place. Voir Q-002 pour la mesure
qui l'établit.

Sur **HEIC et AVIF**, « Ajouter » est ouvert : boîte ajoutée en fin de fichier, une seule adresse
repointée. Sur **TIFF**, il l'est aussi, mais aux seuls fichiers qui prouvent être une image
ordinaire — voir la mise à jour de Q-029.

La quatrième colonne garde tout son sens : « Corriger » et « Ajouter » restent deux opérations
différentes, la première ne changeant pas la taille du fichier et la seconde si. Ce que la mesure a
changé, c'est la valeur des cases, pas la forme du tableau.

**Bloque :** non.

---

## [V1] Q-029 — Les photos qui rangent leurs informations autrement sont refusées

**Contexte :** un emplacement d'item peut être décrit de trois façons : un décalage depuis le début
du fichier, un décalage dans une petite boîte de données interne, ou une position dans un autre
item. Seule la première est prise en charge. Mesuré sur les six fichiers du corpus : le bloc de
position est **toujours** décrit de la première façon ; la deuxième ne sert qu'à l'item de grille.
La troisième n'apparaît nulle part. Aucun fichier public accessible n'exerce donc l'écriture dans
les deux autres.

**Options :**
- **A.** Refus explicite des deux autres formes, avec une phrase qui ne promet rien.
- **B.** Prendre en charge la deuxième, techniquement à portée, mais sans test.
- **C.** Les trois. Coût sans rapport avec la fréquence réelle.

**Retenu provisoirement :** **A**, parce qu'un chemin d'écriture que nous ne pouvons pas éprouver
est un chemin que nous ne devons pas livrer, et que celui-là écrirait au milieu d'un fichier de
plusieurs mégaoctets.

**MISE À JOUR du 27/07/2026 : A tient, et le même raisonnement ouvre l'ajout sur TIFF.**

Les deuxième et troisième formes de rangement restent refusées, pour la raison inchangée : aucun
fichier public ne les exerce sur un bloc de position. S'y ajoutent désormais trois refus de même
nature pour l'ajout, tous mesurés plutôt que supposés — un décalage de base non nul, une boîte
finale qui déclare la taille 0, des octets qu'aucune boîte ne revendique.

**Sur TIFF, la case « Ajouter » s'ouvre, et le discriminant a été éprouvé dans les deux sens.** Un
DNG, un NEF, un CR2 sont des TIFF ; le corpus gagne quatre négatifs CC0 de `raw.pixls.us`, dont un
**Kodak EOS DCS 3 dont le nom de fichier dit « .TIF »** — le piège exact que la case devait éviter.

La mesure a démenti la conjecture, et c'est ce qui justifie d'avoir mesuré. On pariait sur
`PhotometricInterpretation` et `Compression` : relevés sur de vrais fichiers, la première page d'un
DNG et d'un NEF est un **aperçu RVB non compressé** (Photometric = 2, Compression = 1), donc
indiscernable d'un TIFF ordinaire sur ces deux tags. Ce qui la trahit est qu'elle s'annonce comme
image **réduite** (`NewSubFileType = 1`) et que les vraies données vivent dans un sous-répertoire
(`SubIFDs`).

| Fichier | NewSubFileType | Photometric | Compression | SubIFDs |
|---|---|---|---|---|
| `negatif.dng` | 1 | 2 | 1 | oui |
| `negatif.nef` | 1 | 2 | 1 | oui |
| `negatif.cr2` | absent | **absent** | 6 | non |
| `negatif.tif` | 1 | 1 | **absent** | oui |
| les quatre TIFF ordinaires | absent ou 0 | 2 | 5 | non |

C'est une **liste blanche, échec fermé** : on n'ajoute que si le fichier prouve être une image
ordinaire, de sorte qu'un format brut qui n'existe pas encore est refusé par construction. Chaque
négatif est écarté par au moins deux règles indépendantes, sauf le CR2, écarté parce qu'il ne
déclare aucune interprétation photométrique — un TIFF sans elle n'est pas une image conforme.

Corriger et effacer restent ouverts sur un négatif : c'est à longueur constante et la carte des
plages protège les bandes de pixels. Ce comportement préexistait et n'était adossé à rien ; il l'est
désormais, sur un vrai DNG.

**Bloque :** non.

---

## [V1] Q-030 — La relecture croisée n'est pas indépendante au niveau du fichier

**Contexte :** la page promet que chaque fichier produit est « relu par **deux moteurs
indépendants** ». Sur JPEG c'est exact. Sur les nouveaux formats, c'est **notre** code qui localise
le bloc à relire : la seconde lecture est indépendante là où la valeur est *encodée*, pas là où
elle est *rangée*. Pire, le second lecteur **ne connaît pas le WebP** (vérifié dans sa source :
`jpeg`, `tiff`, `png`, `heic`, `avif`, et rien d'autre) et refuse certains fichiers pour des raisons
sans rapport avec nous. Exiger sa relecture du fichier entier faisait échouer toute écriture WebP —
non parce que le fichier était mauvais, mais parce que le vérificateur ne savait pas l'ouvrir.

**Options :**
- **A.** Trois étages. Notre relecture repart des octets produits et relocalise le bloc depuis le
  premier octet. Le second lecteur relit le **bloc extrait** — qui est un fichier valide à lui seul,
  et qui est exactement la couche où vit le défaut de boutisme —, exigible sur tous les formats.
  Sa relecture du **fichier entier** est soumise à une règle de symétrie : s'il savait ouvrir
  l'entrée, il doit savoir ouvrir la sortie et être d'accord ; sinon son silence ne vaut pas échec.
  La règle est exacte par construction là où nous ne touchons ni en-tête, ni table des
  emplacements, ni aucune longueur.
- **B.** Exiger la relecture complète par le second lecteur sur tous les formats. Refuserait des
  opérations parfaitement saines à cause des limites du second lecteur, pas des nôtres.
- **C.** Se contenter de la relecture du bloc. Aveugle à une erreur de localisation.

**Retenu provisoirement :** **A**, et la page a été reformulée dans le même lot : elle promettait
« deux lecteurs indépendants » sans condition, alors que sur WebP l'indépendance ne vaut qu'à
l'échelle du bloc. Elle dit désormais « notre lecteur et un second écrit par d'autres », énumère les
trois motifs d'échec, et annonce séparément la comparaison octet par octet — qui, elle, vaut sur
tous les formats sans réserve.

Reste ouvert : faut-il afficher **fichier par fichier** l'étendue exacte de ce qui a été vérifié,
plutôt qu'une phrase générale ? Le résultat de l'opération sait déjà le dire ; l'interface ne
l'expose pas encore.

**Bloque :** non.

---

## [V1] Q-031 — Une copie du lieu que nous ne savons pas rouvrir bloque l'effacement

**Contexte :** un fichier peut porter le lieu deux fois : dans le bloc principal, et dans un paquet
de texte descriptif laissé par un logiciel de retouche. Quand ce paquet est **compressé**, ce moteur
— synchrone — ne sait pas l'ouvrir : il ne peut donc ni affirmer qu'il porte un lieu, ni affirmer le
contraire. Effacer le bloc principal en laissant cette copie rendrait un fichier que l'utilisateur
croirait propre.

**Options :**
- **A.** Le doute vaut refus : l'effacement échoue, avec une phrase explicite, et l'original est
  rendu intact.
- **B.** Décompresser et recompresser avec les fonctions natives du navigateur — aucun poids ajouté,
  mais le moteur devient asynchrone à cet endroit et cela demande sa propre série de tests et sa
  propre fixture.
- **C.** Effacer la copie principale et signaler l'autre. Écarté : c'est exactement l'échec
  silencieux que le produit existe pour empêcher.

**Retenu provisoirement :** **A** pour cette version, **B** pour la suivante, avec son test.

**Bloque :** non.

---

## [V1] Q-032 — D'une seconde copie, on retire le lieu et rien d'autre

**Contexte :** ce paquet de texte porte le lieu, mais aussi le titre, la légende, l'auteur et
l'historique de retouche. Q-001 impose de purger le lieu ; elle ne dit pas jusqu'où.

**Options :**
- **A.** Purge ciblée des seules propriétés de lieu, par remplacement par des espaces — donc à
  longueur constante, rien ne se déplace —, suivie d'un **re-balayage bloquant** : si un marqueur
  subsiste, l'opération échoue et l'original est rendu intact.
- **B.** Retrait du paquet entier. Simple, et détruit ce que l'utilisateur n'a pas demandé de perdre.

**Retenu provisoirement :** **A**. C'est le re-balayage qui rend A honnête : sans lui, une purge
incomplète serait une fuite ; avec lui, c'est un échec visible.

**Bloque :** non.

---

## [V1] Q-033 — Une image WebP de forme simple n'a pas d'emplacement pour un lieu

**Contexte :** seule la forme étendue du WebP prévoit une place pour ces informations. Lui en créer
une exigerait de relire les dimensions dans le flux compressé, avec deux décodeurs d'en-tête
distincts selon le mode d'encodage — pour un fichier où, par construction, il n'y a jamais rien à
corriger ni à effacer.

**Options :**
- **A.** Lecture seule, et une phrase qui l'explique sans jargon. La distinction se jouant au niveau
  du fichier et non du format, elle est annoncée fichier par fichier.
- **B.** Créer l'emplacement. Deux décodeurs d'en-tête à écrire et à éprouver pour un cas sans
  contenu à modifier.

**Retenu provisoirement :** **A**.

**Bloque :** non.

---

## [V1] Q-034 — Les drapeaux d'une image WebP peuvent mentir

**Contexte :** l'en-tête étendu déclare ce que le fichier contient. Mesuré sur le corpus : un
fichier réel porte un paquet de texte descriptif que ses drapeaux **ne déclarent pas**. Un autre
nomme ce paquet `XMP\0` au lieu de `XMP `. Se fier aux drapeaux ferait manquer une copie du lieu.

**Options :**
- **A.** Lire la liste réelle des morceaux, jamais les drapeaux seuls ; et ne corriger un drapeau
  que pour le morceau qu'on ajoute ou retire soi-même.
- **B.** Corriger tous les drapeaux pour qu'ils décrivent la réalité. Modifierait des octets que
  l'utilisateur n'a pas demandé de changer, sur un fichier dont l'incohérence lui préexiste.

**Retenu provisoirement :** **A**. Réparer l'incohérence d'autrui n'est pas ce qu'on nous a demandé.

**Bloque :** non.

---

## [V1] Q-035 — Le corpus de test est complété par l'oracle

**Contexte :** la règle du projet interdit les fichiers fabriqués. Or aucun corpus public sous
licence claire ne fournit de **PNG ni de TIFF géolocalisé** : deux recherches indépendantes de
l'API de Wikimedia Commons, puis un échantillonnage avec lecture des métadonnées réelles, n'en
remontent aucun. Commons n'héberge d'ailleurs ni HEIC ni AVIF.

S'y ajoutent deux points de licence à inscrire plutôt qu'à contourner. `ianare/exif-samples`, source
du corpus depuis la V0, est **archivé** et ses images sont sous **CC BY-SA 4.0** — licence qui ne
figurait pas dans `CREDITS.md`. `drewnoakes/metadata-extractor-images` n'a **aucun fichier de
licence**, seulement une autorisation explicite du dépôt (« You are free to use these media files
however you wish. ») : cela sort de l'allowlist MIT/BSD/Apache-2.0.

**Options :**
- **A.** Récupérer un vrai fichier d'appareil par format, et y faire écrire le lieu de départ par
  **ExifTool**. Le conteneur reste une sortie d'appareil réelle ; les octets du lieu viennent d'une
  implémentation indépendante de la nôtre, donc notre lecteur doit comprendre l'écriture d'un tiers
  — ce qui est plus exigeant qu'un échantillon trouvé déjà géolocalisé.
- **B.** Convertir un JPEG réel vers chaque format. Produit une structure d'outil de conversion et
  non d'appareil : on perd exactement ce que le corpus doit exposer.
- **C.** Renoncer aux formats sans échantillon. Revient à ne pas livrer PNG ni TIFF.

**Retenu provisoirement :** **A**, et le drapeau `requis` du script de corpus traduit mécaniquement
la règle du projet : un fichier requis manquant fait échouer toute la chaîne, un fichier facultatif
manquant n'émet qu'un avertissement et sa ligne du tableau doit rester à « pas encore ».

**Bloque :** non pour le code, **oui** pour la mise à jour de `CREDITS.md`, faite dans ce lot.

---

## [V1] Q-036 — « Tout effacer » retire le profil de couleurs d'un JPEG

**Contexte :** `stripAllMetadata` supprime **tous** les blocs d'en-tête d'un JPEG, profil
colorimétrique compris. Sur une photo d'iPhone, perdre le profil décale visiblement les couleurs
dans toute application gérée en couleur. `docs/gate1/att_exif.md` §4 exige l'inverse : profil
présent avant, présent après. Les conteneurs PNG et WebP écrits dans ce lot conservent le profil ;
le comportement JPEG, lui, préexiste à ce lot et n'entre pas dans le périmètre demandé.

Point distinct et traité, celui-là : le bouton était actif dès que l'effacement l'était, et serait
devenu cliquable sur des formats où « tout effacer » n'existe pas, pour échouer **après** le clic.

**Options :**
- **A.** Le bouton n'est actif que là où l'opération existe — fait dans ce lot —, et le
  comportement JPEG est corrigé dans un lot dédié, avec un test qui compare l'empreinte du profil
  avant et après.
- **B.** Corriger le comportement JPEG ici même. Écarté : élargir le périmètre d'un lot en cours
  est précisément la dérive par accumulation de bonnes décisions isolées que ce registre existe
  pour empêcher.

**Retenu provisoirement :** **A**.

**SOLDÉ le 27/07/2026.** Les segments `APP2` porteurs de la signature `ICC_PROFILE` sont désormais
gardés par « Tout effacer » — tous, car un profil volumineux est réparti sur plusieurs segments
successifs qui portent la même signature. Le test compare l'empreinte du profil avant et après sur
`Canon_40D.jpg`, qui porte un sRGB : identique au bit près. Le JPEG cesse d'être l'écart.

**Bloque :** non.

---

## [V1] Q-037 — Une position absente était annoncée comme valide au point (0, 0)

**Contexte :** trois fichiers réels du corpus portent un bloc de position **sans coordonnées
exploitables** : un Galaxy S10 sans relevé écrit des rationnels `0/0`, un AVIF passé par GIMP garde
`0/1 0/1 0/1`. Le moteur livré remplaçait un dénominateur nul par zéro, puis validait `|0| ≤ 90` :
il annonçait donc **une position parfaitement valide au large du golfe de Guinée** pour un fichier
qui n'en porte aucune. Vérifié en exécutant le lecteur du dépôt sur ces fichiers. Le défaut était
invisible en V0 — aucun JPEG du corpus ne l'expose — et devient courant dès qu'on ouvre les
conteneurs.

**Options :**
- **A.** Un dénominateur nul rend « illisible », et une latitude **et** une longitude exactement
  nulles rendent « aucune position ». Le point (0, 0) est en pleine mer ; aucun appareil ne
  l'écrit pour de bon, et annoncer « nulle part » est la seule réponse honnête.
- **B.** Afficher (0, 0) tel quel, puisque c'est ce que contient le fichier. Écarté : la question
  posée par l'utilisateur est « où cette photo a-t-elle été prise ? », pas « quels octets porte
  ce fichier ? ».

**Retenu provisoirement :** **A**. Un fichier sans lieu annoncé comme géolocalisé est l'échec
silencieux que tout le projet cherche à empêcher.

**Bloque :** non.

---

## [V1] Q-038 — Les branches de travail ne produisaient aucune prévisualisation

**Contexte :** le §7.7 bis du plan fait reposer le Gate 2 sur l'alias de prévisualisation de branche,
et note *« Configuration confirmée le 27/07/2026 — branche de production `main`, builds de branches
non-production activés »*. Sur la première PR de la V1, aucune des deux URL de prévisualisation n'est
publiée : le commentaire annonce « Deployment successful! » et pointe vers le chemin `production`.

Le tableau de bord montre que **Branch control est correct** — production `main`, builds de branches
non-production activés — et que le sous-domaine `mathieu-soysal.workers.dev` existe, avec production
et prévisualisations toutes deux activées et publiques. Les deux suspects évidents sont donc hors de
cause. Le défaut est dans **Build configuration** :

```
Deploy command:   npx wrangler deploy
Version command:  npx wrangler deploy      ← devrait être « npx wrangler versions upload »
```

La « Version command » est celle qu'emploient les branches non-production. Doc verbatim : *« The
non-production branch deploy command … defaults to `npx wrangler versions upload`, producing a
preview URL. »* Remplacée par `npx wrangler deploy`, elle demande une promotion en production au lieu
d'un simple téléversement de version — donc aucune prévisualisation n'est publiée, et le Gate 2
n'est pas exécutable.

**La promotion en production est constatée, pas déduite.** Deux mesures successives sur la même
branche, à trente minutes d'écart :

| Build | Empreinte servie par `geotager.app` | Verdict |
|---|---|---|
| `a8ec60a` | build antérieure, tableau à trois colonnes | production **intacte** |
| `3267562` | `radIGaju.js` — l'empreinte exacte de la branche | production **écrasée** |

Le second build a donc mis en ligne, sur le domaine public, du code d'une PR **ouverte et non
relue**. C'est mot pour mot l'accident que le §7.7 bis décrit. La première mesure avait conclu
l'inverse et cette conclusion a été retirée : elle était exacte à l'instant où elle a été prise, et
fausse comme généralité. Pourquoi le premier build n'a pas promu n'est pas établi depuis le dépôt et
n'est pas supposé ici ; ce qui compte est que le mécanisme est démontré.

**Remise en état :** corriger la « Version command », puis relancer la dernière build de `main` pour
ramener la production à du code relu. Tant que la première n'est pas faite, chaque poussée sur une
branche de travail remet le problème.

**Options :**
- **A.** Rétablir la « Version command » à `npx wrangler versions upload`. Réglage de tableau de
  bord : ni Wrangler ni le dépôt ne peuvent le porter, et l'interface d'administration disponible ne
  l'expose pas non plus.
- **B.** `npx wrangler versions deploy`. **Écarté, et c'est un piège** : cette commande *promeut* une
  version déjà téléversée vers la production. Elle produirait exactement l'accident que le §7.7 bis
  décrit, au lieu de l'empêcher.
- **C.** Laisser en l'état. Écarté : sans prévisualisation, rien de ce que le §7.7 fait reposer
  dessus n'est vérifiable avant la mise en production.

**Retenu : A — appliqué et vérifié le 27/07/2026.** La « Version command » a été passée à
`npx wrangler versions upload`, et les trois conséquences se sont inversées dans le même mouvement :

| Contrôle | Constat |
|---|---|
| Commentaire de PR | porte les **deux** URL, celle du commit et l'alias de branche |
| `geotager.app` | revenu à la V0 relue — quatre colonnes, « Geotagor » |
| Alias de branche | sert la V1 — cinq colonnes, « Geotager » |

Le Gate 2 est donc exécutable pour la première fois. Ce qu'il donne sur cette branche :

- les octets servis par la prévisualisation sont **identiques au bit près** à ceux de la build
  locale — `index.html`, la feuille de style, le bundle d'interface et le morceau du travailleur.
  Les 39 assertions du parcours en navigateur portent donc exactement sur l'artefact déployé ;
- `x-robots-tag: noindex` répond sur l'hôte de prévisualisation et **pas** en production : la parade
  de Q-019 et Q-027 est vérifiée sur un vrai hôte, ce qui n'avait jamais été possible ;
- la politique de sécurité de contenu servie porte `default-src 'none'` et
  `connect-src 'self' blob:`. Le zéro-tiers tient donc à trois niveaux : aucune URL tierce écrite
  comme ressource (contrôle de build), aucune émise à l'exécution (parcours), et aucune possible
  (le navigateur l'interdit) ;
- les actifs sont servis en `immutable`, un an.

Ce que l'épisode apprend, au-delà du réglage : le §7.7 bis notait déjà *« rien dans le dépôt ne
protège de ce réglage »*, et c'est vérifié — une confirmation datée dit ce qui a été vu un jour, pas
ce qui tient. Un garde-fou dans le dépôt, qui échouerait si une build promouvait en production depuis
une branche autre que `main`, a été proposé et n'a pas été retenu dans ce lot.

**Bloque :** **oui** pour le Gate 2, non pour la revue de la PR.

---

## [V1.1] Q-039 — Une case du tableau était à « oui » sans aucun code derrière

**Contexte :** le projet affirme que le tableau « ne peut pas mentir », parce qu'il est rendu depuis
`src/lib/exif/capacites.ts`, que le moteur lit aussi. C'est exact, mais plus étroit que la phrase ne
le laisse croire : ce qui est mécanique, c'est l'accord **tableau ⇄ moteur**, jamais l'accord
**case ⇄ test**. Aucun test n'importait `capacites.ts`.

La ligne des vidéos a vécu six mois à « Lire : oui ». Vérifié en exécutant le moteur : le sondage
s'arrête sur le format et rend `position: null` sans consulter aucun lecteur, et `exifr` n'ouvre ni
MOV ni MP4. La phrase affichée à l'utilisateur disait pourtant « Nous savons lire le lieu d'une
vidéo ». Le tableau mentait, et rien ne pouvait s'en apercevoir.

**Options :**
- **A.** Un scénario piloté par `MATRICE` qui **exécute réellement** chaque opération annoncée, sur
  une vraie photo du format, et qui exige qu'une ligne dépourvue de fichier témoin n'annonce rien.
  La discipline devient une propriété : une case ouverte sans preuve fait échouer la chaîne.
- **B.** Adosser la lecture vidéo à du code, pour rendre la case vraie. Écarté ici : sans fichier
  réel pour l'éprouver, on remplacerait une case fausse par une case non prouvée — voir Q-006.
- **C.** Corriger la ligne et s'en tenir là. Écarté : le défaut n'est pas cette ligne-là, c'est
  qu'aucun mécanisme ne l'aurait jamais signalée.

**Retenu : A**, appliqué. Le test a immédiatement trouvé la case fausse — c'est très exactement ce
pour quoi il existe —, et la ligne des vidéos est passée à « pas encore » sur les quatre colonnes.

Deux défauts voisins, trouvés en même temps et corrigés dans le même lot :

1. **Un bouton actif qui n'agissait pas.** L'application filtrait *toutes* les opérations par
   « peut-on écrire ? », effacement compris. Sur une photo dont on savait retirer le lieu sans
   savoir en ajouter un — cas réel du corpus —, le bouton « Effacer » était cliquable et ne faisait
   rien. Un bouton qui n'agit pas est pire qu'un bouton grisé : il laisse croire que le fichier a
   été traité.
2. **La liste de mots interdits du §5 était dédoublée**, en deux versions divergentes, appliquées à
   deux fichiers seulement. Six mots du §5 — « balise », « DMS », « décimal », « WGS84 »,
   « sidecar », « upload » — n'étaient vérifiés nulle part. Une seule liste désormais, complète,
   passée sur les **onze** phrases du parcours.

Enfin, le tableau du `README.md` est écrit à la main et pouvait dériver de `MATRICE` — c'est pourtant
le premier que lit quelqu'un qui découvre le projet. Un contrôle de build compare ses cellules à la
constante, et il a été vérifié **en échec** avant d'être vérifié au vert.

**Bloque :** non.

---

## [V1.2] Q-040 — Le décor reprend du mouvement, et il est calculé en JavaScript

**Contexte :** Q-009 avait retenu **A** — décor statique — avec **B** — formes figées animées en
`transform` — comme repli si le mouvement devenait indispensable. Il l'est devenu. Mais la forme
demandée n'est pas une forme figée qu'on déplace : c'est une silhouette dont le contour **se
déforme**, à la manière de Squoosh. Aucune propriété CSS ne sait faire cela sans revenir au
`border-radius` que `att_budget.md` §1 a classé BLOQUANT. La seule voie est de recalculer la
géométrie hors CSS.

**Options :**
- **A.** S'en tenir à Q-009 : pas de mouvement. Coût nul, et le décor ne raconte rien.
- **B.** Formes SVG figées, animées en `transform`/`opacity` seuls. Compositeur seul, zéro thread
  principal — mais le contour ne se déforme pas, et c'est précisément ce qu'on voulait.
- **C.** Une boucle `requestAnimationFrame` qui réécrit l'attribut `d` de trois `<path>` à chaque
  image, à partir d'une somme de sinus. Vraie déformation. **Travail sur le thread principal**, soit
  exactement la catégorie de coût que `att_budget.md` §1 a attaquée — d'où cette entrée.

**Retenu : C**, sous cinq conditions qui font toute la différence avec la maquette d'origine :

1. **Aucune propriété non compositable n'est animée.** Aucun `@keyframes`, aucun `border-radius`. Ce
   qui change est une géométrie SVG, pas une propriété CSS.
2. **Aucun `filter`, aucun `mix-blend-mode`, aucun `backdrop-filter`.** La douceur vient d'un
   `<radialGradient gradientUnits="userSpaceOnUse">` statique — le repère est la boîte de vue et non
   la boîte englobante du tracé, qui changerait à chaque image. `screen` a été écarté par le calcul :
   sur un fond à L ≈ 0,008 et une opacité ≤ 0,12, l'écart avec `source-over` vaut `a·B·(1−C) ≤ 0,011`,
   **moins de trois niveaux sur 255** — invisible, et il coûtait une lecture du fond par image.
3. **La surface est bornée**, `min(90vw, 40rem)`, et le calque est composé à part (`will-change`,
   `contain: strict`) : réécrire `d` ne repeint jamais la page derrière.
4. **La boucle s'arrête** dès qu'elle ne sert plus : héros hors écran (`IntersectionObserver` sur
   `.stage` — le calque étant `fixed`, l'observer sur lui-même ne dirait jamais rien), photo chargée
   (`MutationObserver` sur `#etat-actif[hidden]`, ce qui évite de toucher à `app.ts`), onglet caché.
   Elle ne démarre qu'après un `requestIdleCallback`, pour ne pas disputer le LCP au `<h1>`.
5. **`prefers-reduced-motion: reduce` est lu en JavaScript.** La règle générale de `global.css`
   (`* { animation: none !important; transition: none !important }`) **ne coupe pas une boucle rAF** :
   c'est le piège de cette option, et il est traité explicitement. Dans ce cas la boucle ne démarre
   jamais, et la forme affichée est celle **gravée dans le HTML au build** — le même module de
   géométrie est appelé par `Page.astro` et par le client, si bien qu'il n'y a rien à charger et rien
   qui saute.

**Ce que ça coûte, chiffres à l'appui :**

| | |
|---|---|
| JS ajouté | **MESURÉ : +1 070 o gzip.** Budget 48 374 → **49 444 o, 32,2 % des 150 Ko** |
| HTML ajouté | **MESURÉ : 3 × ~247 caractères** de tracé gravé, plus l'échafaudage `<svg>`/`<defs>` |
| Trigonométrie par image | **18 appels**, pas 216 : `sin(u + mθ)` est développé et `cos(mθ)`/`sin(mθ)` tabulés une fois |
| Coût par image | **MESURÉ : p95 de l'intervalle inter-image 16,8 ms** sous ralentissement CPU ×4 — la cadence d'écran, aucune image manquée |
| Mémoire de couche | ESTIMÉ 6,5 Mo @ 640 px DPR 2 ; 3,8 Mo @ 412 px DPR 2,625 — contre 10,4 Mo **par surface** au §1 de `att_budget.md` |
| CLS | **MESURÉ nul** : la boîte du `<h1>` est identique à 0 s et à 6 s. `position: fixed`, hors flux, boîte connue avant tout script |
| LCP | inchangé : un SVG en ligne n'est pas candidat LCP, et le `<h1>` ne bouge pas |

**Contraste — la contrainte qui a réellement dimensionné le décor.** `--muted #a49cac` sur
`--bg #17161b` vaut ≈ 6,8:1. Pour rester à 4,5:1, la luminance relative composite sous `.sub` et
`.formats` ne peut pas dépasser **0,0380** ; cible retenue **0,0292** (5:1). L'empilement de parité
avec la maquette (rose .22 / indigo .18 / teal .12) composite à **L = 0,0604 → 3,59:1, non conforme**.
L'empilement retenu — **rose .12 / indigo .09 / teal .06** — est **MESURÉ** au pire de seize secondes
d'animation, texte rendu transparent pour ne lire que le fond. Les décalages statiques par couche
interdisent aux trois maxima de se superposer, ce qui est ce qui tient la marge.

**Le calque est borné sur les deux axes**, `min(90vw, 90svh, 40rem)`. La largeur seule ne suffisait
pas : le calque est carré, et un téléphone couché — 844 × 390 — recevait un carré de 640 px dans une
fenêtre de 390 px de haut.

**Et une fenêtre basse demande un décor plus discret, ce que seule la mesure a montré.** Quand le
héros ne tient pas d'un seul tenant, le titre et le sous-titre naissent sous la ligne de flottaison ;
pour les lire il faut défiler, et comme le calque est `fixed` et centré, le texte vient
**nécessairement** croiser son centre — l'endroit le plus dense du dégradé. Mesuré sur écran haut, le
texte reste au contraire sous ce centre, là où le dégradé s'est déjà éteint. D'où deux paliers, aux
arrêts du dégradé plutôt qu'à l'opacité du calque, pour se composer avec `.repos`, `.parti` et le
glisser-déposer au lieu d'entrer en conflit de spécificité avec eux : **45 % sous 40 rem de haut,
22 % sous 26 rem**. Sans eux, 844 × 390 tombait à **4,05:1** et 740 × 360 à 4,49:1.

Matrice **MESURÉE** (luminance maximale du fond sous `.sub`, texte amené au centre de l'écran quand
il naît hors cadre — le mesurer sans défiler donnerait un chiffre flatteur qui ne décrit rien) :

| fenêtre | calque | tient | centré | derrière la bulle | L fond | ratio |
|---|---|---|---|---|---|---|
| 320 × 568 | 288² | oui | oui | oui | 0,0258 | 5,22:1 |
| 360 × 780 | 324² | oui | oui | oui | 0,0158 | 6,02:1 |
| 390 × 844 | 351² | oui | oui | oui | 0,0139 | 6,20:1 |
| **844 × 390** couché | 351² | oui | oui | oui | 0,0272 | **5,13:1** |
| **740 × 360** couché étroit | 324² | oui | oui | oui | 0,0326 | **4,79:1** |
| 1024 × 640 basse | 576² | oui | oui | oui | 0,0197 | 5,68:1 |
| 768 × 1024 | 640² | oui | oui | oui | 0,0251 | 5,28:1 |
| 1024 × 768 | 640² | oui | oui | oui | 0,0264 | 5,19:1 |
| 1440 × 900 | 640² | oui | oui | oui | 0,0221 | 5,49:1 |
| 2560 × 1440 | 640² | oui | oui | oui | 0,0178 | 5,84:1 |

Le pire cas est **4,79:1**, au-dessus du seuil de 4,5:1. Il reste sous la cible de 5:1 parce qu'à
cette taille l'essentiel de ce qui est mesuré n'est plus le décor mais les trois `radial-gradient`
statiques de `body`, que cette entrée ne touche pas.

**Une limite connue, hors de cette entrée :** sur une fenêtre basse, le `<h1>`, `.sub` et `.formats`
naissent sous la ligne de flottaison — à 844 × 390 la scène fait 577 px de haut. C'est **antérieur au
décor** et vérifié identique sur `main` : la scène est verrouillée à la hauteur de la fenêtre
(`min-height: 100svh`), et son contenu n'est pas compressé en dessous. Le décor n'y change rien ; il
s'y adapte seulement.

**Vérifié aussi :** décor hors de l'arbre d'accessibilité (`aria-hidden`, `pointer-events: none`,
aucun élément focalisable), centré à moins de 1,5 px du centre de la fenêtre, effectivement derrière
la bulle (`elementFromPoint` au centre de `.bubble` ne renvoie jamais le décor), immobile et
strictement égal à l'image gravée sous `reducedMotion: 'reduce'`, à l'arrêt une fois le héros sorti
de l'écran et reparti au retour.

**Bloque :** non.

---

## [V1.2] Q-041 — Un attribut `style` que la CSP refusait, et qu'aucun test ne servait

**Contexte :** le gabarit portait `style="display:flex;flex-direction:column;flex:1"` sur
`.app > .wrap`. La CSP du site est `style-src 'self'`, sans `'unsafe-inline'`. En CSP niveau 3,
`style-src-attr` se replie sur `style-src`, et `'self'` ne correspond jamais à un attribut en ligne :
**le navigateur refusait donc ces trois déclarations en production**, et la colonne ne s'étirait pas.
La feuille de style porte d'ailleurs déjà, deux lignes plus haut, un commentaire sur le fait qu'un
élément flex cesse d'être étiré — quelqu'un avait vu le symptôme sans en voir la cause.

Ce défaut est resté invisible parce que **le serveur du test de bout en bout ne posait aucun
en-tête** : il servait `dist/` avec le seul `content-type`. La page testée n'était pas la page
servie. C'est la classe de défaut la plus coûteuse — un contrôle qui existe, qui est vert, et qui ne
regarde pas ce qu'il prétend regarder.

**Retenu :** les trois déclarations passent dans `global.css`, sur la règle `.app > .wrap` qui
existait déjà, et l'attribut disparaît. Aucun changement de comportement voulu : cela **rétablit** ce
que la CSP empêchait.

Surtout, le serveur du test lit désormais la politique dans `public/_headers` et la sert. Elle est
**lue et non recopiée** : une politique recopiée dériverait de celle que sert l'hébergeur, et le test
finirait par valider une page que personne ne reçoit. L'assertion « aucune erreur JavaScript sur tout
le parcours » couvre les refus de la CSP, si bien que toute violation future échoue le lot — c'est
exactement ce contrôle qui a échoué avant le correctif, puis passé après.

Vérifié : `src/` ne contient plus aucun attribut `style`, aucun `setAttribute('style', …)` et aucune
écriture `.style.` — la boucle du décor n'écrit que l'attribut `d`, qui est une géométrie et non un
style, et le CSSOM n'est de toute façon pas régi par la CSP.

**Bloque :** non.

---

## [V1.2] Q-042 — Le décor prend des couleurs, et c'est le texte qui les paie

**Contexte :** le décor de Q-040 était juste, mesuré, et terne. Les opacités retenues
(rose .12 / indigo .09 / teal .06) ne venaient pas d'un choix esthétique : elles étaient tout ce que
le contraste autorisait. Le calcul est le même dans les deux sens — un fond ne peut pas dépasser la
luminance que le texte posé dessus rend illisible — et le texte du héros était `--muted #a49cac`,
d'où un plafond de **L ≤ 0,0380**. À ce plafond, quatre couleurs sur un fond sombre sont un murmure.

Demande : s'inspirer de Squoosh, et que ce soit un peu amusant. Squoosh peut se permettre des formes
franches parce que **son texte est clair**. C'est le vrai levier, et il n'est pas dans le décor.

**Retenu :** éclaircir le texte du héros — et seulement lui — pour acheter la couleur.

| | avant | après | plafond du fond |
|---|---|---|---|
| `.sub` | `--muted #a49cac` | `--clair #ded9e2` | 0,0381 → **0,1181** |
| `.formats` | `--muted #a49cac` | `--clair-mono #cfc9d4` | 0,0381 → **0,0940** |
| `h1 em` | `--pink #ff3385` | `--rose-clair #ff7fae` | 0,0511 → 0,0983 |

Le plafond contraignant passe de **0,0380 à 0,0940**, soit deux fois et demie de couleur en plus.
`--muted` n'est pas touché : ailleurs sur la page, aucun texte ne passe au-dessus du décor.

Le reste suit ce budget : une **quatrième couche ambre** (le jeton existait, il ne servait pas au
décor), des amplitudes portées de 0,175 à ~0,21 et des périodes raccourcies — le mouvement doit
s'apercevoir, pas se deviner — et un calque agrandi à `min(96vw, 94svh, 52rem)`.

**Deux corrections que seule l'image a montrées, et qu'aucune mesure n'aurait données :**

1. **Les recouvrements viraient au gris.** Quatre couleurs translucides en `source-over` sur un fond
   sombre ne s'additionnent pas, elles se neutralisent. `mix-blend-mode: screen` les garde lumineuses.
   **Cela revient sur l'argument de Q-040**, et il faut le dire : j'y avais écarté `screen` en
   calculant que l'écart avec `source-over` restait sous trois niveaux sur 255. Ce calcul était juste
   **à 0,12 d'opacité**. Il ne l'est plus à 0,27. Ce qui rend le blend acceptable ici n'est donc pas
   ce calcul mais **`isolation: isolate`** : le groupe de fusion se limite au calque, déjà borné et
   déjà composé à part. Les quatre formes se mélangent entre elles, **jamais avec la page** — le
   grief du §1 de `att_budget.md` visait une surface plein écran qui relit le fond à chaque image.
2. **Les formes se cumulaient vers le blanc.** Serrées sur un même centre, en `screen`, quatre
   couleurs donnent du blanc. Les décalages statiques sont passés d'environ ±15 à ±27 unités, et la
   boîte de vue de 200 à 220 : chaque teinte tient désormais son quartier. Le rayon du dégradé
   (76) est en outre passé **sous** le rayon maximal du tracé (~75 selon la couche), si bien que le
   remplissage s'éteint avant le bord : plus de contour net, et toujours aucun `filter: blur()`.

Un ressort, enfin, sur la bulle — `cubic-bezier(.34, 1.56, .64, 1)` dépasse 1 avant de revenir. Une
seule propriété, compositable, sur le seul geste qui compte.

**Contraste, MESURÉ** sur dix fenêtres, chaque texte contre **son** seuil (le `<h1>` est du grand
texte : `clamp(1.5rem, 3.6vw, 2.25rem)` en graisse 800, donc ≥ 24 px gras partout, seuil 3:1) :

| | pire mesuré | seuil | marge |
|---|---|---|---|
| `h1` | 6,84:1 | 3:1 | large |
| `h1 em` | **3,70:1** | 3:1 | +23 % |
| `.sub` | 7,33:1 | 4,5:1 | +63 % |
| `.formats` | 6,37:1 | 4,5:1 | +42 % |

Les paliers de fenêtre basse de Q-040 restent en place et gardent leur rôle.

**Bloque :** non.

---

## [V1.2] Q-043 — Ce qui remplit l'écran est statique, ce qui bouge est borné

**Contexte :** demande de pousser plus loin vers Squoosh, dont le fond vit d'un bord à l'autre. Le
décor de Q-042 restait un médaillon au centre. La réponse évidente — étendre le calque animé à toute
la fenêtre — a été essayée, mesurée, et retirée.

**Mesuré**, p95 de l'intervalle inter-image sur 120 images, calque étendu à la fenêtre :

| | tel quel | sans `screen` | boucle arrêtée |
|---|---|---|---|
| 1440 × 900 @DPR2 | 33,4 ms | 16,8 ms | 16,7 ms |
| 2560 × 1440 | **83,4 ms** | 50,1 ms | 16,8 ms |

Les deux facteurs comptent, et aucun ne se rattrape : le mélange double le coût, la surface fait le
reste. À 83 ms, c'est douze images par seconde sur un grand écran. Une réécriture de géométrie par
image ne passe pas à l'échelle de la fenêtre — c'est exactement ce que le §1 de `att_budget.md`
soutenait, vérifié cette fois sur le code réel plutôt que sur la maquette.

**Retenu : séparer ce qui remplit de ce qui bouge.**

- **Ce qui remplit l'écran est statique.** Les `radial-gradient` de `body` passent de trois à quatre
  (l'ambre répond à la quatrième forme) et deviennent francs : 0,42 / 0,36 / 0,26 / 0,20 contre
  0,28 / 0,30 / 0,16. Un dégradé radial coûte une passe de shader, une fois. Il peut donc couvrir
  toute la fenêtre sans rien coûter par image.
- **Ce qui bouge reste borné**, `min(96vw, 94svh, 52rem)`, avec son mélange et sa boucle.

**Mesuré après :** 16,7 ms à 1440 × 900 @DPR2 **et** à 2560 × 1440 — la cadence d'écran, aux deux
tailles, contre 83 ms avant. Le fond est plus coloré qu'à aucun moment, et la boucle a retrouvé son
coût d'origine.

**Contraste.** Des dégradés plus francs consomment le budget du texte : `.formats` est tombé à
4,28:1. Deux jetons éclaircis le rendent — `--clair-mono` rejoint `--clair` (#ded9e2) et
`--rose-clair` passe à #ff93bd. Matrice **MESURÉE** sur dix fenêtres, chaque texte contre son seuil :

| | pire | seuil | marge |
|---|---|---|---|
| `h1` | 6,49:1 | 3:1 | large |
| `h1 em` | 3,93:1 | 3:1 | +31 % |
| `.sub` | **4,81:1** | 4,5:1 | +7 % |
| `.formats` | 4,99:1 | 4,5:1 | +11 % |

Les marges sont plus minces qu'en Q-042 : c'est le prix de la couleur, il est mesuré, et il reste du
bon côté du seuil. `.sub` à 320 × 568 est le point le plus tendu et le premier à surveiller si les
dégradés devaient encore forcer.

**Bloque :** non.

## [V1.2] Q-044 — La carte devient un viseur, sur activation explicite

**Contexte :** Q-025 a retenu « coordonnées seules, aucune carte en V0 », et Q-003 « la carte n'est
pas un viseur ». Les deux s'appuient sur `docs/gate1/att_carte.md`, dont le §1 démontre qu'aucun
zoom entier ne satisfait `r ∈ [8,46 ; 10] m/px` — **avec `maxZoom = 14` et sans imagerie** — et
dont le §2 mesure un écran vide 77 à 94 % du temps, **parce qu'il n'y a que des contours
administratifs à afficher**. Ces deux calculs restent justes. Ils ne portent simplement plus sur le
même objet : avec de vraies tuiles, `metresParPixel(46,5°, 17) = 0,82 m/px` et l'écran n'est jamais
vide. Le test `Précision d'un clic — la table du Gate 1 fait foi` reprend la table de l'attestation
telle quelle, pour que toucher à la constante fasse échouer la build en pointant vers le document
où le nombre fait autorité.

Q-003 avait d'ailleurs prévu ce cas. Son option C — « on ajoute un fond de tuiles » — était admise
**sur activation explicite seulement**. C'est exactement le régime retenu ici : ce n'est pas un
revirement, c'est la porte que Q-003 avait laissée entrouverte, et qu'on franchit.

**Options :**

- **A.** Carte SVG maison sans tuiles (Q-008). Ne coûte aucune requête, et ne sait toujours pas
  viser : c'est précisément ce que l'attestation a démontré.
- **B.** Tuiles OpenStreetMap, carte repliée par défaut, module de carte chargé à la demande.
- **C.** Auto-héberger les tuiles (PMTiles sur R2). Supprime le tiers, et sort du périmètre : le
  rendu vectoriel demande MapLibre, écarté à 273 Ko gzip, et l'extrait ne tient pas dans les assets
  statiques.
- **D.** Intégrer Google Maps en `<iframe>`. **Techniquement incapable de rendre le service :** un
  cadre ne peut pas dire à la page qui le contient où l'utilisateur a cliqué. Écarté sur ce fait,
  avant même la question du coût ou du pistage.

**Retenu : B.** Le bouton « Placer sur une carte » est replié. Tant que personne ne l'ouvre, ni le
code de la carte ni une seule tuile n'est demandé — l'îlot les charge en `import()` dynamique, dans
un module de 1 640 o gzip. Le parcours complet du test de bout en bout tourne carte fermée et
continue d'affirmer, mot pour mot, « aucune requête vers un domaine tiers ». C'est ce contrôle
inchangé qui prouve que la fonctionnalité est facultative.

**Ce que cela coûte, et qui est écrit sur les deux pages :**

- « Aucune requête n'apparaît » devient « aucune requête n'apparaît tant que vous n'ouvrez pas la
  carte ». Les deux pages, les deux README et le test disent désormais la même chose.
- Les URL de tuiles disent à l'OSMF quelle zone est regardée. La carte ouvre donc au zoom 13, le
  quartier et non le pas de porte, et l'avertissement est affiché **avant** le clic.
- Les requêtes portent `Referer: https://geotager.app/`, et non rien. La politique d'usage de
  l'OSMF demande que le client s'identifie ; `referrerPolicy = 'origin'` est le plus petit accord
  possible avec l'en-tête `Referrer-Policy: no-referrer` du site. C'est écrit dans les deux pages.
- `Permissions-Policy: geolocation=()` n'est pas touché. Il n'y a pas de bouton « me localiser »,
  et le navigateur lui-même l'interdit.

**Le critère « aucune ressource tierce » avait un trou, et il est refermé au passage.** Les motifs
de `check-build.mjs` ne voient que des formes HTML et CSS. Une URL construite par concaténation en
JavaScript ne déclenchait aucun d'eux : un fond de carte tiers serait passé sans un mot. Un
contrôle §2 bis inventorie désormais toute URL absolue littérale du JavaScript servi, contre
l'union des listes blanches. Il naît vert — aucun fichier n'en plaçait dans le bundle — et il est
strictement plus fort que ce qui existait.

**`accuracyMetres` trouve enfin une source, et on n'en dit rien à l'écran.** Le champ est plumé
depuis l'origine jusqu'à `GPSHPositioningError` ; il n'avait aucune valeur honnête à quoi le
relier. Le zoom en est une. Mais `tiff.ts` saute ce champ sur la voie P1, et `conteneurs.ts` le
sait déjà : « La voie P1 ne peut pas ajouter d'entrée, donc pas inscrire une précision que le
fichier ne portait pas déjà. On ne l'annoncera pas. » L'interface ne l'annonce donc pas non plus.
Une précision inscrite sur certains fichiers et pas sur d'autres, présentée comme acquise, serait
exactement le genre de demi-vérité que le reste des tests existe pour empêcher.

**Bloque :** non.

---

## [V1.5] Q-045 — « Ouvrir avec » ouvrait une fenêtre, et n'y mettait rien

**Contexte :** l'outil s'inscrit dans « Ouvrir avec » depuis la V1.3. Sur Chrome et Edge de bureau,
un clic droit sur une photo ouvre bien la fenêtre de l'application, et rien n'y arrive : l'état
vide, sans un mot. Deux causes indépendantes, et chacune suffisait.

1. **Le rechargement de la première prise de contrôle.** La page se rechargeait sans condition dès
   qu'un service worker prenait le contrôle. À la toute première ouverture — ou après un vidage des
   données du site, une éviction du stockage, un désenregistrement — le document est chargé SANS
   contrôleur : le worker s'enregistre, s'active, réclame ses clients, et la page se recharge. Elle
   se recharge pour rien, puisqu'elle vient du réseau et qu'elle est déjà la plus récente ; mais
   `setConsumer` appelle son consommateur sur-le-champ, les fichiers du lancement sont donc déjà
   consommés, et ils sont remis une fois et une seule. Il n'y a rien à revenir chercher. Le bandeau
   de mise à jour savait pourtant faire exactement cette distinction, dix lignes au-dessus, depuis
   la V1.3.
2. **Aucun mot en cas d'échec.** Le chemin du lancement n'avait ni `try`, ni `catch`, ni délai. Les
   poignées étaient ouvertes par un `Promise.all` : une seule photo déplacée depuis que le système
   avait dressé sa liste faisait échouer le lot entier, en silence, et le rejet n'était rattrapé par
   personne. Un fichier annonçant zéro octet — un fichier resté dans un espace de stockage distant,
   typiquement — était écarté deux fois de suite, puis `charger` sortait sur une liste vide sans
   rien dire. Le chemin du partage, écrit trois semaines plus tôt, a un contrôle de contrôleur, un
   délai de trois secondes et une phrase visible. Le projet interdit l'échec silencieux ; celui-ci
   en avait deux, côte à côte, dans le même fichier.

Le registre lui-même a un trou, et c'est l'occasion de le nommer : tout le programme V1.3 et V1.4 —
installabilité, service worker, cible de partage, ouverture de fichiers, partage sortant — a été
livré **sans une seule entrée ici**, alors que la règle ajoutée au Gate 1 en exige une pour toute
divergence, « même quand la divergence est manifestement justifiée ». Une fonctionnalité livrée sans
entrée est une fonctionnalité que personne ne relit, et « Ouvrir avec » vient de montrer ce que cela
coûte.

**Options :**

- **A.** Le rechargement n'a lieu que si CETTE fenêtre a demandé la mise à jour. Chaque poignée est
  ouverte pour elle-même, avec un délai, et une ouverture dont rien n'est utilisable reçoit une
  phrase visible et annoncée, dans l'état qui est à l'écran. Le manifeste dit enfin dans quelle
  fenêtre une arrivée est posée, et un lot qui arrive REJOINT les photos déjà ouvertes.
- **B.** Se contenter de demander « y avait-il un contrôleur au chargement ? ». Retenu en plus de A,
  mais insuffisant seul : la condition est juste pour la première installation et ne dit rien du
  voisinage. `clients.claim()` atteint TOUTES les fenêtres, et l'une d'elles pouvait avoir quarante
  photos ouvertes et rien d'exporté.
- **C.** Ouvrir une fenêtre neuve à chaque lancement (`navigate-new`). Écarté : `client_mode`
  gouverne TOUS les lancements, et pas seulement « Ouvrir avec ». Cliquer l'icône de l'application
  ouvrirait une deuxième fenêtre vide à côté des quarante photos chargées dans la première. On
  échangerait une perte contre un abandon.
- **D.** Remplacer les photos ouvertes, mais l'annoncer. Écarté : une phrase ne rend pas un travail.
  Le projet refuse déjà le rechargement automatique pour cette raison exacte, en deux endroits.
- **E.** Garder `launch_type` à côté de `launch_handler`. Écarté : `launch_type` n'est lu par
  personne, et le commentaire au-dessus affirmait pourtant « une seule fenêtre reçoit tout le lot ».
  Un champ que rien n'applique n'est pas une garantie, c'est un commentaire. Deux déclarations qui
  peuvent se contredire ne valent pas mieux qu'une seule.

**Retenu : A**, avec la condition de B comme premier garde.

**Un lancement SANS fichier n'est pas un échec, et il fallait le décider.** Cliquer l'icône de
l'application passe aussi par la file de lancement, avec une liste de fichiers vide, et
`focus-existing` la remet à la fenêtre ouverte comme le reste. Annoncer « cette photo n'est pas
arrivée » à chaque clic sur l'icône aurait été un mensonge dit très régulièrement. La règle est donc
plus fine que « toute arrivée vide se dit » : une liste vide se tait, une liste non vide dont rien
n'est utilisable parle. Le test de bout en bout juge les deux séparément.

**Ce que la correction ne peut pas faire, et qui doit être écrit.** La moitié JavaScript n'atteint
une application déjà installée qu'au moment où son propriétaire accepte le bandeau. C'est voulu, et
il n'y a pas de manière honnête de contourner cela : rien n'est persisté ici, et un rechargement
imposé abandonnerait des photos. La moitié MANIFESTE, en revanche, n'avait aucune raison d'attendre
— et elle attendait quand même, le manifeste étant servi depuis le cache sans revalidation. C'est le
seul fichier du lot que le SYSTÈME lit pour son compte : il se demande désormais au réseau d'abord,
le cache derrière pour l'ouverture hors ligne. Les formats confiés et la fenêtre d'arrivée se
corrigent donc d'eux-mêmes, à la vérification que le navigateur fait déjà, sans que personne ait
rien à cliquer.

**Le plafond du lot cesse d'être muet, au passage.** `charger` coupait à trois cents fichiers depuis
la V1 sans le dire, et l'annonce rapportait le compte TRONQUÉ : elle affirmait donc avoir reçu moins
qu'on ne lui avait donné. Le défaut devenait plus facile à atteindre maintenant qu'un lot ouvert
depuis le système s'ajoute à celui qui est là.

**Trois défauts voisins, trouvés en même temps et corrigés dans le même lot :**

1. **Le contrôle de la cible de partage ne contrôlait rien.** Son motif était
   `\$\{?\w*\}?|partager`, dont la première branche accepte un simple « $ » — et `dist/sw.js` en
   contient toujours un, `geotager-${VERSION}` survivant à la substitution. Le contrôle passait donc
   sur n'importe quel worker, y compris sur un worker qui aurait cessé de reconnaître la cible : le
   404 que son propre commentaire dit prévenir serait parti en production sans un mot. Le worker
   porte maintenant une liste nommée, en guillemets doubles pour être relue par `JSON.parse` et non
   par une expression régulière de plus, et le contrôle exige que l'action déclarée y figure. Il a
   été vérifié en échec avant d'être vérifié au vert.
2. **Hors ligne, une page française manquante servait la page anglaise.** Le dernier recours rendait
   « / » pour n'importe quel échec de navigation. L'îlot lit `lang` sur le document servi, il ne
   devine pas la langue de l'adresse : toute l'interface basculait en anglais à une adresse
   française, ce qui est plus déroutant que la panne qu'on rattrapait. Le recours est celui de la
   langue demandée, comme il l'était déjà pour le partage entrant.
3. **Une fenêtre se rechargeait parce qu'une autre avait dit oui.** `SKIP_WAITING` est accepté de
   n'importe quel client, et l'activation réclame tous les clients : le clic d'une fenêtre
   rechargeait toutes les autres et emportait leurs photos non exportées. La règle 2 interdisait le
   rechargement imposé aux mises à jour, pas aux voisins. Le rechargement demande désormais que ce
   soit CETTE fenêtre qui l'ait demandé ; une fenêtre dont le worker en attente est déjà passé
   devant se recharge elle-même sur son propre clic.

**Ce que le lot ne prétend pas avoir vérifié.** Le troisième défaut n'a pas de test : le reproduire
demande deux builds successives dans le même banc, pour qu'un second worker existe et attende. Il
est corrigé et raisonné, il n'est pas prouvé. La correction du manifeste servi au réseau d'abord non
plus : elle se juge sur une installation réelle, à la vérification que le navigateur déclenche
lui-même.

**Bloque :** non.

---

## [V1.5] Q-046 — Le plan du site disait « mensuel » à un moteur qui ne l'écoute pas

**Contexte :** la demande était d'ajouter « des choses SEO : plan du site, robots.txt ». Elles
existaient déjà, et elles étaient bonnes : `robots.txt` avec sa ligne `Sitemap:`, un plan du site
bilingue avec ses `xhtml:link` et son `x-default`, un canonique auto-référent, des `hreflang`
réciproques, Open Graph complet avec une vraie image, une carte Twitter, du JSON-LD, un seul `<h1>`,
des repères sémantiques, et tout le contenu rendu côté serveur. Un audit déterministe rend zéro
erreur et zéro avertissement sur les deux pages. **Il n'y avait donc rien à ajouter là où on le
demandait, et quatre choses fausses ailleurs.**

1. `<changefreq>monthly</changefreq>` était écrit dans le plan du site. La documentation de Google
   est sans nuance : « Google ignores `<priority>` and `<changefreq>` values. » La balise
   n'annonçait rien à personne.
2. `<lastmod>` manquait, et c'est la seule des trois qui compte : « Google uses the `<lastmod>` value
   if it's consistently and verifiably accurate. »
3. L'adresse du site était recopiée trois fois — la configuration, la coquille, le plan du site.
   Trois occasions qu'un canonique, un `og:url` et un plan du site se contredisent, et un moteur qui
   reçoit des signaux contradictoires ne tranche pas en notre faveur : il les ignore.
4. Il n'y avait aucune page 404, et surtout aucun `not_found_handling` chez l'hébergeur — l'écrire
   sans l'activer n'aurait rien servi.

**Et surtout : rien ne surveillait ces deux fichiers.** `check-build.mjs` ne les mentionnait pas, le
test de bout en bout ne les demandait pas. Ce n'est pas une hypothèse : l'en-tête de
`sitemap-index.xml.ts` raconte que « `robots.txt` l'annonçait depuis le début sans que rien ne le
produise : le fichier renvoyait 404 ». Le défaut a vécu jusqu'à ce qu'un humain le remarque, dans un
dépôt qui attrape tout le reste par un contrôle bloquant. Ces fichiers-là ne sont lus QUE par des
machines : personne ne les ouvre, personne ne voit qu'ils sont faux, et ils sont la première chose
qu'un moteur demande.

**Options :**

- **A.** Corriger les quatre défauts, et adosser l'ensemble à un contrôle de build qui relit ce qui
  est réellement produit : `robots.txt`, le plan du site, les canoniques, les `hreflang` croisés des
  deux côtés, et le JSON-LD.
- **B.** Ajouter ce qui manque et s'en tenir là. Écarté : c'est ce qui a été fait en V1.3, et c'est
  exactement pour cela que le plan du site a pu renvoyer 404 sans que personne le sache.
- **C.** Dater `lastmod` à l'heure de la build. Écarté sur la lettre de la documentation : une date
  qui change à chaque déploiement sans qu'une ligne ait bougé n'est pas « verifiably accurate », et
  serait écartée par le moteur. La date vient de l'historique, et **s'il ne peut pas répondre, la
  balise n'est pas écrite.** Une absence est honnête ; une date inventée ne l'est pas.
- **D.** Renommer `sitemap-index.xml`, dont la racine est un `urlset` et non un `sitemapindex`.
  Écarté : cosmétiquement faux, fonctionnellement sans effet, et le renommer risquerait une
  soumission Search Console déjà faite pour zéro gain.

**Retenu : A.**

**Ce qui a été refusé, et pourquoi c'est une décision et non un oubli :**

- **`<meta name="robots" content="index, follow">`.** Google écrit que `all` « is the default value
  and has no effect if explicitly listed ». C'est une balise-talisman ; la seule page du site qui
  porte désormais une directive est la page 404, avec `noindex`.
- **`rel="nofollow"` sur les liens sortants** vers OpenStreetMap, GitHub, MDN et ExifTool. « For
  regular links that you expect Google to fetch and parse without any qualifications, you don't need
  to add a `rel` attribute. » Les qualifier retirerait un signal normal et suggérerait la défiance
  envers des sources qu'on cite justement pour se rendre vérifiable.
- **`FAQPage` et `HowTo`.** « Mode d'emploi » et « Ce qu'est une donnée GPS » en ont exactement la
  forme. `HowTo` est abandonné depuis 2023 et les questions-réponses ont été retirées de la
  recherche : les baliser ne produirait rigoureusement rien. Écrire un balisage pour un affichage qui
  n'existe plus, c'est se mentir dans un fichier que personne ne relit.
- **`notranslate`.** On publie une vraie version française ; laisser un moteur proposer une
  traduction aux autres langues est un gain, pas un risque.
- **Un `preconnect` vers l'hôte des tuiles**, que l'audit suggère par défaut. Il émettrait une
  requête tierce avant tout clic et détruirait la promesse que le §2 du contrôle de build et le
  journal de requêtes du test de bout en bout existent pour tenir. **À ne jamais « corriger ».**

**Ce que le plan du site vaut ici, écrit pour qu'on cesse d'y revenir.** D'après les propres critères
de Google — « about 500 pages or fewer », « comprehensively linked internally » — ce site n'en a pas
besoin. On le garde parce qu'il ne coûte rien et qu'il est déjà annoncé, pas parce qu'il rapporte
quelque chose. Il en va de même des trois nœuds de données structurées ajoutés : aucun résultat
enrichi, aucune vignette, rien de visible. Le seul gain est que les moteurs sachent relier
l'application, le site et son éditeur au lieu de le deviner.

**Une conséquence du format de sortie, à ne pas perdre.** La page 404 française sortait en
`fr/404/index.html`, un nom que l'hébergeur ne va jamais chercher. `build.format` passe donc à
`preserve` : les deux pages du site ne bougent pas — `index.astro` donnait déjà `index.html` — et la
page d'erreur sort en `fr/404.html`, qui est le seul nom servi.

**Le bouton vit sur la page de l'outil, et pas sur les guides.** Il avait d'abord été retenu de l'y
porter aussi — un visiteur qui arrive d'une recherche sur un guide est un candidat plausible. La
fusion avec la V1.6 a montré que celle-ci impose l'inverse et l'écrit : « Guides ship no JavaScript
at all », promesse tenue par deux contrôles du test de bout en bout. Y poser le bouton aurait donc
demandé de casser une promesse publiée dans les deux README et de supprimer deux contrôles écrits
exprès quelques jours plus tôt, pour un bouton que rien n'aurait pu découvrir sur une page sans
script — c'est-à-dire très exactement le « contrôle qui ne peut pas agir » que ce projet refuse
partout, invisible au lieu d'être grisé. La décision a été renversée devant ce coût. Les guides
ramènent à l'outil ; l'offre y est à un clic. Le contrôle de build refuse désormais les deux
débordements : le bouton absent de l'outil, et le bouton présent ailleurs.

**Ce que ce lot ne prouve pas.** Le test de bout en bout atteint les pages 404 par leur chemin : il
ne peut pas provoquer un vrai 404, puisque c'est l'hébergeur qui remonte au fichier le plus proche et
que le serveur du banc ne l'imite pas. Ce qui est jugé est la page ; le réglage qui la sert ne l'est
que par relecture. De même, la validation du JSON-LD produit et la soumission du plan du site
demandent des outils en ligne qu'aucun test local ne remplace.

**Bloque :** non.

---

## [V1.6] Q-047 — Quatorze pages dans un dépôt dont les contrôles n'en connaissaient que deux

**Contexte :** la demande était d'ajouter « des articles de blog utiles, du genre *comment changer le
géotag d'une photo* ou *comment vérifier le géotag d'une photo*, optimisés pour le référencement ».
Le site n'avait que deux pages, et un seul endroit où écrire de la prose : l'article sous la ligne de
flottaison de l'accueil, déjà long et déjà chargé de six sujets.

Le vrai sujet n'était donc pas d'écrire. C'était d'ajouter quatorze documents à un dépôt où **chaque
page est surveillée par des contrôles bloquants** — et où ces contrôles avaient été écrits pour deux
pages. Trois d'entre eux exigeaient de toute page indexable qu'elle porte les six blocs de prose de
l'accueil et qu'elle se décrive comme une `SoftwareApplication`. Un guide n'est ni l'un ni l'autre.
Il n'y avait que deux issues : élargir les contrôles pour qu'ils sachent de quelle sorte de page ils
parlent, ou les assouplir jusqu'à ce qu'ils ne regardent plus rien. La seconde est celle que
l'urgence choisit toujours, et c'est celle qui laisse ensuite une page sortir sans titre.

**Ce qu'on a trouvé en chemin, et qui n'avait rien à voir avec la demande.** `compressHTML`, activé
par défaut, ne réduit pas l'espace en fin de ligne : il le supprime. Dans un paragraphe écrit sur
plusieurs lignes — c'est-à-dire dans toute la prose de ce dépôt — un retour à la ligne suivi d'une
balise en ligne donnait « transmis à un<a>Web Worker</a> » et « <code>GPSLatitudeRef</code>vaut ».
**Ces deux-là étaient sur la page d'accueil, livrés depuis des mois.** Le défaut ne lève rien, ne
casse rien, n'apparaît dans aucun test : il ne se voit qu'en lisant la page, ce que personne ne fait
après la première fois.

**Options :**

- **A.** Un registre typé par langue (`src/lib/guides/`) qui porte l'adresse, le titre, la
  description et le résumé ; le sommaire, les liens croisés, les `hreflang`, le plan du site et les
  contrôles en dérivent. Les contrôles apprennent la notion de FAMILLE de page — outil, sommaire,
  guide — et exigent de chacune ce qui la définit.
- **B.** Une collection Markdown, comme le font la plupart des sites. Écartée : le contrat de
  traduction de ce dépôt est un type TypeScript, et c'est lui qui fait qu'une phrase oubliée est une
  erreur de compilation. Un dossier de fichiers Markdown ne sait pas dire qu'il manque la version
  française d'un article — il sait seulement ne pas la produire, et le plan du site l'annoncerait
  quand même.
- **C.** Allonger l'article de l'accueil. Écarté : une page qui répond à onze questions ne se
  positionne sur aucune, et surtout elle n'est pas ce qu'on vient chercher quand on tape une
  question précise.
- **D.** Assouplir les contrôles. Écarté, et c'est l'entrée entière.

**Retenu : A.** Six guides par langue, plus un sommaire. Les adresses diffèrent d'une langue à
l'autre (`/guides/remove-photo-location/` et `/fr/guides/supprimer-geolocalisation-photo/`) : une
adresse partagée serait une adresse fausse dans une des deux langues.

**Ce que les contrôles savent désormais refuser, et qui ne se voit pas à l'écran :**

- une page dont la FORME est inconnue — mieux vaut faire échouer la build que laisser sortir un
  document que rien ne regarde ;
- un guide de moins de sept cents mots. Le compte est affiché à chaque build, pas seulement comparé :
  un plancher qu'on ne voit qu'en l'atteignant ne dit jamais de combien on s'en approche ;
- un guide sans paragraphe de réponse en tête. C'est une règle éditoriale tenue par un contrôle,
  parce qu'elle ne survit pas autrement à la quinzième page écrite un soir de fatigue ;
- un guide qui ne figure au sommaire d'aucune langue, ou qui ne ramène ni à l'outil ni au sommaire ;
- un lien alternatif qui ne désigne aucune page produite. Le contrôle des `hreflang` ne regardait que
  les LANGUES déclarées, jamais les adresses : sans conséquence à deux pages, plus du tout à seize ;
- un `@id` de données structurées que rien ne définit. Un guide DÉSIGNE l'application plutôt que de
  la redéfinir — c'est l'usage même d'un `@id`, et cela évite de déclarer douze fois une application
  qui n'est pas sur la page. Le prix est qu'une référence peut tomber dans le vide sans que rien ne
  le signale : ni erreur de console, ni page cassée, seulement un graphe qui a cessé de dire ce qu'on
  croit qu'il dit ;
- un mot collé à sa balise, dans n'importe quelle page — le §3 bis, né du défaut ci-dessus.

**Ce qui a été refusé, et pourquoi c'est une décision et non un oubli :**

- **`FAQPage` et `HowTo`, une seconde fois.** Six guides sur sept en ont exactement la forme, et la
  tentation était plus forte ici que sur l'accueil. La réponse de Q-046 n'a pas changé : `HowTo` est
  abandonné depuis 2023, les questions-réponses ont été retirées de la recherche. `BreadcrumbList`
  est ajouté, lui, et pour la raison inverse : le fil d'Ariane s'affiche encore dans une page de
  résultats. Il est accompagné d'un vrai fil d'Ariane dans la page — un balisage qui décrit une
  navigation absente décrit une page qu'on ne sert pas.
- **`llms.txt` et un balisage « pour les IA ».** Google écrit qu'aucun des deux n'est nécessaire pour
  apparaître dans ses réponses génératives, et aucun moteur majeur ne s'engage sur `llms.txt`.
- **Des chiffres.** Les guides ne citent aucun pourcentage sur ce que les réseaux sociaux retirent.
  Les sources qui en donnent — « 89 % des photos en mode compressé en 2026 » — sont des pages écrites
  pour se positionner, et le chiffre est invérifiable. Les guides expliquent le MÉCANISME, qui est
  vrai et qui survit à une refonte d'application, puis donnent le protocole en quatre étapes pour que
  le lecteur mesure son propre cas.
- **Des liens vers les pages d'aide d'Apple et de Google.** Ils auraient valu pour la crédibilité,
  et deux adresses sur trois se sont révélées mortes ou redirigées à la vérification. Rien ici ne
  surveille un lien sortant : en ajouter qu'on ne peut pas contrôler, c'est s'engager à publier des
  404 un jour prochain. Les gestes sont donc décrits, et la seule source citée reste ExifTool, qui
  est déjà dans la liste blanche et qui, lui, ne bouge pas.
- **Des dates de publication tirées de l'heure de build.** Même règle qu'au `lastmod` de Q-046 : la
  date vient de l'historique git, et si personne ne peut répondre, la balise n'est pas écrite.
- **Le décor et les scripts sur les guides.** Astro réunit les scripts hissés en un seul paquet :
  embarquer la décoration amènerait tout `app.ts` sur une page sans outil. Et le calque décoratif est
  calibré pour que le texte du HÉROS reste lisible par-dessus ; sans script pour l'effacer, il
  resterait à pleine opacité sous mille mots de prose, c'est-à-dire sous le seul endroit où la mesure
  de contraste n'a jamais été faite.

**Sur la méthode, puisque la demande disait « optimisé pour le référencement ».** Le connecteur
Ahrefs de cette session refuse les points d'entrée de recherche de mots-clés — plan insuffisant.
**Aucun volume de recherche n'a donc été mesuré, et aucun n'est cité.** Les six sujets viennent des
intentions que l'outil sert déjà et des questions que les pages de résultats posent réellement ;
c'est un choix raisonné, pas une mesure, et il faut le dire plutôt que d'inventer des chiffres.

**Ce que ce lot ne prouve pas.** Rien ici ne démontre qu'une page se positionnera. Les contrôles
attrapent ce qui est vérifiable sur l'artefact produit — le titre, la description, le canonique, les
langues, le balisage, l'épaisseur du texte, l'absence de page orpheline. Le classement se mesure dans
la Search Console, des semaines plus tard, et aucun test local ne le remplace.

---
## [V1.5] Q-048 — L'application était installable, et personne ne le proposait

**Contexte :** l'outil est installable depuis la V1.3. Le manifeste porte tout ce qu'un navigateur
exige — `id`, `start_url`, `scope`, `display: 'standalone'`, une icône 192, une 512, une 512
masquable — et le service worker répond aux requêtes. Chromium émettait donc déjà son invitation à
installer sur ce site. **Personne ne l'écoutait.** L'installation n'était offerte que par le menu du
navigateur, que presque personne n'ouvre. Recherche dans tout le dépôt de `beforeinstallprompt`,
`appinstalled`, `getInstalledRelatedApps`, `display-mode` : zéro occurrence.

La demande venait avec une contrainte : **le bouton ne doit apparaître que si l'application n'est pas
déjà installée.**

**Options :**

- **A.** Un bouton qui naît caché dans le HTML servi, et que seule l'invitation du navigateur
  découvre.
- **B.** Un bouton toujours affiché, qui ouvre une explication quand l'installation n'est pas
  possible. Écarté : c'est exactement « un bouton qui n'agit pas », que le projet refuse ailleurs
  nommément. Et il resterait affiché pour qui a déjà installé, c'est-à-dire l'inverse du demandé.
- **C.** Interroger `navigator.getInstalledRelatedApps()` pour savoir si l'application est déjà là.
  Écarté : il faudrait ajouter `related_applications` au manifeste, l'interface n'existe que sur une
  partie des navigateurs, et elle ne répondrait à une question à laquelle l'absence d'invitation
  répond déjà. Un mécanisme de plus pour un fait qu'on connaît sans lui.
- **D.** Un bandeau, comme celui des mises à jour. Écarté : c'est la forme que les gens ont appris à
  fermer sans lire, et elle recouvre le seul geste qui compte — déposer une photo.

**Retenu : A.**

**Pourquoi cela suffit à ne l'afficher que si l'application n'est pas installée**, et pourquoi cela
ne tient pas à un seul mécanisme :

1. Il naît `hidden` dans le HTML servi. L'état par défaut, pour tout le monde, est « absent » : il
   faut un événement pour le faire apparaître, jamais l'inverse. Une régression échoue donc du bon
   côté.
2. Seule l'invitation le découvre — et un navigateur n'en émet pas quand l'application est déjà
   installée. C'est le verrou principal, et c'est la plate-forme qui le tient, pas nous.
3. `dejaInstallee()` refuse de le montrer si la page tourne dans la fenêtre installée
   (`display-mode`, et `navigator.standalone` sous iOS), même si une invitation arrivait tout de
   même.
4. `appinstalled` le retire sur-le-champ, sans attendre un rechargement.

Le test de bout en bout juge les quatre séparément, pour qu'aucun ne puisse tomber en silence
derrière un autre.

**Ce qui a été refusé, et pourquoi c'est une décision et non un oubli :**

- **Mémoriser un refus.** Refermer la boîte du navigateur ne laisse aucune trace. Ce site ne
  persiste rien — ni `localStorage`, ni `IndexedDB`, ni serveur — et c'est une promesse affichée sur
  les deux pages. Y faire une exception pour se souvenir qu'on a dit non coûterait plus que cela ne
  rapporte, d'autant que le navigateur décide déjà lui-même de la fréquence à laquelle il repropose.
- **Renifler le navigateur pour aider iOS.** Une phrase « Partager → Sur l'écran d'accueil » serait
  utile, et elle exigerait de deviner le navigateur à sa chaîne d'identification — ce que ce dépôt
  n'a jamais fait nulle part. Écarté pour cette raison, pas par indifférence. À rouvrir si quelqu'un
  le redemande.
- **Un état inactif.** Le bouton n'en a aucun, donc pas d'`aria-disabled` et pas
  d'`aria-describedby` : il est là et il marche, ou il n'est pas là. C'est la forme la plus simple
  de la règle du projet, et elle ne s'obtient que parce qu'on a refusé l'option B.

**Le contrôle de build ne surveillait pas ce dont l'installation dépend.** Le §8 vérifiait `id`,
`scope`, `start_url`, l'existence des icônes et la présence d'une masquable. Il ne regardait ni
`name`, ni `short_name`, ni `description`, ni `display`, ni qu'il existe une icône de 192 et une de
512 — c'est-à-dire précisément les champs sans lesquels un navigateur n'émet jamais son invitation.
Tant que l'installation passait par son menu, en perdre un serait passé inaperçu. Depuis qu'un
bouton en dépend, la même perte le ferait disparaître de la page pour tout le monde, sans message et
sans erreur. Le §8 les contrôle désormais, et le §3 exige que le bouton soit présent **et** `hidden`
dans le HTML servi : perdre cet attribut l'afficherait partout, y compris là où il ne peut rien
faire.

**Ce que ce lot ne prouve pas.** Le test remet à la page exactement ce que le navigateur lui
remettrait, mais il ne peut pas provoquer une vraie invitation : elle est décidée par le navigateur
sur des critères qu'aucun test ne pilote. Ce qui est jugé est donc ce que la page en fait, et non le
fait qu'elle arrive. De même, `emulateMedia` de Playwright ne connaît pas `display-mode` : la fenêtre
installée est simulée en truquant `matchMedia`, ce qui vérifie notre garde et non le comportement
réel du système. Le parcours complet — installer, désinstaller, rouvrir — se vérifie à la main sur
Chrome ou Edge de bureau.

**Bloque :** non.

---

## [V1.5] Q-049 — Le bouton déduisait l'installation au lieu de la vérifier

**Contexte :** le chapitre « Installation » de *Learn PWA* et les pages auxquelles il renvoie ont été
lus après coup, sur le bouton déjà livré en Q-048. **L'essentiel était conforme** : le bouton
n'apparaît qu'après l'invitation du navigateur — « Do not show the install button unless the
`beforeinstallprompt` has been fired » —, il appelle `preventDefault()` pour supprimer la barrette
que le navigateur poserait sinon, il écoute `appinstalled`, et un bouton fixe en tête de page est
l'un des emplacements que la documentation catalogue elle-même. Restaient quatre écarts.

1. **On ne savait pas reconnaître une application installée depuis un onglet ordinaire.** Le seul
   qui compte. Le bouton restait caché parce que le navigateur n'émet pas d'invitation pour une
   application déjà posée : c'est une déduction, pas une vérification.
   `getInstalledRelatedApps()` répond pour de bon, et `related_applications` dans le manifeste est ce
   qui le permet.
2. **La liste des modes d'affichage était incomplète** : deux testés sur les cinq que l'assistant de
   la documentation énumère, et le cas d'une application Android empaquetée — reconnaissable à
   `document.referrer` — n'était pas traité du tout.
3. **L'ordre du clic était inversé.** Le modèle est `prompt()`, puis `userChoice`, puis ranger. On
   cachait le bouton AVANT de demander : s'il ne se passait rien, il avait déjà disparu pour rien.
4. **`prefer_related_applications` devenait dangereux** dès qu'on ajoutait `related_applications` :
   à vrai, le critère d'installabilité cesse d'être rempli, plus aucune invitation n'est émise, et
   le bouton disparaît de toutes les pages sans que rien ne casse.

**Retenu : les quatre corrections**, plus deux contrôles de build — `prefer_related_applications`
refusé à vrai, et `related_applications` exigé bien formé et pointant sur des manifestes réels.

**Une croyance corrigée, et elle mérite d'être écrite.** La liste publiée des critères
d'installabilité **ne mentionne ni service worker, ni gestionnaire `fetch`, ni capacité hors ligne**.
Elle tient en : application pas déjà installée, heuristiques d'engagement, HTTPS, et un manifeste
portant `short_name` ou `name`, des icônes de 192 **et** 512, `start_url`, un `display` autonome, et
`prefer_related_applications` absent ou faux. `display_override` n'y figure pas davantage : c'est
`display` seul qui est jugé. Les contrôles ajoutés en Q-048 visaient donc les bons champs — mais
écrits de mémoire, pas d'après la source. Le commentaire la cite désormais.

**Ce qu'on continue de refuser, et l'argument a changé :**

- **Mémoriser un refus.** La documentation le recommande : « If the user dismisses your banner,
  don't show it again unless the user triggers a conversion event. » On maintient le refus, et il
  faut être honnête sur pourquoi. Ce conseil vise les **bandeaux**, qui recouvrent le contenu et
  reviennent à chaque page ; un bouton discret en tête de page ne harcèle personne, et le navigateur
  limite déjà de lui-même la fréquence à laquelle il réémet ses invitations. À quoi s'ajoute la
  raison de fond, inchangée : ce site ne persiste rien, et c'est une promesse affichée sur les deux
  pages.
- **Des consignes sous iOS.** La documentation recommande explicitement de rendre des instructions
  manuelles là où aucune interface n'existe, et de ne les montrer qu'en mode navigateur : « You
  should only render these instructions in browser mode ; other display options … mean the user has
  already installed the app. » On maintient le refus, parce qu'il faudrait deviner le navigateur à
  sa chaîne d'identification et que ce dépôt ne l'a jamais fait. **Mais la recommandation est
  consignée ici pour que la décision puisse être rouverte en connaissance de cause** — c'est la
  seule chose qu'un visiteur d'iPhone perd, et elle n'est pas nulle.

**Ce qui n'est pas fait, et n'a pas à l'être.** Le fichier sous `/.well-known/` ne sert qu'à
reconnaître une application **hors de sa portée**, ce dont on n'a pas besoin puisqu'on ne cherche que
la nôtre. Les icônes de 384 et 1024 sont recommandées, pas exigées, et la 512 est celle qui compte.
Et aucune mesure d'audience : `userChoice` est attendu pour l'ordre des opérations, jamais pour
compter quoi que ce soit — la documentation propose de s'en servir en analytique, ce site n'en a pas
et n'en aura pas.

**Ce que ce lot ne prouve pas.** Le cinquième verrou est jugé sur une réponse truquée : le banc
répond « installée » à la place du navigateur. Que le vrai `getInstalledRelatedApps()` reconnaisse
notre `related_applications` ne se vérifie que sur une machine où l'application est réellement
installée, en rouvrant le site dans un onglet ordinaire. C'est précisément le cas que ce lot ajoute,
et c'est le seul qu'aucun test local ne remplace.

**Bloque :** non.

---

## [V1.7] Q-050 — Le corpus vidéo existait, et la recherche l'avait manqué

**Contexte :** Q-006 puis Q-039 ont fermé la ligne des vidéos, et la deuxième l'a fermée jusqu'à la
lecture — vérifié en exécutant le moteur : aucune ligne de code ne lisait une vidéo. Le blocage
retenu n'était pas du code, c'était **un fichier** : « Recherche menée le 27/07/2026, toutes
négatives : `ianare/exif-samples`, `drewnoakes/metadata-extractor-images`, `Exiv2/exiv2`,
`exiftool/exiftool`, `gopro/gpmf-parser`, `google/spatial-media` ne contiennent aucun
`.mov`/`.mp4`/`.m4v`/`.3gp` ».

**Cette conclusion était inexacte sur deux des six dépôts cités**, et c'est tout le lot :

- `exiftool/exiftool` porte bien `t/images/QuickTime.mov` — 3 871 o, sous la licence Artistic/GPL de
  sa distribution. Il n'a **aucune boîte de tête** : il commence directement par la description des
  pistes, ce qui est parfaitement légal en QuickTime — la boîte de type est une invention MP4,
  arrivée après. C'est précisément ce qui le rendait « inconnu » pour notre reconnaissance de format.
- `gopro/gpmf-parser` porte `samples/hero6.mp4` — 8 878 253 o, Apache-2.0, donc **dans** l'allowlist.
  Une vraie HERO6, avec un lieu écrit par l'appareil (`+33.1265-117.3272/`) **et** une piste dont la
  description est `gpmd`, avec vingt-trois charges `GPS5` dans les données. C'est-à-dire l'objection
  centrale de Q-006, disponible sous forme de fichier.

S'y ajoute `bear.mp4` de `chromium/chromium` (41 358 o, BSD-3-Clause) : un vrai MP4 sans lieu, qui
éprouve la création. Les trois sont inscrits dans `CREDITS.md`, et la réserve sur Artistic/GPL est
traitée comme celle de `drewnoakes` — hors allowlist, nommée, et jamais distribuée.

Deux d'entre eux reçoivent leur lieu de départ d'ExifTool, selon le patron déjà retenu en Q-035, et
dans **trois rangements différents à dessein** : notre lecteur doit comprendre les trois.

**Retenu : les quatre colonnes s'ouvrent**, chacune adossée à un discriminant exécuté sur un fichier
réel. Voici, une par une, les quatre objections de Q-006 et ce qu'elles deviennent.

**1. `@xyz` (Samsung) et 2. `com.apple.quicktime.location.ISO6709`.** Lus, réécrits et effacés comme
les autres. Cinq rangements sont couverts : la forme simple, la variante Samsung, la liste d'éléments
qu'écrit Google Photos, les clés nommées d'Apple, et la forme 3GPP. Et la règle qui compte est le
**tout ou rien** : ils sont tous réécrits ensemble ou aucun ne l'est. Un fichier dont un rangement
dit Avignon et dont l'autre dit encore San Diego serait un mensonge de plus, pas un demi-succès.

**3. `location.name` — le lieu en toutes lettres.** C'était le reproche le plus juste : « le balayage
résiduel cherche des coordonnées, pas des toponymes ; il rendrait "aucun résidu" sur un fichier qui
dit "Avignon" en clair ». Le balayage cherche désormais les deux. La forme 3GPP range le nom de la
ville juste avant les coordonnées, et le paquet de texte descriptif porte `photoshop:City`,
`photoshop:Country` et `Iptc4xmpExt:LocationCreated` — la purge de `xmp.ts`, écrite pour les photos,
s'applique telle quelle. Deux fichiers l'éprouvent : l'un qui nomme la ville **à côté** des chiffres,
l'autre qui la nomme **sans aucun** chiffre. Le test vérifie aussi que le mot n'est plus présent dans
les octets, et que l'auteur, lui, a survécu.

**Ce que cette garantie ne couvre pas, et il vaut mieux l'écrire que le laisser supposer :** nous
garantissons que les champs *prévus pour un lieu* sont vides, pas qu'aucun mot du fichier ne désigne
un endroit du monde. « Avignon » glissé dans un commentaire libre passerait. Nous n'avons pas de
dictionnaire de noms de lieux, et prétendre en avoir un serait le second mensonge.

**4. Les pistes horodatées, qui vivent dans les données.** Elles ne sont pas touchées — et leur
présence **ferme les trois écritures** au lieu d'être ignorée. Une piste de description `gpmd`,
`camm`, `mett` ou `rtmd`, ou une charge `GPMF`, et le fichier est rendu intact avec sa phrase. Fermer
« Corriger » autant qu'« Effacer » est le point : réécrire le lieu visible en laissant vingt-trois
relevés seconde par seconde produirait un fichier qui *affiche* un lieu et en *révèle* un autre.
C'est ce que fait `hero6.mp4`, et le test vérifie que l'opération **lève**, pas qu'elle réussit — et
que le refus est fondé, en comptant les relevés que l'oracle trouve avec l'option `-ee`.

**Les deux voies d'écriture.** Une chaîne de position peut s'écrire avec plus ou moins de décimales :
sa longueur vaut dix caractères plus le nombre de décimales. On choisit donc le nombre de décimales
qui retombe sur la longueur exacte de la chaîne d'origine, et **aucun octet ne bouge** — le fichier
produit a la taille de l'original. Quand la chaîne en place est trop courte, cette voie est refusée
plutôt que forcée : dix-huit caractères ne portent que quatre décimales par côté, soit une grille de
onze mètres, quand le contrôle final du moteur exige le mètre. On efface alors tous les rangements et
l'on en écrit un seul, assez long — ce qui fait grandir le fichier, et demande donc la même permission
qu'un ajout. **Le moteur relit toujours ce qu'il vient d'écrire avant de le retenir.**

Même mesure pour la forme 3GPP, et elle est contre-intuitive : ses degrés sont notés en virgule fixe
sur seize bits, donc par pas d'un soixante-cinq-millième de degré — **un mètre sept en latitude**. Le
pas de la grille y est plus large que notre tolérance ; ce rangement-là passe donc toujours par la
voie qui fait grandir, bien que sa largeur ne varie jamais.

**Ce que l'ajout exige.** Faire grandir la description n'est sûr que si l'on sait retrouver tout ce
qui désigne un octet par son rang. Un fichier fragmenté range ces rangs à des endroits que ce module
ne réécrit pas : on le refuse. Un rang qui pointe au-delà de la fin du fichier signale une structure
qu'on n'a pas comprise : on refuse aussi. Sinon, les tables de tronçons sont reprises une par une, et
le test prouve la chose qui compte sur un fichier de plusieurs mégaoctets : **les images et le son
sont intacts octet pour octet**, mesuré sur les octets et non sur une taille.

**Ce que ce lot ne prouve pas.** Le contrôle croisé d'une photo repose sur un **second lecteur écrit
par d'autres**. Pour une vidéo, il n'existe pas dans un navigateur : `exifr` n'ouvre ni MOV ni MP4.
Deux contrôles à nous le remplacent — la structure est reparcourue depuis le premier octet et chaque
parent doit être exactement rempli par ses enfants, ce qui attrape le défaut réellement redouté ici,
l'arithmétique des tailles ; et tous les rangements doivent s'accorder sur la même réponse. Le vrai
lecteur indépendant, ExifTool, passe en intégration continue, sur de vrais fichiers, colonne par
colonne. C'est moins que pour une photo, et le README le dit aussi.

Restent hors du lot, faute de fichier pour les éprouver : les fichiers fragmentés (refusés sans
qu'aucun test ne le montre), et l'écriture dans un espace libre existant pour corriger sans grandir
une chaîne trop courte — aucune case n'en dépend.

**Enfin, un défaut voisin, trouvé en écrivant les tests.** L'inventaire qui prouve que « tout le reste
est préservé » excluait les tags `[GPS]`. ExifTool range le lieu d'une vidéo sous `[UserData]`,
`[Keys]` ou `[ItemList]`, **jamais** sous `[GPS]` : l'inventaire aurait donc comparé une position à
une position, et signalé comme une perte le changement qu'on venait de demander.

**Bloque :** non.

---

## [V1.7] Q-051 — Le contrôle censé remplacer le second lecteur refusait toutes les vidéos

**Contexte :** Q-050 a ouvert les quatre colonnes des vidéos, et a écrit qu'à défaut d'un second
lecteur — `exifr` n'ouvre ni MOV ni MP4 — deux contrôles à nous le remplaçaient, dont un qui
reparcourt la structure et exige que chaque parent soit exactement rempli par ses enfants.

**Ce contrôle refusait TOUTES les vidéos réelles.** Signalé par un utilisateur, capture à l'appui :
un vrai MP4 Android de 2,4 Mo sans lieu, le champ de coordonnées actif, le bouton actif, un lieu
saisi — et « No file could be produced. Your originals were not modified. »

C'est le défaut que ce projet nomme et interdit depuis Q-039 : **un bouton actif qui n'agit pas.**
L'annonce et le comportement divergeaient, et la vidéo est le seul format où rien ne vérifiait leur
accord.

La cause tient en une ligne. `structureIntacte` descendait dans **toutes** les boîtes, feuilles
comprises. `enfants()` lit des octets ; elle n'a aucun moyen de savoir qu'on lui présente une
feuille, et elle ne le prétend pas. La charge utile d'un `tkhd` est faite de nombres, et des nombres
se lisent très bien comme des en-têtes : un `tkhd` de drapeaux 15 produit une boîte fantôme de
quinze octets, qui ne remplit évidemment pas son parent. `structureIntacte` rendait donc `false`,
`croise` devenait `false`, et `appliquer()` rendait `RELECTURE_CROISEE_DIVERGENTE` — que
l'interface, pour un fichier seul, affiche sous sa phrase générique.

Mesuré sur treize vidéos réelles — les fichiers du corpus plus sept MP4 de `chromium/chromium`,
H.264, HEVC, AV1, trois rotations, muet : l'écriture échouait sur **toutes**, et l'effacement aussi,
puisque le contrôle était déjà faux sur le fichier d'ENTRÉE. Seule la lecture marchait, ce qui
explique que le lieu s'affichait.

**La vraie faute n'est pas la ligne, c'est l'endroit.** `structureIntacte` vivait dans
`exif.worker.ts`, que `test/engine.test.ts` n'importe pas — il tire `self`, `exifr` et le protocole
de messages. Aucun test ne pouvait l'atteindre. Les scénarios vidéo appelaient le moteur en direct
et sautaient donc `appliquer()` tout entier ; le parcours navigateur chargeait bien une vidéo, mais
ne vérifiait que l'état de l'interface — **il ne cliquait pas.** 514 tests moteur et 302 de bout en
bout au vert, sur un chemin dont personne n'exécutait la seconde moitié.

**Retenu :**

1. **La notion « cette boîte en contient d'autres » devient publique.** `bmff.ts` la portait déjà,
   dans la constante privée dont `toutesLesBoites` se sert pour ne pas descendre dans `mdat` — elle
   était au bon endroit et n'était pas partagée. Elle s'exporte, et la documentation d'`enfants()`
   dit désormais que l'appelant doit savoir ce qu'il lui présente.
2. **Le contrôle déménage dans `quicktime.ts`.** C'est ce qui le rend éprouvable. `sonderVideo` a
   exactement ce statut — partagée entre le worker et le test pour qu'ils ne puissent pas
   diverger —, et le contrôle d'après écriture aurait dû l'avoir dès le premier jour.
3. **Et il s'éprouve dans les deux sens.** Une taille de parent volontairement fausse, trop courte
   puis trop longue, doit le faire échouer. Un contrôle qu'on n'a jamais vu échouer n'est pas un
   contrôle — c'est la leçon de Q-039, appliquée cette fois à la vérification elle-même.
4. **Le parcours navigateur va jusqu'au fichier.** Il clique, récupère le fichier produit et le fait
   relire par l'oracle, pour l'ajout comme pour l'effacement. Vérifié en réintroduisant le défaut :
   le parcours échoue, faute de fichier à récupérer.

**Ce que la correction ne couvre pas, et il vaut mieux l'écrire.** Si c'est `udta` — et non `moov` —
qui garde son ancienne taille, la structure reste cohérente : le rangement du lieu devient le voisin
d'`udta` au lieu d'être son enfant. Le contrôle de structure ne le voit pas. C'est la relecture de
la position qui l'attrape, en ne retrouvant plus rien. Les deux contrôles se complètent, aucun ne
suffit seul, et le test le dit explicitement plutôt que de le laisser croire.

**Trois défauts de la même famille, trouvés en cherchant celui-là.** Tous les trois sont des
divergences entre ce qui est annoncé et ce qui est fait :

- **`assezLong` ne vérifiait qu'une borne sur deux.** Une chaîne peut être trop LONGUE autant que
  trop courte — au-delà de dix-huit décimales, l'écriture refuse. Un fichier dont le rangement
  dépasse vingt-huit caractères s'annonçait donc corrigeable et levait ensuite. La question est
  maintenant posée à `ecrireIso6709` elle-même, plutôt que ses bornes recopiées à côté.
- **Une taille sur soixante-quatre bits aurait été écrasée.** Les boîtes dont nous remontons la
  taille doivent porter la leur sur quatre octets ; au-delà, les quatre premiers octets ne portent
  qu'un marqueur, et le remonter là écraserait le marqueur. Trop rare sur un `moov` pour qu'un
  fichier témoin existe : on refuse, avant l'action.
- **La preuve à l'octet près était presque vide sur la voie qui fait grandir.** Un ajout décale tout
  ce qui le suit, donc la plage annoncée couvre nécessairement toute la fin du fichier — sur huit
  mégaoctets, elle en exempte huit. Ce qu'il faut établir n'est pas « rien n'a changé de place »,
  qui est faux par construction, mais « rien n'a changé de CONTENU » : un scénario compare
  désormais la fin du fichier produit à la fin de l'original, décalée d'exactement ce qu'on a
  inséré, sur chaque vidéo du corpus.

**Enfin, le refus des fichiers fragmentés est prouvé.** Il existait depuis Q-050 et ne reposait sur
aucun fichier — un raisonnement, pas une mesure. `bear-av1.mp4` de `chromium/chromium` en est un ;
il rejoint le corpus sous la même licence que son voisin.

**Bloque :** non.

---

## [V1.7] Q-052 — Le fichier produit ne disait pas ce qu'il était, et l'outil appelait « photo » une vidéo

**Contexte :** deux signalements après Q-051, et ils ne sont pas de même nature.

**Le premier est net.** Dix-sept phrases de `app` disent « photo » dans chaque langue, et elles
s'affichaient telles quelles sous une pastille qui annonçait pourtant « Video » : *« Where was this
photo taken? »*, *« Download the photo »*. L'outil nommait mal ce qu'il avait sous la main.

**Le second n'a pas pu être reproduit**, et il faut le dire avant tout le reste : « je ne vois rien
dans les informations de la vidéo ». Vérifié pied à pied — le correctif de Q-051 **est** déployé
(le worker servi a le même contenu, octet pour octet, que la build locale) ; le fichier produit porte
son lieu à sa place canonique ; l'oracle le relit ; et les six vidéos du corpus font l'aller-retour
complet dans un vrai navigateur, chargement, saisie, clic, téléchargement, rechargement, sans une
faute.

Reste une cause matérielle, trouvée en lisant le chemin de sortie, et qui explique le symptôme de
bout en bout **sans qu'aucun octet du fichier soit en cause** : le fichier produit sortait **sans
type déclaré**, et le partage l'annonçait explicitement comme un flux d'octets quelconque. Sur un
téléphone, un fichier rangé dans les téléchargements sans type n'est pas indexé comme une vidéo : la
galerie ne lui montre aucune fiche, et notre propre sélecteur — restreint aux images et aux vidéos —
peut cesser de le proposer. Le fichier est parfait, et l'utilisateur ne voit rien.

Cela valait pour les photos aussi. C'est la vidéo qui l'a rendu visible, parce qu'une vidéo se
consulte presque toujours par la galerie.

**Retenu :**

1. **Le fichier produit déclare son type**, au téléchargement comme au partage. La table format ⇄
   type était écrite deux fois — dans le manifeste et dans les tests — et le fichier produit ne la
   lisait nulle part : elle est désormais unique, et le manifeste en dérive au lieu de la recopier.
   La source est le format que le MOTEUR a reconnu dans les octets, jamais le type que le système
   attache au fichier d'entrée — c'est justement celui-là qui est vide ou faux dans les cas qui nous
   occupent, ce que Q-042 avait déjà relevé pour le sélecteur.
2. **Les mots suivent le fichier chargé.** Les phrases dites quand un fichier est là prennent le nom
   de son genre. Le français rendait la chose simple : « photo » et « vidéo » sont tous deux
   féminins, donc rien à accorder. Un lot mélangé retombe sur un nom neutre — aucun des deux n'y
   serait vrai. Le héros, les titres de page et les guides ne bougent pas : c'est ce que les gens
   cherchent, et aucun fichier n'y est chargé.
3. **Le lieu s'écrit aussi à la façon d'Apple.** `moov/udta/©xyz` est ce que lisent Android, FFmpeg,
   VLC et MediaInfo ; les logiciels d'Apple ne lisent que la clé nommée
   `com.apple.quicktime.location.ISO6709`. Les deux sont désormais écrits ensemble, et effacés
   ensemble — la règle du tout ou rien de Q-050 s'applique telle quelle.

   Deux bornes volontaires : rien n'est écrit si `moov/meta` existe déjà — il faudrait allonger deux
   tables et renuméroter, et aucun fichier du corpus n'a cette forme, donc rien ne l'éprouverait ; et
   rien n'est écrit dans un vrai QuickTime, dont `©xyz` est de toute façon le rangement natif.

   **Un détail mesuré plutôt que supposé :** la norme fait de `meta` une « FullBox », qui porte
   quatre octets de version. Écrite ainsi, l'oracle n'y lit RIEN ; écrite sans, il y lit le lieu — et
   c'est la forme qu'ExifTool produit lui-même. Ce rangement n'existant que pour être lu par
   d'autres, on suit le lecteur et non le texte.
4. **Un échec cesse d'être muet.** Sur un fichier seul, n'importe quel échec s'affichait « aucun
   fichier produit », alors que la phrase exacte — traduite, propre à chaque code — était calculée
   puis jetée : la liste des états n'est rendue qu'à partir de deux fichiers. Ce défaut a coûté deux
   allers-retours de diagnostic, faute que l'outil dise ce qu'il savait déjà.

**Un défaut trouvé en écrivant le troisième point, et qui vaut d'être noté.** L'insertion déduisait
de la POSITION à quelle boîte un ajout appartenait. C'est faux dans un cas parfaitement ordinaire :
quand `udta` est la dernière boîte de `moov`, les deux finissent au même octet, et rien dans la
position ne distingue « dans udta » de « après udta, dans moov ». `udta` avalait donc le rangement
d'Apple, qui devenait invisible pour tout le monde — nous compris. Chaque insertion dit désormais
chez qui elle va, au lieu de le laisser deviner.

**Ce qui reste ouvert.** Le second signalement n'est pas reproduit. La cause proposée se corrige sur
pièces et explique le symptôme entièrement, mais elle n'est pas prouvée être la sienne. S'il reste
invisible après ce lot, c'est le fichier lui-même qu'il faudra : un MP4 de téléphone porte
peut-être un rangement qu'aucune des six vidéos du corpus ne montre.

**Bloque :** non.

---

## [V1.7] Q-053 — Une vidéo n'avait rien à dire dans « les autres informations »

**Contexte :** le volet repliable n'apparaît pas sur une vidéo. Mesuré dans un vrai navigateur :
seize lignes sur un `Canon_40D.jpg`, dix-huit sur un `DSCN0010.jpg` — et **zéro** sur un MP4 sans
lieu, où le volet disparaît entièrement. Une vidéo qui porte un lieu s'en tire avec **une** ligne :
la position, que la pastille affiche déjà juste au-dessus.

La condition est `infos.length === 0` (`src/lib/ui/app.ts:319`), et `infos` se remplit de cinq
sources : `camera`, `takenAt`, `position`, `altitude`, `details`. **Quatre sur cinq ne sont écrites
que dans le bloc `if (tags)` de `lire()`**, alimenté par le second lecteur — que la V1.7 a cessé
d'appeler sur une vidéo puisqu'il n'ouvre ni MOV ni MP4. Il ne restait donc que la position.

Ce n'est pas une régression du volet : personne n'avait jamais écrit la lecture des informations
d'une vidéo. Le lot précédent a ouvert les quatre opérations sur le LIEU et s'est arrêté là.

**Retenu : lire ce que le fichier porte réellement**, dans les boîtes que le module parcourt déjà —
durée et date depuis `mvhd`, dimensions depuis le `tkhd` de la première piste qui en déclare (la
première piste tout court peut être le son), appareil et logiciel depuis les clés nommées d'Apple ou
les atomes texte d'`udta`.

L'essentiel de la conception est de la **réutilisation**, pas du code neuf : l'appariement
rang → valeur des clés d'Apple — la seule partie subtile du rangement — est sorti du lecteur du lieu
pour servir aux deux, et le décodage des atomes texte d'`udta` de même. Aucun changement de
contrat : `PhotoRead.details` est depuis toujours le canal ouvert prévu pour cela, et sa
documentation dit déjà que la clé est un identifiant stable que l'interface traduit.

**Trois refus, et ils valent mieux que les lignes ajoutées :**

- **Une date de remplissage n'est pas une date.** Zéro n'est pas le 1er janvier 1904, et beaucoup
  d'outils écrivent la valeur qui retombe pile sur le 1er janvier 1970 — `bear.mp4` le fait. Le
  format QuickTime datant de 1991, rien d'antérieur ne peut être une prise de vue : on s'abstient.
- **Un texte qu'on ne sait pas décoder ne s'affiche pas.** Les atomes d'`udta` sont écrits dans un
  jeu de caractères que rien ne déclare, et les fichiers anciens emploient celui du Macintosh.
  `tete-nue.mov` porte ainsi un auteur dont le premier octet ne veut rien dire chez nous. Faute de
  la table qui le convertit, l'afficher octet pour octet donnerait du charabia.
- **Deux dispositions, pas une.** `©day` s'écrit tantôt à la façon QuickTime — longueur, langue,
  chaîne — tantôt dans une boîte `data`. Les deux sont lues ; une seule aurait rendu la moitié des
  fichiers muets.

**Ce qu'on n'affiche pas, délibérément :** le nom du codage vidéo. Il est trivial à lire — le
parcours qui cherche les pistes de lieu le croise déjà — et il ne dit rien à quelqu'un venu placer
un lieu sur une vidéo.

**Et le vrai trou du lot : personne n'avait jamais regardé ce volet.** Ni `engine.test.ts` ni
`e2e.test.mjs` ne mentionnaient `#autres`, `details`, `takenAt` ou `camera` — pour aucun format.
C'est pour cela que ceci pouvait être livré sans que rien ne bronche. Les scénarios ajoutés
l'ouvrent enfin, sur une photo comme sur une vidéo, et vérifient les DEUX SENS : ce qui doit y être
y est, et ce qui ne doit pas y être n'y est pas. Un fichier témoin a été préparé pour la ligne
« Appareil », qu'aucune vidéo du corpus ne portait — sans lui, elle aurait été écrite sans preuve.

**Bloque :** non.

---

## [V1.7] Q-054 — Le lecteur cherchait le lieu à des adresses fixes

**Contexte :** « Pourquoi le lieu n'apparaît pas dans les informations de la vidéo ? Je peux
pourtant le lire avec un outil mobile. » C'était exact, et c'était notre défaut.

**Reproduit deux fois**, en rangeant le lieu ailleurs que là où nous regardions, puis en demandant à
l'oracle indépendant :

| Où est le lieu | ExifTool | Nous |
|---|---|---|
| `moov/meta/ilst/©xyz`, clé en quatre lettres | 43.90811 4.86387 | **rien** |
| paquet de texte, boîte `uuid` de premier niveau | 43.90811 4.86387 | **rien** |

La cause tenait en six lignes : chaque recherche passait par un **chemin fixe** — `moov/udta`,
`moov/meta`, `moov/udta/meta/ilst` — et `chemin()` ne rend que la PREMIÈRE boîte de chaque cran. Un
fichier qui range son lieu dans un second `udta`, dans celui d'une piste, dans un `ilst` accroché
ailleurs, ou dans le paquet de texte que la norme place en boîte de premier niveau, passait à côté
de nous. Ces quatre cas sont parfaitement réguliers ; c'est notre lecture qui était étroite.

**Le second cas n'était pas qu'un affichage manquant.** Sur un fichier dont le lieu n'est QUE dans
le paquet de texte, le balayage résiduel — celui qui doit faire ÉCHOUER un effacement incomplet —
ne voyait rien non plus. Un effacement rendait donc un fichier annoncé propre **qui disait encore où
il avait été tourné**. C'est très exactement le résultat que Q-006 nomme le pire possible pour cet
outil, et que tout le reste du moteur est bâti pour empêcher.

**Retenu : un rangement compte où qu'il soit.** Les chemins fixes cèdent la place à une recherche
sur tout le fichier — `toutesLesBoites` fait déjà ce parcours pour les pistes de lieu et les tables
de rangs. Tout `udta`, tout `ilst` — nommé par quatre lettres comme par rang —, tout paquet de
texte, y compris la boîte `uuid` de premier niveau reconnue à son identifiant. Ce qui est trouvé est
lu, réécrit avec les autres, effacé avec les autres, et surveillé par le balayage comme les autres.

S'y ajoute la **lecture** des coordonnées du paquet de texte, qu'on savait jusqu'ici seulement
détecter. Elles n'y sont pas en degrés décimaux mais à la façon de l'EXIF — `43,54.4866N`, des
degrés, des minutes décimales, un hémisphère. Les lire comme un nombre donnerait 43, soit cent
kilomètres d'erreur qui n'auraient pas l'air fausses.

**Une décision à assumer :** quand on corrige le lieu d'une vidéo dont le paquet de texte en porte
une seconde copie, cette copie est **purgée** et non réécrite. Les nombres y ont une longueur
variable, donc les réécrire déplacerait des octets ; les laisser ferait dire deux lieux au même
fichier. Le titre, l'auteur et l'historique ne sont pas touchés — `purgerLeLieu` ne blanchit que les
propriétés de lieu, et c'est déjà ce qu'elle fait pour les photos.

**Un défaut voisin, trouvé en éprouvant le premier.** La sonde recalculait le lieu de son côté, sur
les seuls rangements ordinaires. Le lecteur savait donc lire un lieu que la sonde annonçait absent —
et c'est la sonde qui alimente le volet. Les deux passent désormais par la même lecture, comme le
reste du module.

**Ce qui reste couvert sans témoin, et il faut le dire :** le cas `moov/meta/ilst` à clé de quatre
lettres. ExifTool écrit toujours ce rangement sous `moov/udta/meta`, donc l'oracle ne sait pas
fabriquer le fichier, et le projet interdit d'en fabriquer un pour l'occasion. La recherche
généralisée le couvre **par construction, pas par mesure**. Le paquet de texte, lui, a son témoin :
`exiftool -XMP:GPSLatitude=…` sur un vrai MP4 produit exactement le cas dangereux.

**Bloque :** non.

---

## [V1.7] Q-055 — L'écran montrait le fichier chargé, jamais le fichier produit

**Contexte :** cinquième signalement du même symptôme, et le premier à le nommer exactement :
« vous avez enregistré le lieu dans la vidéo, les outils du téléphone le voient, mais vous, vous ne
l'affichez pas ».

Ce n'était pas un défaut de lecture — les quatre tours précédents cherchaient au mauvais endroit.
**L'affichage n'était jamais rafraîchi après une écriture.** Mesuré dans le navigateur, après avoir
enregistré un lieu dans un MP4 qui n'en avait pas :

```
avant l'écriture         pastille=(cachée)   volet= Length 0:01 / Size 320 × 180
APRÈS le téléchargement  pastille=(cachée)   volet= Length 0:01 / Size 320 × 180
```

Le fichier produit portait bien le lieu. L'écran, lui, montrait toujours l'état du fichier **tel
qu'il avait été chargé**.

**Et l'autre sens était pire.** Après un clic sur « Effacer la position », sur un JPEG géolocalisé :

```
APRÈS l'effacement   pastille=Currently : 43.46745, 11.88513
                     volet= … / Location / 43° 28′ 2.81″ N 11° 53′ 6.46″ E / …
```

Le lieu était retiré du fichier rendu, et l'écran continuait de l'afficher. Sur un outil dont c'est
le métier, c'est l'affichage le plus trompeur possible : on clique « retirer », et le lieu reste là.

**Le défaut touchait tous les formats, depuis l'origine.** Vérifié à l'identique sur un JPEG. Il ne
se voyait pas sur une photo parce que le volet y reste rempli d'appareil, de date et de pose : une
ligne « Location » manquante passe inaperçue au milieu de seize autres. Sur une vidéo, dont le volet
ne porte que deux lignes, il saute aux yeux.

**Retenu : après une écriture réussie, l'élément adopte les octets produits**, est resondé par le
même chemin que le chargement initial, et l'écran est refait.

On remplace les octets, et non l'affichage seul. La moitié de ce que l'écran porte est une
CAPACITÉ — champ actif, boutons d'effacement, phrase de motif — et la rafraîchir sans changer les
octets la ferait décrire le fichier produit pendant que les boutons agiraient sur l'original. Ce
projet a déjà payé cette divergence deux fois, en Q-039 puis en Q-051 ; la reproduire ici pour
gagner trois lignes n'aurait aucun sens. Le NOM d'origine est conservé : c'est lui qui compose le
nom de sortie, et adopter le nom suffixé empilerait « -geotagged-geotagged » à la deuxième écriture.

**Pourquoi quatre tours sont passés à côté, et c'est la leçon du lot.** Chacun a vérifié le FICHIER
produit — octets, structure, relecture par l'oracle, aller-retour par le sélecteur — et aucun n'a
regardé l'ÉCRAN après l'avoir produit. Le dépôt n'avait aucun contrôle de cette moitié-là, pour
aucun format. Les corrections précédentes restent bonnes, deux d'entre elles empêchaient même de
rendre un fichier faussement propre, mais aucune ne répondait à la question posée.

Les contrôles ajoutés couvrent les deux sens, sur une photo comme sur une vidéo, et **échouaient
tous les six** sur le code d'avant : après un ajout la pastille et la ligne de lieu apparaissent ;
après un effacement elles disparaissent.

**Bloque :** non.

---

## [V1.7] Q-056 — Le lieu était trouvé, illisible, et l'outil se taisait

**Contexte :** « Peux-tu montrer le géotag dans "Voir les autres informations" ? » — la question,
prise au mot, a mis le doigt sur deux formes d'écriture parfaitement courantes que nous TROUVIONS
sans savoir les décoder.

Mesuré sur un vrai MP4 du corpus, en ne changeant que la chaîne du rangement `©xyz`, ExifTool servant
d'oracle :

| Chaîne dans le fichier | ExifTool | Nous, avant |
|---|---|---|
| `+43.908110+004.863870/` | 43.90811 4.86387 | 43.90811 4.86387 |
| la même, **suivie d'un octet nul** | 43.90811 4.86387 | **rien** |
| `+43.9081+004.8639/CRSWGS_84/` | 43.9081 4.8639 | **rien** |
| `+43.90811+4.86387` | 43.90811 4.86387 | **rien** |

Dans les trois cas d'échec, le rangement était localisé et son texte était sous nos yeux : seul le
décodage refusait. La position devenait nulle, donc **ni pastille, ni ligne de lieu**.

Aucune des trois formes n'est exotique :

- **L'octet nul final** est ce qu'écrivent quantité d'outils, qui terminent la chaîne à la mode du
  langage C et comptent ce zéro dans la longueur déclarée. `trim()` retire les blancs, pas les
  octets de commande, et l'expression régulière exigeait la fin de chaîne après la barre oblique.
- **`CRSWGS_84`** est le suffixe que la norme ISO 6709 prévoit pour nommer le système de repère. Il
  est facultatif, il est légal, et certains appareils l'écrivent.
- **La longitude à un seul chiffre** viole la largeur canonique de la norme — `+004.86387` — mais
  les lecteurs du téléphone la lisent. Moins de chiffres que la largeur canonique ne peut désigner
  que des degrés : deux chiffres de minutes n'y tiendraient pas, donc il n'y a aucune ambiguïté à
  lever, et refuser revenait à se taire sur un fichier que tout le monde comprend.

**Retenu :** on nettoie avant d'analyser (blancs ET octets de commande), on accepte le nom du
système de repère, et on lit une largeur inférieure à la canonique comme des degrés. Ce qui suit les
coordonnées — altitude, nom de repère, octet nul — est rendu TEL QUEL à la réécriture : il compte
dans la longueur déclarée, donc l'effacer déplacerait des octets.

**Et surtout : quand on ne sait pas lire, on montre.** Le volet porte désormais une ligne « Lieu tel
qu'il est écrit » avec les caractères mêmes du fichier, dès qu'un rangement de lieu porte un texte
que nous ne décodons pas — et seulement dans ce cas, la ligne de position existant déjà sinon.

**C'est ce silence, et non les trois défauts, qui a coûté cinq allers-retours.** Nous SAVIONS qu'il
y avait un lieu ; l'interface n'en disait rien. Le reste du moteur ne fonctionne pas ainsi : un
fichier qu'on ne sait pas modifier le DIT, avec sa phrase, avant l'action. Désormais une copie
d'écran suffit à nommer la forme qui nous manque, sans que personne ait à envoyer sa vidéo.

**Les contrôles.** Neuf formes d'écriture, chacune dans un vrai MP4 du corpus dont seule la chaîne
change — ExifTool écrit celles qu'il accepte, les autres remplacent la charge à longueur constante,
donc aucun octet ne se déplace. Pour chacune, **ce que nous lisons doit valoir ce que lit l'oracle**.
C'est le contrôle qui manquait : une divergence dans ce sens-là — lui lit, pas nous — est exactement
le symptôme signalé, et rien ne la regardait. Cinq assertions échouent sur le code d'avant.

Un témoin est ajouté au corpus, `lieu-illisible.mp4`, dont la chaîne n'est décodée par aucun des deux
lecteurs : le banc et le parcours navigateur vérifient tous deux que le volet la montre au lieu de se
taire.

**Ce qui reste vrai :** nous restons plus tolérants que l'oracle sur une chaîne entourée de blancs,
qu'il refuse et que nous lisons. Lire davantage n'expose personne — c'est se taire qui trompe.

**Bloque :** non.

---

## [V1.7] Q-057 — Un lieu écrit pour être lu, et une charge lue un octet par caractère

**Contexte :** septième signalement. Le volet montrait bien la ligne « Lieu tel qu'il est écrit »
ajoutée en Q-056 — c'est elle qui a permis de nommer le cas sans que le fichier change de mains — et
la chaîne qu'elle portait était `43°54′29.2″N 4°51′49.9″E`. Pas la suite de chiffres de la norme :
ce qu'une application AFFICHE À L'ÉCRAN, déposé tel quel dans le champ de lieu.

**Deux défauts se cumulaient, et le premier masquait le second.**

1. **La charge était lue un octet par caractère.** `texte()` fait `String.fromCharCode` sur les
   octets — ce qui est juste pour un nom de boîte de quatre octets, qui est une identité, et FAUX
   pour tout texte destiné à un humain. Mesuré sur le fichier témoin :

   ```
   ancien décodage : "43Â°54â²29.2â³N 4Â°51â²49.9â³E"
   nouveau         : "43°54′29.2″N 4°51′49.9″E"
   ```

   Aucune souplesse du lecteur n'aurait rattrapé cela : la chaîne arrivait déformée avant lui.

2. **Le lecteur ne connaissait que la forme numérique.** Une fois la chaîne rendue intacte, il
   fallait encore savoir lire les degrés, minutes et secondes.

**Le défaut de décodage dépassait le lieu.** Un nom d'appareil, un auteur, un logiciel : tout ce que
le volet affiche passait par là. Le corpus était entièrement en ASCII, donc rien ne l'a jamais
signalé — le fichier `appareil.mp4` porte désormais des accents à dessein, et l'assertion qui le lit
échoue sur le code d'avant.

**Retenu :** un décodeur séparé, `texteLisible`. L'indicateur d'ordre des octets annonce l'UTF-16
sans ambiguïté ; l'UTF-8 se valide de lui-même, une suite mal formée étant refusée plutôt que
devinée ; à défaut on retombe sur un octet par caractère, qui est ce qu'écrivent les fichiers
anciens. `texte()` reste, pour les noms de boîtes, avec la raison écrite au-dessus.

Et `lireDms`, appelée derrière la lecture numérique par un point de passage unique,
`lireLieuTexte` — l'affichage, le sondage et le balayage résiduel lisent ainsi la MÊME chose, ce que
Q-054 avait déjà coûté une fois.

**Le symbole de degré est exigé, et il doit y en avoir exactement deux.** C'est ce qui distingue un
lieu d'un titre où traîneraient deux nombres. Le comptage se fait AVANT toute lecture, et il n'est
pas décoratif : sans lui, sur `43°54′29.2″N 4°51′49.9″E 5°12′00.0″W`, la lecture « lettre après les
nombres » échouait et celle « lettre avant » en retenait deux AUTRES — rendant une position que
personne n'avait écrite. Le test le prouve, et il échouait avant ce comptage.

**Ce que l'oracle ne pouvait pas trancher.** ExifTool annonce le champ et rend « NaN » sur les sept
formes mesurées : il ne lit pas cette écriture-là. Il sert donc autrement — c'est LUI qui donne la
valeur de référence, lue dans un fichier portant les mêmes coordonnées sous forme numérique, et
notre lecture des lettres doit retomber dessus. Après correction, c'est encore lui qui relit le
fichier produit, puisque nous y écrivons la forme qu'il sait lire.

**La leçon de Q-056 a payé au tour suivant, et c'est le seul point qui vaille.** Six tours ont été
perdus à chercher à l'aveugle parce que l'outil se taisait. Le septième a été résolu en une question,
sans que l'utilisateur ait à envoyer sa vidéo : la ligne « lieu tel qu'il est écrit » a nommé la
forme manquante. Montrer ce qu'on ne comprend pas n'est pas un aveu de faiblesse — c'est ce qui rend
un défaut nommable.

**Bloque :** non.

---

## [V1.7] Q-058 — La bulle n'ouvrait plus que l'appareil photo

**Contexte :** un signalement d'iPhone, en une phrase : « il n'est plus possible de mettre une
photo, on ne peut plus que prendre une nouvelle photo avec l'appareil ». Une ligne de balisage, un
attribut, ajouté quatre jours plus tôt par `f853610` — « Ouvrir l'appareil photo depuis la bulle de
choix de photo » :

```
- <input id="picker" type="file" accept="image/*,video/*" multiple />
+ <input id="picker" type="file" accept="image/*,video/*" multiple capture="environment" />
```

**`capture` ne dit pas « préfère l'appareil photo ».** Il dit d'ouvrir un AUTRE sélecteur. La norme
est explicite — « the user agent SHOULD invoke a file picker of the specific capture control type ».
Sur iPhone, Safari n'affiche donc plus la feuille « Photothèque / Prendre une photo ou une vidéo /
Choisir un fichier » : il n'y a plus de feuille du tout, l'appareil photo part directement, et il
n'existe aucune sortie vers la photothèque. Sous Android, Chrome déclenche l'intention d'appareil
photo de la même façon. Le commit annonçait pourtant « users can still access their photo library as
an alternative option » : c'est la phrase réfutable de tout le lot, et elle est FAUSSE.

**Sur iPhone, ce champ est la seule porte.** C'est ce qui fait la différence entre une gêne et une
perte totale. Des cinq entrées de l'outil, quatre n'existent pas là : le dépôt est de bureau, le
collage n'a rien à viser dans l'état vide — l'écouteur se retire dès que la cible est un champ, et
il n'y a aucun champ —, la cible de partage demande une interception de worker que Safari
n'implémente pas, et l'ouverture système est de Chromium de bureau. Fermer `#picker`, c'est fermer
l'application.

**Et `multiple` est tombé avec, sans que personne le compte.** Une prise de vue rend UN fichier :
l'attribut cesse de vouloir dire quelque chose partout où `capture` est honoré, donc sur tous les
téléphones, Android compris. Le lot — `#lot`, l'export par `client-zip` — est ce que six pages de
guides promettent en toutes lettres. Le commit annonçait « maintains backward compatibility with
existing `accept` and `multiple` attributes ». Non.

**L'attribut n'achetait rien.** iOS propose déjà « Prendre une photo ou une vidéo » dans sa propre
feuille, sans qu'une page ait à le demander — c'est une affordance du système, pas une faveur du
balisage. Le raccourci était donc déjà là, gratuit ; on l'a payé la photothèque et le lot. Pour la
cohérence, `public/_headers` déclare par ailleurs `Permissions-Policy: … camera=() …` : le site dit
lui-même à tous les navigateurs qu'il n'utilise pas d'appareil photo. Cette politique ne régit que
`getUserMedia` et n'a donc rien bloqué ici — mais elle dit assez que l'appareil photo n'a jamais
fait partie de la posture de ce site.

**Retenu :** l'attribut est retiré, et rien d'autre ne change. Pas de second bouton, pas de nouvelle
chaîne, pas de traduction : la question « choisir ou photographier » est posée par la feuille du
système, et c'est là qu'elle doit être posée. Seule l'ABSENCE exprime « pas de capture » — le
comportement tient à l'attribut SPÉCIFIÉ et non à sa valeur, si bien que `capture=""`, `"false"` ou
`"none"` disent tous encore capture. Un contrôle écrit comme « `capture` doit valoir X » bénirait
donc le balisage cassé : les deux contrôles jugent une présence, jamais un contenu.

**Deux fois en huit jours sur la MÊME ligne, et deux fois tout est passé au vert.** `e3fc17c` le 31
juillet rouvrait la galerie d'Android ; `f853610` le 4 août la refermait, sur iPhone cette fois.
C'est le vrai sujet de cette entrée. La raison est mécanique : `test/e2e.test.mjs` pilote le champ
par `setInputFiles` — dix-huit appels — qui pose les fichiers DANS l'élément sans jamais ouvrir le
sélecteur du système. Aucun test fonctionnel, sur aucun navigateur, ne peut voir cette panne ; et
`capture` est inerte sur un ordinateur, donc invisible aussi à qui relit son travail. Le balisage
est la seule prise.

**Pourquoi le commentaire n'a pas suffi, et ce qui le remplace.** La règle d'`e3fc17c` — rien que
des types MIME dans `accept` — vivait dans un commentaire posé juste au-dessus de cette ligne. Il
n'a arrêté personne, parce qu'il régit un ATTRIBUT et que le commit suivant en a ajouté un autre
sans le contredire d'un mot. La contrainte est donc réécrite comme une règle sur l'ÉLÉMENT, et elle
est tenue par du code aux deux bouts :

- `scripts/check-build.mjs` juge le HTML SERVI, dans les deux langues, à chaque `npm run build` —
  donc aussi sur la build de l'hébergeur, où seul le code de sortie est lu. Un `capture` qui revient
  ne peut plus être déployé. Le même contrôle exige `multiple`, refuse un `accept` qui ne soit pas
  fait de caractères génériques — ce qui ferme au passage le remède `android/allowCamera` qui
  circule contre le bouton d'appareil photo disparu d'Android 14 —, et échoue si le champ est
  absent, pour ne jamais passer à vide.
- `test/e2e.test.mjs` juge le DOM VIVANT, aux côtés du contrôle d'`inputmode` dont il est le
  jumeau : deux attributs qui ne font mal que sur un téléphone. Ce n'est pas deux fois le même
  contrôle — celui-ci attrape un `capture` posé par un script après coup, qui est la forme la plus
  probable de la prochaine tentative une fois la voie du balisage fermée.

**Les contrôles.** Vérifiés en échec avant d'être vérifiés au vert, et les deux formes séparément.
L'attribut remis à la source fait échouer la build avec DEUX lignes, `index.html` et `fr/index.html`
— c'est la preuve que les deux langues sont vues — et met le test de bout en bout au rouge. Les
branches ont été éprouvées une à une sur un `dist/` rapiécé : champ renommé, `multiple` retiré,
`accept` pollué par `.heic` puis par `android/allowCamera`. Et l'asymétrie qui justifie de garder
les deux a été mesurée plutôt qu'affirmée : un `setAttribute('capture', …)` ajouté au JavaScript
produit laisse la build VERTE et met le bout en bout au ROUGE. 361 assertions au vert, deux de plus
qu'avant.

**Ce qui reste vrai, et qu'aucun contrôle ne couvre.** Deux choses, dites plutôt que laissées à
supposer. Les navigations sont servies par le cache sans revalidation : un iPhone qui a déjà
l'application ouvre l'ancienne page, reçoit le bandeau de mise à jour, et c'est son geste — un seul
— qui apporte la correction ; qui répond « plus tard », ou qui tire pour rafraîchir, reste en panne.
C'est la décision de Q-045, elle n'est pas rouverte ici. Et depuis Android 14, Chrome ouvre le
sélecteur de photos du système, qui n'expose plus de tuile d'appareil photo : la galerie revient
partout, l'appareil photo reste atteignable dans la feuille d'iOS, mais Android récent n'en offre
plus le chemin depuis ce champ. C'est le choix du système. Si ce raccourci devait être rendu, ce
serait un SECOND champ derrière son propre bouton — jamais un attribut sur celui-ci, et jamais par
`accept`, qui rouvrirait le dossier WhatsApp vide.

**Bloque :** non.
