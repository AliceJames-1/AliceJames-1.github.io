/*
  Sound for the bay: a generative ambient soundtrack and a few effects, all made live with
  the Web Audio API (no audio files). Nothing plays until the visitor turns sound on or takes
  the controls; browsers do not allow sound before that.

  The music is slow pads over a four-chord loop in A major, a sparse plucked melody through
  an echo, and the surf rolling in and out. It never repeats exactly.
*/

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note number to Hz

// Chords as MIDI notes: Amaj9, F#m11, Dmaj9, Esus4
const CHORDS = [
  [33, 45, 49, 56, 59],
  [30, 42, 49, 52, 59],
  [38, 50, 54, 57, 64],
  [40, 52, 57, 59, 64]
];
// Melody notes that sit well over each chord (A major pentatonic, two octaves)
const SCALE = [64, 66, 69, 71, 73, 76, 78, 81, 83, 85];
const CHORD_SECONDS = 10;

export class Sound {
  constructor() {
    this.ctx = null;
    this.on = false;
    this.started = false;
    this.nextChord = 0;
    this.nextNote = 0;
    this.chordIndex = 0;
    this.timer = null;
    this.duck = 1;
  }

  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = this.ctx = new AC();

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // Reverb from a generated impulse: a few seconds of decaying noise
    const len = ctx.sampleRate * 3.2;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);

    // Echo for the melody
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const dtone = ctx.createBiquadFilter(); dtone.type = 'lowpass'; dtone.frequency.value = 2400;
    this.delay.connect(dtone).connect(fb).connect(this.delay);
    dtone.connect(this.master); dtone.connect(this.reverb);

    // Music bus (so effects stay audible when the music is ducked)
    this.music = ctx.createGain();
    this.music.gain.value = 0.9;
    this.music.connect(this.master);
    this.music.connect(this.reverb);

    // Pad filter with a slow sweep
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 700; this.padFilter.Q.value = 0.7;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.045;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 420;
    lfo.connect(lfoAmt).connect(this.padFilter.frequency); lfo.start();
    this.padFilter.connect(this.music);

    // Surf: low filtered noise that swells and recedes like waves on a beach
    const nlen = ctx.sampleRate * 4;
    const nb = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = nb; noise.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 520; nf.Q.value = 0.4;
    const nlfo = ctx.createOscillator(); nlfo.frequency.value = 0.11;
    const nlfoAmt = ctx.createGain(); nlfoAmt.gain.value = 300;
    nlfo.connect(nlfoAmt).connect(nf.frequency); nlfo.start();
    const ng = ctx.createGain(); ng.gain.value = 0.03;
    const swell = ctx.createOscillator(); swell.frequency.value = 0.11;
    const swellAmt = ctx.createGain(); swellAmt.gain.value = 0.026;
    swell.connect(swellAmt).connect(ng.gain); swell.start();
    noise.connect(nf).connect(ng).connect(this.music);
    noise.start();
    this.noiseBuffer = nb;
    return true;
  }

  /* Turn sound on or off. Returns the new state. */
  set(on) {
    if (on && !this.init()) return false;
    this.on = on;
    if (!this.ctx) return on;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.7 * this.duck : 0, t, on ? 1.2 : 0.25);
    if (on) {
      this.ctx.resume();
      if (!this.started) {
        this.started = true;
        this.nextChord = t + 0.1; this.nextNote = t + 2;
        this.timer = setInterval(() => this.schedule(), 200);
      }
    }
    return on;
  }

  /* Quieter when the forest scrolls out of view, silent when the tab is hidden */
  setDuck(level) {
    this.duck = level;
    if (this.ctx && this.on) this.master.gain.setTargetAtTime(0.7 * level, this.ctx.currentTime, 0.8);
  }
  suspend(yes) {
    if (!this.ctx) return;
    if (yes) this.ctx.suspend(); else if (this.on) this.ctx.resume();
  }

  schedule() {
    const ctx = this.ctx, ahead = ctx.currentTime + 0.6;
    while (this.nextChord < ahead) {
      this.pad(CHORDS[this.chordIndex], this.nextChord);
      this.chordIndex = (this.chordIndex + 1) % CHORDS.length;
      this.nextChord += CHORD_SECONDS;
    }
    while (this.nextNote < ahead) {
      if (Math.random() < 0.62) {
        const n = SCALE[Math.floor(Math.random() * SCALE.length)];
        this.pluck(NOTE(n), this.nextNote, 0.05 + Math.random() * 0.04);
      }
      this.nextNote += [0.6, 0.9, 1.2, 1.8][Math.floor(Math.random() * 4)];
    }
  }

  pad(notes, t) {
    const ctx = this.ctx, dur = CHORD_SECONDS + 3;
    notes.forEach((n, i) => {
      [-6, 6].forEach((cents) => {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'triangle' : 'sawtooth';
        o.frequency.value = NOTE(n);
        o.detune.value = cents;
        const g = ctx.createGain();
        const peak = (i === 0 ? 0.05 : 0.016);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 3);
        g.gain.setValueAtTime(peak, t + dur - 4);
        g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g).connect(this.padFilter);
        o.start(t); o.stop(t + dur + 0.1);
      });
    });
  }

  pluck(freq, t, vol, dest) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(g); o2.connect(g2).connect(g);
    g.connect(dest || this.music); g.connect(this.delay);
    o.start(t); o2.start(t); o.stop(t + 1.7); o2.stop(t + 1.7);
  }

  /* Effects */
  chime(step) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + 0.02;
    const base = 76 + Math.min(step, 6) * 2;
    [0, 4, 7, 12].forEach((iv, i) => this.pluck(NOTE(base + iv), t + i * 0.09, 0.12, this.master));
  }
  win() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.05;
    // A bright E major chord blooming over the loop, then a run up the scale
    [52, 59, 64, 68, 71, 76].forEach((n) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = NOTE(n);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(400, t); f.frequency.linearRampToValueAtTime(2600, t + 2.5);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + 0.8); g.gain.setTargetAtTime(0, t + 4, 1.2);
      o.connect(f).connect(g); g.connect(this.master); g.connect(this.reverb);
      o.start(t); o.stop(t + 9);
    });
    [64, 68, 71, 76, 80, 83, 88].forEach((n, i) => this.pluck(NOTE(n), t + 0.3 + i * 0.12, 0.1, this.master));
    this.music.gain.setTargetAtTime(0.35, t, 0.4);
    this.music.gain.setTargetAtTime(0.9, t + 7, 2);
  }
  whoosh() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2200, t + 1.4);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.7); g.gain.linearRampToValueAtTime(0, t + 1.6);
    s.connect(f).connect(g).connect(this.master);
    s.start(t); s.stop(t + 1.7);
  }
  /* Sonar ping when the sensor starts locking on to a boat */
  ping() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1480, t); o.frequency.exponentialRampToValueAtTime(1180, t + 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g); g.connect(this.master); g.connect(this.reverb);
    o.start(t); o.stop(t + 1);
  }
  /* The whale blowing at the surface */
  splash() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.7;
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(300, t + 1.4);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.14, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    s.connect(f).connect(g); g.connect(this.master); g.connect(this.reverb);
    s.start(t, Math.random() * 2); s.stop(t + 1.7);
  }
  bump() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.32);
  }
  firework() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + Math.random() * 900;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    s.connect(f).connect(g); g.connect(this.master); g.connect(this.reverb);
    s.start(t, Math.random() * 2); s.stop(t + 1.2);
  }
}
