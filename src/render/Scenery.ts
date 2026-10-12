import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CONFIG } from '../config';
import { Rng } from '../core/rng';
import { loadGltf } from './assets';
import { toon } from './materials';

/** All glTF art the game uses, loaded once at boot. */
export interface Art {
  character: GLTF;
  trees: THREE.Object3D[]; // pines and round trees for the island rim
  bushes: THREE.Object3D[];
  rocks: THREE.Object3D[];
  plants: THREE.Object3D[]; // small leafy tufts for tiles
  cloud: THREE.Object3D;
}

export async function loadArt(): Promise<Art> {
  const kk = (n: string) => loadGltf(`kaykit/${n}.gltf`).then((g) => g.scene);
  const kn = (n: string) => loadGltf(`kenney/${n}.glb`);
  const [character, t1, t2, t3, t4, b1, r1, r2, r3, g1, g2, cloud] = await Promise.all([
    kn('character'),
    kk('tree_single_A'),
    kk('tree_single_B'),
    kk('trees_A_small'),
    kk('trees_B_small'),
    kk('waterplant_B'),
    kk('rock_single_A'),
    kk('rock_single_C'),
    kk('rock_single_E'),
    kn('grass').then((g) => g.scene),
    kn('grass-small').then((g) => g.scene),
    kk('cloud_big'),
  ]);
  return {
    character,
    trees: [t1, t2, t3, t4],
    bushes: [b1, t4],
    rocks: [r1, r2, r3],
    plants: [g1, g2],
    cloud,
  };
}

/** Swap glTF materials for our lit material (keeps their texture), enable shadows. */
export function prepModel(root: THREE.Object3D, opts: { shadows?: boolean; color?: THREE.ColorRepresentation } = {}): THREE.Object3D {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const old = m.material as THREE.MeshStandardMaterial;
    m.material = toon(opts.color ?? '#ffffff', { map: old.map ?? null });
    m.castShadow = opts.shadows ?? true;
    m.receiveShadow = true;
  });
  return root;
}

const GRASS = '#7cc84a';
const DIRT = '#ec9a4c';
const DIRT_DARK = '#c9773a';
const ROCK = '#a5683c';

/** The floating island body, its tree-lined rim and the background (sky, mountains, lake, clouds). */
export class Scenery {
  readonly group = new THREE.Group();
  private readonly base = new THREE.Group();
  private readonly rim = new THREE.Group();
  private readonly clouds: THREE.Object3D[] = [];
  private readonly size: number;
  private baseScale = 1;
  private rimFall = 0;
  private rimVel = 0;

  constructor(size: number, art: Art | null) {
    this.size = size;
    this.buildSky();
    this.buildBase();
    this.group.add(this.base);
    if (art) {
      this.buildRim(art);
      this.buildBackground(art);
    }
    this.base.add(this.rim);
  }

