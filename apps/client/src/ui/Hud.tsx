import { useEffect, useState } from 'preact/hooks';
import { PINGS } from '@dead-tracks/shared';
import { PING_ICONS } from '../gameplay/Pings.ts';
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

/** End of the run (§4.1): how far, how long, and what you did on the way. */
function Results({ onLeave }: { onLeave: () => void }) {
  const r = hud.result!;
  const mins = Math.floor(r.minutes);
  const secs = Math.round((r.minutes - mins) * 60);
  return (
    <div class="results interactive" data-testid="results">
      <h2>{r.won ? 'You made it to Fort Haven' : 'The dead have the train'}</h2>
      <p class="results-sub">
        {r.won ? 'The gate shuts behind the last car.' : `The run ended at km ${r.km.toFixed(1)}.`}
      </p>
      <dl>
        <dt>Distance</dt>
        <dd>km {r.km.toFixed(1)} / 80</dd>
        <dt>Time</dt>
        <dd>
          {mins}:{String(secs).padStart(2, '0')}
        </dd>
        <dt>Landmarks cleared</dt>
        <dd>{r.landmarks} / 3</dd>
        <dt>Bounties</dt>
        <dd>{r.bounties}</dd>
        <dt>Kills</dt>
        <dd>{r.kills}</dd>
        <dt>Bonds earned</dt>
        <dd data-testid="bonds-earned">
          {hud.bondsEarned >= 0 ? `◈ ${hud.bondsEarned}` : '…'}
          {r.dev ? ' (dev run)' : ''}
        </dd>
        {hud.bondsTotal >= 0 && (
          <>
            <dt>Bonds total</dt>
            <dd>◈ {hud.bondsTotal}</dd>
          </>
        )}
      </dl>
      <button data-testid="results-leave" onClick={onLeave}>
        Back to the menu
      </button>
    </div>
  );
}

export function Hud({ onMenu, onLeave }: { onMenu: () => void; onLeave: () => void }) {
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
            {hud.weather && (
              <span class={hud.bloodMoon ? 'weather blood' : 'weather'} data-testid="weather">
                {' '}
                · {hud.weather}
              </span>
            )}
          </span>
          <span class="km" data-testid="km">
            km {km.toFixed(1)} / 80
          </span>
        </div>
        <div class="route-bar">
          <div class="route-fill" style={{ width: `${(km / 80) * 100}%` }} />
          {[27, 54].map((k) => (
            <div key={k} class="route-mark biome" style={{ left: `${(k / 80) * 100}%` }} />
          ))}
          {hud.marks.map((m) => (
            <div
              key={m.name}
              class={`route-mark ${m.kind}`}
              title={`${m.name} (km ${Math.round(m.km)})`}
              style={{ left: `${(m.km / 80) * 100}%` }}
            />
          ))}
        </div>
      </div>

      {hud.pingWheel.open && (
        <div class="ping-wheel" data-testid="ping-wheel">
          {PINGS.slice(0, 6).map((label, i) => {
            const a = (i / 6) * Math.PI * 2;
            return (
              <div
                key={label}
                class={hud.pingWheel.sel === i ? `wedge ping-${i} on` : `wedge ping-${i}`}
                style={{ left: `${50 + Math.sin(a) * 38}%`, top: `${50 - Math.cos(a) * 38}%` }}
              >
                <i>{PING_ICONS[i]}</i>
                {label}
              </div>
            );
          })}
          <div class="hub">{hud.pingWheel.sel < 0 ? 'Release to mark' : ''}</div>
        </div>
      )}
      {hud.subs.length > 0 && (
        <div class="subtitles" data-testid="subtitles">
          {hud.subs.map((x) => (
            <div key={x.id}>{x.text}</div>
          ))}
        </div>
      )}
      {hud.objective && (
        <div class="objective" data-testid="objective">
          {hud.objective}
        </div>
      )}
      {hud.boss && (
        <div class="boss" data-testid="boss-bar">
          <span>{hud.boss}</span>
          <div class="bar boss-hp">
            <div style={{ width: `${Math.max(0, Math.min(1, hud.bossHp)) * 100}%` }} />
          </div>
        </div>
      )}

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
      {hud.result && <Results onLeave={onLeave} />}
      {hud.over && !hud.result && (
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
        {hud.className && <span class="class-tag">{hud.className}</span>}
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
