// All sounds are synthesised with WebAudio, so the game ships with no audio files.
// Signal chain: voices -> sfx / music buses -> (dry + a soft room reverb) -> compressor -> speakers.

type Wave = OscillatorType;

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

interface Voice {
  type?: Wave;
  vol?: number;
  /** Pitch multiplier reached by the end (pitch glide). */
  slide?: number;
  delay?: number;
  attack?: number;
  /** Lowpass cutoff (Hz); with `sweep` it moves to cutoff * sweep. */
  cutoff?: number;
  sweep?: number;
  pan?: number;
  /** Second detuned oscillator (cents) for a fuller sound. */
  detune?: number;
  /** Vibrato depth (fraction of pitch) and rate (Hz). */
  vib?: number;
  vibRate?: number;
  dest?: AudioNode;
  /** Send to the reverb (0..1). */
  wet?: number;
}

/** One musical "style" per island, so every island has its own tune. */
interface Style {
  root: number; // midi note of the key
  bpm: number;
  minor: boolean;
  seed: number;
  lead: 'bell' | 'pluck' | 'flute';
}

const STYLES: Style[] = [
  { root: 60, bpm: 112, minor: false, seed: 3, lead: 'bell' }, // Clover Cove
  { root: 65, bpm: 120, minor: false, seed: 11, lead: 'bell' }, // Snowpuff Isle
  { root: 62, bpm: 116, minor: false, seed: 5, lead: 'pluck' }, // Honeydrop
  { root: 67, bpm: 124, minor: false, seed: 17, lead: 'flute' }, // Sugarloop
  { root: 57, bpm: 118, minor: true, seed: 23, lead: 'pluck' }, // Cocopop
  { root: 64, bpm: 108, minor: false, seed: 29, lead: 'flute' }, // Lilac Lagoon
  { root: 55, bpm: 128, minor: true, seed: 31, lead: 'pluck' }, // Ember Atoll
  { root: 63, bpm: 126, minor: false, seed: 41, lead: 'bell' }, // Starfall
];

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
// I - V - vi - IV (and i - VI - III - VII in minor), as scale degrees.
const PROG_MAJOR = [0, 4, 5, 3];
const PROG_MINOR = [0, 5, 2, 6];

export class Sound {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbIn: GainNode | null = null;
  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private style: Style = STYLES[0];
  private melody: number[] = [];
  sfxOn = true;
  musicOn = true;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 10;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      comp.connect(ctx.destination);
      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(comp);

      // Small, bright room: a few hundred ms of decaying stereo noise.
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.impulse(1.4, 3.2);
      this.reverbIn = ctx.createGain();
      this.reverbIn.gain.value = 1;
      const wetOut = ctx.createGain();
      wetOut.gain.value = 0.55;
      this.reverbIn.connect(this.reverb);
      this.reverb.connect(wetOut);
      wetOut.connect(master);

      this.sfxGain = ctx.createGain();
      this.sfxGain.connect(master);
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = 0.2;
      this.musicGain.connect(master);
      const musicSend = ctx.createGain();
      musicSend.gain.value = 0.35;
      this.musicGain.connect(musicSend);
      musicSend.connect(this.reverbIn);

