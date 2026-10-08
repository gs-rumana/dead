import './net/wsPatch.ts';
import { render } from 'preact';
import { type ClassId, PROTOCOL_VERSION } from '@dead-tracks/shared';
import { Game } from './core/Game.ts';
import { config } from './core/config.ts';
import { ColyseusConnection } from './net/ColyseusConnection.ts';
import { account } from './net/account.ts';
import { gameServer, loadRegions } from './net/regions.ts';
import type { Connection } from './net/Connection.ts';
import { WorkerConnection } from './net/WorkerConnection.ts';
import { App, type StartMode } from './ui/App.tsx';
import { setupPwa } from './core/pwa.ts';
import { setupCrashReports } from './core/crash.ts';

setupCrashReports();
setupPwa();

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

async function startGame(mode: StartMode, cls: ClassId): Promise<Game> {
  // Solo never waits long on the server: it must work offline (§8).
  if (mode.mode === 'solo') await Promise.race([account.init(), new Promise((r) => setTimeout(r, 1500))]);
  else await account.init();
  const opts = {
    protocol: PROTOCOL_VERSION,
    cls,
    ...(account.sessionToken ? { token: account.sessionToken } : {}),
    ...(config.name ? { name: config.name } : account.profile ? { name: account.profile.username } : {}),
  };
  let conn: Connection;
  if (mode.mode === 'solo') {
    conn = await WorkerConnection.connect(opts, config.seed);
  } else {
    const code = mode.mode === 'join' ? mode.code : mode.mode === 'run' ? mode.runId : undefined;
    await loadRegions();
    const server = gameServer(mode.mode === 'host' ? undefined : mode.region);
    conn = await ColyseusConnection.connect(server, code ? { ...opts, code } : opts, config.seed);
    if (conn.kind === 'online') history.replaceState(null, '', `/join/${conn.code}`);
  }
  const game = new Game(canvas, conn, { forceWebGL: config.forceWebGL });
  await game.init();
  game.start();
  // Handle for automated tests and debugging.
  (window as unknown as { __dt: unknown }).__dt = { game, conn, account };
  return game;
}

function supported(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const viewer = new URLSearchParams(location.search).get('viewer');
if (!supported()) {
  // §8: devices without WebGL2 get a friendly page instead of a broken game.
  render(
    <div class="menu" data-testid="unsupported">
      <h1>Dead Tracks</h1>
      <p class="tagline">This browser or device can't run the game (it needs WebGL 2).</p>
      <p class="tagline">Try a recent Chrome, Edge, Firefox or Safari, or another device.</p>
    </div>,
    ui,
  );
} else if (viewer) {
  const q = new URLSearchParams(location.search);
  void import('./dev/viewer.ts').then((m) =>
    m.runViewer(canvas, viewer, Number(q.get('angle') ?? 0.7), Number(q.get('dist') ?? 0.9)),
  );
} else {
  render(<App onStart={startGame} />, ui);
}

