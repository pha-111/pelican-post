// render.js — a small software 3D renderer on a 2D canvas.
//
// No WebGL, no libraries: the world is projected by hand and painted
// far-to-near. The terrain is a static mesh (heights, normals and sun
// shading are computed once), the sea is part of the same mesh so the
// painter's order stays honest, and the aeroplane is a polygon model built
// in planeModel() below. Everything is flat-shaded in one warm afternoon
// light, with distance fog the colour of the horizon.

import { RUNWAY, runwayLocal, runwayPoint, terrainColor, terrainHeight } from './world.js';
import { planeBasis } from './flight.js';

const SUN_DIR = norm3(-0.48, 0.62, -0.62); // toward the sun
const FOG_COLOR = [196, 222, 238];
const SEA_COLOR = [43, 103, 158];
const SEA_DEEP = [36, 90, 140];
const SKY_TOP = '#2c66a8';
const SKY_HORIZON = '#cfe7f4';

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function shadeOf(base, n) {
  const d = Math.max(0, dot(n, SUN_DIR));
  const f = 0.68 + 0.42 * d;
  return [Math.min(255, base[0] * f), Math.min(255, base[1] * f), Math.min(255, base[2] * f)];
}
function css(c, alpha = 1) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
}
function fogged(c, depth) {
  const t = Math.min(0.82, Math.max(0, (depth - 1300) / 5200) * 0.82);
  return [
    c[0] + (FOG_COLOR[0] - c[0]) * t,
    c[1] + (FOG_COLOR[1] - c[1]) * t,
    c[2] + (FOG_COLOR[2] - c[2]) * t,
  ];
}

// ------------------------------------------------------------ terrain mesh
// Built once: an inner heightfield over the archipelago, water quads in the
// cells the sea covers, and four long water strips out to the horizon.
function buildTerrainMesh() {
  const tris = [];
  const HALF = 2800;
  const STEP = 100;
  const N = Math.round((HALF * 2) / STEP);
  const heights = [];
  for (let j = 0; j <= N; j++) {
    heights.push([]);
    for (let i = 0; i <= N; i++) {
      heights[j].push(terrainHeight(-HALF + i * STEP, -HALF + j * STEP));
    }
  }
  const pushTri = (a, b, c, base) => {
    const n = norm3(...cross(sub(b, a), sub(c, a)));
    if (n[1] < 0) {
      const t = b;
      b = c;
      c = t;
      n[0] *= -1;
      n[1] *= -1;
      n[2] *= -1;
    }
    tris.push({ pts: [a, b, c], color: shadeOf(base, n) });
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x0 = -HALF + i * STEP;
      const z0 = -HALF + j * STEP;
      const h00 = heights[j][i];
      const h10 = heights[j][i + 1];
      const h01 = heights[j + 1][i];
      const h11 = heights[j + 1][i + 1];
      const p00 = [x0, h00, z0];
      const p10 = [x0 + STEP, h10, z0];
      const p01 = [x0, h01, z0 + STEP];
      const p11 = [x0 + STEP, h11, z0 + STEP];
      const avg = (h00 + h10 + h01 + h11) / 4;
      // face steepness from the diagonal normal, roughly
      const n = norm3(...cross(sub(p10, p00), sub(p01, p00)));
      const base = terrainColor(avg, Math.abs(n[1]));
      pushTri(p00, p10, p11, base);
      pushTri(p00, p11, p01, base);
      const maxH = Math.max(h00, h10, h01, h11);
      if (maxH < 1.4 || avg < 0.2) {
        // the sea surface over this cell (also over mostly-drowned cells,
        // so the shallows do not come up in a checkerboard of sand)
        const wobble = ((i * 31 + j * 17) % 5) * 1.1;
        const wc = [SEA_COLOR[0] + wobble, SEA_COLOR[1] + wobble, SEA_COLOR[2] + wobble];
        const q00 = [x0, 0, z0];
        const q10 = [x0 + STEP, 0, z0];
        const q01 = [x0, 0, z0 + STEP];
        const q11 = [x0 + STEP, 0, z0 + STEP];
        tris.push({ pts: [q00, q11, q10], color: wc, flat: true });
        tris.push({ pts: [q00, q01, q11], color: wc, flat: true });
      }
    }
  }
  // horizon water: four rectangles from the mesh edge out to 12 km,
  // each cut into a coarse grid so the painter can sort the pieces.
  const OUT = 12000;
  const waterRect = (x0, z0, x1, z1, nx, nz) => {
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const ax = x0 + ((x1 - x0) * i) / nx;
        const bx = x0 + ((x1 - x0) * (i + 1)) / nx;
        const az = z0 + ((z1 - z0) * j) / nz;
        const bz = z0 + ((z1 - z0) * (j + 1)) / nz;
        tris.push({ pts: [[ax, 0, az], [bx, 0, bz], [bx, 0, az]], color: SEA_DEEP, flat: true });
        tris.push({ pts: [[ax, 0, az], [ax, 0, bz], [bx, 0, bz]], color: SEA_DEEP, flat: true });
      }
    }
  };
  waterRect(-OUT, -OUT, -HALF, OUT, 1, 6); // west
  waterRect(HALF, -OUT, OUT, OUT, 1, 6); // east
  waterRect(-HALF, -OUT, HALF, -HALF, 3, 1); // north
  waterRect(-HALF, HALF, HALF, OUT, 3, 1); // south
  return tris;
}

