/**
 * Banc de la ligne de commande, en la LANÇANT.
 *
 * Rien n'est importé du paquet : chaque cas démarre un vrai processus, avec de
 * vrais arguments, et regarde ce qui sort et sous quel code. C'est la seule
 * façon d'éprouver ce qui fait la valeur d'une commande — le code de sortie, la
 * séparation des deux flux, le développement des motifs — puisque aucune de ces
 * trois choses n'existe à l'intérieur d'une fonction.
 *
 * Deux propriétés sont éprouvées ici plus qu'ailleurs, parce qu'elles sont
 * celles qu'un agent va exercer sans surveillance :
 *
 *   - L'ORIGINAL N'EST PAS ÉCRASÉ sans `--in-place`. Y compris quand `--out .`
 *     désigne le dossier source, ce qu'aucune construction de nom ne rattrape.
 *   - LA SORTIE STANDARD NE PORTE QUE DU JSON. Un programme qui la lit ne doit
 *     jamais avoir à filtrer une phrase de résumé.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURES = process.env.FIXTURES ?? 'test/fixtures';
const CLI = 'packages/cli/dist/cli.js';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

interface Sortie {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Lance la commande et rend les deux flux SÉPARÉS.
 *
 * `spawnSync` plutôt qu'`execFileSync`, et la raison vaut d'être écrite : la
 * seconde ne rend QUE la sortie standard quand le code est nul, et ne donne la
 * sortie d'erreur que par l'exception qu'elle lève en cas d'échec. Le cas le
 * plus intéressant de ce banc — « la commande a réussi, et le résumé humain
 * est-il bien allé sur le bon flux ? » — était donc invérifiable, et le test
 * échouait en accusant la commande d'une faute du banc.
 */
