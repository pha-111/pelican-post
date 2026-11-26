// flight.js — the Pelican, a cheerful single-engine mail plane, and the
// arcade flight model that flies her.
//
// The model rewards discipline rather than twitch: turns are banked (roll
// first, and the nose follows at a rate set by speed), the wing stalls if
// you haul back too slow, the engine drinks fuel in proportion to throttle,
// and the ground is only forgiving on the runway, slow and gentle.

import { RUNWAY, runwayLocal, terrainHeight } from './world.js';

export const PLANE_SPEC = {
  minSpeed: 14, // m/s, engine idling in flight
  maxSpeed: 72, // m/s at full throttle, level
  stallSpeed: 23, // below this the wing gives up
  cruiseSpeed: 44,
  maxPitchDeg: 26,
  maxBankDeg: 58,
  fuelCapacity: 100,
};

const DEG = Math.PI / 180;

// A fresh aircraft, airborne on a spawn described by a mission.
export function createPlane(spawn) {
  return {
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    heading: spawn.headingDeg * DEG, // radians, 0 = north, clockwise
    pitch: 0, // radians, + nose up
    roll: 0, // radians, + right wing down
    speed: spawn.speed ?? 40, // m/s along the flight path
    throttle: 0.55,
    fuel: spawn.fuel ?? PLANE_SPEC.fuelCapacity,
    damage: 0, // 0 sound .. 100 wrecked
    verticalSpeed: 0, // m/s, + climbing (smoothed, drives the VSI gauge)
    stalled: false,
    engineOut: false,
    propPhase: 0, // radians, for the spinning propeller
    shake: 0, // 0..1 buffet, stall or damage
    alive: true,
    landed: false,
  };
}

// The unit vector the nose points along.
export function forwardVector(plane) {
  const cp = Math.cos(plane.pitch);
  return {
    x: Math.sin(plane.heading) * cp,
    y: Math.sin(plane.pitch),
    z: -Math.cos(plane.heading) * cp,
  };
}

// The aircraft's orientation basis: forward (nose), right (starboard wing)
// and up (out of the canopy), built yaw -> pitch -> roll. The renderer and
// the chase camera both work in this frame.
export function planeBasis(plane) {
  const sh = Math.sin(plane.heading), ch = Math.cos(plane.heading);
  const sp = Math.sin(plane.pitch), cp = Math.cos(plane.pitch);
  const sr = Math.sin(plane.roll), cr = Math.cos(plane.roll);
  const forward = { x: sh * cp, y: sp, z: -ch * cp };
  const rightFlat = { x: ch, y: 0, z: sh }; // right before pitch and roll
  const upPitched = { x: -sh * sp, y: cp, z: ch * sp }; // up after pitch
  const right = {
    x: rightFlat.x * cr - upPitched.x * sr,
    y: rightFlat.y * cr - upPitched.y * sr,
    z: rightFlat.z * cr - upPitched.z * sr,
  };
  const up = {
    x: rightFlat.x * sr + upPitched.x * cr,
    y: rightFlat.y * sr + upPitched.y * cr,
    z: rightFlat.z * sr + upPitched.z * cr,
  };
  return { forward, right, up };
}

// The unit vector out of the top of the canopy.
export function upVector(plane) {
  return planeBasis(plane).up;
}

