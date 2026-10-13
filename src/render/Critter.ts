import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLAYER_COLORS } from '../config';
import { recolorTexture } from './assets';
import type { BlobMood } from './Blob';
import { toon } from './materials';
import { crownGeometry, starGeometry } from './shapes';
import { buildHat } from './hats';
import { SKINS, type Skin } from '../skins';

const dizzyStar = starGeometry(0.11, 0.05, 0.04);
const crownGeo = crownGeometry();
const sphere = new THREE.SphereGeometry(1, 20, 14);
const texCache = new Map<string, THREE.Texture>();

/** A board shaped like a little snowboard: rounded ends, slight upturned nose and tail. */
function boardGeometry(): THREE.BufferGeometry {
  const L = 0.62; // half length
  const W = 0.22; // half width
  const r = 0.2;
  const s = new THREE.Shape();
  s.moveTo(-W + r, -L);
  s.lineTo(W - r, -L);
  s.quadraticCurveTo(W, -L, W, -L + r);
  s.lineTo(W, L - r);
  s.quadraticCurveTo(W, L, W - r, L);
  s.lineTo(-W + r, L);
  s.quadraticCurveTo(-W, L, -W, L - r);
  s.lineTo(-W, -L + r);
  s.quadraticCurveTo(-W, -L, -W + r, -L);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 8, steps: 1 });
  g.rotateX(Math.PI / 2); // lie flat; shape y becomes local z (along the board)
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const over = Math.max(0, Math.abs(z) - 0.38);
    pos.setY(i, pos.getY(i) + over * over * 1.6); // rocker: tips curl up
  }
  g.computeVertexNormals();
  g.translate(0, 0.09, 0);
  return g;
}
const boardGeo = boardGeometry();

/** The toy-robot player character (Kenney model, recoloured per player) riding a board. */
export class Critter {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly model: THREE.Object3D;
  private readonly mats: THREE.MeshStandardMaterial[] = [];
  private readonly mixer: THREE.AnimationMixer;
  private readonly idle: THREE.AnimationAction | null;
  private readonly stars = new THREE.Group();
  private readonly crown: THREE.Mesh;
  private readonly shield: THREE.Mesh;
  private readonly marker: THREE.Mesh | null = null;
  private readonly shadow: THREE.Mesh;
  private readonly board = new THREE.Group();
  private leanCur = 0;
  private hatLift = 0;
  private yaw = 0;
  private targetYaw = 0;
  private squashKick = 0;
  private wasMoving = false;
  private wasGhost = false;
  mood: BlobMood = 'normal';
  moving = false;
  carrying = false;
  ghostColor: string | null = null;
  /** -1..1, how hard we're carving (positive = turning right). */
  lean = 0;

  constructor(id: number, isHuman: boolean, gltf: GLTF, skin: Skin = SKINS[0]) {
    this.model = gltf.scene.clone(true);
    const key = `${id}:${skin.body ?? ''}`;
    let tex = texCache.get(key);
    if (!tex) {
      let base: THREE.Texture | null = null;
      this.model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && (m.material as THREE.MeshStandardMaterial).map) base = (m.material as THREE.MeshStandardMaterial).map;
      });
      if (base) {
        // Limbs/antenna use the purple palette column, the body the white one.
        tex = recolorTexture(base, { x: 448, y: 256, w: 64, h: 128 }, PLAYER_COLORS[id]);
        // The body takes the skin's colour; limbs keep the team colour so teams stay readable.
        const body = skin.body ? new THREE.Color(skin.body) : new THREE.Color(PLAYER_COLORS[id]).lerp(new THREE.Color('#ffffff'), 0.72);
        tex = recolorTexture(tex, { x: 256, y: 384, w: 64, h: 128 }, body);
        texCache.set(key, tex);
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
    this.model.scale.setScalar(1.5);
    this.model.position.y = 0.11; // standing on the board
    this.model.rotation.y = 0.35; // a little sideways, like a snowboard stance
    this.body.add(this.model);

    // Skin hat sits on the head (the torso block's top) and replaces the antenna.
    const { hat, height } = buildHat(skin.hat);
    const torso = this.model.getObjectByName('torso');
    if (torso && skin.hat !== 'none') {
      hat.position.y = 0.6;
      torso.add(hat);
      const antenna = this.model.getObjectByName('antenna');
      if (antenna) antenna.visible = false;
    }
    this.hatLift = height * 1.5;

    // The board: player colour on top with a white stripe and dark bindings.
    // Dark deck so it reads on any ground, with a wide stripe in the player's colour.
    const deck = new THREE.Mesh(boardGeo, toon(skin.deck, { roughness: 0.35 }));
    deck.castShadow = true;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.012, 0.86), toon(PLAYER_COLORS[id], { roughness: 0.35 }));
    stripe.position.y = 0.122;
    for (const z of [-0.6, 0.6]) {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6), toon(skin.tips, { roughness: 0.4 }));
      tip.scale.set(1.6, 0.5, 0.8);
      tip.position.set(0, 0.2, z);
      this.board.add(tip);
    }
    const bindMat = toon('#3b3350', { roughness: 0.6 });
    for (const z of [-0.2, 0.2]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.1), bindMat);
      b.position.set(0, 0.14, z);
      this.board.add(b);
    }
    this.board.add(deck, stripe);
    this.board.scale.setScalar(1.2);
    this.body.add(this.board);

    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = (n: string) => gltf.animations.find((a) => a.name === n);
    const i = clip('idle');
    this.idle = i ? this.mixer.clipAction(i) : null;
    this.idle?.play();

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
    this.crown.position.y = 1.38 + this.hatLift;
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
    // Riding: no walk cycle, just a relaxed idle sway; a crouch while gliding.
    if (moving !== this.wasMoving) {
      this.idle?.setEffectiveTimeScale(moving ? 0.5 : 1);
      this.wasMoving = moving;
    }
    this.mixer.update(bonked ? 0 : dt);

    // Lean into turns (board and rider roll together; rider leans a bit more).
    const want = moving ? Math.max(-1, Math.min(1, this.lean)) : 0;
    this.leanCur += (want - this.leanCur) * Math.min(1, dt * 10);
    this.board.rotation.z = this.leanCur * 0.28;
    this.model.rotation.z = this.leanCur * 0.42;
    this.board.visible = this.mood !== 'ghost';

    this.squashKick *= Math.exp(-dt * 8);
    const crouch = moving ? 0.06 + Math.abs(this.leanCur) * 0.06 : 0;
    const sy = bonked ? 0.6 : 1 - this.squashKick - crouch + (this.mood === 'happy' ? Math.abs(Math.sin(time * 8)) * 0.12 : 0);
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    this.body.scale.set(sxz, sy, sxz);
    this.body.position.y = ghost
      ? 0.35 + Math.sin(time * 3) * 0.12
      : this.mood === 'happy'
        ? Math.abs(Math.sin(time * 8)) * 0.3
        : moving
          ? Math.sin(time * 9) * 0.015 // gentle board chatter
          : 0;
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
      this.marker.position.y = 1.9 + this.hatLift + Math.sin(time * 4) * 0.08 + (this.carrying ? 0.45 : 0);
      this.marker.rotation.y = time * 2;
    }
    if (this.shield.visible) this.shield.scale.setScalar(0.75 + Math.sin(time * 6) * 0.03);
  }
}
