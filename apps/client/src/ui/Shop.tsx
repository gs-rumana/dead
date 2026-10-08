import { useEffect, useState } from 'preact/hooks';
import { ITEMS, type ItemKind, SELL_RATE } from '@dead-tracks/shared';
import type { Game } from '../core/Game.ts';

/** Station store and merchant wagon (§4.4, §4.10): buy supplies, sell valuables. */
export function ShopPanel({ game }: { game: Game }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, []);
  const st = game.world.structure(game.shopOpen);
  if (!st?.shop) return null;
  const inv = game.conn.state.players.get(game.conn.selfId)?.inv;
  const cash = inv?.cash ?? 0;
  const pack = inv ? inv.pack.toArray() : [];
  const rate = SELL_RATE[st.shop.kind];
  const close = () => {
    game.closeShop();
    game.input.requestPointerLock();
  };
  return (
    <div
      class="overlay interactive"
      data-testid="shop"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div class="panel shop">
        <h2>{st.kind === 'wagon' ? 'Merchant wagon' : `${st.name} store`}</h2>
        <div class="cash">Cash: ${cash}</div>
        <h3>Buy</h3>
        {st.shop.stock.map((line) => (
          <div class="shop-row" key={line.kind}>
            <span>{ITEMS[line.kind].name}</span>
            <button
              data-testid={`buy-${line.kind}`}
              disabled={cash < line.price}
              onClick={() => game.conn.send('cmd', { t: 'buy', shop: st.id, kind: line.kind })}
            >
              ${line.price}
            </button>
          </div>
        ))}
        <h3>Sell ({Math.round(rate * 100)}% of trading post prices)</h3>
        {pack.length === 0 && <div class="muted">Your backpack has nothing to sell.</div>}
        {pack.map((kind, i) => (
          <div class="shop-row" key={`${kind}-${i}`}>
            <span>{ITEMS[kind as ItemKind]?.name ?? kind}</span>
            <button
              class="secondary"
              onClick={() => game.conn.send('cmd', { t: 'sell', shop: st.id, slot: i })}
            >
              ${Math.round((ITEMS[kind as ItemKind]?.value ?? 0) * rate)}
            </button>
          </div>
        ))}
        {pack.length > 1 && (
          <button
            data-testid="sell-all"
            class="secondary"
            onClick={() => game.conn.send('cmd', { t: 'sell', shop: st.id, slot: -1 })}
          >
            Sell everything
          </button>
        )}
        <p class="muted">Carry bodies or furniture to the counter and press E to sell them.</p>
        <button onClick={close}>Close</button>
      </div>
    </div>
  );
}

/** Backpack (Tab): small items, ammo, meds and cash, with cash sharing (§4.10). */
export function BackpackPanel({ game, onClose }: { game: Game; onClose: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);
  const inv = game.conn.state.players.get(game.conn.selfId)?.inv;
  if (!inv) return null;
  return (
    <div
      class="overlay interactive"
      data-testid="backpack"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div class="panel">
        <h2>Backpack</h2>
        <div class="pack-grid">
          {Array.from({ length: 8 }, (_, i) => (
            <div class="pack-slot" key={i}>
              {inv.pack[i] ? (ITEMS[inv.pack[i] as ItemKind]?.name ?? inv.pack[i]) : ''}
            </div>
          ))}
        </div>
        <div class="muted">
          Pistol {inv.pistol} · Rifle {inv.rifle} · Shells {inv.shells} · Bandages {inv.bandage} ·
          Tonics {inv.tonic} · Dynamite {inv.dynamite} · Holy water {inv.holywater}
        </div>
        <div class="row">
          <span class="cash">Cash: ${inv.cash}</span>
          <button
            class="secondary"
            disabled={inv.cash < 10}
            onClick={() => game.conn.send('cmd', { t: 'dropcash', amount: 10 })}
          >
            Drop $10
          </button>
        </div>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
