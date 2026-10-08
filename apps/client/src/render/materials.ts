import * as THREE from 'three/webgpu';
import { paletteTexture } from './palette.ts';

/**
 * The shared stylised materials (§5.1). Flat-shaded Lambert keeps the low-poly look
 * and is cheap enough for the iPhone 11 Pro.
 */
let palette: THREE.MeshLambertNodeMaterial | null = null;
let paletteSkinned: THREE.MeshLambertNodeMaterial | null = null;
let terrain: THREE.MeshLambertNodeMaterial | null = null;

export function paletteMaterial(): THREE.MeshLambertNodeMaterial {
  palette ??= new THREE.MeshLambertNodeMaterial({ map: paletteTexture(), flatShading: true });
  return palette;
}

/** Same look for skinned characters (separate instance so pipelines don't thrash). */
export function paletteSkinnedMaterial(): THREE.MeshLambertNodeMaterial {
  paletteSkinned ??= new THREE.MeshLambertNodeMaterial({
    map: paletteTexture(),
    flatShading: true,
  });
  return paletteSkinned;
}

/** Terrain uses per-face vertex colours so biomes can blend continuously. */
export function terrainMaterial(): THREE.MeshLambertNodeMaterial {
  terrain ??= new THREE.MeshLambertNodeMaterial({ vertexColors: true, flatShading: true });
  return terrain;
}

/** Unlit glow for lamps, the firebox and windows at night. */
export function glowMaterial(color: THREE.ColorRepresentation): THREE.MeshBasicNodeMaterial {
  return new THREE.MeshBasicNodeMaterial({ color, fog: true });
}
