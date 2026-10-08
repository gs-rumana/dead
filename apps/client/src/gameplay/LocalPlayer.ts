import {
  DRIVER_SPOT,
  ITEMS,
  type ItemKind,
  Frame,
  type InputFrame,
  type MotorContext,
  type MotorState,
  PlayerFlag,
  type PlayerState,
  SIM_DT,
  copyMotorState,
  inputFromWire,
  inputToWire,
  makeMotorState,
  stepMotor,
} from '@dead-tracks/shared';

interface HistoryEntry {
  input: InputFrame;
  state: MotorState;
}

/**
 * Client-side prediction and reconciliation (§6.8): the local player moves
 * immediately with the shared motor; when the host's state arrives, unacknowledged
 * inputs are replayed on top of it.
 */
export class LocalPlayer {
  readonly motor = makeMotorState();
  readonly prev = makeMotorState();
  private readonly history: HistoryEntry[] = [];
  private seq = 0;
  initialized = false;
  corrections = 0;
  /** Why the last corrections happened (debugging netcode). */
  readonly correctionLog: string[] = [];
  /** Visual offset that hides small corrections, decays toward zero. */
  readonly offset = { x: 0, y: 0, z: 0 };

  constructor(private readonly ctx: MotorContext) {}

  get lastSeq(): number {
    return this.seq;
  }

  /** One fixed 30 Hz step. Returns the input to send to the host. */
  tick(fields: Omit<InputFrame, 'seq' | 'frame'>): InputFrame {
    copyMotorState(this.prev, this.motor);
    // Predict with exactly what the host will receive (the wire format is quantised).
    const raw: InputFrame = { ...fields, seq: ++this.seq, frame: this.motor.frame };
    const input = inputFromWire(inputToWire(raw)) ?? raw;
    if (this.initialized) this.step(input);
    this.history.push({ input, state: copyMotorState(makeMotorState(), this.motor) });
    if (this.history.length > 120) this.history.shift();
    return input;
  }

  private step(input: InputFrame): void {
    stepMotor(this.ctx, this.motor, input, SIM_DT);
    if (this.motor.driving) {
      this.motor.x = DRIVER_SPOT.x;
      this.motor.y = DRIVER_SPOT.y;
      this.motor.z = DRIVER_SPOT.z;
    }
  }

  /** Applies the host's authoritative state for this player. */
  reconcile(ps: PlayerState): void {
    if (!this.initialized) {
      this.applyServer(ps, null);
      copyMotorState(this.prev, this.motor);
      this.initialized = true;
      return;
    }
    while (this.history.length > 0 && (this.history[0] as HistoryEntry).input.seq < ps.ack)
      this.history.shift();
    const at = this.history[0];
    if (!at || at.input.seq !== ps.ack) {
      // Nothing to compare (e.g. host has not processed any input yet).
      if (ps.ack === 0) return;
      this.applyServer(ps, null);
      return;
    }
    if (!this.mismatch(at.state, ps)) return;
    const beforeX = this.motor.x;
    const beforeY = this.motor.y;
    const beforeZ = this.motor.z;
    const beforeFrame = this.motor.frame;
    this.applyServer(ps, at.input);
    copyMotorState(at.state, this.motor);
    for (let i = 1; i < this.history.length; i++) {
      const h = this.history[i] as HistoryEntry;
      this.step(h.input);
      copyMotorState(h.state, this.motor);
    }
    this.corrections++;
    if (beforeFrame === this.motor.frame) {
      this.offset.x += beforeX - this.motor.x;
      this.offset.y += beforeY - this.motor.y;
      this.offset.z += beforeZ - this.motor.z;
      if (Math.hypot(this.offset.x, this.offset.y, this.offset.z) > 2)
        this.offset.x = this.offset.y = this.offset.z = 0;
    }
    copyMotorState(this.prev, this.motor);
  }

  private mismatch(s: MotorState, ps: PlayerState): boolean {
    let why = '';
    if (s.frame !== ps.frame) why = `frame ${s.frame}->${ps.frame}`;
    else if (s.driving !== ((ps.flags & PlayerFlag.Driving) !== 0)) why = 'driving';
    else if (Math.abs(s.mantle - ps.mantle) > 0.05)
      why = `mantle ${s.mantle.toFixed(2)} vs ${ps.mantle.toFixed(2)}`;
    else {
      const d = Math.hypot(s.x - ps.x, s.y - ps.y, s.z - ps.z);
      if (d > 0.03)
        why = `pos ${d.toFixed(3)} (${(s.x - ps.x).toFixed(3)},${(s.y - ps.y).toFixed(3)},${(s.z - ps.z).toFixed(3)})`;
      else if (Math.hypot(s.vx - ps.vx, s.vy - ps.vy, s.vz - ps.vz) > 0.5) why = 'vel';
    }
    if (!why) return false;
    const f = (n: number) => n.toFixed(3);
    why += ` | client v=(${f(s.vx)},${f(s.vy)},${f(s.vz)}) g=${s.grounded} z=${f(s.z)} host v=(${f(ps.vx)},${f(ps.vy)},${f(ps.vz)}) z=${f(ps.z)} hist=${this.history
      .map((h) => h.input.seq)
      .slice(0, 3)
      .join(',')}..${this.history.length}`;
    this.correctionLog.push(`${ps.ack}: ${why}`);
    if (this.correctionLog.length > 30) this.correctionLog.shift();
    return true;
  }

  private applyServer(ps: PlayerState, input: InputFrame | null): void {
    const m = this.motor;
    m.frame = ps.frame;
    m.x = ps.x;
    m.y = ps.y;
    m.z = ps.z;
    m.vx = ps.vx;
    m.vy = ps.vy;
    m.vz = ps.vz;
    m.grounded = (ps.flags & PlayerFlag.Grounded) !== 0;
    m.sprinting = (ps.flags & PlayerFlag.Sprinting) !== 0;
    m.driving = (ps.flags & PlayerFlag.Driving) !== 0;
    m.stamina = ps.stamina;
    m.airTime = ps.airTime;
    m.mantle = ps.mantle;
    m.carry = ps.carryKind ? (ITEMS[ps.carryKind as ItemKind]?.carrySpeed ?? 0.75) : 1;
    m.mx = ps.mx;
    m.my = ps.my;
    m.mz = ps.mz;
    if (input) {
      m.prevButtons = input.buttons;
      m.yaw = input.yaw;
      m.pitch = input.pitch;
    } else {
      m.yaw = ps.yaw;
      m.pitch = ps.pitch;
    }
  }

  /** Decays the correction offset; call every rendered frame. */
  decayOffset(dt: number): void {
    const k = Math.exp(-dt * 12);
    this.offset.x *= k;
    this.offset.y *= k;
    this.offset.z *= k;
  }

  get onTrain(): boolean {
    return this.motor.frame === Frame.Train;
  }
}
