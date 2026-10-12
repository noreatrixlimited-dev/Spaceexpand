// All sounds are synthesised with WebAudio, so the game ships with no audio files.

type Wave = OscillatorType;

const PENTA = [0, 2, 4, 7, 9]; // major pentatonic
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class Sound {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private melody: number[] = [];
  private lastTrail = 0;
  sfxOn = true;
  musicOn = true;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const master = this.ctx.createGain();
      master.gain.value = 0.8;
      master.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.connect(master);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.22;
      this.musicGain.connect(master);
      this.buildMelody();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.applyVolumes();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }
  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  applyVolumes(): void {
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxOn ? 1 : 0;
    if (this.musicGain) this.musicGain.gain.value = this.musicOn ? 0.22 : 0;
  }

  private tone(freq: number, dur: number, opts: { type?: Wave; vol?: number; slide?: number; delay?: number; attack?: number; dest?: AudioNode } = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain) return;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opts.slide), t + dur);
    const vol = opts.vol ?? 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (opts.attack ?? 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(opts.dest ?? this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol = 0.2, freq = 1200): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    src.start();
  }

  click(): void {
    this.tone(880, 0.07, { type: 'triangle', vol: 0.18, slide: 1.4 });
  }
  trail(): void {
    const now = performance.now();
    if (now - this.lastTrail < 70) return;
    this.lastTrail = now;
    this.tone(1200 + Math.random() * 300, 0.05, { type: 'sine', vol: 0.05 });
  }
  capture(size: number): void {
    const notes = Math.min(6, 2 + Math.floor(size / 12));
    for (let i = 0; i < notes; i++) this.tone(midi(72 + PENTA[i % 5] + 12 * Math.floor(i / 5)), 0.18, { type: 'triangle', vol: 0.2, delay: i * 0.06 });
    this.tone(220, 0.25, { type: 'sine', vol: 0.25, slide: 2.2 });
  }
  bonk(): void {
    this.tone(520, 0.35, { type: 'square', vol: 0.12, slide: 0.35 });
    this.tone(260, 0.3, { type: 'sine', vol: 0.3, slide: 0.5 });
    this.noise(0.15, 0.15, 900);
  }
  squeak(): void {
    this.tone(1400, 0.12, { type: 'sine', vol: 0.15, slide: 1.8 });
  }
  heartLost(): void {
    this.tone(660, 0.18, { type: 'triangle', vol: 0.22, slide: 0.6 });
    this.tone(440, 0.25, { type: 'triangle', vol: 0.2, slide: 0.6, delay: 0.12 });
  }
  heartGained(): void {
    this.tone(784, 0.12, { type: 'triangle', vol: 0.18 });
    this.tone(1046, 0.18, { type: 'triangle', vol: 0.18, delay: 0.09 });
  }
  whoosh(): void {
    this.noise(0.18, 0.12, 2400);
    this.tone(420, 0.16, { type: 'sine', vol: 0.12, slide: 1.8 });
  }
  splat(mine: boolean): void {
    this.noise(0.22, mine ? 0.22 : 0.12, 1100);
    this.tone(180, 0.22, { type: 'sine', vol: mine ? 0.3 : 0.15, slide: 0.5 });
  }
  empty(): void {
    this.tone(200, 0.08, { type: 'square', vol: 0.06 });
  }
  steal(): void {
    for (let i = 0; i < 4; i++) this.tone(midi(84 - i * 3), 0.12, { type: 'square', vol: 0.08, delay: i * 0.07 });
  }
  drop(): void {
    this.tone(300, 0.3, { type: 'sine', vol: 0.3, slide: 3 });
    this.noise(0.1, 0.1, 2000);
  }
  bigCapture(): void {
    [60, 64, 67, 72, 76].forEach((n, i) => this.tone(midi(n), 0.3, { type: 'triangle', vol: 0.2, delay: i * 0.08 }));
  }
  power(): void {
    for (let i = 0; i < 6; i++) this.tone(midi(76 + i * 2), 0.1, { type: 'sine', vol: 0.15, delay: i * 0.04 });
  }
  rumble(): void {
    this.noise(0.6, 0.18, 250);
    this.tone(70, 0.6, { type: 'sine', vol: 0.3, slide: 0.6 });
  }
  countdown(final: boolean): void {
    this.tone(final ? 1046 : 660, final ? 0.35 : 0.12, { type: 'triangle', vol: 0.22 });
  }
  win(): void {
    [60, 64, 67, 72, 67, 72, 76, 79].forEach((n, i) => this.tone(midi(n), 0.25, { type: 'triangle', vol: 0.22, delay: i * 0.11 }));
  }
  lose(): void {
    [67, 64, 60, 55].forEach((n, i) => this.tone(midi(n), 0.35, { type: 'triangle', vol: 0.2, delay: i * 0.18, slide: 0.97 }));
  }

  // ---------- music: a gentle looping xylophone tune ----------

  private buildMelody(): void {
    // Fixed pseudo-random tune so it's the same every time.
    let s = 7;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const bars = 8;
    for (let i = 0; i < bars * 8; i++) {
      if (i % 8 === 0 || r() > 0.32) {
        const deg = Math.floor(r() * 8);
        this.melody.push(72 + PENTA[deg % 5] + (deg >= 5 ? 12 : 0) - 12);
      } else this.melody.push(-1);
    }
  }

  startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.musicTimer = window.setInterval(() => this.schedule(), 50);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const stepDur = 60 / 112 / 2; // eighth notes at 112 bpm
    while (this.nextNoteTime < ctx.currentTime + 0.2) {
      const i = this.step % this.melody.length;
      const n = this.melody[i];
      const delay = this.nextNoteTime - ctx.currentTime;
      if (n > 0) {
        this.tone(midi(n), 0.35, { type: 'sine', vol: 0.5, delay, dest: this.musicGain });
        this.tone(midi(n + 12), 0.12, { type: 'triangle', vol: 0.12, delay, dest: this.musicGain });
      }
      if (i % 4 === 0) {
        const chord = [48, 45, 41, 43][Math.floor(i / 16) % 4];
        this.tone(midi(chord), 0.5, { type: 'triangle', vol: 0.35, delay, dest: this.musicGain });
      }
      if (i % 8 === 4) this.tone(midi(chord2(i)), 0.25, { type: 'sine', vol: 0.18, delay, dest: this.musicGain });
      this.nextNoteTime += stepDur;
      this.step++;
    }
  }
}

function chord2(i: number): number {
  return [64, 60, 65, 62][Math.floor(i / 16) % 4];
}
