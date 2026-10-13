import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './style.css';

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

import { Bots } from './ai/Bot';
import { Director, pickMood } from './ai/Director';
import { Sound } from './audio/Sound';
import { CONFIG, PLAYER_COLORS, UNIT, type MatchOptions } from './config';
import { MAPS } from './maps';
import { Game, type GameEvent } from './core/Game';
import { Input } from './input/Input';
import { loadArt } from './render/Scenery';
import { World } from './render/World';
import { Hud } from './ui/Hud';
import { Store } from './ui/Store';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type Phase = 'menu' | 'countdown' | 'playing' | 'paused' | 'over';

const store = new Store();
const sound = new Sound();
const world = new World($<HTMLCanvasElement>('scene'), store.settings.quality);
const hud = new Hud();
const input = new Input($('scene'), $('dpad'), $('joy'), $('throwBtn'));

let game: Game;
let director: Director | null = null;
let combo = { lastCapture: -99, bonkedBy: -1, bonkedAt: -99, cuts: 0 };
let heartbeatTimer = 0;
let replayLeft = -1;
let smoothDt = 1 / 60;
let humanOut = false; // your nest fell: you watch the rest of the match
let phase: Phase = 'menu';
let human: number | null = null;
let accumulator = 0;
let countdownLeft = 0;
let overTimer = 0;
let lastTick = 0;

// ---------- screens ----------

const screens = ['title', 'howto', 'settings', 'pause', 'results'] as const;
type Screen = (typeof screens)[number];
let returnTo: Screen = 'title';

function showScreen(name: Screen | null): void {
  for (const s of screens) $(s).classList.toggle('hidden', s !== name);
}

function buildLogo(): void {
  const logo = $('logo');
  const colors = [...PLAYER_COLORS, '#ffb703', '#ff8fb1'];
  logo.innerHTML = [...'Nestnappers']
    .map((ch, i) => `<span style="color:${colors[i % colors.length]};animation-delay:${i * 0.08}s">${ch}</span>`)
    .join('');
}

const MAP_ICONS: Record<string, string> = {
  circle: '<circle cx="22" cy="22" r="18"/>',
  roundSquare: '<rect x="4" y="4" width="36" height="36" rx="10"/>',
  hexagon: '<polygon points="40,22 31,37.6 13,37.6 4,22 13,6.4 31,6.4"/>',
};

function buildMapPicker(): void {
  const wrap = $('maps');
  wrap.innerHTML = '';
  for (const m of MAPS) {
    const b = document.createElement('button');
    b.className = 'map-card' + (store.settings.map === m.id ? ' selected' : '');
    b.style.setProperty('--mc', m.theme.ui);
    b.innerHTML = `<svg viewBox="0 0 44 44" fill="${m.theme.slabTop}" stroke="${m.theme.ui}" stroke-width="3">${MAP_ICONS[m.shape]}</svg>${m.name}`;
    b.onclick = () => {
      sound.unlock();
      sound.click();
      store.settings.map = m.id;
      store.save();
      buildMapPicker();
      if (phase === 'menu') newGame(null); // show the chosen map behind the menu
    };
    wrap.appendChild(b);
  }
}

function buildColorPicker(): void {
  const wrap = $('colors');
  wrap.innerHTML = '';
  PLAYER_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'chip' + (store.settings.slot === i ? ' selected' : '');
    b.style.background = c;
    b.setAttribute('aria-label', `Blob ${i + 1}`);
    b.onclick = () => {
      sound.unlock();
      sound.click();
      store.settings.slot = i;
      store.save();
      buildColorPicker();
buildMapPicker();
    };
    wrap.appendChild(b);
  });
}


function updateStatsLine(): void {
  const s = store.stats;
  $('statsLine').textContent = s.games
    ? `Wins ${s.wins} / ${s.games} games  ·  Best land ${s.bestLandPct}%  ·  Eggs nabbed ${s.eggsCaptured}`
    : 'Tip: drag to ride, tap to throw!';
}

function syncSettingsUI(): void {
  const s = store.settings;
  const map: Record<string, boolean> = {
    music: s.music,
    sfx: s.sfx,
    vibrate: s.vibrate,
    dpad: s.controls === 'dpad',
    quality: s.quality === 'high',
    hardMode: s.hardMode,
    startMode: s.startMode === 'quadrant',
  };
  document.querySelectorAll<HTMLInputElement>('[data-s]').forEach((el) => {
    el.checked = map[el.dataset.s!];
  });
}

