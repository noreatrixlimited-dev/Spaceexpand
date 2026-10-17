import * as THREE from 'three';
import { PLAYER_COLORS } from '../config';
import { lighten, outlineMaterial, toon } from './materials';
import { crownGeometry, starGeometry } from './shapes';

const sphere = new THREE.SphereGeometry(1, 24, 16);
const smallSphere = new THREE.SphereGeometry(1, 12, 8);
const dizzyStar = starGeometry(0.11, 0.05, 0.04);
const crownGeo = crownGeometry();

export type BlobMood = 'normal' | 'bonked' | 'ghost' | 'happy' | 'sad' | 'scared';

/** A squishy round blob with big eyes and tiny feet. */
export class Blob {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group(); // squashes
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly outline: THREE.Mesh;
  private readonly feet: THREE.Mesh[] = [];
  private readonly eyes: THREE.Group[] = [];
  private readonly stars = new THREE.Group();
  private readonly crown: THREE.Mesh;
  private readonly shield: THREE.Mesh;
  private readonly marker: THREE.Mesh | null = null;
  private readonly color: string;
  private phase = Math.random() * 10;
  private yaw = 0;
  private blink = 2 + Math.random() * 3;
  private squashKick = 0;
  mood: BlobMood = 'normal';
  moving = false;
  carrying = false;
  ghostColor: string | null = null;
  lean = 0; // unused by blobs; keeps the avatar interface shared

  constructor(id: number, isHuman: boolean) {
    this.color = PLAYER_COLORS[id];
    this.bodyMat = toon(this.color, { transparent: true });
    const bodyMesh = new THREE.Mesh(sphere, this.bodyMat);
    bodyMesh.scale.set(0.42, 0.4, 0.42);
    bodyMesh.position.y = 0.42;
    bodyMesh.castShadow = true;
    this.outline = new THREE.Mesh(sphere, outlineMaterial());
    this.outline.scale.set(0.45, 0.43, 0.45);
    this.outline.position.y = 0.42;
    this.body.add(this.outline, bodyMesh);

    // belly highlight
    const belly = new THREE.Mesh(smallSphere, toon(lighten(this.color, 0.45)));
    belly.scale.set(0.26, 0.22, 0.12);
    belly.position.set(0, 0.32, 0.33);
    this.body.add(belly);

    // eyes
    const white = toon('#ffffff');
    const black = new THREE.MeshBasicMaterial({ color: '#2b2033' });
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      const w = new THREE.Mesh(smallSphere, white);
      w.scale.set(0.12, 0.14, 0.08);
      const pupil = new THREE.Mesh(smallSphere, black);
      pupil.scale.set(0.075, 0.09, 0.05);
      pupil.position.set(0, -0.01, 0.05);
      const shine = new THREE.Mesh(smallSphere, new THREE.MeshBasicMaterial({ color: '#ffffff' }));
      shine.scale.setScalar(0.025);
      shine.position.set(0.025, 0.035, 0.1);
      eye.add(w, pupil, shine);
      eye.position.set(side * 0.14, 0.52, 0.34);
      this.eyes.push(eye);
      this.body.add(eye);
      const cheek = new THREE.Mesh(smallSphere, new THREE.MeshBasicMaterial({ color: '#ff9eb5', transparent: true, opacity: 0.8 }));
      cheek.scale.set(0.06, 0.035, 0.02);
      cheek.position.set(side * 0.26, 0.4, 0.33);
      this.body.add(cheek);
    }

    // feet
    const footMat = toon(lighten(this.color, -0.2).offsetHSL(0, 0, -0.12));
    for (const side of [-1, 1]) {
      const f = new THREE.Mesh(smallSphere, footMat);
      f.scale.set(0.11, 0.07, 0.15);
      f.position.set(side * 0.17, 0.06, 0.04);
      f.castShadow = true;
      this.feet.push(f);
      this.root.add(f);
    }

