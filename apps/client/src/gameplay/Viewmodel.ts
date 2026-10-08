import * as THREE from 'three/webgpu';
import type { WeaponId } from '@dead-tracks/shared';
import { MeshBuilder } from '../render/builder.ts';
import { paletteMaterial, releaseObject } from '../render/materials.ts';
import { weaponModel } from '../render/models/weapons.ts';

/**
 * First-person arms and gun for iron sights (§4.7), drawn in their own pass with
 * their own field of view so they never clip into walls (§6.9).
 */
export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.01, 5);
  private readonly root = new THREE.Group();
  private gun: THREE.Mesh | null = null;
  private readonly arms: THREE.Mesh;
  private readonly armL: THREE.Mesh;
  private weapon = '';
  private readonly hemi = new THREE.HemisphereLight();
  private readonly sun = new THREE.DirectionalLight();
  private kick = 0;
  private swing = 0;
  private reloadT = 0;

  constructor() {
    const b = new MeshBuilder();
    // Right forearm and hand gripping at the origin.
    b.box('shirt', 0.0, -0.09, 0.2, 0.075, 0.075, 0.32, { rx: -0.25 });
    b.box('skin2', 0, -0.035, 0.03, 0.06, 0.09, 0.08);
    this.arms = new THREE.Mesh(b.build(), paletteMaterial());
    const l = new MeshBuilder();
    l.box('shirt', -0.06, -0.1, 0.12, 0.075, 0.075, 0.3, { rx: -0.35, ry: 0.4 });
    l.box('skin2', 0, -0.03, -0.02, 0.07, 0.06, 0.09);
    this.armL = new THREE.Mesh(l.build(), paletteMaterial());
    this.root.add(this.arms, this.armL);
    this.scene.add(this.root, this.hemi, this.sun, this.sun.target);
    this.sun.position.set(0.3, 1, 0.5);
  }

  setWeapon(id: string): void {
    if (id === this.weapon) return;
    this.weapon = id;
    if (this.gun) releaseObject(this.gun, false);
    this.gun = null;
    const model = weaponModel(id as WeaponId);
    if (!model) return;
    this.gun = new THREE.Mesh(model.geometry, paletteMaterial());
    this.root.add(this.gun);
    // Long guns: the support hand goes under the forend.
    this.armL.visible = model.twoHanded;
    this.armL.position.set(0, model.sight.y - 0.05, model.muzzle.z * 0.55);
  }

  fire(recoil: number): void {
    this.kick = Math.min(1, this.kick + recoil * 6);
  }

  melee(): void {
    this.swing = 1;
  }

  /** Lights follow the world's so the gun matches the scene. */
  syncLights(hemi: THREE.HemisphereLight, sun: THREE.DirectionalLight): void {
    this.hemi.color.copy(hemi.color);
    this.hemi.groundColor.copy(hemi.groundColor);
    this.hemi.intensity = hemi.intensity;
    this.sun.color.copy(sun.color);
    this.sun.intensity = sun.intensity;
  }

  update(dt: number, aspect: number, reloading: boolean, bob: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.kick = Math.max(0, this.kick - dt * 9);
    this.swing = Math.max(0, this.swing - dt * 3);
    this.reloadT = reloading
      ? Math.min(1, this.reloadT + dt * 6)
      : Math.max(0, this.reloadT - dt * 6);
    const model = weaponModel(this.weapon as WeaponId);
    const sightY = model ? model.sight.y : 0.05;
    const long = model?.twoHanded ?? false;
    // Sight line on the screen centre: the rear sight sits at eye relief.
    const relief = long ? 0.16 : 0.3;
    this.root.position.set(
      0,
      -sightY - this.reloadT * 0.08 + Math.sin(bob) * 0.003,
      -relief + this.kick * 0.05,
    );
    this.root.rotation.set(
      this.kick * 0.18 + this.reloadT * 0.6 - this.swing * 1.2,
      0,
      this.reloadT * 0.4 + this.swing * 0.6,
    );
  }
}
