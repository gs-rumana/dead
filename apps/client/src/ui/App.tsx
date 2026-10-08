import { useState } from 'preact/hooks';
import type { Game } from '../core/Game.ts';
import { config } from '../core/config.ts';
import { PerfHud } from './PerfHud.tsx';

export type StartMode = { mode: 'solo' } | { mode: 'host' } | { mode: 'join'; code: string };

interface Props {
  onStart: (mode: StartMode) => Promise<Game>;
}

export function App({ onStart }: Props) {
  const [game, setGame] = useState<Game | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState(config.code);

  const start = async (mode: StartMode) => {
    setBusy(true);
    setError('');
    try {
      setGame(await onStart(mode));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (game) {
    return (
      <>
        {config.perfHud && <PerfHud conn={game.conn} />}
        <div class="party-code" data-testid="party-code">
          {game.conn.kind === 'online' ? `Party ${game.conn.code}` : 'Solo'}
        </div>
        <button class="nudge" data-testid="nudge" onClick={() => game.nudge()}>
          Nudge test object
        </button>
      </>
    );
  }

  return (
    <div class="menu" data-testid="menu">
      <h1>Dead Tracks</h1>
      <p class="tagline">80 km of track. Not enough daylight.</p>
      <button disabled={busy} data-testid="play-solo" onClick={() => start({ mode: 'solo' })}>
        Play solo
      </button>
      <button disabled={busy} data-testid="host" onClick={() => start({ mode: 'host' })}>
        Host a party
      </button>
      <form
        class="join"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 4) void start({ mode: 'join', code });
        }}
      >
        <input
          data-testid="code-input"
          value={code}
          maxLength={4}
          placeholder="CODE"
          onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())}
        />
        <button disabled={busy || code.length !== 4} type="submit" data-testid="join">
          Join
        </button>
      </form>
      {error && (
        <p class="error" data-testid="error">
          {error}
        </p>
      )}
    </div>
  );
}