    // dizzy stars
    const starMat = toon('#ffd43b');
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(dizzyStar, starMat);
      this.stars.add(s);
    }
    this.stars.position.y = 0.95;
    this.stars.visible = false;
    this.root.add(this.stars);

    this.crown = new THREE.Mesh(crownGeo, toon('#ffcf33', { side: THREE.DoubleSide }));
    this.crown.position.y = 0.86;
    this.crown.visible = false;
    this.body.add(this.crown);

    this.shield = new THREE.Mesh(
      sphere,
      new THREE.MeshBasicMaterial({ color: '#8fe3ff', transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.shield.scale.setScalar(0.68);
    this.shield.position.y = 0.42;
    this.shield.visible = false;
    this.root.add(this.shield);

    if (isHuman) {
      const cone = new THREE.ConeGeometry(0.13, 0.22, 4);
      cone.rotateX(Math.PI);
      this.marker = new THREE.Mesh(cone, toon('#ffffff'));
      this.marker.position.y = 1.25;
      this.root.add(this.marker);
    }
    this.root.add(this.body);
    this.root.scale.setScalar(1.18);
  }

  setFacing(dx: number, dz: number): void {
    if (dx === 0 && dz === 0) return;
    this.targetYaw = Math.atan2(dx, dz);
  }
  private targetYaw = 0;

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
    // turn smoothly
    let dy = this.targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 14);
    this.root.rotation.y = this.yaw;

    const ghost = this.mood === 'ghost';
    const bonked = this.mood === 'bonked';
    const speed = this.moving ? 13 : 3;
    this.phase += dt * speed;
    const hop = this.moving && !bonked ? Math.abs(Math.sin(this.phase)) * 0.14 : 0;
    const breathe = Math.sin(time * 3 + this.phase) * 0.03;
    this.squashKick *= Math.exp(-dt * 8);
    let sy = 1 + (this.moving ? Math.cos(this.phase * 2) * 0.07 : breathe) - this.squashKick;
    if (bonked) sy = 0.62;
    const sxz = 1 / Math.sqrt(Math.max(0.3, sy));
    this.body.scale.set(sxz, sy, sxz);
    this.body.position.y = ghost ? 0.35 + Math.sin(time * 3) * 0.12 : hop;

    // feet
    this.feet.forEach((f, k) => {
      f.visible = !ghost;
      f.position.z = 0.04 + (this.moving ? Math.sin(this.phase + k * Math.PI) * 0.1 : 0);
    });

    // ghost look
    if (ghost) {
      this.bodyMat.opacity = 0.55;
      this.bodyMat.color.set(this.ghostColor ? lighten(this.ghostColor, 0.4) : '#ffffff');
      this.outline.visible = false;
    } else {
      this.bodyMat.opacity = 1;
      this.bodyMat.color.set(this.color);
      this.outline.visible = true;
    }

    // blink
    this.blink -= dt;
    const closed = this.blink < 0.12 || bonked;
    if (this.blink < 0) this.blink = 2 + Math.random() * 3.5;
    for (const e of this.eyes) {
      e.scale.y = closed ? 0.15 : this.mood === 'happy' ? 0.7 : 1;
      e.scale.x = this.mood === 'sad' ? 0.85 : 1;
    }

    // dizzy stars
    this.stars.visible = bonked;
    if (bonked) {
      this.stars.children.forEach((s, k) => {
        const a = time * 5 + (k * Math.PI * 2) / 3;
        s.position.set(Math.cos(a) * 0.32, Math.sin(time * 8 + k) * 0.04, Math.sin(a) * 0.32);
        s.rotation.y = a;
      });
    }

    if (this.marker) {
      this.marker.position.y = 1.3 + Math.sin(time * 4) * 0.08 + (this.carrying ? 0.45 : 0);
      this.marker.rotation.y = time * 2;
    }
    if (this.shield.visible) this.shield.scale.setScalar(0.68 + Math.sin(time * 6) * 0.03);
  }
}
