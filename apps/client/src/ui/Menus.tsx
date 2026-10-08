import { useEffect, useState } from 'preact/hooks';
import type { Game } from '../core/Game.ts';
import { SettingsPanel } from './Settings.tsx';
import { netSim } from '../net/NetSim.ts';

/** Esc menu: settings (§4.15) and leaving the run. */
export function PauseMenu({
  game,
  onClose,
  onLeave,
}: {
  game: Game;
  onClose: () => void;
  onLeave: () => void;
}) {
  return (
    <div
      class="overlay interactive"
      data-testid="pause-menu"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div class="panel wide">
        <h2>Paused</h2>
        <SettingsPanel settings={game.settings} onChange={() => game.applySettings()} tier={game.quality.tier} />
        <div class="row">
          <button data-testid="resume" onClick={onClose}>
            Resume
          </button>
          <button class="secondary" data-testid="leave" onClick={onLeave}>
            Leave run
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hidden developer tuning panel (§12): toggle with the backquote key. */
export function DevPanel({ game }: { game: Game }) {
  const dev = (action: string, value?: number) =>
    game.conn.send('cmd', value === undefined ? { t: 'dev', action } : { t: 'dev', action, value });
  return (
    <div class="dev-panel interactive" data-testid="dev-panel">
      <b>Dev</b>
      <button onClick={() => dev('coal', 20)}>+20 coal</button>
      <button onClick={() => dev('fuel')}>Refuel</button>
      <button onClick={() => dev('infinite-fuel', 1)}>∞ fuel</button>
      <button onClick={() => dev('skip', 1000)}>Skip 1 km</button>
      <button onClick={() => dev('skip', 10000)}>Skip 10 km</button>
      <button onClick={() => dev('turbo', 4)}>Turbo ×4</button>
      <button onClick={() => dev('turbo', 1)}>Turbo off</button>
      <button onClick={() => dev('time', 0.02)}>Dawn</button>
      <button onClick={() => dev('time', 0.3)}>Noon</button>
      <button onClick={() => dev('time', 0.56)}>Dusk</button>
      <button onClick={() => dev('time', 0.8)}>Midnight</button>
      <button onClick={() => dev('cab')}>To cab</button>
      <button onClick={() => dev('respawn')}>Respawn</button>
      <button onClick={() => dev('ground')}>Step off</button>
      <button onClick={() => dev('weather', 1)}>Rain</button>
      <button onClick={() => dev('weather', 2)}>Storm</button>
      <button onClick={() => dev('weather', 3)}>Fog</button>
      <button onClick={() => dev('weather', 4)}>Dust</button>
      <button onClick={() => dev('weather', 0)}>Clear</button>
      <button onClick={() => dev('night', 1)}>Full moon</button>
      <button onClick={() => dev('night', 2)}>Blood moon</button>
      <button onClick={() => dev('landmark', 0)}>Ranch</button>
      <button onClick={() => dev('landmark', 1)}>Mine</button>
      <button onClick={() => dev('landmark', 2)}>Chateau</button>
      <button onClick={() => dev('finale')}>Finale</button>
      <NetSimControls />
    </div>
  );
}

function NetSimControls() {
  const [, force] = useState(0);
  const set = (k: keyof typeof netSim, v: number) => {
    netSim[k] = v;
    force((x) => x + 1);
  };
  return (
    <div class="netsim">
      <label>
        Latency {netSim.latencyMs} ms
        <input
          type="range"
          min="0"
          max="300"
          step="10"
          value={netSim.latencyMs}
          onInput={(e) => set('latencyMs', Number((e.target as HTMLInputElement).value))}
        />
      </label>
      <label>
        Jitter {netSim.jitterMs} ms
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={netSim.jitterMs}
          onInput={(e) => set('jitterMs', Number((e.target as HTMLInputElement).value))}
        />
      </label>
      <label>
        Loss {netSim.lossPercent}%
        <input
          type="range"
          min="0"
          max="10"
          step="0.5"
          value={netSim.lossPercent}
          onInput={(e) => set('lossPercent', Number((e.target as HTMLInputElement).value))}
        />
      </label>
    </div>
  );
}

/** Esc and backquote handling. */
export function useMenuKeys(onEscape: () => void, onDev: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Backquote') onDev();
      else if (e.code === 'Escape' || e.code === 'KeyP') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onEscape, onDev]);
}
