// world.js — the Gullwing Archipelago: terrain, the harbor runway and scenery.
//
// Coordinates are metres. x points east, z points south, y points up.
// A compass heading of 0 flies north (towards -z), 90 flies east (+x).

import { makeRng, range, valueNoise } from './random.js';

export const WORLD_HALF = 2800; // playable square is 5.6 km across
export const SEA_LEVEL = 0;

// The three islands. peak is the summit height in metres, radius the
// distance at which the island sinks back under the sea.
const ISLANDS = [
  { name: 'Gullwing Island', cx: -350, cz: 500, radius: 1180, peak: 96 },
  { name: 'Kestrel Island', cx: 980, cz: -880, radius: 820, peak: 88 },
  { name: 'Turtle Rock', cx: -1280, cz: -820, radius: 540, peak: 46 },
];

// ---------------------------------------------------------------- runway
// The harbor strip sits on a plateau carved into Gullwing Island.
// headingDeg is the direction a landing aircraft flies along the strip.
export const RUNWAY = {
  cx: -350,
  cz: 470,
  headingDeg: 55,
  length: 720,
  width: 38,
  elevation: 30,
};

const RW_RAD = (RUNWAY.headingDeg * Math.PI) / 180;
export const RUNWAY_DIR = { x: Math.sin(RW_RAD), z: -Math.cos(RW_RAD) }; // along-strip
const RUNWAY_SIDE = { x: RUNWAY_DIR.z, z: -RUNWAY_DIR.x }; // across-strip

// Position in runway-local metres: along (from centre, + landing direction)
// and across (from centreline, + to the right of the landing direction).
export function runwayLocal(x, z) {
  const dx = x - RUNWAY.cx;
  const dz = z - RUNWAY.cz;
  return {
    along: dx * RUNWAY_DIR.x + dz * RUNWAY_DIR.z,
    across: dx * RUNWAY_SIDE.x + dz * RUNWAY_SIDE.z,
  };
}

export function runwayPoint(along, across) {
  return {
    x: RUNWAY.cx + RUNWAY_DIR.x * along + RUNWAY_SIDE.x * across,
    z: RUNWAY.cz + RUNWAY_DIR.z * along + RUNWAY_SIDE.z * across,
  };
}

// How strongly the terrain is flattened to the plateau at a point:
// 1 on the strip and its apron, 0 out in the wild.
function plateauWeight(x, z) {
  const { along, across } = runwayLocal(x, z);
  const fade = (v, inner, outer) => {
    const a = Math.abs(v);
    if (a <= inner) return 1;
    if (a >= outer) return 0;
    const t = (outer - a) / (outer - inner);
    return t * t * (3 - 2 * t);
  };
  return Math.min(fade(along, RUNWAY.length / 2 + 60, RUNWAY.length / 2 + 320), fade(across, 74, 300));
}

// ---------------------------------------------------------------- terrain
function islandHeight(x, z) {
  let h = -6; // sea floor
  for (const isle of ISLANDS) {
    const dx = x - isle.cx;
    const dz = z - isle.cz;
    const d = Math.sqrt(dx * dx + dz * dz) / isle.radius;
    if (d >= 1) continue;
    const bell = Math.pow(0.5 + 0.5 * Math.cos(Math.PI * d), 1.35);
    const rough =
      valueNoise(x * 0.004 + isle.cx * 0.01, z * 0.004 + isle.cz * 0.01) * 16 * bell +
      valueNoise(x * 0.021, z * 0.021) * 3.5 * bell;
    h = Math.max(h, isle.peak * bell + rough - 5);
  }
  return h;
}

// Ground height in metres at any point of the map.
export function terrainHeight(x, z) {
  const wild = islandHeight(x, z);
  const w = plateauWeight(x, z);
  if (w <= 0) return wild;
  return wild + (RUNWAY.elevation - wild) * w;
}

// Colour band for a terrain face, by height and steepness (ny = the y of
// the face normal, 1 = flat). Returns [r, g, b] before sun shading.
export function terrainColor(h, ny) {
  if (ny < 0.62) return [122, 108, 92]; // steep faces show rock
  if (h < -2) return [194, 178, 128]; // shallow sand under water
  if (h < 1.6) return [216, 194, 130]; // beach
  if (h < 24) return [96, 166, 78]; // meadow grass
  if (h < 52) return [62, 128, 62]; // forest green
  if (h < 80) return [128, 116, 100]; // high rock
  return [238, 242, 240]; // summit snow
}

// ---------------------------------------------------------------- scenery
// Everything decorative is placed once, from the seed: pine trees on the
// hills, the harbor village beside the strip, a lighthouse on the point,
// fishing boats at anchor and the cloud deck.
export function buildScenery(seed) {
  const rng = makeRng(seed * 7919 + 13);

  const trees = [];
  let guard = 0;
  while (trees.length < 170 && guard++ < 4000) {
    const x = range(rng, -WORLD_HALF, WORLD_HALF);
    const z = range(rng, -WORLD_HALF, WORLD_HALF);
    const h = terrainHeight(x, z);
    if (h < 3 || h > 58) continue;
    const loc = runwayLocal(x, z);
    if (Math.abs(loc.across) < 110 && Math.abs(loc.along) < RUNWAY.length / 2 + 160) continue;
    trees.push({ x, z, y: h, s: range(rng, 0.75, 1.5), lean: range(rng, -0.05, 0.05) });
  }

  const buildings = [];
  for (let i = 0; i < 11; i++) {
    const along = -330 + i * 34 + range(rng, -6, 6);
    const side = i % 2 === 0 ? 1 : -1;
    const across = side * range(rng, 88, 128);
    const p = runwayPoint(along, across);
    buildings.push({
      x: p.x,
      z: p.z,
      y: terrainHeight(p.x, p.z),
      w: range(rng, 13, 22),
      d: range(rng, 11, 18),
      h: range(rng, 6, 13),
      rot: range(rng, 0, Math.PI),
      tone: range(rng, 0.8, 1.1),
    });
  }

  const lighthouseBase = { x: -1035, z: -95 };
  const lighthouse = {
    ...lighthouseBase,
    y: Math.max(terrainHeight(lighthouseBase.x, lighthouseBase.z), 2),
    h: 34,
  };

  const boats = [];
  guard = 0;
  while (boats.length < 7 && guard++ < 900) {
    const x = range(rng, -WORLD_HALF, WORLD_HALF);
    const z = range(rng, -WORLD_HALF, WORLD_HALF);
    if (terrainHeight(x, z) > -2.5) continue;
    boats.push({ x, z, rot: range(rng, 0, Math.PI * 2), s: range(rng, 0.8, 1.3) });
  }

  const clouds = [];
  for (let i = 0; i < 44; i++) {
    clouds.push({
      x: range(rng, -WORLD_HALF - 600, WORLD_HALF + 600),
      z: range(rng, -WORLD_HALF - 600, WORLD_HALF + 600),
      y: range(rng, 295, 430),
      r: range(rng, 46, 120),
      puffs: Math.floor(range(rng, 3, 6)),
      drift: range(rng, 1.2, 3.2),
      storm: i % 6 === 3, // every sixth cloud is a dark, turbulent storm cell
    });
  }

  return { trees, buildings, lighthouse, boats, clouds };
}
