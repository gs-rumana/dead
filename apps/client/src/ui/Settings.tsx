import { useEffect, useState } from 'preact/hooks';
import type { QualityTier } from '../core/quality.ts';
import { ACTIONS, type Action, DEFAULT_KEYS, type Settings, keyLabel, saveSettings } from '../core/settings.ts';

/**
 * Every setting from §4.15: graphics, controls with key rebinding, audio and
 * accessibility. Used from the main menu and the pause menu.
 */
export function SettingsPanel({
  settings: s,
  onChange,
  tier,
}: {
  settings: Settings;
  /** Called after each change (the game applies it live). */
  onChange: () => void;
  /** The auto-detected tier, for the "Auto" label. */
  tier?: QualityTier;
}) {
  const [, force] = useState(0);
  const [tab, setTab] = useState<'game' | 'controls' | 'audio' | 'access'>('game');
  const [binding, setBinding] = useState<Action | null>(null);
  const update = (patch: Partial<Settings>) => {
    Object.assign(s, patch);
    saveSettings(s);
    onChange();
    force((x) => x + 1);
  };

  // Capture the next key press for a rebinding.
  useEffect(() => {
    if (!binding) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') {
        const keys = { ...s.keys };
        // A key does one thing: swap with whatever had it.
        for (const a of Object.keys(keys) as Action[]) if (keys[a] === e.code) keys[a] = s.keys[binding];
        keys[binding] = e.code;
        update({ keys });
      }
      setBinding(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [binding]);

  const range = (label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) => (
    <label>
      {label} <span>{fmt(s[key] as number)}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={s[key] as number}
        onInput={(e) => update({ [key]: Number((e.target as HTMLInputElement).value) } as Partial<Settings>)}
      />
    </label>
  );
  const check = (label: string, key: keyof Settings, testid?: string) => (
    <label class="check">
      <input
        type="checkbox"
        data-testid={testid}
        checked={s[key] as boolean}
        onChange={(e) => update({ [key]: (e.target as HTMLInputElement).checked } as Partial<Settings>)}
      />{' '}
      {label}
    </label>
  );
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div class="settings" data-testid="settings">
      <div class="tabs">
        {(
          [
            ['game', 'Graphics'],
            ['controls', 'Controls'],
            ['audio', 'Audio'],
            ['access', 'Accessibility'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} class={tab === id ? 'tab on' : 'tab'} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'game' && (
        <>
          <label>
            Quality
            <select
              value={s.quality}
              onChange={(e) => update({ quality: (e.target as HTMLSelectElement).value as QualityTier | 'auto' })}
            >
              <option value="auto">Auto{tier ? ` (${tier})` : ''}</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label>
            Frame rate cap
            <select
              value={String(s.fpsCap)}
              onChange={(e) => update({ fpsCap: Number((e.target as HTMLSelectElement).value) as 30 | 60 })}
            >
              <option value="30">30 fps</option>
              <option value="60">60 fps</option>
            </select>
          </label>
          {range('Field of view', 'fov', 55, 95, 1, (v) => `${v}°`)}
          {check('Gore', 'gore')}
          {check('Camera shake', 'cameraShake')}
        </>
      )}
      {tab === 'controls' && (
        <>
          {range('Look sensitivity', 'sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2))}
          {check('Invert Y', 'invertY')}
          <div class="keys" data-testid="keybinds">
            {ACTIONS.map((a) => (
              <div key={a.id} class="key-row">
                <span>{a.label}</span>
                <button
                  class={binding === a.id ? 'key listening' : 'key'}
                  data-testid={`bind-${a.id}`}
                  onClick={() => setBinding(a.id)}
                >
                  {binding === a.id ? 'Press a key…' : keyLabel(s.keys[a.id])}
                </button>
              </div>
            ))}
            <div class="key-row">
              <span>Hotbar</span>
              <span class="fixed">1 – 6, wheel</span>
            </div>
            <button class="secondary" onClick={() => update({ keys: { ...DEFAULT_KEYS } })}>
              Reset keys
            </button>
          </div>
        </>
      )}
      {tab === 'audio' && (
        <>
          {range('Master volume', 'masterVolume', 0, 1, 0.05, pct)}
          {range('Music volume', 'musicVolume', 0, 1, 0.05, pct)}
          {range('Effects volume', 'effectsVolume', 0, 1, 0.05, pct)}
        </>
      )}
      {tab === 'access' && (
        <>
          {check('Subtitles for important sounds', 'subtitles', 'subtitles')}
          {check('Colorblind-safe markers', 'colorblindMarkers')}
          {check('Camera shake', 'cameraShake')}
          {check('Gore', 'gore')}
        </>
      )}
    </div>
  );
}
