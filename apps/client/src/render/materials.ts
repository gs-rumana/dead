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
const glows = new Map<string, THREE.MeshBasicNodeMaterial>();

export function glowMaterial(color: THREE.ColorRepresentation): THREE.MeshBasicNodeMaterial {
  // Shared per colour: one pipeline, and nothing to leak when structures stream out.
  const key = new THREE.Color(color).getHexString();
  let m = glows.get(key);
  if (!m) glows.set(key, (m = new THREE.MeshBasicNodeMaterial({ color, fog: true })));
  return m;
}

/**
 * Frees an object for good. three r186 keeps a mesh's render state (and through
 * the shared material's listeners, the mesh itself) until the mesh is disposed,
 * so removing it from the scene isn't enough.
 */
export function releaseObject(root: THREE.Object3D, disposeGeometry = true): void {
  root.removeFromParent();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh && !(o as THREE.Points).isPoints && !(o as THREE.Line).isLine) return;
    // Skinned characters share cached geometry.
    if (disposeGeometry && m.geometry && !(m as THREE.SkinnedMesh).isSkinnedMesh) m.geometry.dispose();
    (o as unknown as THREE.EventDispatcher<{ dispose: object }>).dispatchEvent({ type: 'dispose' });
  });
}
