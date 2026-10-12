// Visual style test (V0): one mid-match scene rendered in three candidate art styles.
// Open styletest.html?style=soft | cartoon | diorama
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PLAYER_COLORS } from '../config';
import { loadGltf, recolorTexture } from '../render/assets';
import { EggView } from '../render/Egg';
import { Post, type PostOptions } from '../render/post';
import { flowerCenterGeometry, petalsGeometry, starGeometry } from '../render/shapes';
import { Rng } from '../core/rng';

type StyleName = 'soft' | 'cartoon' | 'diorama';

interface Style {
  sky: [string, string, string]; // top, horizon, bottom
  fog?: { color: string; near: number; far: number };
  neutral: [string, string];
  owned: Record<number, [string, string]>;
  cliff: [string, string, string]; // grass lip, dirt, deep rock
  hemi: [string, string, number];
  sun: { color: string; intensity: number; pos: [number, number, number] };
  material: 'standard' | 'toon';
  toneMapping: THREE.ToneMapping;
  exposure: number;
  post: PostOptions;
  below: 'clouds' | 'sea';
  flowerSaturate: number;
}

const STYLES: Record<StyleName, Style> = {
  soft: {
    sky: ['#ffc7da', '#ffe9cf', '#c9ecff'],
    neutral: ['#fff1d8', '#fbe7c6'],
    owned: { 0: ['#d9cbff', '#cfbfff'], 3: ['#b9f0d3', '#aee9c9'], 1: ['#ffd0c9', '#ffc4bc'] },
    cliff: ['#a8e6a3', '#f2c48f', '#d79b6a'],
    hemi: ['#fff8ee', '#f6c7d3', 1.9],
    sun: { color: '#fff3e0', intensity: 2.1, pos: [-10, 22, 12] },
    material: 'standard',
    toneMapping: THREE.NeutralToneMapping,
    exposure: 1.05,
    post: {
      bloom: { strength: 0.22, radius: 0.5, threshold: 0.92 },
      grade: { saturation: 1.05, warmth: 0.25, vignette: 0.22, contrast: 1.0 },
      smaa: true,
    },
    below: 'clouds',
    flowerSaturate: 1,
  },
  cartoon: {
    sky: ['#3fa9ff', '#9fdcff', '#d9f3ff'],
    neutral: ['#ffe39a', '#ffd97a'],
    owned: { 0: ['#a07bff', '#9470fb'], 3: ['#3fd98b', '#35cf80'], 1: ['#ff6b6b', '#ff5e5e'] },
    cliff: ['#5fd35a', '#c98a4b', '#8e5a32'],
    hemi: ['#ffffff', '#7aa0c8', 1.5],
    sun: { color: '#ffffff', intensity: 2.8, pos: [-12, 24, 8] },
    material: 'toon',
    toneMapping: THREE.NoToneMapping,
    exposure: 1,
    post: {
      outline: { color: '#2a1838', thickness: 1.2, strength: 0.9 },
      grade: { saturation: 1.18, warmth: 0, vignette: 0.12, contrast: 1.06 },
      smaa: true,
    },
    below: 'clouds',
    flowerSaturate: 1.2,
  },
  diorama: {
    sky: ['#f6a38b', '#ffd6a5', '#ffd6a5'],
    fog: { color: '#ffd2a1', near: 30, far: 75 },
    neutral: ['#f0dcb4', '#e8d1a6'],
    owned: { 0: ['#b9a5e8', '#ae99e0'], 3: ['#8fcf9a', '#84c690'], 1: ['#f2a99a', '#eb9d8e'] },
    cliff: ['#8fcf7a', '#b98656', '#8a5b3a'],
    hemi: ['#ffe9cc', '#7fb3b0', 1.25],
    sun: { color: '#ffcf96', intensity: 3.2, pos: [-18, 13, 6] },
    material: 'standard',
    toneMapping: THREE.ACESFilmicToneMapping,
    exposure: 1.15,
    post: {
      bloom: { strength: 0.3, radius: 0.7, threshold: 0.85 },
      tiltShift: { focus: 0.52, amount: 2.6 },
      grade: { saturation: 1.0, warmth: 0.45, vignette: 0.42, contrast: 1.04 },
      smaa: true,
    },
    below: 'sea',
    flowerSaturate: 0.95,
  },
};

