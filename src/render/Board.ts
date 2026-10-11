import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PLAYER_COLORS, PLAYER_COLORS_SOFT } from '../config';
import type { Game } from '../core/Game';
import { lighten, toon } from './materials';
import { flowerCenterGeometry, petalsGeometry } from './shapes';

const OWNED_LIFT = 0.14;
const NEUTRAL_A = new THREE.Color('#fff4de');
const NEUTRAL_B = new THREE.Color('#fbe6c4');

/** World position of a grid cell centre. */
export function cellToWorld(size: number, x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x - size / 2 + 0.5, 0, y - size / 2 + 0.5);
}

/** The floating cookie island: tiles, trail flowers, base rock and clouds. */
export class Board {
  readonly group = new THREE.Group();
  private readonly size: number;
  private readonly tiles: THREE.InstancedMesh;
  private readonly petals: THREE.InstancedMesh;
  private readonly centers: THREE.InstancedMesh;
  private readonly base: THREE.Group;
  private readonly clouds: THREE.Group[] = [];

  // What is currently drawn, so we can animate toward the game state.
  private shownOwner: Int8Array;
  private shownVoid: Uint8Array;
  private shownTrail: Int8Array;
  private lift: Float32Array;
  private vel: Float32Array;
  private squash: Float32Array;
  private fallY: Float32Array;
  private pendingAt: Float32Array; // time at which an ownership change becomes visible
  private active = new Set<number>();
  private colorOf: THREE.Color[][] = [];

  // trail flower slots (compact instance list)
  private slotOfCell: Int32Array;
  private cellOfSlot: number[] = [];
  private flowerScale: Float32Array;
  private flowerTarget: Float32Array;
  private flowerRot: Float32Array;
  private flowersActive = new Set<number>();

  private time = 0;
  private baseScale = 1;
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();

  constructor(size: number) {
    this.size = size;
    const n = size * size;
    this.shownOwner = new Int8Array(n).fill(-2);
    this.shownVoid = new Uint8Array(n);
    this.shownTrail = new Int8Array(n).fill(-1);
    this.lift = new Float32Array(n);
    this.vel = new Float32Array(n);
    this.squash = new Float32Array(n);
    this.fallY = new Float32Array(n);
    this.pendingAt = new Float32Array(n);
    this.slotOfCell = new Int32Array(n).fill(-1);
    this.flowerScale = new Float32Array(n);
    this.flowerTarget = new Float32Array(n);
    this.flowerRot = new Float32Array(n);

    for (let p = 0; p < 4; p++) {
      this.colorOf.push([lighten(PLAYER_COLORS_SOFT[p], 0.15), new THREE.Color(PLAYER_COLORS_SOFT[p])]);
    }

    const tileGeo = new RoundedBoxGeometry(0.95, 0.7, 0.95, 2, 0.13);
    tileGeo.translate(0, -0.35, 0);
    this.tiles = new THREE.InstancedMesh(tileGeo, toon('#ffffff'), n);
    this.tiles.receiveShadow = true;
    for (let i = 0; i < n; i++) {
      this.tiles.setColorAt(i, NEUTRAL_A);
      this.writeTile(i);
    }
    this.group.add(this.tiles);

    this.petals = new THREE.InstancedMesh(petalsGeometry(), toon('#ffffff'), n);
    this.centers = new THREE.InstancedMesh(flowerCenterGeometry(), toon('#ffe066'), n);
    this.petals.count = 0;
    this.centers.count = 0;
    this.petals.frustumCulled = false;
    this.centers.frustumCulled = false;
    this.petals.castShadow = false;
    this.group.add(this.petals, this.centers);

    this.base = this.buildBase();
    this.group.add(this.base);
    this.buildClouds();
  }

  private buildBase(): THREE.Group {
    const g = new THREE.Group();
    const s = this.size + 0.3;
    const cake = new THREE.Mesh(new RoundedBoxGeometry(s, 1.6, s, 3, 0.5), toon('#f3c690'));
    cake.position.y = -1.25;
    const frosting = new THREE.Mesh(new RoundedBoxGeometry(s + 0.25, 0.45, s + 0.25, 3, 0.2), toon('#fff7ea'));
    frosting.position.y = -0.55;
    const rock = new THREE.Mesh(new THREE.ConeGeometry(s * 0.68, 9, 4, 1), toon('#c98f5f'));
    rock.rotation.y = Math.PI / 4;
    rock.rotation.x = Math.PI;
    rock.position.y = -6.4;
    const rock2 = new THREE.Mesh(new THREE.ConeGeometry(s * 0.3, 6, 5, 1), toon('#b97c4f'));
    rock2.rotation.x = Math.PI;
    rock2.position.set(s * 0.22, -7.5, -s * 0.15);
    g.add(cake, frosting, rock, rock2);
    return g;
  }

