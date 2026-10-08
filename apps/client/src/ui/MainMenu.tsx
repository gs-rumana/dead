import { useEffect, useState } from 'preact/hooks';
import { CLASSES, CLASS_IDS, type ClassId, usernameError } from '@dead-tracks/shared';
import { account } from '../net/account.ts';

const AGE_KEY = 'dead-tracks:age-ok';

export function ageConfirmed(): boolean {
  try {
    return localStorage.getItem(AGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** The 16+ gate (§14 M7): shown once, before anything else. */
export function AgeGate({ onOk }: { onOk: () => void }) {
  const [no, setNo] = useState(false);
  return (
    <div class="menu" data-testid="age-gate">
      <h1>Dead Tracks</h1>
      {no ? (
        <p class="tagline">Come back when you're 16. The train will still be running.</p>
      ) : (
        <>
          <p class="gate-text">
            Dead Tracks has blood, gore and frightening scenes.
            <br />
            It's meant for players aged <b>16 and over</b>.
          </p>
          <div class="row">
            <button
              data-testid="age-ok"
              onClick={() => {
                try {
                  localStorage.setItem(AGE_KEY, '1');
                } catch {
                  // Private mode: ask again next time.
                }
                onOk();
              }}
            >
              I'm 16 or older
            </button>
            <button class="secondary" onClick={() => setNo(true)}>
              I'm younger
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Re-renders a component when the account changes. */
export function useAccount(): typeof account {
  const [, force] = useState(0);
  useEffect(() => account.on(() => force((x) => x + 1)), []);
  return account;
}

/** Name, bonds and sign-in (§4.12). */
export function ProfileCard() {
  const acc = useAccount();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const p = acc.profile;
  if (!p)
    return (
      <div class="card profile" data-testid="profile">
        {acc.offline ? 'Offline: progress will sync when the server is back.' : 'Loading your profile…'}
      </div>
    );
  const save = async () => {
    const e = usernameError(name);
    if (e) {
      setErr(e);
      return;
    }
    try {
      await acc.setUsername(name);
      setEditing(false);
      setErr('');
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  return (
    <div class="card profile" data-testid="profile">
      <div class="profile-row">
        {editing ? (
          <form
            class="name-edit"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <input
              data-testid="name-input"
              value={name}
              maxLength={16}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
            <button type="submit" data-testid="name-save">
              Save
            </button>
          </form>
        ) : (
          <button
            class="link name"
            data-testid="username"
            title="Change your name"
            onClick={() => {
              setName(p.username);
              setEditing(true);
            }}
          >
            {p.username} ✎
          </button>
        )}
        <span class="bonds" data-testid="bonds" title="Bonds: earned on runs, spent on classes">
          ◈ {p.bonds}
        </span>
      </div>
      {err && <div class="error">{err}</div>}
      {acc.notice && <div class="error">{acc.notice}</div>}
      <div class="signin">
        {p.guest ? (
          <>
            <span class="dim">Playing as a guest. Sign in to keep progress on every device:</span>
            <div class="row">
              {acc.providers.map((pr) => (
                <button
                  key={pr.id}
                  class="secondary small"
                  data-testid={`signin-${pr.id}`}
                  onClick={() => void acc.signIn(pr.id)}
                >
                  {pr.name}
                </button>
              ))}
              {acc.providers.length === 0 && <span class="dim">(sign-in isn't set up on this server)</span>}
            </div>
          </>
        ) : (
          <span class="dim" data-testid="signed-in">
            Signed in with {p.providers.map((x) => x[0]!.toUpperCase() + x.slice(1)).join(', ')} ·{' '}
            <button class="link" onClick={() => void acc.signOut()}>
              sign out
            </button>
          </span>
        )}
      </div>
      <div class="dim stats">
        {p.stats.runs} runs · {p.stats.wins} wins · best km {p.stats.bestKm.toFixed(0)}
      </div>
    </div>
  );
}

/** The six classes (§4.11): pick one; unlock with bonds. */
export function ClassPicker({ value, onChange }: { value: ClassId; onChange: (c: ClassId) => void }) {
  const acc = useAccount();
  const owned = acc.classes;
  const bonds = acc.profile?.bonds ?? 0;
  const [err, setErr] = useState('');
  return (
    <div class="classes" data-testid="classes">
      {CLASS_IDS.map((id) => {
        const c = CLASSES[id];
        const has = owned.includes(id);
        return (
          <div
            key={id}
            class={`card class${value === id ? ' picked' : ''}${has ? '' : ' locked'}`}
            data-testid={`class-${id}`}
            onClick={() => has && onChange(id)}
          >
            <b>{c.name}</b>
            <span class="kit">{c.kit}</span>
            <ul>
              {c.perks.map((perk) => (
                <li key={perk}>{perk}</li>
              ))}
            </ul>
            {!has && (
              <button
                class="small"
                data-testid={`unlock-${id}`}
                disabled={bonds < c.cost || acc.offline}
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await acc.unlock(id);
                    onChange(id);
                    setErr('');
                  } catch (x) {
                    setErr((x as Error).message);
                  }
                }}
              >
                Unlock · ◈ {c.cost}
              </button>
            )}
          </div>
        );
      })}
      {err && <div class="error">{err}</div>}
    </div>
  );
}
