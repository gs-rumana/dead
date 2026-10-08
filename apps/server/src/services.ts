import type { Accounts } from './accounts/service.ts';

/** Server-wide services the rooms use (set up by createGameServer). */
export const services: {
  accounts: Accounts | null;
  /** Accept dev-panel commands in runs (never on the public server, §6.11). */
  allowDev: boolean;
  region: string;
} = {
  accounts: null,
  allowDev: true,
  region: 'eu',
};