// ------------------------------------------------------------ the aeroplane
// Local frame: x right, y up, z toward the tail (nose at -z).
function planeModel() {
  const parts = [];
  const quad = (a, b, c, d, color) => parts.push({ pts: [a, b, c, d], color });
  const tri = (a, b, c, color) => parts.push({ pts: [a, b, c], color });
  const CREAM = [247, 240, 222];
  const ORANGE = [232, 116, 44];
  const DARK = [52, 58, 66];
  const GLASS = [38, 74, 104];

  // fuselage: three tapered sections
  const sections = [
    { z: -4.3, w: 0.34, h: 0.4, cy: 0.05 },
    { z: -1.4, w: 0.62, h: 0.62, cy: 0.1 },
    { z: 1.6, w: 0.5, h: 0.52, cy: 0.16 },
    { z: 3.9, w: 0.2, h: 0.3, cy: 0.3 },
  ];
  const corner = (s, sx, sy) => [sx * s.w, s.cy + sy * s.h, s.z];
  for (let i = 0; i < sections.length - 1; i++) {
    const A = sections[i];
    const B = sections[i + 1];
    const bodyCol = i === 0 ? ORANGE : CREAM;
    quad(corner(A, -1, 1), corner(A, 1, 1), corner(B, 1, 1), corner(B, -1, 1), bodyCol); // top
    quad(corner(A, 1, -1), corner(A, -1, -1), corner(B, -1, -1), corner(B, 1, -1), DARK); // belly
    quad(corner(A, 1, 1), corner(A, 1, -1), corner(B, 1, -1), corner(B, 1, 1), ORANGE); // right
    quad(corner(A, -1, -1), corner(A, -1, 1), corner(B, -1, 1), corner(B, -1, -1), ORANGE); // left
  }
  const nose = sections[0];
  quad(corner(nose, -1, -1), corner(nose, 1, -1), corner(nose, 1, 1), corner(nose, -1, 1), DARK);

  // canopy glasshouse
  quad([-0.5, 0.72, -1.7], [0.5, 0.72, -1.7], [0.44, 0.66, -0.1], [-0.44, 0.66, -0.1], GLASS);
  quad([0.5, 0.72, -1.7], [0.5, 0.4, -1.7], [0.44, 0.34, -0.1], [0.44, 0.66, -0.1], GLASS);
  quad([-0.5, 0.4, -1.7], [-0.5, 0.72, -1.7], [-0.44, 0.66, -0.1], [-0.44, 0.34, -0.1], GLASS);

  // main wing and tail feathers
  quad([-5.3, 0.28, -0.95], [5.3, 0.28, -0.95], [5.3, 0.28, 0.55], [-5.3, 0.28, 0.55], ORANGE);
  quad([-5.3, 0.16, -0.95], [-5.3, 0.16, 0.55], [5.3, 0.16, 0.55], [5.3, 0.16, -0.95], CREAM);
  quad([-2.3, 0.5, 3.3], [2.3, 0.5, 3.3], [2.3, 0.5, 4.05], [-2.3, 0.5, 4.05], ORANGE);
  // vertical fin, drawn as two thin triangles (one per side)
  parts.push({ pts: [[-0.03, 1.55, 3.9], [-0.03, 0.42, 3.15], [-0.03, 0.42, 4.08]], color: ORANGE });
  parts.push({ pts: [[0.03, 1.55, 3.9], [0.03, 0.42, 4.08], [0.03, 0.42, 3.15]], color: ORANGE });

  // floats and struts (she is a seaplane; the harbor is her home)
  for (const sx of [-1, 1]) {
    const fx = sx * 1.0;
    quad([fx - 0.24, -0.98, -2.7], [fx + 0.24, -0.98, -2.7], [fx + 0.24, -0.98, 1.5], [fx - 0.24, -0.98, 1.5], ORANGE);
    quad([fx - 0.24, -1.3, -2.2], [fx + 0.24, -1.3, -2.2], [fx + 0.24, -1.3, 1.3], [fx - 0.24, -1.3, 1.3], CREAM);
    quad([fx - 0.07, -0.5, -1.6], [fx + 0.07, -0.5, -1.6], [fx + 0.07, -1.05, -1.4], [fx - 0.07, -1.05, -1.4], DARK);
    quad([fx - 0.07, -0.5, 0.7], [fx + 0.07, -0.5, 0.7], [fx + 0.07, -1.05, 0.9], [fx - 0.07, -1.05, 0.9], DARK);
    tri([fx - 0.24, -0.98, -2.7], [fx + 0.24, -0.98, -2.7], [fx, -1.14, -3.3], ORANGE);
  }
  return parts;
}