  private buildSky(): void {
    const geo = new THREE.SphereGeometry(260, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color('#58b4f2') },
        mid: { value: new THREE.Color('#cdefff') },
        bot: { value: new THREE.Color('#9fdcf5') },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
        void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.55, h)) : mix(mid, bot, smoothstep(0.0, 0.4, -h));
        gl_FragColor = vec4(c, 1.0); }`,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -1;
    this.group.add(sky);
  }

  /** A flat slab shaped like the island: a square with rounded corners. */
  private slab(width: number, radius: number, height: number, top: number, color: string, rough = 0.8): THREE.Mesh {
    const h = width / 2;
    const r = Math.min(radius, h);
    const shape = new THREE.Shape();
    shape.moveTo(-h + r, -h);
    shape.lineTo(h - r, -h);
    shape.quadraticCurveTo(h, -h, h, -h + r);
    shape.lineTo(h, h - r);
    shape.quadraticCurveTo(h, h, h - r, h);
    shape.lineTo(-h + r, h);
    shape.quadraticCurveTo(-h, h, -h, h - r);
    shape.lineTo(-h, -h + r);
    shape.quadraticCurveTo(-h, -h, -h + r, -h);
    const bevel = Math.min(0.25, height * 0.3);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: height - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 10 });
    geo.rotateX(Math.PI / 2); // extrude downward from the top face
    geo.translate(0, top - bevel, 0);
    const m = new THREE.Mesh(geo, toon(color, { roughness: rough }));
    m.receiveShadow = true;
    return m;
  }

  private buildBase(): void {
    const s = this.size + 2.6;
    const r = CONFIG.cornerRadius + 1.3;
    const lip = this.slab(s, r, 0.7, -0.1, GRASS, 0.62);
    const dirt = this.slab(s - 0.3, r - 0.15, 2.6, -0.6, DIRT, 0.85);
    const dark = this.slab(s - 1.2, r - 0.6, 1.8, -3.0, DIRT_DARK, 0.9);
    this.base.add(lip, dirt, dark);
    // Rocky underside with a few hanging chunks.
    const rng = new Rng(11);
    const rockMat = toon(ROCK, { roughness: 0.95, flatShading: true });
    const under = new THREE.Mesh(new THREE.ConeGeometry(s * 0.5, 7, 7, 2), rockMat);
    under.rotation.x = Math.PI;
    under.position.y = -7.8;
    this.base.add(under);
    for (let k = 0; k < 9; k++) {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(1 + rng.next() * 1.2, 0), rockMat);
      const a = (k / 9) * Math.PI * 2 + rng.next();
      const rad = s * (0.25 + rng.next() * 0.2);
      r.position.set(Math.cos(a) * rad, -4.8 - rng.next() * 2.5, Math.sin(a) * rad);
      r.scale.set(1, 1.6, 1);
      this.base.add(r);
    }
  }

  /** Trees, bushes and rocks on the grass border, outside the playable grid. */
  private buildRim(art: Art): void {
    const rng = new Rng(5);
    // Walk the rounded-square outline just outside the playable tiles.
    const R = CONFIG.cornerRadius;
    const inner = this.size / 2 - R;
    const ring = (t: number): [number, number] => {
      const out = R + 0.55 + rng.next() * 0.45;
      const straight = inner * 2;
      const arc = (Math.PI / 2) * out;
      const sideLen = straight + arc;
      let u = t * sideLen * 4;
      const side = Math.floor(u / sideLen);
      u -= side * sideLen;
      let x: number, z: number;
      if (u < straight) {
        x = -inner + u;
        z = -inner - out;
      } else {
        const a = -Math.PI / 2 + ((u - straight) / arc) * (Math.PI / 2);
        x = inner + Math.cos(a) * out;
        z = -inner + Math.sin(a) * out;
      }
      // rotate the top side onto each of the four sides
      const rot = (side * Math.PI) / 2;
      return [x * Math.cos(rot) - z * Math.sin(rot), x * Math.sin(rot) + z * Math.cos(rot)];
    };
    const count = Math.round(this.size * 1.5);
    for (let k = 0; k < count; k++) {
      const r = rng.next();
      const src = r < 0.5 ? rng.pick(art.trees) : r < 0.72 ? rng.pick(art.bushes) : r < 0.85 ? rng.pick(art.rocks) : rng.pick(art.plants);
      const m = prepModel(src.clone(true));
      const [x, z] = ring((k + rng.next() * 0.5) / count);
      m.position.set(x, -0.1, z);
      m.rotation.y = rng.next() * Math.PI * 2;
      const big = r < 0.5 ? 0.8 + rng.next() * 0.35 : r < 0.72 ? 1.0 : 0.8;
      m.scale.setScalar(big);
      this.rim.add(m);
    }
  }

  private buildBackground(art: Art): void {
    const rng = new Rng(9);
    // Lake far below with mountains around it.
    const lake = new THREE.Mesh(
      new THREE.CircleGeometry(220, 48),
      new THREE.MeshLambertMaterial({ color: '#5fc0ec' }),
    );
    lake.rotation.x = -Math.PI / 2;
    lake.position.y = -34;
    this.group.add(lake);
    // Low-poly mountains around the lake: green slopes, rocky middle, snowy caps.
    const green = toon('#7cc56a', { flatShading: true, roughness: 0.9 });
    const rock = toon('#b9a08a', { flatShading: true, roughness: 0.9 });
    const snow = toon('#ffffff', { flatShading: true, roughness: 0.8 });
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + rng.next() * 0.25;
      const rad = 105 + rng.next() * 40;
      const h = 28 + rng.next() * 26;
      const r = h * (0.75 + rng.next() * 0.3);
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.45, 7, 1), green);
      base.position.y = h * 0.225;
      const mid = new THREE.Mesh(new THREE.ConeGeometry(r * 0.62, h * 0.5, 7, 1), rock);
      mid.position.y = h * 0.6;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.28, h * 0.22, 7, 1), snow);
      cap.position.y = h * 0.89;
      g.add(base, mid, cap);
      g.position.set(Math.cos(a) * rad, -36, Math.sin(a) * rad);
      g.rotation.y = rng.next() * Math.PI;
      this.group.add(g);
    }
    for (let k = 0; k < 12; k++) {
      const c = art.cloud.clone(true);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = toon('#ffffff', { roughness: 1, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.45 });
          m.castShadow = false;
        }
      });
      const a = (k / 12) * Math.PI * 2;
      const rad = 62 + (k % 3) * 18;
      c.position.set(Math.cos(a) * rad, -24 + (k % 4) * 3, Math.sin(a) * rad);
      c.scale.setScalar(5 + (k % 3) * 2);
      c.userData = { a, rad, speed: 0.006 + (k % 3) * 0.003 };
      this.clouds.push(c);
      this.group.add(c);
    }
  }

  update(dt: number, voidRing: number): void {
    const target = Math.max(0.2, (this.size + 2.6 - voidRing * 2) / (this.size + 2.6));
    this.baseScale += (target - this.baseScale) * Math.min(1, dt * 2);
    this.base.scale.set(this.baseScale, 1, this.baseScale);
    this.rim.scale.set(1 / this.baseScale, 1, 1 / this.baseScale); // keep rim props undistorted
    if (voidRing >= 1 && this.rim.visible) {
      this.rimVel -= 14 * dt;
      this.rimFall += this.rimVel * dt;
      this.rim.position.y = this.rimFall;
      if (this.rimFall < -14) this.rim.visible = false;
    }
    for (const c of this.clouds) {
      c.userData.a += c.userData.speed * dt;
      c.position.x = Math.cos(c.userData.a) * c.userData.rad;
      c.position.z = Math.sin(c.userData.a) * c.userData.rad;
    }
  }
}
