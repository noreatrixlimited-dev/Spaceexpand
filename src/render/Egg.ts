import * as THREE from 'three';
import { PLAYER_COLORS, PLAYER_COLORS_SOFT } from '../config';
import { outlineMaterial, toon } from './materials';
import { heartGeometry } from './shapes';

const sphere = new THREE.SphereGeometry(1, 20, 14);
const heartGeo = heartGeometry(0.22);

/** A pet egg sitting in its nest, with floating hearts for shields. */
export class EggView {
  readonly nest = new THREE.Group();
  readonly egg = new THREE.Group();
  private readonly eggBody = new THREE.Group();
  private readonly hearts: THREE.Mesh[] = [];
  private readonly heartGroup = new THREE.Group();
  private readonly eggMat: THREE.MeshStandardMaterial;
  private readonly eyes: THREE.Mesh[] = [];
  private readonly mouth: THREE.Mesh;
  private wobble = 0;
  private heartPop: number[] = [0, 0, 0];
  shownHearts = 3;
  threatened = false;
  carried = false;
  captured = false;

  constructor(id: number) {
    // nest
    const nestMat = toon('#b07a4a');
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.12, 8, 18), nestMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    ring.castShadow = true;
    const twigMat = toon('#8d5b33');
    for (let i = 0; i < 7; i++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 5), twigMat);
      const a = (i / 7) * Math.PI * 2;
      t.position.set(Math.cos(a) * 0.36, 0.14, Math.sin(a) * 0.36);
      t.rotation.set(Math.PI / 2, 0, a + 0.6);
      this.nest.add(t);
    }
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 3), toon(PLAYER_COLORS[id]));
    flag.rotation.z = -Math.PI / 2;
    flag.position.set(0.47, 0.75, 0);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.75, 5), twigMat);
    pole.position.set(0.33, 0.45, 0);
    this.nest.add(ring, flag, pole);

    // egg
    this.eggMat = toon(PLAYER_COLORS_SOFT[id], { emissive: new THREE.Color(PLAYER_COLORS[id]), emissiveIntensity: 0 });
    const shell = new THREE.Mesh(sphere, this.eggMat);
    shell.scale.set(0.27, 0.35, 0.27);
    shell.castShadow = true;
    const outline = new THREE.Mesh(sphere, outlineMaterial());
    outline.scale.set(0.29, 0.37, 0.29);
    this.eggBody.add(outline, shell);
    const spotMat = toon(PLAYER_COLORS[id]);
    for (const [x, y, z, r] of [
      [-0.16, 0.12, 0.17, 0.06],
      [0.19, -0.08, 0.12, 0.05],
      [0.05, 0.22, -0.18, 0.05],
      [-0.12, -0.15, -0.18, 0.06],
    ]) {
      const s = new THREE.Mesh(sphere, spotMat);
      s.scale.set(r, r, r * 0.4);
      s.position.set(x, y, z);
      s.lookAt(x * 3, y * 3, z * 3);
      this.eggBody.add(s);
    }
    const black = new THREE.MeshBasicMaterial({ color: '#2b2033' });
    for (const side of [-1, 1]) {
      const e = new THREE.Mesh(sphere, black);
      e.scale.set(0.035, 0.05, 0.03);
      e.position.set(side * 0.08, 0.05, 0.255);
      this.eyes.push(e);
      this.eggBody.add(e);
    }
    this.mouth = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 10, Math.PI), black);
    this.mouth.position.set(0, -0.03, 0.262);
    this.mouth.rotation.z = Math.PI;
    this.eggBody.add(this.mouth);
    this.eggBody.position.y = 0.36;
    this.egg.add(this.eggBody);

    // hearts
    const heartMat = toon('#ff5d8f');
    for (let i = 0; i < 3; i++) {
      const h = new THREE.Mesh(heartGeo, heartMat);
      h.castShadow = true;
      this.hearts.push(h);
      this.heartGroup.add(h);
    }
    this.heartGroup.position.y = 0.95;
    this.egg.add(this.heartGroup);
  }

  loseHeart(): void {
    this.wobble = 1;
  }

  update(dt: number, time: number, hearts: number): void {
    this.egg.visible = !this.captured;
    this.wobble *= Math.exp(-dt * 4);
    const scared = this.threatened || this.carried;
    const shake = scared ? Math.sin(time * 30) * 0.12 : 0;
    this.eggBody.rotation.z = shake + Math.sin(time * 18) * this.wobble * 0.5;
    this.eggBody.position.y = 0.36 + (this.carried ? 0 : Math.abs(Math.sin(time * 2.2)) * 0.04);
    for (const e of this.eyes) e.scale.set(scared ? 0.045 : 0.035, scared ? 0.065 : 0.05, 0.03);
    this.mouth.rotation.z = scared ? 0 : Math.PI;
    this.eggMat.emissiveIntensity = this.carried ? 0.35 + Math.sin(time * 8) * 0.25 : 0;

    for (let i = 0; i < 3; i++) {
      const h = this.hearts[i];
      const want = i < hearts ? 1 : 0;
      this.heartPop[i] += (want - this.heartPop[i]) * Math.min(1, dt * 10);
      const a = time * 1.3 + (i * Math.PI * 2) / 3;
      h.position.set(Math.cos(a) * 0.42, Math.sin(time * 3 + i) * 0.05, Math.sin(a) * 0.42);
      h.rotation.y = -a + Math.PI / 2;
      h.scale.setScalar(Math.max(0.0001, this.heartPop[i]));
      h.visible = this.heartPop[i] > 0.02 && !this.carried;
    }
  }
}
