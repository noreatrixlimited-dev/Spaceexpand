import * as THREE from 'three';
import type { HatKind } from '../skins';
import { toon } from './materials';
import { starGeometry } from './shapes';

/**
 * Little hats built from primitives. The origin is the top of the robot's head; returns the
 * hat and how tall it is (so the leader's crown can sit on top).
 */
export function buildHat(kind: HatKind): { hat: THREE.Group; height: number } {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  let height = 0;
  switch (kind) {
    case 'sprout': {
      const green = toon('#5bbf3f', { roughness: 0.5 });
      add(new THREE.CylinderGeometry(0.025, 0.03, 0.22, 6), green, 0, 0.11);
      for (const s of [-1, 1]) {
        const leaf = add(new THREE.SphereGeometry(0.12, 12, 8), green, s * 0.1, 0.22);
        leaf.scale.set(1, 0.35, 0.6);
        leaf.rotation.z = s * -0.5;
      }
      height = 0.3;
      break;
    }
    case 'beanie': {
      const knit = toon('#5aa6e6', { roughness: 0.9 });
      const cap = add(new THREE.SphereGeometry(0.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), knit, 0, -0.06);
      cap.scale.y = 0.85;
      const band = add(new THREE.TorusGeometry(0.29, 0.06, 8, 24), toon('#ffffff', { roughness: 0.9 }), 0, -0.04);
      band.rotation.x = Math.PI / 2;
      add(new THREE.SphereGeometry(0.1, 12, 10), toon('#ffffff', { roughness: 1 }), 0, 0.24);
      height = 0.34;
      break;
    }
    case 'bee': {
      const black = toon('#2e2633', { roughness: 0.5 });
      const yellow = toon('#ffd23a', { roughness: 0.4, emissive: '#ffb000', emissiveIntensity: 0.15 });
      for (const s of [-1, 1]) {
        const stalk = add(new THREE.CylinderGeometry(0.018, 0.018, 0.3, 6), black, s * 0.1, 0.12);
        stalk.rotation.z = s * -0.35;
        add(new THREE.SphereGeometry(0.06, 10, 8), yellow, s * 0.16, 0.27);
      }
      height = 0.32;
      break;
    }
    case 'party': {
      const cone = add(new THREE.ConeGeometry(0.17, 0.42, 16), toon('#ff7aa8', { roughness: 0.45 }), 0, 0.2);
      cone.rotation.z = 0.12;
      add(new THREE.SphereGeometry(0.07, 10, 8), toon('#fff3a8', { roughness: 0.6 }), -0.03, 0.43);
      const dots = toon('#ffffff');
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        add(new THREE.SphereGeometry(0.025, 6, 4), dots, Math.cos(a) * 0.12, 0.1 + (k % 2) * 0.08, Math.sin(a) * 0.12);
      }
      height = 0.5;
      break;
    }
    case 'pirate': {
      const black = toon('#2a2430', { roughness: 0.6 });
      const brim = add(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 24), black, 0, 0);
      brim.scale.z = 0.55;
      const crown = add(new THREE.CylinderGeometry(0.2, 0.24, 0.2, 18), black, 0, 0.11);
      crown.scale.z = 0.8;
      add(new THREE.SphereGeometry(0.05, 10, 8), toon('#ffffff'), 0, 0.12, 0.19);
      add(new THREE.TorusGeometry(0.22, 0.02, 6, 20), toon('#e8c35a', { metalness: 0.3, roughness: 0.4 }), 0, 0.03).rotation.x = Math.PI / 2;
      height = 0.24;
      break;
    }
    case 'wizard': {
      const purple = toon('#5b3fb0', { roughness: 0.55 });
      add(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 24), purple, 0, 0);
      const cone = add(new THREE.ConeGeometry(0.2, 0.55, 16), purple, 0, 0.29);
      cone.rotation.z = -0.18;
      const star = add(starGeometry(0.07, 0.03, 0.03), toon('#ffd43b', { emissive: '#ffb703', emissiveIntensity: 0.4 }), 0.06, 0.24, 0.17);
      star.rotation.x = Math.PI / 2;
      height = 0.58;
      break;
    }
    case 'flame': {
      const cols = ['#ff5a1f', '#ff9a2a', '#ffd23a'];
      cols.forEach((c, k) => {
        const f = add(new THREE.ConeGeometry(0.13 - k * 0.025, 0.42 - k * 0.08, 10), toon(c, { emissive: c, emissiveIntensity: 0.6 }), (k - 1) * 0.1, 0.18 - k * 0.02);
        f.rotation.z = (1 - k) * 0.25;
      });
      height = 0.42;
      break;
    }
    case 'astronaut': {
      const glass = new THREE.MeshStandardMaterial({ color: '#cfefff', transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.1, depthWrite: false });
      const dome = add(new THREE.SphereGeometry(0.5, 24, 16), glass, 0, -0.32);
      dome.castShadow = false;
      add(new THREE.TorusGeometry(0.42, 0.05, 8, 28), toon('#dfe6f1', { metalness: 0.4, roughness: 0.3 }), 0, -0.62).rotation.x = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.015, 0.015, 0.2, 6), toon('#9aa6b8'), 0.12, 0.24);
      add(new THREE.SphereGeometry(0.04, 8, 6), toon('#ff5a5a', { emissive: '#ff5a5a', emissiveIntensity: 0.6 }), 0.12, 0.35);
      height = 0.38;
      break;
    }
    default:
      break;
  }
  return { hat: g, height };
}
