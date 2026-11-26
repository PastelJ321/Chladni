import * as T from 'three';
import type { CameraPose } from '../animation/director';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class CameraRig {
  elevated = false;
  plateY = 2.24;
  plateScale = 1;
  onManual: () => void = () => {};
  camera = new T.PerspectiveCamera(31, 1, 0.005, 100);
  controls: OrbitControls;
  goal: T.Vector3 | null = null;
  goalFov: number | null = null;
  target = new T.Vector3(0, 1.38, 0);

  constructor(canvas: HTMLCanvasElement) {
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.75;
    this.controls.zoomSpeed = 0.88;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.minDistance = 0.08;
    this.controls.maxDistance = 26;
    this.controls.target.copy(this.target);
    this.controls.addEventListener('start', () => {
      this.goal = null;
      this.goalFov = null;
      this.onManual();
    });
    this.preset('hero', true);
  }

  preset(kind: 'hero' | 'top' | 'macro', instant = false) {
    const lift = this.plateY - 2.24;
    const nextFov = kind === 'macro' ? 26 : kind === 'top' ? 30 : 31;
    this.target.set(
      kind === 'macro' ? 0.55 * this.plateScale : 0,
      (kind === 'macro' ? 2.252 : this.elevated ? 3.05 : kind === 'hero' ? 1.38 : 2.24) + lift,
      kind === 'macro' ? 0.55 * this.plateScale : 0,
    );
    this.goal = new T.Vector3(
      ...((kind === 'top'
        ? [0, this.elevated ? 13.6 : 10.2, 0.025]
        : kind === 'macro'
          ? [0.84, 2.6, 1.18]
          : this.elevated
            ? [6.9, 7.6, 9.2]
            : [4.5, 4.1, 6.4]) as [number, number, number]),
    );
    this.goal.y += lift;
    if (kind === 'macro') {
      this.goal.x += 0.55 * (this.plateScale - 1);
      this.goal.z += 0.55 * (this.plateScale - 1);
    }
    const fit = kind === 'macro' ? 1 : Math.max(1, this.plateScale, 1.15 / this.camera.aspect);
    this.goal.sub(this.target).multiplyScalar(fit).add(this.target);
    this.goalFov = nextFov;
    if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
      this.camera.position.copy(this.goal);
      this.controls.target.copy(this.target);
      this.goal = null;
      this.goalFov = null;
    }
    this.controls.update();
  }

  pose() {
    return {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      fov: this.camera.fov,
    };
  }

  bookmark(p: CameraPose) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.restore(p);
      return;
    }
    this.goalFov = p.fov ?? 31;
    this.target.fromArray(p.target);
    this.goal = new T.Vector3().fromArray(p.position);
  }

  restore(p: { position: number[]; target: number[]; fov?: number }) {
    this.goal = null;
    this.goalFov = null;
    this.camera.fov = p.fov ?? 31;
    this.camera.updateProjectionMatrix();
    this.camera.position.fromArray(p.position);
    this.controls.target.fromArray(p.target);
    this.controls.update();
  }

  applyPose(p: CameraPose) {
    this.goal = null;
    this.goalFov = null;
    this.camera.position.fromArray(p.position);
    this.controls.target.fromArray(p.target);
    this.camera.up.fromArray(p.up ?? [0, 1, 0]);
    this.camera.fov = p.fov ?? 31;
    this.camera.focus = p.focus ?? 10;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  tick(dt: number) {
    let animating = false;
    if (this.goal) {
      const b = 1 - Math.exp(-5.2 * dt);
      this.camera.position.lerp(this.goal, b);
      this.controls.target.lerp(this.target, b);
      if (this.goalFov != null) {
        this.camera.fov += (this.goalFov - this.camera.fov) * b;
        this.camera.updateProjectionMatrix();
      }
      animating = true;
      if (
        this.camera.position.distanceTo(this.goal) < 0.002 &&
        this.controls.target.distanceTo(this.target) < 0.002 &&
        (this.goalFov == null || Math.abs(this.camera.fov - this.goalFov) < 0.02)
      ) {
        this.camera.position.copy(this.goal);
        this.controls.target.copy(this.target);
        if (this.goalFov != null) {
          this.camera.fov = this.goalFov;
          this.camera.updateProjectionMatrix();
        }
        this.goal = null;
        this.goalFov = null;
      }
    }
    return this.controls.update() || animating;
  }

  dispose() {
    this.controls.dispose();
  }
}
