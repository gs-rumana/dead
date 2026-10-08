/** Weather and night types (§4.5). */
export const Weather = { Clear: 0, Rain: 1, Storm: 2, Fog: 3, Dust: 4 } as const;
export type WeatherId = (typeof Weather)[keyof typeof Weather];

export const NightType = { Clear: 0, FullMoon: 1, BloodMoon: 2, Storm: 3, Fog: 4 } as const;
export type NightTypeId = (typeof NightType)[keyof typeof NightType];

export const NIGHT_NAMES = ['Clear night', 'Full moon', 'Blood moon', 'Storm', 'Fog'] as const;
export const WEATHER_NAMES = ['Clear', 'Rain', 'Storm', 'Fog', 'Dust storm'] as const;

/** Daytime weather odds per biome [prairie, badlands, forest] (dust only in the badlands). */
export const WEATHER_ODDS: Record<WeatherId, [number, number, number]> = {
  [Weather.Clear]: [0.55, 0.5, 0.35],
  [Weather.Rain]: [0.2, 0.08, 0.3],
  [Weather.Storm]: [0.1, 0.1, 0.1],
  [Weather.Fog]: [0.15, 0.02, 0.25],
  [Weather.Dust]: [0, 0.3, 0],
};

/** Night type odds after the first night (which is always clear). */
export const NIGHT_ODDS: Record<NightTypeId, number> = {
  [NightType.Clear]: 0.34,
  [NightType.FullMoon]: 0.2,
  [NightType.BloodMoon]: 0.16,
  [NightType.Storm]: 0.15,
  [NightType.Fog]: 0.15,
};

/** How weather changes what enemies notice: sight and hearing multipliers. */
export const WEATHER_SENSES: Record<WeatherId, { sight: number; hearing: number }> = {
  [Weather.Clear]: { sight: 1, hearing: 1 },
  [Weather.Rain]: { sight: 0.85, hearing: 0.85 },
  [Weather.Storm]: { sight: 0.65, hearing: 0.6 },
  [Weather.Fog]: { sight: 0.5, hearing: 1 },
  [Weather.Dust]: { sight: 0.55, hearing: 0.8 },
};

/** Night types map to a weather look and to special enemies. */
export function nightWeather(n: NightTypeId): WeatherId {
  return n === NightType.Storm ? Weather.Storm : n === NightType.Fog ? Weather.Fog : Weather.Clear;
}

export const BLEND_MIN = 30;
export const BLEND_MAX = 60;
