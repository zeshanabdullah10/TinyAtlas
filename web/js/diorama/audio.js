// Synthesised sound (no recordings): engine note that follows speed and gear, gravel crunch, knocks on big bumps,
// mountain wind, and water lapping near the lake. Starts on the first user gesture.
export class Sound {
  constructor() { this.on = false; this.ctx = null; this.muted = false; }
  start() {
    if (this.ctx) return;
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const out = this.out = C.createGain(); out.gain.value = this.muted ? 0 : 0.8; out.connect(C.destination);
    const noise = C.createBuffer(1, C.sampleRate * 2, C.sampleRate), d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loop = () => { const s = C.createBufferSource(); s.buffer = noise; s.loop = true; s.start(); return s; };
    // engine: two detuned saws through a soft clipper and a low-pass that opens with revs
    this.o1 = C.createOscillator(); this.o1.type = "sawtooth";
    this.o2 = C.createOscillator(); this.o2.type = "square";
    const shaper = C.createWaveShaper(), curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(2.4 * x); }
    shaper.curve = curve;
    this.eLP = C.createBiquadFilter(); this.eLP.type = "lowpass"; this.eLP.Q.value = 3;
    this.eG = C.createGain(); this.eG.gain.value = 0;
    const g2 = C.createGain(); g2.gain.value = 0.5;
    this.o1.connect(shaper); this.o2.connect(g2).connect(shaper); shaper.connect(this.eLP).connect(this.eG).connect(out);
    this.o1.start(); this.o2.start();
    // gravel
    this.gBP = C.createBiquadFilter(); this.gBP.type = "bandpass"; this.gBP.frequency.value = 1800; this.gBP.Q.value = 0.7;
    this.gG = C.createGain(); this.gG.gain.value = 0;
    loop().connect(this.gBP).connect(this.gG).connect(out);
    // wind
    this.wLP = C.createBiquadFilter(); this.wLP.type = "lowpass"; this.wLP.frequency.value = 500;
    this.wG = C.createGain(); this.wG.gain.value = 0.05;
    loop().connect(this.wLP).connect(this.wG).connect(out);
    // water
    this.lBP = C.createBiquadFilter(); this.lBP.type = "bandpass"; this.lBP.frequency.value = 650; this.lBP.Q.value = 0.9;
    this.lG = C.createGain(); this.lG.gain.value = 0;
    loop().connect(this.lBP).connect(this.lG).connect(out);
    this.noise = noise; this.t = 0; this.on = true;
  }
  mute(m) { this.muted = m; if (this.out) this.out.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.1); }
  knock(strength) {
    if (!this.on || strength < 0.25) return;
    strength = Math.min(strength, 1);
    const C = this.ctx, s = C.createBufferSource(), f = C.createBiquadFilter(), g = C.createGain();
    s.buffer = this.noise; f.type = "lowpass"; f.frequency.value = 260 + 300 * strength;
    g.gain.setValueAtTime(Math.min(strength, 1) * 0.55, C.currentTime); g.gain.exponentialRampToValueAtTime(0.001, C.currentTime + 0.22);
    s.connect(f).connect(g).connect(this.out); s.start(C.currentTime, Math.random()); s.stop(C.currentTime + 0.25);
  }
  /** A horn: a truck's two-tone "paa-paaa", a car's double beep, a motorbike's thin peep. */
  horn(kind = "car") {
    if (!this.on) return;
    const C = this.ctx, t0 = C.currentTime;
    const spec = { truck: [[196, 247], [[0, 0.35], [0.45, 1.1]], 0.16], car: [[415, 523], [[0, 0.16], [0.24, 0.42]], 0.1], bike: [[740, 880], [[0, 0.12], [0.18, 0.3]], 0.06] }[kind] || [[415, 523], [[0, 0.2]], 0.1];
    const [freqs, beats, vol] = spec;
    for (const [a, b] of beats) for (const f of freqs) {
      const o = C.createOscillator(), g = C.createGain(), lp = C.createBiquadFilter();
      o.type = "square"; o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.01);
      lp.type = "lowpass"; lp.frequency.value = 2200;
      g.gain.setValueAtTime(0.0001, t0 + a); g.gain.linearRampToValueAtTime(vol, t0 + a + 0.02);
      g.gain.setValueAtTime(vol, t0 + b - 0.03); g.gain.linearRampToValueAtTime(0.0001, t0 + b);
      o.connect(lp).connect(g).connect(this.out); o.start(t0 + a); o.stop(t0 + b + 0.05);
    }
  }
  /** one footstep on grass and gravel */
  step(loud = 1) {
    if (!this.on) return;
    const C = this.ctx, s = C.createBufferSource(), f = C.createBiquadFilter(), g = C.createGain(), t = C.currentTime;
    s.buffer = this.noise; f.type = "bandpass"; f.frequency.value = 900 + Math.random() * 700; f.Q.value = 0.8;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09 * loud, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.16);
    s.connect(f).connect(g).connect(this.out); s.start(t, Math.random()); s.stop(t + 0.2);
  }
  /** a short bird phrase: two to four rising and falling whistles */
  bird(near = 1) {
    if (!this.on) return;
    const C = this.ctx, t0 = C.currentTime, base = 2400 + Math.random() * 1800, n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const o = C.createOscillator(), g = C.createGain(), t = t0 + i * (0.11 + Math.random() * 0.06);
      o.type = "sine"; o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.4), t + 0.05);
      o.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.09);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.025 * near, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.12);
    }
  }
  /** a few distant hoof beats */
  hooves(near = 1) {
    if (!this.on) return;
    const C = this.ctx, t0 = C.currentTime;
    for (let i = 0; i < 8; i++) {
      const s = C.createBufferSource(), f = C.createBiquadFilter(), g = C.createGain(), t = t0 + i * 0.28 + (i % 2) * 0.09;
      s.buffer = this.noise; f.type = "bandpass"; f.frequency.value = 520; f.Q.value = 4;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 * near, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      s.connect(f).connect(g).connect(this.out); s.start(t, Math.random()); s.stop(t + 0.09);
    }
  }
  /** engine: 0..1 (idle off), speed m/s, throttle 0..1, rough 0..1, wind 0..1, water 0..1 */
  update(dt, { engine, speed, throttle, rough, wind, water }) {
    if (!this.on) return;
    const now = this.ctx.currentTime, T = 0.08;
    this.t += dt;
    const gear = Math.min(Math.floor(speed / 2.6), 3), inGear = (speed - gear * 2.6) / 2.6;
    const rpm = 850 + (engine ? (gear === 3 ? Math.min(speed / 9.5, 1) : inGear) * 2300 + throttle * 300 : 0);
    const f = rpm / 60 * 2;                       // four-cylinder firing frequency
    this.o1.frequency.setTargetAtTime(f, now, T); this.o2.frequency.setTargetAtTime(f * 0.5 * 1.01, now, T);
    this.eLP.frequency.setTargetAtTime(220 + rpm * 0.35 + throttle * 400, now, T);
    this.eG.gain.setTargetAtTime(engine ? 0.09 + throttle * 0.07 : 0, now, 0.3);
    this.gG.gain.setTargetAtTime(Math.min(speed / 9, 1) * (0.06 + rough * 0.18), now, T);
    this.wG.gain.setTargetAtTime(0.03 + wind * 0.08 + Math.min(speed / 9, 1) * 0.04, now, 0.5);
    this.wLP.frequency.setTargetAtTime(380 + 260 * Math.sin(this.t * 0.37) + 120 * Math.sin(this.t * 1.1), now, 0.3);
    this.lG.gain.setTargetAtTime(water * (0.05 + 0.04 * Math.sin(this.t * 1.7) * Math.sin(this.t * 0.6)), now, 0.2);
  }
}
