import { Client, type Room } from '@colyseus/sdk';
import {
  Btn,
  CONSIST,
  Frame,
  PROTOCOL_VERSION,
  RUN_ROOM,
  RunState,
  SIM_DT,
  TRAIN_LENGTH,
  inputToWire,
} from '@dead-tracks/shared';

export type BotRole = 'wander' | 'driver';

/**
 * A headless player (§11 bots): joins a run over the real network path and sends
 * inputs at 30 Hz. Wanderers roam the train; a driver takes the controls.
 */
export class Bot {
  room!: Room<any, RunState>;
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private target = { x: 0, z: 0 };
  private retarget = 0;
  private t = 0;
  inputsSent = 0;
  patches = 0;

  constructor(
    private readonly url: string,
    readonly name: string,
    readonly role: BotRole = 'wander',
  ) {}

  async create(seed?: number): Promise<string> {
    const client = new Client(this.url);
    this.room = await client.create(
      RUN_ROOM,
      { protocol: PROTOCOL_VERSION, name: this.name, ...(seed === undefined ? {} : { seed }) },
      RunState,
    );
    this.attach();
    return this.room.roomId;
  }

  async join(code: string): Promise<void> {
    const client = new Client(this.url);
    this.room = await client.joinById(
      code,
      { protocol: PROTOCOL_VERSION, name: this.name },
      RunState,
    );
    this.attach();
  }

  /** Development-server commands (load tests). */
  dev(action: string, value?: number): void {
    this.room.send('cmd', value === undefined ? { t: 'dev', action } : { t: 'dev', action, value });
  }

  private attach(): void {
    this.room.onStateChange(() => this.patches++);
    this.room.onMessage('*', () => {});
    if (this.role === 'driver') this.room.send('cmd', { t: 'dev', action: 'cab' });
    this.timer = setInterval(() => this.tick(), SIM_DT * 1000);
  }

  private me() {
    return this.room.state.players.get(this.room.sessionId);
  }

  private tick(): void {
    const me = this.me();
    if (!me) return;
    this.t += SIM_DT;
    const mx = 0;
    let my = 0;
    let yaw = 0;
    let buttons = 0;
    if (this.role === 'driver') {
      // Take the controls once, then keep the throttle open.
      if (this.t > 0.5 && this.t < 0.6) buttons |= Btn.Interact;
      my = this.t > 1 ? 1 : 0;
    } else if (me.frame === Frame.Train) {
      this.retarget -= SIM_DT;
      if (this.retarget <= 0) {
        this.retarget = 2 + Math.random() * 4;
        const car = CONSIST[1 + Math.floor(Math.random() * 2)]!;
        this.target = {
          x: (Math.random() - 0.5) * 1.8,
          z: car.z0 + 1 + Math.random() * (car.def.length - 2),
        };
      }
      const dx = this.target.x - me.x;
      const dz = this.target.z - me.z;
      if (Math.hypot(dx, dz) > 0.6) {
        yaw = Math.atan2(-dx, -dz);
        my = 1;
      }
      if (Math.random() < 0.01) buttons |= Btn.Jump;
      if (Math.random() < 0.002) buttons |= Btn.Sprint;
    } else {
      // Fell off: ask to respawn on the train.
      this.room.send('cmd', { t: 'respawn' });
    }
    void TRAIN_LENGTH;
    this.room.send(
      'input',
      inputToWire({ seq: ++this.seq, mx, my, yaw, pitch: 0, buttons, frame: me.frame }),
    );
    this.inputsSent++;
  }

  async leave(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.room.leave(true).catch(() => {});
  }
}
