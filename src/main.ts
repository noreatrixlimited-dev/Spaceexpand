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
import { eventMap, LEVEL_MAPS, weekNumber, type MapDef } from './maps';
import { EVENT_INDEX } from './render/WorldMap';
import { applyMatch, dailyMissions, GIFT_COINS, missionText, today, today as todayStr } from './ui/Missions';
import { eventSkinIndex, GIFT_SKIN, SKINS } from './skins';
import { Game, type GameEvent } from './core/Game';
import { Input } from './input/Input';
import { loadArt } from './render/Scenery';
import { World } from './render/World';
import { Hud } from './ui/Hud';
import { Store } from './ui/Store';
import { rewardFor, skinPrice } from './ui/Rewards';

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
let captureChain = 0; // grabs in quick succession raise the pitch
let heartbeatTimer = 0;
let replayLeft = -1;
let smoothDt = 1 / 60;
let humanOut = false;
/** What happened to you this match (for the results screen). */
let log = { heartsLost: 0, bonked: 0, stolen: false, outlasted: 0, combos: 0 };
/** Give the next match a head start (after a loss on the same island). */
let retryBoost = false;
/** The boss robot on boss islands (-1 otherwise). */
let bossId = -1;
let nextIsland = false; // the results screen leads on to the world map // your nest fell: you watch the rest of the match
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

// ---------- world map ----------

/** Index of the selected island level (always an unlocked one). */
function levelIndex(): number {
  const i = LEVEL_MAPS.findIndex((m) => m.id === store.settings.map);
  return Math.max(0, Math.min(store.stats.unlocked - 1, i < 0 ? 0 : i));
}

/** The weekly event island opens once you've reached island 3. */
function eventOpen(): boolean {
  return store.stats.unlocked >= 3;
}
function eventWon(): boolean {
  return store.stats.eventWeeks.includes(weekNumber());
}
/** Selected island on the world map: a level index, or EVENT_INDEX. */
function atlasIndex(): number {
  return store.settings.map === 'event' && eventOpen() ? EVENT_INDEX : levelIndex();
}
function currentMap(): MapDef {
  return atlasIndex() === EVENT_INDEX ? eventMap() : LEVEL_MAPS[levelIndex()];
}
function musicIndex(): number {
  return atlasIndex() === EVENT_INDEX ? weekNumber() : levelIndex();
}
function eventState(): { open: boolean; won: boolean } {
  return { open: eventOpen(), won: eventWon() };
}

/** Today's missions (a new set each day). */
function missions() {
  const d = today();
  if (!store.stats.missions || store.stats.missions.day !== d) {
    store.stats.missions = dailyMissions(d);
    store.save();
  }
  return store.stats.missions;
}

function buildMissions(): void {
  const ms = missions();
  const done = ms.list.filter((m) => m.done).length;
  $('missionsBadge').textContent = `${done}/3`;
  $('missionsBtn').classList.toggle('all-done', done === 3);
  $('missionList').innerHTML = ms.list
    .map(
      (m) => `<div class="mission${m.done ? ' done' : ''}">
        <div class="m-text">${missionText(m)}</div>
        <div class="m-bar"><i style="width:${(m.progress / m.target) * 100}%"></i></div>
        <div class="m-reward">${m.done ? 'Done' : `<span class="coin-ico"></span>${m.reward}`}</div></div>`,
    )
    .join('');
}

/** The 7-day gift: once a day, shown when the world map opens. */
function maybeShowGift(): void {
  const g = store.stats.gift;
  if (g.last === today() || phase !== 'menu') return;
  const day = g.count % 7;
  const golden = day === 6 && !store.stats.owned.includes(GIFT_SKIN);
  $('giftDays').innerHTML = GIFT_COINS.map(
    (c, k) => `<div class="gday${k < day ? ' got' : k === day ? ' today' : ''}"><small>Day ${k + 1}</small>${k === 6 ? '<span class="gift-ico"></span>' : `<span class="coin-ico"></span>${c}`}</div>`,
  ).join('');
  $('giftPrize').textContent = golden ? 'Today: the Golden skin!' : `Today: ${GIFT_COINS[day]} coins`;
  $('gift').classList.remove('hidden');
  $('giftClaim').onclick = () => {
    sound.unlock();
    if (golden) {
      store.stats.owned.push(GIFT_SKIN);
      store.settings.skin = GIFT_SKIN;
      sound.star(2);
    } else {
      store.stats.coins += GIFT_COINS[day];
      sound.coin();
    }
    g.last = today();
    g.count++;
    store.save();
    $('gift').classList.add('hidden');
    vibrate(30);
    openWorldMap();
  };
}

