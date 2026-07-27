# CONTRADICTION D1 — noyau de métadonnées

Mesures faites dans cette session, marquées **MESURÉ**. Sources brutes téléchargées : `https://www.itu.int/itudoc/itu-t/com16/tiff-fx/docs/tiff6.pdf` (200, 249 524 o), `https://exiftool.sourceforge.net/TagNames/QuickTime.html`, `.../JPEG.html`, `raw.githubusercontent.com/mdn/browser-compat-data`, `raw.githubusercontent.com/mdn/content`, `crates.io/api/v1/crates/*`.

---

## 1. BLOQUANT — P1, la colonne vertébrale du plan, casse le chaînage IFD tel qu'il est décrit

**Affirmation attaquée** (§0) :
> « En retirant l'entrée `GPSInfo` (0x8825) d'IFD0 et en réécrivant l'IFD sur place avec `count = n−1`, on laisse 12 octets morts en fin de structure que **plus rien ne référence**. On met ensuite à zéro le GPS IFD et **sa zone de valeurs**. »

**Pourquoi c'est faux.** TIFF 6.0, texte extrait du PDF officiel dans cette session, **verbatim** :

> « An Image File Directory (IFD) consists of a 2-byte count of the number of directory entries (i.e., the number of fields), **followed by a sequence of 12-byte field entries, followed by a 4-byte offset of the next IFD** (or 0 if none). »

Et la Figure 1 place ce pointeur à l'adresse **`A + 2 + B×12`**, où `B` est le nombre d'entrées. Le pointeur next-IFD **n'a pas d'adresse fixe : sa position est une fonction de `count`.** Passer `count` de `n` à `n−1` fait que le lecteur ira chercher les 4 octets du pointeur **12 octets plus tôt**, c'est-à-dire au milieu de ce qui était l'avant-dernière entrée. Dans un JPEG EXIF, ce pointeur mène à **IFD1, l'IFD de la vignette**. Une implémentation littérale de la phrase citée produit donc un offset de vignette aléatoire — au mieux une erreur de parsing, au pire un lecteur qui suit un offset arbitraire dans le fichier. Et cela sur le chemin dont §2.2 promet « taille identique, MakerNote intact, aucun résidu ».

Deuxième erreur dans la même phrase : **« sa zone de valeurs » n'existe pas comme région.** TIFF 6.0, verbatim :

> « The Values to which directory entries point **need not be in any particular order in the file**. »

Les valeurs hors-ligne du GPS IFD peuvent être interlacées avec celles d'IFD0, de l'ExifIFD, de la vignette ou d'un MakerNote. Zéroïser « la zone de valeurs » sans carte d'octets prouvée disjointe est exactement l'opération destructrice que P1 prétend éliminer. Sur un fichier malformé — et le corpus §7 en contient par construction — une entrée GPS dont l'offset pointe dans le MakerNote fait détruire le MakerNote par le chemin « le plus sûr ».

**Gravité : BLOQUANT.** C'est le mécanisme sur lequel repose la suppression, la correction, tous les formats, et les textes T2/T4/T8.

**Correctif.**
1. La suppression d'une entrée d'IFD n'est **pas** « décrémenter count » : c'est décaler de 12 octets vers le bas toutes les entrées de tag supérieur, réécrire le pointeur next-IFD à sa nouvelle adresse `A+2+(n−1)×12` avec sa valeur d'origine, puis zéroïser les 12 derniers octets. Spécifier cette séquence en toutes lettres avant d'écrire une ligne.
2. Avant tout P1, construire une **carte complète des plages d'octets** de tous les IFD, de toutes les valeurs hors-ligne, du MakerNote, de la vignette et de tous les segments. Refuser P1 (`Err`, pas panic) si la plage à zéroïser recoupe une plage revendiquée par autre chose. Ajouter ce test au corpus avec un fichier à offsets chevauchants fabriqué exprès.

---

## 2. BLOQUANT — La vérification obligatoire est structurellement aveugle à la classe de bug la plus dangereuse

