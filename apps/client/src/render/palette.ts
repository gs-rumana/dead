import * as THREE from 'three/webgpu';

/**
 * The shared palette (§5.1): every code-built mesh samples its colour from this
 * one texture, so all props batch with one material and imported packs can be
 * remapped onto the same colours.
 */
export const PALETTE = {
  // Metals and paint
  black: '#151413',
  iron: '#2b2b2e',
  ironLight: '#4a4c52',
  steel: '#7a7e85',
  brass: '#b8893a',
  brassDark: '#8a6526',
  copper: '#a35a32',
  rust: '#7a3b22',
  locoRed: '#8c2a20',
  locoRedDark: '#5e1c16',
  locoGreen: '#2f4a35',
  locoGreenDark: '#203427',
  smokebox: '#262321',
  coal: '#1f1d1c',
  glass: '#9fb7bf',
  lampGlow: '#ffd68a',
  fire: '#ff8a2a',
  // Woods
  wood: '#7a5232',
  woodDark: '#4f3420',
  woodLight: '#a07548',
  woodGray: '#857766',
  woodGrayDark: '#5f554a',
  // Nature
  grass1: '#6f8a3c',
  grass2: '#7d9446',
  grass3: '#8fa152',
  grassDry: '#b5a165',
  grassDry2: '#a08a52',
  leaf1: '#4c6b2c',
  leaf2: '#5d7d34',
  leaf3: '#3e5a25',
  leafAutumn: '#8a7a3a',
  pine1: '#2f4a2c',
  pine2: '#24392a',
  bark: '#5a4330',
  barkDark: '#3d2e22',
  barkPale: '#8a7a68',
  rock: '#8a8378',
  rockDark: '#605a52',
  rockRed: '#9c5a3c',
  rockRedDark: '#743f2b',
  sand: '#c9a774',
  dirt: '#7d6146',
  ballast: '#6e6660',
  cactus: '#5c7a3e',
  cactusDark: '#47602f',
  // People
  skin1: '#e0b28e',
  skin2: '#c68e64',
  skin3: '#9a6440',
  skin4: '#6b4128',
  denim: '#3b4a63',
  duster: '#6b5134',
  dusterDark: '#4c3a26',
  shirt: '#c8c0ae',
  shirtRed: '#7e3029',
  shirtBlue: '#4a5d78',
  hat: '#4a3a2a',
  hatDark: '#2e241b',
  leather: '#5e3d22',
  bandana: '#9b2f26',
  hair: '#3a2a1e',
  // Undead
  rot1: '#6e7a52',
  rot2: '#535c3c',
  blood: '#5c0d0d',
  bone: '#d8cdb0',
  fur: '#4d3d30',
  furDark: '#2f2620',
  pale: '#cfc8c4',
  velvet: '#4a1424',
  labCoat: '#d9d6cc',
  // Signs and paint
  white: '#e8e2d4',
  signRed: '#a33b2c',
  signYellow: '#d9b440',
} as const;

export type Swatch = keyof typeof PALETTE;

const NAMES = Object.keys(PALETTE) as Swatch[];
const SIZE = 16; // 16 x 16 swatches
const INDEX = new Map<Swatch, number>(NAMES.map((n, i) => [n, i]));

export function swatchUV(name: Swatch): [number, number] {
  const i = INDEX.get(name) ?? 0;
  const col = i % SIZE;
  const row = Math.floor(i / SIZE);
  return [(col + 0.5) / SIZE, 1 - (row + 0.5) / SIZE];
}

let texture: THREE.DataTexture | null = null;

export function paletteTexture(): THREE.DataTexture {
  if (texture) return texture;
  const data = new Uint8Array(SIZE * SIZE * 4);
  NAMES.forEach((name, i) => {
    // Store the sRGB bytes as written; the GPU decodes them (SRGBColorSpace).
    const hex = parseInt(PALETTE[name].slice(1), 16);
    const col = i % SIZE;
    // DataTexture rows start at the bottom; swatchUV flips v accordingly.
    const row = SIZE - 1 - Math.floor(i / SIZE);
    const o = (row * SIZE + col) * 4;
    data[o] = (hex >> 16) & 255;
    data[o + 1] = (hex >> 8) & 255;
    data[o + 2] = hex & 255;
    data[o + 3] = 255;
  });
  texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function swatchColor(name: Swatch, out = new THREE.Color()): THREE.Color {
  return out.set(PALETTE[name]);
}
