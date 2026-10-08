import { Bot } from './bot.ts';

/**
 * Bot runner (§11): load tests and soak runs against a game server.
 *   pnpm --filter @dead-tracks/bots start -- --rooms 30 --bots 4 --seconds 60
 *   pnpm --filter @dead-tracks/bots start -- --join ABCD --bots 2
 *   add --horde 80 to keep a night horde around every party (dev servers only)
 */
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1] ?? '');
}
const url = args.get('url') ?? 'http://localhost:2567';
const rooms = Number(args.get('rooms') ?? 1);
const perRoom = Number(args.get('bots') ?? 4);
const seconds = Number(args.get('seconds') ?? 30);
const join = args.get('join');
const horde = Number(args.get('horde') ?? 0);

const bots: Bot[] = [];
if (join) {
  for (let i = 0; i < perRoom; i++) {
    const b = new Bot(url, `Bot ${i + 1}`);
    await b.join(join);
    bots.push(b);
  }
  console.log(`${perRoom} bots joined ${join}`);
} else {
  for (let r = 0; r < rooms; r++) {
    const driver = new Bot(url, `Driver ${r + 1}`, 'driver');
    const code = await driver.create();
    bots.push(driver);
    for (let i = 1; i < perRoom; i++) {
      const b = new Bot(url, `Bot ${r + 1}.${i}`);
      await b.join(code);
      bots.push(b);
    }
  }
  console.log(`${rooms} rooms × ${perRoom} bots running for ${seconds}s`);
}

// Keep the worst case going: night, a full horde around each party (§7 server budget).
let hordeTimer: ReturnType<typeof setInterval> | null = null;
if (horde > 0) {
  const drivers = bots.filter((b) => b.role === 'driver');
  for (const d of drivers) d.dev('time', 0.8);
  const top = () => drivers.forEach((d) => d.dev('horde', horde));
  top();
  hordeTimer = setInterval(top, 15_000);
}

const start = Date.now();
const timer = setInterval(async () => {
  const res = await fetch(`${url}/metrics`)
    .then((r) => r.json())
    .catch(() => null);
  if (res) console.log(JSON.stringify(res));
}, 5000);

await new Promise((r) => setTimeout(r, seconds * 1000));
clearInterval(timer);
if (hordeTimer) clearInterval(hordeTimer);
const patches = bots.reduce((a, b) => a + b.patches, 0);
console.log(`done after ${((Date.now() - start) / 1000).toFixed(0)}s; patches received ${patches}`);
await Promise.all(bots.map((b) => b.leave()));
process.exit(0);
