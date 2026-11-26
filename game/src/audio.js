// audio.js — a pocket WebAudio synth: engine growl, wind, and the little
// chimes that mark a ring, a landing and a wreck. No audio files; every
// sound is an oscillator or filtered noise, started on the first key press
// (browsers will not let a page make noise before a gesture).

export function createAudio() {
  let ctx = null;
  let engineOsc = null;
  let engineGain = null;
  let windGain = null;
  let muted = false;

  function start() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();

      // Engine: a low sawtooth whose pitch follows the throttle.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 52;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter).connect(engineGain).connect(ctx.destination);
      engineOsc.start();

      // Wind: looped noise through a band-pass, gain follows airspeed.
      const len = ctx.sampleRate * 1.5;
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 640;
      windFilter.Q.value = 0.6;
      windGain = ctx.createGain();
      windGain.gain.value = 0;
      noise.connect(windFilter).connect(windGain).connect(ctx.destination);
      noise.start();
    } catch {
      ctx = null; // no audio on this machine: fly silent
    }
  }

  // Called every frame while flying.
  function update(plane, flying) {
    if (!ctx || !engineOsc) return;
    const t = ctx.currentTime;
    const engineLevel = muted || !flying ? 0 : 0.05 + plane.throttle * 0.05;
    engineGain.gain.setTargetAtTime(engineLevel, t, 0.12);
    engineOsc.frequency.setTargetAtTime(46 + plane.throttle * 58 + plane.speed * 0.22, t, 0.1);
    const windLevel = muted || !flying ? 0 : Math.min(0.16, plane.speed / 72) * 0.14;
    windGain.gain.setTargetAtTime(windLevel, t, 0.2);
  }

  function blip(freq, dur, type = 'sine', gain = 0.12, when = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    start,
    update,
    ring() {
      blip(880, 0.16);
      blip(1318, 0.24, 'sine', 0.1, 0.07);
    },
    touchdown() {
      blip(196, 0.2, 'triangle', 0.16);
      blip(262, 0.3, 'triangle', 0.12, 0.09);
    },
    complete() {
      blip(523, 0.16);
      blip(659, 0.16, 'sine', 0.12, 0.12);
      blip(784, 0.3, 'sine', 0.12, 0.24);
    },
    crash() {
      blip(90, 0.5, 'sawtooth', 0.2);
      blip(55, 0.7, 'square', 0.14, 0.05);
    },
    setMuted(m) {
      muted = m;
      if (ctx && engineGain) engineGain.gain.value = 0;
    },
    get muted() {
      return muted;
    },
  };
}
