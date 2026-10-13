import * as THREE from 'three';
import { toon } from './materials';

interface P {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  spin: number;
  gravity: number;
}

/** Pooled instanced particles: sparkles, puffs and confetti. */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly pool: P[] = [];
  private next = 0;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private static readonly MAX = 500;

  constructor() {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    this.mesh = new THREE.InstancedMesh(geo, toon('#ffffff'), Particles.MAX);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < Particles.MAX; i++) {
      this.pool.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1, size: 0, spin: 0, gravity: 0 });
      this.mesh.setColorAt(i, this.color.set('#ffffff'));
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
  }

  private spawn(pos: THREE.Vector3, vel: THREE.Vector3, color: THREE.ColorRepresentation, size: number, life: number, gravity = 9): void {
    const i = this.next;
    this.next = (this.next + 1) % Particles.MAX;
    const p = this.pool[i];
    p.pos.copy(pos);
    p.vel.copy(vel);
    p.life = life;
    p.max = life;
    p.size = size;
    p.spin = Math.random() * 10;
    p.gravity = gravity;
    this.mesh.setColorAt(i, this.color.set(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  burst(pos: THREE.Vector3, color: THREE.ColorRepresentation, count = 10, speed = 3, size = 0.08): void {
    const v = new THREE.Vector3();
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random();
      v.set(Math.cos(a) * speed * (0.4 + Math.random() * 0.6), up * speed, Math.sin(a) * speed * (0.4 + Math.random() * 0.6));
      this.spawn(pos, v, color, size * (0.6 + Math.random() * 0.8), 0.6 + Math.random() * 0.5);
    }
  }

  puff(pos: THREE.Vector3, count = 6): void {
    const v = new THREE.Vector3();
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      v.set(Math.cos(a) * 1.2, 0.5 + Math.random() * 0.6, Math.sin(a) * 1.2);
      this.spawn(pos, v, '#ffffff', 0.14 + Math.random() * 0.08, 0.5, 0);
    }
  }

  /** Snow spray kicked sideways off the board when carving. */
  spray(pos: THREE.Vector3, side: THREE.Vector3, amount: number): void {
    const v = new THREE.Vector3();
    for (let k = 0; k < amount; k++) {
      v.copy(side).multiplyScalar(1 + Math.random() * 1.6);
      v.x += (Math.random() - 0.5) * 0.8;
      v.z += (Math.random() - 0.5) * 0.8;
      v.y = 0.8 + Math.random() * 1.2;
      this.spawn(pos, v, Math.random() < 0.5 ? '#ffffff' : '#e3efff', 0.05 + Math.random() * 0.05, 0.35 + Math.random() * 0.25, 5);
    }
  }

  confetti(pos: THREE.Vector3, count = 60): void {
    const colors = ['#ff7b7b', '#5ab8ff', '#4fd6a0', '#a98bf0', '#ffd43b', '#ff9ed2'];
    const v = new THREE.Vector3();
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      v.set(Math.cos(a) * (1 + Math.random() * 4), 5 + Math.random() * 6, Math.sin(a) * (1 + Math.random() * 4));
      this.spawn(pos, v, colors[k % colors.length], 0.08 + Math.random() * 0.06, 1.6 + Math.random(), 7);
    }
  }

  update(dt: number): void {
    const d = this.dummy;
    for (let i = 0; i < Particles.MAX; i++) {
      const p = this.pool[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.exp(-dt * 1.5));
      p.pos.addScaledVector(p.vel, dt);
      p.spin += dt * 8;
      const t = Math.max(0, p.life / p.max);
      d.position.copy(p.pos);
      d.rotation.set(p.spin, p.spin * 0.7, 0);
      d.scale.setScalar(p.life > 0 ? p.size * Math.min(1, t * 2.5) : 0);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
