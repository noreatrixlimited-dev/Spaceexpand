import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { NEUTRAL_TILE, PLAYER_COLORS, TILE_COLORS } from '../config';
import type { Game } from '../core/Game';
import { Rng } from '../core/rng';
import { bakeMeshes } from './assets';
import { toon } from './materials';
import { flowerCenterGeometry, petalsGeometry } from './shapes';

const OWNED_LIFT = 0.07;
const NEUTRAL_A = new THREE.Color(NEUTRAL_TILE[0]);
const NEUTRAL_B = new THREE.Color(NEUTRAL_TILE[1]);

interface DecorSlot {
  mesh: number; // index into decorMeshes
  inst: number;
  dx: number;
  dz: number;
  rot: number;
  scale: number;
}

/** World position of a grid cell centre. */
export function cellToWorld(size: number, x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x - size / 2 + 0.5, 0, y - size / 2 + 0.5);
}

/** The playable grid: tiles, small plants on tiles, and trail flowers. */
export class Board {
  readonly group = new THREE.Group();
  private readonly size: number;
  private readonly tiles: THREE.InstancedMesh;
  private readonly petals: THREE.InstancedMesh;
  private readonly centers: THREE.InstancedMesh;
  private readonly decorMeshes: THREE.InstancedMesh[] = [];
  private readonly decorOf = new Map<number, DecorSlot[]>();

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
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();

  constructor(size: number, plants: THREE.Object3D[] = [], avoid: Set<number> = new Set()) {
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
      this.colorOf.push([new THREE.Color(TILE_COLORS[p][0]), new THREE.Color(TILE_COLORS[p][1])]);
    }

    const tileGeo = new RoundedBoxGeometry(0.965, 0.6, 0.965, 2, 0.085);
    tileGeo.translate(0, -0.3, 0);
    this.tiles = new THREE.InstancedMesh(tileGeo, toon('#ffffff', { roughness: 0.55 }), n);
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

    this.buildDecor(plants, avoid);
  }

  /** Sprinkle small leafy plants on a few tiles; they ride along with tile animations. */
  private buildDecor(plants: THREE.Object3D[], avoid: Set<number>): void {
    if (!plants.length) return;
    const rng = new Rng(3);
    const n = this.size * this.size;
    const cells: number[][] = plants.map(() => []);
    for (let i = 0; i < n; i++) {
      if (avoid.has(i) || rng.next() > 0.075) continue;
      cells[rng.int(0, plants.length - 1)].push(i);
    }
    plants.forEach((p, k) => {
      const parts = bakeMeshes(p);
      parts.forEach(({ geometry, material }) => {
        const mat = toon('#ffffff', { map: (material as THREE.MeshStandardMaterial).map ?? null });
        const mesh = new THREE.InstancedMesh(geometry, mat, Math.max(1, cells[k].length));
        mesh.count = cells[k].length;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        const meshIdx = this.decorMeshes.length;
        this.decorMeshes.push(mesh);
        this.group.add(mesh);
        cells[k].forEach((cell, inst) => {
          const slot: DecorSlot = {
            mesh: meshIdx,
            inst,
            dx: (rng.next() - 0.5) * 0.4,
            dz: (rng.next() - 0.5) * 0.4,
            rot: rng.next() * Math.PI * 2,
            scale: 0.75 + rng.next() * 0.3,
          };
          const list = this.decorOf.get(cell) ?? [];
          list.push(slot);
          this.decorOf.set(cell, list);
          this.writeDecor(cell, slot);
        });
      });
    });
  }

  private writeDecor(cell: number, slot: DecorSlot): void {
    const d = this.dummy;
    cellToWorld(this.size, cell % this.size, Math.floor(cell / this.size), d.position);
    d.position.x += slot.dx;
    d.position.z += slot.dz;
    d.position.y = this.lift[cell] + this.fallY[cell];
    d.rotation.set(0, slot.rot, 0);
    const gone = this.shownVoid[cell] && this.fallY[cell] < -8;
    d.scale.setScalar(gone ? 0.0001 : slot.scale);
    d.updateMatrix();
    this.decorMeshes[slot.mesh].setMatrixAt(slot.inst, d.matrix);
    this.decorMeshes[slot.mesh].instanceMatrix.needsUpdate = true;
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
    const decor = this.decorOf.get(i);
    if (decor) for (const slot of decor) this.writeDecor(i, slot);
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
      if (this.shownOwner[i] === -2 && g.voided[i]) {
        // Cut away from the start (rounded corners): just hide it.
        this.shownOwner[i] = -1;
        this.shownVoid[i] = 1;
        this.fallY[i] = -20;
        this.writeTile(i);
        this.tiles.instanceMatrix.needsUpdate = true;
        continue;
      }
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
      d.scale.setScalar(Math.max(0.0001, (ns + pop) * 1.2));
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