function applySettings(): void {
  sound.musicOn = store.settings.music;
  sound.sfxOn = store.settings.sfx;
  sound.applyVolumes();
  $('dpad').classList.toggle('hidden', store.settings.controls !== 'dpad' || phase === 'menu');
}

// ---------- matches ----------

function newGame(humanSlot: number | null, tutorial = false): void {
  const opts: MatchOptions = {
    tutorial,
    map: store.settings.map,
    startMode: store.settings.startMode,
    hardMode: store.settings.hardMode,
    humanSlot,
    difficulty: 'normal',
    seed: (Math.random() * 1e9) | 0,
  };
  game = new Game(opts);
  director = null;
  if (!tutorial) {
    const bots = new Bots(game, 0.5);
    // No difficulty menu: the director picks how kind the bots are from recent results.
    if (humanSlot !== null) director = new Director(game, bots, humanSlot, pickMood(store.stats.recent));
  }
  combo = { lastCapture: -99, bonkedBy: -1, bonkedAt: -99, cuts: 0 };
  humanOut = false;
  hud.setSpectating(false);
  if (!tutorial) {
    tutorialStep = -1;
    coach.classList.add('hidden');
  }
  replayLeft = -1;
  human = humanSlot;
  world.setGame(game);
  world.mode = humanSlot === null ? 'orbit' : 'follow';
  world.followId = humanSlot ?? 0;
  hud.build(game, humanSlot);
  accumulator = 0;
}

function startAttract(): void {
  phase = 'menu';
  input.enabled = false;
  newGame(null);
  hud.show(false);
  applySettings();
  updateStatsLine();
  showScreen('title');
}

function startMatch(): void {
  sound.unlock();
  sound.startMusic();
  newGame(store.settings.slot);
  world.startSwoop();
  showScreen(null);
  hud.show(true);
  phase = 'countdown';
  countdownLeft = 3.2;
  lastTick = 4;
  input.enabled = true;
  input.reset();
  applySettings();
}

// ---------- guided first ride ----------

let tutorialStep = -1;
let tutorialTimer = 0;
const coach = $('coach');
const coachText = coach.querySelector('.coach-text') as HTMLElement;
const coachFinger = coach.querySelector('.coach-finger') as HTMLElement;

function setCoach(text: string, finger: 'drag' | 'tap' | 'none'): void {
  coachText.textContent = text;
  // restart the pop animation
  coachText.style.animation = 'none';
  void coachText.offsetWidth;
  coachText.style.animation = '';
  coachFinger.style.display = finger === 'none' ? 'none' : '';
  coachFinger.classList.toggle('tap', finger === 'tap');
}

function startTutorial(): void {
  sound.unlock();
  sound.startMusic();
  newGame(store.settings.slot, true);
  showScreen(null);
  hud.show(true);
  phase = 'playing';
  input.enabled = true;
  input.reset();
  applySettings();
  tutorialStep = 0;
  tutorialTimer = 0;
  coach.classList.remove('hidden');
  setCoach('Drag to ride out!', 'drag');
}

function endTutorial(): void {
  tutorialStep = -1;
  coach.classList.add('hidden');
  store.settings.tutorialDone = true;
  store.save();
  startMatch();
}

/** Advance the first ride from what the player actually does. */
function tutorialProgress(events: GameEvent[]): void {
  if (tutorialStep < 0 || human === null) return;
  const me = game.players[human];
  if (tutorialStep === 0 && me.trail.length >= 4 * UNIT) {
    tutorialStep = 1;
    setCoach('Now ride back to your colour!', 'none');
  }
  for (const e of events) {
    if (tutorialStep === 1 && e.type === 'capture' && e.pid === human) {
      tutorialStep = 2;
        me.balls = Math.max(me.balls, 3);
      hud.combo('Land grabbed!', PLAYER_COLORS[human]);
      setCoach('Tap to throw a paint ball!', 'tap');
    } else if (tutorialStep === 2 && e.type === 'throw' && e.pid === human) {
      tutorialStep = 3;
      tutorialTimer = 1.6;
      setCoach('Splat! Balls paint land and stun riders.', 'none');
    }
  }
}

function tutorialTick(dt: number): void {
  if (tutorialStep < 3) return;
  tutorialTimer -= dt;
  if (tutorialTimer > 0) return;
  if (tutorialStep === 3) {
    tutorialStep = 4;
    tutorialTimer = 2.2;
    setCoach('Now grab the island and steal their eggs!', 'none');
  } else endTutorial();
}

