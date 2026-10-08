/** Runtime configuration from the URL and build environment. */
const params = new URLSearchParams(location.search);

export const config = {
  /** Force the WebGL2 backend (debugging, old devices). */
  forceWebGL: params.get('renderer') === 'webgl',
  /** Start straight into a mode, for tests and invite links. */
  autostart: params.get('autostart') as 'solo' | 'host' | 'join' | 'lobby' | null,
  seed: params.has('seed') ? Number(params.get('seed')) >>> 0 : undefined,
  name: params.get('name') ?? undefined,
  perfHud: params.has('perf') || import.meta.env.DEV,
  /** Show the developer tuning panel from the start (?dev). */
  dev: params.has('dev'),
  /** Force a quality tier: ?quality=low|medium|high. */
  quality: params.get('quality') as 'low' | 'medium' | 'high' | null,
  /** Party code from /join/ABCD or ?code=ABCD. */
  code: (
    location.pathname.match(/\/join\/([A-Za-z]{4})/)?.[1] ??
    params.get('code') ??
    ''
  ).toUpperCase(),
  serverUrl:
    (import.meta.env.VITE_SERVER_URL as string | undefined) ??
    `${location.protocol === 'https:' ? 'https' : 'http'}://${location.hostname}:2567`,
};
