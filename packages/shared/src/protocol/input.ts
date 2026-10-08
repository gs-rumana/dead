import { clamp } from '../math/scalar.ts';

/** Held-button bitmask sent with every input frame. */
export const Btn = {
  Jump: 1 << 0,
  Sprint: 1 << 1,
  Fire: 1 << 2,
  Aim: 1 << 3,
  Interact: 1 << 4,
  Reload: 1 << 5,
  Drop: 1 << 6,
  Crouch: 1 << 7,
  /** Driving: brake held. */
  Brake: 1 << 8,
  Whistle: 1 << 9,
  Pump: 1 << 10,
} as const;

/** One fixed-step input (30 Hz). Yaw is relative to `frame`. */
export interface InputFrame {
  seq: number;
  /** Movement axes in [-1, 1]: x = strafe right, y = forward. */
  mx: number;
  my: number;
  yaw: number;
  pitch: number;
  buttons: number;
  /** Frame the client believed it was in when it produced this input. */
  frame: number;
}

export function emptyInput(seq = 0): InputFrame {
  return { seq, mx: 0, my: 0, yaw: 0, pitch: 0, buttons: 0, frame: 0 };
}

/** Wire form: a compact tuple. */
export type InputWire = [
  seq: number,
  mx: number,
  my: number,
  yaw: number,
  pitch: number,
  buttons: number,
  frame: number,
];

export function inputToWire(i: InputFrame): InputWire {
  return [
    i.seq,
    Math.round(clamp(i.mx, -1, 1) * 127),
    Math.round(clamp(i.my, -1, 1) * 127),
    Math.round(i.yaw * 10000) / 10000,
    Math.round(i.pitch * 10000) / 10000,
    i.buttons,
    i.frame,
  ];
}

/** Parses untrusted wire data. Returns null if malformed. */
export function inputFromWire(w: unknown): InputFrame | null {
  if (!Array.isArray(w) || w.length !== 7) return null;
  for (const v of w) if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const [seq, mx, my, yaw, pitch, buttons, frame] = w as InputWire;
  let ax = clamp(mx / 127, -1, 1);
  let ay = clamp(my / 127, -1, 1);
  const len = Math.hypot(ax, ay);
  if (len > 1) {
    ax /= len;
    ay /= len;
  }
  return {
    seq: seq >>> 0,
    mx: ax,
    my: ay,
    yaw,
    pitch: clamp(pitch, -1.55, 1.55),
    buttons: buttons & 0xffff,
    frame: frame & 0xff,
  };
}