  private buildClouds(): void {
    const mat = toon('#ffffff', { transparent: true, opacity: 0.95 });
    const puff = new THREE.SphereGeometry(1, 14, 10);
    for (let k = 0; k < 9; k++) {
      const c = new THREE.Group();
      const parts = 3 + (k % 3);
      for (let j = 0; j < parts; j++) {
        const m = new THREE.Mesh(puff, mat);
        const r = 1.4 + ((k * 7 + j * 3) % 5) * 0.35;
        m.scale.setScalar(r);
        m.position.set(j * 1.8 - parts * 0.9, ((j * 5) % 3) * 0.3, ((j * 3) % 2) * 0.8);
        c.add(m);
      }
      const a = (k / 9) * Math.PI * 2;
      const rad = this.size * 0.75 + (k % 3) * 4;
      c.position.set(Math.cos(a) * rad, -5 - (k % 4) * 2.2, Math.sin(a) * rad);
      c.userData.angle = a;
      c.userData.rad = rad;
      c.userData.speed = 0.01 + (k % 3) * 0.006;
      this.clouds.push(c);
      this.group.add(c);
    }
  }

  private neutralColor(i: number): THREE.Color {
    const x = i % this.size;
    const y = Math.floor(i / this.size);
    return (x + y) % 2 === 0 ? NEUTRAL_A : NEUTRAL_B;
  }

  private writeTile(i: number): void {
    const x = i % this.size;
    const y = Math.floor(i / this.size);
    const d = this.dummy;
    cellToWorld(this.size, x, y, d.position);
    d.position.y = this.lift[i] + this.fallY[i];
    const sq = this.squash[i];
    d.scale.set(1 - sq * 0.3, 1 + sq, 1 - sq * 0.3);
    if (this.shownVoid[i] && this.fallY[i] < -8) d.scale.setScalar(0.0001);
    d.rotation.set(this.fallY[i] * 0.05, 0, this.fallY[i] * -0.04);
    d.updateMatrix();
    this.tiles.setMatrixAt(i, d.matrix);
  }

  /** Schedule a wave of tiles popping up, rippling out from (fx, fy). */
  captureWave(cells: number[], fx: number, fy: number): void {
    const now = this.time;
    for (const i of cells) {
      const x = i % this.size;
      const y = Math.floor(i / this.size);
      const dist = Math.hypot(x - fx, y - fy);
      this.pendingAt[i] = now + dist * 0.028;
    }
  }

  voidWave(cells: number[]): void {
    for (const i of cells) this.pendingAt[i] = this.time + Math.random() * 0.6;
  }

  /** Reconcile drawn state with game state and animate. Returns cells that popped this frame. */
  update(game: Game, dt: number, onPop?: (cell: number, owner: number) => void): void {
    this.time += dt;
    const g = game.grid;
    const n = g.owner.length;
    let colorsDirty = false;

    for (let i = 0; i < n; i++) {
      const o = g.voided[i] ? -1 : g.owner[i];
      if (g.voided[i] !== this.shownVoid[i] && this.time >= this.pendingAt[i]) {
        this.shownVoid[i] = 1;
        this.vel[i] = 2.5;
        this.active.add(i);
      }
      if (o !== this.shownOwner[i] && this.time >= this.pendingAt[i]) {
        const first = this.shownOwner[i] === -2;
        this.shownOwner[i] = o;
        const c = o >= 0 ? this.colorOf[o][((i % this.size) + Math.floor(i / this.size)) % 2 === 0 ? 0 : 1] : this.neutralColor(i);
        this.tiles.setColorAt(i, c);
        colorsDirty = true;
        if (!first) {
          this.vel[i] += o >= 0 ? 4.2 : -1;
          this.squash[i] = o >= 0 ? 0.35 : 0;
          if (o >= 0 && onPop) onPop(i, o);
        } else {
          this.lift[i] = o >= 0 ? OWNED_LIFT : 0;
        }
        this.active.add(i);
      }
      // trails
      const t = g.trail[i];
      if (t !== this.shownTrail[i]) {
        if (t >= 0) this.addFlower(i, t);
        else this.removeFlower(i);
        this.shownTrail[i] = t;
      }
    }
    if (colorsDirty && this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;

    // springs
    let matDirty = false;
    for (const i of this.active) {
      if (this.shownVoid[i]) {
        this.vel[i] -= 18 * dt;
        this.fallY[i] += this.vel[i] * dt;
        this.writeTile(i);
        matDirty = true;
        if (this.fallY[i] < -9) this.active.delete(i);
        continue;
      }
      const target = this.shownOwner[i] >= 0 ? OWNED_LIFT : 0;
      const k = 180;
      const damp = 14;
      // Small fixed sub-steps keep the spring stable even on slow frames.
      const steps = Math.ceil(dt / (1 / 120));
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        this.vel[i] += ((target - this.lift[i]) * k - this.vel[i] * damp) * h;
        this.lift[i] += this.vel[i] * h;
      }
      this.squash[i] *= Math.exp(-dt * 9);
      this.writeTile(i);
      matDirty = true;
      if (Math.abs(this.vel[i]) < 0.01 && Math.abs(target - this.lift[i]) < 0.002 && this.squash[i] < 0.01) {
        this.lift[i] = target;
        this.squash[i] = 0;
        this.vel[i] = 0;
        this.writeTile(i);
        this.active.delete(i);
      }
    }
    if (matDirty) this.tiles.instanceMatrix.needsUpdate = true;

    this.updateFlowers(dt);

    // Island base shrinks with the void.
    const targetScale = Math.max(0.2, (this.size - game.voidRing * 2) / this.size);
    this.baseScale += (targetScale - this.baseScale) * Math.min(1, dt * 2);
    this.base.scale.set(this.baseScale, 1, this.baseScale);

    for (const c of this.clouds) {
      c.userData.angle += c.userData.speed * dt;
      c.position.x = Math.cos(c.userData.angle) * c.userData.rad;
      c.position.z = Math.sin(c.userData.angle) * c.userData.rad;
    }
  }