function beatenCount(): number {
  return store.stats.champion ? LEVEL_MAPS.length : store.stats.unlocked - 1;
}

/** The equipped skin, if it's unlocked (otherwise the classic look). */
function equippedSkin(): number {
  const k = store.settings.skin;
  return SKINS[k] && skinOwned(k) ? k : 0;
}

function skinOwned(k: number): boolean {
  return (!SKINS[k].special && SKINS[k].unlockAt <= beatenCount()) || store.stats.owned.includes(k);
}

function updateCoins(): void {
  $('coinPill').textContent = String(store.stats.coins);
}

function buildSkinPicker(): void {
  const wrap = $('skins');
  wrap.innerHTML = '';
  SKINS.forEach((sk, k) => {
    const b = document.createElement('button');
    const locked = !skinOwned(k);
    const price = skinPrice(k);
    b.className = 'skin-card' + (k === equippedSkin() ? ' selected' : '') + (locked ? ' locked' : '');
    const swatch = [sk.body ?? '#ffffff', sk.deck, ...(sk.trailColors.length ? [sk.trailColors[0]] : [sk.tips])];
    b.innerHTML = `<span class="sw">${swatch.map((c) => `<i style="background:${c}"></i>`).join('')}</span><b>${sk.name}</b><small>${
      locked
        ? sk.special === 'event'
          ? 'Weekly event'
          : sk.special === 'gift'
            ? 'Day 7 gift'
            : `Island ${sk.unlockAt} or <span class="coin-ico"></span>${price}`
        : k === equippedSkin()
          ? 'Equipped'
          : 'Tap to wear'
    }</small>`;
    b.onclick = () => {
      sound.unlock();
      if (locked) {
        // Buy it early with coins (event and gift skins can't be bought).
        if (sk.special || store.stats.coins < price) {
          sound.empty();
          b.classList.remove('shake');
          void b.offsetWidth;
          b.classList.add('shake');
          return;
        }
        store.stats.coins -= price;
        store.stats.owned.push(k);
        sound.coin();
        updateCoins();
      }
      sound.click();
      store.settings.skin = k;
      store.save();
      buildSkinPicker();
      if (phase === 'menu') openWorldMap();
    };
    wrap.appendChild(b);
  });
}

/** A trip to make the next time the world map opens (after winning an island). */
let pendingTravel: { from: number; to: number } | null = null;

function showIslandCard(): void {
  const i = atlasIndex();
  const m = currentMap();
  const world = i < 8 ? 'World 1' : 'World 2';
  $('levelTag').textContent =
    i === EVENT_INDEX
      ? `Weekly event${eventWon() ? '  ·  won' : `  ·  prize: ${SKINS[eventSkinIndex(weekNumber())].name} skin`}`
      : `${world} · Island ${i + 1} of ${LEVEL_MAPS.length}${m.boss ? ' · Boss' : ''}` + (i < beatenCount() ? '  ·  won' : '');
  $('islandName').textContent = m.name;
  $('islandName').style.color = m.theme.ui;
  $('islandBlurb').textContent = m.blurb;
  const st = store.stats.stars[m.id] ?? 0;
  $('islandStars').innerHTML = [0, 1, 2].map((k) => `<i class="star${k < st ? ' on' : ''}"></i>`).join('');
  updateCoins();
  buildMissions();
}

function openWorldMap(): void {
  const atlas = world.getAtlas(store.settings.slot);
  buildSkinPicker();
  world.showAtlas = true;
  const title = $('title');
  const trip = pendingTravel;
  pendingTravel = null;
  if (trip) {
    // Stand on the island just won, then ride to the next one; the Play card pops up on arrival.
    store.settings.map = LEVEL_MAPS[trip.from].id;
    atlas.setState(store.stats.unlocked, beatenCount(), trip.from, store.settings.slot, equippedSkin(), eventState());
    store.settings.map = LEVEL_MAPS[trip.to].id;
    store.save();
    title.classList.add('traveling');
    window.setTimeout(() => {
      sound.whoosh();
      atlas.travel(trip.from, trip.to, () => {
        window.setTimeout(maybeShowGift, 600);
        sound.setMusicStyle(trip.to, true);
        sound.heartGained();
        title.classList.remove('traveling');
        showIslandCard();
        sound.click();
        vibrate(20);
      });
    }, 700);
  } else {
    title.classList.remove('traveling');
    atlas.setState(store.stats.unlocked, beatenCount(), atlasIndex(), store.settings.slot, equippedSkin(), eventState());
    window.setTimeout(maybeShowGift, 500);
  }
  showIslandCard();
}