**Affirmation attaquée** (§5.2) :
> « **V1 RELECTURE PAR LE MÊME MOTEUR [OBLIGATOIRE]** » · « **V3 RELECTURE CROISÉE [si le lecteur JS est chargé]** … Un désaccord ici n'invalide pas l'écriture »

**Pourquoi c'est fragile.** Le seul contrôle bloquant en production est une **auto-relecture**. Un encodeur et un décodeur symétriquement faux passent V1 et V2 avec un écart de **exactement zéro**, quelle que soit la tolérance. La tolérance n'est pas le problème : la topologie du contrôle l'est.

Le cas concret n'est pas hypothétique. R1 a établi que `Metadata::new()` de `little_exif` force `Endian::Little`. Si nos rationnels sont sérialisés dans le mauvais ordre d'octets relativement à l'en-tête TIFF d'un fichier `MM` — c'est le bug classique sur ce chemin, et §6.2 le signale sans en tirer de conséquence sur la vérification — alors notre lecteur, qui applique la même hypothèse, renvoie la valeur demandée au bit près. V1 ✅, V2 ✅, fichier livré. ExifTool afficherait une latitude aberrante. Le corpus F8 (gros-boutiste) exposerait le bug, mais **en CI seulement, jamais chez l'utilisateur**, et §7.5 assume ce partage : « La vérification interne protège l'utilisateur en production ; l'oracle externe protège le développeur en CI. » C'est précisément l'inverse de ce dont l'utilisateur a besoin.

**Sur la tolérance elle-même**, deux remarques qui la disqualifient comme argument :
- `TOL_EXIF = 1×10⁻⁷ °` ≈ **1,11 cm**. Or l'entrée est connue à **1×10⁻⁴ °** quand elle vient du centroïde de commune (D2 §1.2 : la source geo.api n'a **que 4 décimales**, mesuré) et à **1×10⁻⁵ °** quand elle vient du champ `step="0.00001"` (D3). Vérifier au centimètre une valeur connue à 11 mètres est du théâtre de précision : la seule chose que ce seuil détecte, c'est un bug de notre encodeur — ce que l'auto-relecture ne peut de toute façon pas voir.
- Preuve terrain que « plus de précision » n'est pas neutre : ExifTool documente pour `com.apple.quicktime.location.ISO6709` (**MESURÉ**, table QuickTime) : *« Google Photos may ignore this if the coordinates have more than 5 digits after the decimal »*. Un consommateur majeur casse au-delà de 5 décimales.

**Gravité : BLOQUANT.**

**Correctif.**
1. **V3 devient obligatoire et bloquante.** Le coût est nul : l'architecture §1.3 charge déjà `exifr` (14,8 Ko) dans le bundle initial pour la lecture, dans les deux branches de l'arbre de décision. Un fichier écrit par le WASM est relu par `exifr` et réciproquement ; désaccord au-delà de `TOL_CROISE` = échec, pas mention discrète.
2. Ajouter un **vecteur de test à valeur connue**, avec les 24 octets de `GPSLatitude` écrits à la main en `II` et en `MM`, contrôlés par comparaison binaire et pas par relecture. C'est le seul test qui attrape l'inversion d'endianness sans oracle externe.
3. Garder `TOL_EXIF = 1e-7` comme **détecteur de bug** de l'encodeur, et cesser de le présenter comme une garantie de précision ; journaliser l'écart réel dans le rapport de diagnostic.

---

## 3. BLOQUANT — Sur la vidéo, la suppression décrite ne supprime pas, et le balayage résiduel ne le verra pas

**Affirmations attaquées** (§2.2 et §5.4) :
> « **Supprimer** : ✅ **P1 : `©xyz` → `free`** · taille **identique** »
> « **Le balayage résiduel (§5.4) est ce qui transforme une promesse en preuve.** C'est aussi le seul mécanisme qui reste valide quelles que soient les réponses aux vingt points NON VERIFIÉS. »

