import {
  CARGO_SLOTS,
  CONSIST,
  ENEMIES,
  ENEMY_TYPES,
  FORT_POINTS,
  ITEMS,
  type ItemKind,
  SELL_RATE,
  type CarPose,
  type HandcarPose,
  type RunState,
  type World,
  doorPose,
  findInteractable,
  fortGate,
  isBulky,
  pieceWorld,
  trainInteractables,
  trainToWorld,
} from '@dead-tracks/shared';
import type { ItemView } from './ItemView.ts';

/** Something the player can act on with E (§4.8). */
export interface Target {
  /** Command target sent to the host ('' = handled by the input stream). */
  use: string;
  prompt: string;
  /** Seconds to hold E (0 = press). */
  hold: number;
  /** Optional second action: press does `use`, holding does this (bodies: carry / search). */
  holdUse?: string;
  holdPrompt?: string;
  /** Opens the shop UI for this structure. */
  shop?: string;
}

export interface Viewer {
  /** Eye position and look direction in world space. */
  ex: number;
  ey: number;
  ez: number;
  dx: number;
  dy: number;
  dz: number;
  /** Feet position in world space. */
  fx: number;
  fy: number;
  fz: number;
  /** Player frame state for train interactables. */
  frame: number;
  tx: number;
  ty: number;
  tz: number;
  yaw: number;
  pitch: number;
  carryKind: string;
  carryId: string;
}

const REACH = 3.0;

/** Score how well a point sits under the crosshair: lower is better, null if out of reach. */
function aimScore(v: Viewer, x: number, y: number, z: number, radius: number): number | null {
  const px = x - v.ex;
  const py = y - v.ey;
  const pz = z - v.ez;
  const along = px * v.dx + py * v.dy + pz * v.dz;
  if (along < -0.2) return null;
  const dist = Math.hypot(px, py, pz);
  if (dist > REACH + radius) return null;
  const off = Math.sqrt(Math.max(0, dist * dist - along * along));
  if (off > radius + 0.45 + dist * 0.12) return null;
  return off + dist * 0.15;
}

