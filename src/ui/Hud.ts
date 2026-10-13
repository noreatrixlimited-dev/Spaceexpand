import { CONFIG, PLAYER_COLORS } from '../config';
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
  private readonly countdownEl = $('countdown');
  private readonly ammo = $('ammo');
  private readonly ammoCap = $('ammoCap');
  private readonly throwBtn = $('throwBtn');
  private readonly comboEl = $('combo');
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
    this.power.classList.add('hidden');
    this.comboEl.innerHTML = '';
    this.boardTimer = 0;
    this.update(game, human, 1);
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

  update(game: Game, human: number | null, dt: number): void {
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
          ? '<span class="status">nest captured: you are out</span>'
          : core.state === 'carried'
            ? '<span class="status">your egg was stolen!</span>'
            : [0, 1, 2].map((i) => `<span class="heart${i < core.hearts ? '' : ' off'}"></span>`).join('');
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

  }
}
