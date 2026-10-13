import * as THREE from 'three';
import { CONFIG, PLAYER_COLORS, UNIT } from '../config';
import type { Game } from '../core/Game';
import { toon } from './materials';

const ballGeo = new THREE.SphereGeometry(1, 16, 12);
const ringGeo = new THREE.RingGeometry(0.75, 1, 32);
const PICKUP_COLORS = ['#ff6b6b', '#ffd43b', '#4dabf7', '#69db7c', '#b197fc'];

/**
 * Everything about balls on screen: the ammo floating around each character,
 * balls in flight (with a landing marker so players can dodge) and pickups.
 */
export class BallsView {
  readonly group = new THREE.Group();
  private readonly ammo: THREE.InstancedMesh[] = [];
  private readonly flying = new Map<number, { ball: THREE.Mesh; marker: THREE.Mesh }>();
  private readonly pickups = new Map<number, THREE.Group>();
  private readonly mats: THREE.MeshStandardMaterial[];
  private readonly markerMats: THREE.MeshBasicMaterial[];
  private readonly dummy = new THREE.Object3D();
  private readonly size: number;

  constructor(size: number) {
    this.size = size;
    this.mats = PLAYER_COLORS.map((c) => toon(c, { roughness: 0.3, emissive: new THREE.Color(c), emissiveIntensity: 0.15 }));
    this.markerMats = PLAYER_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.75, depthWrite: false }));
    for (let id = 0; id < 4; id++) {
      const m = new THREE.InstancedMesh(ballGeo, this.mats[id], CONFIG.ballCapMax + CONFIG.pickupBalls);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      this.ammo.push(m);
      this.group.add(m);
    }
  }

  /** Grid position (cells) -> world units. */
  private toWorld(x: number, y: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set((x - this.size / 2) / UNIT, 0, (y - this.size / 2) / UNIT);
  }

  update(game: Game, avatarPos: THREE.Vector3[], time: number): void {
    const d = this.dummy;
    // Ammo: small balls circling each character's waist.
    for (const p of game.players) {
      const m = this.ammo[p.id];
      const n = p.status === 'out' || p.status === 'bonked' ? 0 : p.balls;
      m.count = n;
      const c = avatarPos[p.id];
      for (let k = 0; k < n; k++) {
        const a = time * 2.2 + (k / Math.max(1, n)) * Math.PI * 2;
        const r = 0.62 + (n > 8 ? 0.12 * (k % 2) : 0);
        d.position.set(c.x + Math.cos(a) * r, c.y + 0.55 + Math.sin(time * 3 + k) * 0.06 + (k % 2) * 0.12, c.z + Math.sin(a) * r);
        d.scale.setScalar(0.1);
        d.updateMatrix();
        m.setMatrixAt(k, d.matrix);
      }
      m.instanceMatrix.needsUpdate = true;
    }

    // Balls in flight: lobbed arc + a pulsing marker where they'll land.
    const seen = new Set<number>();
    const v = new THREE.Vector3();
    for (const pr of game.projectiles) {
      seen.add(pr.id);
      let f = this.flying.get(pr.id);
      if (!f) {
        const ball = new THREE.Mesh(ballGeo, this.mats[pr.owner]);
        ball.scale.setScalar(0.22);
        ball.castShadow = true;
        const marker = new THREE.Mesh(ringGeo, this.markerMats[pr.owner]);
        marker.rotation.x = -Math.PI / 2;
        this.group.add(ball, marker);
        f = { ball, marker };
        this.flying.set(pr.id, f);
      }
      const t = Math.min(1, pr.t / pr.dur);
      this.toWorld(pr.sx + (pr.tx - pr.sx) * t, pr.sy + (pr.ty - pr.sy) * t, v);
      v.y = 0.7 + Math.sin(t * Math.PI) * (1.2 + 1.6 * (pr.dur / CONFIG.throwTime));
      f.ball.position.copy(v);
      f.ball.rotation.x = t * 12;
      this.toWorld(pr.tx, pr.ty, f.marker.position);
      f.marker.position.y = 0.09;
      f.marker.scale.setScalar((CONFIG.splatRadius / UNIT) * (1.05 - 0.35 * t) + Math.sin(time * 20) * 0.04);
    }
    for (const [id, f] of this.flying) {
      if (seen.has(id)) continue;
      this.group.remove(f.ball, f.marker);
      this.flying.delete(id);
    }

    // Pickups: a little bouncing pile of rainbow balls.
    const live = new Set<number>();
    for (const pk of game.pickups) {
      live.add(pk.id);
      let g = this.pickups.get(pk.id);
      if (!g) {
        g = new THREE.Group();
        for (let k = 0; k < 3; k++) {
          const b = new THREE.Mesh(ballGeo, toon(PICKUP_COLORS[(pk.id + k) % PICKUP_COLORS.length], { roughness: 0.3 }));
          b.scale.setScalar(0.16);
          b.position.set(Math.cos(k * 2.1) * 0.16, 0.16 + (k === 2 ? 0.2 : 0), Math.sin(k * 2.1) * 0.16);
          b.castShadow = true;
          g.add(b);
        }
        this.toWorld(pk.x + 0.5, pk.y + 0.5, g.position);
        g.scale.setScalar(0.01);
        this.group.add(g);
        this.pickups.set(pk.id, g);
      }
      g.position.y = 0.05 + Math.abs(Math.sin(time * 4 + pk.id)) * 0.18;
      g.rotation.y = time * 1.5;
      g.scale.setScalar(Math.min(1, g.scale.x + 0.08));
    }
    for (const [id, g] of this.pickups) {
      if (live.has(id)) continue;
      this.group.remove(g);
      this.pickups.delete(id);
    }
  }
}