export function findTarget(
  v: Viewer,
  state: RunState,
  world: World,
  items: ItemView,
  poses: CarPose[],
  handcar: (i: number) => HandcarPose | null = () => null,
): Target | null {
  const carry = v.carryKind as ItemKind | '';
  let best: Target | null = null;
  let bestScore = Infinity;
  const offer = (t: Target, score: number | null) => {
    if (score !== null && score < bestScore) {
      bestScore = score;
      best = t;
    }
  };
  const tmp = { x: 0, y: 0, z: 0 };

  // Handcars (§4.4): ride, load cargo, hitch a trolley.
  world.spurs.forEach((_spur, i) => {
    const hp = handcar(i);
    const hs = state.handcars[i];
    if (!hp || !hs) return;
    const riders = hs.seats.toArray().filter((x) => x).length;
    let prompt: string;
    if (carry === 'trolley_kit') prompt = hs.trolley ? '' : 'Hitch the trolley';
    else if (carry) prompt = 'Load it onto the handcar';
    else prompt = riders >= 4 ? '' : `Ride the handcar (${riders}/4)`;
    if (prompt)
      offer({ use: `handcar:${i}`, prompt, hold: 0 }, aimScore(v, hp.x, hp.y + 0.9, hp.z, 1.4));
  });

  if (carry) {
    const def = ITEMS[carry];
    // Furnace.
    const fire = trainInteractables().find((f) => f.id === 'firebox')!;
    trainToWorld(poses, fire.x, fire.y, fire.tz, tmp);
    const fuel = carry === 'corpse' ? 20 : def.fuel;
    if (fuel > 0)
      offer(
        { use: 'firebox', prompt: `Burn ${def.name} (+${Math.round(fuel)} fuel)`, hold: 0 },
        aimScore(v, tmp.x, tmp.y, tmp.z, 1.2),
      );
    // Fortification points.
    if (carry === 'plate' || carry === 'wire') {
      FORT_POINTS.forEach((fp, i) => {
        if ((state.forts[i] ?? 0) !== 0) return;
        trainToWorld(poses, fp.x, fp.y, fp.z, tmp);
        // Must match the host's reach (ItemSystem.fortify: 4 m).
        if (Math.hypot(tmp.x - v.fx, tmp.y - (v.fy + 1), tmp.z - v.fz) > 3.8) return;
        offer(
          {
            use: `fort:${i}`,
            prompt: carry === 'plate' ? 'Bolt the plate on here' : 'String the wire here',
            hold: 0,
          },
          aimScore(v, tmp.x, tmp.y, tmp.z, 1.2),
        );
      });
    }
    // Cargo: anywhere near the flatcar.
    const flat = CONSIST[2]!;
    const free = CARGO_SLOTS.some((_s, i) => {
      let taken = false;
      state.items.forEach((it) => {
        if (it.slot === i && !it.holder) taken = true;
      });
      return !taken;
    });
    if (free) {
      trainToWorld(poses, 0, 1.3, flat.zc, tmp);
      const near =
        v.frame === 1
          ? v.tz > flat.z0 - 2 && v.tz < flat.z1 + 2
          : Math.hypot(tmp.x - v.fx, tmp.z - v.fz) < flat.def.length / 2 + 2.5;
      if (near) offer({ use: 'cargo', prompt: 'Stow it on the flatcar', hold: 0 }, 2.5);
    }
    // Sell at a shop counter.
    for (const st of world.structuresNear(v.fx, v.fz, 10)) {
      if (!st.shop) continue;
      const w = pieceWorld(st, st.pieces[st.shop.piece]!);
      const rate = SELL_RATE[st.shop.kind];
      const body = state.items.get(v.carryId)?.extra ?? 0;
      const value = carry === 'corpse' ? ENEMIES[ENEMY_TYPES[body] ?? 'walker'].bodyValue : def.value;
      offer(
        {
          use: `shop:${st.id}`,
          prompt: `Sell ${def.name} for $${Math.round(value * rate)}`,
          hold: 0,
        },
        aimScore(v, w.x, w.y, w.z, 1.5),
      );
    }
    return best;
  }

  // Train interactables (driving and stoking go through the input stream).
  const train = findInteractable(v.frame, v.tx, v.ty, v.tz, v.yaw, v.pitch);
  if (train)
    offer(
      {
        use: '',
        prompt:
          train.id === 'firebox' ? `${train.prompt} (${state.train.coal} left)` : train.prompt,
        hold: 0,
      },
      1.0,
    );

  // Items.
  items.forEach((id, kind, x, y, z) => {
    const it = state.items.get(id);
    if (!it || it.holder) return;
    const def = ITEMS[kind];
    if (!def) return;
    const r = isBulky(kind) ? 0.6 : 0.3;
    const score = aimScore(v, x, y + (isBulky(kind) ? 0.4 : 0.05), z, r);
    if (score === null) return;
    if (kind === 'corpse') {
      const type = ENEMY_TYPES[it.extra] ?? 'walker';
      void ENEMIES[type];
      offer(
        {
          use: `item:${id}`,
          prompt: 'Carry the body',
          hold: it.searched ? 0 : 1.2,
          ...(it.searched ? {} : { holdUse: `item:${id}`, holdPrompt: 'Search the body' }),
        },
        score,
      );
      return;
    }
    const name = kind === 'cash' ? `$${it.extra || 10}` : def.name;
    offer(
      {
        use: `item:${id}`,
        prompt: isBulky(kind) ? `Carry ${def.name}` : `Pick up ${name}`,
        hold: 0,
      },
      score,
    );
  });

  // Structures: doors, containers, shops.
  for (const st of world.structuresNear(v.fx, v.fz, 12)) {
    for (const p of st.pieces) {
      if (p.kind === 'door') {
        const open = (state.props.get(`${st.id}:${p.id}`) ?? 0) === 1;
        const w = doorPose(st, p, open ? 1 : 0);
        offer(
          {
            use: `door:${st.id}:${p.id}`,
            prompt: open ? 'Close the door' : 'Open the door',
            hold: 0,
          },
          aimScore(v, w.x, w.y, w.z, 0.7),
        );
      } else if (p.kind === 'lever' || p.kind === 'brazier') {
        // Landmark puzzles (§4.6) and Fort Haven's winch (§4.1).
        const done = state.props.get(`${st.id}:${p.id}`) === 1;
        const w = pieceWorld(st, p);
        const score = aimScore(v, w.x, w.y + 0.3, w.z, 0.6);
        if (fortGate(st)?.lever === p.id) {
          if (state.finale === 0)
            offer({ use: '', prompt: 'Start the winch', hold: 1.5, holdUse: 'winch', holdPrompt: 'Winding the winch' }, score);
        } else if (st.landmark?.triggers.includes(p.id) && !done) {
          if (p.kind === 'lever') offer({ use: `lever:${st.id}:${p.id}`, prompt: 'Pull the lever', hold: 0 }, score);
          else
            offer(
              { use: '', prompt: 'Light the brazier', hold: 1.0, holdUse: `brazier:${st.id}:${p.id}`, holdPrompt: 'Lighting the brazier' },
              score,
            );
        }
      } else if (p.kind === 'gate' && st.landmark?.gate === p.id && !state.props.get(`${st.id}:${p.id}`)) {
        const w = pieceWorld(st, p);
        const prompt = st.landmark.kind === 'ranch' ? 'Unlock the cellar door' : 'Try the iron door';
        offer({ use: `unlock:${st.id}:${p.id}`, prompt, hold: 0 }, aimScore(v, w.x, w.y, w.z, 0.8));
      } else if (p.loot && !state.props.get(`${st.id}:${p.id}`)) {
        const w = pieceWorld(st, p);
        const what =
          p.kind === 'safe'
            ? 'the safe'
            : p.kind === 'shelf'
              ? 'the shelves'
              : p.kind === 'cabinet'
                ? 'the cabinet'
                : 'the drawers';
        offer(
          {
            use: '',
            prompt: `Search ${what}`,
            hold: p.kind === 'safe' ? 2.5 : 1.2,
            holdUse: `search:${st.id}:${p.id}`,
            holdPrompt: `Search ${what}`,
          },
          aimScore(v, w.x, w.y, w.z, Math.max(p.hx, p.hz)),
        );
      }
    }
    if (st.shop) {
      const w = pieceWorld(st, st.pieces[st.shop.piece]!);
      offer(
        {
          use: '',
          prompt: st.kind === 'wagon' ? 'Trade with the merchant' : 'Shop',
          hold: 0,
          shop: st.id,
        },
        aimScore(v, w.x, w.y, w.z, 1.4),
      );
    }
  }
  return best;
}
