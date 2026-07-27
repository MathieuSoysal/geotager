Toutes les mesures ci-dessous sont **refaites par moi** dans cette session (Node v22.22.2, `node:zlib`, `gzipSync{level:9}`, `brotliCompressSync{quality:11, size_hint}`, meilleur de `MODE_TEXT`/`MODE_GENERIC`), sur le corpus réel `communes-full.json` + `arm.json` (35 014 entrées). Scripts dans `/tmp/claude-0/-home-user-geotager/2bb5d8dc-bd64-5c38-a097-968efcdb334f/scratchpad/adv/`.

---

# OBJECTION 1 — BLOQUANT

## Le `no-transform` recommandé par R5 annule la compression sur laquelle repose tout le budget d'index, et les règles `_headers` se **concatènent**

**(1) Affirmations attaquées.** R5 §3 : `_headers` → `/*` `Cache-Control: public, max-age=0, must-revalidate, no-transform`, justifié ainsi : « d'où le `no-transform` dans le `_headers` ci-dessus » (pour bloquer l'injection du beacon). D2 §1.7 : « 30 fichiers, tous binaires, tous `immutable` … TOTAL 357 743 o brotli ».

**(2) Pourquoi c'est faux.** Deux phrases verbatim de la doc Cloudflare, lues aujourd'hui :

> « To preserve the Content-Length header set by the origin server, add `cache-control: no-transform` to the origin server's response. **This directive prevents Cloudflare from altering compression on responses**, allowing the Content-Length header to pass through as-is. »
> — `developers.cloudflare.com/speed/optimization/content/compression/`

> « An incoming request which matches multiple rules' URL patterns **will inherit all rules' headers**. […] **If a header is applied twice in the `_headers` file, the values are joined with a comma separator.** »
> — `developers.cloudflare.com/pages/configuration/headers/`

Donc le `_headers` combiné R5 + D2 produit sur `/data/idx-*.bin` :

```
Cache-Control: public, max-age=0, must-revalidate, no-transform, public, max-age=31536000, immutable
```

Un en-tête qui contient **deux `max-age` contradictoires** et **`no-transform`**. Le même défaut frappe `/_astro/*` : tout le cache long du site est cassé par la même règle.

**Coût mesuré :**

| | transféré | 4G ~200 Ko/s |
|---|---|---|
| encodage G, brotli CDN | 338 010 o | 1,65 s |
| **encodage G, `no-transform`** | **664 351 o** | **3,24 s** |
| TSV, brotli CDN | 522 597 o | 2,55 s |
| **TSV, `no-transform`** | **1 547 146 o** | **7,55 s** |

Facteur ×1,97 sur G, ×2,96 sur le TSV. L'écart (326 341 o) est **supérieur au budget JS total du projet** (153 600 o).

Ni R5 ni D2 ne l'ont vu : chacun regardait son lot. R5 écrivait déjà « ceinture et bretelles : ne pas activer Web Analytics du tout » — cette seconde protection suffit, la première est celle qui coûte cher.

**(4) Correctif.** Retirer `no-transform` de `/*`. La protection contre l'injection de beacon repose sur : ne pas activer Web Analytics, désactiver Email Obfuscation et Rocket Loader, et le contrôle post-déploiement `grep -ciE 'cdn-cgi|cloudflareinsights|email-decode|rocket'` que R5 avait déjà spécifié. **Ne jamais faire porter deux `Cache-Control` par un même chemin** : un contrôle de build doit simuler la concaténation `_headers` et échouer si un chemin hérite de deux directives contradictoires.

---

# OBJECTION 2 — BLOQUANT

## Le format binaire de l'encodage G n'est pas dans la liste des content-types que Cloudflare compresse par défaut

**(1) Affirmation attaquée.** D2 §1.7 : « Découpe par colonne × 6 plages de rang INSEE. 30 fichiers, **tous binaires** … TOTAL 357 743 o (349,4 Ko) ».

**(2) Pourquoi c'est fragile.** Verbatim, même page Cloudflare :

> « Cloudflare compresses **some** responses by default, based on the content type. »
> « If supported by visitors' web browsers, Cloudflare will return Gzip, Brotli, or Zstandard-encoded responses for **the following content types** : … »

La liste est finie et explicite — 47 types, que j'ai extraits intégralement. Ce qui **y est** : `text/plain`, `application/json`, `application/wasm`, `application/geo+json`, `application/ld+json`, `image/svg+xml`. Ce qui **n'y est pas** :

- `application/octet-stream` ← **le type par défaut d'un `.bin` / `.idx` / `.dat`**
- `text/tab-separated-values` ← le TSV de R3
- `text/csv`
- `font/woff2`

