import { useEffect, useState } from 'preact/hooks';
import { type ClassId, PROTOCOL_VERSION } from '@dead-tracks/shared';
import type { Game } from '../core/Game.ts';
import { config } from '../core/config.ts';
import { loadSettings, saveSettings } from '../core/settings.ts';
import { account } from '../net/account.ts';
import { LobbyConnection } from '../net/LobbyConnection.ts';
import { gameServer, loadRegions } from '../net/regions.ts';
import { LobbyScreen } from './Lobby.tsx';
import { AgeGate, ClassPicker, ProfileCard, ageConfirmed } from './MainMenu.tsx';
import { SettingsPanel } from './Settings.tsx';
import { Credits, PrivacyNotice } from './Info.tsx';
import { applyUpdate, enterFullscreen, hideIosTip, install, pwa } from '../core/pwa.ts';
import { isTouchDevice } from '../core/quality.ts';
import { Hud } from './Hud.tsx';
import { DevPanel, PauseMenu, useMenuKeys } from './Menus.tsx';
import { BackpackPanel, ShopPanel } from './Shop.tsx';
import { hud } from './hudStore.ts';
import { PerfHud } from './PerfHud.tsx';
import { TouchControls } from './TouchControls.tsx';

export type StartMode =
  | { mode: 'solo' }
  /** Straight into a new run room (tests and bots; players use the lobby). */
  | { mode: 'host' }
  | { mode: 'join'; code: string; region?: string }
  | { mode: 'run'; runId: string; region?: string };

interface Props {
  onStart: (mode: StartMode, cls: ClassId) => Promise<Game>;
}

