import * as THREE from 'three/webgpu';
import {
  CONSIST,
  Btn,
  Frame,
  Life,
  type MotorContext,
  PLAYER,
  WEAPONS,
  type WeaponId,
  nextFeature,
  routeFeatures,
  PhysicsSpace,
  Route,
  TRAIN,
  Terrain,
  World,
  ITEMS,
  handcarToWorld,
  pieceWorld,
  type ItemKind,
  WORLD,
  initPhysics,
  trainToWorld,
  trainYawAt,
  worldToTrain,
  inputToWire,
  SIM_DT,
} from '@dead-tracks/shared';
import type { GameEvent } from '@dead-tracks/shared';
import type { Connection } from '../net/Connection.ts';
import { backendName, createRenderer } from '../render/createRenderer.ts';
import { paletteSkinnedMaterial } from '../render/materials.ts';
import { type Humanoid, OUTFITS, createHumanoid } from '../render/models/humanoid.ts';
import { Sky } from '../render/Sky.ts';
import { CameraRig } from '../gameplay/CameraRig.ts';
import { Effects } from '../gameplay/Effects.ts';
import { EnemyView } from '../gameplay/EnemyView.ts';
import { INTERP_DELAY } from '../gameplay/RemotePlayers.ts';
import { Viewmodel } from '../gameplay/Viewmodel.ts';
import { Weapons } from '../gameplay/Weapons.ts';
import { paletteMaterial } from '../render/materials.ts';
import { LocalPlayer } from '../gameplay/LocalPlayer.ts';
import { RemotePlayers } from '../gameplay/RemotePlayers.ts';
import { TrainClock } from '../gameplay/TrainClock.ts';
import { TrainView } from '../gameplay/TrainView.ts';
import { TerrainStreamer } from '../world/TerrainStreamer.ts';
import { StructureView } from '../world/StructureView.ts';
import { ItemView } from '../gameplay/ItemView.ts';
import { HandcarView } from '../gameplay/HandcarView.ts';
import { type Target, findTarget } from '../gameplay/Interactions.ts';
import { TrackStreamer } from '../world/TrackStreamer.ts';
import { hud, toast } from '../ui/hudStore.ts';
import { AudioEngine } from '../audio/AudioEngine.ts';
import { Input } from './Input.ts';
import { config } from './config.ts';
import { perf, recordFrame } from './perf.ts';
import {
  QUALITY,
  type QualitySettings,
  type QualityTier,
  detectTier,
  isTouchDevice,
} from './quality.ts';
import { type Settings, loadSettings } from './settings.ts';

export interface GameOptions {
  forceWebGL: boolean;
}

/**
 * The client (§6.4): renders the decoded RunState, predicts the local player and
 * streams the world around the camera. Transport-agnostic via Connection.
 */
