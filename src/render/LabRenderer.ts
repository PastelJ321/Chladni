import { QualityGovernor } from './quality';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { PlateField } from './PlateField';
import { ParticleRenderer } from './ParticleRenderer';
import * as T from 'three';
import { AnimationDirector, explodedParts } from '../animation/director';
import type { DirectorFrame } from '../animation/director';
import { fieldAtRun } from '../simulation/particles';
import { createInstrument, PLATE_Y } from '../scene/instrument';
import { createMaterials } from '../scene/materials';
import { CameraRig } from './CameraRig';
import type { Config, Field, ModalResult, Run, ViewSettings } from '../experiment/types';
import { initialParticles, framePair } from '../simulation/particles';
import { isolines } from './layers';
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
  mediaPane?: boolean;
  director?: AnimationDirector;
  currentTime?: () => number;
  focusRegion?: [number, number, number, number];
}
export class LabRenderer {
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  rig: CameraRig;
  materials = createMaterials();
  instrument = createInstrument(this.materials);
  overlay = new T.Group();
  fieldGPU = new PlateField();
  cloud = new ParticleRenderer(this.fieldGPU);
  overlayKey = '';
  overlayField: Field | null = null;
  compareCloud = new ParticleRenderer(this.fieldGPU);
  activeQuality = 'standard';
  quality = new QualityGovernor();
  adaptiveQuality = true;
  env: T.WebGLRenderTarget;
  observer: ResizeObserver;
  data: RenderData;
  dirty = true;
  raf = 0;
  last = performance.now();
  disposed = false;
  environmentReady = false;
  ray = new T.Raycaster();
  down = [0, 0];
  lastCamera = 'hero';
  lastStructure = 'assembled';
  lastConfig = '';
  seeds: ReturnType<typeof initialParticles>;