function lancer(args: string[]): Sortie {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Le JSON de la sortie standard, ou null si ce n'en était pas. */
function json(s: Sortie): any {
  try {
    return JSON.parse(s.stdout);
  } catch {
    return null;
  }
}

function bac(): string {
  return mkdtempSync(join(tmpdir(), 'geotager-cli-'));
}

const PARIS = ['--lat', '48.8584', '--lng', '2.2945'];

function principal(): void {
  /* --- aide et version --------------------------------------------- */

  console.log('\n--help — l’aide est faite pour être analysée');
  {
    const h = lancer(['--help']);
    check('--help rend 0', h.code === 0, String(h.code));
    check('et sort sur la sortie STANDARD', h.stdout.length > 0 && h.stderr.length === 0);
    for (const section of ['USAGE', 'COMMANDS', 'EXIT CODES', 'EXAMPLES']) {
      check(`la section ${section} est là, en majuscules`, h.stdout.includes(`\n${section}\n`));
    }
    check('les trois commandes sont nommées',
      ['read', 'set', 'strip'].every((c) => h.stdout.includes(`geotager ${c}`)));
    check('les quatre codes de sortie sont écrits',
      ['\n  0 ', '\n  1 ', '\n  2 ', '\n  3 '].every((c) => h.stdout.includes(c)));

    // Sans commande, l'aide est un DÉFAUT d'usage : elle ne doit pas polluer
    // une sortie standard qu'un programme s'apprête à lire comme du JSON.
    const nu = lancer([]);
    check('sans commande, l’aide part sur la sortie d’erreur', nu.stdout === '' && nu.stderr.length > 0);
    check('et le code dit « usage »', nu.code === 2, String(nu.code));

    for (const c of ['read', 'set', 'strip']) {
      const a = lancer([c, '--help']);
      check(`${c} --help rend 0 et documente sa syntaxe`,
        a.code === 0 && a.stdout.includes('USAGE') && a.stdout.includes('EXIT CODES'));
    }

    check('--version rend le seul numéro', /^\d+\.\d+\.\d+\n$/.test(lancer(['--version']).stdout));
  }

  /* --- read --------------------------------------------------------- */

  console.log('\nread — du JSON, et rien que du JSON, sur la sortie standard');
  {
    const r = lancer(['read', join(FIXTURES, 'DSCN0010.jpg')]);
    check('read rend 0 sur un fichier lisible', r.code === 0, r.stderr);
    const j = json(r);
    check('la sortie standard est du JSON valide', j !== null);
    check('c’est un tableau d’un élément', Array.isArray(j) && j.length === 1);
    check('avec le chemin donné', j?.[0]?.file === join(FIXTURES, 'DSCN0010.jpg'));
    check('le format', j?.[0]?.format === 'jpeg');
    check('un lieu sous lat/lng', typeof j?.[0]?.gps?.lat === 'number' && typeof j[0].gps.lng === 'number');
    check('les capacités', typeof j?.[0]?.can?.removeLocation === 'boolean');
    check('un motif stable', typeof j?.[0]?.reason === 'string');
    check('le résumé humain est allé sur la sortie d’erreur', r.stderr.trim().length > 0);

    const q = lancer(['read', join(FIXTURES, 'DSCN0010.jpg'), '--quiet']);
    check('--quiet fait taire le résumé', q.stderr.trim() === '');
    check('mais jamais le JSON', json(q) !== null);

    const sans = lancer(['read', join(FIXTURES, 'Canon_40D.jpg')]);
    check('un fichier sans lieu rend gps: null, pas une devinette', json(sans)?.[0]?.gps === null);

    // Plusieurs fichiers, dans l'ordre donné : un appelant apparie par index.
    const multi = lancer(['read', join(FIXTURES, 'DSCN0010.jpg'), join(FIXTURES, 'Canon_40D.jpg')]);
    const jm = json(multi);
    check('plusieurs fichiers rendent plusieurs objets', Array.isArray(jm) && jm.length === 2);
    check('dans l’ordre où ils ont été donnés',
      jm?.[0]?.file.endsWith('DSCN0010.jpg') && jm?.[1]?.file.endsWith('Canon_40D.jpg'));
  }

  /* --- motifs ------------------------------------------------------- */

  console.log('\nmotifs — développés par l’outil, sans l’aide du shell');
  {
    const b = bac();
    copyFileSync(join(FIXTURES, 'DSCN0010.jpg'), join(b, 'a.jpg'));
    copyFileSync(join(FIXTURES, 'DSCN0021.jpg'), join(b, 'b.jpg'));
    copyFileSync(join(FIXTURES, 'Canon_40D.jpg'), join(b, 'c.jpg'));
    mkdirSync(join(b, 'sous'));
    copyFileSync(join(FIXTURES, 'DSCN0010.jpg'), join(b, 'sous', 'd.jpg'));

    // Le motif arrive INTACT : c'est ce que voit un `spawn` sans shell, et
    // c'est ce que voit `cmd.exe`.
    const etoile = json(lancer(['read', join(b, '*.jpg'), '--quiet']));
    check('« *.jpg » développe le dossier', Array.isArray(etoile) && etoile.length === 3,
      String(etoile?.length));
    check('et ne descend pas tout seul',
      Array.isArray(etoile) && !etoile.some((x: any) => x.file.includes('sous')));

    const profond = json(lancer(['read', join(b, '**', '*.jpg'), '--quiet']));
    check('« **/*.jpg » descend', Array.isArray(profond) && profond.length === 4,
      String(profond?.length));

    const dossier = json(lancer(['read', b, '--quiet']));
    check('un dossier vaut ses fichiers, sans descendre',
      Array.isArray(dossier) && dossier.length === 3, String(dossier?.length));

    const accolades = json(lancer(['read', join(b, '{a,b}.jpg'), '--quiet']));
    check('« {a,b} » choisit', Array.isArray(accolades) && accolades.length === 2,
      String(accolades?.length));

    const rien = lancer(['read', join(b, '*.xyz'), '--quiet']);
    check('un motif qui ne trouve rien rend 3', rien.code === 3, String(rien.code));
    check('et le dit sur la sortie d’erreur', /no files matched/.test(rien.stderr));

    // Les doublons : `./a.jpg` et `a.jpg` sont le même fichier, et le traiter
    // deux fois serait au mieux du travail perdu.
    const double = json(lancer(['read', join(b, 'a.jpg'), join(b, 'a.jpg'), '--quiet']));
    check('un fichier donné deux fois n’est traité qu’une', Array.isArray(double) && double.length === 1);
  }

  /* --- set : la règle de non-écrasement ----------------------------- */

  console.log('\nset — l’original n’est pas écrasé sans qu’on le demande');
  {
    const b = bac();
    const src = join(b, 'photo.jpg');
    copyFileSync(join(FIXTURES, 'Canon_40D.jpg'), src);
    const avant = readFileSync(src);

    const r = lancer(['set', src, ...PARIS, '--quiet']);
    check('set rend 0', r.code === 0, r.stderr);
    check('l’original est intact, octet pour octet', readFileSync(src).equals(avant));
    check('un nouveau fichier suffixé est apparu', existsSync(join(b, 'photo-geotagged.jpg')));
    const j = json(r);
    check('le JSON nomme la sortie', j?.[0]?.output === join(b, 'photo-geotagged.jpg'));
    check('et rend la position RELUE',
      Math.abs(j?.[0]?.gps?.lat - 48.8584) < 0.0001 && Math.abs(j[0].gps.lng - 2.2945) < 0.0001);
    check('et affirme l’égalité des octets hors du lieu',
      j?.[0]?.bytesIdenticalOutsideLocation === true);

    /*
     * Le cas que seule une comparaison de chemins RÉSOLUS attrape. `--out .`
     * depuis le dossier source produit un chemin de sortie qui EST le chemin
     * d'entrée, alors qu'aucune option d'écrasement n'a été passée.
     */
    const b2 = bac();
    const src2 = join(b2, 'photo.jpg');
    copyFileSync(join(FIXTURES, 'Canon_40D.jpg'), src2);
    const avant2 = readFileSync(src2);
    const collision = lancer(['set', src2, ...PARIS, '--out', b2, '--quiet']);
    check('« --out » pointant sur la source est refusé', collision.code === 1, String(collision.code));
    check('l’original est resté intact', readFileSync(src2).equals(avant2));
    check('et le refus porte un code parlant',
      json(collision)?.[0]?.error?.code === 'ECRASERAIT_ORIGINAL',
      JSON.stringify(json(collision)?.[0]?.error));

    // `--in-place`, lui, écrase — c'est ce qu'on lui demande.
    const b3 = bac();
    const src3 = join(b3, 'photo.jpg');
    copyFileSync(join(FIXTURES, 'Canon_40D.jpg'), src3);
    const avant3 = readFileSync(src3);
    const surPlace = lancer(['set', src3, ...PARIS, '--in-place', '--quiet']);
    check('--in-place rend 0', surPlace.code === 0, surPlace.stderr);
    check('et écrase bien l’original', !readFileSync(src3).equals(avant3));
    check('sans laisser de fichier suffixé', !existsSync(join(b3, 'photo-geotagged.jpg')));

    // `--out` sur un dossier distinct garde le nom d'origine.
    const b4 = bac();
    const src4 = join(b4, 'photo.jpg');
    copyFileSync(join(FIXTURES, 'Canon_40D.jpg'), src4);
    const dest = join(b4, 'sortie');
    const versDossier = lancer(['set', src4, ...PARIS, '--out', dest, '--quiet']);
    check('--out crée le dossier et garde le nom', versDossier.code === 0 && existsSync(join(dest, 'photo.jpg')),
      versDossier.stderr);

    // `--dry-run` n'écrit rien, et le dit.
    const b5 = bac();
    const src5 = join(b5, 'photo.jpg');
    copyFileSync(join(FIXTURES, 'Canon_40D.jpg'), src5);
    const essai = lancer(['set', src5, ...PARIS, '--dry-run', '--quiet']);
    check('--dry-run rend 0', essai.code === 0, essai.stderr);
    check('et n’écrit rien du tout', !existsSync(join(b5, 'photo-geotagged.jpg')));
    check('mais annonce ce qu’il aurait écrit', json(essai)?.[0]?.wouldWrite === true);
  }

  /* --- set : les fautes d’usage ------------------------------------- */

  console.log('\nset — les fautes d’usage sont nommées, et rendent 2');
  {
    const b = bac();
    const src = join(b, 'photo.jpg');
    copyFileSync(join(FIXTURES, 'Canon_40D.jpg'), src);

    const sansLat = lancer(['set', src]);
    check('sans --lat ni --lng, code 2', sansLat.code === 2, String(sansLat.code));
    check('et le message dit quoi passer', /--lat and --lng/.test(sansLat.stderr));
    check('rien n’a été écrit', !existsSync(join(b, 'photo-geotagged.jpg')));

    const horsPlage = lancer(['set', src, '--lat', '91', '--lng', '0']);
    check('une latitude hors plage rend 2', horsPlage.code === 2, String(horsPlage.code));
    check('et NOMME l’option fautive', /--lat 91 is out of range/.test(horsPlage.stderr));

    const lonHorsPlage = lancer(['set', src, '--lat', '0', '--lng', '181']);
    check('une longitude hors plage rend 2', lonHorsPlage.code === 2, String(lonHorsPlage.code));

    check('une option inconnue rend 2', lancer(['set', src, '--nope']).code === 2);
    check('une commande inconnue rend 2', lancer(['frobnicate']).code === 2);
    check('--in-place et --out ensemble rendent 2',
      lancer(['set', src, ...PARIS, '--in-place', '--out', b]).code === 2);
    check('--no-suffix sans --out rend 2, plutôt que d’écraser',
      lancer(['set', src, ...PARIS, '--no-suffix']).code === 2);

    // Les coordonnées négatives ne doivent PAS passer pour des options courtes.
    const b2 = bac();
    const src2 = join(b2, 'photo.jpg');
    copyFileSync(join(FIXTURES, 'Canon_40D.jpg'), src2);
    const sud = lancer(['set', src2, '--lat', '-33.8688', '--lng', '151.2093', '--quiet']);
    check('une latitude négative est une valeur, pas une option', sud.code === 0, sud.stderr);
    check('et se relit négative', json(sud)?.[0]?.gps?.lat < 0, String(json(sud)?.[0]?.gps?.lat));

    // La forme accolée doit marcher aussi : c'est ce qu'écrit un générateur.
    const b3 = bac();
    const src3 = join(b3, 'photo.jpg');
    copyFileSync(join(FIXTURES, 'Canon_40D.jpg'), src3);
    const accole = lancer(['set', src3, '--lat=-33.8688', '--lng=151.2093', '--quiet']);
    check('« --lat=-33.8 » est accepté', accole.code === 0, accole.stderr);
  }

  /* --- strip -------------------------------------------------------- */

  console.log('\nstrip — retirer le lieu, sans toucher au reste');
  {
    const b = bac();
    const src = join(b, 'photo.jpg');
    copyFileSync(join(FIXTURES, 'DSCN0010.jpg'), src);
    const avant = readFileSync(src);

    const r = lancer(['strip', src, '--quiet']);
    check('strip rend 0', r.code === 0, r.stderr);
    check('l’original est intact', readFileSync(src).equals(avant));
    check('le fichier produit porte le bon suffixe', existsSync(join(b, 'photo-no-location.jpg')));
    check('et ne porte plus de lieu', json(r)?.[0]?.gps === null);

    // Le contrôle qui compte : ExifTool, et pas notre lecteur.
    const relu = execFileSync('exiftool',
      ['-n', '-s', '-s', '-s', '-GPSLatitude', join(b, 'photo-no-location.jpg')],
      { encoding: 'utf8' }).trim();
    check('ExifTool ne trouve plus de latitude', relu === '', relu);

    // Et ce qui doit SURVIVRE.
    const reste = execFileSync('exiftool', ['-s', '-s', '-s', '-Model', join(b, 'photo-no-location.jpg')],
      { encoding: 'utf8' }).trim();
    check('le modèle d’appareil a survécu', reste.length > 0, reste);

    const b2 = bac();
    const src2 = join(b2, 'photo.jpg');
    copyFileSync(join(FIXTURES, 'DSCN0010.jpg'), src2);
    const tout = lancer(['strip', src2, '--all-metadata', '--quiet']);
    check('--all-metadata rend 0 sur un JPEG', tout.code === 0, tout.stderr);
    check('et utilise son propre suffixe', existsSync(join(b2, 'photo-no-metadata.jpg')));
  }

  /* --- lot mixte ---------------------------------------------------- */

  console.log('\nun lot mixte — un échec n’emporte pas les réussites');
  {
    const b = bac();
    copyFileSync(join(FIXTURES, 'DSCN0010.jpg'), join(b, 'bonne.jpg'));
    // Des octets qui ne sont aucune image connue.
    writeFileSync(join(b, 'fausse.jpg'), Buffer.from('ceci n’est pas une image'));

    const r = lancer(['strip', join(b, '*.jpg'), '--quiet']);
    check('un lot partiellement en échec rend 1', r.code === 1, String(r.code));
    const j = json(r);
    check('le JSON couvre les deux fichiers', Array.isArray(j) && j.length === 2);
    const bonne = j?.find((x: any) => x.file.endsWith('bonne.jpg'));
    const fausse = j?.find((x: any) => x.file.endsWith('fausse.jpg'));
    check('la bonne a été traitée', bonne?.ok === true);
    check('la mauvaise est signalée', fausse?.ok === false && typeof fausse.error?.code === 'string',
      JSON.stringify(fausse?.error));
    check('et n’a produit aucun fichier', !existsSync(join(b, 'fausse-no-location.jpg')));

    /*
     * La langue du message, et pourquoi elle mérite un test.
     *
     * Le moteur rend ses phrases en français — ce sont celles du site, que
     * `src/lib/i18n/` traduit à partir du CODE. La ligne de commande les
     * rendait telles quelles, dans un JSON dont toutes les autres clés sont
     * anglaises. Rien ne cassait, rien ne levait : un programme — souvent un
     * modèle — recopiait « Opération non permise sur ce fichier. » à quelqu'un
     * qui ne le lit pas. C'est exactement la classe de défaut qu'aucun test du
     * moteur ne peut voir, puisque le moteur a raison.
     */
    check('le message du refus est en anglais',
      typeof fausse?.error?.message === 'string' && !/[éèêàçîôù]/i.test(fausse.error.message),
      String(fausse?.error?.message));
    check('et le code, lui, ne change pas de langue',
      /^[A-Z_]+$/.test(fausse?.error?.code ?? ''), String(fausse?.error?.code));
  }

  /* --- la sortie standard reste analysable ------------------------- */

  console.log('\nla sortie standard ne porte QUE du JSON, dans tous les cas');
  {
    const b = bac();
    writeFileSync(join(b, 'cassee.jpg'), Buffer.from('pas une image'));

    // Y compris quand tout échoue : un appelant qui lit stdout doit pouvoir
    // l'analyser sans jamais avoir à filtrer une phrase.
    const tout = lancer(['read', join(b, 'cassee.jpg')]);
    check('même un lot entièrement en échec rend du JSON analysable', json(tout) !== null,
      tout.stdout.slice(0, 60));
    check('et le résumé humain est allé ailleurs', tout.stderr.trim().length > 0);
  }

  console.log(`\n${passed} réussis, ${failed} échoués`);
  if (failed > 0) process.exitCode = 1;
}

principal();
