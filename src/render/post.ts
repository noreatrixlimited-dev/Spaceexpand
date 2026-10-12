import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

/** Dark outlines wherever depth jumps: gives everything (even instanced tiles) a drawn cartoon edge. */
class DepthOutlinePass extends ShaderPass {
  constructor(camera: THREE.PerspectiveCamera, color: THREE.ColorRepresentation, thickness: number, strength: number) {
    super({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: camera.near },
        cameraFar: { value: camera.far },
        lineColor: { value: new THREE.Color(color) },
        thickness: { value: thickness },
        strength: { value: strength },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec2 resolution;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform vec3 lineColor;
        uniform float thickness;
        uniform float strength;
        varying vec2 vUv;
        float lin(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          return perspectiveDepthToViewZ(d, cameraNear, cameraFar);
        }
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          vec2 px = thickness / resolution;
          float c = lin(vUv);
          float dx = abs(lin(vUv + vec2(px.x, 0.0)) - c) + abs(lin(vUv - vec2(px.x, 0.0)) - c);
          float dy = abs(lin(vUv + vec2(0.0, px.y)) - c) + abs(lin(vUv - vec2(0.0, px.y)) - c);
          float edge = smoothstep(0.04, 0.12, (dx + dy) / max(1.0, -c * 0.06));
          gl_FragColor = vec4(mix(base.rgb, lineColor, edge * strength), base.a);
        }`,
    });
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    this.uniforms.resolution.value.set(readBuffer.width, readBuffer.height);
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1 },
    warmth: { value: 0 },
    vignette: { value: 0.3 },
    contrast: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float warmth;
    uniform float vignette;
    uniform float contrast;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, saturation);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      c.rgb += vec3(0.06, 0.02, -0.05) * warmth;
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = c;
    }`,
};

/** Tilt-shift: blur grows away from a horizontal band, making the scene look like a miniature. */
const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    dir: { value: new THREE.Vector2(1, 0) },
    focus: { value: 0.5 },
    amount: { value: 3.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform vec2 dir;
    uniform float focus;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      float k = smoothstep(0.12, 0.5, abs(vUv.y - focus)) * amount;
      vec2 step = dir * k / resolution;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.2270270270;
      sum += texture2D(tDiffuse, vUv + step * 1.3846153846) * 0.3162162162;
      sum += texture2D(tDiffuse, vUv - step * 1.3846153846) * 0.3162162162;
      sum += texture2D(tDiffuse, vUv + step * 3.2307692308) * 0.0702702703;
      sum += texture2D(tDiffuse, vUv - step * 3.2307692308) * 0.0702702703;
      gl_FragColor = sum;
    }`,
};

export interface PostOptions {
  outline?: { color: THREE.ColorRepresentation; thickness: number; strength: number };
  bloom?: { strength: number; radius: number; threshold: number };
  tiltShift?: { focus: number; amount: number };
  grade?: { saturation: number; warmth: number; vignette: number; contrast: number };
  smaa?: boolean;
}

export class Post {
  readonly composer: EffectComposer;
  private readonly tilt: ShaderPass[] = [];

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: PostOptions) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    if (opts.outline) rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
    this.composer = new EffectComposer(renderer, rt);
    if (opts.outline) {
      // Both ping-pong buffers need their own depth texture.
      this.composer.renderTarget2.depthTexture = new THREE.DepthTexture(size.x, size.y);
    }
    this.composer.addPass(new RenderPass(scene, camera));
    if (opts.outline) this.composer.addPass(new DepthOutlinePass(camera, opts.outline.color, opts.outline.thickness, opts.outline.strength));
    if (opts.bloom) {
      this.composer.addPass(new UnrealBloomPass(size.clone(), opts.bloom.strength, opts.bloom.radius, opts.bloom.threshold));
    }
    if (opts.tiltShift) {
      for (const d of [new THREE.Vector2(1, 0), new THREE.Vector2(0, 1)]) {
        const p = new ShaderPass(TiltShiftShader);
        p.uniforms.dir.value = d;
        p.uniforms.focus.value = opts.tiltShift.focus;
        p.uniforms.amount.value = opts.tiltShift.amount;
        p.uniforms.resolution.value.copy(size);
        this.tilt.push(p);
        this.composer.addPass(p);
      }
    }
    if (opts.grade) {
      const g = new ShaderPass(GradeShader);
      Object.assign(g.uniforms.saturation, { value: opts.grade.saturation });
      g.uniforms.warmth.value = opts.grade.warmth;
      g.uniforms.vignette.value = opts.grade.vignette;
      g.uniforms.contrast.value = opts.grade.contrast;
      this.composer.addPass(g);
    }
    this.composer.addPass(new OutputPass());
    if (opts.smaa) this.composer.addPass(new SMAAPass());
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    for (const p of this.tilt) p.uniforms.resolution.value.set(w, h);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}

