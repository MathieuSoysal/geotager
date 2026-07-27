# Annexe Gate 1 — dossier de preuves

Ces documents sont les **pièces de travail** qui ont produit [`PLAN-GATE1.md`](../../PLAN-GATE1.md).
Ils sont committés parce que le projet interdit toute donnée inventée : chaque chiffre du plan doit
pouvoir être retracé jusqu'à la source qui l'a produit.

## Ordre d'autorité

1. **`PLAN-GATE1.md` fait foi.** En cas de divergence, c'est lui qui gagne.
2. **`att_*.md` (contradiction) corrige `d*.md` (conception).** Les contradicteurs ont refait les
   calculs des concepteurs et en ont invalidé plusieurs. Le plan retient les corrections.
3. **`r*.md` (recherche) sont les faits bruts**, avec leurs URL sources.

## Les pièces

| Fichier | Rôle | À retenir |
|---|---|---|
| `r1.md` | Crate `little_exif` | Le GPS IFD **est** inscriptible (source lu). Poids WASM = risque n°1 |
| `r2.md` | Voie JS et paquets npm | Versions, licences et poids gzip mesurés. HEIC en écriture hors de portée en JS |
| `r3.md` | Données de communes | `geo.api.gouv.fr`, 35 014 entrées. Le shard par lettre est déséquilibré ×240 |
| `r4.md` | Fond de carte | Le niveau 0 est un écran vide — constat honnête et fondateur |
| `r5.md` | Chaîne de build | Astro 7.1.3, îlots sans framework, Cloudflare Pages |
| `r6.md` | SEO | ⚠️ **Ahrefs inaccessible : aucun volume mesuré.** Google Suggest à la place |
| `r7.md` | Nom, domaines, concurrence | 9 domaines libres au RDAP. 20 concurrents audités, aucun sans requête tierce |
| `d1.md` | Conception du noyau EXIF | Origine de P1. Contient l'erreur de chaînage IFD corrigée par `att_exif.md` |
| `d2.md` | Conception index et carte | Cinq encodages mesurés, deux résultats négatifs |
| `d3.md` | Conception interface | Géométrie anti-CLS, ordre de tabulation, contrastes |
| `d4.md` | Conception contenu et SEO | Pages, JSON-LD, contrôles de build |
| `att_budget.md` | Contradiction — budget et performance | Le décor non compositable ; budget JS recompté |
| `att_carte.md` | Contradiction — carte | Le clic-pour-placer est géométriquement impossible |
| `att_index.md` | Contradiction — index | `no-transform`, `octet-stream`, fan-out des sous-chaînes |
| `att_exif.md` | Contradiction — noyau | Chaînage IFD, vérification réflexive aveugle, vidéo |
| `att_produit.md` | Contradiction — produit | 24-41 semaines-homme, absence de canal non-SEO |

## Conventions de véracité

Chaque affirmation y est marquée :

- **MESURÉ** — le chiffre a été relevé (commande exécutée, réponse HTTP lue, fichier pesé)
- **DOCUMENTÉ** — la source officielle l'affirme, avec citation et URL
- **ESTIMÉ** — calculé, avec les opérations montrées
- **NON VÉRIFIÉ** — n'a pas pu être établi, avec la marche à suivre pour y arriver

Les cases NON VÉRIFIÉ sont volontairement conservées. Une case vide honnête vaut mieux qu'une valeur
plausible inventée.

## Ce qui n'a pas été fait

Le **spike bloquant du §13.0** (compilation WASM, écriture sur fichiers réels, sorties `exiftool`
collées) **n'a pas été exécuté** : il exige d'exécuter du code, ce que la phase de planification
interdit, et ni `wasm-pack` ni `exiftool` ne sont installés. Le plan spécifie donc les **deux
branches** et un arbre de décision binaire ; le spike est la première tâche d'exécution après
validation. Aucune case du tableau format × écriture × relecture n'a été remplie par déduction.