$('spectateSkip').onclick = () => {
  sound.click();
  if (humanOut && phase === 'playing') onGameOver(game.leader(), 'captured');
};
$('coachSkip').onclick = () => {
  sound.click();
  endTutorial();
};

function pause(): void {
  if (phase !== 'playing' && phase !== 'countdown') return;
  phase = 'paused';
  showScreen('pause');
}

function resume(): void {
  if (phase !== 'paused') return;
  phase = game.time > 0 ? 'playing' : 'countdown';
  showScreen(null);
}

function vibrate(ms: number): void {
  if (store.settings.vibrate && navigator.vibrate) navigator.vibrate(ms);
}

function nameOf(id: number): string {
  return id === human ? 'You' : game.players[id].name;
}

function handleEvents(events: GameEvent[]): void {
  world.handleEvents(events, human);
  if (phase === 'menu') return; // attract mode is silent
  tutorialProgress(events);
  const me = human;
  for (const e of events) {
    switch (e.type) {
      case 'trail':
        if (e.pid === me) sound.trail();
        break;
      case 'capture':
        if (e.pid === me) {
          const pct = (e.cells.length / game.totalCells) * 100;
          sound.capture(e.cells.length / (UNIT * UNIT));
          sound.thump(Math.min(1, pct / 6));
          world.kickCamera(Math.min(1, 0.25 + pct / 6));
          vibrate(pct >= 3 ? 60 : 20);
          if (game.time - combo.lastCapture < 6) hud.combo('Double grab!', '#ff9f1c');
          else if (pct >= 4) hud.combo(`Huge grab! +${pct.toFixed(0)}%`, PLAYER_COLORS[me]);
          combo.lastCapture = game.time;
        }
        break;
      case 'bonk':
        if (e.victim === me) {
          sound.bonk();
          vibrate(120);
          hud.toast(e.by === me ? 'Oops! Bonked by your own trail' : e.by === e.victim ? 'Swallowed by the clouds!' : `${nameOf(e.by)} cut your trail!`);
          if (e.by !== me && e.by !== e.victim) {
            combo.bonkedBy = e.by;
            combo.bonkedAt = game.time;
          }
        } else if (e.by === me) {
          sound.squeak();
          vibrate(30);
          store.stats.trailsCut++;
          combo.cuts++;
          if (e.victim === combo.bonkedBy && game.time - combo.bonkedAt < 25) {
            hud.combo('Revenge!', '#e8436f');
            combo.bonkedBy = -1;
          } else if (combo.cuts === 3) hud.combo('Trail hunter!', '#7048e8');
          else hud.toast(`You bonked ${nameOf(e.victim)}!`);
        }
        break;
      case 'shielded':
        if (e.pid === me) hud.toast('Shield saved you!');
        sound.squeak();
        break;
      case 'coreHit':
        if (e.owner === me) {
          sound.heartLost();
          vibrate(60);
          hud.toast(`${nameOf(e.by)} is attacking your egg!`);
        } else if (e.by === me) sound.heartLost();
        break;
      case 'heartRegen':
        if (e.owner === me) sound.heartGained();
        break;
      case 'coreStolen':
        sound.steal();
        if (e.owner === me) {
          vibrate(200);
          hud.toast(`${nameOf(e.by)} stole your egg! Bump them!`, true);
        } else if (e.by === me) {
          hud.combo('Egg grabbed!', '#f08c00');
          hud.toast('Ride to your colour to keep it!');
        } else hud.toast(`${nameOf(e.by)} nabbed ${nameOf(e.owner)}'s egg!`);
        break;
      case 'eggDropped':
        sound.drop();
        if (e.owner === me) hud.toast('Your egg is safe again!');
        else if (e.carrier === me) hud.toast('You dropped the egg!');
        else if (e.by === me) hud.toast('Egg sent home!');
        break;
      case 'coreCaptured':
        sound.bigCapture();
        if (e.by === me) {
          store.stats.eggsCaptured++;
          hud.combo('Nest captured!', PLAYER_COLORS[me!]);
          world.kickCamera(1);
        } else if (e.owner === me) {
          vibrate(300);
          hud.toast('Your nest was captured!', true);
          // You're out, but the match goes on: watch it play out (or skip).
          humanOut = true;
          input.enabled = false;
          world.mode = 'overview';
          hud.setSpectating(true);
        } else hud.toast(`${nameOf(e.by)} captured ${nameOf(e.owner)}!`);
        break;
      case 'voidRing':
        sound.rumble();
        if (e.ring === 0) hud.toast('The clouds are eating the island!', true);
        break;
      case 'coreSlide':
        if (e.owner === me) hud.toast('Your nest scooted inward');
        break;
      case 'starSpawn':
        if (game.time < CONFIG.starFirst + 1) hud.toast('A star appeared in the middle!');
        break;
      case 'power':
        sound.power();
        if (e.pid === me) hud.toast(e.power === 'speed' ? 'Zoom zoom!' : e.power === 'shield' ? 'Bubble shield!' : 'Clouds frozen!', true);
        else if (e.power === 'freeze') hud.toast(`${nameOf(e.pid)} froze the clouds`);
        break;
      case 'throw':
        if (e.pid === me) sound.whoosh();
        break;
      case 'splat':
        if (e.pid === me || e.hit) sound.splat(e.pid === me);
        break;
      case 'stun':
        if (e.pid === me) {
          vibrate(80);
          hud.toast(`Bonked by ${nameOf(e.by)}'s ball!`);
        } else if (e.by === me) hud.toast(`Hit ${nameOf(e.pid)}!`);
        break;
      case 'pickup':
        if (e.pid === me) {
          sound.heartGained();
          hud.toast('+2 balls');
        }
        break;
      case 'gameOver':
        if (phase !== 'over') onGameOver(e.winner, e.reason);
        break;
      default:
        break;
    }
  }
}