  private addFlower(cell: number, owner: number): void {
    let slot = this.slotOfCell[cell];
    if (slot < 0) {
      slot = this.cellOfSlot.length;
      this.cellOfSlot.push(cell);
      this.slotOfCell[cell] = slot;
      this.petals.count = this.centers.count = this.cellOfSlot.length;
      this.flowerScale[cell] = 0;
      this.flowerRot[cell] = Math.random() * Math.PI * 2;
    }
    this.petals.setColorAt(slot, this.tmpColor.set(PLAYER_COLORS[owner]));
    if (this.petals.instanceColor) this.petals.instanceColor.needsUpdate = true;
    this.flowerTarget[cell] = 1;
    this.flowersActive.add(cell);
  }

  private removeFlower(cell: number): void {
    if (this.slotOfCell[cell] < 0) return;
    this.flowerTarget[cell] = 0;
    this.flowersActive.add(cell);
  }

  private freeSlot(cell: number): void {
    const slot = this.slotOfCell[cell];
    const last = this.cellOfSlot.length - 1;
    const lastCell = this.cellOfSlot[last];
    if (slot !== last) {
      // move last instance into the freed slot
      this.cellOfSlot[slot] = lastCell;
      this.slotOfCell[lastCell] = slot;
      const m = new THREE.Matrix4();
      this.petals.getMatrixAt(last, m);
      this.petals.setMatrixAt(slot, m);
      this.centers.setMatrixAt(slot, m);
      const c = new THREE.Color();
      this.petals.getColorAt(last, c);
      this.petals.setColorAt(slot, c);
      if (this.petals.instanceColor) this.petals.instanceColor.needsUpdate = true;
    }
    this.cellOfSlot.pop();
    this.slotOfCell[cell] = -1;
    this.petals.count = this.centers.count = this.cellOfSlot.length;
  }

  private updateFlowers(dt: number): void {
    if (!this.flowersActive.size) return;
    const d = this.dummy;
    for (const cell of this.flowersActive) {
      const target = this.flowerTarget[cell];
      const s = this.flowerScale[cell];
      const ns = target > s ? Math.min(target, s + dt * 6) : Math.max(0, s - dt * 5);
      this.flowerScale[cell] = ns;
      if (ns <= 0 && target === 0) {
        this.freeSlot(cell);
        this.flowersActive.delete(cell);
        continue;
      }
      const slot = this.slotOfCell[cell];
      cellToWorld(this.size, cell % this.size, Math.floor(cell / this.size), d.position);
      d.position.y = this.lift[cell] + 0.01;
      // overshoot pop
      const pop = target > 0 ? Math.sin(Math.min(1, ns) * Math.PI) * 0.35 : 0;
      d.scale.setScalar(Math.max(0.0001, ns + pop));
      d.rotation.set(0, this.flowerRot[cell], 0);
      d.updateMatrix();
      this.petals.setMatrixAt(slot, d.matrix);
      this.centers.setMatrixAt(slot, d.matrix);
      if (ns >= target && target > 0) this.flowersActive.delete(cell);
    }
    this.petals.instanceMatrix.needsUpdate = true;
    this.centers.instanceMatrix.needsUpdate = true;
  }

  liftAt(cell: number): number {
    return this.lift[cell] + this.fallY[cell];
  }
}
