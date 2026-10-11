import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function heartGeometry(size = 1): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -0.35);
  s.bezierCurveTo(-0.1, -0.25, -0.5, -0.05, -0.5, 0.18);
  s.bezierCurveTo(-0.5, 0.42, -0.2, 0.5, 0, 0.3);
  s.bezierCurveTo(0.2, 0.5, 0.5, 0.42, 0.5, 0.18);
  s.bezierCurveTo(0.5, -0.05, 0.1, -0.25, 0, -0.35);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.18,
    bevelEnabled: true,
    bevelSize: 0.08,
    bevelThickness: 0.08,
    bevelSegments: 2,
    curveSegments: 8,
  });
  g.center();
  g.scale(size, size, size);
  return g;
}

export function starGeometry(outer = 0.5, inner = 0.22, depth = 0.18): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.06,
    bevelThickness: 0.06,
    bevelSegments: 2,
  });
  g.center();
  return g;
}

/** Flat 5-petal flower lying on the ground (petals only; centre is a separate mesh). */
export function petalsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const p = new THREE.SphereGeometry(0.16, 8, 5);
    p.scale(1, 0.45, 0.75);
    const a = (i / 5) * Math.PI * 2;
    p.rotateY(-a);
    p.translate(Math.cos(a) * 0.17, 0.08, Math.sin(a) * 0.17);
    parts.push(p);
  }
  const leaf = new THREE.SphereGeometry(0.12, 6, 4);
  leaf.scale(1.6, 0.3, 0.7);
  leaf.translate(0.22, 0.03, 0.22);
  parts.push(leaf);
  const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  return merged;
}

export function flowerCenterGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.1, 8, 6);
  g.scale(1, 0.6, 1);
  g.translate(0, 0.13, 0);
  return g;
}

export function crownGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const band = new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12, 1, true);
  parts.push(band.toNonIndexed());
  for (let i = 0; i < 5; i++) {
    const c = new THREE.ConeGeometry(0.06, 0.16, 6);
    const a = (i / 5) * Math.PI * 2;
    c.translate(Math.cos(a) * 0.19, 0.13, Math.sin(a) * 0.19);
    parts.push(c.toNonIndexed());
  }
  return mergeGeometries(parts);
}
