import { Btn } from '@dead-tracks/shared';

/** Default key bindings (§4.13). Rebinding arrives with the settings screen. */
export const BINDINGS: Record<string, number> = {
  Space: Btn.Jump,
  ShiftLeft: Btn.Sprint,
  ShiftRight: Btn.Sprint,
  KeyE: Btn.Interact,
  KeyR: Btn.Reload,
  KeyG: Btn.Drop,
  KeyC: Btn.Crouch,
  ControlLeft: Btn.Crouch,
  KeyH: Btn.Whistle,
};

/**
 * Collects keyboard, mouse (Pointer Lock) and touch input. Look deltas are applied
 * every rendered frame for responsiveness; movement and buttons are sampled into
 * the 30 Hz input stream.
 */
export class Input {
  readonly keys = new Set<string>();
  private mouse = 0;
  /** Touch controls write here (TouchControls.tsx). */
  readonly touch = { mx: 0, my: 0, buttons: 0, lookDx: 0, lookDy: 0, active: false };
  private lookDx = 0;
  private lookDy = 0;
  sensitivity = 1;
  invertY = false;
  /** Buttons pressed since the last sample, so quick taps are never lost. */
  private latched = 0;
  /** Key codes pressed since the last call to consumePressed(). */
  private readonly pressed = new Set<string>();
  private wheel = 0;
  enabled = true;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', this.onWheel, { passive: true });
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  requestPointerLock(): void {
    if (!this.touch.active) void this.canvas.requestPointerLock?.()?.catch?.(() => {});
  }

  /** Look delta in radians since the last call. */
  consumeLook(): { dx: number; dy: number } {
    const k = 0.0022 * this.sensitivity;
    const dx = (this.lookDx + this.touch.lookDx * 2.2) * k;
    let dy = (this.lookDy + this.touch.lookDy * 2.2) * k;
    if (this.invertY) dy = -dy;
    this.lookDx = this.lookDy = 0;
    this.touch.lookDx = this.touch.lookDy = 0;
    return { dx, dy };
  }

  axes(): { mx: number; my: number } {
    const k = this.keys;
    let mx =
      (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) -
      (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let my =
      (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (this.touch.active && (this.touch.mx !== 0 || this.touch.my !== 0)) {
      mx = this.touch.mx;
      my = this.touch.my;
    }
    return { mx, my };
  }

  /** Currently held buttons, without consuming taps (for per-frame checks like aiming). */
  sampleHeld(): number {
    let b = this.touch.buttons;
    for (const code of this.keys) b |= BINDINGS[code] ?? 0;
    if (this.mouse & 1) b |= Btn.Fire;
    if (this.mouse & 2) b |= Btn.Aim;
    return b;
  }

  /** Held buttons plus any tapped since the last sample. */
  sampleButtons(): number {
    let b = this.latched | this.touch.buttons;
    for (const code of this.keys) b |= BINDINGS[code] ?? 0;
    if (this.mouse & 1) b |= Btn.Fire;
    if (this.mouse & 2) b |= Btn.Aim;
    this.latched = 0;
    return b;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('wheel', this.onWheel);
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (!e.repeat) this.pressed.add(e.code);
    this.keys.add(e.code);
    this.latched |= BINDINGS[e.code] ?? 0;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (this.pointerLocked) this.wheel += Math.sign(e.deltaY);
  };

  /** Keys pressed since the last call (hotbar, heal). */
  consumePressed(): Set<string> {
    const out = new Set(this.pressed);
    this.pressed.clear();
    return out;
  }

  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.mouse = 0;
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (!this.pointerLocked) {
      this.requestPointerLock();
      return;
    }
    this.mouse |= e.button === 0 ? 1 : e.button === 2 ? 2 : 0;
    if (e.button === 0) this.latched |= Btn.Fire;
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    this.mouse &= ~(e.button === 0 ? 1 : e.button === 2 ? 2 : 0);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.lookDx += e.movementX;
    this.lookDy += e.movementY;
  };
}
