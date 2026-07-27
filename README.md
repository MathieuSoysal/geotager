# Geotager

Voir, modifier et supprimer la position GPS d'une photo, **entièrement dans le navigateur**.

Aucun serveur, aucun compte, aucune publicité, aucun traceur. Le site est un ensemble de fichiers
statiques&nbsp;; le traitement des images a lieu dans un Web Worker, sur votre machine.

## État

**V1.1 — les quatre opérations sur tous les formats d'image.** Lire, corriger, ajouter et effacer
un lieu sur JPEG, HEIC, AVIF, PNG, WebP et TIFF. Ajouter n'agrandit rien sur place&nbsp;: sur une
photo d'iPhone, le nouveau bloc est ajouté en fin de fichier et une seule adresse est repointée,
si bien qu'aucun octet existant ne bouge. Corriger et effacer ne déplacent pas un octet du tout&nbsp;:
le fichier produit a exactement la taille de l'original.

Deux limites, dites *avant* l'action et non après&nbsp;: un WebP de forme simple n'a aucun
emplacement prévu pour un lieu, et **un négatif numérique — DNG, NEF, CR2 — n'accepte pas qu'on lui
en ajoute un**, parce qu'un négatif est un TIFF et qu'abîmer un original serait irréparable.

Les vidéos sont hors de portée pour l'instant, y compris en lecture&nbsp;: une vidéo range le lieu
à plusieurs endroits, parfois en toutes lettres, et aucun corpus public sous licence libre ne
fournit de vidéo réelle pour l'éprouver.

| Format | Lire | Corriger | Ajouter | Effacer |
|---|---|---|---|---|
| JPEG | oui | oui | oui | oui |
| HEIC, AVIF *(iPhone)* | oui | oui | oui | oui |
| PNG | oui | oui | oui | oui |
| WebP *(forme étendue)* | oui | oui | oui | oui |
| TIFF *(hors fichiers bruts)* | oui | oui | oui | oui |
| Vidéos (MOV, MP4) | pas encore | pas encore | pas encore | pas encore |

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
- **Preuve à l'octet près.** Le moteur annonce les plages qu'il écrit, et le fichier produit est
  comparé à l'original **partout ailleurs**. Une comparaison de tailles ne prouverait rien&nbsp;: un
  défaut qui efface 200&nbsp;Ko de données constructeur la passerait sans un mot. C'est aussi ce qui
  permet d'écrire dans une photo de plusieurs mégaoctets sans jamais la décoder&nbsp;: on ne prouve
  pas que l'image est restée lisible, on prouve que ses octets n'ont pas bougé.
- **Vérification après écriture, en trois temps.** Notre lecteur relit le fichier produit en
  repartant du premier octet. Un **second moteur, écrit par d'autres**, relit le bloc de position —
  c'est là que vit le défaut d'ordre des octets qu'une auto-relecture ne peut pas voir. Puis il
  relit le fichier entier, sous réserve qu'il ait su ouvrir l'original&nbsp;: il ne connaît pas tous
  les formats, et son silence sur un fichier qu'il n'ouvre pas ne prouverait rien. Un écart de plus
  d'un mètre, un résidu après effacement ou un désaccord annulent l'opération et rendent l'original
  intact. Voir [`QUESTIONS.md`](QUESTIONS.md), entrée Q-030.
- **Aucune copie oubliée.** Une image peut ranger le lieu une seconde fois dans un paquet de texte
  descriptif. Il est purgé — le lieu seul, pas le titre ni l'auteur —, puis **re-balayé**&nbsp;: s'il
  en subsiste la moindre trace, ou si le paquet est compressé et donc illisible pour ce moteur,
  l'effacement échoue plutôt que de rendre un fichier qu'on croirait propre.

## Développement

```bash
npm install
npm run dev        # serveur local
npm run build      # construit dist/ puis exécute les contrôles bloquants
```

### Tests

```bash
npm run fixtures   # récupère de vraies photos de test (non committées)
npm test           # moteur EXIF, avec ExifTool comme oracle indépendant — 316 assertions
npm run test:e2e   # parcours complet dans Chromium, fichiers relus par ExifTool — 52 assertions
npm run test:all   # la chaîne entière
```

Chaque case du tableau ci-dessus est adossée à un test qui l'exécute réellement sur une vraie photo
de ce format&nbsp;— y compris les cases à « pas encore », dont le test exige qu'aucun fichier
témoin n'existe. Ce n'est donc plus une discipline mais une propriété&nbsp;: une case ouverte sans
preuve fait échouer la chaîne. Le tableau de la page d'accueil est rendu depuis la même constante que celle que lit
le moteur, et le script de corpus fait échouer la chaîne si un fichier requis manque.

ExifTool est requis pour les tests (`apt install libimage-exiftool-perl`). Il n'est **jamais**
utilisé par l'application&nbsp;: il sert d'oracle externe, parce qu'un moteur qui se relit lui-même
ne prouve rien — un encodeur et un décodeur symétriquement faux s'accordent parfaitement.

Le corpus n'est pas committé et n'est pas fabriqué : ce sont de vraies photos d'appareils réels —
iPhone 11 Pro Max, iPhone 11 Pro, Nokia 8.3, Galaxy S10, Pixel 4a, HTC Desire, Nikon. Un fichier
généré pour l'occasion valide le code contre lui-même ; seule une photo réellement sortie d'un
appareil expose les cas qui cassent, et ce corpus-là en expose plusieurs : ordre des octets inversé,
bloc rangé en fin de fichier, coordonnées à zéro, préambule parasite. Aucun corpus public ne
fournissant de PNG ni de TIFF géolocalisé, le lieu de départ y est inscrit par ExifTool — une
implémentation indépendante de la nôtre — dans un vrai fichier d'appareil. Sources et licences dans
[`CREDITS.md`](CREDITS.md), justification dans [`QUESTIONS.md`](QUESTIONS.md), entrée Q-035.

### Intégration continue

`.github/workflows/ci.yml` installe ExifTool et rejoue `npm run test:all` sur chaque proposition de
modification. Sans cela, la matrice ci-dessus ne serait vérifiée par rien d'automatique : la build
Cloudflare ne lance que `npm run build`, et son image ne contient pas ExifTool.

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
