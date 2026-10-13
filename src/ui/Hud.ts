import * as THREE from 'three';
import { CONFIG, PLAYER_COLORS, UNIT } from '../config';
import type { Game } from '../core/Game';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Paper.io-style overlay: live leaderboard, your big %, timer, event feed and throw button. */
export class Hud {
  private readonly root = $('hud');
  private readonly board = $('leaderboard');
  private readonly mePct = $('mePct');
  private readonly meHearts = $('meHearts');
  private readonly meBox = $('me');
  private readonly timer = $('timer');
  private readonly power = $('power');
  private readonly toasts = $('toasts');
  private readonly arrow = $('thief-arrow');
  private readonly countdownEl = $('countdown');
  private readonly ammo = $('ammo');
  private readonly ammoCap = $('ammoCap');
  private readonly throwBtn = $('throwBtn');
  private readonly gainEl = $('gain');
  private readonly comboEl = $('combo');
  private gainTimer = 0;
  private rows: HTMLElement[] = [];
  private lastTimerText = '';
  private boardTimer = 0;

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  build(game: Game, human: number | null): void {
    this.board.innerHTML = '';
    this.rows = game.players.map((p) => {
      const row = document.createElement('div');
      row.className = 'lb-row' + (p.id === human ? ' me' : '');
      row.style.setProperty('--c', PLAYER_COLORS[p.id]);
      row.innerHTML = `<i class="fill"></i><span class="rank"></span><span class="name">${p.id === human ? 'You' : p.name}</span><span class="tag"></span><span class="pct"></span>`;
      this.board.appendChild(row);
      return row;
    });
    if (human !== null) this.meBox.style.setProperty('--c', PLAYER_COLORS[human]);
    this.meBox.classList.toggle('hidden', human === null);
    this.toasts.innerHTML = '';
    this.arrow.classList.add('hidden');
    this.power.classList.add('hidden');
    this.gainEl.classList.add('hidden');
    this.comboEl.innerHTML = '';
    this.boardTimer = 0;
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

  /** Big centre pop for combos ("Double grab!"). */
  combo(text: string, color: string): void {
    const el = document.createElement('div');
    el.className = 'combo-pop';
    el.style.setProperty('--c', color);
    el.textContent = text;
    this.comboEl.appendChild(el);
    while (this.comboEl.children.length > 2) this.comboEl.firstElementChild?.remove();
    window.setTimeout(() => el.remove(), 1500);
  }

  countdown(text: string): void {
    this.countdownEl.innerHTML = text ? `<span>${text}</span>` : '';
  }

  update(game: Game, human: number | null, camera: THREE.Camera | null, dt: number): void {
    // Leaderboard: rows slide into rank order; bar width = share of the island.
    this.boardTimer -= dt;
    if (this.boardTimer <= 0) {
      this.boardTimer = 0.25;
      const order = [0, 1, 2, 3].sort((a, b) => game.land[b] - game.land[a]);
      const top = Math.max(1, game.percent(order[0]));
      order.forEach((id, rank) => {
        const row = this.rows[id];
        if (!row) return;
        const pct = game.percent(id);
        const core = game.cores[id];
        row.style.transform = `translateY(${rank * 100}%)`;
        (row.querySelector('.rank') as HTMLElement).textContent = `${rank + 1}`;
        (row.querySelector('.pct') as HTMLElement).textContent = `${pct.toFixed(1)}%`;
        (row.querySelector('.fill') as HTMLElement).style.width = `${Math.max(6, (pct / top) * 100)}%`;
        const tag = core.state === 'captured' ? 'ghost' : core.state === 'carried' ? 'egg stolen' : '';
        const tagEl = row.querySelector('.tag') as HTMLElement;
        if (tagEl.textContent !== tag) tagEl.textContent = tag;
        row.classList.toggle('out', core.state === 'captured');
      });
    }

    const left = Math.max(0, Math.ceil(CONFIG.matchSeconds - game.time));
    const text = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (text !== this.lastTimerText) {
      this.timer.textContent = text;
      this.timer.classList.toggle('hurry', left <= 15);
      this.lastTimerText = text;
    }

    if (human === null) return;
    const p = game.players[human];
    const pctText = `${game.percent(human).toFixed(1)}%`;
    if (this.mePct.textContent !== pctText) this.mePct.textContent = pctText;
    const core = game.cores[human];
    const key = `${core.state}:${core.hearts}`;
    if (this.meHearts.dataset.k !== key) {
      this.meHearts.dataset.k = key;
      this.meHearts.innerHTML =
        core.state === 'captured'
          ? '<span class="status">ghost: touch a nest!</span>'
          : core.state === 'carried'
            ? '<span class="status">your egg was stolen!</span>'
            : [0, 1, 2].map((i) => `<span class="heart${i < core.hearts ? '' : ' off'}"></span>`).join('');
    }

    // Live "+x%" over your robot: what closing the loop right now would earn.
    this.gainTimer -= dt;
    if (this.gainTimer <= 0) {
      this.gainTimer = 0.3;
      const gain = p.status === 'alive' ? game.previewGain(human) : 0;
      const pct = (gain / game.totalCells) * 100;
      this.gainEl.classList.toggle('hidden', gain <= 0);
      if (gain > 0) {
        this.gainEl.textContent = `+${pct < 1 ? pct.toFixed(1) : pct.toFixed(0)}%`;
        this.gainEl.classList.toggle('juicy', pct >= 3);
      }
    }
    if (camera && !this.gainEl.classList.contains('hidden')) {
      const v = new THREE.Vector3((p.px - game.grid.size / 2) / UNIT, 2.3, (p.py - game.grid.size / 2) / UNIT).project(camera);
      this.gainEl.style.left = `${((v.x + 1) / 2) * window.innerWidth}px`;
      this.gainEl.style.top = `${((1 - v.y) / 2) * window.innerHeight}px`;
    }

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
    if (camera && core.state === 'carried' && core.carrier >= 0) {
      const thief = game.players[core.carrier];
      const v = new THREE.Vector3((thief.px - game.grid.size / 2) / UNIT, 0.5, (thief.py - game.grid.size / 2) / UNIT).project(camera);
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
        this.arrow.style.left = `${((x + 1) / 2) * w}px`;
        this.arrow.style.top = `${((1 - y) / 2) * h}px`;
        (this.arrow.firstElementChild as HTMLElement).style.transform = `rotate(${Math.atan2(-y, x) + Math.PI / 2}rad)`;
      }
    } else this.arrow.classList.add('hidden');
  }
}