export function App({ onStart }: Props) {
  const [game, setGame] = useState<Game | null>(null);
  const [lobby, setLobby] = useState<LobbyConnection | null>(null);
  const [gate, setGate] = useState(!ageConfirmed() && !config.autostart);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState(config.code);
  const [paused, setPaused] = useState(false);
  const [devOpen, setDevOpen] = useState(config.dev);
  const [bagOpen, setBagOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [info, setInfo] = useState<'' | 'credits' | 'privacy'>('');
  useEffect(() => pwa.on(() => rerender((x) => x + 1)), []);
  const [menuSettings] = useState(() => loadSettings());
  const [cls, setClsState] = useState<ClassId>(() => menuSettings.cls);
  const [, rerender] = useState(0);
  const setCls = (c: ClassId) => {
    setClsState(c);
    menuSettings.cls = c;
    saveSettings(menuSettings);
  };
  useEffect(() => {
    void account.init();
    void loadRegions();
  }, []);
  // Only classes the account owns can be picked.
  useEffect(
    () =>
      account.on(() => {
        if (account.profile && !account.classes.includes(cls)) setCls('drifter');
      }),
    [cls],
  );
  useEffect(() => {
    const id = setInterval(() => rerender((x) => x + 1), 150);
    const onKey = (e: KeyboardEvent) => {
      if (game && e.code === game.settings.keys.bag) {
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

  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    // §9: an outdated cached client is told to reload before joining.
    if (/protocol mismatch/i.test(msg))
      setError('A new version of the game is out. Reload the page to update.');
    else if (/not found|disposed|locked|full/i.test(msg))
      setError('That party is full, finished, or the code is wrong.');
    else setError(msg);
  };

  const start = async (mode: StartMode) => {
    // Phones: fullscreen and landscape for the run (needs this tap, §8).
    if (isTouchDevice()) enterFullscreen();
    setBusy(true);
    setError('');
    try {
      setGame(await onStart(mode, cls));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const joinOpts = () => ({
    protocol: PROTOCOL_VERSION,
    cls,
    ...(account.sessionToken ? { token: account.sessionToken } : {}),
    ...(config.name ? { name: config.name } : {}),
  });

  /** Watches a lobby: when the leader starts, everyone goes to the run. */
  const enterLobby = (l: LobbyConnection, region?: string) => {
    setLobby(l);
    const go = () => {
      if (!l.state.runId) return;
      off();
      l.leave();
      setLobby(null);
      void start({ mode: 'run', runId: l.state.runId, ...(region ? { region } : {}) });
    };
    const off = l.onChange(go);
    l.onClose(() => setLobby((cur) => (cur === l ? null : cur)));
    go();
  };

  const host = async () => {
    setBusy(true);
    setError('');
    try {
      await Promise.all([account.init(), loadRegions()]);
      enterLobby(await LobbyConnection.create(gameServer(), joinOpts(), config.seed));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const join = async (c: string) => {
    setBusy(true);
    setError('');
    try {
      await Promise.all([account.init(), loadRegions()]);
      // The party lives in its creator's region (§9.2).
      const info = await account.party(c);
      const region = info?.region;
      if (info?.room === 'lobby')
        enterLobby(await LobbyConnection.join(gameServer(region), c, joinOpts()), region);
      else {
        setBusy(false);
        await start({ mode: 'join', code: c, ...(region ? { region } : {}) });
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  // Automated starts (tests, invite links with ?autostart).
  useEffect(() => {
    if (!config.autostart) return;
    if (config.autostart === 'solo') void start({ mode: 'solo' });
    else if (config.autostart === 'host') void start({ mode: 'host' });
    else if (config.autostart === 'lobby') void host();
    else if (config.autostart === 'join' && config.code) void join(config.code);
  }, []);

  if (game) {
    const leave = () => {
      game.dispose();
      setGame(null);
      setPaused(false);
      history.replaceState(null, '', '/');
    };
    return (
      <>
        <Hud onMenu={() => setPaused(true)} onLeave={leave} />
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
            onPing={(down) => (game.touchPing = down)}
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

  if (gate) return <AgeGate onOk={() => setGate(false)} />;

  if (lobby)
    return (
      <LobbyScreen
        lobby={lobby}
        cls={cls}
        onClass={setCls}
        onLeave={() => {
          lobby.leave();
          setLobby(null);
        }}
      />
    );

  return (
    <div class="menu main" data-testid="menu">
      <h1>Dead Tracks</h1>
      <p class="tagline">80 km of track. Not enough daylight.</p>
      <div class="menu-body">
        <div class="menu-col">
          <ProfileCard />
          <ClassPicker value={cls} onChange={setCls} />
        </div>
        <div class="menu-col actions">
          <button disabled={busy} data-testid="play-solo" onClick={() => start({ mode: 'solo' })}>
            {busy ? 'Loading…' : 'Play solo'}
          </button>
          <button disabled={busy} data-testid="host" onClick={() => void host()}>
            Host a party
          </button>
          <form
            class="join"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 4) void join(code);
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
          <button class="secondary" data-testid="menu-settings" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
          {pwa.updateReady && (
            <button data-testid="update-ready" onClick={applyUpdate}>
              New version ready: reload
            </button>
          )}
          {pwa.canInstall && (
            <button class="secondary" data-testid="install" onClick={() => void install()}>
              Install the app
            </button>
          )}
          {pwa.iosTip && (
            <div class="pwa-note" data-testid="ios-tip">
              <span>For fullscreen, tap Share, then "Add to Home Screen".</span>
              <button class="link" onClick={hideIosTip}>
                OK
              </button>
            </div>
          )}
          <div class="menu-links">
            <button class="link" data-testid="open-credits" onClick={() => setInfo('credits')}>
              Credits
            </button>
            <button class="link" data-testid="open-privacy" onClick={() => setInfo('privacy')}>
              Privacy
            </button>
            {import.meta.env.VITE_SPONSORS_URL && (
              <a class="link" href={import.meta.env.VITE_SPONSORS_URL as string} target="_blank" rel="noreferrer">
                Sponsor
              </a>
            )}
          </div>
          {error && (
            <p class="error" data-testid="error">
              {error}
            </p>
          )}
        </div>
      </div>
      {info && (
        <div class="overlay interactive" onClick={(e) => e.target === e.currentTarget && setInfo('')}>
          <div class="panel wide">
            <h2>{info === 'credits' ? 'Credits' : 'Privacy'}</h2>
            {info === 'credits' ? <Credits /> : <PrivacyNotice />}
            <button onClick={() => setInfo('')}>Close</button>
          </div>
        </div>
      )}
      {settingsOpen && (
        <div class="overlay interactive" onClick={(e) => e.target === e.currentTarget && setSettingsOpen(false)}>
          <div class="panel wide">
            <h2>Settings</h2>
            <SettingsPanel settings={menuSettings} onChange={() => {}} />
            <button onClick={() => setSettingsOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
