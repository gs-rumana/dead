import { useEffect, useState } from 'preact/hooks';
import type { Game } from '../core/Game.ts';
import { config } from '../core/config.ts';
import { isTouchDevice } from '../core/quality.ts';
import { Hud } from './Hud.tsx';
import { DevPanel, PauseMenu, useMenuKeys } from './Menus.tsx';
import { BackpackPanel, ShopPanel } from './Shop.tsx';
import { hud } from './hudStore.ts';
import { PerfHud } from './PerfHud.tsx';
import { TouchControls } from './TouchControls.tsx';

export type StartMode = { mode: 'solo' } | { mode: 'host' } | { mode: 'join'; code: string };

interface Props {
  onStart: (mode: StartMode) => Promise<Game>;
}

export function App({ onStart }: Props) {
  const [game, setGame] = useState<Game | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState(config.code);
  const [paused, setPaused] = useState(false);
  const [devOpen, setDevOpen] = useState(config.dev);
  const [bagOpen, setBagOpen] = useState(false);
  const [, rerender] = useState(0);
  useEffect(() => {
    const id = setInterval(() => rerender((x) => x + 1), 150);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Tab' && game) {
        e.preventDefault();
        setBagOpen((b) => {
          if (!b && document.pointerLockElement) document.exitPointerLock();
          return !b;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(id);
      window.removeEventListener('keydown', onKey);
    };
  }, [game]);
  useMenuKeys(
    () => {
      if (!game) return;
      // Esc closes an open panel first; otherwise toggles the pause menu.
      if (game.shopOpen) {
        game.closeShop();
        return;
      }
      setPaused((p) => !p);
    },
    () => setDevOpen((d) => !d),
  );

  const start = async (mode: StartMode) => {
    setBusy(true);
    setError('');
    try {
      setGame(await onStart(mode));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // §9: an outdated cached client is told to reload before joining.
      if (/protocol mismatch/i.test(msg))
        setError('A new version of the game is out. Reload the page to update.');
      else if (/not found|disposed|locked|full/i.test(msg))
        setError('That party is full, finished, or the code is wrong.');
      else setError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (game) {
    const leave = () => {
      game.dispose();
      setGame(null);
      setPaused(false);
      history.replaceState(null, '', '/');
    };
    return (
      <>
        <Hud onMenu={() => setPaused(true)} />
        {paused && (
          <PauseMenu
            game={game}
            onClose={() => {
              setPaused(false);
              game.input.requestPointerLock();
            }}
            onLeave={leave}
          />
        )}
        {devOpen && <DevPanel game={game} />}
        {hud.shop && <ShopPanel game={game} />}
        {bagOpen && <BackpackPanel game={game} onClose={() => setBagOpen(false)} />}
        {hud.touch && !hud.shop && (
          <button class="bag-button interactive" onClick={() => setBagOpen(true)}>
            Bag
          </button>
        )}
        {isTouchDevice() && (
          <TouchControls
            input={game.input}
            onSwap={() => game.cycleWeapon(1)}
            onHeal={() => game.heal()}
          />
        )}
        {config.perfHud && <PerfHud conn={game.conn} />}
        {game.conn.kind === 'online' && (
          <div class="party-code" data-testid="party-code">
            Party {game.conn.code}
          </div>
        )}
      </>
    );
  }

  return (
    <div class="menu" data-testid="menu">
      <h1>Dead Tracks</h1>
      <p class="tagline">80 km of track. Not enough daylight.</p>
      <button disabled={busy} data-testid="play-solo" onClick={() => start({ mode: 'solo' })}>
        {busy ? 'Loading…' : 'Play solo'}
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