export class Game {
  private renderer!: THREE.WebGPURenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.1, 1500);
  /** World-anchored content lives here at absolute coordinates; its position is -origin. */
  private readonly worldRoot = new THREE.Group();
  private originX = 0;
  private originZ = 0;
  readonly settings: Settings = loadSettings();
  quality: QualitySettings;
  world!: World;
  private route!: Route;
  private terrain!: Terrain;
  private structureView!: StructureView;
  private handcarView!: HandcarView;
  private spurStreamers: TrackStreamer[] = [];
  private itemView!: ItemView;
  /** What E would act on right now. */
  target: Target | null = null;
  private useHeld = 0;
  private useTarget: Target | null = null;
  private useDone = false;
  private dropHeld = 0;
  private readonly appliedProps = new Map<string, number>();
  /** Shop UI open for this structure ('' = closed). */
  shopOpen = '';
  private space!: PhysicsSpace;
  private sky!: Sky;
  private terrainStreamer!: TerrainStreamer;
  private trackStreamer!: TrackStreamer;
  private trainView!: TrainView;
  private readonly trainClock = new TrainClock();
  private local!: LocalPlayer;
  private remotes!: RemotePlayers;
  private rig!: CameraRig;
  private selfBody!: Humanoid;
  readonly input: Input;
  private motorCtx!: MotorContext;
  private lookYaw = 0;
  private lookPitch = -0.1;
  private acc = 0;
  private last = performance.now();
  private running = false;
  private hudTimer = 0;
  private pixelRatio = 1;
  private frameBudgetMs = 1000 / 60;
  private slowFrames = 0;
  private fastFrames = 0;
  private benchmark: { from: number; until: number; samples: number[] } | null = null;
  private skipAcc = 0;
  private lastSelfX = 0;
  private lastSelfZ = 0;
  private selfSpeed = 0;
  private readonly tmpW = { x: 0, y: 0, z: 0 };
  audio: AudioEngine | null = null;
  private lastClickS = 0;
  private enemyView!: EnemyView;
  private effects!: Effects;
  private weapons!: Weapons;
  private viewmodel!: Viewmodel;
  private prevButtons = 0;
  private hurtFlash = 0;
  private shakeT = 0;
  private groanT = 2;
  private viewDelayT = 0;
  private features = routeFeatures(0);
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly conn: Connection,
    private readonly opts: GameOptions,
  ) {
    this.input = new Input(canvas);
    this.input.sensitivity = this.settings.sensitivity;
    this.input.invertY = this.settings.invertY;
    if (config.quality) this.settings.quality = config.quality;
    const tier: QualityTier =
      this.settings.quality === 'auto' ? detectTier() : this.settings.quality;
    this.quality = QUALITY[tier];
  }

  async init(): Promise<void> {
    const R = await initPhysics();
    this.renderer = await createRenderer(this.canvas, {
      forceWebGL: this.opts.forceWebGL,
      antialias: this.quality.antialias,
    });
    perf.backend = backendName(this.renderer);

    const seed = this.conn.state.seed;
    this.world = new World(seed);
    this.route = this.world.route;
    this.terrain = this.world.terrain;
    this.space = new PhysicsSpace(R, this.terrain);
    this.space.structureSource = (tx, tz) => this.world.structuresInTile(tx, tz);

    this.scene.add(this.worldRoot);
    this.sky = new Sky(1200);
    this.scene.add(this.sky.dome, this.sky.sun, this.sky.sun.target, this.sky.hemi);
    this.scene.fog = this.sky.fog;

    this.terrainStreamer = new TerrainStreamer(
      this.worldRoot,
      this.scene,
      this.terrain,
      this.quality,
    );
    this.trackStreamer = new TrackStreamer(this.worldRoot, this.route, this.quality.trackDistance);
    this.trainView = new TrainView(this.scene, this.route);
    this.motorCtx = { space: this.space, poses: this.trainView.poses, trainSpeed: 0 };
    this.local = new LocalPlayer(this.motorCtx);
    this.remotes = new RemotePlayers(this.scene, this.conn.selfId);
    this.rig = new CameraRig(this.camera);
    this.selfBody = createHumanoid(OUTFITS[0]!, paletteSkinnedMaterial());
    this.selfBody.mesh.castShadow = true;
    this.scene.add(this.selfBody.mesh);
    this.features = this.world.features;
    this.structureView = new StructureView(this.worldRoot, this.world);
    this.handcarView = new HandcarView(this.scene, this.world);
    this.remotes.handcarPose = (i) => this.handcarView.pose(i);
    this.spurStreamers = this.world.spurs.map(
      (spur) => new TrackStreamer(this.worldRoot, spur, 260, false),
    );
    this.itemView = new ItemView(this.scene);
    this.itemView.handcarPose = (i) => this.handcarView?.pose(i) ?? null;
    this.enemyView = new EnemyView(this.scene, this.terrain);
    this.effects = new Effects(this.scene);
    this.effects.gore = this.settings.gore;
    this.viewmodel = new Viewmodel();
    this.weapons = new Weapons({
      conn: this.conn,
      space: this.space,
      enemies: this.enemyView,
      effects: this.effects,
      audio: () => this.audio,
      camera: this.camera,
      origin: () => ({ x: this.originX, z: this.originZ }),
      eye: () => this.eyeWorld(),
      inventory: () => this.conn.state.players.get(this.conn.selfId)?.inv,
      alive: () => (this.conn.state.players.get(this.conn.selfId)?.life ?? 0) === Life.Alive,
      driving: () => this.local.motor.driving,
    });

    this.applyQuality();
    // §6.9: a short benchmark after the world has streamed in can lower the tier.
    this.benchmark = {
      from: performance.now() + 2500,
      until: performance.now() + 4500,
      samples: [],
    };

    // Initial train and player state.
    this.trainClock.onPatch(this.conn.state.train, performance.now());
    this.trainView.update(0, this.trainClock.s, 0, 0, this.conn.state.train.fuel, 0, 0, 0);
    this.space.setTrainPoses(this.trainView.poses);
    this.space.refresh();
    const me = this.conn.state.players.get(this.conn.selfId);
    if (me) {
      this.local.reconcile(me);
      this.lookYaw = me.yaw;
    }
    this.rebase(true);

    this.disposers.push(
      this.conn.onPatch(() => this.onPatch()),
      this.conn.onEvents((events) => {
        for (const ev of events) this.onEvent(ev);
      }),
    );
    // Audio needs a user gesture (iOS: tap to start).
    const unlock = () => {
      if (!this.audio) {
        this.audio = new AudioEngine();
        this.audio.setVolumes(this.settings.masterVolume, this.settings.effectsVolume);
        this.trainView.onChuff = (th) => this.audio?.chuff(th);
      }
      this.audio.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.disposers.push(() => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      void this.audio?.ctx.close();
    });
    window.addEventListener('resize', this.resize);
    document.addEventListener('pointerlockchange', this.onPointerLock);
    this.resize();
    hud.touch = isTouchDevice();
    hud.ready = true;
  }

  start(): void {
    this.running = true;
    this.last = performance.now();
    this.renderer.setAnimationLoop(this.frame);
  }

  dispose(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    for (const d of this.disposers) d();
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('pointerlockchange', this.onPointerLock);
    this.input.dispose();
    this.terrainStreamer.dispose();
    this.remotes.dispose();
    this.space.dispose();
    this.conn.close();
    this.renderer.dispose();
    hud.ready = false;
  }

  /** Next weapon in the hotbar (touch "Swap" button, mouse wheel). */
  cycleWeapon(dir: number): void {
    const inv = this.conn.state.players.get(this.conn.selfId)?.inv;
    if (!inv) return;
    const n = inv.slots.length;
    let slot = inv.selected;
    for (let k = 0; k < n; k++) {
      slot = (slot + (dir > 0 ? 1 : -1) + n) % n;
      if (inv.slots[slot]) break;
    }
    this.conn.send('cmd', { t: 'equip', slot });
  }

  heal(): void {
    this.conn.send('cmd', { t: 'heal' });
  }

  /** Re-applies saved settings after the menu changes them. */
  applySettings(): void {
    const s = this.settings;
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    this.effects.gore = s.gore;
    this.audio?.setVolumes(s.masterVolume, s.effectsVolume);
    const tier: QualityTier = s.quality === 'auto' ? this.quality.tier : s.quality;
    if (tier !== this.quality.tier) this.setQuality(tier);
    else this.applyQuality();
  }

  setQuality(tier: QualityTier): void {
    this.quality = QUALITY[tier];
    this.applyQuality();
  }

  /** Debug and test helpers. */
  get debug() {
    return {
      motor: this.local.motor,
      corrections: this.local.corrections,
      correctionLog: this.local.correctionLog,
      trainS: this.trainClock.s,
      origin: { x: this.originX, z: this.originZ },
      camera: this.rig.worldPos,
      tiles: this.terrainStreamer.tileCount,
      tier: this.quality.tier,
      perf,
      pixelRatio: this.pixelRatio,
      lookYaw: this.lookYaw,
      remotes: this.remotes.count,
      enemies: this.enemyView.count,
      lastShot: this.weapons.lastShot,
      target: this.target,
      fuel: this.conn.state.train.fuel,
      scene: this.scene,
      /** Camera position in train space: steady numbers mean no jitter on the train. */
      cameraInTrain: () =>
        worldToTrain(
          this.trainView.poses,
          this.rig.worldPos.x,
          this.rig.worldPos.y,
          this.rig.worldPos.z,
          { x: 0, y: 0, z: 0 },
        ),
    };
  }

  /** For tests and the dev panel: point the view. */
  look(yaw: number, pitch: number): void {
    this.lookYaw = yaw;
    this.lookPitch = pitch;
  }

  /** Test hook: turn toward the nearest living enemy's chest (or head). Returns its id. */
  aimAtNearestEnemy(head = false): string | null {
    const eye = this.eyeWorld();
    let best: { id: string; x: number; y: number; z: number; d: number } | null = null;
    this.enemyView.forEach((id, _type, x, y, z, dead) => {
      if (dead) return;
      const d = Math.hypot(x - eye.x, z - eye.z);
      if (!best || d < best.d) best = { id, x, y, z, d };
    });
    if (!best) return null;
    const b = best as { id: string; x: number; y: number; z: number; d: number };
    const ty = b.y + (head ? 1.66 : 1.15);
    // The crosshair ray passes through the camera's shoulder pivot, so aim from there.
    const offset =
      this.local.motor.frame === Frame.Train
        ? trainYawAt(this.trainView.poses, this.local.motor.z)
        : 0;
    let yaw = Math.atan2(-(b.x - eye.x), -(b.z - eye.z));
    for (let i = 0; i < 3; i++) {
      const px = eye.x + Math.cos(yaw) * 0.45;
      const pz = eye.z - Math.sin(yaw) * 0.45;
      yaw = Math.atan2(-(b.x - px), -(b.z - pz));
    }
    const px = eye.x + Math.cos(yaw) * 0.45;
    const pz = eye.z - Math.sin(yaw) * 0.45;
    this.lookYaw = yaw - offset;
    this.lookPitch = Math.atan2(ty - eye.y, Math.hypot(b.x - px, b.z - pz));
    return b.id;
  }

  /** Test hook: point the crosshair at a world position. */
  lookAt(x: number, y: number, z: number): void {
    const eye = this.eyeWorld();
    const offset =
      this.local.motor.frame === Frame.Train
        ? trainYawAt(this.trainView.poses, this.local.motor.z)
        : 0;
    let yaw = Math.atan2(-(x - eye.x), -(z - eye.z));
    for (let i = 0; i < 3; i++) {
      const px = eye.x + Math.cos(yaw) * 0.45;
      const pz = eye.z - Math.sin(yaw) * 0.45;
      yaw = Math.atan2(-(x - px), -(z - pz));
    }
    const px = eye.x + Math.cos(yaw) * 0.45;
    const pz = eye.z - Math.sin(yaw) * 0.45;
    this.lookYaw = yaw - offset;
    this.lookPitch = Math.atan2(y - eye.y, Math.hypot(x - px, z - pz));
  }

  /** Test hooks: where things are in world space. */
  piecePos(stId: string, pieceId: number): { x: number; y: number; z: number } | null {
    const st = this.world.structure(stId);
    const p = st?.pieces[pieceId];
    return st && p ? pieceWorld(st, p) : null;
  }

  itemPos(id: string): { x: number; y: number; z: number } | null {
    return this.itemView.position(id);
  }

  trainPos(x: number, y: number, z: number): { x: number; y: number; z: number } {
    return trainToWorld(this.trainView.poses, x, y, z, { x: 0, y: 0, z: 0 });
  }

  /** Test hook: pull the trigger now. */
  trigger(): void {
    this.weapons.trigger(performance.now());
  }

  /** Test hook: hold or release iron sights. */
  setAim(on: boolean): void {
    if (on) this.input.touch.buttons |= Btn.Aim;
    else this.input.touch.buttons &= ~Btn.Aim;
  }

  private applyQuality(): void {
    const q = this.quality;
    perf.tier = q.tier;
    this.sky.viewDistance = q.viewDistance;
    this.camera.far = q.viewDistance * 1.05 + 400;
    this.camera.updateProjectionMatrix();
    this.terrainStreamer.setQuality(q);
    this.trackStreamer.setDistance(q.trackDistance);
    const shadows = q.shadows !== 'blob';
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const sun = this.sky.sun;
    sun.castShadow = shadows;
    if (shadows) {
      sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      const cam = sun.shadow.camera as THREE.OrthographicCamera;
      const r = 45;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 1;
      cam.far = 260;
      cam.updateProjectionMatrix();
      sun.shadow.bias = -0.0008;
      sun.shadow.normalBias = 0.04;
    }
    this.pixelRatio = Math.min(window.devicePixelRatio, q.maxPixelRatio);
    this.frameBudgetMs = 1000 / this.settings.fpsCap;
    this.resize();
  }

  private onPatch(): void {
    const now = performance.now();
    const state = this.conn.state;
    this.trainClock.onPatch(state.train, now);
    const me = state.players.get(this.conn.selfId);
    if (me) {
      const before = this.local.motor.frame;
      this.local.reconcile(me);
      if (this.local.motor.frame !== before) this.lookYaw = this.local.motor.yaw;
    }
    this.remotes.sample(state, now);
    this.enemyView.sample(state, now);
    // Doors and boards change the local physics too, so prediction matches the host.
    state.props.forEach((v, key) => {
      if (this.appliedProps.get(key) !== v) {
        this.appliedProps.set(key, v);
        this.space.setPieceState(key, v);
      }
    });
  }

  private eyeWorld(): { x: number; y: number; z: number } {
    const p = this.selfBody.mesh.position;
    return { x: p.x + this.originX, y: p.y + PLAYER.eyeHeight, z: p.z + this.originZ };
  }

  private renderPos(wx: number, wy: number, wz: number): { x: number; y: number; z: number } {
    return { x: wx - this.originX, y: wy, z: wz - this.originZ };
  }

  private onEvent(ev: GameEvent): void {
    const self = this.conn.selfId;
    switch (ev.e) {
      case 'toast':
        toast(ev.text);
        break;
      case 'whistle':
        this.audio?.whistle();
        break;
      case 'stoke':
        this.audio?.stoke();
        break;
      case 'shot':
        if (ev.by === self) break;
        this.effects.muzzle(
          ev.ox + ev.dx * 0.6,
          ev.oy - 0.2,
          ev.oz + ev.dz * 0.6,
          ev.w === 'coachgun' ? 1.4 : 1,
        );
        this.effects.tracer(
          ev.ox + ev.dx * 0.6,
          ev.oy - 0.2,
          ev.oz + ev.dz * 0.6,
          ev.ox + ev.dx * 60,
          ev.oy + ev.dy * 60,
          ev.oz + ev.dz * 60,
        );
        this.audio?.gunshot(ev.w, this.renderPos(ev.ox, ev.oy, ev.oz));
        break;
      case 'hit': {
        this.enemyView.flash(ev.id);
        const ground = this.terrain.height(ev.x, ev.z);
        const head = ev.zone === 1;
        this.effects.blood(ev.x, ev.y, ev.z, ev.kill ? 1.6 : 1, ground);
        if (ev.kill && (head || ev.by === 'train')) this.effects.gib(ev.x, ev.y, ev.z, ground);
        this.audio?.hitFlesh(head, this.renderPos(ev.x, ev.y, ev.z));
        if (ev.by === self) {
          this.weapons.confirmHit(ev.kill);
          this.audio?.hitTick(ev.kill);
        }
        break;
      }
      case 'swing':
        if (ev.by !== self) this.remotes.swing(ev.by);
        else this.selfBody.swing();
        break;
      case 'explode': {
        const cam = this.rig.worldPos;
        this.effects.explosion(
          ev.x,
          ev.y,
          ev.z,
          ev.r,
          ev.holy,
          Math.hypot(cam.x - ev.x, cam.y - ev.y, cam.z - ev.z),
        );
        this.audio?.explosion(this.renderPos(ev.x, ev.y, ev.z));
        break;
      }
      case 'hurt':
        if (ev.id === self) {
          this.hurtFlash = Math.min(1, this.hurtFlash + ev.dmg / 30);
          this.shakeT = Math.max(this.shakeT, 0.25);
          this.audio?.hurt();
        }
        break;
      case 'downed':
        toast(
          ev.id === self
            ? 'You are down! Hold E to use a tonic, or wait for a teammate.'
            : `${this.nameOf(ev.id)} is down!`,
        );
        break;
      case 'revived':
        toast(ev.id === self ? 'Back on your feet.' : `${this.nameOf(ev.id)} was revived.`);
        break;
      case 'died':
        toast(
          ev.id === self
            ? 'You bled out. You will return at the next station.'
            : `${this.nameOf(ev.id)} bled out.`,
        );
        break;
      case 'respawned':
        if (ev.id === self) toast('You climb back aboard at the station.');
        break;
      case 'enemyAttack':
        break;
    }
  }

  /** Where a player's hands are (world), for carried items. */
  private holderPose(
    id: string,
    lx: number,
    ly: number,
    lz: number,
  ): { x: number; y: number; z: number; yaw: number } | null {
    if (id === this.conn.selfId) {
      const b = this.selfBody.mesh;
      void lx;
      void ly;
      void lz;
      return {
        x: b.position.x + this.originX,
        y: b.position.y,
        z: b.position.z + this.originZ,
        yaw: b.rotation.y,
      };
    }
    const r = this.remotes.pose(id);
    return r;
  }

  /** E: press or hold on what's under the crosshair; G: drop, hold to throw (§4.8). */
  private updateInteraction(dt: number, frame: number, lx: number, ly: number, lz: number): void {
    const me = this.conn.state.players.get(this.conn.selfId);
    const m = this.local.motor;
    const eye = this.eyeWorld();
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const alive = (me?.life ?? 0) === Life.Alive;
    this.target =
      alive && !m.driving
        ? findTarget(
            {
              ex: eye.x,
              ey: eye.y,
              ez: eye.z,
              dx: dir.x,
              dy: dir.y,
              dz: dir.z,
              fx: eye.x,
              fy: eye.y - PLAYER.eyeHeight,
              fz: eye.z,
              frame,
              tx: lx,
              ty: ly,
              tz: lz,
              yaw: this.lookYaw,
              pitch: this.lookPitch,
              carryKind: me?.carryKind ?? '',
            },
            this.conn.state,
            this.world,
            this.itemView,
            this.trainView.poses,
            (i) => this.handcarView.pose(i),
          )
        : null;
    const held = this.input.sampleHeld();
    const taps = this.input.consumeFrameTaps();
    // A tap that started and ended between frames still counts as a press.
    const eDown = ((held | taps) & Btn.Interact) !== 0 && !this.shopOpen;
    if (eDown) {
      if (this.useHeld === 0) {
        this.useTarget = this.target;
        this.useDone = false;
        const t = this.useTarget;
        if (t && t.hold === 0) {
          this.press(t);
          this.useDone = true;
        }
      }
      this.useHeld += dt;
      const t = this.useTarget;
      if (!this.useDone && t && t.hold > 0 && this.useHeld >= t.hold) {
        if (t.holdUse) this.conn.send('cmd', { t: 'use', target: t.holdUse, hold: true });
        this.useDone = true;
      }
    } else if (this.useHeld > 0) {
      const t = this.useTarget;
      // A short press on something with a hold action does the press action (carry a body).
      if (!this.useDone && t && t.use && t.holdUse && this.useHeld < Math.min(0.35, t.hold))
        this.press(t);
      this.useHeld = 0;
      this.useTarget = null;
    }
    hud.holdProgress =
      eDown && this.useTarget && !this.useDone && this.useTarget.hold > 0
        ? Math.min(1, this.useHeld / this.useTarget.hold)
        : 0;

    const gDown = (held & Btn.Drop) !== 0;
    if (gDown || taps & Btn.Drop) this.dropHeld += dt;
    else if (this.dropHeld > 0) {
      if (me?.carry) this.conn.send('cmd', { t: 'drop', throw: this.dropHeld > 0.35 });
      this.dropHeld = 0;
    }
    // Close the shop when walking away.
    if (this.shopOpen) {
      const st = this.world.structure(this.shopOpen);
      if (!st || Math.hypot(st.x - eye.x, st.z - eye.z) > 40) this.closeShop();
    }
  }

  private press(t: Target): void {
    if (t.shop) this.openShop(t.shop);
    else if (t.use) this.conn.send('cmd', { t: 'use', target: t.use });
  }

  openShop(id: string): void {
    this.shopOpen = id;
    hud.shop = id;
    this.input.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  closeShop(): void {
    this.shopOpen = '';
    hud.shop = '';
    this.input.enabled = true;
  }

  private nameOf(id: string): string {
    return this.conn.state.players.get(id)?.name ?? 'Someone';
  }

  private readonly frame = (): void => {
    if (!this.running) return;
    const now = performance.now();
    const rawDt = (now - this.last) / 1000;
    // Frame cap (§6.9: 30 or 60 fps).
    this.skipAcc += rawDt * 1000;
    if (this.skipAcc + 1 < this.frameBudgetMs * 0.92) {
      this.last = now;
      return;
    }
    this.skipAcc = 0;
    const dt = Math.min(rawDt, 0.1);
    this.last = now;
    const t0 = performance.now();

    // Look (every frame, for responsiveness).
    const look = this.input.consumeLook();
    const zoom = 1 - this.weapons.aimT * 0.3;
    this.lookYaw -= look.dx * zoom;
    this.lookPitch = Math.max(
      -1.45,
      Math.min(1.45, this.lookPitch - look.dy * zoom + this.weapons.drift),
    );
    this.weapons.drift = 0;
    const aimHeld = (this.input.sampleHeld() & Btn.Aim) !== 0;
    this.weapons.update(dt, aimHeld);

    // Train position (smoothed) and poses for prediction and rendering.
    const train = this.conn.state.train;
    const trainS = this.trainClock.update(dt, now, this.conn.stats.rttMs);
    this.motorCtx.trainSpeed = this.trainClock.speed;

    // Fixed 30 Hz input + prediction.
    this.acc += dt;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < 4) {
      this.acc -= SIM_DT;
      steps++;
      this.inputTick();
    }
    if (steps === 4) this.acc = 0;

    const night = this.sky.night;
    this.trainView.update(
      dt,
      trainS,
      this.trainClock.speed,
      train.throttle,
      train.fuel,
      night,
      this.originX,
      this.originZ,
    );
    this.space.setTrainPoses(this.trainView.poses);
    this.space.refresh();
    this.trainView.updateForts(this.conn.state.forts.toArray(), this.originX, this.originZ);

    // Local player render position (interpolated between predicted ticks).
    const alpha = this.acc / SIM_DT;
    const m = this.local.motor;
    const p = this.local.prev;
    this.local.decayOffset(dt);
    const sameFrame = m.frame === p.frame;
    const lx = (sameFrame ? p.x + (m.x - p.x) * alpha : m.x) + this.local.offset.x;
    const ly = (sameFrame ? p.y + (m.y - p.y) * alpha : m.y) + this.local.offset.y;
    const lz = (sameFrame ? p.z + (m.z - p.z) * alpha : m.z) + this.local.offset.z;

    // Body.
    let wx = lx;
    let wy = ly;
    let wz = lz;
    let bodyYaw = this.lookYaw;
    if (m.frame >= Frame.Handcar) {
      const hp = this.handcarView.pose(m.frame - Frame.Handcar);
      if (hp) {
        handcarToWorld(hp, m.x, m.y, m.z, this.tmpW);
        wx = this.tmpW.x;
        wy = this.tmpW.y;
        wz = this.tmpW.z;
      }
    } else if (m.frame === Frame.Train) {
      trainToWorld(this.trainView.poses, lx, ly, lz, this.tmpW);
      wx = this.tmpW.x;
      wy = this.tmpW.y;
      wz = this.tmpW.z;
      bodyYaw += trainYawAt(this.trainView.poses, lz);
    }
    this.selfBody.mesh.position.set(wx - this.originX, wy, wz - this.originZ);
    this.selfBody.mesh.rotation.set(0, bodyYaw, 0);
    const sp = dt > 0 ? Math.hypot(lx - this.lastSelfX, lz - this.lastSelfZ) / dt : 0;
    this.selfSpeed += (Math.min(sp, 9) - this.selfSpeed) * Math.min(1, dt * 12);
    this.lastSelfX = lx;
    this.lastSelfZ = lz;
    const me = this.conn.state.players.get(this.conn.selfId);
    const held = me?.held ?? '';
    this.selfBody.setHeld(held, paletteMaterial());
    this.selfBody.animate(dt, {
      speed: this.selfSpeed,
      grounded: m.grounded,
      pitch: this.lookPitch,
      driving: m.driving,
      mantling: m.mantle > 0,
      sprinting: m.sprinting,
      held: m.driving || me?.carry ? '' : held,
      downed: (me?.life ?? 0) !== Life.Alive,
      carrying: !!me?.carry,
    });

    const aim = this.weapons.aimT;
    const firstPerson = m.driving;
    this.selfBody.mesh.visible = !firstPerson && aim < 0.6 && (me?.life ?? 0) !== Life.Dead;
    // Camera shake from hits and explosions.
    this.shakeT = Math.max(0, this.shakeT - dt);
    const shakeAmt = this.settings.cameraShake
      ? Math.max(this.shakeT * 0.06, this.effects.shake * 0.08)
      : 0;
    this.effects.shake = Math.max(0, this.effects.shake - dt * 2);
    const sx = (Math.random() - 0.5) * shakeAmt;
    const sy = (Math.random() - 0.5) * shakeAmt;
    // Handcar riders: the camera works in world space around the seat.
    const seated = m.frame >= Frame.Handcar;
    this.rig.update(
      dt,
      firstPerson ? 'first' : 'third',
      aim,
      seated ? Frame.World : m.frame,
      seated ? wx : lx,
      seated ? wy : ly,
      seated ? wz : lz,
      this.lookYaw + sx,
      this.lookPitch + this.weapons.kick + sy,
      this.trainView.poses,
      this.space,
      this.originX,
      this.originZ,
    );
    // Iron sights zoom the view a little (§4.7).
    const fov =
      this.settings.fov * (window.innerWidth < window.innerHeight ? 1.25 : 1) * (1 - aim * 0.28);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    this.remotes.update(dt, now, this.trainView.poses, this.originX, this.originZ);
    this.enemyView.update(
      dt,
      now,
      this.trainView.poses,
      this.originX,
      this.originZ,
      this.sky.night,
    );
    this.effects.update(dt, this.originX, this.originZ);
    const camW = this.rig.worldPos;
    this.structureView.update(
      dt,
      camW.x,
      camW.z,
      Math.min(this.quality.viewDistance, 420),
      (k) => this.conn.state.props.get(k) ?? 0,
      this.sky.night,
    );
    this.itemView.update(
      dt,
      this.conn.state,
      this.trainView.poses,
      (id) => this.holderPose(id, lx, ly, lz),
      this.originX,
      this.originZ,
    );
    this.updateInteraction(dt, m.frame, lx, ly, lz);
    this.ambientGroans(dt);
    this.viewDelayT -= dt;
    if (this.viewDelayT <= 0) {
      this.viewDelayT = 1;
      this.conn.send('viewDelay', (this.conn.stats.rttMs / 2 + INTERP_DELAY) / 1000);
    }

    // World streaming around the camera, floating origin (§6.7).
    const cam = this.rig.worldPos;
    this.rebase(false);
    this.terrainStreamer.update(cam.x, cam.z, this.originX, this.originZ);
    const near = this.route.nearest(cam.x, cam.z, 400);
    this.trackStreamer.update(near ? near.s : trainS, this.originX, this.originZ);
    this.world.spurs.forEach((spur, i) => {
      const n = spur.nearest(cam.x, cam.z, 420);
      this.spurStreamers[i]!.update(n ? n.s : -1e6, this.originX, this.originZ);
    });
    this.handcarView.update(dt, this.conn.state, this.originX, this.originZ);
    if (m.frame === Frame.World) this.space.streamTiles([{ x: m.x, z: m.z }]);

    this.updateAudio(m.frame === Frame.Train, trainS);

    // Sky, lights, shadows.
    this.sky.update(this.conn.state.dayPhase, this.camera);
    this.updateShadowCamera();

    this.renderer.info.reset();
    this.renderer.autoClear = false;
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (aim > 0.55 && held) {
      // The gun and arms in their own pass (§6.9).
      this.viewmodel.setWeapon(held);
      this.viewmodel.syncLights(this.sky.hemi, this.sky.sun);
      this.viewmodel.update(
        dt,
        this.camera.aspect,
        (me?.inv?.reload ?? 0) > 0,
        this.selfSpeed * now * 0.002,
      );
      this.renderer.clearDepth();
      this.renderer.render(this.viewmodel.scene, this.viewmodel.camera);
    }
    perf.drawCalls = this.renderer.info.render.drawCalls;
    perf.triangles = this.renderer.info.render.triangles;
    perf.pixelRatio = this.pixelRatio;
    const frameMs = performance.now() - t0;
    recordFrame(rawDt * 1000);
    this.adaptResolution(rawDt * 1000, frameMs);

    this.hudTimer += dt;
    if (this.hudTimer > 0.1) {
      this.hudTimer = 0;
      this.updateHud();
    }
  };

  private updateAudio(onTrain: boolean, trainS: number): void {
    const a = this.audio;
    if (!a?.running) return;
    const cam = this.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    a.setListener(cam.position.x, cam.position.y, cam.position.z, dir.x, dir.y, dir.z);
    const loco = this.trainView.locoPose;
    a.setLocoPosition(
      loco.cx - this.originX + loco.bx * -3.6,
      loco.cy + 4.2,
      loco.cz - this.originZ + loco.bz * -3.6,
    );
    const speed = Math.abs(this.trainClock.speed);
    a.setWind(onTrain ? speed : this.selfSpeed);
    // Rail joints every 12.5 m.
    const joint = Math.floor(trainS / 12.5);
    if (joint !== this.lastClickS) {
      if (onTrain && speed > 1) a.railClick(speed);
      this.lastClickS = joint;
    }
  }

  private inputTick(): void {
    const axes = this.input.axes();
    const buttons = this.input.sampleButtons();
    const pressed = buttons & ~this.prevButtons;
    this.prevButtons = buttons;
    if (pressed & Btn.Fire && !this.local.motor.driving) {
      this.weapons.trigger(performance.now());
      const w = this.weapons.held();
      if (w?.kind === 'gun') this.viewmodel.fire(w.recoil);
      else if (w?.kind === 'melee') this.viewmodel.melee();
    }
    const keys = this.input.consumePressed();
    const inv = this.conn.state.players.get(this.conn.selfId)?.inv;
    for (let i = 1; i <= 6; i++) {
      if (keys.has(`Digit${i}`)) this.conn.send('cmd', { t: 'equip', slot: i - 1 });
    }
    const wheel = this.input.consumeWheel();
    if (wheel !== 0 && inv) this.cycleWeapon(wheel);
    if (keys.has('KeyQ')) this.conn.send('cmd', { t: 'heal' });
    const before = this.local.motor.frame;
    const input = this.local.tick({
      mx: axes.mx,
      my: axes.my,
      yaw: this.lookYaw,
      pitch: this.lookPitch,
      buttons,
    });
    if (this.local.motor.frame !== before) this.lookYaw = this.local.motor.yaw;
    this.conn.send('input', inputToWire(input));
  }

  private rebase(force: boolean): void {
    const cam = this.rig.worldPos;
    const x = force ? this.trainView.locoPose.cx : cam.x;
    const z = force ? this.trainView.locoPose.cz : cam.z;
    if (
      !force &&
      Math.abs(x - this.originX) < WORLD.rebaseDistance &&
      Math.abs(z - this.originZ) < WORLD.rebaseDistance
    )
      return;
    this.originX = Math.round(x / 128) * 128;
    this.originZ = Math.round(z / 128) * 128;
    this.worldRoot.position.set(-this.originX, 0, -this.originZ);
    this.worldRoot.updateMatrixWorld(true);
    this.space.rebase(this.originX, this.originZ);
  }

  private updateShadowCamera(): void {
    const sun = this.sky.sun;
    if (!sun.castShadow) {
      sun.position.copy(this.sky.lightDir).multiplyScalar(100);
      return;
    }
    // Follow the player, snapped to shadow texels to avoid shimmer.
    const target = this.selfBody.mesh.position;
    const texel = 90 / this.quality.shadowMapSize;
    const tx = Math.round(target.x / texel) * texel;
    const tz = Math.round(target.z / texel) * texel;
    sun.target.position.set(tx, target.y, tz);
    sun.position.set(tx, target.y, tz).addScaledVector(this.sky.lightDir, 120);
    sun.target.updateMatrixWorld();
  }

  /** Dynamic resolution (§6.9) plus the startup benchmark that can drop a tier. */
  private adaptResolution(frameIntervalMs: number, workMs: number): void {
    const b = this.benchmark;
    if (b) {
      const now = performance.now();
      if (now >= b.from) b.samples.push(frameIntervalMs);
      if (now > b.until) {
        this.benchmark = null;
        const sorted = b.samples.sort((x, y) => x - y);
        const median = sorted[Math.floor(sorted.length / 2)] ?? this.frameBudgetMs;
        const fps = 1000 / median;
        const target = this.settings.fpsCap;
        if (
          this.settings.quality === 'auto' &&
          fps < target * 0.75 &&
          this.quality.tier !== 'low'
        ) {
          this.setQuality(this.quality.tier === 'high' ? 'medium' : 'low');
        }
      }
      return;
    }
    const budget = this.frameBudgetMs;
    if (frameIntervalMs > budget * 1.25 || workMs > budget * 0.9) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (frameIntervalMs < budget * 1.05) this.fastFrames++;
    else this.fastFrames = 0;
    const maxRatio = Math.min(window.devicePixelRatio, this.quality.maxPixelRatio);
    if (this.slowFrames > 20 && this.pixelRatio > 0.6) {
      this.pixelRatio = Math.max(0.6, this.pixelRatio * 0.88);
      this.slowFrames = 0;
      this.resize();
    } else if (this.fastFrames > 180 && this.pixelRatio < maxRatio) {
      this.pixelRatio = Math.min(maxRatio, this.pixelRatio * 1.08);
      this.fastFrames = 0;
      this.resize();
    }
  }

  private updateHud(): void {
    const st = this.conn.state;
    const t = st.train;
    const m = this.local.motor;
    hud.km = Math.max(0, this.trainClock.s / WORLD.metersPerKm);
    hud.speedKmh = Math.abs(t.speed) * 3.6;
    hud.throttle = t.throttle;
    hud.brake = t.brake;
    hud.reverser = t.reverser;
    hud.fuel = t.fuel;
    hud.fuelMax = TRAIN.fireboxMax;
    hud.coal = t.coal;
    hud.pressure = t.pressure;
    hud.driving = m.driving;
    hud.onTrain = m.frame === Frame.Train;
    hud.inCab = hud.onTrain && m.z > CONSIST[0]!.zc + 2.4 && m.z < CONSIST[0]!.z1 + 0.5;
    // The host's stamina includes handcar pumping, which prediction doesn't model.
    hud.stamina =
      m.frame >= Frame.Handcar
        ? (st.players.get(this.conn.selfId)?.stamina ?? m.stamina)
        : m.stamina;
    const me = st.players.get(this.conn.selfId);
    hud.hp = me?.hp ?? 100;
    hud.dayPhase = st.dayPhase;
    hud.day = st.day;
    hud.night = this.sky.night;
    hud.pointerLocked = this.input.pointerLocked;
    if (m.driving) hud.prompt = 'Leave the controls';
    else if (m.frame >= Frame.Handcar) {
      const hs = st.handcars[m.frame - Frame.Handcar];
      hud.prompt = 'Get off the handcar';
      hud.holdHint = hud.touch ? 'stick to pump' : 'hold W/S to pump · Space brakes';
      hud.handcarSpeed = Math.abs(hs?.speed ?? 0) * 3.6;
    } else {
      const tg = this.target;
      hud.prompt = tg
        ? tg.hold > 0 && !tg.use
          ? `Hold to ${tg.holdPrompt ?? tg.prompt}`.replace('Hold to Search', 'Hold to search')
          : tg.prompt
        : '';
      hud.holdHint = tg?.holdUse && tg.use ? `hold: ${tg.holdPrompt}` : '';
    }
    if (m.frame < Frame.Handcar) hud.handcarSpeed = -1;
    const meCarry = me?.carryKind as ItemKind | undefined;
    hud.carrying = meCarry ? (ITEMS[meCarry]?.name ?? '') : '';
    if (m.frame === Frame.World) {
      const loco = this.trainView.locoPose;
      hud.distanceToTrain = Math.hypot(loco.cx - m.x, loco.cz - m.z);
    } else hud.distanceToTrain = 0;

    // Combat.
    const inv = me?.inv;
    const w = this.weapons.held();
    hud.weapon = w?.name ?? '';
    hud.isGun = w?.kind === 'gun';
    hud.mag = this.weapons.magazine();
    hud.reserve = this.weapons.reserve();
    hud.reloading = (inv?.reload ?? 0) > 0;
    hud.slots = inv ? inv.slots.toArray() : [];
    hud.selected = inv?.selected ?? 0;
    hud.bandage = inv?.bandage ?? 0;
    hud.tonic = inv?.tonic ?? 0;
    hud.dynamite = inv?.dynamite ?? 0;
    hud.holywater = inv?.holywater ?? 0;
    hud.cash = inv?.cash ?? 0;
    hud.aim = this.weapons.aimT;
    hud.spread = w?.kind === 'gun' ? w.hipSpread * (1 + this.weapons.bloom) : 0;
    hud.hitMarker = this.weapons.hitMarker;
    hud.hitKill = this.weapons.hitKill;
    hud.hurt = this.hurtFlash;
    hud.life = me?.life ?? 0;
    hud.bleed = me?.bleed ?? 0;
    hud.revive = me?.revive ?? 0;
    hud.over = this.conn.state.players.size > 0 && this.isOver();
    hud.enemies = this.enemyView.count;
    if (hud.life === Life.Dead) {
      const next = nextFeature(this.features, this.trainClock.s, ['station', 'start', 'fort']);
      hud.respawnKm = next ? next.km : 0;
    }
    if (!m.driving && hud.life === Life.Alive) {
      const downed = this.downedTeammate();
      if (downed)
        hud.prompt = `Hold to revive ${downed} (${hud.bandage} bandage, ${hud.tonic} tonic)`;
    } else if (hud.life === Life.Downed && hud.tonic > 0) {
      hud.prompt = 'Use your tonic';
    }
  }

  private isOver(): boolean {
    let up = 0;
    this.conn.state.players.forEach((p) => {
      if (p.life === Life.Alive) up++;
    });
    const me = this.conn.state.players.get(this.conn.selfId);
    return up === 0 && !(this.conn.state.players.size === 1 && (me?.inv?.tonic ?? 0) > 0);
  }

  private downedTeammate(): string | null {
    const eye = this.eyeWorld();
    let name: string | null = null;
    this.conn.state.players.forEach((p, id) => {
      if (id === this.conn.selfId || p.life !== Life.Downed) return;
      const pos = this.remotes.worldPosition(id);
      if (pos && Math.hypot(pos.x - eye.x, pos.y - (eye.y - PLAYER.eyeHeight), pos.z - eye.z) < 2.2)
        name = p.name;
    });
    return name;
  }

  /** Nearby undead moan now and then (cosmetic, client-side). */
  private ambientGroans(dt: number): void {
    this.groanT -= dt;
    if (this.groanT > 0 || !this.audio?.running) return;
    this.groanT = 0.8 + Math.random() * 2.2;
    const eye = this.eyeWorld();
    const near: Array<{ x: number; y: number; z: number; type: string }> = [];
    this.enemyView.forEach((_id, type, x, y, z, dead) => {
      if (!dead && Math.hypot(x - eye.x, z - eye.z) < 30) near.push({ x, y, z, type });
    });
    const e = near[Math.floor(Math.random() * near.length)];
    if (e)
      this.audio.groan(
        this.renderPos(e.x, e.y + 1.6, e.z),
        e.type === 'brute' ? 0.7 : e.type === 'runner' ? 1.2 : 1,
      );
  }

  private readonly resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = this.settings.fov * (w < h ? 1.25 : 1);
    this.camera.updateProjectionMatrix();
  };

  get weaponDefs() {
    return WEAPONS as Record<WeaponId, (typeof WEAPONS)[WeaponId]>;
  }

  private readonly onPointerLock = (): void => {
    hud.pointerLocked = this.input.pointerLocked;
  };
}
