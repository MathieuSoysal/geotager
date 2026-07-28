/*
 * Geometry of the decorative shape.
 *
 * This module is pure: it does not touch the DOM. That is what lets it be
 * called twice, at both ends of the chain, by `Page.astro` at build time to
 * bake the first frame into the served HTML, and by `blob.ts` on every frame.
 * The served drawing and the client's first frame are therefore the same to the
 * digit: nothing jumps at startup, and a visitor who asked for less motion sees
 * the shape without any script running.
 */

export interface Harmonique {
  /** Amplitude, as a fraction of the base radius. */
  readonly a: number;
  /** Period, in milliseconds. */
  readonly T: number;
  /** Angular mode: how many lobes go round the outline. */
  readonly m: number;
  /** Phase at the origin, in radians. */
  readonly phi: number;
}

export interface Couche {
  readonly id: string;
  readonly r0: number;
  /** Static offset of the layer. Never animated. */
  readonly transform: string;
  readonly harmoniques: readonly Harmonique[];
}

const TAU = Math.PI * 2;

/*
 * Eight points. Three harmonics of modes 2, 3 and 5: none is a multiple of 8/2,
 * so none degenerates into oscillation in place. Mode 5 folds back onto -3, so
 * it travels the other way round, which is exactly what you want of an outline
 * that must never appear to rotate as a block.
 */
export const N = 8;

/*
 * Catmull-Rom gives a tangent of R.sin(alpha)/3; the exact circular arc needs
 * R.(4/3).tan(alpha/4). Without that ratio an undeformed ring comes out 11%
 * flattened: it would look like a rounded octagon, not a circle.
 */
const S = (4 * Math.tan(Math.PI / (2 * N))) / Math.sin(TAU / N);

const TH = Array.from({ length: N }, (_, i) => (TAU * i) / N);
const COS = TH.map(Math.cos);
const SIN = TH.map(Math.sin);

/*
 * sin(u + m.theta) = sin(u).cos(m.theta) + cos(u).sin(m.theta). Both theta
 * factors are constant: tabulated once, they bring the per-frame cost from
 * 2.N.K trigonometric calls down to 2.K, eighteen in all against two hundred
 * and sixteen.
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

/* Reused buffers: no allocation per frame. */
const R = new Float64Array(N);
const X = new Float64Array(N);
const Y = new Float64Array(N);

/*
 * One decimal. A viewBox unit is about three screen pixels, so a tenth of a
 * unit is already under a third of a pixel. What dominates the per-frame cost
 * is not the arithmetic but turning the numbers into a string, so that is where
 * to be frugal.
 */
function f(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** The closed path of a layer at time `t`, in milliseconds. */
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
  /* The last segment is computed with wrapped indices: the join at P0 is C1,
     so the closure does not show. */
  return `${d}Z`;
}

const H = (a: number, T: number, m: number, phi: number): Harmonique => ({ a, T, m, phi });

/*
 * Four layers. The periods share no small common factor, so the outline only
 * repeats after their least common multiple, which is hours. The offsets are
 * static and distinct, which stops the four maxima from lining up, and that is
 * what holds the contrast under the text.
 *
 * Amber is the fourth: a warm colour was missing for the whole to breathe, and
 * the token already existed without being used by the decor.
 *
 * The offsets are wide, deliberately. Bunched on one centre, in `screen` mode,
 * four colours accumulate towards white and everything turns to grey haze;
 * spread out, each keeps its hue in its own quarter and mixes with the others
 * only at the edges. That is the difference between a halo and shapes you can
 * make out.
 *
 * Sum of amplitudes: about 0.21 per layer, against 0.175 before. The outline
 * therefore deforms more plainly, and the periods were shortened in the same
 * spirit: the movement should be noticed, not guessed at. At its strongest the
 * pink layer reaches 70 × 1.205 = 84.4 units, and its control points overshoot
 * by about four: the box of 100 is never reached, and the gradient keeps room
 * to fade out.
 */
export const COUCHES: readonly Couche[] = [
  {
    id: 'rose',
    r0: 62,
    transform: 'translate(-24 -20)',
    harmoniques: [H(0.1, 22_300, 2, 0), H(0.065, 15_700, 3, 2.1), H(0.04, 37_900, 5, 4.2)],
  },
  {
    id: 'indigo',
    r0: 60,
    transform: 'translate(28 -15) rotate(37)',
    harmoniques: [H(0.095, 26_900, 3, 1.4), H(0.07, 18_700, 2, 3.9), H(0.038, 43_300, 5, 0.7)],
  },
  {
    id: 'teal',
    r0: 56,
    transform: 'translate(-27 25) rotate(-24)',
    harmoniques: [H(0.105, 20_300, 2, 2.8), H(0.06, 31_700, 5, 5.1), H(0.04, 49_900, 3, 1.9)],
  },
  {
    id: 'ambre',
    r0: 52,
    transform: 'translate(26 27) rotate(58)',
    harmoniques: [H(0.11, 24_700, 3, 3.3), H(0.07, 17_300, 2, 0.9), H(0.035, 41_900, 5, 2.6)],
  },
];
