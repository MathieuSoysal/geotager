# CONTRADICTION — 8 objections qui tiennent

**Discipline appliquée :** chaque objection cite le texte attaqué, l'oppose à une mesure ou à une autre pièce du dossier, et propose un correctif. Ce que je n'ai pas pu étayer, je l'ai jeté (j'avais 3 autres pistes : le choix Leaflet, l'ODbL des contours, le pipeline de polices — tous se défendent, voir la clôture).

**Réserve de périmètre, à dire d'emblée :** je n'ai **pas** le texte littéral du §9 (critères de recette), ni du §7 (7 blocs), ni du §12 (propriété des lots). D4 signale lui-même que le §7 ne lui a été transmis que partiellement. L'objection 6 attaque donc le critère des 60 secondes **tel qu'il m'est décrit**, pas tel qu'il est écrit. Si le §9 contient un protocole que je n'ai pas vu, l'objection tombe en partie — mais sa seconde moitié (les écrans de décision imposés) tient indépendamment.

---

## 1. BLOQUANT — Si le spike Rust échoue, le cas d'usage n°1 devient un pis-aller, et cette bascule est décidée par le concepteur au lieu d'être posée à Mathieu

**Affirmation attaquée** (D1 §1.3) :

> « **VOIE JS signifie** : la ligne WASM disparaît, HEIC/AVIF/TIFF/JXL basculent en **P1 (suppression et correction) + P3 (ajout)**. Le produit reste entier et honnête : on ne perd que "ajouter une position dans un HEIC qui n'en avait pas", remplacé par un fichier compagnon. »

**Pourquoi c'est faux.** « On ne perd que » masque la bascule la plus lourde du projet. Le HEIC est le format par défaut de tout iPhone depuis iOS 11 (R2), et R6 a mesuré que **`iphone` est le modificateur d'appareil dominant dans quasiment tous les clusters Google Suggest** (`supprimer localisation photo iphone` sort en 1ʳᵉ complétion, avant la requête nue). D4 en tire d'ailleurs une page dédiée, `/supprimer-localisation-photo-iphone/`.

Or la promesse produit est « voir, **modifier** et **supprimer** ». En voie JS, pour un HEIC sans position, « modifier » devient le texte T7 de D1 :

> « Ce fichier est trop délicat pour que nous y écrivions sans risquer de l'abîmer. **Nous n'y toucherons pas.** À la place, nous créons **un second petit fichier** […] **Gardez les deux fichiers ensemble** […] Si vous n'envoyez que la photo, elle ne contiendra aucune position. »

Traduction pour l'utilisateur grand public visé : *l'outil n'a pas fait ce que je lui demandais, et il me confie une contrainte de gestion de fichiers.* Ce n'est pas « entier », c'est un produit différent. Et D1 le note lui-même sans en tirer la conséquence : « **la question du spike n'est pas "Rust ou JS ?" mais "little_exif sait-il écrire dans un HEIC ?"** ».

Le problème de méthode est plus grave que le problème technique : **D1 n'a ouvert qu'une seule entrée QUESTIONS.md sur tout le lot A (Q-001, IPTC)**, pour un point de périmètre à impact nul sur l'utilisateur, et a tranché unilatéralement celui qui décide si le produit vaut la peine d'être construit.

**Gravité : BLOQUANT.**

**Correctif.** Ouvrir **Q-002 avant de lancer le spike**, pas après : *« Si l'écriture HEIC en ajout n'est pas atteignable, construit-on quand même ? »* avec trois options chiffrées — (A) on construit, HEIC en compagnon assumé et dit dès la page d'accueil ; (B) on restreint la v1 à JPEG+PNG et on affiche « HEIC : lecture et suppression uniquement » dans le tableau du bloc 5 ; (C) on ne construit pas. Et **inverser l'ordre du spike** : S1.2/S1.3 (HEIC/AVIF sur cible hôte, ExifTool comme oracle) sont réalisables **sans installer wasm et sans toucher à Rust au-delà du cargo déjà présent**. C'est 2 jours, pas 3 semaines, et ça débloque la décision produit.

---

## 2. BLOQUANT — Le seul canal d'acquisition est le SEO, sur un domaine à DR 0 mesuré, sans un seul volume de recherche, contre des concurrents à DR 42-67

**Affirmation attaquée** (R6 §B3, repris tel quel par D4 §1.0) : la hiérarchie de 4 pages est présentée comme la stratégie d'acquisition, avec « `/` absorbe le cluster le plus large ».

