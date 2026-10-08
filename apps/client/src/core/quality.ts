/** Graphics quality tiers (§6.9). Picked automatically, overridable in settings. */
export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  tier: QualityTier;
  viewDistance: number;
  lod0Distance: number;
  lod1Distance: number;
  propLodDistance: number;
  grassDistance: number;
  /** Max device pixel ratio before dynamic resolution. */
  maxPixelRatio: number;
  shadows: 'blob' | 'map' | 'cascades';
  shadowMapSize: number;
  antialias: boolean;
  /** Dynamic point/spot lights allowed besides the sun (§6.9). */
  maxLights: number;
  trackDistance: number;
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  low: {
    tier: 'low',
    viewDistance: 340,
    lod0Distance: 140,
    lod1Distance: 240,
    propLodDistance: 70,
    grassDistance: 55,
    maxPixelRatio: 1.25,
    shadows: 'blob',
    shadowMapSize: 0,
    antialias: false,
    maxLights: 4,
    trackDistance: 340,
  },
  medium: {
    tier: 'medium',
    viewDistance: 520,
    lod0Distance: 200,
    lod1Distance: 360,
    propLodDistance: 120,
    grassDistance: 90,
    maxPixelRatio: 1.75,
    shadows: 'map',
    shadowMapSize: 1024,
    antialias: false,
    maxLights: 6,
    trackDistance: 480,
  },
  high: {
    tier: 'high',
    viewDistance: 720,
    lod0Distance: 260,
    lod1Distance: 460,
    propLodDistance: 180,
    grassDistance: 130,
    maxPixelRatio: 2,
    shadows: 'map',
    shadowMapSize: 2048,
    antialias: true,
    maxLights: 8,
    trackDistance: 600,
  },
};

/** Device hints for the starting tier; a short benchmark may lower it (§6.9). */
export function detectTier(): QualityTier {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency || 4;
  if (coarse) return mem >= 8 && cores >= 8 ? 'medium' : 'low';
  if (mem <= 4 || cores <= 4) return 'medium';
  return 'high';
}

export function isTouchDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}
