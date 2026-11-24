/* ==========================================================================
   AFTERIMAGE — audio
   All music and effects are synthesised at runtime with WebAudio, so the build
   ships zero audio files and nothing has to be licensed.
   ========================================================================== */

const SCALES = [
  [0, 3, 5, 7, 10, 12, 15], // minor pentatonic + colour
  [0, 2, 3, 7, 8, 10, 12], // dorian-ish
  [0, 1, 5, 7, 8, 11, 12], // hirajoshi-ish
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.chapter = 0;
    this.nextNote = 0;
    this.step = 0;
    this.volume = 0.55;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.ctx.destination);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.5;
    this.musicBus.connect(this.master);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    // a soft plate reverb for the afterimages
    const len = this.ctx.sampleRate * 2.4;
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.verb = this.ctx.createConvolver();
    this.verb.buffer = buf;
    this.verbGain = this.ctx.createGain();
    this.verbGain.gain.value = 0.35;
    this.verb.connect(this.verbGain);
    this.verbGain.connect(this.master);

    this.nextNote = this.ctx.currentTime + 0.2;
    return this.ctx;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  setChapter(c) {
    this.chapter = c % SCALES.length;
  }

  /* ------------------------------------------------------------- music */

  noteFreq(semi, octave = 3) {
    return 55 * Math.pow(2, octave + semi / 12);
  }

  tick() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const spb = 60 / 82 / 2; // eighth notes at 82bpm
    while (this.nextNote < t + 0.25) {
      this.scheduleStep(this.nextNote, this.step);
      this.nextNote += spb;
      this.step++;
    }
  }

  scheduleStep(when, step) {
    const scale = SCALES[this.chapter];
    const bar = Math.floor(step / 8);

    // pad every bar
    if (step % 8 === 0) {
      const root = scale[bar % scale.length];
      this.pad(when, this.noteFreq(root, 2), 3.2);
      this.pad(when, this.noteFreq(root + 7, 2), 3.4, 0.6);
    }

    // arpeggio
    const pattern = [0, 2, 4, 2, 5, 4, 2, 1];
    if (step % 2 === 0 || Math.random() > 0.72) {
      const idx = pattern[step % pattern.length];
      const semi = scale[idx % scale.length] + (Math.floor(step / 8) % 2 === 0 ? 0 : 5);
      this.pluck(when, this.noteFreq(semi, 4), 0.22);
    }

    // sparse bass
    if (step % 8 === 0) this.pluck(when, this.noteFreq(scale[0], 1), 0.55, 0.5, 'triangle');
  }

  pad(when, freq, dur, gain = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.055 * gain, when + 0.6);
    g.gain.linearRampToValueAtTime(0, when + dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.6;
    g.connect(filter);
    filter.connect(this.musicBus);
    filter.connect(this.verb);
    for (const det of [-4, 4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(g);
      o.start(when);
      o.stop(when + dur + 0.05);
    }
  }

  pluck(when, freq, dur, gain = 0.16, type = 'sine') {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    o.connect(g);
    g.connect(this.musicBus);
    g.connect(this.verb);
    o.start(when);
    o.stop(when + dur + 0.02);
  }

  /* --------------------------------------------------------------- sfx */

  jump() {
    this.blip({ from: 320, to: 640, dur: 0.13, type: 'triangle', gain: 0.18 });
  }

  land(power = 0.5) {
    this.noise({ dur: 0.1, gain: 0.1 + power * 0.12, freq: 420, q: 0.8 });
    this.blip({ from: 150, to: 90, dur: 0.09, type: 'sine', gain: 0.1 });
  }

  death() {
    this.blip({ from: 260, to: 55, dur: 0.42, type: 'sawtooth', gain: 0.16 });
    this.noise({ dur: 0.3, gain: 0.14, freq: 900, q: 0.4 });
  }

  echo() {
    const t = this.ctx ? this.ctx.currentTime : 0;
    [0, 7, 12].forEach((s, i) => this.pluck(t + i * 0.045, this.noteFreq(s + 12, 4), 0.7, 0.12, 'triangle'));
  }

  win() {
    const t = this.ctx ? this.ctx.currentTime : 0;
    [0, 5, 7, 12, 15].forEach((s, i) => this.pluck(t + i * 0.085, this.noteFreq(s, 4), 1.1, 0.14, 'sine'));
  }

  ui() {
    this.blip({ from: 520, to: 760, dur: 0.06, type: 'sine', gain: 0.08 });
  }

  blip({ from, to, dur, type = 'sine', gain = 0.15 }) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g);
    g.connect(this.sfxBus);
    g.connect(this.verb);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise({ dur, gain, freq, q }) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxBus);
    src.start(t);
  }
}