function onGameOver(winner: number, reason: 'last' | 'time' | 'captured'): void {
  if (humanOut) reason = 'captured';
  hud.setSpectating(false);
  phase = 'over';
  overTimer = 2.4;
  input.enabled = false;
  world.mode = 'overview';
  const won = winner === human;
  if (won) sound.win();
  else sound.lose();
  hud.toast(won ? 'You win!' : `${nameOf(winner)} wins!`, true);

  const st = store.stats;
  const peakPct = (id: number) => (game.players[id].stats.peakLand / game.totalCells) * 100;
  st.games++;
  if (won) st.wins++;
  st.recent = (st.recent + (won ? 'W' : 'L')).slice(-6);
  if (human !== null) st.bestLandPct = Math.max(st.bestLandPct, Math.round(peakPct(human)));
  store.save();

  // results card
  $('resultTitle').textContent = won ? 'You win!' : winner >= 0 ? `${game.players[winner].name} wins!` : 'Game over';
  $('resultReason').textContent =
    reason === 'captured' ? 'Your nest was captured' : reason === 'last' ? 'Last nest standing' : 'Most land when time ran out';
  const order = game.ranking();
  const big = $('resultBig');
  if (human !== null) {
    big.style.setProperty('--c', PLAYER_COLORS[human]);
    // Count the score up for a little drama.
    const rank = order.indexOf(human) + 1;
    const target = game.percent(human);
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / 900);
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      big.textContent = `#${rank} · ${(target * eased).toFixed(1)}%`;
      if (t < 1 && phase === 'over') requestAnimationFrame(tick);
    };
    tick();
    $('results').querySelector('.card')!.classList.toggle('won', won);
  } else big.textContent = '';
  const places = ['1st', '2nd', '3rd', '4th'];
  // When you lose, skip the ranking list: just your result and stats.
  $('ranking').classList.toggle('hidden', !won);
  $('ranking').innerHTML = game
    .ranking()
    .map((id, k) => {
      const c = game.cores[id];
      const pct = game.percent(id);
      const tag = c.state === 'captured' ? 'captured' : `${pct.toFixed(1)}%`;
      return `<div class="rank-row${id === human ? ' me' : ''} medal-${k + 1}" style="animation-delay:${0.1 + k * 0.08}s">
        <span class="place">${places[k]}</span>
        <span class="dot" style="background:${PLAYER_COLORS[id]}"></span>
        <span class="name">${id === human ? 'You' : game.players[id].name}</span>
        <span class="tag">${tag}</span></div>`;
    })
    .join('');
  if (human !== null) {
    const s = game.players[human].stats;
    $('myStats').innerHTML = `
      <div><b>${peakPct(human).toFixed(1)}%</b>peak land</div>
      <div><b>${s.bonks}</b>trails cut</div>
      <div><b>${s.captures}</b>nests taken</div>`;
  }
}

// ---------- wiring ----------

