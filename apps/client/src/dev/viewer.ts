import * as THREE from 'three/webgpu';
import { createRenderer } from '../render/createRenderer.ts';
import { paletteMaterial, paletteSkinnedMaterial } from '../render/materials.ts';
import { OUTFITS, createHumanoid } from '../render/models/humanoid.ts';
import { PROP_KINDS, buildProp, buildTelegraphPole } from '../render/models/props.ts';
import {
  DRIVER_RADIUS,
  GAUGE_HALF,
  LOCO_DRIVER_AXLES,
  LOCO_LEADING_AXLES,
  SMALL_WHEEL_RADIUS,
  buildFlatcar,
  buildLocomotive,
  buildTender,
  buildWheelSet,
} from '../render/models/train.ts';

/**
 * Development model viewer: `/?viewer=loco&angle=0.6`. Renders one model on a plain
 * ground so automated screenshots can review the art without playing.
 */
export async function runViewer(
  canvas: HTMLCanvasElement,
  which: string,
  angle: number,
  dist: number,
): Promise<void> {
  const renderer = await createRenderer(canvas, { forceWebGL: false, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfd0d8);
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x6a5a48, 1.6));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sun.position.set(-6, 10, -4);
  scene.add(sun);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2),
    new THREE.MeshLambertNodeMaterial({ color: 0x8a7d62 }),
  );
  ground.position.y = -0.32;
  scene.add(ground);

  const mat = paletteMaterial();
  const group = new THREE.Group();
  scene.add(group);
  const add = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  let tris = 0;
  if (which === 'loco' || which === 'train') {
    add(buildLocomotive());
    const drv = buildWheelSet(DRIVER_RADIUS, true);
    const small = buildWheelSet(SMALL_WHEEL_RADIUS, false);
    for (const z of LOCO_DRIVER_AXLES) add(drv, 0, DRIVER_RADIUS, z);
    for (const z of LOCO_LEADING_AXLES) add(small, 0, SMALL_WHEEL_RADIUS, z);
  }
  if (which === 'tender' || which === 'train')
    add(buildTender(), 0, 0, which === 'train' ? 9.65 : 0);
  if (which === 'flatcar' || which === 'train')
    add(buildFlatcar(), 0, 0, which === 'train' ? 20.05 : 0);
  if (which === 'props') {
    PROP_KINDS.forEach((k, i) => {
      add(buildProp(k, 0), (i - 3.5) * 4, -0.3, 0);
      add(buildProp(k, 1), (i - 3.5) * 4, -0.3, 5);
    });
    add(buildTelegraphPole(), 18, -0.3, 0);
  }
  if (which === 'people') {
    OUTFITS.forEach((o, i) => {
      const h = createHumanoid(o, paletteSkinnedMaterial());
      h.mesh.position.set((i - 1.5) * 1.1, -0.3, 0);
      h.animate(0.016, {
        speed: i * 1.5,
        grounded: true,
        pitch: 0,
        driving: false,
        mantling: false,
        sprinting: i === 3,
      });
      h.animate(0.2, {
        speed: i * 1.5,
        grounded: true,
        pitch: 0,
        driving: false,
        mantling: false,
        sprinting: i === 3,
      });
      group.add(h.mesh);
    });
  }
  group.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (g) tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  void GAUGE_HALF;

  const box = new THREE.Box3().setFromObject(group);
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 500);
  const r = size * dist;
  camera.position.set(
    centre.x + Math.sin(angle) * r,
    centre.y + r * 0.35,
    centre.z + Math.cos(angle) * r,
  );
  camera.lookAt(centre);
  renderer.render(scene, camera);
  (window as unknown as { __viewer: unknown }).__viewer = { ready: true, tris };
  document.title = `viewer ${which} ${Math.round(tris)} tris`;
}
