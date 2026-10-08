<img src="assets/icon.svg" width="64" height="64" alt="">

# Dead Tracks

Ride a steam train 80 km across an undead frontier. Co-op for 1–4 players, in the browser on PC and phones. Solo runs need no server at all.

> Release candidate: milestones M0–M8 of [GAME_PLAN.md](GAME_PLAN.md) are built. What's left before v1.0 is an open playtest on real devices (the crash-free target needs real players).

**In the game:** an 80 HUD-km run through prairie, badlands and pine forest; driving and stoking a 4-4-0; stations, junction towns reached by handcar, three landmark raids with bosses, Fort Ironwood's checkpoint and the Fort Haven finale; day and night with five weather types and four night types; six classes, bonds, guest accounts with optional Discord/Google/GitHub sign-in; party lobbies with codes, a ping wheel and a compass; touch controls, offline solo play and an installable web app.

## Running locally

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm dev          # game server on :2567 and the client on :5173
```

Open http://localhost:5173 and pick **Play solo**, or **Host a party** and share the `/join/CODE` link. Phones on the same Wi-Fi can open `http://<your-mac's-ip>:5173`.

Useful URL flags: `?autostart=solo`, `?seed=42`, `?renderer=webgl`, `?quality=low`, `?perf`, `?dev` (dev panel; also the backquote key). `/?viewer=monsters` shows the character models.

The dev server keeps accounts in `apps/server/data/` (SQLite). Dev servers allow the dev panel and a "Dev" sign-in button; production (`NODE_ENV=production`) refuses both. Deployment, sign-in providers and the other settings are in [docs/DEPLOY.md](docs/DEPLOY.md).

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test   # unit and room tests
pnpm test:e2e                              # headless browser tests (Playwright; start the game server first)
pnpm build                                 # production client and server bundles
BALANCE=1 pnpm vitest run packages/sim/test/balance.test.ts   # bot parties play full runs
cd tools/e2e && SOAK=1 npx playwright test -c playwright.soak.config.ts   # perf soaks, offline/PWA
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