/** Tap an island to ride there; drag to look around. */
function setupMapTouch(): void {
  const canvas = $('scene');
  let down: { x: number; y: number; moved: number } | null = null;
  const active = () => phase === 'menu' && world.showAtlas && world.atlas && !world.atlas.busy;
  canvas.addEventListener('pointerdown', (e) => {
    if (active()) down = { x: e.clientX, y: e.clientY, moved: 0 };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!down || !active()) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    down.moved += Math.abs(dx) + Math.abs(dy);
    down.x = e.clientX;
    down.y = e.clientY;
    if (down.moved > 10) world.atlas!.drag(dx, dy);
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || d.moved > 10 || !active()) return;
    const atlas = world.atlas!;
    const i = atlas.pick((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    if (i < 0) return;
    sound.unlock();
    const locked = i === EVENT_INDEX ? !eventOpen() : i >= store.stats.unlocked;
    if (locked) {
      sound.empty();
      vibrate(30);
      const card = $('title').querySelector('.map-bottom') as HTMLElement;
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
      $('islandBlurb').textContent = i === EVENT_INDEX ? 'Reach island 3 to open the weekly event!' : `Win island ${store.stats.unlocked} to unlock ${LEVEL_MAPS[i].name}!`;
      return;
    }
    sound.click();
    const from = atlas.current;
    store.settings.map = i === EVENT_INDEX ? 'event' : LEVEL_MAPS[i].id;
    store.save();
    if (from === i) {
      atlas.drag(0, 0);
      atlas.setState(store.stats.unlocked, beatenCount(), i, store.settings.slot, equippedSkin(), eventState());
      return;
    }
    $('title').classList.add('traveling');
    sound.startMusic();
    sound.whoosh();
    atlas.travel(from, i, () => {
      sound.setMusicStyle(musicIndex(), true);
      $('title').classList.remove('traveling');
      showIslandCard();
    });
  });
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
      if (phase === 'menu') openWorldMap();
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
    map: currentMap().id,
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
    // Boss islands: the robot opposite you is the boss, with extra egg hearts.
    bossId = game.map.boss && humanSlot !== null ? (humanSlot + 2) % 4 : -1;
    if (bossId >= 0) game.cores[bossId].hearts = 5;
    if (humanSlot !== null) director = new Director(game, bots, humanSlot, pickMood(store.stats.recent), bossId);
  }
  combo = { lastCapture: -99, bonkedBy: -1, bonkedAt: -99, cuts: 0 };
  log = { heartsLost: 0, bonked: 0, stolen: false, outlasted: 0, combos: 0 };
  captureChain = 0;
  humanOut = false;
  hud.setSpectating(false);
  if (!tutorial) {
    tutorialStep = -1;
    coach.classList.add('hidden');
  }
  replayLeft = -1;
  human = humanSlot;
  // You wear your skin; the bots show off others (a peek at what you can unlock).
  const lvl = levelIndex();
  const botSkins = SKINS.map((sk, k) => (sk.special || k === 0 ? -1 : k)).filter((k) => k > 0);
  const skins = game.players.map((p) =>
    p.id === humanSlot ? equippedSkin() : p.id === bossId ? SKINS.findIndex((sk) => sk.id === 'lava') : botSkins[(lvl + p.id * 3) % botSkins.length],
  );
  world.setGame(game, skins, bossId);
  world.mode = humanSlot === null ? 'orbit' : 'follow';
  world.followId = humanSlot ?? 0;
  hud.build(game, humanSlot);
  accumulator = 0;
}

function startAttract(): void {
  phase = 'menu';
  input.enabled = false;
  replayLeft = -1;
  againBtn.textContent = 'Play again';
  hud.show(false);
  sound.setMusicStyle(musicIndex(), true);
  sound.setLeading(false);
  sound.setTension(0);
  sound.startMusic();
  openWorldMap();
  applySettings();
  updateStatsLine();
  showScreen('title');
}

