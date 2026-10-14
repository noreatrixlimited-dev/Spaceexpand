import * as THREE from 'three';
import { PLAYER_COLORS } from '../config';
import { Rng } from '../core/rng';
import { eventMap, LEVEL_MAPS, mapInset, mapOutline, type MapDef } from '../maps';
import { Blob } from './Blob';
import { Critter } from './Critter';
import { toon } from './materials';
import type { Art } from './Scenery';
import { getSkin } from '../skins';

/** World-map units per island unit: islands are shown as small models on the big ocean. */
const S = 0.2;
const TOP = 0.55; // height of an island's top above the water
const TRAVEL_TIME = 2.6;
/** Index of the weekly event island (it sits after the levels and has no route). */
export const EVENT_INDEX = LEVEL_MAPS.length;

interface IslandView {
  map: MapDef;
  group: THREE.Group;
  top: THREE.MeshStandardMaterial;
  side: THREE.MeshStandardMaterial;
  deco: THREE.MeshStandardMaterial[];
  lock: THREE.Sprite;
  label: THREE.Sprite;
  flag: THREE.Group;
  pos: THREE.Vector3;
  hit: THREE.Mesh;
}

const GREY = new THREE.Color('#c5ccd8');

/**
 * The world map between matches: a made-up ocean with the island levels joined by a dotted
 * path. Your robot stands on the selected island and surfs along the path to the next one.
 */
