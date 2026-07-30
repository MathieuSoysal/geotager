# Geotager

*[English version](README.md)*

Voir, modifier et supprimer la position GPS d'une photo, **entièrement dans le navigateur**.

Aucun serveur, aucun compte, aucune publicité, aucun traceur. Le site est un ensemble de fichiers
statiques&nbsp;; le traitement des images a lieu dans un Web Worker, sur votre machine.

Une seule chose va chercher quelque chose au dehors&nbsp;: la carte de «&nbsp;Placer sur une
carte&nbsp;», qui demande ses images à `tile.openstreetmap.org`. Elle reste repliée tant qu'on ne
clique pas dessus&nbsp;: une visite qui ne l'ouvre jamais n'émet aucune requête sortante — et votre
photo n'entre dans aucune, dans un cas comme dans l'autre.

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
  intact. Voir.
- **Aucune copie oubliée.** Une image peut ranger le lieu une seconde fois dans un paquet de texte
  descriptif. Il est purgé — le lieu seul, pas le titre ni l'auteur —, puis **re-balayé**&nbsp;: s'il
  en subsiste la moindre trace, ou si le paquet est compressé et donc illisible pour ce moteur,
  l'effacement échoue plutôt que de rendre un fichier qu'on croirait propre.

## L'installer, et s'en servir hors ligne

Geotager s'installe, et fonctionne sans le moindre réseau — ce qui est bien le sujet&nbsp;: l'outil
tournait déjà entièrement sur votre appareil, et la seule raison pour laquelle il cessait de marcher
hors ligne, c'est que personne n'en gardait de copie.

**Un bouton «&nbsp;Installer l'application&nbsp;» apparaît dans la barre du haut, et seulement quand
il peut servir à quelque chose.** Il est `hidden` dans le HTML servi, et seule l'invitation du
navigateur le découvre — invitation qu'aucun navigateur n'émet quand l'application est déjà
installée. Il est donc absent pour qui l'a installée, absent dans la fenêtre installée, et absent là
où l'installation n'existe pas&nbsp;; le menu du navigateur y reste le chemin. Rien n'est mémorisé si
vous refermez la boîte&nbsp;: ce site ne persiste rien, et le navigateur décide déjà lui-même de la
fréquence à laquelle il repropose.

L'outil ne se contente d'ailleurs pas de déduire&nbsp;: le manifeste se désigne lui-même, dans les
deux langues, ce qui permet de DEMANDER au navigateur si l'application est déjà installée — le seul
cas où déduire de l'absence d'invitation pouvait se tromper.

Un service worker écrit à la main (`scripts/sw-modele.js`, ~120 lignes, sans Workbox) précharge les
deux pages, la feuille de style, l'interface et le worker de lecture. Trois règles le gouvernent&nbsp;:

- **Rien qui ne soit de l'origine.** La première ligne du gestionnaire `fetch` rend la main pour tout
  le reste. Une tuile de carte mise en cache écrirait sur le disque la trace durable des lieux
  consultés — exactement ce que ce site promet de ne pas faire.
- **Aucun `skipWaiting()` inconditionnel.** Rien n'est persisté ici&nbsp;: un rechargement imposé
  détruirait les photos chargées et non téléchargées. Une nouvelle version attend derrière un bandeau
  — et une fenêtre qui n'a rien demandé ne se recharge pas parce qu'une autre a dit oui.
- **Pas de page «&nbsp;hors ligne&nbsp;».** Les deux vraies pages sont préchargées&nbsp;; il ne reste
  aucune navigation qu'un secours pourrait rattraper.

La liste de préchargement est dérivée de ce que la build a réellement produit — jamais écrite à la
main — et `scripts/gen-sw.mjs` refuse de produire un worker dont la liste omettrait le worker de
lecture ou la feuille de style.

### Lui envoyer une photo depuis le système

Une fois installé, Geotager apparaît dans le menu de partage du système et comme application
d'«&nbsp;Ouvrir avec&nbsp;» pour les images.

«&nbsp;Ouvrir avec&nbsp;» est le cas simple&nbsp;: le système remet une poignée de fichier, il n'y a
donc rien à transporter et rien à garder.

Simple ne veut pas dire sans risque, et c'est là que cette phrase s'arrêtait. Une poignée peut
désigner un fichier déplacé depuis, ou un fichier qui n'est pas encore descendu d'un espace de
stockage distant — et le système ne remet le lot qu'une fois, il n'y a rien à revenir chercher.
Chaque poignée est donc ouverte pour elle-même, avec un délai&nbsp;: une photo partie n'emporte plus
celles qui sont restées, et une ouverture dont rien n'est utilisable le dit à l'écran et à voix haute
au lieu de laisser une fenêtre vide. Un lancement sans aucun fichier, lui, se tait&nbsp;: c'est à cela
que ressemble un clic sur l'icône de l'application.

