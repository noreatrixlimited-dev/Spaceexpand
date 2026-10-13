import * as THREE from 'three';
import { CONFIG, PLAYER_COLORS, UNIT } from '../config';
import type { Game, GameEvent } from '../core/Game';
import { BallsView } from './BallsView';
import { Blob } from './Blob';
import { Critter } from './Critter';
import { EggView } from './Egg';
import { toon } from './materials';
import { Particles } from './Particles';
import { Post } from './post';
import { Scenery, type Art } from './Scenery';
import { starGeometry } from './shapes';
import { Territory } from './Territory';

type Avatar = Blob | Critter;
const SWOOP_TIME = 2.6;
export type Quality = 'high' | 'low';
export type CameraMode = 'follow' | 'overview' | 'orbit';

/** Owns the Three.js renderer and turns game state + events into the 3D scene. */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.5, 600);
  private readonly sun: THREE.DirectionalLight;
  private readonly particles = new Particles();
  private readonly starMesh: THREE.Mesh;
  private readonly matchGroup = new THREE.Group();
  private game: Game | null = null;
  private territory: Territory | null = null;
  private avatars: Avatar[] = [];
  private balls: BallsView | null = null;
  private art: Art | null = null;
  private scenery: Scenery | null = null;
  private post: Post | null = null;
  private quality: Quality;
  private eggs: EggView[] = [];
  private avatarPos: THREE.Vector3[] = [];
  private sprayAcc = [0, 0, 0, 0];
  private lastHeading = [0, 0, 0, 0];
  private turnVis = [0, 0, 0, 0];
  private nestPos: THREE.Vector3[] = [];
  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3(0, 40, 30);
  private shake = 0;
  private time = 0;
  private starScale = 0;
  private half = 20;
  // Cues for the human player: throw-ready ring and trail danger.
  private readonly readyRing: THREE.Mesh;
  private humanId: number | null = null;
  /** 0..1: how risky the human's trail is right now (drives the red pulse and heartbeat). */
  danger = 0;
  private punch = 0;
  private autoZoom = 1;
  private swoop = 0;
  mode: CameraMode = 'orbit';
  followId = 0;
  zoom = 1;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // Bright, even daylight (Paper.io is clean and evenly lit) with soft shadows.
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#c9d3e6', 1.7));
    this.sun = new THREE.DirectionalLight('#fff6e6', 2.2);
    this.sun.castShadow = quality === 'high';
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.sun.shadow.bias = -0.001;
    const sc = this.sun.shadow.camera;
    Object.assign(sc, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
    this.scene.add(this.sun, this.sun.target);

    this.starMesh = new THREE.Mesh(starGeometry(0.42, 0.19, 0.16), toon('#ffd43b', { emissive: '#ffb703', emissiveIntensity: 0.35 }));
    this.starMesh.castShadow = true;
    this.starMesh.visible = false;
    this.readyRing = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 0.92, 40),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.readyRing.rotation.x = -Math.PI / 2;
    this.readyRing.renderOrder = 2;
    this.readyRing.visible = false;
    this.scene.add(this.matchGroup, this.particles.mesh, this.starMesh, this.readyRing);
    this.buildPost();
    this.resize();
  }

  private pixelRatio(): number {
    // Phones have very dense screens; past ~1.6x the extra pixels cost a lot and add little.
    const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    return Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? (mobile ? 1.6 : 2) : 1.2);
  }

  /** Soft outlines on characters and the island edge + a light grade. No blur, bloom or fog. */
  private buildPost(): void {
    this.post = null;
    if (this.quality !== 'high') return;
    this.post = new Post(this.renderer, this.scene, this.camera, {
      outline: { color: '#4a3a5c', thickness: 1, strength: 0.45 },
      grade: { saturation: 1.06, warmth: 0.02, vignette: 0.1, contrast: 1.03 },
      msaa: true,
    });
  }

  setArt(art: Art): void {
    this.art = art;
  }

  get currentQuality(): Quality {
    return this.quality;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.shadowMap.enabled = q === 'high';
    this.sun.castShadow = q === 'high';
    this.buildPost();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Grid cell centre -> world position. */
  private cellPos(x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set((x + 0.5) / UNIT - this.half, 0, (y + 0.5) / UNIT - this.half);
  }
  /** Continuous grid position -> world position. */
  private gridPos(px: number, py: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(px / UNIT - this.half, 0, py / UNIT - this.half);
  }

  setGame(game: Game): void {
    this.matchGroup.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.matchGroup.clear();
    this.territory?.dispose();
    this.game = game;
    this.half = game.grid.size / UNIT / 2;

    this.territory = new Territory(game, game.map.theme);
    this.matchGroup.add(this.territory.mesh);
    if (this.scenery) this.scene.remove(this.scenery.group);
    this.scenery = new Scenery(game.map, this.art);
    this.scene.add(this.scenery.group);

    this.avatars = [];
    this.eggs = [];
    this.avatarPos = [];
    this.nestPos = [];
    for (const p of game.players) {
      const b: Avatar = this.art ? new Critter(p.id, p.isHuman, this.art.character) : new Blob(p.id, p.isHuman);
      this.avatars.push(b);
      const pos = this.gridPos(p.px, p.py);
      this.avatarPos.push(pos.clone());
      b.root.position.copy(pos);
      b.setFacing(Math.cos(p.heading), Math.sin(p.heading));
      this.matchGroup.add(b.root);
      const c = game.cores[p.id];
      const egg = new EggView(p.id);
      const np = this.cellPos(c.x, c.y);
      this.nestPos.push(np.clone());
      egg.nest.position.copy(np);
      egg.egg.position.copy(np);
      this.eggs.push(egg);
      this.matchGroup.add(egg.nest, egg.egg);
    }
    this.humanId = game.opts.humanSlot;
    this.danger = 0;
    this.lastHeading = game.players.map((p) => p.heading);
    this.turnVis = [0, 0, 0, 0];
    this.balls = new BallsView(game.grid.size);
    this.matchGroup.add(this.balls.group);
    this.starScale = 0;
    this.territory.update(game, 0);
    if (this.mode === 'follow') {
      this.camTarget.copy(this.avatarPos[this.followId]);
      this.camPos.copy(this.camTarget).add(new THREE.Vector3(0, 20, 12));
    }
  }

  addShake(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  handleEvents(events: GameEvent[], humanId: number | null): void {
    const game = this.game;
    if (!game || !this.territory) return;
    const v = new THREE.Vector3();
    const n = game.grid.size;
    for (const e of events) {
      switch (e.type) {
        case 'trail':
          this.territory.mark([e.cell]);
          break;
        case 'capture': {
          this.territory.wave(e.cells, e.fromX, e.fromY);
          this.avatars[e.pid].kick(0.3);
          this.particles.burst(this.avatarPos[e.pid].clone().setY(0.6), PLAYER_COLORS[e.pid], Math.min(24, 6 + e.cells.length / 20), 3.2);
          break;
        }
        case 'bonk': {
          this.territory.mark(e.trail);
          const pos = this.avatarPos[e.victim].clone().setY(0.5);
          this.particles.burst(pos, PLAYER_COLORS[e.victim], 18, 4);
          this.particles.puff(pos, 6);
          const step = Math.max(1, Math.floor(e.trail.length / 14));
          for (let k = 0; k < e.trail.length; k += step) {
            const c = e.trail[k];
            this.cellPos(c % n, Math.floor(c / n), v).setY(0.2);
            this.particles.burst(v, PLAYER_COLORS[e.victim], 2, 2, 0.07);
          }
          if (e.victim === humanId) this.addShake(0.6);
          else if (e.by === humanId) this.addShake(0.25);
          break;
        }
        case 'shielded':
          this.particles.burst(this.avatarPos[e.pid].clone().setY(0.6), '#8fe3ff', 16, 3);
          break;
        case 'respawn':
          this.particles.puff(this.avatarPos[e.pid].clone().setY(0.3), 8);
          break;
        case 'coreHit':
          this.eggs[e.owner].loseHeart();
          this.particles.burst(this.nestPos[e.owner].clone().setY(1), '#ff5d8f', 12, 3);
          if (e.owner === humanId) this.addShake(0.35);
          break;
        case 'coreStolen':
          this.particles.burst(this.nestPos[e.owner].clone().setY(0.8), '#ffd43b', 20, 4);
          if (e.owner === humanId) this.addShake(0.5);
          break;
        case 'eggDropped':
          this.particles.puff(this.avatarPos[e.carrier].clone().setY(0.8), 10);
          break;
        case 'coreCaptured': {
          // The captured rider vanishes in a puff.
          this.particles.puff(this.avatarPos[e.owner].clone().setY(0.6), 14);
          this.particles.burst(this.avatarPos[e.owner].clone().setY(0.6), PLAYER_COLORS[e.owner], 20, 4);
          const c = game.cores[e.by];
          this.territory.wave(e.cells, c.x, c.y, 0.006);
          this.particles.confetti(this.nestPos[e.by].clone().setY(1), 70);
          this.addShake(0.4);
          break;
        }
        case 'voidRing':
          this.territory.voidWave(e.cells);
          this.addShake(0.2);
          break;
        case 'power':
          this.particles.burst(this.avatarPos[e.pid].clone().setY(0.8), '#ffd43b', 24, 4.5);
          break;
        case 'starSpawn':
          this.particles.burst(this.cellPos(game.star.x, game.star.y, v).setY(0.8), '#ffe066', 16, 3);
          break;
        case 'throw':
          this.avatars[e.pid].kick(0.2);
          break;
        case 'splat': {
          const at = this.gridPos(e.x, e.y).setY(0.35);
          this.territory.wave(e.cells, e.x, e.y, 0.02);
          this.particles.burst(at, PLAYER_COLORS[e.pid], 14 + Math.min(16, e.cells.length / 6), 4.2, 0.1);
          this.particles.puff(at, 5);
          if (e.hit) this.addShake(0.15);
          break;
        }
        case 'stun':
          this.particles.burst(this.avatarPos[e.pid].clone().setY(1.1), '#ffd43b', 10, 3);
          if (e.pid === humanId) this.addShake(0.4);
          break;
        case 'pickup':
          this.particles.confetti(this.avatarPos[e.pid].clone().setY(0.8), 18);
          break;
        case 'gameOver':
          if (e.winner >= 0) this.particles.confetti(this.avatarPos[e.winner].clone().setY(1), 120);
          break;
        default:
          break;
      }
    }
  }

  /** Render a frame (the game runs at 60 ticks/s; positions are eased toward the latest tick). */
  frame(dt: number): void {
    this.time += dt;
    const game = this.game;
    if (game && this.territory) {
      const n = game.grid.size;
      const tmp = new THREE.Vector3();
      this.territory.update(game, dt, (cell, owner) => {
        if (Math.random() < 0.02) {
          this.cellPos(cell % n, Math.floor(cell / n), tmp).setY(0.3);
          this.particles.burst(tmp, PLAYER_COLORS[owner], 1, 1.5, 0.06);
        }
      });

      const leader = game.time > 8 ? game.leader() : -1;
      for (const p of game.players) {
        const b = this.avatars[p.id];
        const target = this.gridPos(p.px, p.py, tmp);
        const cur = this.avatarPos[p.id];
        if (cur.distanceTo(target) > 3) cur.copy(target);
        else cur.lerp(target, 1 - Math.exp(-dt * 30));
        b.root.position.copy(cur);
        b.root.visible = p.status !== 'out';
        b.setFacing(Math.cos(p.heading), Math.sin(p.heading));
        const stunned = p.stunTimer > 0;
        b.moving = p.moving && p.status !== 'bonked' && !stunned;
        b.mood =
          p.status === 'out' ? 'ghost' : p.status === 'bonked' || stunned ? 'bonked' : game.over && game.winner === p.id ? 'happy' : 'normal';
        b.ghostColor = p.shadeOf >= 0 ? PLAYER_COLORS[p.shadeOf] : null;
        b.carrying = p.carrying >= 0;
        b.crowned = leader === p.id && p.status !== 'out';
        b.shielded = p.shield;
        // Lean from how fast the heading is actually changing (works for bots and players).
        let dh = p.heading - this.lastHeading[p.id];
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        this.lastHeading[p.id] = p.heading;
        const rate = dt > 0 ? dh / dt : 0;
        this.turnVis[p.id] += (rate - this.turnVis[p.id]) * Math.min(1, dt * 8);
        b.lean = this.turnVis[p.id] / CONFIG.turnRate;
        b.update(dt, this.time);
        // Snow spray off the board: a light dusting while gliding, a burst when carving hard.
        if (b.moving && p.status === 'alive') {
          const carve = Math.min(1, Math.abs(b.lean));
          this.sprayAcc[p.id] += dt * (5 + carve * 45) * p.glide;
          const n = Math.floor(this.sprayAcc[p.id]);
          if (n > 0) {
            this.sprayAcc[p.id] -= n;
            const fx = Math.cos(p.heading);
            const fz = Math.sin(p.heading);
            // outside of the turn: right turns throw snow to the left, and vice versa
            const s = b.lean >= 0 ? -1 : 1;
            const side = new THREE.Vector3(-fz * s, 0, fx * s).multiplyScalar(0.6 + carve).addScaledVector(new THREE.Vector3(-fx, 0, -fz), 0.5);
            const tail = cur.clone().add(new THREE.Vector3(-fx * 0.45, 0.12, -fz * 0.45));
            this.particles.spray(tail, side, n);
          }
        }

        const c = game.cores[p.id];
        const egg = this.eggs[p.id];
        const np = this.cellPos(c.x, c.y, new THREE.Vector3());
        this.nestPos[p.id].lerp(np, 1 - Math.exp(-dt * 6));
        egg.nest.position.copy(this.nestPos[p.id]);
        egg.captured = c.state === 'captured';
        egg.carried = c.state === 'carried';
        egg.threatened = c.threatened;
        if (c.state === 'carried' && c.carrier >= 0) {
          const carrierPos = this.avatarPos[c.carrier];
          egg.egg.position.lerp(tmp.copy(carrierPos).setY(carrierPos.y + (this.art ? 1.6 : 0.75)), 1 - Math.exp(-dt * 20));
        } else {
          egg.egg.position.lerp(this.nestPos[p.id], 1 - Math.exp(-dt * 10));
        }
        egg.update(dt, this.time, c.hearts);
      }
      this.balls?.update(game, this.avatarPos, this.time);
      this.updateCues(game, dt);

      const want = game.star.active ? 1 : 0;
      this.starScale += (want - this.starScale) * Math.min(1, dt * 8);
      this.starMesh.visible = this.starScale > 0.02;
      if (this.starMesh.visible) {
        this.cellPos(game.star.x, game.star.y, this.starMesh.position);
        this.starMesh.position.y = 0.75 + Math.sin(this.time * 3) * 0.12;
        this.starMesh.rotation.y = this.time * 2;
        this.starMesh.scale.setScalar(this.starScale);
      }
    }
    this.particles.update(dt);
    this.scenery?.update(dt, game ? game.voidRing : 0);
    this.updateCamera(dt);
    if (this.post) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  /** Start a match with the camera high over the whole island, then swoop down to the rider. */
  startSwoop(): void {
    const aspect = this.camera.aspect;
    const halfH = Math.tan((this.camera.fov * Math.PI) / 360);
    const span = (this.game ? this.game.map.size : 20) + 2.5;
    const dist = Math.max(span / (halfH * aspect), span / halfH);
    this.camTarget.set(0, 0, 0);
    this.camPos.copy(new THREE.Vector3(0, 1, 0.5).normalize().multiplyScalar(dist));
    this.swoop = SWOOP_TIME;
    this.autoZoom = 1;
  }

  /** Small zoom "punch" for satisfying moments (big land grabs). */
  kickCamera(amount: number): void {
    this.punch = Math.max(this.punch, amount);
  }

  private updateCues(game: Game, dt: number): void {
    const id = this.humanId;
    const p = id === null ? null : game.players[id];
    if (!p || !this.territory || p.status !== 'alive' || game.over) {
      this.readyRing.visible = false;
      this.territory?.setDanger(null, 0);
      this.danger = 0;
      return;
    }
    const pos = this.avatarPos[p.id];
    const U = UNIT;
    // Throw-ready ring under your robot.
    const ready = p.balls > 0 && p.throwCooldown <= 0 && p.stunTimer <= 0;
    this.readyRing.visible = ready;
    if (ready) {
      this.readyRing.position.set(pos.x, 0.03, pos.z);
      this.readyRing.scale.setScalar(1 + Math.sin(this.time * 5) * 0.05);
      (this.readyRing.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(this.time * 5) * 0.2;
    }
    // How risky is the trail? Long trails and nearby enemies both raise it.
    let want = 0;
    if (p.trail.length) {
      want = Math.min(1, p.trail.length / (14 * U)) * 0.8;
      let near = Infinity;
      for (const q of game.players) {
        if (q === p || q.status !== 'alive') continue;
        for (let k = 0; k < p.trail.length; k += 3) {
          const c = p.trail[k];
          near = Math.min(near, Math.hypot((c % game.grid.size) - q.px, Math.floor(c / game.grid.size) - q.py));
        }
      }
      want = Math.max(want, 1 - Math.min(1, Math.max(0, near - U) / (5 * U)));
    }
    this.danger += (want - this.danger) * Math.min(1, dt * 4);
    this.territory.setDanger(p.id, this.danger);

  }

  private updateCamera(dt: number): void {
    const game = this.game;
    const aspect = this.camera.aspect;
    // Paper.io-style: mostly top-down with a gentle tilt.
    const tilt = new THREE.Vector3(0, 1, 0.5).normalize();
    const vfov = (this.camera.fov * Math.PI) / 180;
    const halfH = Math.tan(vfov / 2);
    const halfW = halfH * aspect;
    let desired: THREE.Vector3;
    let dist: number;

    if (this.mode === 'follow' && game) {
      const p = game.players[this.followId];
      desired = this.avatarPos[this.followId].clone();
      desired.y = 0;
      // Look a little ahead of where we're going.
      if (p.moving) desired.add(new THREE.Vector3(Math.cos(p.heading), 0, Math.sin(p.heading)).multiplyScalar(1.6));
      const across = aspect < 1 ? 13 / 2 / halfW : 16 / 2 / halfH;
      this.punch = Math.max(0, this.punch - dt * 1.5);
      // See more of the island as you grow, and while you're out on a long trail.
      const grow = Math.min(0.3, (game.percent(p.id) / 100) * 1.1) + Math.min(0.15, p.trail.length / (30 * UNIT));
      this.autoZoom += (1 + grow - this.autoZoom) * Math.min(1, dt * 1.2);
      dist = ((Math.max(12, across) * this.autoZoom) / this.zoom) * (1 - this.punch * 0.08);
    } else {
      desired = new THREE.Vector3(0, 0, 0);
      const span = (game ? game.map.size : 20) + 2.5;
      dist = Math.max(span / halfW, span / halfH) * 1.02;
    }

    // During the intro swoop the camera eases slowly from the whole island down to the rider.
    let ease = 1;
    if (this.swoop > 0) {
      this.swoop = Math.max(0, this.swoop - dt);
      const t = 1 - this.swoop / SWOOP_TIME;
      ease = 0.15 + 0.85 * t * t;
    }
    this.camTarget.lerp(desired, 1 - Math.exp(-dt * (this.mode === 'follow' ? 5 : 2) * ease));
    let offset = tilt.multiplyScalar(dist);
    if (this.mode === 'orbit') {
      const a = this.time * 0.06;
      offset = new THREE.Vector3(Math.sin(a) * dist * 0.5, dist * 0.86, Math.cos(a) * dist * 0.5);
    }
    const wantPos = this.camTarget.clone().add(offset);
    this.camPos.lerp(wantPos, 1 - Math.exp(-dt * (this.mode === 'follow' ? 12 : 3) * ease));
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.8);
      const s = this.shake * this.shake * 0.6;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.camTarget);

    this.sun.position.copy(this.camTarget).add(new THREE.Vector3(-8, 22, 10));
    this.sun.target.position.copy(this.camTarget);
    const ext = this.mode === 'follow' ? 14 : (game ? game.map.size : 20) + 3;
    const sc = this.sun.shadow.camera;
    if (sc.right !== ext) {
      Object.assign(sc, { left: -ext, right: ext, top: ext, bottom: -ext });
      sc.updateProjectionMatrix();
    }
  }
}
