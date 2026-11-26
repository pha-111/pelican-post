// input.js — keyboard and mouse, gathered into one controls object the
// flight model reads each frame.
//
//   Arrows / WASD-style:  ↑ climb · ↓ descend · ← → bank
//   W / S or Shift / Ctrl: throttle up / down      Space: airbrake
//   Enter: start · next · restart                 P: pause    M: mute
// The mouse steers too: hold it away from screen centre to bank and pitch.

export function createInput() {
  const keys = new Set();
  const state = {
    // flight controls, rebuilt every frame by readControls
    pitch: 0,
    bank: 0,
    throttleDelta: 0,
    brake: false,
    // one-shot events, consumed by the game loop
    pressed: new Set(),
    mouse: { x: 0, y: 0, inside: false },
    muted: false,
  };

  const down = (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (!keys.has(e.code)) state.pressed.add(e.code);
    keys.add(e.code);
    if (e.code === 'KeyM') state.muted = !state.muted;
  };
  const up = (e) => keys.delete(e.code);
  const move = (e) => {
    state.mouse.x = e.clientX;
    state.mouse.y = e.clientY;
    state.mouse.inside = true;
  };

  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('mousemove', move);

  // Fill the continuous controls from whatever is held right now.
  // viewW/viewH are the canvas size, for the mouse dead-zone.
  function readControls(viewW, viewH) {
    let pitch = 0;
    let bank = 0;
    if (keys.has('ArrowUp')) pitch += 1;
    if (keys.has('ArrowDown')) pitch -= 1;
    if (keys.has('ArrowLeft')) bank -= 1;
    if (keys.has('ArrowRight')) bank += 1;

    if (state.mouse.inside && keys.size === 0) {
      const nx = (state.mouse.x / viewW) * 2 - 1;
      const ny = (state.mouse.y / viewH) * 2 - 1;
      if (Math.abs(nx) > 0.14) bank += nx * 0.9;
      if (Math.abs(ny) > 0.14) pitch += -ny * 0.8;
    }

    state.pitch = clamp(pitch, -1, 1);
    state.bank = clamp(bank, -1, 1);
    state.throttleDelta =
      (keys.has('KeyW') || keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0) -
      (keys.has('KeyS') || keys.has('ControlLeft') || keys.has('ControlRight') ? 1 : 0);
    state.brake = keys.has('Space');
    return state;
  }

  // Was this code newly pressed since the last call? (consumes it)
  function wasPressed(code) {
    if (state.pressed.has(code)) {
      state.pressed.delete(code);
      return true;
    }
    return false;
  }

  function clearPressed() {
    state.pressed.clear();
  }

  return { state, readControls, wasPressed, clearPressed };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