**Pourquoi c'est faux.** Inventaire **MESURÉ** dans les tables QuickTime d'ExifTool, une seule page, une seule requête :

| Emplacement | Contenu |
|---|---|
| `©xyz` | GPSCoordinates |
| **`@xyz`** | GPSCoordinates, « other models » (Samsung et al.) — **absent de la matrice D1** |
| `com.apple.quicktime.location.ISO6709` | GPSCoordinates, **inscriptible** |
| **`location.name`, `location.body`, `location.role`, `location.note`, `location.date`, `location.accuracy.horizontal`** | le lieu **en toutes lettres**, la date, la précision — **tous absents de la matrice D1** |
| `loci` | *« string in the form "XXXXX Role=XXX Lat=XXX Lon=XXX Alt=XXX Body=XXX Notes=XXX", used in 3gp videos »* |
| pistes temporisées | `GPSLatitude`, `GPSLongitude`, `GPSAltitude`, `GPSSpeed`, `GPSTrack`, `GPSDateTime`, `GPSDOP`, `GPSSatellites` |

Deux conséquences fatales :

**(a)** Renommer `©xyz` en `free` laisse intactes au minimum `location.ISO6709` et **`location.name`** — une chaîne de caractères lisible du type « Avignon ». Le balayage §5.4 cherche des **coordonnées** (rationnels, décimal 4-6 chiffres, ISO 6709, DMS textuel) : il ne cherche aucun toponyme, donc il ne le trouvera pas et rendra un verdict « aucun résidu » sur un fichier qui dit le lieu en clair.

**(b)** Pire : les pistes GPS temporisées vivent dans **`mdat`**, et §4.2 pose comme optimisation que « **`mdat` toujours sauté** ». Un MP4 de dashcam, d'action-cam ou de drone contient des milliers de points. La suppression en retire un. Le balayage résiduel, lui, cherche **la** position d'origine — pas une trace : les points de la piste sont différents de celui de `©xyz`, donc aucun ne déclenche d'alerte. D4 cite déjà la FAQ ExifTool sur ce point : `exiftool -a "-gps*" -ee video.mp4`, et la FAQ précise verbatim *« GPS information may be stored in metadata formats other than just EXIF »*.

La phrase « le seul mécanisme qui reste valide quelles que soient les réponses aux vingt points NON VERIFIÉS » est donc **surrevendiquée**. Le balayage est un bon **détecteur positif** (trouver quelque chose = problème certain) et un **détecteur négatif nul** : ne rien trouver ne prouve rien. C'est vrai aussi pour toute métadonnée compressée (XMP dans un `iTXt` PNG à drapeau de compression 1, ou dans un `zTXt`), invisible à un balayage d'octets bruts.

**Gravité : BLOQUANT** pour la ligne vidéo de la v1, et **SERIEUX** pour la formulation du §5.4.

**Correctif.**
1. **Retirer MOV/MP4/3GP de la v1 en écriture et en suppression.** Les garder en lecture, avec un message explicite : « Nous savons lire le lieu d'une vidéo mais nous ne savons pas encore le retirer de façon sûre. » Le pire résultat possible pour ce produit est un utilisateur convaincu d'avoir nettoyé une vidéo qui ne l'est pas.
2. Si la vidéo revient au périmètre : inventaire exhaustif obligatoire avant toute écriture, et **refus dur** si un flux de métadonnées temporisées est détecté (`hdlr` de sous-type `meta`/`gpmd`/`camm` dans une piste).
3. Étendre le balayage : décompresser tout bloc de métadonnées déflaté avant de scanner ; ajouter les dénominateurs D ∈ {1, 100, 1000, 10⁶, 10⁷} ; ajouter la recherche du **nom de commune** correspondant à la position lue.
4. Reformuler le texte affiché : jamais « il ne reste aucune trace », toujours « nous avons cherché les traces les plus courantes et n'en avons trouvé aucune ».

---

## 4. BLOQUANT — « À l'octet près » est promis à l'utilisateur et n'est vérifié par rien