      this.buildMelody();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.applyVolumes();
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }
  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  applyVolumes(): void {
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxOn ? 1 : 0;
    if (this.musicGain) this.musicGain.gain.value = this.musicOn ? 0.2 : 0;
  }

  // ---------- building blocks ----------

  /** A pitched voice: oscillator(s) -> optional lowpass -> envelope -> pan -> bus (+ reverb send). */
  private tone(freq: number, dur: number, o: Voice = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const g = ctx.createGain();
    const vol = o.vol ?? 0.3;
    const attack = o.attack ?? 0.006;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let head: AudioNode = g;
    if (o.cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 2;
      f.frequency.setValueAtTime(o.cutoff, t);
      if (o.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.cutoff * o.sweep), t + dur);
      f.connect(g);
      head = f;
    }
    const oscs: OscillatorNode[] = [];
    for (let k = 0; k < (o.detune ? 2 : 1); k++) {
      const osc = ctx.createOscillator();
      osc.type = o.type ?? 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.min(16000, Math.max(30, freq * o.slide)), t + dur);
      if (k === 1) osc.detune.value = o.detune!;
      if (o.vib) {
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = o.vibRate ?? 6;
        lg.gain.value = freq * o.vib;
        lfo.connect(lg);
        lg.connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + dur + 0.05);
      }
      osc.connect(head);
      oscs.push(osc);
    }
    let out: AudioNode = g;
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = o.pan;
      g.connect(p);
      out = p;
    }
    out.connect(o.dest ?? this.sfxGain);
    if (o.wet && this.reverbIn) {
      const s = ctx.createGain();
      s.gain.value = o.wet;
      out.connect(s);
      s.connect(this.reverbIn);
    }
    for (const osc of oscs) {
      osc.start(t);
      osc.stop(t + dur + 0.05);
    }
  }

  // ---------- effects: everything is a bubble ----------

  /**
   * One bubble "bloop": a sine whose pitch rises as the bubble closes (how real bubbles sound).
   * `step` picks the note in the island's pentatonic scale (higher = smaller bubble).
   */
  private bloop(step: number, vol = 0.5, delay = 0, len = 1): void {
    const steps = [0, 2, 4, 7, 9];
    const k = Math.max(-10, Math.min(19, Math.round(step)));
    const oct = Math.floor(k / 5);
    const n = this.style.root + 12 + steps[((k % 5) + 5) % 5] + oct * 12;
    const d = (0.06 + Math.max(0, 10 - k) * 0.008) * len;
    this.tone(midi(n), d, { type: 'sine', vol: 0.15 * vol, slide: 1.5, delay, attack: 0.004, pan: (Math.random() - 0.5) * 0.6, wet: 0.3 });
  }

  /** A run of bubbles: `from` to `to` scale steps, `gap` seconds apart. */
  private run(from: number, to: number, gap: number, vol = 0.5, delay = 0): void {
    const n = Math.abs(to - from);
    for (let i = 0; i <= n; i++) this.bloop(from + Math.sign(to - from) * i, vol, delay + i * gap);
  }

  /** A random bubble (used while moving and for clicks). `size` 0..1, bigger = lower. */
  bubble(size = 0.5, vol = 0.5, delay = 0): void {
    this.bloop(Math.round((1 - size) * 9 + Math.random() * 2), vol, delay);
  }

  /** A little cluster of random bubbles. */
  bubbles(count: number, vol = 0.6): void {
    for (let i = 0; i < count; i++) this.bubble(Math.random(), vol * (0.6 + Math.random() * 0.4), i * (0.03 + Math.random() * 0.05));
  }

  click(): void {
    this.bloop(8, 0.8);
  }
  trail(): void {
    // the moving bubble stream covers this
  }
  capture(size: number, chain = 0): void {
    // a rising run of bubbles, longer for bigger grabs and higher for combos
    const len = Math.min(7, 3 + Math.floor(size / 12));
    const base = 2 + Math.min(4, chain) * 2;
    this.run(base, base + len, 0.05, 0.8);
  }
  bonk(): void {
    // a big low bubble, then a few little ones scattering
    this.bloop(-5, 1.1, 0, 2.5);
    this.bubbles(4, 0.6);
  }
  squeak(): void {
    this.bloop(12, 0.7);
  }
  heartLost(): void {
    this.run(5, 1, 0.09, 0.8);
  }
  heartGained(): void {
    this.run(5, 9, 0.07, 0.7);
  }

  private bloopAt = 0;

  /** Moving: a stream of little bubble bloops (faster when turning). */
  setRide(speed: number, carve: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || speed <= 0.05) return;
    const now = ctx.currentTime;
    if (now >= this.bloopAt) {
      this.bubble(0.25 + Math.random() * 0.6, 0.35 + speed * 0.25 + carve * 0.2);
      this.bloopAt = now + (0.2 + Math.random() * 0.25) / (0.6 + speed * 0.3 + carve * 0.7);
    }
  }

  thump(power: number): void {
    this.bloop(-3, 0.5 + power * 0.5, 0.02, 2);
  }
  /** Trail in danger: two slow low bubbles. */
  heartbeat(intensity: number): void {
    this.bloop(-2, 0.4 + intensity * 0.3, 0, 2);
    this.bloop(-3, 0.3 + intensity * 0.3, 0.18, 2);
  }
  whoosh(): void {
    this.run(3, 7, 0.025, 0.6);
  }
  splat(mine: boolean): void {
    this.bubbles(mine ? 5 : 3, mine ? 0.8 : 0.45);
  }
  empty(): void {
    this.bloop(-4, 0.4);
  }
  steal(): void {
    this.run(9, 4, 0.07, 0.8);
  }
  drop(): void {
    this.run(2, 8, 0.04, 0.7);
  }
  coin(): void {
    this.bloop(12, 0.8);
    this.bloop(14, 0.8, 0.07);
  }
  coinTick(): void {
    this.bloop(10 + Math.floor(Math.random() * 3), 0.35);
  }
  star(k: number): void {
    this.run(7 + k * 2, 10 + k * 2, 0.05, 0.9);
  }
  bigCapture(): void {
    this.duck(1.2);
    this.run(0, 12, 0.04, 0.9);
  }
  power(): void {
    this.run(5, 15, 0.03, 0.7);
  }
  rumble(): void {
    for (let i = 0; i < 6; i++) this.bloop(-6 + Math.floor(Math.random() * 3), 0.6, i * 0.09, 2);
  }
  countdown(final: boolean): void {
    if (final) this.run(5, 10, 0.04, 0.9);
    else this.bloop(5, 0.8);
  }
  win(): void {
    this.duck(3);
    // a happy fountain of bubbles: up, up and up
    this.run(0, 10, 0.06, 0.9);
    this.run(5, 15, 0.06, 0.8, 0.7);
    this.bubbles(10, 0.7);
  }
  lose(): void {
    this.duck(2.5);
    // slow bubbles sinking down
    this.run(7, 0, 0.16, 0.7);
  }

  // ---------- music ----------

  /** Pick the tune for an island; the same plain music plays on the map and in matches. */
  setMusicStyle(level: number, _calm: boolean): void {
    const st = STYLES[level % STYLES.length];
    const changed = st !== this.style;
    this.style = st;
    if (changed) {
      this.buildMelody();
      this.step = 0;
    }
  }

  /** Dip the music so a big moment stands out, then bring it back. */
  private duck(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain || !this.musicOn) return;
    const g = this.musicGain.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.05, t, 0.05);
    g.setTargetAtTime(0.2, t + seconds, 0.6);
  }

  /** Kept for callers; the plain music doesn't react to danger or leading. */
  setTension(_v: number): void {}
  setLeading(_v: boolean): void {}

  /** Speed up a little for the last seconds of a match. */
  setHurry(_v: boolean): void {}

  private buildMelody(): void {
    // A fixed tune per island: mostly chord tones on strong beats, scale steps in between.
    let s = this.style.seed * 7919 + 13;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const scale = this.style.minor ? MINOR : MAJOR;
    const prog = this.style.minor ? PROG_MINOR : PROG_MAJOR;
    this.melody = [];
    let deg = 4;
    for (let i = 0; i < 64; i++) {
      const chord = prog[Math.floor(i / 8) % 4];
      const strong = i % 4 === 0;
      if (strong || r() > 0.4) {
        if (strong) deg = chord + [0, 2, 4][Math.floor(r() * 3)];
        else deg += r() < 0.5 ? 1 : -1;
        deg = Math.max(0, Math.min(11, deg));
        this.melody.push(this.style.root + scale[deg % 7] + 12 * Math.floor(deg / 7));
      } else this.melody.push(-1);
    }
    // the last bar resolves home
    this.melody[56] = this.style.root;
    for (let i = 57; i < 64; i++) this.melody[i] = -1;
  }

  startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.schedule(), 50);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const st = this.style;
    // Plain and soft: long held chords and a slow, gentle melody. Nothing percussive.
    const stepDur = 60 / (st.bpm * 0.7) / 2;
    const dest = this.musicGain;
    const scale = st.minor ? MINOR : MAJOR;
    const prog = st.minor ? PROG_MINOR : PROG_MAJOR;
    while (this.nextNoteTime < ctx.currentTime + 0.2) {
      const i = this.step % 64;
      const delay = Math.max(0, this.nextNoteTime - ctx.currentTime);
      const chordDeg = prog[Math.floor(i / 8) % 4];
      const chordRoot = st.root - 12 + scale[chordDeg % 7];
      // held chord for the whole bar, fading in and out
      if (i % 8 === 0) {
        const third = scale[(chordDeg + 2) % 7] + (chordDeg + 2 >= 7 ? 12 : 0) - scale[chordDeg % 7];
        const fifth = scale[(chordDeg + 4) % 7] + (chordDeg + 4 >= 7 ? 12 : 0) - scale[chordDeg % 7];
        const len = stepDur * 9;
        this.tone(midi(chordRoot - 12), len, { type: 'sine', vol: 0.22, attack: 0.8, delay, dest });
        for (const d of [0, third, fifth]) this.tone(midi(chordRoot + 12 + d), len, { type: 'sine', vol: 0.08, attack: 0.9, detune: 5, delay, dest });
      }
      // slow melody: only the strong notes, long and soft
      const n = this.melody[i];
      if (n > 0 && i % 2 === 0) this.tone(midi(n + 12), stepDur * 3.5, { type: 'sine', vol: 0.13, attack: 0.18, vib: 0.004, vibRate: 4.5, delay, dest });
      this.nextNoteTime += stepDur;
      this.step++;
    }
  }
}
