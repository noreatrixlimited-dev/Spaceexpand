import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLAYER_COLORS } from '../config';
import { recolorTexture } from './assets';
import type { BlobMood } from './Blob';
import { toon } from './materials';
import { crownGeometry, starGeometry } from './shapes';

const dizzyStar = starGeometry(0.11, 0.05, 0.04);
const crownGeo = crownGeometry();
const sphere = new THREE.SphereGeometry(1, 20, 14);
const texCache = new Map<number, THREE.Texture>();

/** The toy-robot player character (Kenney model, recoloured per player) with idle/walk animations. */
export class Critter {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly model: THREE.Object3D;
  private readonly mats: THREE.MeshStandardMaterial[] = [];
  private readonly mixer: THREE.AnimationMixer;
  private readonly walk: THREE.AnimationAction | null;
  private readonly idle: THREE.AnimationAction | null;
  private readonly stars = new THREE.Group();
  private readonly crown: THREE.Mesh;
  private readonly shield: THREE.Mesh;
  private readonly marker: THREE.Mesh | null = null;
  private readonly shadow: THREE.Mesh;
  private yaw = 0;
  private targetYaw = 0;
  private squashKick = 0;
  private wasMoving = false;
  private wasGhost = false;
  mood: BlobMood = 'normal';
  moving = false;
  carrying = false;
  ghostColor: string | null = null;

  constructor(id: number, isHuman: boolean, gltf: GLTF) {
    this.model = gltf.scene.clone(true);
    let tex = texCache.get(id);
    if (!tex) {
      let base: THREE.Texture | null = null;
      this.model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && (m.material as THREE.MeshStandardMaterial).map) base = (m.material as THREE.MeshStandardMaterial).map;
      });
      if (base) {
        // Limbs/antenna use the purple palette column, the body the white one.
        tex = recolorTexture(base, { x: 448, y: 256, w: 64, h: 128 }, PLAYER_COLORS[id]);
        tex = recolorTexture(tex, { x: 256, y: 384, w: 64, h: 128 }, new THREE.Color(PLAYER_COLORS[id]).lerp(new THREE.Color('#ffffff'), 0.72));
        texCache.set(id, tex);
      }
    }
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = toon('#ffffff', { map: tex ?? (m.material as THREE.MeshStandardMaterial).map ?? null, roughness: 0.45, transparent: true });
      m.material = mat;
      m.castShadow = true;
      this.mats.push(mat);
    });
    this.model.scale.setScalar(1.6);
    this.body.add(this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = (n: string) => gltf.animations.find((a) => a.name === n);
    const w = clip('walk');
    const i = clip('idle');
    this.walk = w ? this.mixer.clipAction(w) : null;
    this.idle = i ? this.mixer.clipAction(i) : null;
    this.idle?.play();
    this.walk?.setEffectiveTimeScale(1.6);

    // soft contact shadow so the character reads even without shadow maps
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.4, 20),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.18, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.012;
    this.root.add(this.shadow);

    const starMat = toon('#ffd43b', { emissive: '#ffb703', emissiveIntensity: 0.3 });
    for (let k = 0; k < 3; k++) this.stars.add(new THREE.Mesh(dizzyStar, starMat));
    this.stars.position.y = 1.45;
    this.stars.visible = false;
    this.root.add(this.stars);

    this.crown = new THREE.Mesh(crownGeo, toon('#ffcf33', { side: THREE.DoubleSide, metalness: 0.3, roughness: 0.35 }));
    this.crown.position.y = 1.38;
    this.crown.visible = false;
    this.body.add(this.crown);

    this.shield = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: '#8fe3ff', transparent: true, opacity: 0.25, depthWrite: false }));
    this.shield.scale.setScalar(0.75);
    this.shield.position.y = 0.5;
    this.shield.visible = false;
    this.root.add(this.shield);

    if (isHuman) {
      const cone = new THREE.ConeGeometry(0.14, 0.24, 4);
      cone.rotateX(Math.PI);
      this.marker = new THREE.Mesh(cone, toon('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.3 }));
      this.root.add(this.marker);
    }
    this.root.add(this.body);
  }

  setFacing(dx: number, dz: number): void {
    if (dx === 0 && dz === 0) return;
    this.targetYaw = Math.atan2(dx, dz);
  }

  kick(amount = 0.35): void {
    this.squashKick = amount;
  }

  set crowned(v: boolean) {
    this.crown.visible = v;
  }
  set shielded(v: boolean) {
    this.shield.visible = v;
  }

  update(dt: number, time: number): void {
    let dy = this.targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 14);
    this.root.rotation.y = this.yaw;

    const ghost = this.mood === 'ghost';
    const bonked = this.mood === 'bonked';
    const moving = this.moving && !bonked;
    if (moving !== this.wasMoving && this.walk && this.idle) {
      const from = moving ? this.idle : this.walk;
      const to = moving ? this.walk : this.idle;
      to.reset().play();
      from.crossFadeTo(to, 0.15, false);
      this.wasMoving = moving;
    }
    this.mixer.update(bonked ? 0 : dt);

    this.squashKick *= Math.exp(-dt * 8);
    const sy = bonked ? 0.6 : 1 - this.squashKick + (this.mood === 'happy' ? Math.abs(Math.sin(time * 8)) * 0.12 : 0);
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    this.body.scale.set(sxz, sy, sxz);
    this.body.position.y = ghost ? 0.35 + Math.sin(time * 3) * 0.12 : this.mood === 'happy' ? Math.abs(Math.sin(time * 8)) * 0.3 : 0;
    this.body.rotation.z = bonked ? Math.sin(time * 9) * 0.15 : 0;

    if (ghost !== this.wasGhost) {
      for (const m of this.mats) {
        m.opacity = ghost ? 0.5 : 1;
        m.depthWrite = !ghost;
        m.emissive.set(ghost && this.ghostColor ? this.ghostColor : '#000000');
        m.emissiveIntensity = ghost ? 0.5 : 0;
      }
      this.shadow.visible = !ghost;
      this.wasGhost = ghost;
    }

    this.stars.visible = bonked;
    if (bonked) {
      this.stars.children.forEach((s, k) => {
        const a = time * 5 + (k * Math.PI * 2) / 3;
        s.position.set(Math.cos(a) * 0.36, Math.sin(time * 8 + k) * 0.04, Math.sin(a) * 0.36);
        s.rotation.y = a;
      });
    }
    if (this.marker) {
      this.marker.position.y = 1.9 + Math.sin(time * 4) * 0.08 + (this.carrying ? 0.45 : 0);
      this.marker.rotation.y = time * 2;
    }
    if (this.shield.visible) this.shield.scale.setScalar(0.75 + Math.sin(time * 6) * 0.03);
  }
}
