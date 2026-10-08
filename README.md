<img src="assets/icon.svg" width="64" height="64" alt="">

# Dead Tracks

Ride a steam train 80 km across an undead frontier. Co-op for 1–4 players, in the browser on PC and phones. Solo runs need no server at all.

> Pre-alpha. See [GAME_PLAN.md](GAME_PLAN.md) for the full design and roadmap.

## Running locally

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm dev          # game server on :2567 and the client on :5173
```

Open http://localhost:5173 and pick **Play solo**, or **Host a party** and share the `/join/CODE` link. Phones on the same Wi-Fi can open `http://<your-mac's-ip>:5173`.

Useful URL flags: `?autostart=solo`, `?seed=42`, `?renderer=webgl`, `?perf`.

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test   # unit and room tests
pnpm test:e2e                              # headless browser tests (Playwright)
pnpm build                                 # production client and server bundles
```

## Layout

| Path              | What                                                             |
| ----------------- | ---------------------------------------------------------------- |
| `apps/client`     | Vite + three.js client, Preact UI, the solo Web Worker           |
| `apps/server`     | Colyseus server; `RunRoom` is a thin adapter over `packages/sim` |
| `packages/sim`    | The authoritative game simulation (no networking code)           |
| `packages/shared` | World generation, movement, tuning data, protocol                |
| `tools/`          | Bots, asset scripts, headless browser tests                      |

## License

Code: [AGPL-3.0](LICENSE). Third-party assets keep their own licenses, listed in [assets/LICENSES.md](assets/LICENSES.md). The "Dead Tracks" name and logo are not covered by the code license.

If you enjoy the game, you can support development through GitHub Sponsors.
