// main.js — Pelican Post: Island Mail Run.
//
// A chase-view flight game over the Gullwing Archipelago. Thread golden
// rings (the cleaner the line through the centre, the more they pay, and
// consecutive rings build a combo), watch the wind and the storm cells,
// then put the Pelican down gently on the harbor strip.
//
// States: title -> brief -> flying <-> paused -> card (complete / crash /
// landed) -> next sortie ... -> campaign card -> free flight.

import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createPlane, stepPlane, forwardVector } from './flight.js';
import { buildScenery, terrainHeight, RUNWAY, runwayPoint } from './world.js';
import {
  MISSIONS,
  SCORE,
  LANDING_TARGET,
  ringPlaneDistance,
  ringRadialDistance,
} from './missions.js';
import { makeRng } from './random.js';
import {
  createRenderer,
  createCamera,
  updateCamera,
  placeCamera,
  projectPoint,
} from './render.js';
import { planeBasis } from './flight.js';
import { drawHud, drawScreen } from './hud.js';

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') ?? 7) || 7;
const SHOT = params.get('shot');

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const renderer = createRenderer(canvas);
const camera = createCamera();
const input = createInput();
const audio = createAudio();
const scenery = buildScenery(SEED);
const gustRng = makeRng(SEED * 31 + 5);
const freeRng = makeRng(SEED * 101 + 77);

function fitCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

// ------------------------------------------------------------------ state
const game = {
  state: 'title', // title | brief | flying | paused | card | shot
  missionIndex: 0,
  freeFlight: false,
  score: 0,
  scoreAtSortieStart: 0,
  plane: null,
  rings: [],
  targetIndex: 0,
  combo: 0,
  bestCombo: 0,
  elapsed: 0,
  flash: null,
  card: null,
  completeTimer: -1,
  sortiePoints: { rings: 0, landing: 0, time: 0 },
  turbulence: false,
  wind: { x: 0, z: 0, gust: 0, gustDir: 0, gustDur: 0, gustT: 0, next: 5 },
  time: 0,
};

function mission() {
  return MISSIONS[game.missionIndex];
}

function startSortie(index, keepScore) {
  game.missionIndex = index;
  game.freeFlight = false;
  if (!keepScore) game.score = game.scoreAtSortieStart;
  game.scoreAtSortieStart = game.score;
  const m = mission();
  game.plane = createPlane(m.spawn);
  game.rings = m.rings.map((r, i) => ({ ...r, state: i === 0 ? 'next' : 'todo' }));
  game.targetIndex = 0;
  game.combo = 0;
  game.bestCombo = 0;
  game.elapsed = 0;
  game.flash = null;
  game.completeTimer = -1;
  game.sortiePoints = { rings: 0, landing: 0, time: 0 };
  game.card = null;
  camera.pos = null;
  updateCamera(camera, game.plane, 0.6);
  updateCamera(camera, game.plane, 0.6);
}

function startFreeFlight() {
  game.freeFlight = true;
  game.scoreAtSortieStart = game.score;
  game.plane = createPlane({ x: -1500, y: 200, z: 1400, headingDeg: 35, speed: 42, fuel: 100 });
  game.rings = [];
  game.targetIndex = 0;
  game.combo = 0;
  game.bestCombo = 0;
  game.elapsed = 0;
  game.flash = null;
  game.completeTimer = -1;
  game.card = null;
  spawnFreeRing();
  camera.pos = null;
  updateCamera(camera, game.plane, 0.6);
  updateCamera(camera, game.plane, 0.6);
}

// A fresh ring ahead of the plane, somewhere she can actually reach.
function spawnFreeRing() {
  const p = game.plane;
  const fwd = forwardVector(p);
  const right = { x: Math.cos(p.heading), z: Math.sin(p.heading) };
  const dist = 820 + freeRng() * 380;
  const lateral = (freeRng() * 2 - 1) * 320;
  let x = p.x + fwd.x * dist + right.x * lateral;
  let z = p.z + fwd.z * dist + right.z * lateral;
  x = Math.max(-2450, Math.min(2450, x));
  z = Math.max(-2450, Math.min(2450, z));
  const ground = terrainHeight(x, z);
  const y = Math.max(ground + 58, Math.min(285, p.y + (freeRng() * 2 - 1) * 55));
  const dx = x - p.x;
  const dy = y - p.y;
  const dz = z - p.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  game.rings = [
    { x, y, z, r: 27, nx: dx / len, ny: dy / len, nz: dz / len, state: 'next' },
  ];
  game.targetIndex = 0;
}