export class WorldMap {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.5, 400);
  private readonly islands: IslandView[] = [];
  private readonly dots: THREE.Mesh[][] = []; // dots of the path leaving island i
  private readonly dotDone: THREE.MeshStandardMaterial;
  private readonly dotTodo = toon('#ffffff', { roughness: 0.5, transparent: true, opacity: 0.75 });
  private readonly sea: THREE.ShaderMaterial;
  private readonly clouds: THREE.Group[] = [];
  private robot: Critter | Blob;
  private robotSlot = -1;
  private robotSkin = -1;
  private art: Art | null = null;
  private time = 0;
  private camTarget = new THREE.Vector3();
  private pan = new THREE.Vector3();
  private robotPos = new THREE.Vector3();
  private travelling: { from: number; to: number; t: number; time: number; direct: boolean; done: () => void } | null = null;
  private at = 0;
  /** Seconds left of the arrival bounce. */
  private arrive = 0;

  constructor(art: Art | null, slot: number, skin = 0) {
    this.art = art;
    this.scene.background = new THREE.Color('#bfe9f7');
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#9fc9e0', 1.9));
    const sun = new THREE.DirectionalLight('#fff6e6', 2.0);
    sun.position.set(-20, 40, 25);
    this.scene.add(sun);

    this.sea = this.buildSea();
    this.dotDone = toon(PLAYER_COLORS[slot], { roughness: 0.4 });
    LEVEL_MAPS.forEach((m, i) => this.islands.push(this.buildIsland(m, i)));
    this.buildPaths();
    this.islands.push(this.buildIsland(eventMap(), EVENT_INDEX));
    this.buildDecor();
    this.robot = this.makeRobot(slot, skin);
  }

  private makeRobot(slot: number, skin: number): Critter | Blob {
    if (this.robot) this.scene.remove(this.robot.root);
    this.robotSlot = slot;
    this.robotSkin = skin;
    const r = this.art ? new Critter(slot, false, this.art.character, getSkin(skin)) : new Blob(slot, false);
    r.root.scale.setScalar(1.7);
    this.scene.add(r.root);
    return r;
  }

  private buildSea(): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vW; void main(){ vW = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; varying vec2 vW;
        void main(){
          float t = uTime;
          float w = sin(vW.x * 0.22 + t * 0.8) * sin(vW.y * 0.19 - t * 0.6) + sin((vW.x - vW.y) * 0.13 + t * 0.4) * 0.7;
          vec3 col = mix(vec3(0.45, 0.83, 0.94), vec3(0.24, 0.62, 0.88), 0.45 + w * 0.18);
          float sp = smoothstep(0.92, 0.99, sin(vW.x * 1.3 - t * 1.2) * sin(vW.y * 1.1 + t)) * smoothstep(0.4, 1.2, w);
          col = mix(col, vec3(1.0), sp * 0.4);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), mat);
    sea.rotation.x = -Math.PI / 2;
    this.scene.add(sea);
    return mat;
  }

  private shapeOf(m: MapDef, grow: number): THREE.Shape {
    // Shapes are built in the XY plane and laid flat, so y (south) maps to +z.
    const pts = mapOutline(m, grow / S).map(([x, y]) => new THREE.Vector2(x * S, -y * S));
    return new THREE.Shape(pts);
  }

  private buildIsland(m: MapDef, index: number): IslandView {
    const g = new THREE.Group();
    const pos = new THREE.Vector3(m.wx, 0, m.wy);
    g.position.copy(pos);

    // Shallow-water halo and a foam ring around the coast.
    const halo = new THREE.Mesh(new THREE.ShapeGeometry(this.shapeOf(m, 1.6), 6), new THREE.MeshBasicMaterial({ color: '#9ff0ef', transparent: true, opacity: 0.7, depthWrite: false }));
    const foam = new THREE.Mesh(new THREE.ShapeGeometry(this.shapeOf(m, 0.45), 6), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false }));
    for (const [mesh, y] of [
      [halo, 0.02],
      [foam, 0.04],
    ] as const) {
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      g.add(mesh);
    }

    const side = toon(m.theme.slabSide, { roughness: 0.85 });
    const top = toon(m.theme.neutral, { roughness: 0.7 });
    const body = new THREE.Mesh(
      new THREE.ExtrudeGeometry(this.shapeOf(m, 0), { depth: TOP + 0.6, bevelEnabled: true, bevelSize: 0.18, bevelThickness: 0.18, bevelSegments: 2, curveSegments: 4 }),
      [top, side],
    );
    body.rotation.x = -Math.PI / 2;
    body.position.y = -0.6 - 0.18;
    g.add(body);

    // A few round bushes and trees, placed from the island's own seed.
    const rng = new Rng(index * 97 + 5);
    const deco: THREE.MeshStandardMaterial[] = [];
    const leaf = toon(m.theme.slabSide, { roughness: 0.8 });
    const trunk = toon('#b48a64', { roughness: 0.9 });
    deco.push(leaf);
    for (let k = 0, tries = 0; k < 7 && tries < 200; tries++) {
      const x = (rng.next() * 2 - 1) * m.size * S;
      const z = (rng.next() * 2 - 1) * m.size * S;
      // keep them on the island, off the middle (where the robot stands)
      if (mapInset(m, x / S, z / S) < 2.5 || Math.hypot(x, z) < 1.4) continue;
      k++;
      if (k % 3 === 0) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 6), trunk);
        t.position.set(x, TOP + 0.25, z);
        const crown = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.8, 8), leaf);
        crown.position.set(x, TOP + 0.75, z);
        g.add(t, crown);
      } else {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.22 + rng.next() * 0.18, 12, 8), leaf);
        b.position.set(x, TOP + 0.08, z);
        b.scale.y = 0.75;
        g.add(b);
      }
    }

    // Lock (shown while the island is locked) and a flag (once it's won).
    const lock = new THREE.Sprite(new THREE.SpriteMaterial({ map: lockTexture(), depthTest: false }));
    lock.scale.setScalar(1.6);
    lock.position.set(0, TOP + 1.6, 0);
    lock.renderOrder = 5;
    g.add(lock);
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6), toon('#ffffff'));
    pole.position.y = 0.7;
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.36, 0.04), toon('#ffffff'));
    cloth.position.set(0.3, 1.2, 0);
    cloth.name = 'cloth';
    flag.add(pole, cloth);
    flag.position.set(m.size * S * 0.35, TOP, -m.size * S * 0.2);
    g.add(flag);

    const text = index === EVENT_INDEX ? `Weekly: ${m.name}` : `${index + 1}. ${m.name}${m.boss ? ' (Boss)' : ''}`;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(text, m.theme.ui), depthTest: false }));
    label.center.set(0.5, 1);
    label.scale.set(8.4, 2.1, 1);
    label.position.set(0, TOP, m.size * S + 1.4);
    label.renderOrder = 6;
    g.add(label);

    // Invisible disc used for tapping the island.
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(m.size * S * 0.9, m.size * S * 0.9, 2, 16), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = TOP;
    hit.userData.index = index;
    g.add(hit);

    this.scene.add(g);
    return { map: m, group: g, top, side, deco, lock, label, flag, pos, hit };
  }

  /** The curved sea route from island i to island i + 1. */
  private route(i: number): THREE.QuadraticBezierCurve3 {
    return this.curve(i, i + 1, i % 2 ? 0.22 : -0.22);
  }

  private curve(from: number, to: number, bendBy: number): THREE.QuadraticBezierCurve3 {
    const a = this.islands[from].pos;
    const b = this.islands[to].pos;
    const mid = a.clone().lerp(b, 0.5);
    const dir = b.clone().sub(a);
    const bend = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(bendBy);
    return new THREE.QuadraticBezierCurve3(a.clone(), mid.add(bend), b.clone());
  }

  private buildPaths(): void {
    const geo = new THREE.SphereGeometry(0.16, 8, 6);
    for (let i = 0; i < this.islands.length - 1; i++) {
      const curve = this.route(i);
      const len = curve.getLength();
      const list: THREE.Mesh[] = [];
      const ra = this.islands[i].map.size * S + 0.6;
      const rb = this.islands[i + 1].map.size * S + 0.6;
      for (let d = ra; d < len - rb; d += 0.9) {
        const p = curve.getPointAt(d / len);
        const dot = new THREE.Mesh(geo, this.dotTodo);
        dot.position.set(p.x, 0.08, p.z);
        dot.scale.y = 0.4;
        this.scene.add(dot);
        list.push(dot);
      }
      this.dots.push(list);
    }
  }

  private buildDecor(): void {
    const rng = new Rng(4242);
    // Tiny uninhabited islets to fill the ocean.
    const sand = toon('#fbeec8', { roughness: 0.9 });
    const palm = toon('#7cc576', { roughness: 0.8 });
    for (let k = 0; k < 40; k++) {
      const x = -75 + rng.next() * 125;
      const z = -110 + rng.next() * 160;
      if (this.islands.some((v) => Math.hypot(v.pos.x - x, v.pos.z - z) < v.map.size * S + 4)) continue;
      const r = 0.6 + rng.next() * 1.1;
      const islet = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.15, 0.5, 14), sand);
      islet.position.set(x, 0.05, z);
      this.scene.add(islet);
      if (rng.next() < 0.6) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(r * 0.45, 10, 8), palm);
        b.position.set(x, 0.4, z);
        b.scale.y = 0.8;
        this.scene.add(b);
      }
    }
    // Soft clouds drifting over the sea.
    const white = toon('#ffffff', { roughness: 1, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.45, transparent: true, opacity: 0.92 });
    for (let k = 0; k < 16; k++) {
      const c = new THREE.Group();
      for (let p = 0; p < 4; p++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(1 + rng.next() * 0.8, 12, 10), white);
        puff.position.set(p * 1.3 - 2, rng.next() * 0.4, rng.next() * 0.8);
        puff.scale.y = 0.6;
        c.add(puff);
      }
      c.position.set(-70 + rng.next() * 120, 7 + rng.next() * 4, -110 + rng.next() * 160);
      c.userData.speed = 0.4 + rng.next() * 0.5;
      this.clouds.push(c);
      this.scene.add(c);
    }
  }

  /** Show progress: `unlocked` islands are playable, those before `beaten` have a flag. */
  setState(unlocked: number, beaten: number, selected: number, slot: number, skin = 0, event: { open: boolean; won: boolean } = { open: false, won: false }): void {
    if (slot !== this.robotSlot || skin !== this.robotSkin) {
      this.robot = this.makeRobot(slot, skin);
      this.dotDone.color.set(PLAYER_COLORS[slot]);
    }
    this.islands.forEach((v, i) => {
      const locked = i === EVENT_INDEX ? !event.open : i >= unlocked;
      v.top.color.set(locked ? GREY.clone().lerp(new THREE.Color('#ffffff'), 0.5) : v.map.theme.neutral);
      v.side.color.set(locked ? GREY : v.map.theme.slabSide);
      for (const d of v.deco) d.color.set(locked ? GREY.clone().multiplyScalar(0.9) : v.map.theme.slabSide);
      v.lock.visible = locked;
      v.flag.visible = i === EVENT_INDEX ? event.won : i < beaten;
      const cloth = v.flag.getObjectByName('cloth') as THREE.Mesh;
      (cloth.material as THREE.MeshStandardMaterial).color.set(PLAYER_COLORS[slot]);
      v.label.material.opacity = locked ? 0.6 : 1;
    });
    this.dots.forEach((list, i) => list.forEach((d) => (d.material = i < beaten ? this.dotDone : this.dotTodo)));
    if (!this.travelling) {
      this.at = selected;
      this.robotPos.copy(this.islands[selected].pos).setY(TOP);
      this.camTarget.copy(this.robotPos);
    }
    this.pan.set(0, 0, 0);
  }

  get busy(): boolean {
    return this.travelling !== null;
  }

  /** Ride from one island to another along the dotted routes, then call `done`. */
  travel(from: number, to: number, done: () => void): void {
    if (from === to) {
      done();
      return;
    }
    this.pan.set(0, 0, 0);
    const direct = from === EVENT_INDEX || to === EVENT_INDEX;
    const legs = direct ? 1 : Math.abs(to - from);
    this.travelling = { from, to, t: 0, time: Math.min(6, TRAVEL_TIME + (legs - 1) * 0.5), direct, done };
  }

  /** Which island is under a screen point (or -1). */
  pick(ndcX: number, ndcY: number): number {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hits = ray.intersectObjects(this.islands.map((v) => v.hit));
    return hits.length ? (hits[0].object.userData.index as number) : -1;
  }

  /** Drag the view around a little (in screen pixels). */
  drag(dx: number, dy: number): void {
    const k = 0.05;
    this.pan.x = Math.max(-30, Math.min(30, this.pan.x - dx * k));
    this.pan.z = Math.max(-30, Math.min(30, this.pan.z - dy * k));
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;
    this.sea.uniforms.uTime.value = this.time;
    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 60) c.position.x = -80;
    }
    for (const v of this.islands) v.lock.position.y = TOP + 1.6 + Math.sin(this.time * 2 + v.pos.x) * 0.12;

    const r = this.robot;
    let moving = false;
    const tr = this.travelling;
    if (tr) {
      tr.t += dt / tr.time;
      const step = tr.direct || tr.to > tr.from ? 1 : -1;
      const legs = tr.direct ? 1 : Math.abs(tr.to - tr.from);
      const u = Math.min(1, tr.t);
      // ease in and out over the whole trip, leg by leg
      const e = u * u * (3 - 2 * u) * legs;
      const leg = Math.min(legs - 1, Math.floor(e));
      const f = e - leg;
      const a = tr.from + leg * step;
      const curve = tr.direct ? this.curve(tr.from, tr.to, 0.15) : step > 0 ? this.route(a) : this.route(a - 1);
      const p = curve.getPointAt(step > 0 ? f : 1 - f);
      const ahead = curve.getPointAt(Math.min(1, Math.max(0, step > 0 ? f + 0.02 : 1 - f - 0.02)));
      // up on the islands at both ends, down on the waves in between
      const land = Math.max(0, 1 - Math.min(f, 1 - f) * 6);
      this.robotPos.set(p.x, 0.12 + (TOP - 0.12) * land + Math.sin(this.time * 9) * 0.04 * (1 - land), p.z);
      r.setFacing(ahead.x - p.x, ahead.z - p.z);
      moving = true;
      if (tr.t >= 1) {
        this.travelling = null;
        this.at = tr.to;
        this.robotPos.copy(this.islands[tr.to].pos).setY(TOP);
        this.arrive = 0.6;
        tr.done();
      }
    } else {
      r.setFacing(0, 1);
    }
    this.arrive = Math.max(0, this.arrive - dt);
    r.root.position.copy(this.robotPos);
    r.root.position.y += Math.sin((this.arrive / 0.6) * Math.PI) * 0.8;
    r.moving = moving;
    r.lean = moving ? Math.sin(this.time * 2.2) * 0.4 : 0;
    r.update(dt, this.time);

    // Camera: a tilted view centred on the robot (plus any drag).
    // Aim a bit south of the robot so its island sits in the open space above the card.
    const want = this.robotPos.clone().setY(0).add(this.pan).add(new THREE.Vector3(0, 0, 4.5));
    this.camTarget.lerp(want, 1 - Math.exp(-dt * (tr ? 3.5 : 5)));
    const halfH = Math.tan((this.camera.fov * Math.PI) / 360);
    const span = 12.5; // world units visible across the narrow side
    const dist = Math.max(span / (halfH * Math.min(1, this.camera.aspect)), 24);
    this.camera.position.copy(this.camTarget).add(new THREE.Vector3(0, 1, 0.62).normalize().multiplyScalar(dist));
    this.camera.lookAt(this.camTarget);
  }

  get current(): number {
    return this.at;
  }
}

function labelTexture(text: string, accent: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.font = '600 52px Fredoka, sans-serif';
  const w = Math.min(492, g.measureText(text).width + 56);
  const x = (512 - w) / 2;
  g.fillStyle = 'rgba(74, 54, 84, 0.18)';
  roundRect(g, x, 30, w, 84, 42);
  g.fill();
  g.fillStyle = '#ffffff';
  roundRect(g, x, 22, w, 84, 42);
  g.fill();
  g.fillStyle = accent;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 66, 460);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let lockTex: THREE.CanvasTexture | null = null;
function lockTexture(): THREE.CanvasTexture {
  if (lockTex) return lockTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#8a7394';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(64, 54, 18, Math.PI, 0);
  g.stroke();
  g.fillStyle = '#8a7394';
  roundRect(g, 36, 54, 56, 42, 8);
  g.fill();
  lockTex = new THREE.CanvasTexture(c);
  lockTex.colorSpace = THREE.SRGBColorSpace;
  return lockTex;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
