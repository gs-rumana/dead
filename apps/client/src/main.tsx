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

render(<App onStart={startGame} />, ui);

if (config.autostart) {
  const button = document.querySelector<HTMLButtonElement>(
    config.autostart === 'solo'
      ? '[data-testid=play-solo]'
      : config.autostart === 'host'
        ? '[data-testid=host]'
        : '[data-testid=join]',
  );
  button?.click();
}