**Affirmations attaquées** (T2 et §5.2 V0/V6) :
> T2 : « Tout le reste est conservé à l'identique, **à l'octet près** »
> V0 : « si cheminUtilisé == P1 : exiger `sortie.size == entrée.size` »
> V6 : « **PRÉSERVATION DES SEGMENTS VOISINS [P2 uniquement]** »

**Pourquoi c'est fragile.** Trois trous cumulés :

**(a) L'égalité des tailles ne prouve rien.** Un bug qui zéroïse 200 Ko de MakerNote laisse `sortie.size == entrée.size`. La promesse la plus forte du produit est adossée au contrôle le plus faible. `octetsModifies` est calculé dans le type `Verification` mais **aucun seuil ni ensemble attendu n'est défini** : la donnée est collectée et jamais évaluée.

**(b) Le seul contrôle de préservation ne tourne pas sur le chemin principal.** V6 est explicitement conditionné à P2. Or l'objection 1 montre que P1 comporte sa propre étape destructrice non bornée. Le chemin déclaré « le plus sûr » est le seul sans contrôle de préservation.

**(c) V6, même là où il tourne, est trop étroit.** Il vérifie APP12, APP13, MakerNote, MPF. Il ne vérifie **ni l'ICC, ni l'orientation, ni la vignette, ni l'inventaire des tags**. Sur ce dernier point : R1 signale que l'issue amont **#93 « Loading and saving same metadata cause errors » est ouverte** et que `reduce_to_a_minimum()` existe dans le crate — donc la perte de tags en aller-retour P2 est exactement le risque que V6 ne teste pas.

Sur l'ICC en particulier, **MESURÉ** sur la table JPEG d'ExifTool : le marqueur APP2 héberge `ICC_Profile`, `FPXR`, **`MPF`**, `InfiRayVersion` (« used in Apple HDR images ») et `PreviewImage` (« Samsung APP2 preview image »). Le §6.3 de D1 traite APP2 comme s'il était **le MPF et rien d'autre**. Conséquence directe : perdre le profil Display P3 d'une photo iPhone décale visiblement les couleurs dans toute application gérée en couleur — une régression de qualité visible, sur l'appareil numéro un du cas d'usage, non détectée par la suite de vérification.

**Gravité : BLOQUANT** pour la véracité des textes T1–T4.

**Correctif.**
1. **V0 pour P1 devient un diff de plages**, pas une comparaison de tailles : l'écrivain retourne la liste exacte des `(offset, longueur)` qu'il a écrits ; la vérification compare entrée et sortie et **échoue si un seul octet hors de cet ensemble a changé**. Une passe, coût négligeable, et « à l'octet près » devient un invariant vérifié par machine au lieu d'un argument commercial.
2. **V6 tourne sur tous les chemins**, et s'étend à : profil ICC (JPEG APP2 `ICC_PROFILE`, PNG `iCCP`, WebP `ICCP`) présent avant ⇒ présent après, longueur et empreinte identiques ; `Orientation` (0x0112) idem ; IFD1 présent ⇒ vignette extractible et identique ; **inventaire complet des tags de tous les IFD avant/après, écart attendu = le seul delta GPS**.
3. Ajouter au corpus : un JPEG iPhone Display P3, un JPEG dont l'ICC dépasse 64 Ko et est donc réparti sur plusieurs APP2 numérotés (*point à confirmer sur la spécification ICC — non revérifié dans cette session*), un PNG avec `iCCP`.

---

## 5. SERIEUX — Contradiction interne : §3.1 rend impossible le P1 que §0 promet

**Affirmations attaquées** :
> §0 : « **la correction d'une position existante est également P1** … On les surcharge. »
> §3.1 : `GPSVersionID` … **« toujours »** · `GPSMapDatum` … **« toujours »** · `GPSHPositioningError` … « si l'utilisateur déclare une précision »

