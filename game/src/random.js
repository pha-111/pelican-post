// random.js — a tiny seeded random number generator.
//
// The whole archipelago (trees, clouds, boats, ring jitter in free flight)
// is placed from one seed so every pilot flies the same islands, and so the
// screenshot scenes (?shot=...&seed=7) render identically on every load.

// mulberry32: small, fast, good enough for scenery placement.
export function makeRng(seed) {
  let state = (seed >>> 0) || 1;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Random float in [min, max).
export function range(rng, min, max) {
  return min + rng() * (max - min);
}

// Random integer in [min, max] inclusive.
export function rangeInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

// Pick one element of an array.
export function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

// A 2D value-noise helper built from a hash of integer lattice points.
// Used by world.js to rough up the islands so they are not smooth cones.
export function hash2(x, z) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function valueNoise(x, z) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; // 0..1
}
