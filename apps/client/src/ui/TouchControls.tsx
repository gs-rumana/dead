import { useRef, useState } from 'preact/hooks';
import { Btn } from '@dead-tracks/shared';
import type { Input } from '../core/Input.ts';
import { hud } from './hudStore.ts';

const STICK_RADIUS = 56;

/** Mobile controls (§4.13): left stick, drag-to-look on the right half, context buttons. */
export function TouchControls({
  input,
  onSwap,
  onHeal,
}: {
  input: Input;
  onSwap: () => void;
  onHeal: () => void;
}) {
  const [stick, setStick] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const stickId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });
  const [sprint, setSprint] = useState(false);
  const [aim, setAim] = useState(false);
  input.touch.active = true;

  const onStickDown = (e: PointerEvent) => {
    if (stickId.current !== null) return;
    stickId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setStick({ x: e.clientX, y: e.clientY, dx: 0, dy: 0 });
  };
  const onStickMove = (e: PointerEvent) => {
    if (e.pointerId !== stickId.current || !stick) return;
    let dx = e.clientX - stick.x;
    let dy = e.clientY - stick.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    input.touch.mx = dx / STICK_RADIUS;
    input.touch.my = -dy / STICK_RADIUS;
    setStick({ ...stick, dx, dy });
  };
  const onStickUp = (e: PointerEvent) => {
    if (e.pointerId !== stickId.current) return;
    stickId.current = null;
    input.touch.mx = 0;
    input.touch.my = 0;
    setStick(null);
  };

  const onLookDown = (e: PointerEvent) => {
    if (lookId.current !== null) return;
    lookId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    lookLast.current = { x: e.clientX, y: e.clientY };
  };
  const onLookMove = (e: PointerEvent) => {
    if (e.pointerId !== lookId.current) return;
    input.touch.lookDx += e.clientX - lookLast.current.x;
    input.touch.lookDy += e.clientY - lookLast.current.y;
    lookLast.current = { x: e.clientX, y: e.clientY };
  };
  const onLookUp = (e: PointerEvent) => {
    if (e.pointerId === lookId.current) lookId.current = null;
  };

  const hold = (bit: number) => ({
    onPointerDown: (e: PointerEvent) => {
      e.stopPropagation();
      input.touch.buttons |= bit;
      input.touchTaps |= bit;
    },
    onPointerUp: () => {
      input.touch.buttons &= ~bit;
    },
    onPointerCancel: () => {
      input.touch.buttons &= ~bit;
    },
    onPointerLeave: () => {
      input.touch.buttons &= ~bit;
    },
  });

  const toggleSprint = () => {
    const on = !sprint;
    setSprint(on);
    if (on) input.touch.buttons |= Btn.Sprint;
    else input.touch.buttons &= ~Btn.Sprint;
  };

  return (
    <div class="touch interactive" data-testid="touch-controls">
      <div
        class="touch-stick-zone"
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={onStickUp}
        onPointerCancel={onStickUp}
      >
        {stick && (
          <div
            class="stick-base"
            style={{ left: `${stick.x - STICK_RADIUS}px`, top: `${stick.y - STICK_RADIUS}px` }}
          >
            <div
              class="stick-knob"
              style={{ transform: `translate(${stick.dx}px, ${stick.dy}px)` }}
            />
          </div>
        )}
      </div>
      <div
        class="touch-look-zone"
        onPointerDown={onLookDown}
        onPointerMove={onLookMove}
        onPointerUp={onLookUp}
        onPointerCancel={onLookUp}
      />
      <div class="touch-buttons">
        {hud.driving ? (
          <>
            <button class="tb" {...hold(Btn.Brake)}>
              Brake
            </button>
            <button class="tb" {...hold(Btn.Reload)}>
              Reverse
            </button>
            <button class="tb" {...hold(Btn.Whistle)}>
              Whistle
            </button>
          </>
        ) : (
          <>
            <button
              class="tb small"
              onPointerDown={(e) => {
                e.stopPropagation();
                onSwap();
              }}
            >
              Swap
            </button>
            <button class="tb small" {...hold(Btn.Reload)}>
              Reload
            </button>
            <button
              class={aim ? 'tb on' : 'tb'}
              onPointerDown={(e) => {
                e.stopPropagation();
                const on = !aim;
                setAim(on);
                if (on) input.touch.buttons |= Btn.Aim;
                else input.touch.buttons &= ~Btn.Aim;
              }}
            >
              Aim
            </button>
            {hud.carrying ? (
              <button class="tb big" {...hold(Btn.Drop)}>
                Drop
              </button>
            ) : (
              <button class="tb big fire" {...hold(Btn.Fire)}>
                Fire
              </button>
            )}
            <button
              class={sprint ? 'tb on' : 'tb'}
              onPointerDown={(e) => {
                e.stopPropagation();
                toggleSprint();
              }}
            >
              Sprint
            </button>
            <button class="tb big" {...hold(Btn.Jump)}>
              Jump
            </button>
          </>
        )}
        <button
          class="tb small"
          onPointerDown={(e) => {
            e.stopPropagation();
            onHeal();
          }}
        >
          Heal
        </button>
        <button class={hud.prompt ? 'tb use ready' : 'tb use'} {...hold(Btn.Interact)}>
          Use
        </button>
      </div>
    </div>
  );
}