Un index servi en `application/octet-stream` n'est **pas compressé du tout** : 664 351 o au lieu de 338 010. Même conséquence chiffrée que l'objection 1, par une cause indépendante — donc les deux peuvent se cumuler, et corriger l'une ne corrige pas l'autre.

Deux seuils annexes vérifiés, sans effet ici mais à connaître : compression seulement au-dessus de 48 o (gzip) / 50 o (brotli, zstd), et seulement pour les statuts 200, 403, 404.

**(4) Correctif.** Forcer le type via `_headers` — la doc autorise explicitement l'écrasement : « Headers defined in the `_headers` file **override what Cloudflare ordinarily sends** » :

```
/data/*
  Content-Type: application/json
  Cache-Control: public, max-age=31536000, immutable
```

(`application/json` plutôt que `text/plain` : il est dans la liste, il évite tout sniffing, et `X-Content-Type-Options: nosniff` est de toute façon ajouté d'office par Pages.) Plus un contrôle post-déploiement qui fait un vrai `GET` sur chaque shard et échoue si `content-encoding` est absent.

---

# OBJECTION 3 — BLOQUANT

## « Si l'utilisateur tape "remy", quel shard charge-t-on ? » — réponse mesurée : **onze sur vingt-six, soit 81 % de l'index**

**(1) Affirmation attaquée.** Le brief : « recherche de commune sur index local précompilé et **shard par lettre** », combiné à l'exigence de recherche par sous-chaîne.

**(2) Mesure directe.** `remy` normalisé → 59 communes, réparties ainsi :

| shard | s | d | l | p | v | r | b | c | h | m | n |
|---|---|---|---|---|---|---|---|---|---|---|---|
| hits | 40 | 4 | 4 | 2 | 2 | 2 | 1 | 1 | 1 | 1 | 1 |

`Saint-Rémy-de-Provence` est dans **s**, `Neuville-Saint-Rémy` dans **n**, `Vandrémy`-type dans **v**, etc. Il faut donc charger **11 shards sur 26**, dont les trois plus gros (s, l, c) : **424 590 o brotli, soit 81,2 % de l'index entier, pour rendre 59 résultats.**

Et `remy` est un cas **favorable**. Sur 2 710 sous-chaînes de 4 caractères tirées au hasard dans le corpus, le fan-out moyen est de **10,75 shards sur 26**. Requêtes réelles mesurées :

| requête | résultats | shards à charger |
|---|---|---|
| `ille` | 2 853 | **26 / 26** |
| `ville` | 2 081 | 25 / 26 |
| `mer` | 457 | 24 / 26 |
| `val` | 630 | 23 / 26 |
| `court` | 905 | 23 / 26 |
| `bois` | 339 | 20 / 26 |
| `sur mer` | 102 | 20 / 26 |
| `pierre` | 303 | 16 / 26 |
| `remy` | 59 | 11 / 26 |
| `sarlat` | 1 | 1 / 26 |

La contradiction n'est pas contournable : **un shard par préfixe et une requête par sous-chaîne sont deux partitions orthogonales du même ensemble.** D2 a testé la parade évidente (index de trigrammes → bitmap de shards) et mesuré qu'elle ne sert à rien : 13,68 shards sélectionnés sur 16 en moyenne, 59,2 % des requêtes en sélectionnent 16 sur 16. Je confirme le diagnostic, avec une cause plus simple à énoncer : les trigrammes fréquents du français (`ill`, `ont`, `sur`, `ain`) sont présents dans toutes les tranches alphabétiques, aucune découpe ne les concentre.

**(4) Correctif.** Celui de D2, et il est correct : **cesser d'utiliser le shard comme filtre de requête.** La colonne des noms se charge en entier (149 155 o brotli mesuré par D2, 136 077 par moi sur ma reconstruction — même ordre), le scan `indexOf` coûte 0,05 à 3,97 ms, soit 2 % du budget INP. La découpe ne sert plus qu'à (a) tenir un plafond par fichier, (b) paralléliser, (c) rendre la recherche utilisable pendant le chargement. **Et le shard par lettre initiale doit être abandonné explicitement dans le cahier des charges**, sinon il reviendra par la porte de l'implémentation.

---

# OBJECTION 4 — SÉRIEUX

## Le seuil dur de 40 Ko par shard est inatteignable par découpe de préfixe, et l'atteindre produit 132 fichiers dont 59 sous 1 Ko

**(1) Affirmations attaquées.** « 300 à 400 Ko après Brotli, soit **15 Ko par shard**, avec un **seuil dur de 40 Ko** par shard. »

**(2) Mesure.** Charge utile réaliste (nom, INSEE, CP, lat/lon 1e-4, population), 26 shards par lettre :

| lettre | n | brut | gzip -9 | **brotli q11** | vs 40 960 |
|---|---|---|---|---|---|
| s | 5 596 | 273 043 | 111 382 | **88 222** | **×2,15** |
| l | 4 284 | 191 327 | 85 739 | **68 248** | **×1,67** |
| c | 3 695 | 160 576 | 70 870 | **56 572** | **×1,38** |
| b | 3 191 | 137 804 | 61 085 | **48 619** | **×1,19** |
| m | 3 151 | 137 280 | 60 481 | **48 252** | **×1,18** |
| … | | | | | |
| x | 21 | 877 | 513 | 439 | — |

**Cinq shards dépassent en brotli, six en gzip.** Rapport max/min = **201**. Distribution des initiales : rapport 266,5 entre `s` (5 596) et `x` (21) — je reproduis exactement le chiffre de D2, la mesure est donc solide des deux côtés.

Le « 15 Ko par shard » décrit la **médiane mesurée (13 549 o)**. Un plafond ne se dimensionne pas sur une médiane : la contrainte est fixée par le maximum, qui vaut **88 222**, soit 5,9 fois la médiane. L'erreur du brief est de diviser un total par 26 en supposant l'uniformité.

**La découpe récursive ne sauve pas.** Je l'ai exécutée jusqu'à convergence sous 40 960 o :

- **132 fichiers**, profondeur maximale **7** — les feuilles sont `saint m` (522 entrées), `saint a` (321), `saint g` (328), `saint p` (378)…
- surcoût de compression **+9,9 %** vs monolithe
- médiane **1 421 o**, **59 fichiers sous 1 Ko**, dont 53 sous 500 o
- et `remy` réclame toujours **12 requêtes HTTP / 192 498 o (36,8 % de l'index)**

On échange un plafond respecté contre 132 objets à déployer, versionner, invalider et router, pour un résultat qui ne résout toujours pas l'objection 3.

**(4) Correctif.** Découpe **par plages de rang équilibrées**, pas par préfixe (D2 a mesuré K=6 → max 26,6 Ko, +7,2 % de surcoût ; je confirme l'ordre de grandeur, mon coût de découpe alphabétique étant de +5,1 %). Et **déplacer le seuil de « 40 Ko par shard » à « N Ko transférés par requête utilisateur »** : c'est la grandeur que l'utilisateur subit, la seule qui ait un sens produit.

---

# OBJECTION 5 — SÉRIEUX

## La prémisse « 1 Mo brut » décrit un index qui ne remplit pas le cahier des charges

**(1) Affirmation attaquée.** « 1 Mo brut ramené à 300 à 400 Ko après Brotli. »

**(2) Mesure.** J'ai chiffré chaque variante de contenu :

| contenu de l'index | brut | gzip -9 | brotli q11 |
|---|---|---|---|
| JSON geo.api réduit | 3 080 014 | 713 073 | 549 100 |
| TSV nom+INSEE+CP+latlon+pop | 1 547 146 | 646 930 | 522 597 |
| TSV nom+INSEE+latlon | 1 189 352 | 511 081 | 402 041 |
| **TSV nom+latlon seulement** | **979 268** | 423 188 | **345 568** |
| noms seuls | 448 040 | 180 506 | 156 005 |

La prémisse « 1 Mo → 300-400 Ko » est arithmétiquement exacte pour **exactement une** variante : nom + latitude/longitude, sans rien d'autre. Or cet index est inutilisable :

- **Pas de département affichable.** Mesuré : 32 722 clés normalisées distinctes pour 35 014 entrées, **1 482 clés en collision impliquant 3 774 entrées (10,8 %)**. `Sainte-Colombe` existe **12 fois** — 05, 17, 25, 33, 35, 40, 46, 50, 69, 76, 77, 89. Sans code INSEE ni département, la liste de résultats affiche douze lignes identiques.
- **Pas de recherche par code postal**, alors que c'est un mode de saisie naturel.
- **Pas de tri par population**, donc aucun moyen de classer `Saint-Rémy-de-Provence` avant `Saint-Rémy-du-Val`.

L'index qui remplit le cahier des charges pèse **1 547 146 o brut** (+58 % vs la prémisse) et **522 597 o brotli** en TSV (+51 %). L'encodage G le ramène à 338 010 — mais au prix d'un format binaire maison, ce qui déclenche l'objection 2.

**(4) Correctif.** Réécrire la contrainte du prompt : « **index de lieux ≤ 400 Ko réellement transférés, tous champs nécessaires compris (nom, INSEE, département, code postal, coordonnées, population), mesuré sur le domaine de production, pas en local** ». La formulation actuelle valide un index qui ne marche pas.

---

# OBJECTION 6 — SÉRIEUX

## L'algorithme de compression dépend du plan Cloudflare, et la seule mesure disponible a été faite sur la zone de quelqu'un d'autre

**(1) Affirmation attaquée.** R5 §3 : « **Cloudflare négocie Brotli automatiquement. Rien à faire** » — conclusion tirée de sondages sur `astro-docs.pages.dev`. D2 budgète l'intégralité de l'index en brotli q11.

**(2) Pourquoi c'est fragile.** Verbatim :

> « **Free Plan: Content is compressed by default using Zstandard.** Pro and Business Plans: Content is compressed by default using Brotli. Enterprise Plan: Content is compressed by default using Gzip. »

L'algorithme par défaut est une fonction du **plan de la zone**, jamais vérifié pour geotagor. J'ai reproduit le sondage de R5 sur la même cible et obtenu un résultat qu'il n'avait pas testé :

| `Accept-Encoding` envoyé | `content-encoding` reçu |
|---|---|
| `zstd, br, gzip` | `br` |
| `br, gzip` | `br` |
| `gzip` | `gzip` |
| **`zstd`** | **aucune compression** |

R5 avait d'ailleurs lui-même relevé l'incohérence : `astro.build` lui renvoyait `gzip`, et `br` seul lui renvoyait *aucune compression*. Sa propre conclusion « rien à faire » contredit ses propres mesures.

Second axe : la **qualité** appliquée à la volée. D2 a mesuré +9,3 % entre q11 et q5 sur l'encodage G. Sur le TSV, je mesure pire :

| qualité brotli | TSV complet | écart vs q11 |
|---|---|---|
| q11 | 522 597 | — |
| q5 | 617 524 | **+18,2 %** |
| q4 | 659 794 | **+26,3 %** |

**(4) Correctif.** Aucun budget d'index ne doit être considéré comme tenu tant qu'il n'a pas été mesuré **sur le domaine de production**, avec les trois valeurs d'`Accept-Encoding`. Si l'écart est inacceptable, basculer sur l'objection 7.

---

# OBJECTION 7 — SÉRIEUX

## Le garde-fou de build mesure une grandeur qui n'est pas celle qui est transférée — et l'échappatoire existe, contrairement à ce que D2 a noté

**(1) Affirmations attaquées.** D3 §6 contrôle E : « somme `gz()` de `dist/_astro/*.js` avec liste d'exclusion ». D2 : tous les budgets en brotli local q11. D2 §NON VÉRIFIÉ : « **`DecompressionStream` supporte-t-il `'brotli'` ?** … à ma connaissance seuls `gzip`/`deflate`/`deflate-raw` sont normalisés ».

**(2) Deux problèmes.**

D'abord, **les contrôles de build mesurent une compression locale** que rien ne relie à ce qui sort du CDN. Entre les deux il y a le plan de zone, la liste des 47 content-types, `no-transform`, la qualité dynamique, et la concaténation `_headers`. Sur le seul index, l'écart entre la grandeur mesurée (338 010) et le pire cas plausible (664 351) est de **326 341 o** — plus que le budget JS total.

Ensuite, **le NON VÉRIFIÉ de D2 est faux aujourd'hui**, et c'est une bonne nouvelle qu'il faut exploiter. MDN documente pour `new DecompressionStream(format)` :

> « `"brotli"` Decompress the stream using the Brotli algorithm. `"gzip"` … `"deflate"` … `"deflate-raw"` … `"zstd"` Decompress the stream using the ZSTD algorithm. »
> — `developer.mozilla.org/en-US/docs/Web/API/DecompressionStream/DecompressionStream`

Avec la réserve, verbatim elle aussi : « **Some parts of this feature may have varying levels of support.** » — le « available across browsers since May 2023 » porte sur `gzip`/`deflate`, pas sur `brotli`/`zstd`.

**(4) Correctif, en deux volets.**

*Reprendre le contrôle de la compression.* Pré-compresser les shards au build en brotli q11, les servir en `.br` avec `Cache-Control: immutable`, décompresser dans le Web Worker avec `DecompressionStream('brotli')`, **repli gzip** détecté par `try { new DecompressionStream('brotli') } catch {}`. Coût du repli mesuré : gzip 646 930 contre brotli 522 597 sur le TSV, soit **+23,8 %** pour les navigateurs sans brotli — largement préférable au ×1,97 ou ×2,96 du pire cas CDN. Le budget devient **indépendant du CDN et vérifiable au build**, ce qui est la seule façon de le garantir.

*Ajouter le contrôle qui manque.* Un contrôle **post-déploiement** qui, pour chaque actif de `/data/*` et `/geo/*`, fait un `GET` réel avec `Accept-Encoding: br, gzip, zstd`, lit `content-encoding` et le nombre d'octets effectivement transférés, et **échoue** si un actif sort non compressé ou dépasse son budget. C'est le seul contrôle qui mesure la vérité.

---

# OBJECTION 8 — MINEUR

## Le sous-ensemble chaud « 300 communes, 4,1 Ko » tombe dans le budget JS et double le chemin initial

**(1) Affirmation attaquée.** D2 §1.6 point 4 : « **Les 300 premières sont inlinées dans le JS initial (4,1 Ko)** : la recherche répond dès la première frappe, avant tout réseau. »

**(2) Mesure.** Les 300 communes les plus peuplées, encodées en binaire type G :

| forme | brut | gzip -9 | brotli q11 |
|---|---|---|---|
| blob binaire autonome | 5 158 | — | **3 278** |
| **inliné en base64 dans du JS** | 6 942 | 4 416 | **4 203** |
| même donnée en TSV inline | 9 809 | 5 260 | 4 365 |

Le binaire compressé est incompressible : le passer en base64 coûte **+28 %**. Le chiffre de 4,1 Ko annoncé par D2 correspond en réalité au coût *inliné*, pas au coût autonome — la mesure est juste, mais elle est attribuée au mauvais budget.

Or D3 chiffre le **chemin initial** à **3 849 o gzip** (coquille + machine à états + zone de dépôt). Ajouter 4 203 o le fait **plus que doubler**, sur le chemin critique du LCP, pour une fonctionnalité dont l'utilité n'apparaît qu'après le premier dépôt de fichier.

Note de couverture, mesurée : ces 300 communes couvrent 33,2 % de la population — donc environ deux utilisateurs sur trois ne trouveront pas leur commune dans le sous-ensemble chaud et attendront le réseau de toute façon.

**(4) Correctif.** Sortir le sous-ensemble chaud du bundle initial : un fichier `hot.json` de 3 278 o, chargé en parallèle par le même `import()` que le module de recherche, déclenché au `focus` du champ. Bénéfice identique (il arrive avant les 190 Ko du tier 1), coût zéro sur le LCP, et il retombe dans le budget index au lieu du budget JS.

---

# CE QUI TIENT, APRÈS EXAMEN

Trois points que j'ai attaqués et qui résistent — c'est une information utile.

**L'encodage G de D2 est solidement mesuré.** Je l'ai reconstruit indépendamment (front coding sur les noms, delta-varint zigzag sur les coordonnées 1e-4, delta-varint base36 sur l'INSEE trié, population en octet logarithmique, CP en delta au département) et j'obtiens **664 351 o brut / 338 010 o brotli** contre **657 691 / 346 121** annoncés : écart de **+1,0 % en brut et −2,3 % en brotli**. Les chiffres de D2 sont fiables ; c'est leur *acheminement* qui est vulnérable, pas leur calcul.

**Le résultat contre-intuitif « les tableaux typés sont pires que le TSV après Brotli » est cohérent avec mes mesures.** Une colonne `Int32Array` de coordonnées quasi aléatoires ne se comprime qu'à −37 %, là où les mêmes valeurs en décimal dans un TSV descendent à −34 % de leur taille brute pourtant bien plus grosse. Le levier est bien le delta-varint (142 198 o brut au lieu de 280 112), pas le typage.

**Le surcoût de compression du sharding est modéré et ne justifie à lui seul aucun refus.** Ratio brotli mesuré en fonction de la taille du shard : 33,8 % à 35 014 entrées, 34,8 % à 1 000, 38,0 % à 200, 42,3 % à 50. La perte de contexte inter-shards coûte +5,1 % pour 26 shards alphabétiques, +9,9 % pour 132 shards récursifs. C'est réel mais secondaire : ce qui condamne le sharding par lettre, c'est le fan-out de l'objection 3 et le plafond de l'objection 4, pas le taux de compression.

**Et la décision la plus importante de D2 est la bonne** : abandonner le shard par lettre initiale, assumer le chargement complet de la colonne des noms, et découper par plages de rang équilibrées. Mes mesures la renforcent au lieu de l'ébranler. Le brief d'origine, lui, est faux sur trois points simultanés — la taille brute, l'uniformité des shards, et la compatibilité sharding/sous-chaîne — et doit être réécrit avant d'être transmis à l'implémentation.