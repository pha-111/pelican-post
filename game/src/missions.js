// missions.js — the Pelican Post sorties: what to fly, in what order, and
// what it pays. Pure data plus the geometry helpers the game loop needs.

import { RUNWAY } from './world.js';

// A ring hangs in the air with a facing: you must cross its disc flying
// roughly along `normal` (from the previous mark toward the next), which
// stops pilots farming a ring by drifting through it sideways.
function ring(x, y, z, r = 27) {
  return { x, y, z, r };
}

function withNormals(points, spawn) {
  const all = [{ x: spawn.x, y: spawn.y, z: spawn.z }, ...points];
  return points.map((p, i) => {
    const prev = all[i];
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    const dz = p.z - prev.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    return { ...p, nx: dx / len, ny: dy / len, nz: dz / len };
  });
}

const SORTIE_1 = {
  title: 'Sortie 1 · First Post',
  brief: 'Thread all five golden rings around Gullwing Island. Follow the arrow, mind your speed in the turns.',
  spawn: { x: -1560, y: 195, z: 1520, headingDeg: 33, speed: 42, fuel: 100 },
  landToFinish: false,
  rings: [
    ring(-820, 150, 920),
    ring(-260, 175, 260),
    ring(240, 145, -160),
    ring(-520, 165, -470),
    ring(-1080, 135, 240),
  ],
};

const SORTIE_2 = {
  title: 'Sortie 2 · Harbor Delivery',
  brief: 'Two rings, then put her down on the harbor strip: along the runway, slow, and sinking gently.',
  spawn: { x: 940, y: 205, z: -380, headingDeg: 232, speed: 40, fuel: 100 },
  landToFinish: true,
  rings: [ring(330, 168, 40), ring(-60, 128, 300)],
};

const SORTIE_3 = {
  title: 'Sortie 3 · The Long Round',
  brief: 'Seven rings across all three islands on a short tank. Ease off the throttle on the long legs — then land at the harbor.',
  spawn: { x: -1560, y: 215, z: 1520, headingDeg: 30, speed: 42, fuel: 68 },
  landToFinish: true,
  rings: [
    ring(-620, 155, 720),
    ring(160, 185, -260),
    ring(980, 175, -690),
    ring(1290, 145, -1280),
    ring(-180, 155, -1080),
    ring(-1260, 125, -800),
    ring(-720, 115, 130),
  ],
};

export const MISSIONS = [SORTIE_1, SORTIE_2, SORTIE_3].map((m) => ({
  ...m,
  rings: withNormals(m.rings, m.spawn),
}));

// Scoring, in points. A ring pays by accuracy: clip its edge for the base
// rate, cross near the middle for more, and spear the centre for a
// PERFECT. Consecutive rings build a combo multiplier (up to x2). Landing
// quality is where the other big money is.
export const SCORE = {
  ringEdge: 200, // outer half of the disc
  ringClean: 320, // inner half
  ringPerfect: 450, // within 18% of the centre
  comboStep: 0.15, // +15% per consecutive ring, capped at x2
  smoothLanding: 600,
  firmLanding: 350,
  hardLanding: 120,
  timeBonusPerSecond: 4, // under par
  parTimes: [110, 120, 240], // seconds per sortie
};

// Where a landing finish happens, for the HUD's guidance arrow.
export const LANDING_TARGET = {
  x: RUNWAY.cx,
  y: RUNWAY.elevation,
  z: RUNWAY.cz,
};

// Signed distance of a point from a ring's disc plane, along its normal.
export function ringPlaneDistance(p, r) {
  return (p.x - r.x) * r.nx + (p.y - r.y) * r.ny + (p.z - r.z) * r.nz;
}

// Distance from the ring's centre within its plane (0 = dead centre).
export function ringRadialDistance(p, r) {
  const dx = p.x - r.x;
  const dy = p.y - r.y;
  const dz = p.z - r.z;
  const along = ringPlaneDistance(p, r);
  const sq = dx * dx + dy * dy + dz * dz - along * along;
  return Math.sqrt(Math.max(0, sq));
}
