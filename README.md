# Geotagor

Voir, modifier et supprimer la position GPS d'une photo, **entièrement dans le navigateur**.

Aucun serveur, aucun compte, aucune publicité, aucun traceur. Le site est un ensemble de fichiers
statiques&nbsp;; le traitement des images a lieu dans un Web Worker, sur votre machine.

## État

**V1 — JPEG, HEIC et AVIF.** Lecture de la position et des métadonnées sur JPEG, HEIC, AVIF, PNG,
WebP, TIFF et vidéos. Correction et effacement sur **JPEG, HEIC et AVIF**. Sur une photo d'iPhone,
ces deux opérations ne déplacent pas un octet&nbsp;: le fichier produit a exactement la taille de
l'original, et seuls les octets de la position changent. Ajouter un lieu à une photo qui n'en porte
aucune ferait grandir le fichier&nbsp;; cela reste hors de portée sur HEIC et AVIF, et l'interface
le dit *avant* toute action plutôt que de traiter le cas approximativement.

| Format | Lire | Corriger | Ajouter | Effacer |
|---|---|---|---|---|
| JPEG | oui | oui | oui | oui |
| HEIC, AVIF | oui | oui | pas encore | oui |
| PNG | oui | pas encore | pas encore | pas encore |
| WebP | oui | pas encore | pas encore | pas encore |
| TIFF | oui | pas encore | pas encore | pas encore |
| Vidéos (MOV, MP4) | oui | pas encore | pas encore | pas encore |

*« Corriger » remplace un lieu déjà présent, « ajouter » en crée un là où il n'y en a pas. Ce sont
deux opérations différentes&nbsp;: la première ne change pas la taille du fichier, la seconde si.
Le tableau de la page d'accueil est rendu depuis `src/lib/exif/capacites.ts`, que le moteur lit
aussi&nbsp;; il ne peut donc pas dériver de ce que le code sait faire.*

Le plan complet, les décisions et les points non tranchés sont dans
[`PLAN-GATE1.md`](PLAN-GATE1.md) et [`QUESTIONS.md`](QUESTIONS.md).

## Ce que le moteur garantit

- **Aucun réencodage.** Les pixels ne sont jamais touchés. Seuls les octets de la position changent.
- **Édition sur place quand c'est possible.** Corriger ou effacer une position produit un fichier de
  **taille strictement identique** : rien n'est déplacé, donc MakerNote, vignette, profil
  colorimétrique et segments constructeur sont préservés *par construction*.
- **Création sans réécriture.** Ajouter une position à un fichier qui n'en a pas n'insère rien au
  milieu du bloc TIFF : un nouvel IFD0 est ajouté à la fin et l'en-tête est repointé dessus. Les
  offsets absolus existants restent valides — c'est précisément ce qu'une réécriture classique casse.
- **Vérification après écriture.** Chaque fichier produit est relu par **deux moteurs indépendants**
  et la position comparée à celle demandée. Un écart de plus d'un mètre, un résidu après effacement,
  ou un désaccord entre les deux lecteurs font échouer l'opération et rendent l'original intact.

## Développement

```bash
npm install
npm run dev        # serveur local
npm run build      # construit dist/ puis exécute les contrôles bloquants
```

### Tests

```bash
npm run fixtures   # récupère de vraies photos de test (non committées)
npm test           # moteur EXIF, avec ExifTool comme oracle indépendant
npm run test:e2e   # parcours complet dans Chromium, fichier relu par ExifTool
npm run test:all   # la chaîne entière
```

ExifTool est requis pour les tests (`apt install libimage-exiftool-perl`). Il n'est **jamais**
utilisé par l'application&nbsp;: il sert d'oracle externe, parce qu'un moteur qui se relit lui-même
ne prouve rien — un encodeur et un décodeur symétriquement faux s'accordent parfaitement.

Le corpus n'est pas committé et n'est pas fabriqué : ce sont de vraies photos issues du dépôt public
`ianare/exif-samples`. Un fichier généré pour l'occasion valide le code contre lui-même ; seule une
photo réellement sortie d'un appareil expose les cas qui cassent.

### Contrôles de build

`scripts/check-build.mjs` échoue **en code non nul** — Cloudflare ne lit que cela — si&nbsp;:

- une ressource tierce est chargée par une page (le critère qui ne souffre aucune exception) ;
- un `<title>` dépasse 60 caractères ou une meta description 155 ;
- une page n'a pas exactement un `<h1>` ;
- un des blocs de contenu obligatoires manque du HTML servi ;
- le JavaScript dépasse 150 Ko gzip ;
- un `X-Robots-Tag` apparaît sous un motif relatif dans `_headers`.

## Déploiement

Cloudflare Workers avec assets statiques, en intégration Git. `wrangler.jsonc` ne déclare aucun
champ `main` : il n'y a pas de code Worker, seulement des fichiers servis. `workers_dev` est à
`false` pour qu'aucun domaine technique indexable ne double le site.

## Licence

MIT. Sur un outil qui affirme ne rien envoyer, un code lisible est le seul argument que vous pouvez
vérifier vous-même.