**Pourquoi c'est fragile — mesures faites à l'instant (27/07/2026, Ahrefs `public-domain-rating-free`) :**

| Domaine | Domain Rating | Statut R7 |
|---|---|---|
| metadata2go.com | **67** | serveur, 26 langues dont FR |
| jimpl.com | **58** | serveur |
| imageonline.co | **56** | FR, client-side, édition GPS sans perte, carte — *concurrent frontal* |
| verexif.com | **55** | serveur, FR |
| exif.tools | **48** | client-side, EN |
| pic2map.com | **42** | serveur, lecture seule |
| **geotagor.fr** | **0** | **non enregistré** (RDAP 404, R7) |

Contre ça, le dossier contient **zéro donnée de volume** : R6 a essuyé **7 échecs `Insufficient plan` sur Ahrefs, un 429 sur Google Trends et un 202 anti-bot sur DuckDuckGo**, et n'a **jamais observé un seul SERP google.fr**. Il l'écrit lui-même : *« Le tableau des volumes demandé n'existe pas et je ne le fabriquerai pas. »* Le plan construit donc 4 pages, ~11 000 mots et 12 contrôles de build sur des mots-clés dont **personne ne sait s'ils font 200 ou 20 000 recherches par mois**.

Nuance honnête qui joue *contre* moi et qu'il faut connaître : **remove-exif-data.com est aussi à DR 0** (mesuré à l'instant) et existe pourtant. Deux lectures possibles — soit le créneau est peu concurrentiel et un nouveau venu peut percer, soit ce site ne se classe pas et n'est visible que par la publicité. **Sans un seul SERP observé, on ne peut pas trancher, et le plan ne le dit nulle part.**

Le point le plus grave n'est pas le DR, c'est l'absence de plan B : **il n'existe dans aucun des sept documents un canal d'acquisition non-SEO**. Pas de plan de lancement, pas de seeding, pas de démarche presse, pas d'annuaire, pas de stratégie de liens. Et le différenciateur choisi — zéro requête tierce — est **invisible dans un SERP** : il ne tient ni dans un title de 60 caractères ni dans une description de 155. Il ne se découvre qu'*après* l'arrivée sur la page. **Un différenciateur qui n'est pas un argument d'acquisition ne peut pas porter une stratégie d'acquisition.**

**Gravité : BLOQUANT.**

**Correctif.** Trois actions avant d'écrire une ligne de contenu :
1. **Obtenir des volumes réels, gratuitement** : Google Keyword Planner (compte Google Ads, ciblage France + français). C'est la seule source proche de la vérité Google, et c'est une heure de travail. Décider ensuite si `supprimer exif photo` ou `supprimer localisation photo` porte la page 1.
2. **Observer 5 SERP google.fr manuellement**, en navigation privée depuis une IP française, captures datées. Compter outils vs blogs, et si un DR 0 y figure.
3. **Écrire un plan d'acquisition non-SEO** et le budgéter comme un lot : la cible réelle du différenciateur « zéro requête tierce » n'est pas le grand public, ce sont les prescripteurs — CNIL, associations de défense de la vie privée, DPO, journalistes tech, forums de photographes. Ce sont eux qui font les liens qui font le DR. Le SEO devient alors un pari à 6-12 mois adossé à un canal qui marche à J+1, au lieu d'être le pari unique.

---

## 3. BLOQUANT — La charge réelle est de 24 à 41 semaines-homme, pas d'un « site statique de 4 pages »

**Affirmation attaquée** : le cadrage du projet — 4 pages, hébergement statique, budget JS 150 Ko — induit un projet de quelques semaines. D3 §4.3 chiffre 4 350 lignes de code maison au total.

**Pourquoi c'est faux — calcul entièrement dérivé des chiffres du dossier lui-même (ESTIMÉ) :**

R2 a posé une cadence de référence pour ce type de travail : *« À ~15–25 lignes utiles/jour sur du parsing binaire à spec (rythme réaliste quand chaque ligne doit être validée contre un fichier réel) »*, et estimait ~2 000 lignes → **8 à 14 semaines-homme**.

