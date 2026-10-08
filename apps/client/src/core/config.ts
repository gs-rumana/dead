/** Runtime configuration from the URL and build environment. */
const params = new URLSearchParams(location.search);

export const config = {
  /** Force the WebGL2 backend (debugging, old devices). */
  forceWebGL: params.get('renderer') === 'webgl',
  /** Start straight into a mode, for tests and invite links. */
  autostart: params.get('autostart') as 'solo' | 'host' | 'join' | null,
  seed: params.has('seed') ? Number(params.get('seed')) >>> 0 : undefined,
  name: params.get('name') ?? undefined,
  perfHud: params.has('perf') || import.meta.env.DEV,
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