// Advance the simulation one step. input = { pitch: -1..1 (+ pull up),
// bank: -1..1 (+ bank right), throttleDelta: -1..1, brake: boolean }.
// events collects what happened this step: { type: 'touchdown'|'crash', ... }.
export function stepPlane(plane, input, dt, events) {
  if (!plane.alive || plane.landed) return;
  const spec = PLANE_SPEC;

  // --- controls: attitude chases the pilot's demand, it does not snap.
  const targetRoll = input.bank * spec.maxBankDeg * DEG;
  const rollRate = 2.6; // 1/s approach
  plane.roll += (targetRoll - plane.roll) * Math.min(1, rollRate * dt);

  const speedFactor = Math.min(1, Math.max(0.35, plane.speed / spec.cruiseSpeed));
  const targetPitch = input.pitch * spec.maxPitchDeg * DEG * (plane.stalled ? 0.35 : 1);
  plane.pitch += (targetPitch - plane.pitch) * Math.min(1, 2.2 * dt) * speedFactor;

  // --- throttle and engine.
  plane.throttle = clamp(plane.throttle + input.throttleDelta * dt * 0.55, 0, 1);
  plane.engineOut = plane.fuel <= 0;
  const power = plane.engineOut ? 0 : plane.throttle;
  plane.fuel = Math.max(0, plane.fuel - dt * (0.055 + power * 0.24) * (plane.engineOut ? 0 : 1));
  const brakeDrag = input.brake ? 5.5 : 0;

  // --- speed: engine pushes toward the throttle's speed, drag and the
  // climb trade against it (dive to gain speed, climb to bleed it).
  const throttleSpeed = spec.minSpeed + power * (spec.maxSpeed - spec.minSpeed);
  const accel = (throttleSpeed - plane.speed) * 0.35 - Math.sin(plane.pitch) * 6.5 - brakeDrag;
  plane.speed = clamp(plane.speed + accel * dt, 8, 92);

  // --- banked turn: heading rate from bank and speed, g tan(bank) / v.
  const turnRate = (9.81 * Math.tan(clamp(plane.roll, -1.1, 1.1))) / Math.max(plane.speed, 12);
  plane.heading += turnRate * dt * (plane.stalled ? 0.45 : 1);

  // --- stall: below stall speed lift fades, the nose drops and she sinks.
  plane.stalled = plane.speed < spec.stallSpeed;
  let sink = 0;
  if (plane.stalled) {
    const depth = 1 - plane.speed / spec.stallSpeed;
    sink = depth * 9.5;
    plane.pitch -= depth * 0.22 * dt;
    plane.shake = Math.min(1, plane.shake + dt * 3);
  } else {
    plane.shake = Math.max(0, plane.shake - dt * 1.6);
  }
  if (plane.damage > 55) plane.shake = Math.max(plane.shake, 0.35);

  // --- integrate along the flight path.
  const fwd = forwardVector(plane);
  const vy = fwd.y * plane.speed - sink;
  plane.verticalSpeed += (vy - plane.verticalSpeed) * Math.min(1, 5 * dt);
  plane.x += fwd.x * plane.speed * dt;
  plane.y += vy * dt;
  plane.z += fwd.z * plane.speed * dt;
  plane.propPhase += dt * (4 + power * 55);

  // --- the ground.
  const ground = terrainHeight(plane.x, plane.z);
  const clearance = plane.y - ground;
  if (clearance <= 0.4) {
    resolveGroundContact(plane, ground, events);
  }
}

function resolveGroundContact(plane, ground, events) {
  const loc = runwayLocal(plane.x, plane.z);
  const onStrip =
    Math.abs(loc.along) <= RUNWAY.length / 2 && Math.abs(loc.across) <= RUNWAY.width / 2 + 3;
  const headingErr = Math.abs(angleDiffDeg(plane.heading / DEG, RUNWAY.headingDeg));
  const sinkRate = -plane.verticalSpeed;

  if (onStrip && headingErr < 14 && sinkRate < 3.4 && plane.speed < 36 && Math.abs(plane.roll) < 0.16) {
    // A landing. Grade it: gentle and slow and centred is worth most.
    const quality =
      sinkRate < 1.6 && plane.speed < 28 ? 'smooth' : sinkRate < 2.6 ? 'firm' : 'hard';
    if (quality === 'hard') plane.damage = Math.min(100, plane.damage + 18);
    plane.y = ground + 0.4;
    plane.landed = true;
    events.push({ type: 'touchdown', quality, sinkRate, speed: plane.speed });
    return;
  }

  // Anything else is a crash, and the readout says why.
  let reason;
  if (onStrip && headingErr >= 14) reason = 'You touched down across the runway, not along it.';
  else if (onStrip && sinkRate >= 3.4) reason = `You hit the strip at ${sinkRate.toFixed(1)} m/s down — far too hard.`;
  else if (onStrip && plane.speed >= 36) reason = 'You floated in far too fast and ran out of runway luck.';
  else if (ground <= 0.2) reason = 'You ditched in the sea. The mail is very wet.';
  else reason = 'You flew into the terrain. The hillside was not impressed.';
  plane.alive = false;
  plane.damage = 100;
  plane.y = ground + 0.4;
  events.push({ type: 'crash', reason });
}

// Smallest signed difference between two headings, in degrees (-180..180).
export function angleDiffDeg(a, b) {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
