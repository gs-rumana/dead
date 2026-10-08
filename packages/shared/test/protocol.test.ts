import { describe, expect, it } from 'vitest';
import { Decoder, Encoder, StateView } from '@colyseus/schema';
import { PlayerState, RunState, inputFromWire, inputToWire } from '../src/protocol/index.ts';

describe('RunState sync', () => {
  it('round-trips full state and patches through Encoder/Decoder', () => {
    const state = new RunState();
    state.seed = 1234;
    state.test.angle = 1.5;
    const p = new PlayerState();
    p.name = 'Ada';
    p.x = 12.5;
    state.players.set('a', p);

    const encoder = new Encoder(state);
    const decoder = new Decoder(new RunState());
    const view = new StateView();

    const it0 = { offset: 0 };
    encoder.encodeAll(it0);
    const full = encoder.encodeAllView(view, it0.offset, it0).slice();
    decoder.decode(full);
    expect(decoder.state.seed).toBe(1234);
    expect(decoder.state.players.get('a')?.name).toBe('Ada');

    encoder.discardChanges();
    p.x = 99;
    state.test.angle = 2;
    const it1 = { offset: 0 };
    const patch = encoder.encode(it1).slice();
    encoder.discardChanges();
    decoder.decode(patch);
    expect(decoder.state.players.get('a')?.x).toBe(99);
    expect(decoder.state.test.angle).toBe(2);
  });
});

describe('input wire format', () => {
  it('round-trips and clamps untrusted input', () => {
    const w = inputToWire({
      seq: 7,
      mx: 0.5,
      my: -1,
      yaw: 1.2345678,
      pitch: 0.1,
      buttons: 3,
      frame: 1,
    });
    const back = inputFromWire(w);
    expect(back?.seq).toBe(7);
    expect(back?.mx).toBeCloseTo(0.5, 1);
    expect(back?.frame).toBe(1);
    expect(inputFromWire([1, 2, 3])).toBeNull();
    expect(inputFromWire([1, 500, 500, 0, 9, 0, 0])?.pitch).toBeCloseTo(1.55);
    const clamped = inputFromWire([1, 127, 127, 0, 0, 0, 0]);
    expect(Math.hypot(clamped!.mx, clamped!.my)).toBeLessThanOrEqual(1.0001);
  });
});
