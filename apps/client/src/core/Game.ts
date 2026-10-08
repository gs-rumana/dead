import * as THREE from 'three/webgpu';
import {
  CONSIST,
  Frame,
  type MotorContext,
  PhysicsSpace,
  Route,
  TRAIN,
  Terrain,
  WORLD,
  findInteractable,
  initPhysics,
  trainToWorld,
  trainYawAt,
  worldToTrain,
  inputToWire,
  SIM_DT,
} from '@dead-tracks/shared';
import type { Connection } from '../net/Connection.ts';
import { backendName, createRenderer } from '../render/createRenderer.ts';
import { paletteSkinnedMaterial } from '../render/materials.ts';
import { type Humanoid, OUTFITS, createHumanoid } from '../render/models/humanoid.ts';
import { Sky } from '../render/Sky.ts';
import { CameraRig } from '../gameplay/CameraRig.ts';
import { LocalPlayer } from '../gameplay/LocalPlayer.ts';
import { RemotePlayers } from '../gameplay/RemotePlayers.ts';
import { TrainClock } from '../gameplay/TrainClock.ts';
import { TrainView } from '../gameplay/TrainView.ts';
import { TerrainStreamer } from '../world/TerrainStreamer.ts';
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
  private route!: Route;
  private terrain!: Terrain;
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
    this.route = new Route(seed);
    this.terrain = new Terrain(this.route);
    this.space = new PhysicsSpace(R, this.terrain);

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
        for (const ev of events) {
          if (ev.e === 'toast') toast(ev.text);
          else if (ev.e === 'whistle') this.audio?.whistle();
          else if (ev.e === 'stoke') this.audio?.stoke();
        }
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

  /** Re-applies saved settings after the menu changes them. */
  applySettings(): void {
    const s = this.settings;
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
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
    this.lookYaw -= look.dx;
    this.lookPitch = Math.max(-1.45, Math.min(1.45, this.lookPitch - look.dy));

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
    if (m.frame === Frame.Train) {
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
    this.selfBody.animate(dt, {
      speed: this.selfSpeed,
      grounded: m.grounded,
      pitch: this.lookPitch,
      driving: m.driving,
      mantling: m.mantle > 0,
      sprinting: m.sprinting,
    });

    const firstPerson = m.driving;
    this.selfBody.mesh.visible = !firstPerson;
    this.rig.update(
      dt,
      firstPerson ? 'first' : 'third',
      m.frame,
      lx,
      ly,
      lz,
      this.lookYaw,
      this.lookPitch,
      this.trainView.poses,
      this.space,
      this.originX,
      this.originZ,
    );

    this.remotes.update(dt, now, this.trainView.poses, this.originX, this.originZ);

    // World streaming around the camera, floating origin (§6.7).
    const cam = this.rig.worldPos;
    this.rebase(false);
    this.terrainStreamer.update(cam.x, cam.z, this.originX, this.originZ);
    const near = this.route.nearest(cam.x, cam.z, 400);
    this.trackStreamer.update(near ? near.s : trainS, this.originX, this.originZ);
    if (m.frame === Frame.World) this.space.streamTiles([{ x: m.x, z: m.z }]);

    this.updateAudio(m.frame === Frame.Train, trainS);

    // Sky, lights, shadows.
    this.sky.update(this.conn.state.dayPhase, this.camera);
    this.updateShadowCamera();

    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
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
    hud.stamina = m.stamina;
    const me = st.players.get(this.conn.selfId);
    hud.hp = me?.hp ?? 100;
    hud.dayPhase = st.dayPhase;
    hud.day = st.day;
    hud.night = this.sky.night;
    hud.pointerLocked = this.input.pointerLocked;
    if (m.driving) hud.prompt = 'Leave the controls';
    else {
      const it = findInteractable(m.frame, m.x, m.y, m.z, this.lookYaw, this.lookPitch);
      hud.prompt = it ? (it.id === 'firebox' ? `${it.prompt} (${t.coal} left)` : it.prompt) : '';
    }
    if (m.frame === Frame.World) {
      const loco = this.trainView.locoPose;
      hud.distanceToTrain = Math.hypot(loco.cx - m.x, loco.cz - m.z);
    } else hud.distanceToTrain = 0;
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

  private readonly onPointerLock = (): void => {
    hud.pointerLocked = this.input.pointerLocked;
  };
}