  film: DirectorFrame | null = null;
  filmRevision = -1;

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
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor('#252a30');
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.VSMShadowMap;
    this.renderer.localClippingEnabled = true;
    host.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '실험 장비 3D 장면');
    this.renderer.domElement.setAttribute('role', 'img');
    this.rig = new CameraRig(this.renderer.domElement);
    this.rig.onManual = () => {
      this.data.director?.interrupt();
      this.dirty = true;
    };
    this.scene.background = new T.Color('#252a30');
    this.scene.fog = new T.Fog('#252a30', 16, 40);
    const pm = new T.PMREMGenerator(this.renderer),
      room = new T.Scene();
    room.background = new T.Color('#2c3034');
    const cards: T.Mesh[] = [];
    for (const [w, h, x, y, z, intensity] of [
      [9, 3, -5, 8, 0, 2.6],
      [2, 8, 6, 3, -5, 2],
      [6, 2, 0, 4, 8, 1.2],
    ]) {
      const card = new T.Mesh(
        new T.PlaneGeometry(w, h),
        new T.MeshBasicMaterial({
          color: new T.Color(intensity, intensity, intensity),
          side: T.DoubleSide,
        }),
      );
      card.position.set(x, y, z);
      card.lookAt(0, 1, 0);
      room.add(card);
      cards.push(card);
    }
    this.env = pm.fromScene(room, 0.04);
    this.scene.environment = this.env.texture;
    this.scene.environmentIntensity = 0.7;
    cards.forEach((c) => {
      c.geometry.dispose();
      (c.material as T.Material).dispose();
    });
    pm.dispose();
    new HDRLoader().load(
      `${import.meta.env.BASE_URL}environment/studio_small_08_1k.hdr`,
      (hdr) => {
        if (this.disposed) {
          hdr.dispose();
          return;
        }
        const generator = new T.PMREMGenerator(this.renderer),
          next = generator.fromEquirectangular(hdr);
        hdr.dispose();
        generator.dispose();
        this.env.dispose();
        this.env = next;
        this.scene.environment = next.texture;
        this.scene.environmentIntensity = 0.72;
        this.scene.environmentRotation.y = 0.65;
        this.environmentReady = true;
        this.dirty = true;
      },
      undefined,
      () => {
        this.environmentReady = false;
      },
    );
    void import('three/addons/lights/RectAreaLightUniformsLib.js').then(
      ({ RectAreaLightUniformsLib }) => {
        if (this.disposed) return;
        RectAreaLightUniformsLib.init();
        const softbox = new T.RectAreaLight('#e5edf2', 5.5, 4, 6);
        softbox.position.set(-3, 5, 3);
        softbox.lookAt(0, 1.5, 0);
        this.scene.add(softbox);
        this.dirty = true;
      },
    );

    this.scene.add(new T.HemisphereLight('#e5ebf1', '#34302c', 0.55));
    const key = new T.DirectionalLight('#fff4e5', 2.1);
    key.position.set(-3, 8, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7 });
    key.shadow.normalBias = 0.015;
    key.shadow.intensity = 0.38;
    key.shadow.radius = 4;
    key.shadow.blurSamples = 6;
    this.scene.add(key);
    const fill = new T.DirectionalLight('#d4e1ed', 1.8);
    fill.position.set(5, 4, -4);
    this.scene.add(fill);
    const bench = new T.Mesh(
      new T.BoxGeometry(12, 0.22, 8),
      new T.MeshStandardMaterial({ color: '#1c2126', roughness: 0.8, metalness: 0.12 }),
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
    this.scene.add(this.cloud.root, this.compareCloud.root);
    this.fieldGPU.attach(this.instrument.plate.material as T.Material);
    const depth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
    this.fieldGPU.attach(depth, true);
    this.instrument.plate.customDepthMaterial = depth;
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
    this.fieldGPU.attachOverlay(m);
    line.renderOrder = 4;
    this.overlay.add(line);
  }
  prepare(
    d: Omit<RenderData, 'compare'>,
    phase: number,
    slot = 0,
    particleRatio = this.renderer.getPixelRatio(),
  ) {
    const cloud = slot === 0 ? this.cloud : this.compareCloud;
    this.cloud.root.visible = slot === 0 && d.view.particles;
    this.compareCloud.root.visible = slot === 1 && d.view.particles;
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
    const progress =
      v.structure === 'exploded' ? v.explosion : v.structure === 'assembly' ? 1 - v.assembly : 0;
    const poses = this.film?.parts ?? explodedParts(progress);
    const plane = new T.Plane(
      v.sectionAxis === 'x'
        ? new T.Vector3(-1, 0, 0)
        : v.sectionAxis === 'y'
          ? new T.Vector3(0, -1, 0)
          : new T.Vector3(0, 0, -1),
      v.sectionPosition + (v.sectionAxis === 'y' ? PLATE_Y : 0),
    );
    for (const [id, part] of Object.entries(ins.parts)) {
      const pose = poses[id];
      part.position.fromArray(pose?.offset ?? [0, 0, 0]);
      part.rotation.fromArray([...(pose?.rotation ?? [0, 0, 0]), 'XYZ']);
      part.visible =
        [
          'plate',
          'support',
          'speaker',
          'frame',
          'magnet',
          'coil',
          'cone',
          'surround',
          'particles',
        ].includes(id) || p.boundary === 'center';
      if (['bolt', 'washerTop', 'washerBottom', 'coupler'].includes(id)) {
        if (c.drive.kind === 'base')
          part.position.y += c.drive.displacement * Math.cos(phase) * v.gain * 12;
        part.position.x += (Math.round(p.supportX * p.mesh) / p.mesh - 0.5) * p.width * 12;
        part.position.z += (Math.round(p.supportY * p.mesh) / p.mesh - 0.5) * p.height * 12;
      }
      part.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        const m = o.material as T.MeshStandardMaterial;
        if (!ins.originals.has(m)) return;
        const clip =
          v.structure === 'section' ||
          (v.structure === 'cutaway' &&
            ['speaker', 'frame', 'magnet', 'coil', 'cone', 'surround'].includes(id));
        const planes = clip ? [plane] : [];
        if (m.clippingPlanes?.length !== planes.length) m.needsUpdate = true;
        m.clippingPlanes = planes;
        const ghost =
          v.structure === 'ghost' && ['speaker', 'frame', 'cone', 'surround', 'plate'].includes(id);
        if (m.transparent !== ghost) {
          m.transparent = ghost;
          m.needsUpdate = true;
        }
        m.opacity = ghost ? 0.18 : 1;
        m.depthWrite = !ghost;
        m.emissive.set(v.selected === id ? '#57798b' : '#000000');
        m.emissiveIntensity = 0.2;
      });
    }
    // Plate topology/normals stay immutable during playback; deformation and data colors are GPU sampled.
    ins.plate.scale.set(scaleX, 1, scaleZ);
    this.fieldGPU.uniforms.uThickness.value = p.thickness / 0.002;
    this.fieldGPU.uniforms.uPlateSize.value.set(p.width * 12, p.height * 12);
    this.fieldGPU.update(f, phase, v.gain, v.layer);
    const mat = ins.plate.material as T.MeshPhysicalMaterial;
    const colored = ['amplitude', 'displacement', 'velocity', 'acceleration', 'density'].includes(
      v.layer,
    );
    mat.metalness = colored ? 0.08 : 0.96;
    mat.roughness = colored ? 0.65 : 0.42;
    mat.color.set(colored ? '#ffffff' : '#a6aeb2');
    if (v.layer === 'density') {
      const frame = d.run ? framePair(d.run, d.time).a : null;
      this.fieldGPU.updateDensity(frame?.positions ?? this.seeds.positions, frame ?? this.seeds);
    }
    cloud.root.visible = v.particles && !v.showMode;
    cloud.setClipping(v.structure === 'section' ? plane : null);
    cloud.root.position.set(0, PLATE_Y + p.thickness * 6 + (poses.particles?.offset[1] ?? 0), 0);
    cloud.update(
      c,
      d.run,
      d.time,
      v.particleVisual,
      this.rig.camera,
      this.host.clientHeight,
      particleRatio,
      this.activeQuality === 'low',
    );
    const overlayKey = JSON.stringify([
      v.layer,
      p.width,
      p.height,
      p.mesh,
      v.gain,
      d.run?.key,
      Math.floor(d.time * (d.run?.recordHz ?? 20)),
      d.focusRegion,
      this.film?.region,
      poses.plate?.offset[1],
    ]);
    if (overlayKey === this.overlayKey && f === this.overlayField) return;
    this.overlayKey = overlayKey;
    this.overlayField = f;
    this.clearOverlay();
    const y = PLATE_Y + p.thickness * 6 + 0.005 + (poses.plate?.offset[1] ?? 0);
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
            vertices.push(
              (x1 - 0.5) * p.width * 12,
              y,
              (z1 - 0.5) * p.height * 12,
              (x2 - 0.5) * p.width * 12,
              y,
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
    if (this.film?.region) {
      const r = d.focusRegion ?? [0.25, 0.25, 0.75, 0.75],
        vs: number[] = [];
      for (const [a, b, c1, d1] of [
        [r[0], r[1], r[2], r[1]],
        [r[2], r[1], r[2], r[3]],
        [r[2], r[3], r[0], r[3]],
        [r[0], r[3], r[0], r[1]],
      ])
        vs.push(
          (a - 0.5) * p.width * 12,
          y,
          (b - 0.5) * p.height * 12,
          (c1 - 0.5) * p.width * 12,
          y,
          (d1 - 0.5) * p.height * 12,
        );
      this.lines(vs, '#bdcbd3');
    }
    if (d.run && v.layer === 'trace') {
      const vertices: number[] = [];
      for (let i = 0; i < Math.min(50, d.run.species.length); i++) {
        const id = i * Math.max(1, Math.floor(d.run.species.length / 50));
        for (let j = 1; j < d.run.frames.length && d.run.frames[j].time <= d.time; j++) {
          const r = d.focusRegion;
          if (r) {
            const pos = d.run.frames[0].positions;
            if (
              pos[id * 2] < r[0] ||
              pos[id * 2] > r[2] ||
              pos[id * 2 + 1] < r[1] ||
              pos[id * 2 + 1] > r[3]
            )
              continue;
          }
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
    const director = this.data.director;
    this.film = director?.sample() ?? null;
    const filmChanged = director && director.revision !== this.filmRevision;
    if (director) this.filmRevision = director.revision;
    this.quality.sample(dt, !!this.data.animate || !!this.rig.goal || !!this.film?.camera);
    const moved = this.rig.tick(dt);
    if (this.film?.camera) this.rig.applyPose(this.film.camera);
    if (!this.dirty && !moved && !this.rig.goal && !this.data.animate && !filmChanged) return;
    this.draw();
  };
  draw(width = this.host.clientWidth, height = this.host.clientHeight, captureMode = false) {
    const low = this.data.view.quality === 'low' || (this.adaptiveQuality && this.quality.degraded);
    this.activeQuality = low ? 'low' : 'standard';
    const ratio = captureMode ? 1 : low ? 1 : Math.min(devicePixelRatio, 1.5);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    const phase = this.film?.phase ?? this.data.view.phase;
    const effective = (d: Omit<RenderData, 'compare'>): Omit<RenderData, 'compare'> => {
      const time =
        this.film?.runProgress != null && d.run
          ? this.film.runProgress * d.run.config.drive.duration
          : (d.currentTime?.() ?? d.time);
      return {
        ...d,
        time,
        field:
          d.run && d.field && !d.view.showMode && time !== d.time
            ? fieldAtRun(d.run, time)
            : d.field,
        view: {
          ...d.view,
          layer: this.film?.layer ?? d.view.layer,
          gain: this.film?.gain ?? d.view.gain,
        },
      };
    };

    if (this.data.compare || this.data.mediaPane) {
      const old = this.rig.camera.aspect,
        position = this.rig.camera.position.clone();
      const aspect = width / 2 / height,
        distance = position.distanceTo(this.rig.controls.target),
        halfDiagonal =
          Math.max(
            Math.hypot(this.data.config.plate.width, this.data.config.plate.height),
            this.data.compare
              ? Math.hypot(
                  this.data.compare.config.plate.width,
                  this.data.compare.config.plate.height,
                )
              : 0,
          ) * 6,
        fit =
          (halfDiagonal * 1.05) /
          (Math.tan(T.MathUtils.degToRad(this.rig.camera.fov / 2)) * Math.min(1, aspect));
      this.rig.camera.position
        .sub(this.rig.controls.target)
        .normalize()
        .multiplyScalar(Math.max(distance, fit))
        .add(this.rig.controls.target);
      this.rig.camera.updateMatrixWorld();
      this.renderer.setScissorTest(true);
      for (let i = 0; i < (this.data.mediaPane ? 1 : 2); i++) {
        this.rig.camera.aspect = width / 2 / height;
        this.rig.camera.updateProjectionMatrix();
        this.renderer.setViewport((i * width) / 2, 0, width / 2, height);
        this.renderer.setScissor((i * width) / 2, 0, width / 2, height);
        this.prepare(
          effective(i === 0 ? this.data : this.data.compare!),
          phase,
          i,
          captureMode ? height / this.host.clientHeight : ratio,
        );
        this.renderer.render(this.scene, this.rig.camera);
      }
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, width, height);
      this.rig.camera.aspect = old;
      this.rig.camera.position.copy(position);
      this.rig.camera.updateProjectionMatrix();
    } else {
      this.prepare(
        effective(this.data),
        phase,
        0,
        captureMode ? height / this.host.clientHeight : ratio,
      );
      this.renderer.render(this.scene, this.rig.camera);
    }
    Object.assign(this.renderer.domElement.dataset, {
      physicalCount: String(this.cloud.stats.physicalCount),
      displayCount: String(this.cloud.stats.displayCount),
      lod: this.cloud.stats.lod,
      environment: this.environmentReady ? 'hdr' : 'studio',
      quality: this.activeQuality,
    });
    this.dirty = false;
  }
  async capture() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight,
      scale = Math.min(2, 3840 / w),
      width = Math.round(w * scale),
      height = Math.round(h * scale);
    const target = new T.WebGLRenderTarget(width, height, { depthBuffer: true });
    const previous = this.renderer.getRenderTarget(),
      ratio = this.renderer.getPixelRatio();
    target.texture.colorSpace = T.SRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.renderer.setRenderTarget(target);
    this.draw(width, height, true);
    const pixels = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    this.renderer.setRenderTarget(previous);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setViewport(0, 0, w, h);
    target.dispose();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!,
      data = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++)
      data.data.set(
        pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4),
        y * width * 4,
      );
    ctx.putImageData(data, 0, 0);
    this.dirty = true;
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.rig.dispose();
    this.host.removeEventListener('pointerdown', this.pointerDown);
    this.host.removeEventListener('pointerup', this.pointerUp);
    this.scene.remove(this.cloud.root, this.compareCloud.root);
    this.cloud.dispose();
    this.compareCloud.dispose();
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>();
    this.scene.traverse((o) => {
      if (o instanceof T.DirectionalLight) o.shadow.dispose();
      if (o instanceof T.Mesh || o instanceof T.Line) {
        geometries.add(o.geometry);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => materials.add(m));
      }
    });
    Object.values(this.materials).forEach((m) => {
      if (m instanceof T.Material) materials.add(m);
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    this.fieldGPU.dispose();
    this.instrument.plate.customDepthMaterial?.dispose();
    this.materials.brush.dispose();
    this.materials.roughness.dispose();
    this.materials.fiber.dispose();
    this.env.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
