import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mapOutline, type MapDef } from '../maps';
import { loadGltf } from './assets';
import { toon } from './materials';

/** glTF art the game uses, loaded once at boot. */
export interface Art {
  character: GLTF;
  cloud: THREE.Object3D;
}

export async function loadArt(): Promise<Art> {
  const [character, cloud] = await Promise.all([loadGltf('kenney/character.glb'), loadGltf('kaykit/cloud_big.gltf').then((g) => g.scene)]);
  return { character, cloud };
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

/**
 * Clean, Paper.io-like surroundings: a soft gradient sky, a polka-dot floor far below,
 * and the island slab (shaped like the map) that shrinks as the clouds eat the edge.
 */
export class Scenery {
  readonly group = new THREE.Group();
  private readonly slab = new THREE.Group();
  private readonly clouds: THREE.Object3D[] = [];
  private readonly map: MapDef;
  private scale = 1;

  constructor(map: MapDef, art: Art | null) {
    this.map = map;
    const th = map.theme;
    this.buildSky(th.sky[0], th.sky[1]);
    this.buildFloor(th.ground, th.groundDots);
    this.buildSlab();
    this.group.add(this.slab);
    if (art) this.buildClouds(art);
  }

  private buildSky(top: string, bottom: string): void {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { top: { value: new THREE.Color(top) }, bot: { value: new THREE.Color(bottom) } },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bot; varying vec3 vP;
        void main(){ gl_FragColor = vec4(mix(bot, top, smoothstep(-0.6, 0.6, vP.y)), 1.0); }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(260, 24, 12), mat);
    sky.renderOrder = -1;
    this.group.add(sky);
  }

  private buildFloor(color: string, dots: string): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: { c: { value: new THREE.Color(color) }, d: { value: new THREE.Color(dots) } },
      vertexShader: `varying vec2 vW; void main(){ vW = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 c; uniform vec3 d; varying vec2 vW;
        void main(){
          vec2 g = fract(vW / 3.0) - 0.5;
          float dot = 1.0 - smoothstep(0.16, 0.2, length(g));
          float fade = smoothstep(220.0, 60.0, length(vW));
          gl_FragColor = vec4(mix(mix(c, d, dot), c, 1.0 - fade), 1.0);
        }`,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(240, 64), mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -18;
    this.group.add(floor);
  }

  /** Extruded outline of the map, `grow` units bigger than the playable area. */
  private extrude(grow: number, height: number, top: number, color: string, rough = 0.8): THREE.Mesh {
    const pts = mapOutline(this.map, grow);
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const bevel = Math.min(0.3, height * 0.3);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.01, height - bevel * 2),
      bevelEnabled: true,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 3,
      curveSegments: 4,
    });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, top - bevel, 0);
    const m = new THREE.Mesh(geo, toon(color, { roughness: rough }));
    m.receiveShadow = true;
    return m;
  }

  private buildSlab(): void {
    const th = this.map.theme;
    this.slab.add(
      this.extrude(0.35, 0.6, -0.04, th.slabTop, 0.6),
      this.extrude(0.25, 2.2, -0.6, th.slabSide, 0.85),
      this.extrude(-0.6, 1.6, -2.7, th.slabDark, 0.9),
    );
  }

  private buildClouds(art: Art): void {
    for (let k = 0; k < 8; k++) {
      const c = art.cloud.clone(true);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = toon('#ffffff', { roughness: 1, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.5 });
          m.castShadow = false;
        }
      });
      const a = (k / 8) * Math.PI * 2 + 0.4;
      const rad = this.map.size + 22 + (k % 3) * 10;
      c.position.set(Math.cos(a) * rad, -15 - (k % 3) * 2, Math.sin(a) * rad);
      c.scale.setScalar(4 + (k % 3) * 1.5);
      c.userData = { a, rad, speed: 0.01 + (k % 3) * 0.004 };
      this.clouds.push(c);
      this.group.add(c);
    }
  }

  update(dt: number, voidRing: number): void {
    const target = Math.max(0.15, (this.map.size - voidRing) / this.map.size);
    this.scale += (target - this.scale) * Math.min(1, dt * 2.5);
    this.slab.scale.set(this.scale, 1, this.scale);
    for (const c of this.clouds) {
      c.userData.a += c.userData.speed * dt;
      c.position.x = Math.cos(c.userData.a) * c.userData.rad;
      c.position.z = Math.sin(c.userData.a) * c.userData.rad;
    }
  }
}