// ------------------------------------------------------------ scenery shapes
// Small polygon builders for the harbour dressing. Each returns triangles
// in world space with flat colours, ready to join the paint list.
function boxTris(cx, cy, cz, w, h, d, rot, top, side) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const corner = (lx, ly, lz) => [cx + lx * c - lz * s, cy + ly, cz + lx * s + lz * c];
  const x = w / 2;
  const z = d / 2;
  const A = corner(-x, 0, -z), B = corner(x, 0, -z), C = corner(x, 0, z), D = corner(-x, 0, z);
  const E = corner(-x, h, -z), F = corner(x, h, -z), G = corner(x, h, z), H = corner(-x, h, z);
  const out = [];
  const face = (p, q, r, col) => {
    const n = norm3(...cross(sub(q, p), sub(r, p)));
    out.push({ pts: [p, q, r], color: shadeOf(col, n) });
  };
  face(E, F, G, top); face(E, G, H, top);
  face(A, B, F, side); face(A, F, E, side);
  face(B, C, G, side); face(B, G, F, side);
  face(C, D, H, side); face(C, H, G, side);
  face(D, A, E, side); face(D, E, H, side);
  return out;
}

function coneTris(cx, cy, cz, r, h, col, seg = 6) {
  const out = [];
  const apex = [cx, cy + h, cz];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r];
    const p1 = [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r];
    const n = norm3(...cross(sub(p0, apex), sub(p1, apex)));
    out.push({ pts: [apex, p1, p0], color: shadeOf(col, n) });
  }
  return out;
}

