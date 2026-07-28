/*
 * Géométrie de la forme décorative.
 *
 * Ce module est PUR : il ne touche pas au DOM. C'est ce qui lui permet d'être
 * appelé deux fois, aux deux bouts de la chaîne — par `Page.astro` au build,
 * pour graver la première image dans le HTML servi, et par `blob.ts` à chaque
 * image. Le dessin servi et la première image du client sont donc le même, au
 * chiffre près : rien ne saute au démarrage, et un visiteur qui a demandé
 * moins de mouvement voit la forme sans qu'aucun script ne s'exécute.
 */

export interface Harmonique {
  /** Amplitude, en fraction du rayon de base. */
  readonly a: number;
  /** Période, en millisecondes. */
  readonly T: number;
  /** Mode angulaire : nombre de lobes qui font le tour du contour. */
  readonly m: number;
  /** Phase à l'origine, en radians. */
  readonly phi: number;
}

export interface Couche {
  readonly id: string;
  readonly r0: number;
  /** Décalage statique de la couche. Jamais animé. */
  readonly transform: string;
  readonly harmoniques: readonly Harmonique[];
}

const TAU = Math.PI * 2;

/*
 * Huit points. Trois harmoniques de modes 2, 3 et 5 : aucune n'est un multiple
 * de 8/2, si bien qu'aucune ne dégénère en oscillation sur place. Le mode 5 se
 * replie sur −3 — il fait le tour dans l'autre sens, ce qui est exactement ce
 * qu'on veut d'un contour qui ne doit jamais paraître tourner d'un bloc.
 */
export const N = 8;

/*
 * Catmull-Rom donne une tangente de R.sin(alpha)/3 ; l'arc de cercle exact
 * demande R.(4/3).tan(alpha/4). Sans ce rapport, un anneau non déformé sort
 * aplati de 11 % : on croirait un octogone arrondi, pas un cercle.
 */
const S = (4 * Math.tan(Math.PI / (2 * N))) / Math.sin(TAU / N);

const TH = Array.from({ length: N }, (_, i) => (TAU * i) / N);
const COS = TH.map(Math.cos);
const SIN = TH.map(Math.sin);

/*
 * sin(u + m.theta) = sin(u).cos(m.theta) + cos(u).sin(m.theta). Les deux
 * facteurs en theta sont constants : tabulés une fois, ils ramènent le coût
 * par image de 2.N.K appels trigonométriques à 2.K — dix-huit en tout, contre
 * deux cent seize.
 */
const MODES = new Map<number, { readonly c: readonly number[]; readonly s: readonly number[] }>();

function table(m: number) {
  let t = MODES.get(m);
  if (!t) {
    t = { c: TH.map((th) => Math.cos(m * th)), s: TH.map((th) => Math.sin(m * th)) };
    MODES.set(m, t);
  }
  return t;
}

/* Tampons réutilisés : aucune allocation par image. */
const R = new Float64Array(N);
const X = new Float64Array(N);
const Y = new Float64Array(N);

/*
 * Une décimale. Une unité de viewBox vaut environ trois pixels à l'écran : le
 * dixième d'unité est déjà sous le tiers de pixel. Ce qui domine le coût par
 * image n'est pas le calcul mais la mise en chaîne des nombres, et c'est donc
 * là qu'il faut être avare.
 */
function f(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** Le tracé fermé d'une couche à l'instant `t`, en millisecondes. */
export function cheminBlob(c: Couche, t: number): string {
  R.fill(1);
  for (const h of c.harmoniques) {
    const u = (TAU * t) / h.T + h.phi;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    const { c: cm, s: sm } = table(h.m);
    for (let i = 0; i < N; i++) R[i] += h.a * (su * cm[i] + cu * sm[i]);
  }
  for (let i = 0; i < N; i++) {
    X[i] = c.r0 * R[i] * COS[i];
    Y[i] = c.r0 * R[i] * SIN[i];
  }

  let d = `M${f(X[0])} ${f(Y[0])}`;
  for (let i = 0; i < N; i++) {
    const a = (i + N - 1) % N;
    const b = (i + 1) % N;
    const e = (i + 2) % N;
    d +=
      `C${f(X[i] + (S * (X[b] - X[a])) / 6)} ${f(Y[i] + (S * (Y[b] - Y[a])) / 6)}` +
      ` ${f(X[b] - (S * (X[e] - X[i])) / 6)} ${f(Y[b] - (S * (Y[e] - Y[i])) / 6)}` +
      ` ${f(X[b])} ${f(Y[b])}`;
  }
  /* Le dernier segment est calculé avec les indices repliés : le raccord en
     P0 est C1, la fermeture ne se voit pas. */
  return `${d}Z`;
}

const H = (a: number, T: number, m: number, phi: number): Harmonique => ({ a, T, m, phi });

/*
 * Trois couches. Les périodes ne partagent aucun petit facteur commun : le
 * contour ne se répète qu'au bout de leur plus petit commun multiple, soit des
 * heures. Les décalages sont statiques et distincts, ce qui interdit aux trois
 * maxima de se superposer — c'est ce qui tient le contraste sous le texte.
 *
 * Somme des amplitudes : 0,175. Le rayon reste donc dans [0,825 r0 ; 1,175 r0],
 * soit 84,6 unités au plus fort pour la couche rose : la boîte de 100 n'est
 * jamais atteinte, et le dégradé garde de quoi s'éteindre.
 */
export const COUCHES: readonly Couche[] = [
  {
    id: 'rose',
    r0: 72,
    transform: 'translate(-6 -4)',
    harmoniques: [H(0.085, 28_700, 2, 0), H(0.055, 18_300, 3, 2.1), H(0.035, 46_900, 5, 4.2)],
  },
  {
    id: 'indigo',
    r0: 66,
    transform: 'translate(14 10) rotate(37)',
    harmoniques: [H(0.075, 33_100, 3, 1.4), H(0.06, 21_700, 2, 3.9), H(0.03, 52_300, 5, 0.7)],
  },
  {
    id: 'teal',
    r0: 58,
    transform: 'translate(-16 18) rotate(-24)',
    harmoniques: [H(0.09, 25_300, 2, 2.8), H(0.045, 39_700, 5, 5.1), H(0.03, 61_100, 3, 1.9)],
  },
];
