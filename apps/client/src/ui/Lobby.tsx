import { useEffect, useState } from 'preact/hooks';
import { CLASSES, type ClassId, isClassId } from '@dead-tracks/shared';
import type { LobbyConnection } from '../net/LobbyConnection.ts';
import { ClassPicker } from './MainMenu.tsx';

/** Party formation (§4.14, §6.8): who's in, their classes, then the leader starts. */
export function LobbyScreen({
  lobby,
  cls,
  onClass,
  onLeave,
}: {
  lobby: LobbyConnection;
  cls: ClassId;
  onClass: (c: ClassId) => void;
  onLeave: () => void;
}) {
  const [, force] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => lobby.onChange(() => force((x) => x + 1)), [lobby]);
  const me = lobby.state.members.get(lobby.selfId);
  const link = `${location.origin}/join/${lobby.code}`;
  const members = [...lobby.state.members.entries()];
  return (
    <div class="menu lobby" data-testid="lobby">
      <h2>Party</h2>
      <div class="party-box">
        <span class="code" data-testid="lobby-code">
          {lobby.code}
        </span>
        <button
          class="secondary small"
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setCopied(true));
          }}
        >
          {copied ? 'Link copied' : 'Copy invite link'}
        </button>
      </div>
      <ul class="members" data-testid="members">
        {members.map(([id, m]) => (
          <li key={id}>
            <b>{m.name}</b>
            {id === lobby.state.host && <span class="tag">leader</span>}
            <span class="dim">{isClassId(m.cls) ? CLASSES[m.cls].name : m.cls}</span>
            <span class={m.ready ? 'ready on' : 'ready'}>{m.ready ? 'Ready' : '…'}</span>
          </li>
        ))}
        {Array.from({ length: Math.max(0, 4 - members.length) }, (_, i) => (
          <li key={`empty${i}`} class="empty dim">
            Open seat
          </li>
        ))}
      </ul>
      <ClassPicker
        value={cls}
        onChange={(c) => {
          onClass(c);
          lobby.setClass(c);
        }}
      />
      <div class="row">
        <button
          class="secondary"
          data-testid="lobby-ready"
          onClick={() => lobby.setReady(!(me?.ready ?? false))}
        >
          {me?.ready ? 'Not ready' : 'Ready'}
        </button>
        {lobby.isHost ? (
          <button data-testid="lobby-start" onClick={() => lobby.start()}>
            Start the run
          </button>
        ) : (
          <span class="dim">The leader starts the run.</span>
        )}
        <button class="secondary" onClick={onLeave}>
          Leave
        </button>
      </div>
    </div>
  );
}
