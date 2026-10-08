/**
 * Installable web app and offline play (§8): the service worker, update checks on
 * each launch, install prompts, and the mobile niceties (fullscreen, landscape,
 * wake lock, haptics).
 */

type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((cb) => cb());

export const pwa = {
  /** A new version is installed and waiting (shown in the menu). */
  updateReady: false,
  /** Chrome/Android install prompt, if the browser offered one. */
  canInstall: false,
  /** iPhone/iPad Safari outside the home-screen app: show the "Add to Home Screen" tip. */
  iosTip: false,
  on(cb: Listener) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

let deferredPrompt: (Event & { prompt: () => Promise<void> }) | null = null;
let waiting: ServiceWorker | null = null;

export function standalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function setupPwa(): void {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  try {
    pwa.iosTip = ios && !standalone() && localStorage.getItem('dead-tracks:ios-tip') !== 'off';
  } catch {
    pwa.iosTip = ios && !standalone();
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as typeof deferredPrompt;
    pwa.canInstall = true;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    pwa.canInstall = false;
    notify();
  });
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  void navigator.serviceWorker.register('/sw.js').then((reg) => {
    // §9: check for a new version on every launch.
    void reg.update();
    const track = (w: ServiceWorker | null) => {
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          waiting = w;
          pwa.updateReady = true;
          notify();
        }
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) {
      waiting = reg.waiting;
      pwa.updateReady = true;
      notify();
    }
    reg.addEventListener('updatefound', () => track(reg.installing));
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloading && pwa.updateReady) {
      reloading = true;
      location.reload();
    }
  });
}

export function applyUpdate(): void {
  if (waiting) waiting.postMessage('skipWaiting');
  else location.reload();
}

export async function install(): Promise<void> {
  if (!deferredPrompt) return;
  await deferredPrompt.prompt();
  deferredPrompt = null;
  pwa.canInstall = false;
  notify();
}

export function hideIosTip(): void {
  pwa.iosTip = false;
  try {
    localStorage.setItem('dead-tracks:ios-tip', 'off');
  } catch {
    // ignore
  }
  notify();
}

/** Android: go fullscreen and lock landscape for a run. Must run inside a tap. */
export function enterFullscreen(): void {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen({ navigationUI: 'hide' })
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => {});
}

/** Keeps the screen on during a run (§8). */
export class WakeLock {
  private lock: { release: () => Promise<void> } | null = null;
  private wanted = false;

  private readonly onVisible = () => {
    if (this.wanted && document.visibilityState === 'visible') void this.acquire();
  };

  async acquire(): Promise<void> {
    this.wanted = true;
    document.addEventListener('visibilitychange', this.onVisible);
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
      };
      this.lock = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      this.lock = null;
    }
  }

  release(): void {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.onVisible);
    void this.lock?.release().catch(() => {});
    this.lock = null;
  }
}

/** Short vibrations (Android; iOS ignores them). */
export function buzz(ms: number | number[]): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // ignore
  }
}
