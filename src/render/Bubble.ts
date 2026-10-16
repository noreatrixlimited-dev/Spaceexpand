import * as THREE from 'three';
import { PLAYER_COLORS } from '../config';
import { SKINS, type Skin } from '../skins';
import type { BlobMood } from './Blob';
import { buildHat } from './hats';
import { toon } from './materials';
import { crownGeometry, starGeometry } from './shapes';

const sphere = new THREE.SphereGeometry(1, 40, 28);
const small = new THREE.SphereGeometry(1, 14, 10);
const dizzyStar = starGeometry(0.11, 0.05, 0.04);
const crownGeo = crownGeometry();

const R = 0.6; // bubble radius
const HOVER = 0.1; // floats a little above the ground

/**
 * Soap-bubble look: see-through in the middle, a coloured rim (fresnel), a rainbow sheen
 * that slides around, and a bright highlight. Works on any background without transmission.
 */
export function bubbleMaterial(color: THREE.ColorRepresentation, tint: THREE.ColorRepresentation, opacity = 0.62): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTint: { value: new THREE.Color(tint) },
      uTime: { value: 0 },
      uOpacity: { value: opacity },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec3 vTint;
      void main() {
        vec4 lp = vec4(position, 1.0);
        vec3 ln = normal;
        vTint = vec3(1.0);
        #ifdef USE_INSTANCING
          lp = instanceMatrix * lp;
          ln = mat3(instanceMatrix) * ln;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #endif
        vec4 wp = modelMatrix * lp;
        vP = position;
        vN = normalize(mat3(modelMatrix) * ln);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform vec3 uTint; uniform float uTime; uniform float uOpacity;
      varying vec3 vN; varying vec3 vV; varying vec3 vP; varying vec3 vTint;
      vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
      void main() {
        vec3 n = normalize(vN);
        float f = 1.0 - max(dot(n, normalize(vV)), 0.0);
        float rim = pow(f, 1.6);
        // rainbow film sliding over the surface
        vec3 film = hue(fract(f * 0.9 + vP.y * 0.6 + uTime * 0.08));
        vec3 col = mix(uColor * vTint * 1.05, uTint, 0.25 + 0.2 * sin(uTime * 1.3 + vP.x * 4.0));
        col = mix(col, film, 0.28 * rim);
        // soft top light and a sharp window highlight
        vec3 L = normalize(vec3(-0.4, 0.9, 0.5));
        float spec = pow(max(dot(reflect(-L, n), normalize(vV)), 0.0), 40.0);
        float top = smoothstep(0.2, 1.0, n.y) * 0.25;
        col += vec3(1.0) * (spec * 0.9 + top);
        float a = clamp(0.3 + rim * 0.9 + spec, 0.0, 1.0) * uOpacity + 0.2;
        gl_FragColor = vec4(min(col, vec3(1.0)), min(a, 1.0));
      }`,
  });
}

/** A floaty soap-bubble character with a cute face; wobbles as it glides and wears the skin's hat. */
export class Bubble {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group(); // wobbles
  private readonly face = new THREE.Group();
  private readonly mat: THREE.ShaderMaterial;
  private readonly core: THREE.Mesh;
  private readonly eyes: THREE.Group[] = [];
  private readonly stars = new THREE.Group();
  private readonly crown: THREE.Mesh;
  private readonly shield: THREE.Mesh;
  private readonly marker: THREE.Mesh | null = null;
  private readonly shadow: THREE.Mesh;
  private yaw = 0;
  private targetYaw = 0;
  private wob = Math.random() * 10;
  private blink = 2 + Math.random() * 3;
  private squashKick = 0;
  private hatLift = 0;
  private leanCur = 0;
  mood: BlobMood = 'normal';
  moving = false;
  carrying = false;
  ghostColor: string | null = null;
  lean = 0;

  constructor(id: number, isHuman: boolean, skin: Skin = SKINS[0]) {
    const color = PLAYER_COLORS[id];
    const tint = skin.body ?? new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.6).getStyle();
    this.mat = bubbleMaterial(color, tint, 0.75);

    // a soft coloured core so the team colour reads clearly from above
    this.core = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }));
    this.core.scale.setScalar(R * 0.8);
    const shell = new THREE.Mesh(sphere, this.mat);
    shell.scale.setScalar(R);
    shell.renderOrder = 3;
    this.body.add(this.core, shell);
    this.body.position.y = R + HOVER;

    // face on the front surface
    const white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const black = new THREE.MeshBasicMaterial({ color: '#2b2033' });
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      const w = new THREE.Mesh(small, white);
      w.scale.set(0.1, 0.12, 0.05);
      const pupil = new THREE.Mesh(small, black);
      pupil.scale.set(0.065, 0.08, 0.04);
      pupil.position.set(0, -0.01, 0.03);
      const shine = new THREE.Mesh(small, white);
      shine.scale.setScalar(0.02);
      shine.position.set(0.02, 0.03, 0.065);
      eye.add(w, pupil, shine);
      eye.position.set(side * 0.15, 0.08, R * 0.9);
      this.eyes.push(eye);
      this.face.add(eye);
      const cheek = new THREE.Mesh(small, new THREE.MeshBasicMaterial({ color: '#ff9eb5', transparent: true, opacity: 0.85 }));
      cheek.scale.set(0.055, 0.032, 0.02);
      cheek.position.set(side * 0.25, -0.04, R * 0.86);
      this.face.add(cheek);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 6, 16, Math.PI), black);
    smile.rotation.z = Math.PI;
    smile.position.set(0, -0.04, R * 0.95);
    this.face.add(smile);
    this.face.renderOrder = 4;
    this.body.add(this.face);

    // the skin's hat sits on top of the bubble
    const { hat, height } = buildHat(skin.hat);
    if (skin.hat !== 'none') {
      hat.scale.setScalar(0.85);
      hat.position.y = R * 0.86;
      this.body.add(hat);
    }
    this.hatLift = height * 0.85;

    // contact shadow
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 24),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.16, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.012;
    this.root.add(this.shadow);

    const starMat = toon('#ffd43b', { emissive: '#ffb703', emissiveIntensity: 0.3 });
    for (let k = 0; k < 3; k++) this.stars.add(new THREE.Mesh(dizzyStar, starMat));
    this.stars.position.y = R * 2 + HOVER + 0.15;
    this.stars.visible = false;
    this.root.add(this.stars);

    this.crown = new THREE.Mesh(crownGeo, toon('#ffcf33', { side: THREE.DoubleSide, metalness: 0.3, roughness: 0.35 }));
    this.crown.position.y = R * 0.9 + this.hatLift;
    this.crown.visible = false;
    this.body.add(this.crown);

    this.shield = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: '#8fe3ff', transparent: true, opacity: 0.22, depthWrite: false }));
    this.shield.scale.setScalar(R * 1.45);
    this.shield.position.y = R + HOVER;
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
    this.yaw += dy * Math.min(1, dt * 12);
    this.root.rotation.y = this.yaw;
    this.mat.uniforms.uTime.value = time;

    const bonked = this.mood === 'bonked';
    const ghost = this.mood === 'ghost';
    const moving = this.moving && !bonked;
    this.wob += dt * (moving ? 11 : 3.5);

    // Jelly wobble: stretch along the direction of travel, squash when kicked or bonked.
    this.squashKick *= Math.exp(-dt * 7);
    const jiggle = Math.sin(this.wob) * (moving ? 0.06 : 0.025);
    let sy = 1 + jiggle - this.squashKick;
    let sz = 1 - jiggle * 0.6 + (moving ? 0.06 : 0);
    if (bonked) {
      sy = 0.7 + Math.sin(time * 18) * 0.05;
      sz = 1.15;
    }
    const sx = 1 / Math.sqrt(Math.max(0.3, sy * sz));
    this.body.scale.set(sx, sy, sz);
    // bob gently; bounce for joy
    const happy = this.mood === 'happy' ? Math.abs(Math.sin(time * 7)) * 0.35 : 0;
    this.body.position.y = R * sy + HOVER + Math.sin(time * 2.4 + this.wob * 0.2) * 0.04 + happy;
    // lean into turns
    const want = moving ? Math.max(-1, Math.min(1, this.lean)) : 0;
    this.leanCur += (want - this.leanCur) * Math.min(1, dt * 8);
    this.body.rotation.z = -this.leanCur * 0.25 + (bonked ? Math.sin(time * 9) * 0.15 : 0);
    this.body.rotation.x = moving ? 0.12 : 0;
    this.shadow.scale.setScalar(1 - (this.body.position.y - R - HOVER) * 0.8);

    this.mat.uniforms.uOpacity.value = ghost ? 0.3 : 0.75;

    // blink
    this.blink -= dt;
    const closed = this.blink < 0.12 || bonked;
    if (this.blink < 0) this.blink = 2 + Math.random() * 3.5;
    for (const e of this.eyes) e.scale.y = closed ? 0.15 : this.mood === 'happy' ? 0.7 : 1;

    this.stars.visible = bonked;
    if (bonked) {
      this.stars.children.forEach((s, k) => {
        const a = time * 5 + (k * Math.PI * 2) / 3;
        s.position.set(Math.cos(a) * 0.36, Math.sin(time * 8 + k) * 0.04, Math.sin(a) * 0.36);
        s.rotation.y = a;
      });
    }
    if (this.marker) {
      this.marker.position.y = R * 2 + HOVER + 0.45 + this.hatLift + Math.sin(time * 4) * 0.08 + (this.carrying ? 0.45 : 0);
      this.marker.rotation.y = time * 2;
    }
    if (this.shield.visible) this.shield.scale.setScalar(R * 1.45 + Math.sin(time * 6) * 0.02);
  }
}

/** Little soap bubbles that drift up and pop behind a moving bubble. */
export class BubbleTrail {
  readonly mesh: THREE.InstancedMesh;
  private static readonly MAX = 260;
  private readonly pos: THREE.Vector3[] = [];
  private readonly vel: THREE.Vector3[] = [];
  private readonly life = new Float32Array(BubbleTrail.MAX);
  private readonly max = new Float32Array(BubbleTrail.MAX);
  private readonly size = new Float32Array(BubbleTrail.MAX);
  private next = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly mat: THREE.ShaderMaterial;
  private time = 0;

  constructor() {
    this.mat = bubbleMaterial('#ffffff', '#ffffff', 0.95);
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), this.mat, BubbleTrail.MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    for (let i = 0; i < BubbleTrail.MAX; i++) {
      this.pos.push(new THREE.Vector3());
      this.vel.push(new THREE.Vector3());
      this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.setColorAt(0, new THREE.Color('#ffffff'));
  }

  /** Puff out a bubble at `at`, drifting a little along `drift` (e.g. behind the rider). */
  emit(at: THREE.Vector3, drift: THREE.Vector3, color: THREE.ColorRepresentation): void {
    const i = this.next;
    this.next = (this.next + 1) % BubbleTrail.MAX;
    this.pos[i].copy(at);
    this.pos[i].x += (Math.random() - 0.5) * 0.3;
    this.pos[i].z += (Math.random() - 0.5) * 0.3;
    this.vel[i].copy(drift).multiplyScalar(0.5 + Math.random() * 0.6);
    this.vel[i].y = 0.5 + Math.random() * 0.7;
    this.size[i] = 0.07 + Math.random() * 0.12;
    this.max[i] = this.life[i] = 0.9 + Math.random() * 0.8;
    this.mesh.setColorAt(i, new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    const d = this.dummy;
    for (let i = 0; i < BubbleTrail.MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const p = this.pos[i];
      const v = this.vel[i];
      v.multiplyScalar(Math.exp(-dt * 1.6));
      v.y = Math.max(v.y, 0.35);
      p.addScaledVector(v, dt);
      p.x += Math.sin(this.time * 5 + i) * dt * 0.15; // wobble as they rise
      const t = 1 - this.life[i] / this.max[i];
      // grow in, then pop at the end
      const s = this.size[i] * (t < 0.12 ? t / 0.12 : t > 0.92 ? (1 - t) / 0.08 : 1);
      d.position.copy(p);
      d.scale.setScalar(this.life[i] > 0 ? Math.max(0, s) : 0);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