function setFlash(text, color, seconds = 1.15) {
  game.flash = { text, color, until: game.time + seconds };
}

// ------------------------------------------------------------------ cards
const INK = '#eaf4fb';
const DIM = 'rgba(234,244,251,0.66)';
const AMBER = '#ffc44d';
const GREEN = '#7be495';
const RED = '#ff6a5e';

function titleScreen() {
  return {
    cardH: 452,
    lines: [
      ['PELICAN POST', 52, AMBER, 800],
      ['I S L A N D   M A I L   R U N', 17, INK, 600],
      ['', 10, INK],
      ['Fly the mail around the Gullwing Archipelago.', 15, DIM, 500],
      ['Thread the golden rings — dead centre pays best, and rings in a row build a combo.', 13, DIM, 500],
      ['Mind the gusts, give the storm cells a wide berth, and land her gently.', 13, DIM, 500],
      ['', 10, INK],
      ['↑ ↓  pitch      ← →  bank      W / S  throttle      SPACE  airbrake', 13, INK, 600],
      ['ENTER  fly      P  pause      M  mute      the mouse steers too', 13, INK, 600],
      ['', 10, INK],
      ['Press ENTER to take up Sortie 1', 17, GREEN, 700],
    ],
  };
}

function briefScreen() {
  const m = mission();
  return {
    cardH: 300,
    lines: [
      [m.title, 30, AMBER, 800],
      ['', 8, INK],
      [m.brief, 14, INK, 500],
      ['', 8, INK],
      [`Par time ${SCORE.parTimes[game.missionIndex]}s · beat it for a time bonus`, 13, DIM, 500],
      ['', 8, INK],
      ['Press ENTER to launch', 16, GREEN, 700],
    ],
  };
}

function pauseScreen() {
  return {
    cardH: 240,
    lines: [
      ['PAUSED', 32, AMBER, 800],
      ['', 8, INK],
      ['The Pelican holds her course.', 14, DIM, 500],
      ['', 8, INK],
      ['P to fly on · ENTER also resumes', 15, GREEN, 700],
    ],
  };
}

function statsLines() {
  const lines = [
    [`Time ${formatClock(game.elapsed)}`, 15, INK, 600],
    [`Rings +${game.sortiePoints.rings} · best combo x${(1 + SCORE.comboStep * Math.max(0, game.bestCombo - 1)).toFixed(2)}`, 15, INK, 600],
  ];
  if (game.sortiePoints.landing) lines.push([`Landing +${game.sortiePoints.landing}`, 15, INK, 600]);
  if (game.sortiePoints.time) lines.push([`Time bonus +${game.sortiePoints.time}`, 15, INK, 600]);
  lines.push([`Total score ${game.score}`, 19, AMBER, 800]);
  return lines;
}

function cardScreen() {
  const c = game.card;
  if (!c) return pauseScreen();
  if (c.kind === 'crash') {
    return {
      cardH: 330,
      lines: [
        ['DOWN', 38, RED, 800],
        ['', 6, INK],
        [c.reason, 14, INK, 500],
        ['', 6, INK],
        [`Score kept from finished sorties: ${game.scoreAtSortieStart}`, 14, DIM, 500],
        ['', 8, INK],
        ['Press ENTER to fly the sortie again', 16, GREEN, 700],
      ],
    };
  }
  if (c.kind === 'campaign') {
    return {
      cardH: 360,
      lines: [
        ['THE MAIL IS DELIVERED', 30, AMBER, 800],
        ['', 6, INK],
        ['All three sorties flown. The harbor master owes you a drink.', 14, INK, 500],
        ...statsLines(),
        ['', 8, INK],
        ['ENTER — free flight, endless rings', 16, GREEN, 700],
        ['R — fly the campaign again', 13, DIM, 600],
      ],
    };
  }
  // complete / landed
  return {
    cardH: 380,
    lines: [
      [c.kind === 'complete' ? 'SORTIE COMPLETE' : 'DOWN SAFE', 32, GREEN, 800],
      ['', 6, INK],
      [c.note, 14, INK, 500],
      ...statsLines(),
      ['', 8, INK],
      [c.nextLabel, 16, GREEN, 700],
    ],
  };
}

