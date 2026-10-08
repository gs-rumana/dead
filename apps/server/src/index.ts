import { DEFAULT_PORT } from '@dead-tracks/shared';
import { createGameServer } from './app.ts';
import { setupErrorReports } from './errors.ts';

setupErrorReports();

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const server = createGameServer();
await server.listen(port);
console.log(`[dead-tracks] server listening on :${port}`);
