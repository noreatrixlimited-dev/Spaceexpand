import * as THREE from 'three';

/** Main lit material: soft, slightly glossy plastic-toy look. */
export function toon(color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0, ...extra });
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