function startMatch(): void {
  sound.unlock();
  sound.setMusicStyle(musicIndex(), false);
  sound.startMusic();
  newGame(store.settings.slot);
  world.showAtlas = false;
  world.startSwoop();
  if (bossId >= 0) window.setTimeout(() => hud.toast('Boss island! Beat the big bubble', true), 3300);
  if (retryBoost && human !== null) {
    // Second try on the same island: a head start, and we say so.
    const me = game.players[human];
    me.balls = Math.max(me.balls, 3);
    me.shield = true;
    me.power = 'shield';
    me.powerTimer = 10;
    window.setTimeout(() => hud.toast('Retry boost: 3 balls + bubble shield!', true), 3300);
  }
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
  sound.setMusicStyle(musicIndex(), false);
  sound.startMusic();
  newGame(store.settings.slot, true);
  world.showAtlas = false;
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
          captureChain = game.time - combo.lastCapture < 6 ? captureChain + 1 : 0;
          sound.capture(e.cells.length / (UNIT * UNIT), captureChain);
          sound.thump(Math.min(1, pct / 6));
          world.kickCamera(Math.min(1, 0.25 + pct / 6));
          vibrate(pct >= 3 ? 60 : 20);
          if (game.time - combo.lastCapture < 6) {
            hud.combo('Double grab!', '#ff9f1c');
            log.combos++;
          }
          else if (pct >= 4) hud.combo(`Huge grab! +${pct.toFixed(0)}%`, PLAYER_COLORS[me]);
          combo.lastCapture = game.time;
        }
        break;
      case 'bonk':
        if (e.victim === me) {
          log.bonked++;
          sound.bonk();
          vibrate(120);
          hud.toast(e.by === me ? 'Oops! Bonked by your own trail' : e.by === e.victim ? 'Swallowed by the clouds!' : 'Your trail was cut!');
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
          else hud.toast('Bonk!');
        }
        break;
      case 'shielded':
        if (e.pid === me) hud.toast('Shield saved you!');
        sound.squeak();
        break;
      case 'coreHit':
        if (e.owner === me) {
          log.heartsLost++;
          sound.heartLost();
          vibrate(60);
          hud.toast('Your egg is under attack!');
        } else if (e.by === me) sound.heartLost();
        break;
      case 'heartRegen':
        if (e.owner === me) sound.heartGained();
        break;
      case 'coreStolen':
        sound.steal();
        if (e.owner === me) {
          log.stolen = true;
          vibrate(200);
          hud.toast('Your egg was stolen! Bump the thief!', true);
        } else if (e.by === me) {
          hud.combo('Egg grabbed!', '#f08c00');
          hud.toast('Ride to your colour to keep it!');
        }
        break;
      case 'eggDropped':
        sound.drop();
        if (e.owner === me) hud.toast('Your egg is safe again!');
        else if (e.carrier === me) hud.toast('You dropped the egg!');
        else if (e.by === me) hud.toast('Egg sent home!');
        break;
      case 'coreCaptured':
        sound.bigCapture();
        if (e.owner !== me && !humanOut) log.outlasted++;
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
        }
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
          hud.toast('Splat! You got hit');
        } else if (e.by === me) hud.toast('Direct hit!');
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
  hud.toast(won ? 'You win!' : 'Match over', true);
  if (won && game.map.id === LEVEL_MAPS[LEVEL_MAPS.length - 1].id) window.setTimeout(() => hud.toast('Champion of every island!', true), 900);
  else if (won && game.map.id === LEVEL_MAPS[7].id) window.setTimeout(() => hud.toast('World 1 complete! World 2 is open', true), 900);

  const st = store.stats;
  const peakPct = (id: number) => (game.players[id].stats.peakLand / game.totalCells) * 100;
  st.games++;
  if (won) st.wins++;
  st.recent = (st.recent + (won ? 'W' : 'L')).slice(-6);
  // Island progress: winning an island opens the next one, and the map rides you there.
  const lvl = LEVEL_MAPS.findIndex((m) => m.id === game.map.id);
  let unlockedNew = false;
  const skinsBefore = beatenCount();
  if (won && lvl >= 0) {
    if (lvl === st.unlocked - 1 && st.unlocked < LEVEL_MAPS.length) {
      st.unlocked++;
      unlockedNew = true;
    }
    if (lvl === LEVEL_MAPS.length - 1) st.champion = true;
    if (lvl + 1 < LEVEL_MAPS.length) pendingTravel = { from: lvl, to: lvl + 1 };
  }
  nextIsland = pendingTravel !== null;
  if (human !== null) st.bestLandPct = Math.max(st.bestLandPct, Math.round(peakPct(human)));
  store.save();

  // ---------- results card: celebrate a win, frame a loss as "so close", always pay out ----------
  const me = human;
  const card = $('results').querySelector('.card')!;
  card.classList.toggle('won', won);
  card.classList.toggle('lost', !won);
  const order = game.ranking();
  let reward = null as ReturnType<typeof rewardFor> | null;
  let eventSkinWon = -1;
  const missionLines: string[] = [];
  if (me !== null) {
    const rivals = game.players.filter((p) => p.id !== me);
    const rival = rivals.reduce((a, b) => (game.percent(b.id) > game.percent(a.id) ? b : a));
    const rank = humanOut ? 4 - log.outlasted : order.indexOf(me) + 1;
    const today = todayStr();
    reward = rewardFor({
      won,
      rank,
      peakPct: peakPct(me),
      finalPct: game.percent(me),
      rivalPct: game.percent(rival.id),
      rivalName: rival.name,
      captured: humanOut,
      outlasted: log.outlasted,
      heartsLost: log.heartsLost,
      bonked: log.bonked,
      eggStolen: log.stolen,
      throws: game.players[me].stats.throws,
      eggsTaken: game.players[me].stats.captures,
      trailsCut: game.players[me].stats.bonks,
      firstWinToday: won && st.lastWinDay !== today,
    });
    if (won) st.lastWinDay = today;
    st.coins += reward.coins;
    // Weekly event: the first win this week gives the event skin (or coins if you have it).
    if (won && game.map.id === 'event' && !st.eventWeeks.includes(weekNumber())) {
      st.eventWeeks.push(weekNumber());
      const ev = eventSkinIndex(weekNumber());
      if (!st.owned.includes(ev)) {
        st.owned.push(ev);
        eventSkinWon = ev;
      } else st.coins += 100;
    }
    // Daily missions.
    const finished = applyMatch(missions(), {
      won,
      peakPct: peakPct(me),
      eggsTaken: game.players[me].stats.captures,
      trailsCut: game.players[me].stats.bonks,
      throws: game.players[me].stats.throws,
      stars: reward.stars,
      combos: log.combos,
    });
    for (const m of finished) {
      st.coins += m.reward;
      missionLines.push(`Mission done: ${missionText(m)} +${m.reward}`);
    }
    if (lvl >= 0) st.stars[game.map.id] = Math.max(st.stars[game.map.id] ?? 0, reward.stars);
    // A loss on this island earns a head start on the next try here.
    retryBoost = !won && (lvl >= 0 || game.map.id === 'event');
    store.save();

    $('resultTitle').textContent = reward.title;
    $('resultReason').textContent = reward.note;
    $('resultTip').textContent = reward.tip;
    // Stars pop in one by one (empty outlines on a loss).
    $('resultStars').innerHTML = [0, 1, 2].map((k) => `<i class="star${k < reward!.stars ? ' on' : ''}" style="animation-delay:${0.5 + k * 0.35}s"></i>`).join('');
    for (let k = 0; k < reward.stars; k++) window.setTimeout(() => sound.star(k), 2400 + 500 + k * 350);

    const big = $('resultBig');
    big.style.setProperty('--c', PLAYER_COLORS[me]);
    const target = game.percent(me);
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / 900);
      const eased = 1 - (1 - t) * (1 - t) * (1 - t);
      big.textContent = `#${rank} · ${(target * eased).toFixed(1)}%`;
      if (t < 1 && phase === 'over') requestAnimationFrame(tick);
    };
    tick();

    // Coins count up with a tick per step, then a ka-ching.
    const coinsEl = $('resultCoins');
    coinsEl.innerHTML = `<span class="coin-ico"></span><b>+0</b><small>${reward.breakdown.join(' · ')}</small>`;
    const total = reward.coins;
    const cb = coinsEl.querySelector('b')!;
    window.setTimeout(() => {
      const t0 = performance.now();
      let shown = 0;
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / 1100);
        const v = Math.round(total * t);
        if (v !== shown && Math.floor(v / 5) !== Math.floor(shown / 5)) sound.coinTick();
        shown = v;
        cb.textContent = `+${v}`;
        if (t < 1) requestAnimationFrame(step);
        else sound.coin();
      };
      step();
    }, 2400 + 1400);
  }

  // What's next: unlocks first, then the nearest goal.
  const lines: string[] = [];
  if (unlockedNew) lines.push(`${LEVEL_MAPS[lvl + 1].name} unlocked!`);
  const beatNow = beatenCount();
  const fresh = beatNow > skinsBefore ? SKINS.findIndex((sk) => !sk.special && sk.unlockAt > skinsBefore && sk.unlockAt <= beatNow) : -1;
  const newSkin = fresh > 0 ? fresh : eventSkinWon;
  if (newSkin > 0) {
    // New skin: wear it straight away (it can be changed under Style).
    store.settings.skin = newSkin;
    store.save();
    lines.push(`New skin: ${SKINS[newSkin].name}!`);
    window.setTimeout(() => hud.toast(`New skin: ${SKINS[newSkin].name}!`, true), 1600);
  } else {
    const next = SKINS.findIndex((sk, k) => k > 0 && !sk.special && !skinOwned(k));
    if (next > 0) lines.push(`${SKINS[next].name} skin: ${Math.min(st.coins, skinPrice(next))}/${skinPrice(next)} coins`);
  }
  lines.push(...missionLines);
  if (!won && retryBoost) lines.push('Retry boost ready: 3 balls + bubble shield');
  $('resultNext').innerHTML = lines.map((l) => `<div>${l}</div>`).join('');

  const places = ['1st', '2nd', '3rd', '4th'];
  // When you lose, skip the ranking list: just your result and what's next.
  $('ranking').classList.toggle('hidden', !won);
  $('ranking').innerHTML = order
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
  $('myStats').innerHTML = '';
  void reason;
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
$('missionsBtn').onclick = () => {
  sound.unlock();
  sound.click();
  buildMissions();
  $('missionPanel').classList.toggle('hidden');
  $('customize').classList.add('hidden');
};
$('customBtn').onclick = () => {
  $('missionPanel').classList.add('hidden');
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
  store.stats = { ...store.stats, games: 0, wins: 0, bestLandPct: 0, eggsCaptured: 0, trailsCut: 0, recent: '' };
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
  if (nextIsland) startAttract();
  else startMatch();
};
$('menuBtn').onclick = () => {
  replayLeft = -1;
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
    sound.setHurry(CONFIG.matchSeconds - game.time < 30);
    sound.setLeading(human !== null && !humanOut && game.time > 5 && game.leader() === human);
    sound.setTension(world.danger);
    tutorialTick(dt);
    // Heartbeat when your trail is in danger.
    heartbeatTimer -= dt;
    if (world.danger > 0.55 && heartbeatTimer <= 0) {
      sound.heartbeat(world.danger);
      heartbeatTimer = 0.95 - world.danger * 0.45;
    }
  }
  if (phase === 'playing' || phase === 'over') {
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
  }

  // Quick replay: the next match starts by itself unless the player heads to the menu.
  if (replayLeft > 0 && phase === 'over' && !$('results').classList.contains('hidden')) {
    const before = Math.ceil(replayLeft);
    replayLeft -= dt;
    const n = Math.ceil(replayLeft);
    if (n !== before || !againBtn.dataset.count) {
      againBtn.dataset.count = String(n);
      againBtn.textContent = `${nextIsland ? 'Next island' : 'Try again'} (${Math.max(0, n)})`;
    }
    if (replayLeft <= 0) {
      replayLeft = -1;
      if (nextIsland) startAttract();
      else startMatch();
    }
  }
  if (phase === 'over') {
    overTimer -= dt;
    if (overTimer <= 0 && $('results').classList.contains('hidden')) {
      showScreen('results');
      hud.show(false);
      replayLeft = 5;
      againBtn.textContent = `${nextIsland ? 'Next island' : 'Try again'} (5)`;
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
    end(win: boolean) {
      if (human === null) return;
      game.over = true;
      onGameOver(win ? human : (human + 1) % 4, 'time');
    },
    travel(from: number, to: number) {
      pendingTravel = { from, to };
      startAttract();
    },
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
setupMapTouch();
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
