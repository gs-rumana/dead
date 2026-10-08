import { useEffect, useState } from 'preact/hooks';
import { hud } from './hudStore.ts';

function useTick(ms: number): void {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** A round gauge (§4.15: train readouts look like the locomotive's dials). */
function Dial({
  value,
  max,
  label,
  unit,
  warn,
}: {
  value: number;
  max: number;
  label: string;
  unit: string;
  warn?: number;
}) {
  const t = Math.max(0, Math.min(1, value / max));
  const a = -135 + t * 270;
  const danger = warn !== undefined && value <= warn;
  return (
    <div class="dial">
      <svg viewBox="-50 -50 100 100">
        <circle r="46" class="dial-face" />
        {Array.from({ length: 11 }, (_, i) => {
          const ang = ((-135 + i * 27) * Math.PI) / 180;
          return (
            <line
              key={i}
              x1={Math.sin(ang) * 36}
              y1={-Math.cos(ang) * 36}
              x2={Math.sin(ang) * 42}
              y2={-Math.cos(ang) * 42}
              class="dial-tick"
            />
          );
        })}
        <line
          x1="0"
          y1="6"
          x2="0"
          y2="-36"
          class={danger ? 'dial-needle danger' : 'dial-needle'}
          transform={`rotate(${a})`}
        />
        <circle r="4" class="dial-hub" />
        <text y="24" class="dial-value">
          {Math.round(value)}
        </text>
      </svg>
      <div class="dial-label">
        {label} <span>{unit}</span>
      </div>
    </div>
  );
}

function Bar({ value, max, cls }: { value: number; max: number; cls: string }) {
  return (
    <div class={`bar ${cls}`}>
      <div style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%` }} />
    </div>
  );
}

const SHORT: Record<string, string> = {
  revolver: 'Revolver',
  rifle: 'Rifle',
  coachgun: 'Coach gun',
  shovel: 'Shovel',
  hatchet: 'Hatchet',
  dynamite: 'Dynamite',
  holywater: 'Holy water',
};

function clock(phase: number): string {
  // Day 0..0.6 maps 06:00 → 18:00; night 0.6..1 maps 18:00 → 06:00.
  const hours = phase < 0.6 ? 6 + (phase / 0.6) * 12 : 18 + ((phase - 0.6) / 0.4) * 12;
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function Hud({ onMenu }: { onMenu: () => void }) {
  useTick(100);
  if (!hud.ready) return null;
  const now = performance.now();
  hud.toasts = hud.toasts.filter((t) => t.until > now);
  const isNight = hud.dayPhase >= 0.6;
  const km = Math.min(80, hud.km);
  return (
    <div class={hud.touch ? 'hud touch-ui' : 'hud'} data-testid="hud">
      <div class="route">
        <div class="route-row">
          <span class="time" title="Time of day">
            {isNight ? '☾' : '☀'} Day {hud.day} · {clock(hud.dayPhase)}
          </span>
          <span class="km" data-testid="km">
            km {km.toFixed(1)} / 80
          </span>
        </div>
        <div class="route-bar">
          <div class="route-fill" style={{ width: `${(km / 80) * 100}%` }} />
          {[27, 40, 54].map((k) => (
            <div key={k} class="route-mark" style={{ left: `${(k / 80) * 100}%` }} />
          ))}
        </div>
      </div>

      {hud.hurt > 0.02 && <div class="hurt" style={{ opacity: Math.min(0.8, hud.hurt) }} />}

      {!hud.driving && hud.aim < 0.7 && hud.life === 0 && (
        <div class="crosshair-wrap">
          <div class="crosshair" />
          {hud.isGun && (
            <div
              class="spread"
              style={{ width: `${8 + hud.spread * 900}px`, height: `${8 + hud.spread * 900}px` }}
            />
          )}
        </div>
      )}
      {hud.hitMarker > 0 && <div class={hud.hitKill ? 'hitmarker kill' : 'hitmarker'}>✕</div>}

      {hud.weapon && hud.life === 0 && !hud.driving && (
        <div class="ammo" data-testid="ammo">
          <span class="weapon-name">{hud.weapon}</span>
          {hud.isGun && (
            <span class="rounds">
              {hud.reloading ? 'Reloading…' : `${hud.mag}`}
              <small> / {hud.reserve}</small>
            </span>
          )}
        </div>
      )}

      {hud.slots.length > 0 && hud.life === 0 && (
        <div class="hotbar" data-testid="hotbar">
          {hud.slots.map((id, i) => (
            <div key={i} class={i === hud.selected ? 'slot selected' : 'slot'}>
              <span class="key">{i + 1}</span>
              <span class="item">{SHORT[id] ?? ''}</span>
              {id === 'dynamite' && <span class="count">{hud.dynamite}</span>}
              {id === 'holywater' && <span class="count">{hud.holywater}</span>}
            </div>
          ))}
          <div class="meds" title="Q to use meds">
            ✚ {hud.bandage} · ⚗ {hud.tonic} · ${hud.cash}
          </div>
        </div>
      )}

      {hud.life === 1 && (
        <div class="downed" data-testid="downed">
          <b>You are down</b>
          <span>Bleeding out in {Math.ceil(hud.bleed)}s</span>
          {hud.revive > 0 && (
            <div class="bar revive">
              <div style={{ width: `${hud.revive * 100}%` }} />
            </div>
          )}
        </div>
      )}
      {hud.life === 2 && !hud.over && (
        <div class="downed dead" data-testid="dead">
          <b>You bled out</b>
          <span>
            You'll climb back aboard at the next station
            {hud.respawnKm ? ` (km ${hud.respawnKm})` : ''}.
          </span>
        </div>
      )}
      {hud.over && (
        <div class="over" data-testid="run-over">
          <h2>The dead have the train</h2>
          <p>Your party made it to km {Math.min(80, hud.km).toFixed(1)}.</p>
        </div>
      )}

      {hud.prompt && (
        <div class="prompt" data-testid="prompt">
          <kbd>{hud.touch ? 'Use' : 'E'}</kbd> {hud.prompt}
          {hud.holdHint && <span class="hold-hint"> · {hud.holdHint}</span>}
          {hud.holdProgress > 0 && (
            <div class="bar hold">
              <div style={{ width: `${hud.holdProgress * 100}%` }} />
            </div>
          )}
        </div>
      )}
      {hud.handcarSpeed >= 0 && (
        <div class="carrying" data-testid="handcar-hud">
          Handcar · {Math.round(hud.handcarSpeed)} km/h · stamina {Math.round(hud.stamina)}
        </div>
      )}
      {hud.carrying && (
        <div class="carrying" data-testid="carrying">
          Carrying {hud.carrying} · <kbd>{hud.touch ? 'Drop' : 'G'}</kbd> drop
          {hud.touch ? '' : ' · hold G to throw'}
        </div>
      )}

      {(hud.driving || hud.inCab) && (
        <div class="cab" data-testid="cab">
          <Dial value={hud.speedKmh} max={80} label="Speed" unit="km/h" />
          <Dial value={hud.pressure * 100} max={100} label="Steam" unit="%" warn={25} />
          <div class="cab-col">
            <div class="cab-row">
              Firebox{' '}
              <Bar value={hud.fuel} max={hud.fuelMax} cls={hud.fuel < 30 ? 'fuel low' : 'fuel'} />
            </div>
            <div class="cab-row">
              Tender <b>{hud.coal}</b> coal
            </div>
            <div class="cab-row">
              Throttle <Bar value={hud.throttle} max={1} cls="throttle" />
            </div>
            <div class="cab-row">
              Brake <Bar value={hud.brake} max={1} cls="brake" />
            </div>
            <div class="cab-row">
              Reverser <b>{hud.reverser > 0 ? 'Forward' : 'Reverse'}</b>
            </div>
            {hud.driving && !hud.touch && (
              <div class="cab-keys">
                W/S throttle · Space brake · R reverse · H whistle · E leave
              </div>
            )}
          </div>
        </div>
      )}

      {!hud.onTrain && hud.distanceToTrain > 12 && (
        <div class="train-widget" data-testid="train-widget">
          Train {Math.round(hud.distanceToTrain)} m · fuel{' '}
          {Math.round((hud.fuel / hud.fuelMax) * 100)}%
        </div>
      )}

      <div class="vitals">
        <Bar value={hud.hp} max={100} cls="hp" />
        <Bar value={hud.stamina} max={100} cls="stamina" />
      </div>

      <div class="toasts">
        {hud.toasts.map((t) => (
          <div key={t.id} class="toast">
            {t.text}
          </div>
        ))}
      </div>

      {hud.touch && (
        <button class="menu-button interactive" data-testid="menu-button" onClick={onMenu}>
          ☰
        </button>
      )}

      {!hud.touch && !hud.pointerLocked && (
        <div class="click-to-play" data-testid="click-to-play">
          <b>Click to play</b>
          <span>WASD move · Space jump · Shift sprint · E use · Esc menu</span>
        </div>
      )}
    </div>
  );
}