input.onDir = (d) => {
  if (human !== null && (phase === 'playing' || phase === 'countdown')) game.setDir(human, d);
};
input.onAim = (a) => {
  if (human !== null && (phase === 'playing' || phase === 'countdown')) game.setAim(human, a);
};
input.onThrow = () => {
  if (human === null || phase !== 'playing') return;
  if (!game.throwBall(human) && game.players[human].balls <= 0) sound.empty();
};
input.onPause = () => (phase === 'paused' ? resume() : pause());

$('playBtn').onclick = () => {
  sound.unlock();
  sound.click();
  // First time: a guided 30-second ride instead of a rules screen.
  if (!store.settings.tutorialDone && store.stats.games === 0) startTutorial();
  else startMatch();
};
$('customBtn').onclick = () => {
  sound.unlock();
  sound.click();
  $('customize').classList.toggle('hidden');
};
$('howBtn').onclick = () => {
  sound.unlock();
  sound.click();
  returnTo = 'title';
  showScreen('howto');
};
$('settingsBtn').onclick = () => {
  sound.unlock();
  sound.click();
  syncSettingsUI();
  returnTo = 'title';
  showScreen('settings');
};
document.querySelectorAll<HTMLElement>('.back').forEach((b) => {
  b.onclick = () => {
    sound.click();
    if (b.dataset.then === 'play') {
      delete b.dataset.then;
      startMatch();
      return;
    }
    showScreen(returnTo);
  };
});
document.querySelectorAll<HTMLInputElement>('[data-s]').forEach((el) => {
  el.onchange = () => {
    const s = store.settings;
    switch (el.dataset.s) {
      case 'music':
        s.music = el.checked;
        if (s.music) sound.startMusic();
        break;
      case 'sfx':
        s.sfx = el.checked;
        break;
      case 'vibrate':
        s.vibrate = el.checked;
        break;
      case 'dpad':
        s.controls = el.checked ? 'dpad' : 'swipe';
        break;
      case 'quality':
        s.quality = el.checked ? 'high' : 'low';
        world.setQuality(s.quality);
        break;
      case 'hardMode':
        s.hardMode = el.checked;
        break;
      case 'startMode':
        s.startMode = el.checked ? 'quadrant' : 'patch';
        break;
    }
    store.save();
    sound.unlock();
    sound.click();
    applySettings();
  };
});
$('resetStats').onclick = () => {
  store.stats = { games: 0, wins: 0, bestLandPct: 0, eggsCaptured: 0, trailsCut: 0, recent: '' };
  store.save();
  updateStatsLine();
  sound.click();
};
$('pauseBtn').onclick = () => {
  sound.click();
  pause();
};
$('resumeBtn').onclick = () => {
  sound.click();
  resume();
};
$('restartBtn').onclick = () => {
  sound.click();
  startMatch();
};
$('quitBtn').onclick = () => {
  sound.click();
  startAttract();
};
const againBtn = $<HTMLButtonElement>('againBtn');
againBtn.onclick = () => {
  replayLeft = -1;
  sound.click();
  startMatch();
};
$('menuBtn').onclick = () => {
  replayLeft = -1;
  againBtn.textContent = 'Play again';
  sound.click();
  startAttract();
};

window.addEventListener('resize', () => world.resize());
// Every button gives a tiny haptic tick.
document.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('button')) vibrate(8);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pause();
    sound.suspend();
  } else sound.resume();
});
// Android hardware back button: pause in a match, step back through menus, exit from the title.
if (Capacitor.isNativePlatform()) {
  void App.addListener('backButton', () => {
    if (phase === 'playing' || phase === 'countdown') pause();
    else if (phase === 'paused') resume();
    else if (phase === 'over') startAttract();
    else if (!$('title').classList.contains('hidden')) void App.exitApp();
    else showScreen('title');
  });
  void App.addListener('pause', () => {
    pause();
    sound.suspend();
  });
  void App.addListener('resume', () => sound.resume());
}

// ---------- main loop ----------

let last = performance.now();
// Auto quality: if the first seconds of a match run slowly, switch to faster graphics.
let perfFrames = 0;
let perfTime = 0;
let perfChecked = location.search.includes('debug'); // automated tests run on slow software rendering
function checkPerformance(dt: number): void {
  if (perfChecked || phase !== 'playing' || world.currentQuality === 'low') return;
  perfFrames++;
  perfTime += dt;
  if (perfTime < 5) return;
  perfChecked = true;
  if (perfFrames / perfTime < 34) {
    world.setQuality('low');
    store.settings.quality = 'low';
    store.save();
    hud.toast('Switched to faster graphics');
  }
}

