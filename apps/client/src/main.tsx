import './net/wsPatch.ts';
import { render } from 'preact';
import { PROTOCOL_VERSION } from '@dead-tracks/shared';
import { Game } from './core/Game.ts';
import { config } from './core/config.ts';
import { ColyseusConnection } from './net/ColyseusConnection.ts';
import type { Connection } from './net/Connection.ts';
import { WorkerConnection } from './net/WorkerConnection.ts';
import { App, type StartMode } from './ui/App.tsx';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

async function startGame(mode: StartMode): Promise<Game> {
  const opts = { protocol: PROTOCOL_VERSION, ...(config.name ? { name: config.name } : {}) };
  let conn: Connection;
  if (mode.mode === 'solo') {
    conn = await WorkerConnection.connect(opts, config.seed);
  } else {
    conn = await ColyseusConnection.connect(
      config.serverUrl,
      mode.mode === 'join' ? { ...opts, code: mode.code } : opts,
      config.seed,
    );
    if (conn.kind === 'online') history.replaceState(null, '', `/join/${conn.code}`);
  }
  const game = new Game(canvas, conn, { forceWebGL: config.forceWebGL });
  await game.init();
  game.start();
  // Handle for automated tests and debugging.
  (window as unknown as { __dt: unknown }).__dt = { game, conn };
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

if (config.autostart && !viewer) {
  const button = document.querySelector<HTMLButtonElement>(
    config.autostart === 'solo'
      ? '[data-testid=play-solo]'
      : config.autostart === 'host'
        ? '[data-testid=host]'
        : '[data-testid=join]',
  );
  button?.click();
}