function formatClock(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ flow
function finishSortie(note) {
  const m = mission();
  let timeBonus = 0;
  const par = SCORE.parTimes[game.missionIndex];
  if (!game.freeFlight && game.elapsed < par) {
    timeBonus = Math.round((par - game.elapsed) * SCORE.timeBonusPerSecond);
  }
  game.sortiePoints.time = timeBonus;
  game.score += timeBonus;
  const last = game.missionIndex >= MISSIONS.length - 1;
  game.card = {
    kind: last && !game.freeFlight ? 'campaign' : 'complete',
    note,
    nextLabel: last
      ? 'Press ENTER for free flight'
      : `Press ENTER for ${MISSIONS[game.missionIndex + 1].title}`,
  };
  game.state = 'card';
  audio.complete();
}

function onTouchdown(ev) {
  const landingPts =
    ev.quality === 'smooth'
      ? SCORE.smoothLanding
      : ev.quality === 'firm'
        ? SCORE.firmLanding
        : SCORE.hardLanding;
  game.sortiePoints.landing = landingPts;
  game.score += landingPts;
  audio.touchdown();
  if (game.freeFlight) {
    game.card = {
      kind: 'landed',
      note: `A ${ev.quality} arrival back at the harbor. Free flight over — the kettle is on.`,
      nextLabel: 'Press ENTER to fly free again',
    };
    game.state = 'card';
    return;
  }
  const ringsDone = game.rings.filter((r) => r.state === 'done').length;
  const ringsLeft = mission().rings.length - ringsDone;
  if (ringsLeft === 0 && mission().landToFinish) {
    finishSortie(`A ${ev.quality} landing with the mail aboard. The harbor master is pleased.`);
  } else if (ringsLeft === 0) {
    finishSortie('Rings done and down in one piece. Tidy flying.');
  } else {
    game.card = {
      kind: 'landed',
      note: `Down safe, but ${ringsLeft} ring${ringsLeft === 1 ? '' : 's'} still unflown — the sortie does not count.`,
      nextLabel: 'Press ENTER to fly the sortie again',
    };
    game.score -= landingPts; // a landing that abandons the sortie pays nothing
    game.sortiePoints.landing = 0;
    game.state = 'card';
    game.card.retry = true;
  }
}

function onCrash(ev) {
  audio.crash();
  game.score = game.scoreAtSortieStart;
  game.card = { kind: 'crash', reason: ev.reason };
  game.state = 'card';
}

// ------------------------------------------------------------------ update
function updateWind(dt) {
  const w = game.wind;
  if (w.gustT > 0) {
    w.gustT -= dt;
    const phase = 1 - Math.max(0, w.gustT) / w.gustDur;
    w.gust = Math.sin(Math.PI * Math.min(1, phase)) * w.gustPeak;
    if (phase >= 1) {
      w.gust = 0;
      w.gustT = 0;
      w.next = 6 + gustRng() * 9;
    }
  } else {
    w.next -= dt;
    w.gust = 0;
    if (w.next <= 0) {
      w.gustDur = 2.4 + gustRng() * 1.8;
      w.gustT = w.gustDur;
      w.gustPeak = 6 + gustRng() * 5.5;
      w.gustDir = gustRng() * Math.PI * 2;
      setFlash('WIND GUST', AMBER, 0.9);
    }
  }
  const baseAngle = 0.8 + Math.sin(game.time * 0.05) * 0.4; // a steady westerly, veering slowly
  w.x = Math.cos(baseAngle) * 2.2 + Math.cos(w.gustDir) * w.gust;
  w.z = Math.sin(baseAngle) * 2.2 + Math.sin(w.gustDir) * w.gust;
}

function update(dt) {
  game.time += dt;
  const plane = game.plane;
  if (game.state !== 'flying' || !plane) return;
  game.elapsed += dt;
  updateWind(dt);

  const controls = input.readControls(canvas.width, canvas.height);
  const prev = { x: plane.x, y: plane.y, z: plane.z };
  const events = [];
  // substep the physics so a slow frame cannot tunnel through a ring plane
  const steps = 2;
  for (let i = 0; i < steps; i++) stepPlane(plane, controls, dt / steps, events);

  // wind drift and gust buffet
  plane.x += game.wind.x * dt;
  plane.z += game.wind.z * dt;
  if (game.wind.gust > 3) plane.shake = Math.max(plane.shake, (game.wind.gust - 3) * 0.03);

  // storm cells: dark clouds are turbulent and chew the airframe
  game.turbulence = false;
  for (const cloud of scenery.clouds) {
    if (!cloud.storm) continue;
    const dx = plane.x - cloud.x;
    const dz = plane.z - cloud.z;
    if (dx * dx + dz * dz < cloud.r * cloud.r * 0.8 && Math.abs(plane.y - cloud.y) < 30) {
      game.turbulence = true;
      plane.shake = Math.max(plane.shake, 0.55);
      plane.damage = Math.min(100, plane.damage + dt * 1.6);
    }
  }
  if (plane.damage >= 100 && plane.alive) {
    plane.alive = false;
    events.push({ type: 'crash', reason: 'The storm cell worried the airframe past mending.' });
  }

  for (const ev of events) {
    if (ev.type === 'touchdown') onTouchdown(ev);
    else if (ev.type === 'crash') onCrash(ev);
  }
  if (game.state !== 'flying') return;

  // --- the ring gate
  const target = game.rings[game.targetIndex];
  if (target && target.state !== 'done') {
    const dPrev = ringPlaneDistance(prev, target);
    const dCur = ringPlaneDistance(plane, target);
    if (dPrev < 0 && dCur >= 0) {
      const t = dPrev / (dPrev - dCur);
      const cross = {
        x: prev.x + (plane.x - prev.x) * t,
        y: prev.y + (plane.y - prev.y) * t,
        z: prev.z + (plane.z - prev.z) * t,
      };
      const radial = ringRadialDistance(cross, target);
      if (radial <= target.r) {
        const frac = radial / target.r;
        const tier = frac <= 0.18 ? SCORE.ringPerfect : frac <= 0.55 ? SCORE.ringClean : SCORE.ringEdge;
        game.combo += 1;
        game.bestCombo = Math.max(game.bestCombo, game.combo);
        const mult = Math.min(2, 1 + SCORE.comboStep * (game.combo - 1));
        const pts = Math.round(tier * mult);
        game.score += pts;
        game.sortiePoints.rings += pts;
        const word = frac <= 0.18 ? 'PERFECT' : frac <= 0.55 ? 'CLEAN' : 'RING';
        setFlash(game.combo > 1 ? `${word} +${pts}  x${mult.toFixed(2)}` : `${word} +${pts}`, frac <= 0.18 ? AMBER : GREEN);
        audio.ring();
        plane.shake = Math.max(plane.shake, 0.28);
        target.state = 'done';
        plane.fuel = Math.min(100, plane.fuel + (game.freeFlight ? 14 : 0));
        if (game.freeFlight) {
          spawnFreeRing();
        } else {
          game.targetIndex += 1;
          const next = game.rings[game.targetIndex];
          if (next) next.state = 'next';
          else if (!mission().landToFinish) game.completeTimer = 1.5;
        }
      } else {
        game.combo = 0;
        setFlash('MISSED — COME AROUND', AMBER, 1.0);
      }
    }
  }

  if (game.completeTimer > 0) {
    game.completeTimer -= dt;
    if (game.completeTimer <= 0) {
      game.completeTimer = -1;
      finishSortie('Every ring threaded. The postmaster stamps your logbook.');
    }
  }

  audio.update(plane, true);
}

// ------------------------------------------------------------------ views
function currentTarget() {
  if (game.freeFlight) {
    const r = game.rings[0];
    return r ? { x: r.x, y: r.y, z: r.z, label: 'RING' } : null;
  }
  const m = mission();
  const ring = game.rings[game.targetIndex];
  if (ring) return { x: ring.x, y: ring.y, z: ring.z, label: `RING ${game.targetIndex + 1}` };
  if (m.landToFinish) return { ...LANDING_TARGET, label: 'RUNWAY' };
  return null;
}

function objectiveText() {
  if (game.freeFlight) return 'Free flight — chase the rings, land at the harbor when you are done.';
  const m = mission();
  if (game.targetIndex < m.rings.length) {
    return `Ring ${game.targetIndex + 1} of ${m.rings.length} — thread it near the centre`;
  }
  if (m.landToFinish) return 'All rings done — land on the harbor strip: slow, gentle, along the runway';
  return 'All rings done';
}

function render() {
  const W = canvas.width;
  const H = canvas.height;
  const plane = game.plane;
  if (!plane) return;
  renderer.draw({ plane, scenery, rings: game.rings, time: game.time, camera });

  if (game.state === 'title') {
    drawScreen(ctx, W, H, titleScreen());
    return;
  }
  if (game.state === 'shot') return; // the scene was composed by setupShot

  const target = currentTarget();
  let targetScreen = null;
  let targetDist = 0;
  if (target && game.state !== 'card') {
    targetScreen = projectPoint(camera, W, H, [target.x, target.y, target.z]);
    targetDist = Math.hypot(plane.x - target.x, plane.y - target.y, plane.z - target.z);
  }
  drawHud(
    ctx,
    W,
    H,
    {
      plane,
      score: game.score,
      elapsed: game.elapsed,
      missionTitle: game.freeFlight ? 'Free Flight' : mission().title,
      objective: objectiveText(),
      groundBelow: terrainHeight(plane.x, plane.z),
      targetScreen,
      targetLabel: target ? target.label : '',
      targetDist,
      flash: game.flash,
      brake: input.state.brake,
      turbulence: game.turbulence,
    },
    game.time,
  );

  if (game.state === 'brief') drawScreen(ctx, W, H, briefScreen());
  else if (game.state === 'paused') drawScreen(ctx, W, H, pauseScreen());
  else if (game.state === 'card') drawScreen(ctx, W, H, cardScreen());
}

// ------------------------------------------------------------------ input flow
function handleKeys() {
  if (input.wasPressed('Enter')) {
    audio.start();
    if (game.state === 'title') {
      startSortie(0, false);
      game.state = 'brief';
    } else if (game.state === 'brief') {
      game.state = 'flying';
    } else if (game.state === 'paused') {
      game.state = 'flying';
    } else if (game.state === 'card') {
      const c = game.card;
      if (!c) return;
      if (c.kind === 'crash' || c.retry) {
        startSortie(game.missionIndex, false);
        game.state = 'brief';
      } else if (c.kind === 'campaign') {
        startFreeFlight();
        game.state = 'flying';
      } else if (game.freeFlight) {
        startFreeFlight();
        game.state = 'flying';
      } else if (game.missionIndex < MISSIONS.length - 1) {
        startSortie(game.missionIndex + 1, true);
        game.state = 'brief';
      } else {
        startFreeFlight();
        game.state = 'flying';
      }
    }
  }
  if (input.wasPressed('KeyR') && game.state === 'card' && game.card?.kind === 'campaign') {
    game.score = 0;
    game.scoreAtSortieStart = 0;
    startSortie(0, false);
    game.state = 'brief';
  }
  if (input.wasPressed('KeyP')) {
    if (game.state === 'flying') game.state = 'paused';
    else if (game.state === 'paused') game.state = 'flying';
  }
  audio.setMuted(input.state.muted);
}

// ------------------------------------------------------------------ shots
// Deterministic scenes for the screenshots in shots.json. Each composes a
// real moment of the game — same world, same code path, frozen in time.
function setupShot(name) {
  game.state = 'shot';
  game.time = 2.4;
  const settle = (plane) => {
    camera.pos = null;
    updateCamera(camera, plane, 0.7);
    updateCamera(camera, plane, 0.7);
    updateCamera(camera, plane, 0.7);
  };
  if (name === 'rings') {
    const m = MISSIONS[0];
    game.plane = createPlane(m.spawn);
    const ring = m.rings[1];
    game.plane.x = ring.x - ring.nx * 300 + 16;
    game.plane.y = ring.y - ring.ny * 300 + 8;
    game.plane.z = ring.z - ring.nz * 300;
    game.plane.heading = Math.atan2(ring.nx, -ring.nz);
    game.plane.pitch = Math.asin(Math.max(-1, Math.min(1, ring.ny)));
    game.plane.roll = -0.12;
    game.plane.speed = 45;
    game.plane.throttle = 0.62;
    game.plane.propPhase = 1.2;
    game.rings = m.rings.map((r, i) => ({ ...r, state: i === 0 ? 'done' : i === 1 ? 'next' : 'todo' }));
    game.targetIndex = 1;
    game.score = 320;
    game.elapsed = 34;
    settle(game.plane);
  } else if (name === 'landing') {
    const m = MISSIONS[1];
    game.missionIndex = 1;
    game.plane = createPlane(m.spawn);
    const p = runwayPoint(-430, 9);
    game.plane.x = p.x;
    game.plane.z = p.z;
    game.plane.y = RUNWAY.elevation + 27;
    game.plane.heading = (RUNWAY.headingDeg * Math.PI) / 180;
    game.plane.pitch = -0.055;
    game.plane.speed = 29;
    game.plane.throttle = 0.3;
    game.plane.fuel = 63;
    game.plane.propPhase = 2.1;
    game.rings = m.rings.map((r) => ({ ...r, state: 'done' }));
    game.targetIndex = 2;
    game.score = 640;
    game.elapsed = 71;
    settle(game.plane);
  } else if (name === 'islands') {
    const m = MISSIONS[2];
    game.missionIndex = 2;
    game.plane = createPlane(m.spawn);
    game.plane.x = 420;
    game.plane.y = 305;
    game.plane.z = -260;
    game.plane.heading = (208 * Math.PI) / 180;
    game.plane.pitch = -0.03;
    game.plane.roll = 0.24;
    game.plane.speed = 48;
    game.plane.throttle = 0.7;
    game.plane.fuel = 58;
    game.plane.propPhase = 0.6;
    game.rings = m.rings.map((r, i) => ({ ...r, state: i === 2 ? 'next' : i < 2 ? 'done' : 'todo' }));
    game.targetIndex = 2;
    game.score = 1240;
    game.elapsed = 96;
    const basis = planeBasis(game.plane);
    const pos = [
      game.plane.x - basis.forward.x * 52 - basis.right.x * 30 + basis.up.x * 15,
      game.plane.y - basis.forward.y * 52 - basis.right.y * 30 + basis.up.y * 15,
      game.plane.z - basis.forward.z * 52 - basis.right.z * 30 + basis.up.z * 15,
    ];
    const look = [
      game.plane.x + basis.forward.x * 120,
      game.plane.y + basis.forward.y * 120 - 6,
      game.plane.z + basis.forward.z * 120,
    ];
    placeCamera(camera, pos, look, [basis.up.x, basis.up.y, basis.up.z]);
  } else {
    // title: a composed three-quarter view of the Pelican over the harbor
    game.plane = createPlane(MISSIONS[0].spawn);
    game.plane.x = -640;
    game.plane.y = 150;
    game.plane.z = 60;
    game.plane.heading = (68 * Math.PI) / 180;
    game.plane.pitch = 0.03;
    game.plane.roll = -0.14;
    game.plane.throttle = 0.6;
    game.plane.propPhase = 1.1;
    game.rings = MISSIONS[0].rings.map((r, i) => ({ ...r, state: i === 1 ? 'next' : 'todo' }));
    game.targetIndex = 1;
    const basis = planeBasis(game.plane);
    const pos = [
      game.plane.x - basis.forward.x * 23 + basis.right.x * 25 + basis.up.x * 8,
      game.plane.y - basis.forward.y * 23 + basis.right.y * 25 + basis.up.y * 8,
      game.plane.z - basis.forward.z * 23 + basis.right.z * 25 + basis.up.z * 8,
    ];
    const look = [
      game.plane.x + basis.forward.x * 90,
      game.plane.y + basis.forward.y * 90 - 4,
      game.plane.z + basis.forward.z * 90,
    ];
    placeCamera(camera, pos, look, [basis.up.x, basis.up.y, basis.up.z]);
    game.state = 'title'; // the title card draws over this scene
  }
  // HUD for the flying shots (the title shot keeps its card instead)
  if (name !== 'title' && game.state === 'shot') {
    const target = currentTarget();
    const plane = game.plane;
    let targetScreen = null;
    let targetDist = 0;
    if (target) {
      targetScreen = projectPoint(camera, canvas.width, canvas.height, [target.x, target.y, target.z]);
      targetDist = Math.hypot(plane.x - target.x, plane.y - target.y, plane.z - target.z);
    }
    game.shotHud = {
      plane,
      score: game.score,
      elapsed: game.elapsed,
      missionTitle: game.freeFlight ? 'Free Flight' : mission().title,
      objective: objectiveText(),
      groundBelow: terrainHeight(plane.x, plane.z),
      targetScreen,
      targetLabel: target ? target.label : '',
      targetDist,
      flash: null,
      brake: false,
      turbulence: false,
    };
  }
}

// ------------------------------------------------------------------ boot
if (SHOT) {
  setupShot(SHOT);
} else {
  // the title backdrop: the same composed scene the title screenshot uses
  setupShot('title');
  game.state = 'title';
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game.state === 'shot') {
    renderer.draw({ plane: game.plane, scenery, rings: game.rings, time: game.time, camera });
    if (game.shotHud) drawHud(ctx, canvas.width, canvas.height, game.shotHud, game.time);
  } else {
    handleKeys();
    if (game.state === 'flying') {
      update(dt);
      if (game.plane) updateCamera(camera, game.plane, dt);
    } else if (game.plane) {
      audio.update(game.plane, false); // let the engine wind down on cards
    }
    if (game.state === 'title' && game.plane) {
      game.plane.propPhase += dt * 22; // she idles on the title backdrop
    }
    render();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
