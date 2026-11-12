import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
export class CameraRig {
  elevated = false;
  camera = new T.PerspectiveCamera(34, 1, 0.05, 100);
  controls: OrbitControls;
  goal: T.Vector3 | null = null;
  target = new T.Vector3(0, 1.2, 0);
  constructor(canvas: HTMLCanvasElement) {
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 30;
    this.controls.target.copy(this.target);
    this.controls.addEventListener('start', () => (this.goal = null));
    this.preset('hero', true);
  }
  preset(kind: 'hero' | 'top' | 'macro', instant = false) {
    this.target.set(0, this.elevated ? 3.1 : kind === 'hero' ? 1.35 : 2.24, 0);
    this.goal = new T.Vector3(
      ...((kind === 'top'
        ? [0, this.elevated ? 14 : 10.5, 0.03]
        : kind === 'macro'
          ? [2.5, 3.3, 2.5]
          : this.elevated
            ? [7.3, 8, 9.5]
            : [5.6, 5.2, 7.3]) as [number, number, number]),
    );
    const fit = kind === 'macro' ? 1 : Math.max(1, 0.9 / this.camera.aspect);
    this.goal.sub(this.target).multiplyScalar(fit).add(this.target);
    if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.camera.position.copy(this.goal);
      this.controls.target.copy(this.target);
      this.goal = null;
    }
    this.controls.update();
  }
  pose() {
    return { position: this.camera.position.toArray(), target: this.controls.target.toArray() };
  }
  restore(p: { position: number[]; target: number[] }) {
    this.goal = null;
    this.camera.position.fromArray(p.position);
    this.controls.target.fromArray(p.target);
    this.controls.update();
  }
  tick(dt: number) {
    if (this.goal) {
      const b = 1 - Math.exp(-4 * dt);
      this.camera.position.lerp(this.goal, b);
      this.controls.target.lerp(this.target, b);
      if (this.camera.position.distanceTo(this.goal) < 0.002) this.goal = null;
    }
    return this.controls.update();
  }
  dispose() {
    this.controls.dispose();
  }
}
