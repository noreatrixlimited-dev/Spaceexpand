import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mapInset, mapOutline, type MapDef } from '../maps';
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
 * Clean, Paper.io-like surroundings: a soft gradient sky with a sun glow, an animated themed sea
 * with little islets, and the island slab (shaped like the map) that shrinks as the clouds eat the edge.
 */
/** World-unit width of the baked coast distance texture used by the sea. */
const SEA_SDF_SPAN = 96;

export class Scenery {
  readonly group = new THREE.Group();
  private readonly slab = new THREE.Group();
  private readonly clouds: THREE.Object3D[] = [];
  private readonly map: MapDef;
  private readonly islets = new THREE.Group();
  private sea: THREE.ShaderMaterial | null = null;
  private time = 0;
  private scale = 1;

  constructor(map: MapDef, art: Art | null) {
    this.map = map;
    const th = map.theme;
    this.buildSky(th.sky[0], th.sky[1]);
    this.buildSea(th.water[0], th.water[1]);
    this.buildSlab();
    this.buildIslets();
    this.group.add(this.slab, this.islets);
    if (art) this.buildClouds(art);
  }

  private buildSky(top: string, bottom: string): void {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(top) },
        bot: { value: new THREE.Color(bottom) },
        sun: { value: new THREE.Vector3(0.45, 0.55, -0.7).normalize() },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bot; uniform vec3 sun; varying vec3 vP;
        void main(){
          vec3 col = mix(bot, top, smoothstep(-0.6, 0.6, vP.y));
          float a = max(dot(normalize(vP), sun), 0.0);
          col += vec3(1.0, 0.96, 0.85) * (pow(a, 12.0) * 0.35 + pow(a, 300.0) * 0.8);
          gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(260, 24, 12), mat);
    sky.renderOrder = -1;
    this.group.add(sky);
  }

  /** Animated sea around the island: shallow colour near the shore, foam rings lapping at the edge. */
  private buildSea(shallow: string, deep: string): void {
    const m = this.map;
    // Bake the coast's signed distance into a small texture, so any island shape gets foam.
    const R = 128;
    const span = SEA_SDF_SPAN;
    const data = new Uint8Array(R * R);
    for (let j = 0; j < R; j++)
      for (let i = 0; i < R; i++) {
        const x = ((i + 0.5) / R - 0.5) * span;
        const z = ((j + 0.5) / R - 0.5) * span;
        const d = -(mapInset(m, x, z) - 0.35); // distance out from the shore
        data[j * R + i] = Math.max(0, Math.min(255, Math.round(((d + 8) / 64) * 255)));
      }
    const sdf = new THREE.DataTexture(data, R, R, THREE.RedFormat, THREE.UnsignedByteType);
    sdf.magFilter = THREE.LinearFilter;
    sdf.minFilter = THREE.LinearFilter;
    sdf.wrapS = sdf.wrapT = THREE.ClampToEdgeWrapping;
    sdf.needsUpdate = true;
    this.sea = new THREE.ShaderMaterial({
      uniforms: {
        uShallow: { value: new THREE.Color(shallow) },
        uDeep: { value: new THREE.Color(deep) },
        uTime: { value: 0 },
        uScale: { value: 1 },
        uSdf: { value: sdf },
        uSpan: { value: span },
      },
      vertexShader: `varying vec2 vW;
        void main(){ vW = position.xy * vec2(1.0, -1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uShallow; uniform vec3 uDeep; uniform float uTime; uniform float uScale;
        uniform sampler2D uSdf; uniform float uSpan; varying vec2 vW;
        float shore(vec2 p) {
          vec2 uv = p / uSpan + 0.5;
          float d = texture2D(uSdf, clamp(uv, 0.0, 1.0)).r * 64.0 - 8.0;
          // beyond the baked area, keep growing with distance
          vec2 o = max(abs(uv - 0.5) - 0.5, 0.0) * uSpan;
          return d + length(o);
        }
        void main(){
          float d = shore(vW / uScale) * uScale; // distance out from the shore
          float t = uTime;
          // gentle ripples
          float w = sin(vW.x * 0.35 + t * 0.9) * sin(vW.y * 0.31 - t * 0.7) + sin((vW.x + vW.y) * 0.21 + t * 0.5) * 0.6;
          vec3 col = mix(uShallow, uDeep, smoothstep(0.5, 16.0, d + w * 0.6));
          // sparkles on the crests
          float sp = smoothstep(0.9, 0.98, sin(vW.x * 2.3 - t * 1.3) * sin(vW.y * 2.1 + t * 1.1)) * smoothstep(0.6, 1.2, w);
          col = mix(col, vec3(1.0), sp * 0.35 * smoothstep(2.0, 6.0, d));
          // foam: a solid band at the shore plus rings that lap outward
          float edge = 1.0 - smoothstep(0.35, 0.8 + w * 0.12, d);
          float ring = fract(d * 0.33 - t * 0.35);
          float rings = smoothstep(0.0, 0.08, ring) * (1.0 - smoothstep(0.1, 0.22, ring)) * (1.0 - smoothstep(1.0, 5.0, d));
          col = mix(col, vec3(1.0), clamp(edge + rings * 0.7, 0.0, 1.0));
          // fade into the horizon
          col = mix(col, uDeep * 0.9 + 0.1, smoothstep(80.0, 200.0, length(vW)));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sea = new THREE.Mesh(new THREE.CircleGeometry(240, 72), this.sea);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -1.3;
    this.group.add(sea);
  }

  /** A few tiny islands dotted around the sea, so the world feels bigger. */
  private buildIslets(): void {
    const th = this.map.theme;
    const top = toon(th.slabTop, { roughness: 0.7 });
    const side = toon(th.slabSide, { roughness: 0.9 });
    const leaf = toon(th.neutralPattern, { roughness: 0.8 });
    const spots: [number, number, number][] = [
      [0.6, 14, 2.2], [1.9, 22, 3.2], [2.9, 12, 1.6], [3.9, 26, 4], [4.8, 16, 2.4], [5.7, 20, 1.8],
    ];
    for (const [a, extra, r] of spots) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, 1.4, 20), side);
      base.position.y = -0.95;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r, 0.35, 20), top);
      cap.position.y = -0.1;
      g.add(base, cap);
      // a couple of round bushes on top
      for (let k = 0; k < 2 + (r > 2 ? 1 : 0); k++) {
        const bush = new THREE.Mesh(new THREE.SphereGeometry(0.45 + r * 0.12, 14, 10), leaf);
        const ba = a * 7 + k * 2.1;
        bush.position.set(Math.cos(ba) * r * 0.4, 0.3 + k * 0.05, Math.sin(ba) * r * 0.4);
        bush.scale.y = 0.85;
        bush.castShadow = true;
        g.add(bush);
      }
      const rad = this.map.size + extra;
      g.position.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
      g.userData = { bob: a };
      this.islets.add(g);
    }
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
      const rad = this.map.size + 16 + (k % 3) * 9;
      c.position.set(Math.cos(a) * rad, 6 + (k % 3) * 3, Math.sin(a) * rad);
      c.scale.setScalar(3 + (k % 3) * 1.2);
      c.userData = { a, rad, speed: 0.01 + (k % 3) * 0.004 };
      this.clouds.push(c);
      this.group.add(c);
    }
  }

  update(dt: number, voidRing: number): void {
    this.time += dt;
    if (this.sea) {
      this.sea.uniforms.uTime.value = this.time;
      this.sea.uniforms.uScale.value = this.scale;
    }
    for (const g of this.islets.children) g.position.y = Math.sin(this.time * 0.8 + g.userData.bob * 3) * 0.06;
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