function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  checkPerformance(dt);

  if (phase === 'countdown') {
    countdownLeft -= dt;
    const n = Math.ceil(countdownLeft - 0.2);
    if (n !== lastTick) {
      lastTick = n;
      if (n > 0) {
        hud.countdown(String(n));
        sound.countdown(false);
      } else {
        hud.countdown('Go!');
        sound.countdown(true);
        if (store.stats.games < 3) {
          const touch = 'ontouchstart' in window;
          window.setTimeout(() => hud.toast(touch ? 'Drag to steer, tap to throw!' : 'WASD to steer, Space to throw!'), 900);
          window.setTimeout(() => hud.toast('Loop out and back home to grab land'), 3600);
        }
        window.setTimeout(() => hud.countdown(''), 800);
      }
    }
    if (countdownLeft <= 0.2) phase = 'playing';
  }

  if (phase === 'playing') {
    director?.update(dt);
    tutorialTick(dt);
    // Heartbeat when your trail is in danger.
    heartbeatTimer -= dt;
    if (world.danger > 0.55 && heartbeatTimer <= 0) {
      sound.heartbeat(world.danger);
      heartbeatTimer = 0.95 - world.danger * 0.45;
    }
  }
  if (phase === 'playing' || phase === 'menu' || phase === 'over') {
    const step = 1 / CONFIG.tickRate;
    accumulator += dt;
    let guard = 0;
    while (accumulator >= step && guard++ < 6) {
      game.tick(step);
      accumulator -= step;
      if (game.events.length) {
        const ev = game.events;
        game.events = [];
        handleEvents(ev);
      }
    }
    if (phase === 'menu' && game.over) newGame(null);
  }

  // Quick replay: the next match starts by itself unless the player heads to the menu.
  if (replayLeft > 0 && phase === 'over' && !$('results').classList.contains('hidden')) {
    const before = Math.ceil(replayLeft);
    replayLeft -= dt;
    const n = Math.ceil(replayLeft);
    if (n !== before || !againBtn.dataset.count) {
      againBtn.dataset.count = String(n);
      againBtn.textContent = `Play again (${Math.max(0, n)})`;
    }
    if (replayLeft <= 0) {
      replayLeft = -1;
      startMatch();
    }
  }
  if (phase === 'over') {
    overTimer -= dt;
    if (overTimer <= 0 && $('results').classList.contains('hidden')) {
      showScreen('results');
      hud.show(false);
      replayLeft = 5;
      againBtn.textContent = 'Play again (5)';
    }
  }

  // Board hiss follows the player's own riding.
  if (human !== null && phase === 'playing') {
    const me = game.players[human];
    const riding = me.moving && me.status === 'alive' && me.stunTimer <= 0;
    sound.setRide(riding ? me.glide : 0, Math.min(1, Math.abs(me.turn) / CONFIG.turnRate));
  } else sound.setRide(0, 0);
  // Smooth out frame-time jitter for animation (the simulation still uses real time).
  smoothDt += (dt - smoothDt) * 0.3;
  world.frame(smoothDt);
  if (phase !== 'menu') hud.update(game, human, dt);
  requestAnimationFrame(loop);
}

// Test hook: ?debug exposes internals for automated play-testing.
if (location.search.includes('debug')) {
  (window as unknown as Record<string, unknown>).__nn = {
    get game() {
      return game;
    },
    get phase() {
      return phase;
    },
    world,
    fastForward(seconds: number) {
      for (let i = 0; i < seconds * CONFIG.tickRate && !game.over; i++) {
        game.tick(1 / CONFIG.tickRate);
        const ev = game.events;
        game.events = [];
        handleEvents(ev);
      }
    },
  };
}

buildLogo();
buildColorPicker();
buildMapPicker();
syncSettingsUI();
// Load the 3D art, then start. If it fails (e.g. offline web build), the game still runs with simple shapes.
const playBtn = $<HTMLButtonElement>('playBtn');
playBtn.disabled = true;
playBtn.textContent = 'Loading…';
loadArt()
  .then((art) => world.setArt(art))
  .catch((err) => console.error('art failed to load', err))
  .finally(() => {
    playBtn.disabled = false;
    playBtn.textContent = 'Play';
    const loading = $('loading');
    loading.classList.add('done');
    window.setTimeout(() => loading.remove(), 500);
    startAttract();
    requestAnimationFrame(loop);
  });