function sceneryTris(scenery, camPos) {
  const out = [];
  const near = (x, z, dist) => {
    const dx = x - camPos[0];
    const dz = z - camPos[2];
    return dx * dx + dz * dz < dist * dist;
  };
  for (const t of scenery.trees) {
    if (!near(t.x, t.z, 2400)) continue;
    out.push(...boxTris(t.x, t.y - 0.3, t.z, 0.7 * t.s, 3.2 * t.s, 0.7 * t.s, 0, [96, 74, 50], [110, 84, 56]));
    out.push(...coneTris(t.x, t.y + 2.2 * t.s, t.z, 2.6 * t.s, 5.4 * t.s, [46, 106, 52]));
    out.push(...coneTris(t.x, t.y + 5.4 * t.s, t.z, 1.8 * t.s, 4.2 * t.s, [56, 120, 60]));
  }
  for (const b of scenery.buildings) {
    if (!near(b.x, b.z, 2600)) continue;
    const wall = [Math.min(255, 226 * b.tone), Math.min(255, 208 * b.tone), Math.min(255, 178 * b.tone)];
    out.push(...boxTris(b.x, b.y - 0.2, b.z, b.w, b.h, b.d, b.rot, [168, 84, 58], wall));
    out.push(...coneTris(b.x, b.y + b.h - 0.2, b.z, Math.max(b.w, b.d) * 0.62, 3.2, [150, 70, 50], 4));
  }
  const lh = scenery.lighthouse;
  if (near(lh.x, lh.z, 3400)) {
    for (let band = 0; band < 4; band++) {
      const col = band % 2 === 0 ? [214, 64, 52] : [240, 238, 230];
      const y0 = lh.y + (lh.h * band) / 4;
      const y1 = lh.y + (lh.h * (band + 1)) / 4;
      const r0 = 3.4 - band * 0.35;
      const r1 = 3.4 - (band + 1) * 0.35;
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI * 2;
        const a1 = ((i + 1) / 8) * Math.PI * 2;
        const p0 = [lh.x + Math.cos(a0) * r0, y0, lh.z + Math.sin(a0) * r0];
        const p1 = [lh.x + Math.cos(a1) * r0, y0, lh.z + Math.sin(a1) * r0];
        const p2 = [lh.x + Math.cos(a1) * r1, y1, lh.z + Math.sin(a1) * r1];
        const p3 = [lh.x + Math.cos(a0) * r1, y1, lh.z + Math.sin(a0) * r1];
        const n = norm3(...cross(sub(p1, p0), sub(p3, p0)));
        out.push({ pts: [p0, p1, p2], color: shadeOf(col, n) });
        out.push({ pts: [p0, p2, p3], color: shadeOf(col, n) });
      }
    }
    out.push(...coneTris(lh.x, lh.y + lh.h, lh.z, 2.6, 3.4, [52, 58, 66]));
  }
  for (const boat of scenery.boats) {
    if (!near(boat.x, boat.z, 2400)) continue;
    out.push(...boxTris(boat.x, -0.4, boat.z, 3.2 * boat.s, 1.6 * boat.s, 9 * boat.s, boat.rot, [196, 60, 48], [226, 222, 210]));
    out.push(...boxTris(boat.x, 0.9, boat.z, 2 * boat.s, 1.6 * boat.s, 3 * boat.s, boat.rot, [240, 238, 230], [240, 238, 230]));
  }
  return out;
}

// The harbor strip: apron, asphalt, markings — flat quads a breath above
// the plateau so they sit on top of the terrain in the paint order.
function runwayTris() {
  const out = [];
  // cls is the paint class inside the runway layer: apron first, then
  // asphalt, then lines, then markings — stacked layers must paint in
  // stack order, not by centroid depth (see the paint sort in draw()).
  const quadAt = (along0, across0, along1, across1, lift, color, cls) => {
    const p = (a, c) => {
      const w = runwayPoint(a, c);
      return [w.x, RUNWAY.elevation + lift, w.z];
    };
    out.push({ pts: [p(along0, across0), p(along1, across0), p(along1, across1)], color, flat: true, cls });
    out.push({ pts: [p(along0, across0), p(along1, across1), p(along0, across1)], color, flat: true, cls });
  };
  const L = RUNWAY.length / 2;
  const W = RUNWAY.width / 2;
  quadAt(-L - 46, -W - 26, L + 46, W + 26, 0.12, [104, 138, 74], 0); // apron grass
  quadAt(-L, -W, L, W, 0.3, [62, 64, 70], 1); // asphalt
  quadAt(-L, -W + 1.2, L, -W + 2.1, 0.42, [232, 232, 226], 2); // edge lines
  quadAt(-L, W - 2.1, L, W - 1.2, 0.42, [232, 232, 226], 2);
  for (const endSign of [-1, 1]) {
    for (let b = 0; b < 4; b++) {
      const across0 = -W + 3.4 + b * ((W * 2 - 6.8) / 4);
      quadAt(endSign * (L - 16), across0, endSign * (L - 2), across0 + (W * 2 - 6.8) / 4 - 2.2, 0.42, [238, 238, 232], 3);
    }
    // touchdown zone bars
    quadAt(endSign * (L - 74), -4.6, endSign * (L - 44), -1.4, 0.42, [238, 238, 232], 3);
    quadAt(endSign * (L - 74), 1.4, endSign * (L - 44), 4.6, 0.42, [238, 238, 232], 3);
  }
  for (let d = -L + 34; d < L - 30; d += 44) {
    quadAt(d, -0.8, d + 20, 0.8, 0.42, [240, 240, 234], 3); // centreline dashes
  }
  return out;
}