**Pourquoi c'est faux.** Écrire un tag qui n'existe pas déjà dans le GPS IFD coûte **12 octets d'entrée** plus la zone de valeur hors-ligne (`GPSMapDatum` = 7 octets ASCII, hors-ligne ; `GPSVersionID` = 4 octets INT8U, en ligne mais l'entrée reste à créer). Cela change `count`, décale le pointeur next-IFD, décale toutes les valeurs situées après, et invalide donc tout ce qui référence des offsets absolus — c'est-à-dire P2, avec l'interdiction MPF et le risque MakerNote qui vont avec.

Or `GPSMapDatum` (0x0012) est **absent de la majorité des fichiers réels** : peu de boîtiers l'écrivent. Donc, en pratique, « corriger une position » déclenche presque toujours P2, et les textes T1 et T3 — « nous allons la remplacer dans une copie, **en ne touchant que ces quelques octets** » — deviennent faux dans le cas nominal, pas dans un cas limite.

Il manque aussi une garde : P1 par surcharge suppose que `GPSLatitude` existante est bien `RATIONAL64U`, `count = 3`, stockée hors-ligne. R1 documente que le monde réel viole ces contraintes (issues amont #38 et #74 sur `GPSAltitudeRef` encodé `INT16U`). Aucune validation de forme n'est spécifiée avant l'écrasement.

**Gravité : SERIEUX.**

**Correctif.**
1. En P1, le jeu de tags écrit est **l'intersection stricte** avec les tags déjà présents, de type et de cardinalité conformes. `GPSMapDatum`, `GPSVersionID` et `GPSHPositioningError` deviennent « meilleur effort » : écrits si l'entrée existe, sinon omis. Le texte T1/T3 le dit.
2. Porte d'entrée obligatoire de P1 : chaque tag ciblé doit passer une validation `(type, count, offset dans les bornes, plage disjointe)`. Un seul échec ⇒ bascule explicite vers P2 ou P3, avec le texte correspondant, jamais un écrasement optimiste.
3. Décider et documenter le comportement quand l'utilisateur demande une altitude sur un fichier qui n'a ni `GPSAltitude` ni `GPSAltitudeRef` : ce n'est pas une correction, c'est un ajout.

---

## 6. SERIEUX — Le pari Rust/WASM : mauvais ordre de spike, gain marginal déjà couvert, poids mort non retirable

**Affirmation attaquée** (§1.2) :
> « **S1 — Fonctionnalité sur cible hôte.** C'est **l'étape la plus rentable du spike** … Seul ExifTool est à installer. »

**Pourquoi c'est fragile — trois angles.**

**(a) L'ordre est économiquement faux.** S1 est de très loin l'étape la plus coûteuse : il faut installer ExifTool, exiv2, PIL, réunir un corpus de 29 fichiers réels dont plusieurs photos personnelles à produire, écrire 29 fichiers `attendu/*.json` avant tout code, et 11 tests. S3 (le budget) coûte trois commandes et ne dépend d'aucun résultat de S1. Or **S3 est le critère qui tue le plus probablement le projet**, de l'aveu même de R1 et de D1 (« risque n°1 »). Faire S1 avant S3, c'est risquer de jeter plusieurs jours de travail sur un `wasm-opt` qui aurait donné la réponse en une demi-heure.

**(b) Les deux plus grosses dépendances sont du poids mort inaccessible et non désactivable.** **MESURÉ** sur `crates.io/api/v1/crates/*`, taille du `.crate` :

| Crate | Version résolue | `crate_size` | Appelable depuis notre chemin ? |
|---|---|---|---|
| `little_exif` | 0.6.23 | **84 537 o** | c'est la cible |
| `brotli` | 8.0.4 (`^8.0.1`) | **751 794 o** | **non** — une seule occurrence, dans `src/jxl.rs` (R1) |
| `quick-xml` | 0.37.5 (`^0.37.5`) | **190 481 o** | **non** — seul consommateur `src/xmp.rs`, dont l'unique fonction `remove_exif_from_xmp` est `pub(crate)` (R1) |
| `miniz_oxide` | 0.9.1 | 70 519 o | oui (PNG) |
| `crc` | 3.4.0 | 13 941 o | oui |

`brotli` + `quick-xml` = **942 275 octets de source, soit 11,1× la taille du crate qu'on veut utiliser**, pour deux bibliothèques dont **aucune n'est appelable depuis notre code** et **aucune n'est désactivable** : `little_exif` déclare `"features": {}` (MESURÉ par R1, re-mesuré par D1). *Une taille de tarball source n'est pas une taille de wasm — c'est un indice, pas une mesure du budget.* Mais l'indice pointe dans une seule direction, et il transforme « >400 Ko est le cas de risque » en « >400 Ko est le résultat attendu ».

**(c) Le gain net du Rust est plus étroit que ne le dit l'arbre.** §1.3 le pose lui-même : en cas de NO-GO, « on ne perd que "ajouter une position dans un HEIC qui n'en avait pas", remplacé par un fichier compagnon ». Ce sous-cas suppose un HEIC dépourvu de GPS — donc une photo iPhone prise services de localisation désactivés, ou nettoyée par une messagerie (qui convertit généralement en JPEG au passage). On envisage donc jusqu'à 400 Ko de WASM, une chaîne d'outils Rust, et un fork d'un crate dont l'amont a 12 issues ouvertes dont #77 « Remove all unwraps » et #93 « Loading and saving same metadata cause errors », et dont `main` est en avance sur le tag publié sans bump de version (R1), **pour un sous-cas d'un sous-cas déjà couvert par P3**.

**Gravité : SERIEUX.** Ce n'est pas une erreur de correction, c'est un risque d'investir deux semaines au mauvais endroit.

**Correctif.**
1. **Inverser : S2 puis S3 d'abord** (`rustup target add`, `cargo build`, `wasm-pack build`, `wasm-opt -Oz`, `node mesure.mjs`, `twiggy top` — 35 minutes montre en main, aucun corpus). Ne lancer S1 que si `brotli(opt.wasm) + brotli(glue)` passe.
2. Ajouter au critère d'arrêt : mesurer **avec et sans** le fork qui retire `mod jxl;` et `mod xmp;`. Si seul le fork passe, la décision n'est plus « Rust ou JS » mais « accepter une dette de fork permanente sur un amont instable ».
3. Compter la **glue wasm-bindgen dans le budget JS de 150 Ko**, pas dans les 400 Ko : le tableau de D3 §4 ne comporte aujourd'hui aucune ligne pour elle.
4. Écrire dans `DECISIONS.md`, avant le spike, la phrase qui rend la décision réversible : *« Le seul gain net attendu du Rust est l'ajout d'une position dans un HEIC/AVIF/TIFF qui n'en a pas. Si ce gain ne justifie pas le coût mesuré en S3, on ne fait pas S1. »*

---

## 7. SERIEUX — « Aucun cul-de-sac » est faux : le compagnon n'est pas plaçable, et il n'existe pas pour la suppression

**Affirmation attaquée** (§0 et §2.1) :
> « **Aucune cellule n'est vide, aucune n'est un cul-de-sac.** »
> T7 : « nous créons **un second petit fichier** … **Gardez les deux fichiers ensemble**, dans le même dossier. »

**Pourquoi c'est faux — trois points.**

**(a) Un navigateur ne peut pas poser un fichier à côté d'un autre.** Il déclenche un téléchargement, qui atterrit dans le dossier de téléchargements. L'utilisateur reçoit `IMG_4231.xmp` dans `Téléchargements` pendant que `IMG_4231.CR2` est resté dans son dossier de photos. T7 lui demande donc d'effectuer manuellement l'opération de gestion de fichiers que l'outil est censé lui épargner — et un compagnon égaré est pire qu'une absence de compagnon : il donne l'impression que le travail est fait.

**(b) P3 n'existe pas pour la suppression.** Un fichier compagnon peut ajouter une information, jamais en retirer une. Si P1 échoue sur un RAW (tag GPS de type non conforme, offsets chevauchants, fichier illisible), il n'y a **aucun repli** : c'est un cul-de-sac franc, sur le cas d'usage numéro un du produit, sur une ligne de la matrice qui affiche pourtant un ✅.

**(c) L'aperçu JPEG embarqué d'un RAW porte sa propre position complète.** Quasiment tous les RAW contiennent un aperçu JPEG de grande taille, avec un bloc EXIF complet et son propre GPS IFD. Le balayage §5.4 le détectera — il est encodé comme le nôtre, donc le motif rationnel correspond — et attribuera la zone `apercu-integre`. Mais **le seul remède offert, T10, propose de retirer les informations de l'appareil (MakerNote)**, ce qui ne touche pas l'aperçu. Le produit détecte donc correctement une fuite pour laquelle il ne propose aucune action. C'est le pire des trois états possibles : ni propre, ni silencieux, mais bloqué.

**Gravité : SERIEUX**, et BLOQUANT pour la formulation de §0.

**Correctif.**
1. **P1 récursif** : quand l'analyse localise un aperçu JPEG embarqué (RAW, HEIC), appliquer le même P1 à cet aperçu, en place, longueur constante. C'est le même code, et cela ferme la fuite au lieu de l'annoncer.
2. Ajouter à T10 une troisième option quand la zone est `apercu-integre` : « retirer la position de l'aperçu intégré », qui est sans risque en P1.
3. Réécrire §0 : remplacer « aucun cul-de-sac » par la vérité — **la lecture n'a pas de cul-de-sac ; la suppression en a un quand P1 échoue ; l'ajout en a un quand ni P2 ni P3 ne conviennent.** Et prévoir le texte de ce cul-de-sac, ce que D1 ne fait nulle part.
4. Réécrire T7 pour le navigateur : proposer un **ZIP contenant les deux fichiers** (`client-zip` est déjà au budget), ce qui les maintient ensemble par construction, et dire explicitement que le compagnon ne sert **qu'à ajouter** une position.

---

## 8. SERIEUX — Le plafond mémoire P2 repose sur une API absente de deux moteurs sur trois, et ignore que la mémoire wasm ne décroît jamais

**Affirmation attaquée** (§6.7) :
> « `plafondP2 = clamp(navigator.deviceMemory ?? 4, 2, 8) × 32 Mo` … `navigator.deviceMemory` est absent de Safari ⇒ défaut prudent à 4. »

**Pourquoi c'est fragile.** **MESURÉ** dans `mdn/browser-compat-data`, `api/Navigator.json`, entrée `deviceMemory` :

| Moteur | Support |
|---|---|
| Chrome | 63 — *« From Chrome 147, reported values are 2, 4, 8, 16, and 32 »* |
| **Firefox** | **`version_added: false`** |
| **Safari / Safari iOS** | **`version_added: false`** |
| Chrome Android | 63 — *« From Chrome 147, reported values are 1, 2, 4, and 8 »* |

Donc : **Firefox aussi est concerné, pas seulement Safari** — la formule est une **constante à 128 Mo sur deux des trois moteurs**. Sur Chrome, le `clamp(…, 2, 8)` écrase l'échelle {2, 4, 8, 16, 32} : une machine à 32 Go et une machine à 8 Go obtiennent le même plafond. La formule ne distingue donc que trois cas, sur un seul navigateur. Elle donne l'illusion d'une adaptation qui n'existe pas.

Deuxième défaut, plus grave : `deviceMemory` rapporte la mémoire **de l'appareil**, jamais la mémoire **disponible**. Une machine à 8 Go avec 40 onglets ouverts ne peut pas allouer 3 × 85 Mo.

Troisième défaut, jamais mentionné : **la mémoire linéaire WebAssembly ne décroît jamais.** MDN, `WebAssembly.Memory`, section « Instance methods » — **une seule méthode existe** : `grow()`, *« Increases the size of the memory instance »*. Il n'y a pas de `shrink()`. Combiné à §4.8 (« **Une seule instance WASM**, dans un Worker dédié »), cela signifie qu'après un seul fichier de 120 Mo traité en P2, l'instance conserve ~360 Mo de mémoire linéaire **pour toute la durée de la session**, y compris pendant le traitement des 400 fichiers suivants de 3 Mo. Sur un lot, c'est un comportement de fuite mémoire.

**Gravité : SERIEUX** (MINEUR sur la formule seule ; SERIEUX à cause du non-décroissement en mode lot).

**Correctif.**
1. **Ne pas prédire, essayer et rattraper.** Tenter l'allocation, capturer `RangeError` / échec de `memory.grow`, et basculer sur P1 ou P3. Doubler d'un plafond dur indépendant de toute API (par exemple 64 Mo), relevé seulement après une allocation d'essai réussie.
2. **Recréer l'instance WASM** (ou terminer et relancer le Worker lourd) après tout fichier dont la taille dépasse un seuil, et à chaque `MOTEUR_PLANTE`. Le coût est déjà provisionné en §4.6.
3. Mesurer réellement le facteur « ≈ 3 × la taille du fichier » en S6 via `WebAssembly.Memory.buffer.byteLength` avant/après : c'est aujourd'hui un ESTIMÉ qui pilote un plafond de sécurité.

---

# Ce qui tient après examen — et c'est une information utile

**L'IPTC est traité correctement, et l'attaque attendue ne prend pas.** D1 ne prétend nulle part écrire des coordonnées en IPTC IIM : il établit sur pièces (source ExifTool `XMP2.pl` l. 332, commentaire des auteurs verbatim : *« the GPS elements of this structure are in the "exif" namespace »*) que la demande initiale est techniquement infondée, et il ouvre `Q-001` au lieu de trancher seul. C'est exactement le bon geste. **Une seule réserve** : l'option B recommandée écrit `Iptc4xmpExt:LocationCreated`, ce qui crée une **troisième copie** des coordonnées et alourdit le seul chemin qui compte vraiment, la suppression. Or la purge XMP « à longueur constante » décrite (« on retire les attributs `exif:GPS*` et on recomplète en espaces ») ne couvre que la **forme attribut** ; RDF/XML admet aussi la forme élément, `rdf:parseType="Resource"` et `rdf:Bag`, et une structure imbriquée n'est pas un attribut. Si l'option B est retenue, la purge doit être un passage XML conscient des espaces de noms, testé sur les quatre sérialisations. Sinon, l'option A est plus sûre pour la v1.

**Trois décisions sont solides et méritent d'être défendues telles quelles :**

- **La lecture par tranches (§4.2) et la composition de Blob (§4.3).** Lire une position dans un RAW de 80 Mo ou une vidéo de 4 Go pour quelques dizaines de kilo-octets, et produire une sortie dont le pic mémoire est la taille du correctif, sont deux choix justes, et ce sont eux qui rendent le lot de plusieurs centaines de fichiers réaliste. Rien à redire.
- **La détection des photos animées (§6.4).** Le fichier `.MOV` frère d'une Live Photo iPhone et le MP4 collé après `EOI` d'une photo animée Android sont deux fuites réelles, absentes de R1 à R7, absentes des 20 concurrents audités en R7, et ce sont exactement les cas où un utilisateur se croit protégé sans l'être. C'est le meilleur apport de D1.
- **Le refus d'inventer `GPSTimeStamp` et `GPSDateStamp` (§3.1).** « Ces champs décrivent l'instant du relevé satellite, pas l'instant où l'utilisateur clique. Y mettre "maintenant" serait un mensonge inscrit dans le fichier. » C'est une décision de conception honnête que la plupart des outils prennent à l'envers.

**Et une discipline à ne pas relâcher :** écrire `attendu/<id>.json` **avant** l'implémentation, avec la sortie ExifTool comme référence et le drapeau `redigeAvantImplementation: true`. C'est ce qui empêchera le corpus de devenir un enregistrement du comportement observé plutôt qu'une spécification du comportement voulu — et c'est la seule protection contre les objections 1, 4 et 5 qui reviendraient par la fenêtre.