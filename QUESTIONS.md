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

**Bloque :** **oui** pour le lancement du spike complet. Les étapes S1 (poids) et S3 (HEIC sur cible
hôte) peuvent démarrer sans la réponse ; le reste non.

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

**Bloque :** non.

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

**Retenu provisoirement :** **A**, avec **B** si le mouvement est jugé indispensable.

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

**Ce qui n'a PAS eu lieu, et qu'il faut dire :** la production n'a pas été écrasée. Vérifié en
comparant les empreintes des fichiers servis — `geotager.app` sert une build antérieure à cette PR,
avec l'ancien tableau à trois colonnes. Une première lecture de cet incident concluait que du code
non relu était en ligne ; c'était faux, et c'est retiré. Pourquoi la promotion n'a pas abouti malgré
la commande n'est pas établi depuis le dépôt, et n'est pas supposé ici.

**Options :**
- **A.** Rétablir la « Version command » à `npx wrangler versions upload`. Réglage de tableau de
  bord : ni Wrangler ni le dépôt ne peuvent le porter, et l'interface d'administration disponible ne
  l'expose pas non plus.
- **B.** `npx wrangler versions deploy`. **Écarté, et c'est un piège** : cette commande *promeut* une
  version déjà téléversée vers la production. Elle produirait exactement l'accident que le §7.7 bis
  décrit, au lieu de l'empêcher.
- **C.** Laisser en l'état. Écarté : sans prévisualisation, rien de ce que le §7.7 fait reposer
  dessus n'est vérifiable avant la mise en production.

**Retenu provisoirement :** **A**.

Ce que l'épisode apprend, au-delà du réglage : le §7.7 bis notait déjà *« rien dans le dépôt ne
protège de ce réglage »*, et c'est vérifié — une confirmation datée dit ce qui a été vu un jour, pas
ce qui tient. Un garde-fou dans le dépôt, qui échouerait si une build promouvait en production depuis
une branche autre que `main`, a été proposé et n'a pas été retenu dans ce lot.

**Bloque :** **oui** pour le Gate 2, non pour la revue de la PR.
