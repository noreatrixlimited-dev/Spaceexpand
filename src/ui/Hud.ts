import * as THREE from 'three';
import { CONFIG, PLAYER_COLORS, PLAYER_COLORS_SOFT } from '../config';
import type { Game } from '../core/Game';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** In-game overlay: player list, timer, minimap, toasts, power-up and thief arrow. */
export class Hud {
  private readonly root = $('hud');
  private readonly players = $('players');
  private readonly timer = $('timer');
  private readonly power = $('power');
  private readonly toasts = $('toasts');
  private readonly arrow = $('thief-arrow');
  private readonly countdownEl = $('countdown');
  private readonly minimap = $<HTMLCanvasElement>('minimap');
  private readonly ammo = $('ammo');
  private readonly ammoCap = $('ammoCap');
  private readonly throwBtn = $('throwBtn');
  private readonly mm: CanvasRenderingContext2D;
  private rows: HTMLElement[] = [];
  private lastTimerText = '';
  private mmTimer = 0;

  constructor() {
    this.mm = this.minimap.getContext('2d')!;
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  build(game: Game, human: number | null): void {
    this.players.innerHTML = '';
    this.rows = game.players.map((p) => {
      const row = document.createElement('div');
      row.className = 'prow' + (p.id === human ? ' me' : '');
      row.innerHTML = `<span class="dot" style="background:${PLAYER_COLORS[p.id]}"></span>
        <span class="name">${p.id === human ? 'You' : p.name}</span>
        <span class="bar"><i style="background:${PLAYER_COLORS[p.id]};width:0%"></i></span>
        <span class="pct">0%</span>
        <span class="hearts"></span>`;
      this.players.appendChild(row);
      return row;
    });
    this.toasts.innerHTML = '';
    this.arrow.classList.add('hidden');
    this.power.classList.add('hidden');
    this.update(game, human, null, 1);
  }

  toast(text: string, big = false): void {
    const t = document.createElement('div');
    t.className = 'toast' + (big ? ' big' : '');
    t.textContent = text;
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => t.remove(), 2500);
  }

  countdown(text: string): void {
    this.countdownEl.innerHTML = text ? `<span>${text}</span>` : '';
  }

  update(game: Game, human: number | null, camera: THREE.Camera | null, dt: number): void {
    const playable = game.grid.size * game.grid.size;
    for (const p of game.players) {
      const row = this.rows[p.id];
      if (!row) continue;
      const pct = Math.round((game.land[p.id] / playable) * 100);
      (row.querySelector('.bar i') as HTMLElement).style.width = `${Math.min(100, pct * 2.5)}%`;
      (row.querySelector('.pct') as HTMLElement).textContent = `${pct}%`;
      const core = game.cores[p.id];
      const hearts = row.querySelector('.hearts') as HTMLElement;
      const key = `${core.state}:${core.hearts}:${p.status}`;
      if (hearts.dataset.k !== key) {
        hearts.dataset.k = key;
        if (core.state === 'captured') hearts.innerHTML = '<span class="status-ico">ghost</span>';
        else if (core.state === 'carried') hearts.innerHTML = '<span class="status-ico">stolen!</span>';
        else hearts.innerHTML = [0, 1, 2].map((i) => `<span class="heart${i < core.hearts ? '' : ' off'}"></span>`).join('');
      }
      row.classList.toggle('out', core.state === 'captured');
    }

    const left = Math.max(0, Math.ceil(CONFIG.matchSeconds - game.time));
    const text = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (text !== this.lastTimerText) {
      this.timer.textContent = text;
      this.timer.classList.toggle('hurry', left <= 15);
      this.lastTimerText = text;
    }

    if (human !== null) {
      const p = game.players[human];
      const ammo = p.status === 'shade' ? 0 : p.balls;
      if (this.ammo.textContent !== String(ammo)) this.ammo.textContent = String(ammo);
      const cap = `/${game.ballCap(human)}`;
      if (this.ammoCap.textContent !== cap) this.ammoCap.textContent = cap;
      this.throwBtn.classList.toggle('empty', ammo <= 0);
      if (p.power && p.powerTimer > 0) {
        this.power.classList.remove('hidden');
        this.power.textContent = p.power === 'speed' ? `Zoom! ${Math.ceil(p.powerTimer)}` : `Bubble shield ${Math.ceil(p.powerTimer)}`;
      } else if (game.voidFrozen > 0) {
        this.power.classList.remove('hidden');
        this.power.textContent = `Clouds frozen ${Math.ceil(game.voidFrozen)}`;
      } else this.power.classList.add('hidden');

      // Point at whoever is carrying my egg.
      const core = game.cores[human];
      if (camera && core.state === 'carried' && core.carrier >= 0) {
        const thief = game.players[core.carrier];
        const v = new THREE.Vector3(thief.x - game.grid.size / 2 + 0.5, 0.5, thief.y - game.grid.size / 2 + 0.5).project(camera);
        const w = window.innerWidth;
        const h = window.innerHeight;
        const onScreen = Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.85 && v.z < 1;
        this.arrow.classList.toggle('hidden', onScreen);
        if (!onScreen) {
          let x = v.x;
          let y = v.y;
          if (v.z > 1) {
            x = -x;
            y = -y;
          }
          const m = Math.max(Math.abs(x) / 0.85, Math.abs(y) / 0.8, 1);
          x /= m;
          y /= m;
          const sx = ((x + 1) / 2) * w;
          const sy = ((1 - y) / 2) * h;
          const ang = Math.atan2(-(y), x);
          this.arrow.style.left = `${sx}px`;
          this.arrow.style.top = `${sy}px`;
          (this.arrow.firstElementChild as HTMLElement).style.transform = `rotate(${ang + Math.PI / 2}rad)`;
        }
      } else this.arrow.classList.add('hidden');
    }

    this.mmTimer -= dt;
    if (this.mmTimer <= 0) {
      this.mmTimer = 0.2;
      this.drawMinimap(game, human);
    }
  }

  private drawMinimap(game: Game, human: number | null): void {
    const ctx = this.mm;
    const g = game.grid;
    const s = this.minimap.width / g.size;
    ctx.clearRect(0, 0, this.minimap.width, this.minimap.height);
    for (let y = 0; y < g.size; y++) {
      for (let x = 0; x < g.size; x++) {
        const i = g.idx(x, y);
        if (g.voided[i]) continue;
        const o = g.owner[i];
        const t = g.trail[i];
        ctx.fillStyle = t >= 0 ? PLAYER_COLORS[t] : o >= 0 ? PLAYER_COLORS_SOFT[o] : (x + y) % 2 ? '#fbe6c4' : '#fff4de';
        ctx.fillRect(x * s, y * s, s + 0.5, s + 0.5);
      }
    }
    for (const c of game.cores) {
      if (c.state !== 'nest') continue;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse((c.x + 0.5) * s, (c.y + 0.5) * s, s * 1.4, s * 1.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = PLAYER_COLORS[c.owner];
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (game.star.active) {
      ctx.fillStyle = '#ffc300';
      ctx.fillRect((game.star.x - 0.5) * s, (game.star.y - 0.5) * s, s * 2, s * 2);
    }
    for (const p of game.players) {
      ctx.globalAlpha = p.status === 'shade' ? 0.5 : 1;
      ctx.fillStyle = PLAYER_COLORS[p.id];
      ctx.strokeStyle = p.id === human ? '#2b2033' : '#fff';
      ctx.lineWidth = p.id === human ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc((p.x + 0.5) * s, (p.y + 0.5) * s, s * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