Or **D3 budgète le lot A à 1 240 lignes** (worker 380, chargeur WASM 150, adaptateurs JS 320, XMP 150, chunks PNG 240), soit **61 % de l'estimation de R2 pour un périmètre strictement plus large** — parce que D1 ajoute par-dessus : P1 (édition sur place) sur ~20 formats, le balayage résiduel Boyer-Moore multi-motifs, la détection de l'arrière-fichier MP4 des photos animées Android, et la neutralisation `©xyz` → `free` en vidéo. **P1, que D1 qualifie de « colonne vertébrale du produit », n'apparaît dans aucune ligne du tableau de D3.**

En appliquant la cadence de R2 aux seules parties binaires de D3 (320 + 150 + 240 = 710 lignes) : 710 / 15 à 710 / 25 = **28 à 47 jours ouvrés**, soit **6 à 9,5 semaines** — pour un périmètre déjà sous-évalué.

Récapitulatif par lot, avec les lignes de D3 et une cadence de 50-80 l/j pour le non-binaire :

| Lot | Contenu | Semaines-homme (ESTIMÉ) |
|---|---|---|
| A | 1 240 l. dont 710 binaires + spike Rust 8 étapes + **corpus de 29 fichiers réels à acquérir et à documenter avant tout code** | **9 à 16** |
| B | 510 l. + pipeline de build + snapshot geo.api + validation | 3 à 4 |
| C | 630 l. + pipeline mapshaper | 2 à 4 |
| D | 1 970 l. + tokens/CSS + 13 corrections de contraste + machine à états | 6 à 10 |
| E | **8 500 à 13 700 mots** (objection 7) + 12 contrôles de build + juridique | 4 à 7 |
| **Total** | | **24 à 41** |

Soit **6 à 10 mois pour une personne à plein temps**. Deux postes que le cadrage ignore complètement :

- **Le corpus.** D1 §7 exige 29 fichiers, dont 16 en priorité P0, dont F1, F2, F3a/b, F4, F5, F6, F10, F20, F21 **que Mathieu doit produire lui-même** (iPhone en mode compatible *et* haute efficacité, Live Photo, mode Portrait, photo animée Android, export darktable, DNG, MOV+MP4). Chaque fichier exige en plus un `attendu/<id>.json` **rédigé avant l'implémentation**, avec sortie ExifTool de référence. C'est 1 à 2 semaines de travail non-code, avant la première ligne du lot A.
- **ExifTool.** Il n'est pas installé (D1 §1.0, MESURÉ), et **aucune conclusion du spike n'est valide sans lui** — on ne se relit jamais soi-même.

**Gravité : BLOQUANT** (pour la planification, pas pour la faisabilité).

**Correctif.** Reformuler le projet dans DECISIONS.md : ce n'est pas un site, c'est **une bibliothèque de manipulation binaire multi-format avec un site autour**. Puis découper en jalons livrables et arrêtables :
- **V0 — JPEG seul, suppression et correction en P1, aucune carte, aucun index, 1 page.** C'est le cas d'usage n°1, c'est le chemin où `little_exif` compte 0 panic (R1) et où piexif est le mieux compris, et c'est livrable en 4 à 6 semaines. **On apprend du terrain avant de dépenser 30 semaines.**
- V1 = + PNG/WebP, + index de communes, + carte.
- V2 = + HEIC/AVIF selon le résultat de Q-002.

---

## 4. BLOQUANT — La parallélisation est impossible telle qu'annoncée, et j'en ai la preuve : une fonction exigée par le lot D n'existe dans aucun lot

**Affirmation attaquée** (D3 §1.1-1.2) :

> « **`src/lib/core/` créé, écrit par D0 au jalon 0, puis GELÉ.** Toute modification passe par une entrée `QUESTIONS.md` et un accord explicite. C'est le contrat inter-lots. »

**Pourquoi c'est faux.** Le contrat gelé au jalon 0 contient `types.ts` (`PhotoJob`, `ExifSummary`, `WriteResult`, `FailureReason`) et `protocol.ts`. Or D1 §4.4 donne la forme réelle de ce protocole, et elle est **entièrement dérivée de résultats que seul le spike peut produire** : `Diagnostic` porte `aMpf`, `aArriereFichier`, `cheminsPossibles: {ecrire: Chemin[]}`, `moteurRequis: 'js'|'wasm'`, `residus[]`. Le type `Chemin` lui-même (`P0|P1|P2|P3`) ne prend son sens qu'après S1. Geler ce fichier à J0, c'est garantir soit que le gel casse, soit que les lots B, C et D construisent contre une fiction pendant des semaines.

