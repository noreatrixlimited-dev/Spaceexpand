import * as THREE from 'three';
import { PLAYER_COLORS } from '../config';
import type { Game, GameEvent } from '../core/Game';
import { DX, DY } from '../core/Grid';
import { Blob } from './Blob';
import { Board, cellToWorld } from './Board';
import { Critter } from './Critter';
import { EggView } from './Egg';
import { toon } from './materials';
import { Particles } from './Particles';
import { Post } from './post';
import { Scenery, type Art } from './Scenery';
import { starGeometry } from './shapes';

type Avatar = Blob | Critter;
export type Quality = 'high' | 'low';

export type CameraMode = 'follow' | 'overview' | 'orbit';

/** Owns the Three.js renderer and turns game state + events into a cute 3D scene. */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1, 0.5, 400);
  private readonly sun: THREE.DirectionalLight;
  private readonly particles = new Particles();
  private readonly starMesh: THREE.Mesh;
  private readonly matchGroup = new THREE.Group();
  private game: Game | null = null;
  private board: Board | null = null;
  private blobs: Avatar[] = [];
  private art: Art | null = null;
  private scenery: Scenery | null = null;
  private post: Post | null = null;
  private quality: Quality;
  private eggs: EggView[] = [];
  private blobPos: THREE.Vector3[] = [];
  private nestPos: THREE.Vector3[] = [];
  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3(0, 40, 30);
  private shake = 0;
  private time = 0;
  private starScale = 0;
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
    this.renderer.toneMappingExposure = 1.08;

    // Warm golden daylight with a cool sky fill.
    this.scene.add(new THREE.HemisphereLight('#e3f4ff', '#d9a36a', 1.35));
    this.sun = new THREE.DirectionalLight('#fff0d4', 2.8);
    this.sun.position.set(-10, 22, 14);
    this.sun.castShadow = quality === 'high';
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    const sc = this.sun.shadow.camera;
    sc.left = -16;
    sc.right = 16;
    sc.top = 16;
    sc.bottom = -16;
    sc.near = 1;
    sc.far = 60;
    this.sun.shadow.bias = -0.0015;
    this.scene.add(this.sun, this.sun.target);

    this.starMesh = new THREE.Mesh(starGeometry(0.42, 0.19, 0.16), toon('#ffd43b', { emissive: '#ffb703', emissiveIntensity: 0.35 }));
    this.starMesh.castShadow = true;
    this.starMesh.visible = false;
    this.scene.add(this.matchGroup, this.particles.mesh, this.starMesh);
    this.buildPost();
    this.resize();
  }

  private pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 2 : 1.25);
  }

  /** Outlines + light colour grade on high quality; no blur, bloom or fog. */
  private buildPost(): void {
    this.post = null;
    if (this.quality !== 'high') return;
    this.post = new Post(this.renderer, this.scene, this.camera, {
      outline: { color: '#3b2340', thickness: 1, strength: 0.6 },
      grade: { saturation: 1.1, warmth: 0.08, vignette: 0.12, contrast: 1.04 },
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

  setGame(game: Game): void {
    // tear down previous match
    this.matchGroup.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.matchGroup.clear();
    this.game = game;
    const size = game.grid.size;
    // Keep plants off the nests and their surroundings.
    const avoid = new Set<number>();
    for (const c of game.cores) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (game.grid.inside(c.x + dx, c.y + dy)) avoid.add(game.grid.idx(c.x + dx, c.y + dy));
    }
    this.board = new Board(size, this.art?.plants ?? [], avoid);
    this.matchGroup.add(this.board.group);
    if (!this.scenery) {
      this.scenery = new Scenery(size, this.art);
      this.scene.add(this.scenery.group);
    } else {
      this.scene.remove(this.scenery.group);
      this.scenery = new Scenery(size, this.art);
      this.scene.add(this.scenery.group);
    }
    this.blobs = [];
    this.eggs = [];
    this.blobPos = [];
    this.nestPos = [];
    for (const p of game.players) {
      const b: Avatar = this.art ? new Critter(p.id, p.isHuman, this.art.character) : new Blob(p.id, p.isHuman);
      this.blobs.push(b);
      const pos = cellToWorld(size, p.x, p.y);
      this.blobPos.push(pos.clone());
      b.root.position.copy(pos);
      b.setFacing(-(pos.x), -(pos.z));
      this.matchGroup.add(b.root);
      const c = game.cores[p.id];
      const egg = new EggView(p.id);
      const np = cellToWorld(size, c.x, c.y);
      this.nestPos.push(np.clone());
      egg.nest.position.copy(np);
      egg.egg.position.copy(np);
      this.eggs.push(egg);
      this.matchGroup.add(egg.nest, egg.egg);
    }
    this.starScale = 0;
    this.board.update(game, 0);
  }

  addShake(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  private worldOf(x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
    return cellToWorld(this.game!.grid.size, x, y, out);
  }

  handleEvents(events: GameEvent[], humanId: number | null): void {
    const game = this.game;
    if (!game || !this.board) return;
    const v = new THREE.Vector3();
    for (const e of events) {
      switch (e.type) {
        case 'capture': {
          this.board.captureWave(e.cells, e.fromX, e.fromY);
          this.blobs[e.pid].kick(0.3);
          this.particles.burst(this.blobPos[e.pid].clone().setY(0.6), PLAYER_COLORS[e.pid], Math.min(24, 6 + e.cells.length / 3), 3.2);
          break;
        }
        case 'bonk': {
          const pos = this.blobPos[e.victim].clone().setY(0.5);
          this.particles.burst(pos, PLAYER_COLORS[e.victim], 18, 4);
          this.particles.puff(pos, 6);
          const step = Math.max(1, Math.floor(e.trail.length / 14));
          for (let k = 0; k < e.trail.length; k += step) {
            const c = e.trail[k];
            this.worldOf(c % game.grid.size, Math.floor(c / game.grid.size), v).setY(0.2);
            this.particles.burst(v, PLAYER_COLORS[e.victim], 2, 2, 0.07);
          }
          if (e.victim === humanId) this.addShake(0.6);
          else if (e.by === humanId) this.addShake(0.25);
          break;
        }
        case 'shielded':
          this.particles.burst(this.blobPos[e.pid].clone().setY(0.6), '#8fe3ff', 16, 3);
          break;
        case 'respawn':
          this.particles.puff(this.blobPos[e.pid].clone().setY(0.3), 8);
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
          this.particles.puff(this.blobPos[e.carrier].clone().setY(0.8), 10);
          break;
        case 'coreCaptured': {
          const c = game.cores[e.by];
          this.board.captureWave(e.cells, c.x, c.y);
          this.particles.confetti(this.nestPos[e.by].clone().setY(1), 70);
          this.addShake(0.4);
          break;
        }
        case 'freed':
          this.particles.confetti(this.blobPos[e.pid].clone().setY(1), 40);
          break;
        case 'voidRing':
          this.board.voidWave(e.cells);
          this.addShake(0.2);
          break;
        case 'power':
          this.particles.burst(this.blobPos[e.pid].clone().setY(0.8), '#ffd43b', 24, 4.5);
          break;
        case 'starSpawn':
          this.particles.burst(this.worldOf(game.star.x, game.star.y, v).setY(0.8), '#ffe066', 16, 3);
          break;
        case 'gameOver':
          if (e.winner >= 0) this.particles.confetti(this.blobPos[e.winner].clone().setY(1), 120);
          break;
        default:
          break;
      }
    }
  }

  frame(dt: number): void {
    this.time += dt;
    const game = this.game;
    if (game && this.board) {
      const size = game.grid.size;
      const tmp = new THREE.Vector3();
      this.board.update(game, dt, (cell, owner) => {
        if (Math.random() < 0.12) {
          this.worldOf(cell % size, Math.floor(cell / size), tmp).setY(0.3);
          this.particles.burst(tmp, PLAYER_COLORS[owner], 1, 1.5, 0.06);
        }
      });

      // leader crown
      const leader = game.time > 8 ? game.leader() : -1;

      for (const p of game.players) {
        const b = this.blobs[p.id];
        let fx = p.x;
        let fy = p.y;
        if (p.dir !== null && p.status !== 'bonked') {
          fx += DX[p.dir] * p.progress;
          fy += DY[p.dir] * p.progress;
        }
        const target = this.worldOf(fx, fy, tmp);
        const cell = game.grid.idx(p.x, p.y);
        target.y = Math.max(-0.2, this.board.liftAt(cell));
        const cur = this.blobPos[p.id];
        if (cur.distanceTo(target) > 3) cur.copy(target);
        else cur.lerp(target, 1 - Math.exp(-dt * 22));
        b.root.position.copy(cur);
        if (p.dir !== null) b.setFacing(DX[p.dir], DY[p.dir]);
        b.moving = p.dir !== null && p.status !== 'bonked';
        b.mood = p.status === 'shade' ? 'ghost' : p.status === 'bonked' ? 'bonked' : game.over && game.winner === p.id ? 'happy' : 'normal';
        b.ghostColor = p.shadeOf >= 0 ? PLAYER_COLORS[p.shadeOf] : null;
        b.carrying = p.carrying >= 0;
        b.crowned = leader === p.id && p.status !== 'shade';
        b.shielded = p.shield;
        b.update(dt, this.time);

        const c = game.cores[p.id];
        const egg = this.eggs[p.id];
        const np = this.worldOf(c.x, c.y, new THREE.Vector3());
        np.y = this.board.liftAt(game.grid.idx(c.x, c.y));
        this.nestPos[p.id].lerp(np, 1 - Math.exp(-dt * 6));
        egg.nest.position.copy(this.nestPos[p.id]);
        egg.captured = c.state === 'captured';
        egg.carried = c.state === 'carried';
        egg.threatened = c.threatened;
        if (c.state === 'carried' && c.carrier >= 0) {
          const carrierPos = this.blobPos[c.carrier];
          egg.egg.position.lerp(tmp.copy(carrierPos).setY(carrierPos.y + (this.art ? 1.6 : 0.75)), 1 - Math.exp(-dt * 20));
        } else {
          egg.egg.position.lerp(this.nestPos[p.id], 1 - Math.exp(-dt * 10));
        }
        egg.update(dt, this.time, c.hearts);
      }

      // star power-up
      const want = game.star.active ? 1 : 0;
      this.starScale += (want - this.starScale) * Math.min(1, dt * 8);
      this.starMesh.visible = this.starScale > 0.02;
      if (this.starMesh.visible) {
        this.worldOf(game.star.x, game.star.y, this.starMesh.position);
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

  private updateCamera(dt: number): void {
    const game = this.game;
    const size = game ? game.grid.size : 40;
    const aspect = this.camera.aspect;
    const tilt = new THREE.Vector3(0, 1, 0.98).normalize();
    const vfov = (this.camera.fov * Math.PI) / 180;
    let desired: THREE.Vector3;
    let dist: number;

    if (this.mode === 'follow' && game) {
      desired = this.blobPos[this.followId].clone();
      desired.y = 0;
      // Keep ~15 cells across on phones, ~20 tall on wide screens.
      const halfH = Math.tan(vfov / 2);
      const halfW = halfH * aspect;
      const cells = aspect < 1 ? 10 / 2 / halfW : 13 / 2 / halfH;
      dist = Math.max(11, cells) / this.zoom;
    } else {
      desired = new THREE.Vector3(0, 0, 0);
      const halfH = Math.tan(vfov / 2);
      const halfW = halfH * aspect;
      const span = (size + 4) / 2;
      dist = Math.max(span / halfW, span / halfH) * 0.95;
    }

    this.camTarget.lerp(desired, 1 - Math.exp(-dt * (this.mode === 'follow' ? 6 : 2)));
    let offset = tilt.multiplyScalar(dist);
    if (this.mode === 'orbit') {
      const a = this.time * 0.08;
      offset = new THREE.Vector3(Math.sin(a) * dist * 0.62, dist * 0.8, Math.cos(a) * dist * 0.62);
    }
    const wantPos = this.camTarget.clone().add(offset);
    this.camPos.lerp(wantPos, 1 - Math.exp(-dt * (this.mode === 'follow' ? 10 : 3)));
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.8);
      const s = this.shake * this.shake * 0.6;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.lookAt(this.camTarget);

    this.sun.position.copy(this.camTarget).add(new THREE.Vector3(-8, 20, 10));
    this.sun.target.position.copy(this.camTarget);
    const ext = this.mode === 'follow' ? 16 : size * 0.75;
    const sc = this.sun.shadow.camera;
    if (sc.right !== ext) {
      sc.left = -ext;
      sc.right = ext;
      sc.top = ext;
      sc.bottom = -ext;
      sc.updateProjectionMatrix();
    }
  }
}
