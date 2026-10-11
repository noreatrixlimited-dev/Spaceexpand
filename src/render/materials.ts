import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;

/** 3-step ramp that gives MeshToonMaterial its cartoon shading. */
function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export function toon(color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });
}

/** Inverted-hull outline: a slightly larger back-face copy in a dark colour. */
export function outlineMaterial(color: THREE.ColorRepresentation = '#3b2a3f'): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
}

export function lighten(hex: string, amount: number): THREE.Color {
  return new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), amount);
}
export function darken(hex: string, amount: number): THREE.Color {
  return new THREE.Color(hex).lerp(new THREE.Color('#2a1e33'), amount);
}
