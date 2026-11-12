import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createInstrument, PLATE_Y } from '../scene/instrument';
import { createMaterials } from '../scene/materials';
import { CameraRig } from './CameraRig';
import type { Config, Field, ModalResult, Run, ViewSettings } from '../experiment/types';
import { initialParticles, frameAt } from '../simulation/particles';
import { densityGrid } from '../analysis/metrics';
import { valueAt, isolines } from './layers';
import { sampleGrid } from '../solver/response';
export interface RenderData {
  config: Config;
  field: Field | null;
  modal: ModalResult | null;
  run: Run | null;
  time: number;
  view: ViewSettings;
  animate: boolean;
  compare?: Omit<RenderData, 'compare'> | null;
  paint: boolean;
}
export class LabRenderer {
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  rig: CameraRig;
  materials = createMaterials();
  instrument = createInstrument(this.materials);
  overlay = new T.Group();
  particles: T.InstancedMesh;
  env: T.WebGLRenderTarget;
  observer: ResizeObserver;
  data: RenderData;
  dirty = true;
  raf = 0;
  last = performance.now();
  disposed = false;
  initial = initialParticles;
  tmp = new T.Object3D();
  ray = new T.Raycaster();
  down = [0, 0];
  lastCamera = 'hero';
  lastStructure = 'assembled';
  lastConfig = '';
  seeds: ReturnType<typeof initialParticles>;
  grainMat: T.MeshStandardMaterial;
  assemblyLevel = 0;
  constructor(
    private host: HTMLDivElement,
    data: RenderData,
    private select: (id: string | null) => void,
    private paintPoint: (p: [number, number]) => void,
  ) {
    this.data = data;
    this.seeds = initialParticles(data.config);
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor('#30343a');
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    host.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '실험 장비 3D 장면');
    this.renderer.domElement.setAttribute('role', 'img');
    this.rig = new CameraRig(this.renderer.domElement);
    this.scene.background = new T.Color('#30343a');
    this.scene.fog = new T.Fog('#30343a', 18, 45);
    const pm = new T.PMREMGenerator(this.renderer),
      room = new RoomEnvironment();
    this.env = pm.fromScene(room, 0.06);
    this.scene.environment = this.env.texture;
    this.scene.environmentIntensity = 0.55;
    room.dispose();
    pm.dispose();
    this.scene.add(new T.HemisphereLight('#e5ebf1', '#34302c', 1.5));
    const key = new T.DirectionalLight('#fff4e5', 3.1);
    key.position.set(-3, 8, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7 });
    key.shadow.normalBias = 0.015;
    key.shadow.intensity = 0.45;
    this.scene.add(key);
    const fill = new T.DirectionalLight('#d4e1ed', 1.6);
    fill.position.set(5, 4, -4);
    this.scene.add(fill);
    const bench = new T.Mesh(
      new T.BoxGeometry(12, 0.22, 8),
      new T.MeshStandardMaterial({ color: '#393d42', roughness: 0.8, metalness: 0.12 }),
    );
    bench.position.set(0, -0.14, 0);
    bench.receiveShadow = true;
    this.scene.add(bench);
    for (const x of [-4.5, 4.5])
      for (const z of [-2.8, 2.8]) {
        const leg = new T.Mesh(new T.BoxGeometry(0.16, 2, 0.16), this.materials.darkMetal);
        leg.position.set(x, -1.2, z);
        this.scene.add(leg);
      }
    const floor = new T.Mesh(
      new T.PlaneGeometry(100, 100),
      new T.MeshStandardMaterial({ color: '#24282d', roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.scene.add(this.instrument.root, this.overlay);
    this.grainMat = new T.MeshStandardMaterial({ color: '#d6c59f', roughness: 0.92 });
    this.particles = new T.InstancedMesh(new T.TetrahedronGeometry(1), this.grainMat, 5000);
    this.particles.frustumCulled = false;
    this.particles.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.scene.add(this.particles);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    host.addEventListener('pointerdown', this.pointerDown);
    host.addEventListener('pointerup', this.pointerUp);
    this.loop();
  }
  update(data: RenderData) {
    if (data.view.camera !== this.lastCamera || data.view.structure !== this.lastStructure) {
      this.rig.elevated = ['exploded', 'assembly'].includes(data.view.structure);
      this.rig.preset(data.view.camera);
      this.lastCamera = data.view.camera;
      this.lastStructure = data.view.structure;
    }
    this.data = data;
    this.dirty = true;
  }
  resize() {
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight, false);
    this.rig.camera.aspect = this.host.clientWidth / Math.max(1, this.host.clientHeight);
    this.rig.camera.updateProjectionMatrix();
    this.rig.preset(this.data.view.camera, true);
    this.dirty = true;
  }
  pointerDown = (e: PointerEvent) => {
    this.down = [e.clientX, e.clientY];
  };
  pointerUp = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) > 5) return;
    const rect = this.host.getBoundingClientRect();
    this.ray.setFromCamera(
      new T.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.rig.camera,
    );
    if (this.data.paint) {
      const point = this.ray.ray.intersectPlane(
        new T.Plane(new T.Vector3(0, 1, 0), -PLATE_Y),
        new T.Vector3(),
      );
      if (point) {
        const x = point.x / (this.data.config.plate.width * 12) + 0.5,
          y = point.z / (this.data.config.plate.height * 12) + 0.5;
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) this.paintPoint([x, y]);
      }
      return;
    }
    const hits = this.ray.intersectObjects(this.instrument.root.children, true);
    this.select(hits[0]?.object.userData.part ?? null);
  };
  clearOverlay() {
    for (const o of [...this.overlay.children]) {
      this.overlay.remove(o);
      if (o instanceof T.Line || o instanceof T.Mesh) {
        o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => m.dispose());
      }
    }
  }
  lines(vertices: number[], color: string, opacity = 0.7) {
    const g = new T.BufferGeometry().setAttribute(
        'position',
        new T.Float32BufferAttribute(vertices, 3),
      ),
      m = new T.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
    const line = new T.LineSegments(g, m);
    line.renderOrder = 4;
    this.overlay.add(line);
  }
  prepare(d: Omit<RenderData, 'compare'>, phase: number) {
    const { config: c, view: v, field: f } = d,
      p = c.plate,
      ins = this.instrument,
      scaleX = p.width / 0.3,
      scaleZ = p.height / 0.3;
    const key = JSON.stringify(c.grains);
    if (key !== this.lastConfig) {
      this.seeds = initialParticles(c);
      this.lastConfig = key;
    }
    const explode =
      v.structure === 'exploded' ? v.explosion : v.structure === 'assembly' ? 1 - v.assembly : 0;
    const offsets = {
      support: 0,
      speaker: 0.5,
      coupler: 1.5,
      plate: 2.6,
      bolt: 3.2,
      particles: 3.8,
    };
    const plane = new T.Plane(
      v.sectionAxis === 'x'
        ? new T.Vector3(-1, 0, 0)
        : v.sectionAxis === 'y'
          ? new T.Vector3(0, -1, 0)
          : new T.Vector3(0, 0, -1),
      v.sectionPosition + (v.sectionAxis === 'y' ? PLATE_Y : 0),
    );
    for (const [id, part] of Object.entries(ins.parts)) {
      const factor =
        v.structure === 'assembly'
          ? Math.max(
              0,
              Math.min(1, 1 - v.assembly * 1.8 + (offsets[id as keyof typeof offsets] / 3.8) * 0.8),
            )
          : explode;
      part.position.set(0, offsets[id as keyof typeof offsets] * factor, 0);
      part.visible =
        id === 'plate' || id === 'support' || id === 'speaker' || p.boundary === 'center';
      if (id === 'bolt' || id === 'coupler') {
        if (c.drive.kind === 'base')
          part.position.y += c.drive.displacement * Math.cos(phase) * v.gain * 12;
        part.position.x = (Math.round(p.supportX * p.mesh) / p.mesh - 0.5) * p.width * 12;
        part.position.z = (Math.round(p.supportY * p.mesh) / p.mesh - 0.5) * p.height * 12;
      }
      part.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        const m = o.material as T.MeshStandardMaterial;
        if (!ins.originals.has(m)) return;
        const clip = v.structure === 'section' || (v.structure === 'cutaway' && id === 'speaker');
        const planes = clip ? [plane] : [];
        if (m.clippingPlanes?.length !== planes.length) m.needsUpdate = true;
        m.clippingPlanes = planes;
        const ghost = v.structure === 'ghost' && (id === 'speaker' || id === 'plate');
        m.transparent = ghost;
        m.opacity = ghost ? 0.18 : 1;
        m.depthWrite = !ghost;
        m.emissive.set(v.selected === id ? '#57798b' : '#000000');
        m.emissiveIntensity = 0.2;
      });
    }
    const positions = ins.plate.geometry.attributes.position as T.BufferAttribute,
      colors: number[] = [],
      density = densityGrid(d.run ? frameAt(d.run, d.time).positions : this.seeds.positions);
    const maxD = Math.max(1, ...density),
      color = new T.Color(),
      lo = new T.Color('#31566a'),
      hi = new T.Color('#d7b170');
    const colored =
      v.layer !== 'material' &&
      v.layer !== 'mesh' &&
      v.layer !== 'trace' &&
      v.layer !== 'vector' &&
      v.layer !== 'contour';
    let max = 0;
    if (f) {
      const factor =
        v.layer === 'velocity'
          ? 2 * Math.PI * f.frequency
          : v.layer === 'acceleration'
            ? (2 * Math.PI * f.frequency) ** 2
            : 1;
      max = f.peak * factor;
    }
    for (let i = 0; i < positions.count; i++) {
      const x = ins.restPositions[i * 3] / 3.6 + 0.5,
        y = ins.restPositions[i * 3 + 2] / 3.6 + 0.5;
      const displacement = f ? valueAt(f, x, y, 'displacement', phase) : 0;
      positions.setXYZ(
        i,
        ins.restPositions[i * 3] * scaleX,
        (ins.restPositions[i * 3 + 1] * p.thickness) / 0.002 +
          Math.max(-0.3, Math.min(0.3, displacement * v.gain * 12)),
        ins.restPositions[i * 3 + 2] * scaleZ,
      );
      const value =
        v.layer === 'density'
          ? density[Math.min(15, Math.floor(y * 16)) * 16 + Math.min(15, Math.floor(x * 16))] / maxD
          : f
            ? valueAt(f, x, y, v.layer, phase) / Math.max(1e-20, max)
            : 0;
      color
        .copy(lo)
        .lerp(hi, v.layer === 'displacement' ? (value + 1) / 2 : Math.max(0, Math.min(1, value)));
      colors.push(color.r, color.g, color.b);
    }
    positions.needsUpdate = true;
    ins.plate.geometry.computeVertexNormals();
    ins.plate.geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    const plateMat = ins.plate.material as T.MeshStandardMaterial;
    if (plateMat.vertexColors !== colored) {
      plateMat.vertexColors = colored;
      plateMat.needsUpdate = true;
    }
    plateMat.color.set(colored ? '#ffffff' : '#a4acb1');
    plateMat.metalness = colored ? 0.15 : 0.9;
    const frame = d.run ? frameAt(d.run, d.time) : null,
      pts = frame?.positions ?? this.seeds.positions,
      diam = d.run?.diameters ?? this.seeds.diameters,
      species = d.run?.species ?? this.seeds.species;
    this.particles.count = Math.min(5000, pts.length / 2);
    this.particles.visible = v.particles;
    for (let i = 0; i < this.particles.count; i++) {
      const x = pts[i * 2],
        y = pts[i * 2 + 1],
        disp = f ? valueAt(f, x, y, 'displacement', phase) : 0;
      this.tmp.position.set(
        (x - 0.5) * p.width * 12,
        PLATE_Y +
          0.016 +
          offsets.particles * explode +
          Math.max(-0.3, Math.min(0.3, disp * v.gain * 12)),
        (y - 0.5) * p.height * 12,
      );
      this.tmp.rotation.set(i * 1.7, i * 0.63, i * 0.41);
      const s = diam[i] * 12;
      this.tmp.scale.set(s, s * 0.65, s * 0.85);
      this.tmp.updateMatrix();
      this.particles.setMatrixAt(i, this.tmp.matrix);
      this.particles.setColorAt(i, color.set(species[i] ? '#f1eee3' : '#ceb88d'));
    }
    this.particles.instanceMatrix.needsUpdate = true;
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
    const particlePlanes = v.structure === 'section' ? [plane] : [];
    if (this.grainMat.clippingPlanes?.length !== particlePlanes.length)
      this.grainMat.needsUpdate = true;
    this.grainMat.clippingPlanes = particlePlanes;
    this.clearOverlay();
    const y = PLATE_Y + 0.028 + offsets.plate * explode;
    if (v.layer === 'mesh') {
      const vertices: number[] = [];
      for (let i = 0; i <= p.mesh; i++) {
        const a = i / p.mesh;
        for (let j = 0; j < p.mesh; j++) {
          const b = j / p.mesh,
            k = (j + 1) / p.mesh;
          for (const [x1, z1, x2, z2] of [
            [a, b, a, k],
            [b, a, k, a],
          ]) {
            const lift = (x: number, z: number) =>
              f
                ? Math.max(
                    -0.3,
                    Math.min(0.3, valueAt(f, x, z, 'displacement', phase) * v.gain * 12),
                  )
                : 0;
            vertices.push(
              (x1 - 0.5) * p.width * 12,
              y + lift(x1, z1),
              (z1 - 0.5) * p.height * 12,
              (x2 - 0.5) * p.width * 12,
              y + lift(x2, z2),
              (z2 - 0.5) * p.height * 12,
            );
          }
        }
      }
      this.lines(vertices, '#91b5cb');
    }
    if (f && v.layer === 'contour') {
      for (const level of [0, 0.3 * f.peak, 0.65 * f.peak]) {
        const data = level === 0 ? f.real : f.amplitude,
          segments = isolines(data, f.size, level),
          vertices: number[] = [];
        for (let i = 0; i < segments.length; i += 2)
          vertices.push(
            (segments[i] - 0.5) * p.width * 12,
            y,
            (segments[i + 1] - 0.5) * p.height * 12,
          );
        this.lines(vertices, level === 0 ? '#ebd7a7' : '#8fb3c9');
      }
    }
    if (f && v.layer === 'vector') {
      const vertices: number[] = [];
      for (let x = 0.08; x < 0.95; x += 0.09)
        for (let z = 0.08; z < 0.95; z += 0.09) {
          const h = 0.01,
            gradX =
              (sampleGrid(f.amplitude, f.size, x + h, z) ** 2 -
                sampleGrid(f.amplitude, f.size, x - h, z) ** 2) /
              p.width,
            gradY =
              (sampleGrid(f.amplitude, f.size, x, z + h) ** 2 -
                sampleGrid(f.amplitude, f.size, x, z - h) ** 2) /
              p.height;
          const angle = Math.atan2(-gradY, -gradX),
            length = 0.07 * Math.min(1, Math.hypot(gradX, gradY) / Math.max(1e-25, f.peak ** 2)),
            sx = (x - 0.5) * p.width * 12,
            sz = (z - 0.5) * p.height * 12,
            ex = sx + Math.cos(angle) * length,
            ez = sz + Math.sin(angle) * length;
          vertices.push(
            sx,
            y,
            sz,
            ex,
            y,
            ez,
            ex,
            y,
            ez,
            ex - Math.cos(angle - 0.5) * 0.025,
            y,
            ez - Math.sin(angle - 0.5) * 0.025,
            ex,
            y,
            ez,
            ex - Math.cos(angle + 0.5) * 0.025,
            y,
            ez - Math.sin(angle + 0.5) * 0.025,
          );
        }
      this.lines(vertices, '#afc5cd');
    }
    if (d.run && v.layer === 'trace') {
      const vertices: number[] = [];
      for (let i = 0; i < Math.min(50, d.run.species.length); i++) {
        const id = i * Math.max(1, Math.floor(d.run.species.length / 50));
        for (let j = 1; j < d.run.frames.length && d.run.frames[j].time <= d.time; j++) {
          const a = d.run.frames[j - 1].positions,
            b = d.run.frames[j].positions;
          vertices.push(
            (a[id * 2] - 0.5) * p.width * 12,
            y,
            (a[id * 2 + 1] - 0.5) * p.height * 12,
            (b[id * 2] - 0.5) * p.width * 12,
            y,
            (b[id * 2 + 1] - 0.5) * p.height * 12,
          );
        }
      }
      this.lines(vertices, '#d7c69d', 0.6);
    }
  }
  loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now(),
      dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (document.hidden) return;
    const moved = this.rig.tick(dt);
    if (!this.dirty && !moved && !this.rig.goal && !this.data.animate) return;
    const ratio = this.data.view.quality === 'low' ? 1 : Math.min(devicePixelRatio, 1.5);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    const phase = this.data.view.phase + (this.data.animate ? (now / 1000) * Math.PI : 0);
    const width = this.host.clientWidth,
      height = this.host.clientHeight;
    if (this.data.compare) {
      const old = this.rig.camera.aspect,
        position = this.rig.camera.position.clone();
      this.rig.camera.position
        .sub(this.rig.controls.target)
        .multiplyScalar(1.5)
        .add(this.rig.controls.target);
      this.rig.camera.updateMatrixWorld();
      this.renderer.setScissorTest(true);
      for (let i = 0; i < 2; i++) {
        this.rig.camera.aspect = width / 2 / height;
        this.rig.camera.updateProjectionMatrix();
        this.renderer.setViewport((i * width) / 2, 0, width / 2, height);
        this.renderer.setScissor((i * width) / 2, 0, width / 2, height);
        this.prepare(i === 0 ? this.data : this.data.compare, phase);
        this.renderer.render(this.scene, this.rig.camera);
      }
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, width, height);
      this.rig.camera.aspect = old;
      this.rig.camera.position.copy(position);
      this.rig.camera.updateProjectionMatrix();
    } else {
      this.prepare(this.data, phase);
      this.renderer.render(this.scene, this.rig.camera);
    }
    this.dirty = false;
  };
  async capture() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight,
      ratio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(Math.min(2, 3840 / w));
    this.renderer.setSize(w, h, false);
    this.renderer.render(this.scene, this.rig.camera);
    const blob = await new Promise<Blob | null>((r) =>
      this.renderer.domElement.toBlob(r, 'image/png'),
    );
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.dirty = true;
    return blob;
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.rig.dispose();
    this.host.removeEventListener('pointerdown', this.pointerDown);
    this.host.removeEventListener('pointerup', this.pointerUp);
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh || o instanceof T.Line) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    this.materials.brush.dispose();
    this.materials.roughness.dispose();
    this.env.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