const params = new URLSearchParams(location.search);
const styleName = (params.get('style') as StyleName) || 'soft';
const S = STYLES[styleName];
const N = 16; // cells in the showcase chunk

// ---------- renderer ----------
const canvas = document.createElement('canvas');
document.body.style.margin = '0';
document.body.style.overflow = 'hidden';
document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = S.toneMapping;
renderer.toneMappingExposure = S.exposure;

const scene = new THREE.Scene();
if (S.fog) scene.fog = new THREE.Fog(S.fog.color, S.fog.near, S.fog.far);
const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.5, 300);

// ---------- materials ----------
const ramp = (() => {
  const t = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 255, 255, 255, 255]), 2, 1);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
function mat(color: THREE.ColorRepresentation, extra: { map?: THREE.Texture | null; emissive?: string; emissiveIntensity?: number; transparent?: boolean; opacity?: number } = {}): THREE.Material {
  if (S.material === 'toon') return new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra });
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
}
/** Convert loaded glTF materials to the style's material, keeping their texture. */
function restyle(root: THREE.Object3D, map?: THREE.Texture): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const old = m.material as THREE.MeshStandardMaterial;
    m.material = mat('#ffffff', { map: map ?? old.map });
    m.castShadow = true;
    m.receiveShadow = true;
  });
}