**La preuve que la dérivation n'a pas été faite** — et c'est un trou fonctionnel réel, pas une objection de méthode :

D3 §2.2 affiche dans le bandeau de l'îlot :
> « JPEG · 4,2 Mo · **Actuellement : Montpellier** »

D3 §2.3 annonce en région live :
> « Photo lue. **Position actuelle : Montpellier, Hérault.** »
> « Repère déplacé au clavier (throttlé 700 ms) : "43,9493 nord. 4,8055 est." puis, après 700 ms de silence : **"Avignon, Vaucluse."** »

Ces trois chaînes exigent un **géocodage inverse : coordonnées → commune**. Or :
- D2 §1.7 livre 5 colonnes — `noms`, `pop`, `insee`, `coord`, `cp` — et **aucun index spatial**.
- D2 §1.8 spécifie la recherche par nom, par préfixe, par sous-chaîne et par code postal. **Rien par coordonnées.**
- D2 §2.8 fixe le contrat de la carte : `focus: {code, lat, lon}` — « commune sélectionnée » : **c'est l'application qui fournit déjà le code**.

**Personne n'écrit la fonction.** Et quand on la spécifie, deux conséquences tombent immédiatement, toutes deux en contradiction avec D2 :

1. Elle force le chargement de la colonne `coord` (**123 115 o brotli**, classée **Tier 2** par D2, « chargé à la première sélection d'un résultat ») **dès l'ouverture de toute photo géolocalisée** — c'est-à-dire dans le cas nominal. Le découpage Tier 1 / Tier 2 de D2 s'effondre.
2. **Le plus proche centroïde n'est pas la commune contenante.** Une photo prise à Villeneuve-lès-Avignon est plus proche du centroïde d'Avignon que du sien. Annoncer « Avignon, Vaucluse » serait **factuellement faux** — sur un projet dont la règle cardinale est de ne rien affirmer sans le mesurer. Répondre correctement exige un test point-dans-polygone sur les contours communaux, donc de charger le shard du lot C (9,8 à 24,6 Ko) pour afficher un simple nom.

**Gravité : BLOQUANT.**

**Correctif.**
1. **Le contrat `src/lib/core/` ne se gèle pas à J0, il se gèle à la fin de S1.** Le jalon 0 produit une version *provisoire*, explicitement marquée comme telle, et les lots B/C/D démarrent sur des bouchons (`stub`) qu'ils remplacent après le spike. C'est le seul ordonnancement honnête : **A n'est pas parallèle aux autres, il les précède de 2 à 3 semaines.**
2. Ouvrir **Q-003 : géocodage inverse**, avec trois options : (A) plus proche centroïde, en affichant « près de Avignon » et non « à Avignon » — coût nul, formulation honnête ; (B) point-dans-polygone sur le shard départemental, exact, +10 à 25 Ko et une latence ; (C) **ne rien afficher du tout** et se contenter des coordonnées, ce qui supprime le problème et respecte le constat de R4 selon lequel la carte sert à *vérifier*, pas à *nommer*. Recommandation : (A) en v1 avec la formulation « près de », (B) en v1.1.

---

## 5. SERIEUX — « L'app est la bannière » est contredit par le montage retenu : le contrôle principal est un bouton mort jusqu'à l'idle callback, et les octets réellement transférés sont 4 fois le budget affiché

**Affirmations attaquées** (D3 §3.2 et §4.4) :

> « **AMORCE** : État vide complet, **rendu en SSR**. La bulle est un `<button>` fonctionnel dès le HTML. »
> « Le chemin initial = ~660 lignes → **3 849 o gzip**. »

**Pourquoi c'est fragile — deux défauts distincts.**

**(a) Le héros est inerte pendant une fenêtre non bornée.** Un `<button type="button">` sans JavaScript ne fait rien. L'`<input type="file">` associé est `hidden`, `tabindex="-1"` et `aria-hidden="true"` (D3 §5.2) : sans JS, il est **inatteignable**. Or l'hydratation est planifiée par le `requestIdleCallback` maison de R5, dont le code est donné :

```js
'requestIdleCallback' in window ? requestIdleCallback(boot, {timeout: 2000}) : setTimeout(boot, 200);
```

**Le pire cas documenté est donc de 2 000 ms après la fin du travail bloquant**, et `requestIdleCallback` ne se déclenche que lorsque le fil principal est libre — précisément ce qui n'arrive pas tôt sur un mobile milieu de gamme en train de composer trois blobs animés en `mix-blend-mode: screen` avec 70 px de flou et un `backdrop-filter: blur(26px)`. Un LCP à 1,8 s avec un contrôle principal qui ne répond qu'à 3,5 s, ce n'est pas « l'app est la bannière », c'est **une capture d'écran de l'app en guise de bannière**. Et aucun mécanisme de mise en file de l'intention n'est spécifié : un clic pendant cette fenêtre est **perdu silencieusement**.

**(b) Le budget de 150 Ko gouverne 26 % des octets réellement transférés.** Le budget est défini « hors index de lieux et contours de carte » — l'exclusion vide la contrainte de son sens. Parcours de référence (déposer une photo, chercher une commune, télécharger), tous chiffres MESURÉS par R2/R4/R5/D2 :

| Poste | octets |
|---|---|
| JS total gzip (D3, central) | 100 478 |
| Index de communes, Tier 1 (D2) | 189 992 |
| Contours départements TopoJSON (R4) | 28 100 |
| Shard communal, médiane (R4) | 9 800 |
| Polices woff2, **incompressibles** (R5) | 56 164 |
| CSS Leaflet (R2) | 3 522 |
| **Total** | **388 056 o ≈ 379 Kio** |

Le budget contraint **100 478 / 388 056 = 25,9 %** du transfert. Sur l'hypothèse 4G de R5 (≈ 200 Ko/s), cela fait **1,9 s de transfert pur après le LCP** ; avec le Tier 2 (167 751) et un WASM à 400 000, on monte à **955 807 o soit ≈ 4,7 s**.

**Gravité : SERIEUX.**

**Correctif.**
1. **Rendre le héros fonctionnel à JS zéro** : envelopper la bulle dans un `<label for="picker">` et rendre l'`<input type="file">` visible aux technologies d'assistance. Le sélecteur de fichiers s'ouvre alors nativement, sans une ligne de JavaScript, dès le premier paint. C'est plus simple que le montage actuel *et* strictement meilleur.
2. **Hydrater sur intention, pas sur oisiveté** : `pointerdown`, `dragenter`, `paste` et `change` déclenchent le boot ; `requestIdleCallback` n'est plus qu'un pré-chargement opportuniste. Et **mettre l'intention en file** : si un fichier arrive avant que le worker soit prêt, on l'enregistre et on le traite au boot.
3. **Ajouter un second budget, contraignant, au §9 de la recette** : « octets totaux du parcours de référence ≤ 400 Ko », mesuré sur un scénario nommé. Un budget qui exclut 74 % des octets n'est pas un budget, c'est un slogan.

---

## 6. SERIEUX — Le critère des 60 secondes n'est pas mesurable, et le plan lui-même le rend inatteignable sur le format le plus courant

**Affirmation attaquée** : le critère de recette du §9, tel qu'il m'est décrit — un utilisateur va du dépôt au téléchargement en moins de 60 secondes. *(Je n'ai pas le texte littéral : NON VÉRIFIÉ.)*

**Pourquoi c'est fragile — deux angles indépendants.**

**(a) Le critère est infalsifiable en l'état.** Il ne dit ni qui est l'utilisateur, ni quel fichier, ni quel appareil, ni quel réseau, ni ce que « réussir » veut dire. Un projet dont toute la méthode repose sur la distinction **MESURÉ / DOCUMENTÉ / ESTIMÉ** ne peut pas se doter d'un critère de recette qu'on ne sait pas rejouer à l'identique. D3 §7 classe d'ailleurs déjà « INP du dépôt de 12 photos » et « CLS mobile réel » en NON VÉRIFIÉ — les deux grandeurs dont dépendrait ce chrono.

**(b) Le plan impose lui-même des écrans de décision qui font exploser le chrono, et précisément sur l'iPhone.** Scénario nominal : un utilisateur dépose un HEIC issu d'une Live Photo pour en effacer la position. D1 impose, dans l'ordre :

1. **T11**, écran de décision : « Cette photo est accompagnée d'**une courte vidéo**, qui contient elle aussi le lieu. […] [ Traiter les deux (recommandé) ] [ L'image seule ] »
2. Si Q-002 tourne en voie JS, **T7**, cinq phrases : « Nous n'y toucherons pas. À la place, nous créons un second petit fichier, portant le même nom avec l'extension `.xmp` […] **Gardez les deux fichiers ensemble** […] »
3. Après suppression, le balayage résiduel de D1 §5.4 peut déclencher **T10**, second écran de décision avec arbitrage de vie privée : « Retirer toutes les informations de l'appareil […] *Recommandé si vous publiez cette photo.* » / « Garder ces informations — mais dans ce cas, sachez qu'un outil spécialisé pourrait encore y retrouver le lieu. »

Soit **jusqu'à trois décisions et ~130 mots de prose française** avant d'obtenir un fichier, sur le format le plus déposé. Le coût n'est pas machine (le balayage résiduel est estimé à 50 ms pour 100 Mo) : **il est humain**. Aucun utilisateur naïf ne lit et arbitre trois écrans de vie privée en moins de 60 secondes, et **c'est très bien ainsi** — ces écrans sont ce qui rend l'outil honnête. Le critère est donc en conflit frontal avec la conception, et l'un des deux cédera : soit on chronomètre et on supprime les écrans, soit on garde les écrans et le critère est faux dès le premier test.

**Gravité : SERIEUX.**

**Correctif.** Remplacer le seuil par un protocole, et **découpler ce qu'on mesure de ce qu'on impose** :
- **Protocole** : 5 utilisateurs naïfs, 3 tâches nommées, corpus figé (F1 JPEG iPhone, F2 HEIC, F3a+F3b Live Photo de D1), sur un Android milieu de gamme et un Safari iOS, en 4G bridée. Succès = tâche accomplie **sans aide**. On rapporte la médiane et on ne fixe **aucun seuil** avant d'avoir une ligne de base.
- **Seuil séparé et lui, tenable** : « **temps jusqu'au premier retour actionnable ≤ 5 s** » — c'est-à-dire dépôt → position affichée et carte centrée. C'est mesurable, c'est sous notre contrôle, et c'est ce que l'utilisateur perçoit comme « rapide ».
- **Rendre les écrans de décision sautables** : T10 et T11 acquièrent une option par défaut recommandée, préactivée, avec un « Continuer » unique — le choix reste explicite mais coûte un clic, pas une lecture.

---

## 7. SERIEUX — Le h1 visuellement secondaire n'est pas le problème (j'ai vérifié, ça tient) ; le problème est que la règle des 7 blocs × 4 pages impose 8 500 à 13 700 mots pour un contenu que personne ne lira

**Ce que je valide d'abord**, parce que c'est une information utile : l'analyse de D3 §2.1 sur l'écart entre ordre DOM et ordre visuel **est correcte**. Le conteneur ne comporte qu'un seul élément focalisable, donc SC 2.4.3 (Focus Order) est intact ; et la séquence DOM `h1 → promesse → bulle` est elle-même signifiante, donc SC 1.3.2 est satisfait. Le recours à `grid-template-areas` plutôt qu'à `order` est le bon choix. **Cette objection-là ne tient pas, je la retire.**

**Affirmation attaquée en revanche** (D4 §2, contrôle C-bis de §6) :

> « Ces 7 blocs apparaissent sur les 4 pages, mais **jamais avec le même texte**. […] le script de build compare les blocs entre eux et **échoue si deux versions sont trop proches** [similarité de Jaccard > 0,6]. »

**Pourquoi c'est fragile — calcul (ESTIMÉ, à partir des fourchettes de D4 §2) :**

| Bloc | mots min | mots max |
|---|---|---|
| 1 À quoi sert | 120 | 200 |
| 2 Pourquoi vos fichiers ne partent pas | 350 | 500 |
| 3 Ce que contient une photo | 250 | 400 |
| 4 Mode d'emploi | 200 | 350 |
| 5 Formats et limites | 200 | 350 |
| 6 Vie privée | 300 | 450 |
| 7 Vérifier avec ExifTool | 350 | 500 |
| **Par page** | **1 770** | **2 750** |
| **× 4 pages** | **7 080** | **11 000** |
| + sections propres (#sommaire, #par-appareil, #photo-sans-exif, #la-carte) | +600 | +1 200 |
| + mentions légales et confidentialité | +800 | +1 500 |
| **Total** | **8 480** | **13 700** |

À une cadence de 500 à 800 mots par jour de **prose technique française dont chaque affirmation factuelle doit être sourcée** (la règle de véracité du projet s'applique au contenu comme au code) : **11 à 27 jours-homme de rédaction seule**. Et deux blocs sont **bloqués par le lot A** : le bloc 5 ne peut pas être écrit avant le spike (D4 le dit : « Ne jamais publier une case supposée »), et le bloc 7 exige de rejouer chaque commande ExifTool sur des fichiers réels — ExifTool n'étant pas installé.

Le problème de fond n'est pas le volume, c'est **le rendement**. Ce contenu est intégralement sous la ligne de flottaison, sur un site où le héros est un outil conçu pour qu'on l'utilise en 60 secondes. Son lecteur réel est Googlebot. Et la règle C-bis **interdit précisément la mutualisation qui rendrait le coût soutenable** : elle force à réécrire quatre fois une explication technique dont la vérité, elle, est unique. Sur un projet dont la promesse est la rigueur factuelle, **écrire quatre variantes différentes du même fait est un générateur d'incohérences**, pas une garantie de qualité.

**Gravité : SERIEUX.**

**Correctif.**
1. **Trois blocs partagés, quatre blocs propres.** Les blocs 2 (pourquoi vos fichiers ne partent pas), 6 (vie privée) et 7 (ExifTool) sont **canoniques** : rédigés **une fois**, hébergés sur une page dédiée (`/confidentialite/` pour le 2, `/verifier-vous-meme/` pour le 7), et référencés par un lien depuis les 4 pages avec un résumé de 3 lignes propre à chaque page. Économie : **1 000 à 1 450 mots × 3 réécritures = 3 000 à 4 350 mots**, soit 4 à 9 jours. Et le fait n'existe qu'à un seul endroit, donc il ne peut pas se contredire.
2. **Remplacer C-bis** : au lieu d'interdire la similarité, contrôler que **chaque page possède au moins 400 mots qui n'existent nulle part ailleurs sur le site**. C'est le vrai critère (contenu propre), et il n'impose pas de paraphraser des faits.
3. **Séquencer** : la v0 n'a qu'une page. Les 3 autres s'écrivent une fois qu'on sait, par la Search Console, ce que les gens tapent réellement — ce qui répond aussi à l'objection 2.

---

## 8. SERIEUX — Quatre autres réductions ou extensions silencieuses du périmètre, décidées sans QUESTIONS.md

**Affirmation attaquée** : le dispositif QUESTIONS.md est présenté comme le mécanisme d'arbitrage inter-lots. **Une seule entrée a été ouverte sur l'ensemble du dossier** (D1, Q-001, sur l'IPTC — le point de moindre impact utilisateur). Voici quatre décisions de portée supérieure, prises unilatéralement.

**(a) Le shard par lettre a été supprimé alors que la contrainte projet l'exige nommément.** Le cahier des charges dit : *« recherche de commune sur index local précompilé et **shard par lettre** »*. D2 §1.6 le tue — avec des mesures excellentes (shard `s` = 64 615 o brotli contre un plafond de 40 Ko ; découpe récursive jusqu'au 5-gramme insuffisante ; index de trigrammes qui sélectionne **13,68 shards sur 16 en moyenne**, résultat négatif remarquable) — et le remplace par 6 plages de rang INSEE. **La conclusion est juste, la méthode ne l'est pas** : une contrainte nommée dans le brief se retire par une entrée QUESTIONS.md, pas par un tableau.

**(b) Les îlots `client:idle` ont été supprimés, alors que le brief dit « Astro en output static + îlots hydratés `client:idle` ».** R5 le justifie très bien (2 093 o de runtime Astro évités, plus le framework UI). Même remarque : c'est une déviation du brief, non signalée comme telle.

**(c) La lecture WebP est un trou, et personne ne le budgète.** R2 a mesuré qu'`exifr` **ne supporte pas WebP du tout** (issue #129 ouverte depuis décembre 2024). D1 §2.2 marque pourtant « WebP étendu → Lire ✅ chunks `EXIF` et `XMP ` ». Cela suppose **d'écrire notre propre lecteur RIFF** — et le tableau de lignes de D3 §4.3 ne contient **aucune entrée WebP** pour le lot A. C'est une extension silencieuse du périmètre, l'inverse d'une réduction, et donc invisible à toute revue de budget.

**(d) Le corpus de test P0 sera à jamais inexécutable en intégration continue.** D1 §7.1, règle 3 : *« Le corpus ne va JAMAIS dans le dépôt public »* — photos personnelles de Mathieu, licences CC BY-SA sur les images, poids. La parade proposée est un dépôt privé plus un `SHA256SUMS`. Pour Mathieu seul, ça marche. Mais D4 bloc 2 veut écrire au public : *« Le dépôt et le script de build sont publics ; les fichiers servis sont ceux que le build produit »* comme **quatrième moyen de vérification de la promesse de confidentialité**. Un dépôt public dont **les 16 tests P0 ne peuvent pas être rejoués par un tiers** affaiblit exactement l'argument qu'il est censé porter. Ce n'est pas rédhibitoire, mais c'est une baisse silencieuse du niveau de preuve, sur le seul terrain où le produit prétend être irréprochable.

**Gravité : SERIEUX.**

**Correctif.**
1. Ouvrir **quatre entrées rétroactives** — Q-004 shard par lettre, Q-005 îlots `client:idle`, Q-006 lecteur WebP (avec la ligne de budget correspondante, ~150 lignes ESTIMÉ), Q-007 exécutabilité du corpus en CI. Elles seront probablement toutes validées ; l'important est qu'elles soient **datées, tracées et signées**, sinon personne ne saura dans six mois pourquoi le brief et le code divergent.
2. **Rendre le corpus partiellement public** : constituer un sous-ensemble de 6 à 8 fichiers **entièrement CC0** (raw.pixls.us est CC0 et garantit la non-retouche — vérifié par D1) plus des fichiers synthétiques générés par script, suffisant pour faire tourner un `test:public` en CI publique. Les 20 fichiers restants alimentent un `test:full` privé. La promesse du bloc 2 devient alors vraie.
3. **Ajouter au §12 une règle explicite** : *toute divergence avec une contrainte nommée du cahier des charges ouvre une entrée QUESTIONS.md, même quand la divergence est manifestement justifiée.* C'est ce qui empêche le périmètre de dériver par accumulation de bonnes décisions isolées.

---

## Ce qui tient après examen — et qu'il ne faut pas toucher

Je l'écris parce que c'est une information utile, et parce que j'ai cherché à faire tomber ces points sans y parvenir :

- **P1, l'édition sur place à longueur constante (D1 §0).** C'est la meilleure idée du dossier, et de loin. Elle rend la suppression — le cas d'usage n°1 — indépendante de tout écrivain de format, préserve MakerNote/MPF/APP13/ordre des octets *par construction*, et fait qu'un RAW de 120 Mo coûte le même pic mémoire qu'un JPEG de 2 Mo. Elle devrait être le tout premier livrable, avant toute décision Rust.
- **Leaflet contre MapLibre.** 42 706 o contre 280 431 o gzip, mesurés deux fois indépendamment. Le débat est clos par le nombre, et l'argument RGAA (rien de focalisable dans un `<canvas>` WebGL) le referme définitivement.
- **Le refus de fabriquer un `aggregateRating`.** Décision juste, conséquence assumée (pas de rich result), et qui vaut mieux qu'un balisage inventé.
- **Les résultats négatifs de D2** — le piège des tableaux typés (9,4 % *plus lourds* qu'un TSV après Brotli), l'inutilité de l'index de trigrammes, le NO-GO à trois arguments sur `fst`/Rust. Publier des résultats négatifs mesurés est ce qui distingue ce dossier d'une note d'intention.
- **Le balayage résiduel (D1 §5.4).** C'est le seul mécanisme du plan qui reste valide quelles que soient les réponses aux 20 points NON VÉRIFIÉS. Il transforme une promesse en preuve, et il est bon marché.
- **La découverte des deux fuites Live Photo / photo animée Android (D1 §6.4).** Aucun des 20 concurrents audités ne les traite. C'est le différenciateur produit le plus solide du dossier — bien plus que le « zéro requête tierce », parce qu'il est démontrable en trente secondes devant un utilisateur.

**Le fil rouge des 8 objections :** le dossier est excellent en profondeur technique et faible en **économie de projet** — il ne dit nulle part ce qu'on livre en premier, ni comment quelqu'un arrive sur le site, ni combien de mois ça coûte. Les objections 1, 2, 3 et 4 se règlent toutes par la même décision : **définir une v0 JPEG livrable en 4 à 6 semaines, lancer S1.2/S1.3 immédiatement (2 jours, sans wasm), et obtenir des volumes réels avant d'écrire 11 000 mots.**