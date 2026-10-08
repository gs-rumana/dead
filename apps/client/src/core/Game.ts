import * as THREE from 'three/webgpu';
import { Btn, type InputFrame, SIM_DT, inputToWire } from '@dead-tracks/shared';
import type { Connection } from '../net/Connection.ts';
import { backendName, createRenderer } from '../render/createRenderer.ts';
import { perf, recordFrame } from './perf.ts';

export interface GameOptions {
  forceWebGL: boolean;
}

/** M0 client: renders the synced test object and players from the decoded RunState. */
export class Game {
  private renderer!: THREE.WebGPURenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2000);
  private readonly testMesh: THREE.Mesh;
  private readonly testMaterial: THREE.MeshStandardMaterial;
  private readonly playerMeshes = new Map<string, THREE.Mesh>();
  private readonly playerGeo = new THREE.CapsuleGeometry(0.32, 1.16, 4, 8);
  private readonly keys = new Set<string>();
  private yaw = Math.PI;
  private pitch = -0.25;
  private seq = 0;
  private inputAcc = 0;
  private last = performance.now();
  private running = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly conn: Connection,
    private readonly opts: GameOptions,
  ) {
    this.scene.background = new THREE.Color(0xc9b79c);
    this.scene.fog = new THREE.Fog(0xc9b79c, 60, 300);
    const hemi = new THREE.HemisphereLight(0xfff1d6, 0x5b4a3a, 1.4);
    const sun = new THREE.DirectionalLight(0xffe2b0, 2.2);
    sun.position.set(30, 50, 20);
    this.scene.add(hemi, sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x9c8a5a, roughness: 1 }),
    );
    this.scene.add(ground);

    this.testMaterial = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.6 });
    this.testMesh = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), this.testMaterial);
    this.testMesh.position.set(0, 2, -6);
    this.scene.add(this.testMesh);
  }

  async init(): Promise<void> {
    this.renderer = await createRenderer(this.canvas, {
      forceWebGL: this.opts.forceWebGL,
      antialias: true,
    });
    perf.backend = backendName(this.renderer);
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    this.canvas.addEventListener('click', () => this.canvas.requestPointerLock?.());
    document.addEventListener('mousemove', this.onMouse);
  }

  start(): void {
    this.running = true;
    this.last = performance.now();
    this.renderer.setAnimationLoop(this.frame);
  }

  dispose(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    document.removeEventListener('mousemove', this.onMouse);
    this.conn.close();
    this.renderer.dispose();
  }

  nudge(): void {
    this.conn.send('cmd', { t: 'nudge' });
  }

  private readonly frame = (): void => {
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;

    this.inputAcc += dt;
    while (this.inputAcc >= SIM_DT) {
      this.inputAcc -= SIM_DT;
      this.sendInput();
    }

    this.syncScene();
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    perf.drawCalls = this.renderer.info.render.drawCalls;
    perf.triangles = this.renderer.info.render.triangles;
    recordFrame(performance.now() - now);
  };

  private sendInput(): void {
    const k = this.keys;
    const input: InputFrame = {
      seq: ++this.seq,
      mx: (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0),
      my: (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0),
      yaw: this.yaw,
      pitch: this.pitch,
      buttons: (k.has('Space') ? Btn.Jump : 0) | (k.has('ShiftLeft') ? Btn.Sprint : 0),
      frame: 0,
    };
    this.conn.send('input', inputToWire(input));
  }

  private syncScene(): void {
    const state = this.conn.state;
    this.testMesh.rotation.y = state.test.angle;
    this.testMesh.rotation.x = state.test.angle * 0.5;
    this.testMaterial.color.setHex(state.test.color);

    const seen = new Set<string>();
    state.players.forEach((p, id) => {
      seen.add(id);
      let mesh = this.playerMeshes.get(id);
      if (!mesh) {
        const color = id === this.conn.selfId ? 0x4f7cac : 0xb9563f;
        mesh = new THREE.Mesh(this.playerGeo, new THREE.MeshStandardMaterial({ color }));
        this.playerMeshes.set(id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(p.x, p.y + 0.9, p.z);
      mesh.rotation.y = p.yaw;
      if (id === this.conn.selfId) {
        const back = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(6);
        this.camera.position.set(p.x + back.x, p.y + 3.5, p.z + back.z);
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      }
    });
    for (const [id, mesh] of this.playerMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.playerMeshes.delete(id);
      }
    }
  }

  private readonly resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio, 2);
    perf.pixelRatio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.type === 'keydown') this.keys.add(e.code);
    else this.keys.delete(e.code);
  };

  private readonly onMouse = (e: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    this.yaw -= e.movementX * 0.0025;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - e.movementY * 0.0025));
  };
}
