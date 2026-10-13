import * as THREE from 'three';
import { PLAYER_COLORS, UNIT } from '../config';
import type { Game } from '../core/Game';
import type { MapTheme } from '../maps';

/**
 * Paper.io-style ground: one flat surface whose colours come from small textures
 * (one channel per player). Bilinear filtering + a soft threshold turns the rules'
 * fine grid into smooth, rounded territory and trails, with a darker "side" band
 * so each territory looks like a slightly raised slab.
 */
export class Territory {
  readonly mesh: THREE.Mesh;
  private readonly n: number;
  private readonly own: Uint8Array; // shown values, RGBA per cell (player 0..3)
  private readonly trail: Uint8Array;
  private readonly land: Uint8Array; // R = island, G = fresh-capture glow
  private readonly ownTex: THREE.DataTexture;
  private readonly trailTex: THREE.DataTexture;
  private readonly landTex: THREE.DataTexture;
  private readonly pendingAt: Float32Array;
  private readonly active = new Set<number>();
  private time = 0;
  private first = true;

  constructor(game: Game, theme: MapTheme) {
    const n = game.grid.size;
    this.n = n;
    this.own = new Uint8Array(n * n * 4);
    this.trail = new Uint8Array(n * n * 4);
    this.land = new Uint8Array(n * n * 4);
    this.pendingAt = new Float32Array(n * n);
    const tex = (data: Uint8Array) => {
      const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    };
    this.ownTex = tex(this.own);
    this.trailTex = tex(this.trail);
    this.landTex = tex(this.land);

    const world = n / UNIT;
    const geo = new THREE.PlaneGeometry(world, world, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, metalness: 0 });
    const col = (c: string) => new THREE.Color(c);
    const players = PLAYER_COLORS.map(col);
    const sides = PLAYER_COLORS.map((c) => col(c).multiplyScalar(0.72));
    const trails = PLAYER_COLORS.map((c) => col(c).lerp(new THREE.Color('#ffffff'), 0.35));
    const uniforms = {
      uOwn: { value: this.ownTex },
      uTrail: { value: this.trailTex },
      uLand: { value: this.landTex },
      uTexel: { value: 1 / n },
      uWorld: { value: world },
      uNeutral: { value: col(theme.neutral) },
      uPattern: { value: col(theme.neutralPattern) },
      uP: { value: players },
      uS: { value: sides },
      uT: { value: trails },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGrid;\nuniform float uWorld;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrid = position.xz / uWorld + 0.5;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vGrid;
          uniform sampler2D uOwn; uniform sampler2D uTrail; uniform sampler2D uLand;
          uniform float uTexel; uniform float uWorld;
          uniform vec3 uNeutral; uniform vec3 uPattern;
          uniform vec3 uP[4]; uniform vec3 uS[4]; uniform vec3 uT[4];
          // strongest channel and its value
          vec2 pick(vec4 v) {
            float id = 0.0; float m = v.r;
            if (v.g > m) { m = v.g; id = 1.0; }
            if (v.b > m) { m = v.b; id = 2.0; }
            if (v.a > m) { m = v.a; id = 3.0; }
            return vec2(id, m);
          }
          vec3 byId(vec3 c[4], float id) { return id < 0.5 ? c[0] : id < 1.5 ? c[1] : id < 2.5 ? c[2] : c[3]; }
          // Soft 5-tap sample: rounds off the grid's staircase before the edge threshold.
          vec4 soft(sampler2D t, vec2 uv) {
            float o = uTexel * 0.75;
            return texture2D(t, uv) * 0.32
              + (texture2D(t, uv + vec2(o, o)) + texture2D(t, uv + vec2(-o, o))
              + texture2D(t, uv + vec2(o, -o)) + texture2D(t, uv + vec2(-o, -o))) * 0.17;
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec2 uv = vGrid;
          vec4 L = soft(uLand, uv);
          float landA = smoothstep(0.42, 0.58, L.r);
          if (landA < 0.01) discard;
          // unclaimed land: soft polka dots
          vec2 w = uv * uWorld;
          vec2 cell = fract(w * 0.5) - 0.5;
          float dots = 1.0 - smoothstep(0.12, 0.16, length(cell));
          vec3 col = mix(uNeutral, uPattern, dots * 0.8);
          // territory with a raised look: darker band on the side facing the camera
          vec2 me = pick(soft(uOwn, uv));
          vec2 above = pick(soft(uOwn, uv - vec2(0.0, uTexel * 1.1)));
          float t = smoothstep(0.42, 0.58, me.y);
          float side = smoothstep(0.42, 0.58, above.y) * (1.0 - t);
          col = mix(col, byId(uS, above.x), side);
          float lip = t * (1.0 - smoothstep(0.42, 0.58, pick(soft(uOwn, uv - vec2(0.0, uTexel * 0.45))).y));
          col = mix(col, byId(uP, me.x), t);
          col = mix(col, byId(uP, me.x) * 1.12 + 0.05, lip * 0.6);
          // fresh capture glow
          col += L.g * 0.35 * t;
          // trails: lighter ribbon in the player's colour
          vec2 tr = pick(soft(uTrail, uv));
          float tt = smoothstep(0.22, 0.42, tr.y);
          col = mix(col, byId(uT, tr.x), tt * 0.92);
          diffuseColor.rgb = col;
          diffuseColor.a = landA;`,
        );
    };
    mat.transparent = false;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
  }

  /** Delay newly claimed cells so the fill ripples out from (fx, fy) (cells). */
  wave(cells: number[], fx: number, fy: number, speed = 0.012): void {
    const n = this.n;
    for (const i of cells) {
      const x = i % n;
      const y = (i - x) / n;
      this.pendingAt[i] = this.time + Math.hypot(x - fx, y - fy) * speed;
    }
  }

  voidWave(cells: number[]): void {
    for (const i of cells) this.pendingAt[i] = this.time + Math.random() * 0.4;
  }

  update(game: Game, dt: number, onPop?: (cell: number, owner: number) => void): void {
    this.time += dt;
    const g = game.grid;
    const N = g.owner.length;
    const own = this.own;
    const trail = this.trail;
    const land = this.land;
    let ownDirty = false;
    let trailDirty = false;
    let landDirty = false;

    // Find cells whose target differs from what's shown.
    for (let i = 0; i < N; i++) {
      const o = g.voided[i] ? -1 : g.owner[i];
      const k = i * 4;
      const wantLand = g.voided[i] ? 0 : 255;
      if (this.first) {
        land[k] = wantLand;
        if (o >= 0) own[k + o] = 255;
        continue;
      }
      if (land[k] !== wantLand || own[k] !== (o === 0 ? 255 : 0) || own[k + 1] !== (o === 1 ? 255 : 0) || own[k + 2] !== (o === 2 ? 255 : 0) || own[k + 3] !== (o === 3 ? 255 : 0)) {
        this.active.add(i);
      }
      // trails react instantly-ish
      const t = g.trail[i];
      for (let c = 0; c < 4; c++) {
        const want = t === c ? 255 : 0;
        const cur = trail[k + c];
        if (cur !== want) {
          const step = want > cur ? 60 : 25;
          trail[k + c] = want > cur ? Math.min(want, cur + step) : Math.max(want, cur - step);
          trailDirty = true;
        }
      }
    }
    if (this.first) {
      this.first = false;
      ownDirty = landDirty = true;
    }

    // Animate ownership and land toward their targets (after any wave delay).
    const rate = Math.ceil(dt * 255 * 7);
    for (const i of this.active) {
      if (this.time < this.pendingAt[i]) continue;
      const k = i * 4;
      const o = g.voided[i] ? -1 : g.owner[i];
      let done = true;
      for (let c = 0; c < 4; c++) {
        const want = o === c ? 255 : 0;
        const cur = own[k + c];
        if (cur === want) continue;
        if (want === 255 && cur === 0 && onPop) onPop(i, c);
        own[k + c] = want > cur ? Math.min(want, cur + rate) : Math.max(want, cur - rate);
        if (want === 255 && own[k + c] === 255) land[k + 1] = 255; // glow
        done = false;
        ownDirty = true;
      }
      const wantLand = g.voided[i] ? 0 : 255;
      if (land[k] !== wantLand) {
        land[k] = wantLand > land[k] ? Math.min(255, land[k] + rate) : Math.max(0, land[k] - Math.ceil(rate * 0.5));
        done = false;
        landDirty = true;
      }
      if (land[k + 1] > 0) {
        land[k + 1] = Math.max(0, land[k + 1] - Math.ceil(dt * 255 * 2.5));
        done = false;
        landDirty = true;
      }
      if (done) this.active.delete(i);
    }
    if (ownDirty) this.ownTex.needsUpdate = true;
    if (trailDirty) this.trailTex.needsUpdate = true;
    if (landDirty) this.landTex.needsUpdate = true;
  }

  dispose(): void {
    this.ownTex.dispose();
    this.trailTex.dispose();
    this.landTex.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
