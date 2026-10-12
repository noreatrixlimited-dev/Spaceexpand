import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

/** Base URL for files in /public (works for the web build and inside the Android app). */
export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}models/${path}`;

export function loadGltf(path: string): Promise<GLTF> {
  let p = cache.get(path);
  if (!p) {
    p = loader.loadAsync(assetUrl(path));
    cache.set(path, p);
  }
  return p;
}

/** Collect every mesh geometry+material in a model, with transforms baked, for instancing. */
export function bakeMeshes(root: THREE.Object3D): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
  root.updateMatrixWorld(true);
  const out: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    out.push({ geometry: g, material: m.material as THREE.Material });
  });
  return out;
}

/**
 * Recolour a palette texture: pixels inside `region` get their hue/saturation replaced by
 * the target colour while keeping their light/dark shading.
 */
export function recolorTexture(
  tex: THREE.Texture,
  region: { x: number; y: number; w: number; h: number },
  color: THREE.ColorRepresentation,
): THREE.Texture {
  const img = tex.image as HTMLImageElement | ImageBitmap | HTMLCanvasElement;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img as CanvasImageSource, 0, 0);
  const data = ctx.getImageData(region.x, region.y, region.w, region.h);
  const target = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  target.getHSL(hsl);
  const c = new THREE.Color();
  const p = { h: 0, s: 0, l: 0 };
  for (let i = 0; i < data.data.length; i += 4) {
    c.setRGB(data.data[i] / 255, data.data[i + 1] / 255, data.data[i + 2] / 255, THREE.SRGBColorSpace);
    c.getHSL(p);
    c.setHSL(hsl.h, Math.min(1, hsl.s * 0.9 + 0.1), THREE.MathUtils.clamp(p.l * 0.55 + hsl.l * 0.45, 0, 1));
    const o = c.getStyle(THREE.SRGBColorSpace).match(/\d+/g)!;
    data.data[i] = +o[0];
    data.data[i + 1] = +o[1];
    data.data[i + 2] = +o[2];
  }
  ctx.putImageData(data, region.x, region.y);
  const out = new THREE.CanvasTexture(canvas);
  out.colorSpace = THREE.SRGBColorSpace;
  out.flipY = tex.flipY;
  out.magFilter = THREE.NearestFilter;
  out.minFilter = THREE.NearestFilter;
  out.generateMipmaps = false;
  return out;
}
