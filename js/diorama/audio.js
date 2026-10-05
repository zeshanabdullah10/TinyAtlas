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
