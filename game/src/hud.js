// hud.js — the Pelican's instrument panel, drawn over the 3D view.
//
// Everything a real bush pilot glances at is here: airspeed, altitude and
// vertical speed on the left; a heading tape up top; an artificial horizon
// low on the left; throttle, fuel and damage on the right; the sortie
// card, score and a guide marker steering you to the next ring or the
// runway threshold. Warnings (STALL, LOW FUEL, PULL UP) shout in the
// middle, where they cannot be missed.

const INK = '#eaf4fb';
const DIM = 'rgba(234,244,251,0.62)';
const PANEL = 'rgba(9,17,25,0.58)';
const EDGE = 'rgba(255,255,255,0.28)';
const AMBER = '#ffc44d';
const RED = '#ff6a5e';
const GREEN = '#7be495';

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = PANEL;
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
}

function label(ctx, text, x, y, size = 11, color = DIM, align = 'left') {
  ctx.fillStyle = color;
  ctx.font = `600 ${size}px system-ui, 'Segoe UI', sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

function value(ctx, text, x, y, size = 21, color = INK, align = 'left') {
  ctx.fillStyle = color;
  ctx.font = `700 ${size}px ui-monospace, 'SF Mono', Menlo, monospace`;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

const KT = 1.94384; // m/s -> knots
const FT = 3.28084; // m -> feet

// view: { plane, score, elapsed, missionTitle, objective, targetScreen,
//         targetLabel, targetDist, flash }
export function drawHud(ctx, W, H, view, time) {
  const plane = view.plane;
  const headingDeg = ((plane.heading * 180) / Math.PI % 360 + 360) % 360;
  const agl = plane.y - view.groundBelow;

  // ---- left cluster: speed, altitude, vertical speed
  panel(ctx, 16, 16, 148, 104);
  label(ctx, 'AIRSPEED', 28, 38);
  value(ctx, `${Math.round(plane.speed * KT)}`, 28, 66, 26);
  label(ctx, 'KT', 92, 66, 12, INK);
  label(ctx, 'ALTITUDE', 28, 88);
  value(ctx, `${Math.round(plane.y * FT)}`, 28, 112, 17);
  label(ctx, 'FT', 96, 112, 11, INK);
  const vs = Math.round(plane.verticalSpeed * FT * 60);
  label(ctx, `${vs >= 0 ? '+' : '-'}${Math.abs(vs)}`, 150, 112, 12, vs < -700 ? RED : DIM, 'right');

  // ---- heading tape, top centre
  const tapeW = 300;
  const tapeX = W / 2 - tapeW / 2;
  panel(ctx, tapeX, 16, tapeW, 44);
  ctx.save();
  ctx.beginPath();
  ctx.rect(tapeX + 4, 18, tapeW - 8, 40);
  ctx.clip();
  const pxPerDeg = 3.4;
  const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  const firstTick = Math.ceil((headingDeg - 42) / 5) * 5;
  for (let a = firstTick; a <= headingDeg + 42; a += 5) {
    const deg = ((a % 360) + 360) % 360;
    const x = W / 2 + (a - headingDeg) * pxPerDeg;
    if (x < tapeX || x > tapeX + tapeW) continue;
    const major = deg % 45 === 0;
    ctx.strokeStyle = major ? INK : DIM;
    ctx.beginPath();
    ctx.moveTo(x, 52);
    ctx.lineTo(x, major ? 42 : 47);
    ctx.stroke();
    if (names[deg]) label(ctx, names[deg], x, 36, 13, AMBER, 'center');
    else if (deg % 30 === 0) label(ctx, `${deg / 10}`, x, 36, 11, DIM, 'center');
  }
  ctx.restore();
  ctx.fillStyle = AMBER;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 6, 60);
  ctx.lineTo(W / 2 + 6, 60);
  ctx.lineTo(W / 2, 66);
  ctx.closePath();
  ctx.fill();
  value(ctx, `${String(Math.round(headingDeg)).padStart(3, '0')}°`, W / 2, 84, 14, INK, 'center');

  // ---- right cluster: the sortie card and score
  panel(ctx, W - 268, 16, 252, 104);
  label(ctx, view.missionTitle.toUpperCase(), W - 252, 38, 11, AMBER);
  ctx.fillStyle = INK;
  ctx.font = `600 13px system-ui, 'Segoe UI', sans-serif`;
  ctx.textAlign = 'left';
  wrapText(ctx, view.objective, W - 252, 58, 220, 16, 2);
  label(ctx, 'SCORE', W - 252, 104);
  value(ctx, `${view.score}`, W - 196, 104, 16);
  label(ctx, formatTime(view.elapsed), W - 32, 104, 13, DIM, 'right');

  // ---- artificial horizon, low left
  drawHorizon(ctx, 74, H - 84, 56, plane);

  // ---- right low: throttle, fuel, damage
  const bx = W - 190;
  panel(ctx, bx, H - 118, 174, 102);
  label(ctx, 'THROTTLE', bx + 14, H - 94);
  bar(ctx, bx + 14, H - 88, 146, 9, plane.throttle, AMBER);
  if (view.brake) label(ctx, 'AIRBRAKE', bx + 160, H - 94, 10, RED, 'right');
  label(ctx, 'FUEL', bx + 14, H - 62);
  bar(ctx, bx + 14, H - 56, 146, 9, plane.fuel / 100, plane.fuel < 25 ? RED : GREEN);
  if (plane.damage > 1) {
    label(ctx, 'DAMAGE', bx + 14, H - 30);
    bar(ctx, bx + 14, H - 24, 146, 9, plane.damage / 100, RED);
  } else {
    label(ctx, 'AIRFRAME SOUND', bx + 14, H - 30, 10, GREEN);
  }

  // ---- warnings, centre
  const warnings = [];
  if (plane.engineOut) warnings.push(['ENGINE OUT — GLIDE!', RED]);
  else if (plane.stalled) warnings.push(['STALL', RED]);
  if (plane.fuel < 25 && plane.fuel > 0) warnings.push(['LOW FUEL', AMBER]);
  if (view.turbulence) warnings.push(['TURBULENCE', AMBER]);
  if (agl < 55 && plane.verticalSpeed < -6) warnings.push(['PULL UP', AMBER]);
  warnings.forEach(([text, color], i) => {
    if (color === RED && Math.sin(time * 9) < -0.25) return; // blink the red ones
    ctx.font = `800 24px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.fillText(text, W / 2, 128 + i * 30);
  });

  // ---- guide marker to the next objective
  if (view.targetScreen) {
    const t = view.targetScreen;
    const cx = Math.max(30, Math.min(W - 30, t.x));
    const cy = Math.max(96, Math.min(H - 30, t.y));
    const onScreen = !t.behind && t.x >= 0 && t.x <= W && t.y >= 0 && t.y <= H;
    ctx.strokeStyle = AMBER;
    ctx.lineWidth = 2;
    ctx.save();
    ctx.translate(cx, cy);
    if (!onScreen) {
      const ang = Math.atan2(cy - H / 2, cx - W / 2);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-6, -8);
      ctx.lineTo(-6, 8);
      ctx.closePath();
      ctx.fillStyle = AMBER;
      ctx.fill();
    } else {
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-9, -9, 18, 18);
    }
    ctx.restore();
    const labelX = Math.max(70, Math.min(W - 70, cx));
    label(ctx, `${view.targetLabel} ${formatDist(view.targetDist)}`, labelX, cy + 26, 12, AMBER, 'center');
  }

  // ---- centre flash (RING! +250)
  if (view.flash && view.flash.until > time) {
    const a = Math.min(1, (view.flash.until - time) / 0.5);
    ctx.globalAlpha = a;
    ctx.font = `800 30px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = view.flash.color || GREEN;
    ctx.fillText(view.flash.text, W / 2, H * 0.34);
    ctx.globalAlpha = 1;
  }
}

function drawHorizon(ctx, cx, cy, r, plane) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-plane.roll);
  const pitchPx = (plane.pitch * 180) / Math.PI * 2.1;
  ctx.translate(0, pitchPx);
  ctx.fillStyle = '#3f7fbf'; // sky
  ctx.fillRect(-r * 1.6, -r * 1.6, r * 3.2, r * 1.6);
  ctx.fillStyle = '#8a6b45'; // ground
  ctx.fillRect(-r * 1.6, 0, r * 3.2, r * 1.6);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  for (const p of [-20, -10, 10, 20]) {
    const y = -p * 2.1;
    const w = p % 20 === 0 ? 18 : 11;
    ctx.beginPath();
    ctx.moveTo(-w, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-r * 1.6, 0);
  ctx.lineTo(r * 1.6, 0);
  ctx.stroke();
  ctx.restore();
  // bezel and the fixed aircraft symbol
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = AMBER;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 26, cy);
  ctx.lineTo(cx - 8, cy);
  ctx.lineTo(cx, cy + 6);
  ctx.lineTo(cx + 8, cy);
  ctx.lineTo(cx + 26, cy);
  ctx.stroke();
  label(ctx, 'HORIZON', cx, cy + r + 14, 9, DIM, 'center');
}

function bar(ctx, x, y, w, h, frac, color) {
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);
  ctx.fill();
  if (frac > 0.005) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(6, w * Math.min(1, frac)), h, 4);
    ctx.fill();
  }
}

function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  const words = text.split(' ');
  let line = '';
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + lines * lineH);
      lines++;
      if (lines >= maxLines) return;
      line = word;
    } else {
      line = test;
    }
  }
  if (line && lines < maxLines) ctx.fillText(line, x, y + lines * lineH);
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDist(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

// ------------------------------------------------------------ full screens
// Title, pause, and the end-of-sortie cards. `lines` are [text, size, color]
// rows; the card is centred over a dimmed view of the world.
export function drawScreen(ctx, W, H, screen) {
  ctx.fillStyle = 'rgba(6,12,20,0.55)';
  ctx.fillRect(0, 0, W, H);
  const cardW = Math.min(620, W - 60);
  const cardH = screen.cardH || 430;
  const x = W / 2 - cardW / 2;
  const y = H / 2 - cardH / 2;
  ctx.fillStyle = 'rgba(10,20,32,0.88)';
  ctx.strokeStyle = EDGE;
  ctx.beginPath();
  ctx.roundRect(x, y, cardW, cardH, 14);
  ctx.fill();
  ctx.stroke();
  let cy = y + 58;
  for (const [text, size, color, weight] of screen.lines) {
    ctx.fillStyle = color || INK;
    ctx.font = `${weight || 700} ${size}px system-ui, 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(text, W / 2, cy);
    cy += size * 1.45;
  }
}