// PAPI lights: four lamps beside the near threshold. On glide slope you see
// two white and two red; too low, all red; too high, all white. Computed
// against the 3-degree path to the threshold, like the real thing.
export function papiLights(plane) {
  const thr = runwayPoint(-RUNWAY.length / 2 + 12, 0);
  const dx = plane.x - thr.x;
  const dz = plane.z - thr.z;
  const dist = Math.hypot(dx, dz);
  const glide = Math.atan2(plane.y - RUNWAY.elevation, Math.max(dist, 1));
  const onPath = (3 * Math.PI) / 180;
  const out = [];
  for (let i = 0; i < 4; i++) {
    const p = runwayPoint(-RUNWAY.length / 2 + 4, -RUNWAY.width / 2 - 7 - i * 3.4);
    const threshold = onPath + (1.5 - i) * 0.006;
    out.push({ x: p.x, y: RUNWAY.elevation + 1.2, z: p.z, white: glide > threshold });
  }
  return out;
}

// ------------------------------------------------------------ camera
// A chase camera that trails the Pelican and leans into her bank, smoothed
// so it never snaps or fights the pilot.
export function createCamera() {
  return { pos: null, fwd: [0, 0, -1], up: [0, 1, 0] };
}

export function updateCamera(cam, plane, dt) {
  const basis = planeBasis(plane);
  const back = 36;
  const high = 12.5;
  const want = [
    plane.x - basis.forward.x * back + basis.up.x * high,
    plane.y - basis.forward.y * back + basis.up.y * high,
    plane.z - basis.forward.z * back + basis.up.z * high,
  ];
  if (!cam.pos) {
    cam.pos = want;
  } else {
    const k = 1 - Math.exp(-3.4 * dt);
    cam.pos = [
      cam.pos[0] + (want[0] - cam.pos[0]) * k,
      cam.pos[1] + (want[1] - cam.pos[1]) * k,
      cam.pos[2] + (want[2] - cam.pos[2]) * k,
    ];
  }
  // Keep the camera out of the ground and the sea.
  const ground = terrainHeight(cam.pos[0], cam.pos[2]);
  if (cam.pos[1] < ground + 3.5) cam.pos[1] = ground + 3.5;
  const target = [
    plane.x + basis.forward.x * 80,
    plane.y + basis.forward.y * 80 + 1.5,
    plane.z + basis.forward.z * 80,
  ];
  cam.fwd = norm3(...sub(target, cam.pos));
  // Lean with the plane, but only part way: the horizon stays readable.
  const leanUp = [
    basis.up.x * 0.55 + 0 * 0.45,
    basis.up.y * 0.55 + 1 * 0.45,
    basis.up.z * 0.55 + 0 * 0.45,
  ];
  cam.up = norm3(...leanUp);
  return cam;
}

// Set the camera outright (used by the screenshot scenes).
export function placeCamera(cam, pos, lookAt, up = [0, 1, 0]) {
  cam.pos = [...pos];
  cam.fwd = norm3(...sub(lookAt, pos));
  cam.up = norm3(...up);
  return cam;
}

// Project a world point through a camera like the renderer's, for the
// HUD's target marker. Returns { x, y, behind, depth } in canvas pixels.
export function projectPoint(camera, W, H, p) {
  const fwd = camera.fwd;
  const right = norm3(...cross(fwd, camera.up));
  const up2 = cross(right, fwd);
  const focal = H * 0.5 * 1.55;
  const dx = p[0] - camera.pos[0];
  const dy = p[1] - camera.pos[1];
  const dz = p[2] - camera.pos[2];
  const vx = dx * right[0] + dy * right[1] + dz * right[2];
  const vy = dx * up2[0] + dy * up2[1] + dz * up2[2];
  const vz = dx * fwd[0] + dy * fwd[1] + dz * fwd[2];
  if (vz < 1) return { x: W / 2 + Math.sign(vx || 1) * W, y: H / 2, behind: true, depth: vz };
  return { x: W / 2 + (vx * focal) / vz, y: H / 2 - (vy * focal) / vz, behind: false, depth: vz };
}