Le manifeste dit aussi dans quelle fenêtre les fichiers sont posés&nbsp;: celle qui est déjà ouverte,
mise au premier plan telle quelle, les nouvelles photos **rejoignant** celles qui y étaient au lieu
de les remplacer. Rien n'est persisté ici&nbsp;: un lancement qui renaviguerait la fenêtre
abandonnerait du travail, ce qui est la raison pour laquelle les mises à jour attendent derrière un
bandeau. Le manifeste lui-même se demande au réseau d'abord&nbsp;: c'est le seul fichier que le
système lit pour son compte, et servi depuis le cache une correction ne l'atteindrait jamais.

Le partage, non. L'API de cible de partage livre les fichiers en `POST`, et aucun serveur n'est là
pour le recevoir — c'est le service worker qui l'intercepte. Toutes les autres applications qui font
ceci déposent le fichier dans le stockage de cache, redirigent, puis le relisent et l'effacent. Cela
marche à tous les coups, et cela écrit aussi la photo de quelqu'un sur son disque, ce que ce site
affirme partout ne pas faire. Les octets restent donc dans une variable du worker, et la page vient
les réclamer par un canal de message. Le prix est honnête&nbsp;: si le navigateur arrête le worker
avant — mémoire basse, arbitrage du système — la photo n'arrive pas et la page le dit. On perd un
geste, jamais un fichier&nbsp;; l'original n'a pas bougé de la galerie.

Le partage vaut pour Android et Chrome/Edge sur ordinateur&nbsp;; iOS ne l'implémente pas.
L'ouverture de fichiers vaut pour Chrome/Edge sur ordinateur.

## Développement

```bash
npm install
npm run dev        # serveur local
npm run build      # construit dist/, génère sw.js, puis exécute les contrôles bloquants
npm run icons      # régénère public/icons/ et og.png (committés ; nécessite Playwright)
```

`npm run verifier:en-ligne` va chercher le site en ligne et échoue si l'hébergeur y a injecté quoi
que ce soit — un beacon de mesure d'audience, un point de terminaison `/cdn-cgi/`, Rocket Loader,
Zaraz, un cookie — ou si un en-tête servi diffère de `public/_headers`. Tous les autres contrôles du
dépôt regardent `dist/` et ne peuvent donc pas voir ce qui est ajouté en chemin. Il est
délibérément hors de `npm run build` (la build de Cloudflare n'a rien à interroger) et hors de
`npm run test:all` (l'intégration continue ne doit atteindre aucun réseau).

### Tests

```bash
npm run fixtures   # récupère de vraies photos de test (non committées)
npm test           # moteur EXIF, avec ExifTool comme oracle indépendant — 316 assertions
npm run test:e2e   # parcours complet dans Chromium, fichiers relus par ExifTool — 104 assertions
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
[`CREDITS.md`](CREDITS.md).

### Intégration continue

`.github/workflows/ci.yml` installe ExifTool et rejoue `npm run test:all` sur chaque proposition de
modification. Sans cela, la matrice ci-dessus ne serait vérifiée par rien d'automatique : la build
Cloudflare ne lance que `npm run build`, et son image ne contient pas ExifTool.

### Contrôles de build

`scripts/check-build.mjs` échoue **en code non nul** — Cloudflare ne lit que cela — si&nbsp;:

- une ressource tierce est chargée depuis un hôte absent de la liste blanche des ressources — qui
  compte exactement une entrée, les tuiles de la carte, consignée dans `CREDITS.md` ;
- un fichier JavaScript servi contient une URL absolue dont l'hôte n'est sur aucune liste (les
  motifs ci-dessus ne voient que des formes HTML et CSS&nbsp;; une URL construite par concaténation
  leur échappait) ;
- un `<title>` dépasse 60 caractères ou une meta description 155 ;
- une page n'a pas exactement un `<h1>` ;
- un des blocs de contenu obligatoires manque du HTML servi ;
- le JavaScript dépasse 150 Ko gzip ;
- un `X-Robots-Tag` apparaît sous un motif relatif dans `_headers` ;
- l'action `file_handlers` du manifeste ne désigne pas une page servie sans redirection, ou le
  champ jamais normalisé `launch_type` réapparaît à côté de `launch_handler` ;
- `robots.txt` interdit le parcours, ou annonce un plan du site que la build ne produit pas — ce
  qui est arrivé une fois, sans que rien ne s'en aperçoive ;
- le plan du site n'annonce pas exactement les pages indexables, porte un `changefreq` ou un
  `priority` que les moteurs ignorent de toute façon, ou déclare des langues qui contredisent les
  `hreflang` de la page ;
- le canonique d'une page ne pointe pas sur elle-même, ou `og:url` le contredit ;
- le JSON-LD d'une page n'est pas du JSON valide, ou cesse de décrire l'application, le site et son
  éditeur ;
- une page indexable porte `noindex`, ou la page 404 le perd.

## Déploiement

Cloudflare Workers avec assets statiques, en intégration Git. `wrangler.jsonc` ne déclare aucun
champ `main` : il n'y a pas de code Worker, seulement des fichiers servis. `workers_dev` est à
`false` pour qu'aucun domaine technique indexable ne double le site.

## Licence

MIT. Sur un outil qui affirme ne rien envoyer, un code lisible est le seul argument que vous pouvez
vérifier vous-même.
