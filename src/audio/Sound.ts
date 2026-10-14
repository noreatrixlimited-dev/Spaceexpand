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
  private noiseBuf: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private style: Style = STYLES[0];
  private calm = true;
  private hurry = false;
  private melody: number[] = [];
  private lastTrail = 0;
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

      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
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
      if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * o.slide), t + dur);
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

  /** FM bell / marimba: a sine carrier wobbled by a sine at a ratio, with a fast-fading index. */
  private bell(freq: number, dur: number, o: { vol?: number; delay?: number; ratio?: number; index?: number; pan?: number; dest?: AudioNode; wet?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq * (o.ratio ?? 3.5);
    const index = freq * (o.index ?? 1.4);
    mg.gain.setValueAtTime(index, t);
    mg.gain.exponentialRampToValueAtTime(Math.max(1, index * 0.05), t + dur * 0.6);
    mod.connect(mg);
    mg.connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol ?? 0.25, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g);
    let out: AudioNode = g;
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = o.pan;
      g.connect(p);
      out = p;
    }
    out.connect(o.dest ?? this.sfxGain);
    if (this.reverbIn && (o.wet ?? 0.3) > 0) {
      const s = ctx.createGain();
      s.gain.value = o.wet ?? 0.3;
      out.connect(s);
      s.connect(this.reverbIn);
    }
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
  }

  /** Filtered noise burst; `sweep` moves the filter over the sound (e.g. whooshes, splats). */
  private noise(dur: number, vol = 0.2, freq = 1200, o: { type?: BiquadFilterType; sweep?: number; delay?: number; q?: number; pan?: number; dest?: AudioNode; wet?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || !this.noiseBuf) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'lowpass';
    f.Q.value = o.q ?? 0.8;
    f.frequency.setValueAtTime(freq, t);
    if (o.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * o.sweep), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
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
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // ---------- effects ----------

  click(): void {
    this.tone(1100, 0.06, { type: 'sine', vol: 0.16, slide: 0.55 });
    this.noise(0.02, 0.05, 5000, { type: 'highpass' });
  }
  trail(): void {
    const now = performance.now();
    if (now - this.lastTrail < 70) return;
    this.lastTrail = now;
    this.tone(1500 + Math.random() * 400, 0.04, { type: 'sine', vol: 0.035 });
  }
  capture(size: number, chain = 0): void {
    // A rising marimba run in the island's key, longer for bigger grabs, plus a sparkle on top.
    // Grabs in quick succession climb higher each time (a combo you can hear).
    const notes = Math.min(7, 2 + Math.floor(size / 10));
    const scale = this.style.minor ? MINOR : MAJOR;
    const lift = Math.min(4, chain) * 2;
    if (chain > 0) this.tone(400, 0.25, { type: 'sine', vol: 0.12, slide: 3 + chain, wet: 0.2 });
    for (let i = 0; i < notes; i++) {
      const deg = [0, 2, 4, 7, 9, 11, 14][i] + lift;
      const n = this.style.root + 12 + scale[deg % 7] + 12 * Math.floor(deg / 7);
      this.bell(midi(n), 0.35, { vol: 0.16, delay: i * 0.055, ratio: 4, index: 0.9, pan: (i / notes - 0.5) * 0.6 });
    }
    this.bell(midi(this.style.root + 36), 0.6, { vol: 0.06, delay: notes * 0.055, ratio: 7.1, index: 0.6, wet: 0.6 });
  }
  bonk(): void {
    // cartoon "boing" with a thud
    this.tone(330, 0.5, { type: 'sine', vol: 0.28, slide: 0.45, vib: 0.08, vibRate: 18, wet: 0.15 });
    this.tone(660, 0.18, { type: 'triangle', vol: 0.08, slide: 0.4 });
    this.noise(0.12, 0.2, 700, { sweep: 0.3 });
  }
  squeak(): void {
    this.tone(1300, 0.11, { type: 'sine', vol: 0.13, slide: 1.9, vib: 0.03, vibRate: 30 });
  }
  heartLost(): void {
    // "uh-oh"
    this.tone(622, 0.2, { type: 'triangle', vol: 0.2, cutoff: 2200, slide: 0.97 });
    this.tone(466, 0.32, { type: 'triangle', vol: 0.2, cutoff: 1800, slide: 0.94, delay: 0.17, wet: 0.2 });
  }
  heartGained(): void {
    this.bell(midi(79), 0.3, { vol: 0.15, ratio: 3 });
    this.bell(midi(84), 0.45, { vol: 0.15, ratio: 3, delay: 0.09 });
  }
  private ride: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;

  /** Continuous board sound: a soft snowy hiss that swells when carving. */
  setRide(speed: number, carve: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain) return;
    if (!this.ride) {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = last * 0.92 + (Math.random() * 2 - 1) * 0.08; // brown-ish noise
        d[i] = last * 3;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);
      src.start();
      this.ride = { src, filter, gain };
    }
    const t = ctx.currentTime;
    this.ride.gain.gain.setTargetAtTime(speed * (0.045 + carve * 0.15), t, 0.08);
    this.ride.filter.frequency.setTargetAtTime(700 + carve * 1700 + speed * 300, t, 0.08);
  }

  /** Deep thump for land grabs; bigger grabs thump harder. */
  thump(power: number): void {
    this.tone(110, 0.3, { type: 'sine', vol: 0.3 + power * 0.25, slide: 0.4 });
    this.noise(0.09, 0.05 + power * 0.08, 500, { sweep: 0.4 });
  }
  heartbeat(intensity: number): void {
    this.tone(62, 0.14, { type: 'sine', vol: 0.2 + intensity * 0.2, slide: 0.7 });
    this.tone(56, 0.14, { type: 'sine', vol: 0.14 + intensity * 0.15, slide: 0.7, delay: 0.17 });
  }

  whoosh(): void {
    this.noise(0.24, 0.16, 600, { type: 'bandpass', sweep: 5, q: 1.4 });
    this.tone(380, 0.16, { type: 'sine', vol: 0.08, slide: 2 });
  }
  splat(mine: boolean): void {
    const v = mine ? 1 : 0.55;
    this.noise(0.26, 0.26 * v, 3200, { sweep: 0.12, q: 3, wet: 0.15 });
    this.tone(220, 0.2, { type: 'sine', vol: 0.3 * v, slide: 0.35 });
    this.tone(900, 0.06, { type: 'sine', vol: 0.08 * v, slide: 0.5, delay: 0.02 });
  }
  empty(): void {
    this.tone(180, 0.09, { type: 'square', vol: 0.05, cutoff: 900 });
    this.tone(150, 0.09, { type: 'square', vol: 0.05, cutoff: 900, delay: 0.08 });
  }
  steal(): void {
    // sneaky pizzicato steps down
    [84, 80, 77, 72].forEach((n, i) => this.tone(midi(n), 0.14, { type: 'triangle', vol: 0.14, cutoff: 3000, sweep: 0.3, delay: i * 0.07 }));
  }
  drop(): void {
    this.tone(260, 0.35, { type: 'sine', vol: 0.28, slide: 3.2, wet: 0.2 });
    this.noise(0.12, 0.1, 2400, { sweep: 0.3 });
  }
  /** Coin pickup / payout "ka-ching". */
  coin(): void {
    this.bell(midi(95), 0.12, { vol: 0.14, ratio: 2.01, index: 0.6 });
    this.bell(midi(100), 0.5, { vol: 0.16, ratio: 2.01, index: 0.6, delay: 0.07, wet: 0.4 });
  }
  /** Tiny tick while coins count up. */
  coinTick(): void {
    this.bell(midi(91 + Math.floor(Math.random() * 3)), 0.06, { vol: 0.06, ratio: 2.01, index: 0.4, wet: 0 });
  }
  /** Star k (0..2) popping in: each one higher and brighter. */
  star(k: number): void {
    const r = this.style.root + 24;
    this.bell(midi(r + [0, 4, 7][k]), 0.6, { vol: 0.18, ratio: 3, index: 1.2, wet: 0.5 });
    this.bell(midi(r + 12 + [0, 4, 7][k]), 0.4, { vol: 0.08, ratio: 5, index: 0.8, delay: 0.05, wet: 0.5 });
    this.noise(0.3, 0.04, 7000, { type: 'highpass', wet: 0.5 });
  }

  bigCapture(): void {
    this.duck(1.2);
    const r = this.style.root;
    [0, 4, 7, 12, 16].forEach((d, i) => this.bell(midi(r + 12 + d), 0.6, { vol: 0.15, delay: i * 0.07, ratio: 3, pan: (i - 2) * 0.2 }));
    this.noise(0.9, 0.05, 7000, { type: 'highpass', delay: 0.25, wet: 0.6 }); // shimmer
  }
  power(): void {
    for (let i = 0; i < 8; i++) this.bell(midi(76 + i * 2), 0.25, { vol: 0.1, delay: i * 0.035, ratio: 5, pan: (i % 2 ? 0.3 : -0.3) });
  }
  rumble(): void {
    this.noise(0.8, 0.22, 220, { sweep: 0.6 });
    this.tone(60, 0.7, { type: 'sine', vol: 0.3, slide: 0.6 });
  }
  countdown(final: boolean): void {
    if (final) {
      [0, 4, 7, 12].forEach((d) => this.tone(midi(this.style.root + 12 + d), 0.45, { type: 'triangle', vol: 0.12, cutoff: 4000, wet: 0.3 }));
      this.noise(0.3, 0.06, 6000, { type: 'highpass', wet: 0.4 });
    } else {
      this.tone(880, 0.08, { type: 'sine', vol: 0.18 }); // wood-block tick
      this.noise(0.03, 0.08, 2500, { type: 'bandpass', q: 4 });
    }
  }
  win(): void {
    this.duck(3);
    const r = this.style.root;
    // fanfare: chord stab, rising arpeggio, final big chord with shimmer
    [0, 4, 7].forEach((d) => this.tone(midi(r + d), 0.3, { type: 'sawtooth', vol: 0.06, cutoff: 2600, sweep: 0.5, detune: 9 }));
    [0, 4, 7, 12, 16, 19].forEach((d, i) => this.bell(midi(r + 12 + d), 0.4, { vol: 0.15, delay: 0.25 + i * 0.08, ratio: 3, pan: (i - 2.5) * 0.15 }));
    [0, 4, 7, 12].forEach((d) => this.tone(midi(r + d), 1.2, { type: 'sawtooth', vol: 0.06, cutoff: 3200, sweep: 0.4, detune: 9, delay: 0.8, wet: 0.4 }));
    this.noise(1.2, 0.05, 8000, { type: 'highpass', delay: 0.8, wet: 0.6 });
  }
  lose(): void {
    this.duck(2.5);
    // sad trombone-ish "wah wah wah wahhh"
    [67, 66, 65, 64].forEach((n, i) =>
      this.tone(midi(n - 12), i === 3 ? 0.9 : 0.3, { type: 'sawtooth', vol: 0.07, cutoff: 900, sweep: 0.6, delay: i * 0.32, vib: i === 3 ? 0.02 : 0, vibRate: 6, wet: 0.2 }),
    );
  }

  // ---------- music ----------

  /** Pick the tune for an island; `calm` is the gentle world-map version (no drums). */
  setMusicStyle(level: number, calm: boolean): void {
    const st = STYLES[level % STYLES.length];
    const changed = st !== this.style;
    this.style = st;
    this.calm = calm;
    this.hurry = false;
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

  private leading = false;
  /** While you're in 1st place, a sparkly extra layer joins the music. */
  setLeading(v: boolean): void {
    this.leading = v;
  }

  /** Speed up a little for the last seconds of a match. */
  setHurry(v: boolean): void {
    this.hurry = v;
  }

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
    const bpm = st.bpm * (this.calm ? 0.85 : 1) * (this.hurry ? 1.15 : 1);
    const stepDur = 60 / bpm / 2; // eighth notes
    const dest = this.musicGain;
    const scale = st.minor ? MINOR : MAJOR;
    const prog = st.minor ? PROG_MINOR : PROG_MAJOR;
    while (this.nextNoteTime < ctx.currentTime + 0.2) {
      const i = this.step % 64;
      const delay = Math.max(0, this.nextNoteTime - ctx.currentTime);
      const chordDeg = prog[Math.floor(i / 8) % 4];
      const chordRoot = st.root - 12 + scale[chordDeg % 7];

      // lead
      const n = this.melody[i];
      if (n > 0) {
        if (st.lead === 'bell') this.bell(midi(n + 12), 0.45, { vol: 0.32, delay, ratio: 3.5, index: 1.1, dest, wet: 0 });
        else if (st.lead === 'pluck') this.tone(midi(n + 12), 0.3, { type: 'triangle', vol: 0.34, cutoff: 3500, sweep: 0.25, delay, dest });
        else this.tone(midi(n + 12), 0.38, { type: 'sine', vol: 0.36, attack: 0.03, vib: 0.006, vibRate: 5, delay, dest });
      }
      // bass on beats, a bouncy octave on the "and" of 2 and 4
      if (i % 4 === 0) this.tone(midi(chordRoot - 12), 0.4, { type: 'triangle', vol: 0.5, cutoff: 700, delay, dest });
      else if (!this.calm && i % 4 === 3) this.tone(midi(chordRoot), 0.15, { type: 'triangle', vol: 0.22, cutoff: 900, delay, dest });
      // soft chord pad at the start of each bar
      if (i % 8 === 0) {
        const third = scale[(chordDeg + 2) % 7] + (chordDeg + 2 >= 7 ? 12 : 0);
        const fifth = scale[(chordDeg + 4) % 7] + (chordDeg + 4 >= 7 ? 12 : 0);
        for (const d of [0, third - scale[chordDeg % 7], fifth - scale[chordDeg % 7]])
          this.tone(midi(chordRoot + 12 + d), stepDur * 8, { type: 'sawtooth', vol: 0.05, attack: 0.15, cutoff: 1100, detune: 8, delay, dest });
      }
      // leader layer: a sparkly arpeggio on chord tones
      if (this.leading && !this.calm) {
        const arp = [0, 2, 4, 2][i % 4];
        const deg = chordDeg + arp;
        this.bell(midi(st.root + 24 + scale[deg % 7] + 12 * Math.floor(deg / 7)), 0.2, { vol: 0.08, ratio: 4, index: 0.6, delay, dest, wet: 0 });
      }
      // light drums during matches
      if (!this.calm) {
        if (i % 4 === 0) this.tone(120, 0.18, { type: 'sine', vol: 0.45, slide: 0.35, delay, dest }); // kick
        if (i % 8 === 4) this.noise(0.12, 0.16, 1800, { type: 'bandpass', q: 0.8, delay, dest }); // snare-ish clap
        if (i % 2 === 1 || this.hurry) this.noise(0.035, i % 2 ? 0.07 : 0.04, 8000, { type: 'highpass', delay, dest }); // hat
      }
      this.nextNoteTime += stepDur;
      this.step++;
    }
  }
}
