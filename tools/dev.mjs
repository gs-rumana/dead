// Runs the game server and the Vite client together: `pnpm dev`.
import { spawn } from 'node:child_process';

const procs = [
  ['server', ['--filter', '@dead-tracks/server', 'dev'], '\x1b[33m'],
  ['client', ['--filter', '@dead-tracks/client', 'dev'], '\x1b[36m'],
].map(([name, args, color]) => {
  const p = spawn('pnpm', args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (d) => {
      for (const line of d.toString().split('\n')) if (line.trim()) out.write(prefix + line + '\n');
    });
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code) => {
    console.log(`${prefix}exited (${code})`);
    shutdown();
  });
  return p;
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill('SIGTERM');
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