// ---------- sky ----------
{
  const geo = new THREE.SphereGeometry(150, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(S.sky[0]) }, mid: { value: new THREE.Color(S.sky[1]) }, bot: { value: new THREE.Color(S.sky[2]) } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.6, h)) : mix(mid, bot, smoothstep(0.0, 0.5, -h));
      gl_FragColor = vec4(c, 1.0); }`,
  });
  scene.add(new THREE.Mesh(geo, m));
}

// ---------- lights ----------
scene.add(new THREE.HemisphereLight(S.hemi[0], S.hemi[1], S.hemi[2]));
const sun = new THREE.DirectionalLight(S.sun.color, S.sun.intensity);
sun.position.set(...S.sun.pos);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 80 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 3;
scene.add(sun);

// ---------- layout ----------
const rng = new Rng(7);
const owner: number[] = [];
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    let o = -1;
    const wob = Math.sin(x * 1.3) * 0.8 + Math.cos(y * 1.1) * 0.8;
    if (x + (N - 1 - y) < 13 + wob) o = 0; // bottom-left lavender
    else if (N - 1 - x + y < 12 + wob) o = 3; // top-right mint
    else if (N - 1 - x + (N - 1 - y) < 5 + wob * 0.5) o = 1; // small coral corner bottom-right
    owner.push(o);
  }
}
const trail = [
  [7, 9], [8, 9], [9, 9], [10, 9], [10, 8], [10, 7], [10, 6],
].filter(([x, y]) => owner[y * N + x] !== 0);
const cellPos = (x: number, y: number, out = new THREE.Vector3()) => out.set(x - N / 2 + 0.5, 0, y - N / 2 + 0.5);
const LIFT = 0.14;

// ---------- ground tiles ----------
{
  const geo = new RoundedBoxGeometry(1, 0.8, 1, 2, 0.08);
  geo.translate(0, -0.4, 0);
  const inst = new THREE.InstancedMesh(geo, mat('#ffffff'), N * N);
  inst.receiveShadow = true;
  inst.castShadow = true;
  const d = new THREE.Object3D();
  const c = new THREE.Color();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const o = owner[i];
      cellPos(x, y, d.position);
      d.position.y = o >= 0 ? LIFT : 0;
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
      const pair = o >= 0 ? S.owned[o] : S.neutral;
      c.set(pair[(x + y) % 2]).offsetHSL(0, 0, (rng.next() - 0.5) * 0.025);
      inst.setColorAt(i, c);
    }
  }
  scene.add(inst);
}

// ---------- island body ----------
{
  const s = N + 0.2;
  const lip = new THREE.Mesh(new RoundedBoxGeometry(s, 0.5, s, 3, 0.22), mat(S.cliff[0]));
  lip.position.y = -0.62;
  const dirt = new THREE.Mesh(new RoundedBoxGeometry(s - 0.2, 1.6, s - 0.2, 3, 0.4), mat(S.cliff[1]));
  dirt.position.y = -1.5;
  const rock = new THREE.Mesh(new THREE.ConeGeometry(s * 0.66, 7, 6, 3), mat(S.cliff[2]));
  rock.rotation.x = Math.PI;
  rock.position.y = -5.6;
  for (const m of [lip, dirt, rock]) {
    m.receiveShadow = true;
    m.castShadow = true;
    scene.add(m);
  }
  // dangling rocks
  for (let k = 0; k < 6; k++) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 + rng.next() * 0.5, 0), mat(S.cliff[2]));
    const a = (k / 6) * Math.PI * 2;
    r.position.set(Math.cos(a) * s * 0.42, -3 - rng.next() * 2, Math.sin(a) * s * 0.42);
    r.scale.y = 1.4;
    scene.add(r);
  }
}

// ---------- below: sea or clouds ----------
if (S.below === 'sea') {
  const sea = new THREE.Mesh(new THREE.CircleGeometry(120, 48), new THREE.MeshStandardMaterial({ color: '#6cc3c6', roughness: 0.3, metalness: 0.05 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -2.2;
  sea.receiveShadow = true;
  scene.add(sea);
  const foam = new THREE.Mesh(new THREE.RingGeometry(N * 0.56, N * 0.66, 48), new THREE.MeshBasicMaterial({ color: '#eafcff', transparent: true, opacity: 0.6 }));
  foam.rotation.x = -Math.PI / 2;
  foam.position.y = -2.15;
  scene.add(foam);
}

// ---------- flowers (trail) ----------
{
  const petals = new THREE.InstancedMesh(petalsGeometry(), mat('#ffffff'), trail.length);
  const centers = new THREE.InstancedMesh(flowerCenterGeometry(), mat('#ffe066'), trail.length);
  const d = new THREE.Object3D();
  const col = new THREE.Color(PLAYER_COLORS[0]);
  col.offsetHSL(0, (S.flowerSaturate - 1) * 0.5, 0);
  trail.forEach(([x, y], k) => {
    cellPos(x, y, d.position);
    d.position.y = 0.01;
    d.rotation.y = k * 1.7;
    d.scale.setScalar(1.25);
    d.updateMatrix();
    petals.setMatrixAt(k, d.matrix);
    centers.setMatrixAt(k, d.matrix);
    petals.setColorAt(k, col);
  });
  petals.castShadow = true;
  scene.add(petals, centers);
}

// ---------- star ----------
const star = new THREE.Mesh(starGeometry(0.42, 0.19, 0.16), mat('#ffd43b', { emissive: '#ffb703', emissiveIntensity: 0.6 }));
cellPos(8, 7, star.position);
star.position.y = 0.85;
star.castShadow = true;
scene.add(star);

// ---------- nests ----------
const eggs: EggView[] = [];
for (const [id, x, y] of [
  [0, 2, 13],
  [3, 13, 2],
  [1, 14, 14],
] as const) {
  const e = new EggView(id);
  const p = cellPos(x, y);
  p.y = LIFT;
  e.nest.position.copy(p);
  e.egg.position.copy(p);
  if (id === 3) e.threatened = true;
  scene.add(e.nest, e.egg);
  eggs.push(e);
}

// ---------- decorations + characters (async) ----------
const mixers: THREE.AnimationMixer[] = [];
async function populate(): Promise<void> {
  const kk = ['tree_single_A', 'tree_single_B', 'trees_A_small', 'trees_B_small', 'rock_single_A', 'rock_single_C', 'hill_single_A', 'waterplant_B'];
  const models = await Promise.all(kk.map((n) => loadGltf(`kaykit/${n}.gltf`)));
  const grass = await loadGltf('kenney/grass.glb');
  const grassSmall = await loadGltf('kenney/grass-small.glb');
  const blocked = new Set<number>([...trail.map(([x, y]) => y * N + x), 13 * N + 2, 2 * N + 13, 14 * N + 14, 7 * N + 8, 6 * N + 10, 4 * N + 11, 12 * N + 5]);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (blocked.has(i)) continue;
      const o = owner[i];
      const r = rng.next();
      const p = cellPos(x, y);
      p.y = o >= 0 ? LIFT : 0;
      let src: THREE.Object3D | null = null;
      let scale = 1;
      if (o >= 0 && r < 0.07) {
        src = models[rng.int(0, 3)].scene;
        scale = 1.0 + rng.next() * 0.35;
      } else if (o >= 0 && r < 0.1) {
        src = models[rng.pick([4, 5, 7])].scene;
        scale = 0.9;
      } else if (r < (o >= 0 ? 0.32 : 0.12)) {
        src = (o >= 0 ? grass : grassSmall).scene;
        scale = o >= 0 ? 1.1 : 0.9;
      }
      if (!src) continue;
      const m = src.clone(true);
      restyle(m);
      m.position.copy(p).add(new THREE.Vector3((rng.next() - 0.5) * 0.4, 0, (rng.next() - 0.5) * 0.4));
      m.rotation.y = rng.next() * Math.PI * 2;
      m.scale.setScalar(scale);
      scene.add(m);
    }
  }

  // Characters: Kenney platformer character, recoloured per player.
  const ch = await loadGltf('kenney/character.glb');
  const baseTex = (() => {
    let t: THREE.Texture | null = null;
    ch.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.MeshStandardMaterial).map) t = (m.material as THREE.MeshStandardMaterial).map;
    });
    return t as THREE.Texture | null;
  })();
  const placements: [number, number, number, number, string][] = [
    [0, 10, 6, Math.PI, 'walk'], // lavender at the trail tip, heading up
    [3, 11, 4, -Math.PI / 2 - 0.4, 'walk'], // mint chasing toward the trail
    [1, 12, 12, -2.4, 'idle'],
  ];
  for (const [id, x, y, rot, anim] of placements) {
    const c = ch.scene.clone(true);
    let tex: THREE.Texture | undefined;
    if (baseTex) {
      // Limbs/antenna use the purple column, the body the white one.
      tex = recolorTexture(baseTex, { x: 448, y: 256, w: 64, h: 128 }, PLAYER_COLORS[id]);
      tex = recolorTexture(tex, { x: 256, y: 384, w: 64, h: 128 }, new THREE.Color(PLAYER_COLORS[id]).lerp(new THREE.Color('#ffffff'), 0.55));
    }
    restyle(c, tex);
    const p = cellPos(x, y);
    p.y = owner[y * N + x] >= 0 ? LIFT : 0;
    c.position.copy(p);
    c.rotation.y = rot;
    c.scale.setScalar(1.45);
    scene.add(c);
    const mixer = new THREE.AnimationMixer(c);
    const clip = ch.animations.find((a) => a.name === anim);
    if (clip) mixer.clipAction(clip).play();
    mixer.update(0.15 * id);
    mixers.push(mixer);
  }

  // Clouds around and below
  const cloud = await loadGltf('kaykit/cloud_big.gltf');
  for (let k = 0; k < 7; k++) {
    const c = cloud.scene.clone(true);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = mat('#ffffff', { transparent: true, opacity: 0.95 });
    });
    const a = (k / 7) * Math.PI * 2 + 0.3;
    const rad = S.below === 'sea' ? 22 + (k % 3) * 5 : 16 + (k % 3) * 4;
    c.position.set(Math.cos(a) * rad, S.below === 'sea' ? 1 + (k % 2) * 2 : -9 - (k % 3) * 1.5, Math.sin(a) * rad + 6);
    c.scale.setScalar(S.below === 'sea' ? 1.6 : 2.2 + (k % 2));
    scene.add(c);
  }
}

// ---------- camera framing ----------
function frame(): void {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  const target = new THREE.Vector3(1.5, 0, -0.5);
  // Same framing rule as the game: ~11 cells across on phones.
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = aspect < 1 ? 10.5 / 2 / (halfH * aspect) : 13 / 2 / halfH;
  camera.position.copy(target).add(new THREE.Vector3(0, 0.82, 0.62).normalize().multiplyScalar(dist));
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}
frame();

const post = new Post(renderer, scene, camera, S.post);
const size = renderer.getDrawingBufferSize(new THREE.Vector2());
post.setSize(size.x / renderer.getPixelRatio(), size.y / renderer.getPixelRatio());

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
  frame();
});

const clock = new THREE.Clock();
let t = 0;
function loop(): void {
  const dt = Math.min(0.05, clock.getDelta());
  t += dt;
  for (const m of mixers) m.update(dt);
  for (const e of eggs) e.update(dt, t, 3);
  star.rotation.y = t * 1.5;
  post.render(dt);
  requestAnimationFrame(loop);
}
populate()
  .catch((e) => console.error(e))
  .finally(() => {
    (window as unknown as { __ready: boolean }).__ready = true;
  });
loop();