// ------------------------------------------------------------ the renderer
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const terrain = buildTerrainMesh();
  const model = planeModel();
  const items = []; // rebuilt each frame: { depth, draw(ctx) } is too slow —
  // instead items are plain records the paint loop switches on.

  function draw(scene) {
    const { plane, scenery, rings, time, camera } = scene;
    const W = canvas.width;
    const H = canvas.height;
    const focal = H * 0.5 * 1.55; // ~65 degree vertical field of view
    const camPos = camera.pos;
    const fwd = camera.fwd;
    const right = norm3(...cross(fwd, camera.up));
    const up2 = cross(right, fwd);
    const shakeX = plane.shake ? Math.sin(time * 47) * plane.shake * 5 : 0;
    const shakeY = plane.shake ? Math.cos(time * 39) * plane.shake * 4 : 0;

    const toView = (p) => {
      const dx = p[0] - camPos[0];
      const dy = p[1] - camPos[1];
      const dz = p[2] - camPos[2];
      return [
        dx * right[0] + dy * right[1] + dz * right[2],
        dx * up2[0] + dy * up2[1] + dz * up2[2],
        dx * fwd[0] + dy * fwd[1] + dz * fwd[2],
      ];
    };
    const project = (v) => [
      W / 2 + (v[0] * focal) / v[2] + shakeX,
      H / 2 - (v[1] * focal) / v[2] + shakeY,
    ];

    // --- sky
    const flatFwd = norm3(fwd[0], 0, fwd[2]);
    const horizonY = H / 2 - (dot(flatFwd, up2) / Math.max(0.2, dot(flatFwd, fwd))) * focal;
    const grad = ctx.createLinearGradient(0, 0, 0, Math.max(H, horizonY + 2));
    grad.addColorStop(0, SKY_TOP);
    grad.addColorStop(Math.min(0.98, Math.max(0.05, horizonY / H)), SKY_HORIZON);
    grad.addColorStop(1, '#86a9c6');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // --- sun
    const sunView = toView([
      camPos[0] + SUN_DIR[0] * 9000,
      camPos[1] + SUN_DIR[1] * 9000,
      camPos[2] + SUN_DIR[2] * 9000,
    ]);
    if (sunView[2] > 0) {
      const [sx, sy] = project(sunView);
      const glow = ctx.createRadialGradient(sx, sy, 4, sx, sy, H * 0.36);
      glow.addColorStop(0, 'rgba(255,236,190,0.85)');
      glow.addColorStop(0.18, 'rgba(255,224,160,0.35)');
      glow.addColorStop(1, 'rgba(255,224,160,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(sx - H * 0.4, sy - H * 0.4, H * 0.8, H * 0.8);
      ctx.fillStyle = '#fff3cf';
      ctx.beginPath();
      ctx.arc(sx, sy, H * 0.028, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- gather the paint list
    items.length = 0;
    const NEAR = 1.6;
    const clipAndPush = (pts, color, alpha = 1, depthBias = 0, layer = 0, cls = 0) => {
      // clip the polygon against the near plane in view space
      let poly = pts.map(toView);
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const ain = a[2] >= NEAR;
        const bin = b[2] >= NEAR;
        if (ain) out.push(a);
        if (ain !== bin) {
          const t = (NEAR - a[2]) / (b[2] - a[2]);
          out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
        }
      }
      if (out.length < 3) return;
      let depth = 0;
      const pts2 = out.map((v) => {
        depth += v[2];
        return project(v);
      });
      depth /= out.length;
      if (depth > 9500) return;
      items.push({ kind: 'poly', pts: pts2, depth: depth - depthBias, color, alpha, layer, cls });
    };

    // terrain & sea (backface-culled by their static normals)
    for (const tri of terrain) {
      const c = tri.pts;
      const cx = (c[0][0] + c[1][0] + c[2][0]) / 3;
      const cy = (c[0][1] + c[1][1] + c[2][1]) / 3;
      const cz = (c[0][2] + c[1][2] + c[2][2]) / 3;
      const dx = cx - camPos[0];
      const dy = cy - camPos[1];
      const dz = cz - camPos[2];
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > 8100 * 8100) continue;
      if (!tri.flat) {
        // Backface cull: the stored winding gives an up-facing normal, and
        // d points from the camera to the face, so a positive dot means the
        // face's lit side points away from us.
        const n = cross(sub(c[1], c[0]), sub(c[2], c[0]));
        if (n[0] * dx + n[1] * dy + n[2] * dz >= 0) continue;
      }
      clipAndPush(c, tri.color, 1);
    }

    // runway (its own paint layer, stacked by class) and scenery
    for (const tri of runwayTris()) clipAndPush(tri.pts, tri.color, 1, 0, 1, tri.cls ?? 0);
    for (const tri of sceneryTris(scenery, camPos)) clipAndPush(tri.pts, tri.color, 1, 4);

    // clouds: soft billboard puffs, in the same depth order
    for (const cloud of scenery.clouds) {
      const dx = cloud.x - camPos[0];
      const dz = cloud.z - camPos[2];
      if (dx * dx + dz * dz > 6400 * 6400) continue;
      const v = toView([cloud.x, cloud.y, cloud.z]);
      if (v[2] < 30) continue;
      const [sx, sy] = project(v);
      const rScreen = (cloud.r * focal) / v[2];
      if (sx < -rScreen * 2 || sx > W + rScreen * 2) continue;
      const alpha = Math.max(0, 0.88 - v[2] / 9000);
      items.push({ kind: 'cloud', x: sx, y: sy, r: rScreen, depth: v[2], puffs: cloud.puffs, seed: cloud.x * 0.37 + cloud.z, alpha, storm: cloud.storm });
    }

    // rings
    for (const ring of rings) {
      const center = [ring.x, ring.y, ring.z];
      const v = toView(center);
      if (v[2] < 4 || v[2] > 7000) continue;
      const n = [ring.nx, ring.ny, ring.nz];
      let u = cross(n, [0, 1, 0]);
      if (Math.hypot(...u) < 0.05) u = [1, 0, 0];
      u = norm3(...u);
      const w = cross(n, u);
      const rim = [];
      for (let i = 0; i <= 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        const ca = Math.cos(a) * ring.r;
        const sa = Math.sin(a) * ring.r;
        rim.push([
          center[0] + u[0] * ca + w[0] * sa,
          center[1] + u[1] * ca + w[1] * sa,
          center[2] + u[2] * ca + w[2] * sa,
        ]);
      }
      const pts2 = [];
      let ok = true;
      for (const p of rim) {
        const pv = toView(p);
        if (pv[2] < NEAR) {
          ok = false;
          break;
        }
        pts2.push(project(pv));
      }
      if (!ok) continue;
      const tube = Math.max(2.2, (2.6 * focal) / v[2]);
      items.push({ kind: 'ring', pts: pts2, depth: v[2], state: ring.state, tube, pulse: 0.5 + 0.5 * Math.sin(time * 3.2) });
    }

    // PAPI lamps beside the threshold
    for (const lamp of papiLights(plane)) {
      const v = toView([lamp.x, lamp.y, lamp.z]);
      if (v[2] < 6 || v[2] > 2600) continue;
      const [sx, sy] = project(v);
      const r = Math.max(2, (1.5 * focal) / v[2]);
      items.push({ kind: 'dot', x: sx, y: sy, r, depth: v[2], color: lamp.white ? [255, 252, 240] : [255, 70, 55] });
    }
    // lighthouse lamp
    const lh = scenery.lighthouse;
    {
      const v = toView([lh.x, lh.y + lh.h + 1.6, lh.z]);
      if (v[2] > 6 && v[2] < 5200) {
        const [sx, sy] = project(v);
        const r = Math.max(2.4, (2.6 * focal) / v[2]) * (1 + 0.25 * Math.sin(time * 2.1));
        items.push({ kind: 'dot', x: sx, y: sy, r, depth: v[2], color: [255, 214, 120] });
      }
    }

    // the aeroplane herself
    {
      const basis = planeBasis(plane);
      const origin = [plane.x, plane.y, plane.z];
      const toWorld = (lp) => [
        origin[0] + basis.right.x * lp[0] + basis.up.x * lp[1] - basis.forward.x * lp[2],
        origin[1] + basis.right.y * lp[0] + basis.up.y * lp[1] - basis.forward.y * lp[2],
        origin[2] + basis.right.z * lp[0] + basis.up.z * lp[1] - basis.forward.z * lp[2],
      ];
      for (const part of model) {
        const world = part.pts.map(toWorld);
        const n = norm3(...cross(sub(world[1], world[0]), sub(world[2], world[0])));
        clipAndPush(world, shadeOf(part.color, n), 1, 0, 2);
      }
      // propeller: a faint disc and two blurred blades at the nose
      const propC = toWorld([0, 0.05, -4.62]);
      const bladeDir = [
        basis.right.x * Math.cos(plane.propPhase) + basis.up.x * Math.sin(plane.propPhase),
        basis.right.y * Math.cos(plane.propPhase) + basis.up.y * Math.sin(plane.propPhase),
        basis.right.z * Math.cos(plane.propPhase) + basis.up.z * Math.sin(plane.propPhase),
      ];
      const sideDir = cross([basis.forward.x, basis.forward.y, basis.forward.z], bladeDir);
      const blade = (sign) => [
        [propC[0] - sideDir[0] * 0.16, propC[1] - sideDir[1] * 0.16, propC[2] - sideDir[2] * 0.16],
        [propC[0] + sideDir[0] * 0.16, propC[1] + sideDir[1] * 0.16, propC[2] + sideDir[2] * 0.16],
        [
          propC[0] + sideDir[0] * 0.16 + bladeDir[0] * 2.0 * sign,
          propC[1] + sideDir[1] * 0.16 + bladeDir[1] * 2.0 * sign,
          propC[2] + sideDir[2] * 0.16 + bladeDir[2] * 2.0 * sign,
        ],
        [
          propC[0] - sideDir[0] * 0.16 + bladeDir[0] * 2.0 * sign,
          propC[1] - sideDir[1] * 0.16 + bladeDir[1] * 2.0 * sign,
          propC[2] - sideDir[2] * 0.16 + bladeDir[2] * 2.0 * sign,
        ],
      ];
      clipAndPush(blade(1), [40, 42, 48], 0.85, 0, 2);
      clipAndPush(blade(-1), [40, 42, 48], 0.85, 0, 2);
      const disc = [];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        disc.push([
          propC[0] + (basis.right.x * Math.cos(a) + basis.up.x * Math.sin(a)) * 2.05,
          propC[1] + (basis.right.y * Math.cos(a) + basis.up.y * Math.sin(a)) * 2.05,
          propC[2] + (basis.right.z * Math.cos(a) + basis.up.z * Math.sin(a)) * 2.05,
        ]);
      }
      clipAndPush(disc, [30, 32, 38], 0.16, 0, 2);
    }

    // --- paint: layer by layer (world, then the runway stack, then the
    // plane), far to near inside a layer, class order inside the runway.
    items.sort(
      (a, b) =>
        (a.layer ?? 0) - (b.layer ?? 0) || (a.cls ?? 0) - (b.cls ?? 0) || b.depth - a.depth,
    );
    for (const item of items) {
      if (item.kind === 'poly') {
        ctx.globalAlpha = item.alpha;
        ctx.fillStyle = css(fogged(item.color, item.depth));
        ctx.beginPath();
        ctx.moveTo(item.pts[0][0], item.pts[0][1]);
        for (let i = 1; i < item.pts.length; i++) ctx.lineTo(item.pts[i][0], item.pts[i][1]);
        ctx.closePath();
        ctx.fill();
      } else if (item.kind === 'cloud') {
        ctx.globalAlpha = item.storm ? Math.min(1, item.alpha + 0.1) : item.alpha;
        ctx.fillStyle = item.storm ? '#5b6673' : '#ffffff';
        for (let p = 0; p < item.puffs; p++) {
          const off = Math.sin(item.seed + p * 1.7) * item.r * 0.55;
          const offY = Math.cos(item.seed * 1.3 + p * 2.1) * item.r * 0.16;
          const pr = item.r * (0.55 + 0.3 * Math.abs(Math.sin(item.seed + p)));
          ctx.beginPath();
          ctx.ellipse(item.x + off, item.y + offY, pr, pr * 0.42, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (item.kind === 'ring') {
        const col =
          item.state === 'done'
            ? 'rgba(96,205,120,'
            : item.state === 'next'
              ? `rgba(255,${185 + Math.round(item.pulse * 55)},60,`
              : 'rgba(238,214,150,';
        ctx.globalAlpha = 1;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(item.pts[0][0], item.pts[0][1]);
        for (let i = 1; i < item.pts.length; i++) ctx.lineTo(item.pts[i][0], item.pts[i][1]);
        ctx.closePath();
        if (item.state === 'next') {
          ctx.fillStyle = col + '0.10)';
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(70,48,10,0.85)';
        ctx.lineWidth = item.tube * 1.7;
        ctx.stroke();
        ctx.strokeStyle = col + '0.98)';
        ctx.lineWidth = item.tube;
        ctx.stroke();
      } else if (item.kind === 'dot') {
        ctx.globalAlpha = 0.95;
        const glow = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, item.r * 3.2);
        glow.addColorStop(0, css(item.color, 0.9));
        glow.addColorStop(1, css(item.color, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(item.x - item.r * 3.2, item.y - item.r * 3.2, item.r * 6.4, item.r * 6.4);
        ctx.fillStyle = css(item.color);
        ctx.beginPath();
        ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  return { draw };
}
