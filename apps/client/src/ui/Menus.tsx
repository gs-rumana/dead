import { useEffect, useState } from 'preact/hooks';
import type { Game } from '../core/Game.ts';
import type { QualityTier } from '../core/quality.ts';
import { saveSettings } from '../core/settings.ts';
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
  const s = game.settings;
  const [, force] = useState(0);
  const update = (patch: Partial<typeof s>) => {
    Object.assign(s, patch);
    saveSettings(s);
    game.applySettings();
    force((x) => x + 1);
  };
  return (
    <div
      class="overlay interactive"
      data-testid="pause-menu"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div class="panel">
        <h2>Paused</h2>
        <label>
          Graphics
          <select
            value={s.quality}
            onChange={(e) =>
              update({ quality: (e.target as HTMLSelectElement).value as QualityTier | 'auto' })
            }
          >
            <option value="auto">Auto ({game.quality.tier})</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label>
          Frame rate cap
          <select
            value={String(s.fpsCap)}
            onChange={(e) =>
              update({ fpsCap: Number((e.target as HTMLSelectElement).value) as 30 | 60 })
            }
          >
            <option value="30">30 fps</option>
            <option value="60">60 fps</option>
          </select>
        </label>
        <label>
          Field of view <span>{s.fov}°</span>
          <input
            type="range"
            min="55"
            max="95"
            value={s.fov}
            onInput={(e) => update({ fov: Number((e.target as HTMLInputElement).value) })}
          />
        </label>
        <label>
          Look sensitivity <span>{s.sensitivity.toFixed(2)}</span>
          <input
            type="range"
            min="0.2"
            max="3"
            step="0.05"
            value={s.sensitivity}
            onInput={(e) => update({ sensitivity: Number((e.target as HTMLInputElement).value) })}
          />
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={s.invertY}
            onChange={(e) => update({ invertY: (e.target as HTMLInputElement).checked })}
          />{' '}
          Invert Y
        </label>
        <label>
          Master volume <span>{Math.round(s.masterVolume * 100)}%</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={s.masterVolume}
            onInput={(e) => update({ masterVolume: Number((e.target as HTMLInputElement).value) })}
          />
        </label>
        <label>
          Effects volume <span>{Math.round(s.effectsVolume * 100)}%</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={s.effectsVolume}
            onInput={(e) => update({ effectsVolume: Number((e.target as HTMLInputElement).value) })}
          />
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={s.cameraShake}
            onChange={(e) => update({ cameraShake: (e.target as HTMLInputElement).checked })}
          />{' '}
          Camera shake
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={s.gore}
            onChange={(e) => update({ gore: (e.target as HTMLInputElement).checked })}
          />{' '}
          Gore
        </label>
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
