import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { MODES, DURATION, type SceneState, type PartId, type CameraPreset } from '../model/catalog';
import {
  buildParticles,
  contours,
  field,
  gradient,
  particleAt,
  response,
  type ParticleData,
} from '../model/physics';
import { createMaterials } from './materials';
import { createInstrument, HALF_PLATE, PLATE_Y } from './instrument';

type Callbacks = {
  select: (part: PartId | null) => void;
  ready: () => void;
  error: (message: string) => void;
};
const particleCache = new Map<string, ParticleData>();
const temp = new THREE.Object3D();
const cream = new THREE.Color('#dfd4b6'),
  salt = new THREE.Color('#e5e4d9');
const lowColor = new THREE.Color('#263b3b'),
  highColor = new THREE.Color('#d5b785');
const signedLow = new THREE.Color('#709d9d'),
  signedHigh = new THREE.Color('#d9ba87');

function cachedParticles(mode: number, kind: SceneState['particleKind'], inverse: boolean) {
  const key = `${mode}:${kind}:${inverse}`;
  if (!particleCache.has(key)) particleCache.set(key, buildParticles(mode, kind, inverse));
  return particleCache.get(key)!;
}

export class SceneController {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(33, 1, 0.05, 90);
  private controls: OrbitControls;
  private materials = createMaterials();
  private instrument = createInstrument(this.materials);
  private particles: THREE.InstancedMesh;
  private overlay = new THREE.Group();
  private arrows = new THREE.Group();
  private mechanism = new THREE.Group();
  private trace = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: '#cdb687', transparent: true, opacity: 0.48 }),
  );
  private observer: ResizeObserver;
  private environment: THREE.WebGLRenderTarget;
  private raycaster = new THREE.Raycaster();
  private state: SceneState;
  private callbacks: Callbacks;
  private frame = 0;
  private width = 1;
  private height = 1;
  private lastOverlay = '';
  private lastParticleColor = '';
  private lastFieldMode = -1;
  private plateField = new Float32Array(0);
  private disposed = false;
  private start = performance.now();
  private previousFrame = performance.now();
  private frameDelta = 1 / 60;
  private cameraGoal: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private pointDown = { x: 0, y: 0 };
  private clipping = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private cutPlane = new THREE.Plane(new THREE.Vector3(-1, 0, -0.3).normalize(), 0.1);
  private level = 0;
  private wasDeformed = false;
  private labels: { element: HTMLButtonElement; part: PartId; point: THREE.Vector3 }[] = [];
  private dirty = true;
  private lastRenderState: SceneState | null = null;
  private visibilityHandler: () => void;

  constructor(
    private host: HTMLDivElement,
    state: SceneState,
    callbacks: Callbacks,
  ) {
    this.state = state;
    this.callbacks = callbacks;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    this.renderer.setClearColor('#151a18');
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.setAttribute(
      'aria-label',
      '클라드니 실험 장비 3D 뷰포트. 드래그로 회전하고 스크롤로 확대합니다.',
    );
    this.renderer.domElement.setAttribute('role', 'img');
    this.host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#151a18');
    this.scene.fog = new THREE.Fog('#151a18', 17, 38);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new THREE.Scene();
    room.background = new THREE.Color('#131815');
    const cards: THREE.Mesh[] = [];
    for (const [width, height, x, y, z, intensity] of [
      [9, 2.5, -4, 7, 1, 2.6],
      [1.5, 8, 5, 3, -4, 2.2],
      [7, 2, 1, 4, 7, 0.9],
      [5, 2, 0, 9, -8, 1.4],
    ]) {
      const card = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(intensity, intensity * 0.99, intensity * 0.96),
          side: THREE.DoubleSide,
        }),
      );
      card.position.set(x, y, z);
      card.lookAt(0, 0, 0);
      room.add(card);
      cards.push(card);
    }
    this.environment = pmrem.fromScene(room, 0.025);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.7;
    cards.forEach((card) => {
      card.geometry.dispose();
      (card.material as THREE.Material).dispose();
    });
    pmrem.dispose();
    this.scene.add(this.instrument.root);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshStandardMaterial({
        color: '#020302',
        roughness: 1,
        metalness: 0,
        envMapIntensity: 0.1,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.011;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.scene.add(new THREE.HemisphereLight('#e1e9e7', '#1d241f', 0.7));
    const key = new THREE.DirectionalLight('#f3eee2', 2.8);
    key.position.set(-3, 10, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = key.shadow.camera.bottom = -6;
    key.shadow.camera.right = key.shadow.camera.top = 6;
    key.shadow.normalBias = 0.018;
    key.shadow.bias = -0.0002;
    key.shadow.radius = 5;
    key.shadow.blurSamples = 8;
    key.shadow.intensity = 0.55;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#b8c6ca', 1.3);
    fill.position.set(4, 5, -3);
    this.scene.add(fill);
    RectAreaLightUniformsLib.init();
    const strip = new THREE.RectAreaLight('#e3e8dd', 2.5, 5, 2);
    strip.position.set(-4, 3, -3);
    strip.lookAt(0, 1, 0);
    this.scene.add(strip);

    const grain = new THREE.TetrahedronGeometry(0.012, 0);
    this.particles = new THREE.InstancedMesh(grain, this.materials.sand, 7200);
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles.frustumCulled = false;
    this.particles.userData.part = 'particles';
    this.instrument.parts.particles.add(this.particles);
    this.instrument.parts.plate.add(this.overlay, this.arrows, this.trace);
    this.scene.add(this.mechanism);
    this.trace.frustumCulled = false;
    this.createMechanism();
    const anchors: { part: PartId; text: string; point: number[] }[] = [
      { part: 'particles', text: '01 입자', point: [1.0, PLATE_Y + 0.05, 0.9] },
      { part: 'plate', text: '02 알루미늄판', point: [-1.6, PLATE_Y, -1.5] },
      { part: 'bolt', text: '03 중앙 볼트', point: [0, PLATE_Y + 0.12, 0] },
      { part: 'coupler', text: '04 전달봉', point: [0, 1.7, 0] },
      { part: 'speaker', text: '05 전자기 구동부', point: [0.65, 1.03, 0.3] },
      { part: 'support', text: '06 지지 구조', point: [-0.8, 0.3, 0.9] },
    ];
    for (const anchor of anchors) {
      const element = document.createElement('button');
      element.className = 'scene-label hidden';
      element.textContent = anchor.text;
      element.addEventListener('click', () => this.callbacks.select(anchor.part));
      this.host.appendChild(element);
      this.labels.push({
        element,
        part: anchor.part,
        point: new THREE.Vector3(...(anchor.point as [number, number, number])),
      });
    }

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 22;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minPolarAngle = 0.015;
    this.controls.enablePan = true;
    this.controls.addEventListener('start', this.onOrbit);
    this.setCamera('hero', true);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.resize();
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.visibilityHandler = () => {
      if (document.hidden) cancelAnimationFrame(this.frame);
      else if (!this.disposed) this.animate();
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.animate();
    callbacks.ready();
  }

  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.callbacks.error('3D 연결이 중단되었습니다. 페이지를 새로고침해 다시 시도해 주세요.');
  };
  private onOrbit = () => {
    this.cameraGoal = null;
  };
  private onPointerDown = (event: PointerEvent) => {
    this.pointDown = { x: event.clientX, y: event.clientY };
  };
  private onPointerUp = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - this.pointDown.x, event.clientY - this.pointDown.y) > 5) return;
    if (this.state.view === 'compare' || this.state.view === 'before') return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const hits = this.raycaster.intersectObjects(this.instrument.root.children, true);
    const hit = hits.find((h) => {
      const part = h.object.userData.part as PartId | undefined;
      if (!part || !h.object.visible || !this.instrument.parts[part].visible) return false;
      if (this.state.view === 'section' && this.clipping.distanceToPoint(h.point) < 0) return false;
      if (
        this.state.view === 'cutaway' &&
        part === 'speaker' &&
        this.cutPlane.distanceToPoint(h.point) < 0
      )
        return false;
      return true;
    });
    this.callbacks.select(hit ? (hit.object.userData.part as PartId) : null);
  };

  private resize = () => {
    this.width = this.host.clientWidth;
    this.height = this.host.clientHeight;
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / Math.max(this.height, 1);
    this.camera.updateProjectionMatrix();
    this.dirty = true;
    this.setCamera(this.state.camera, true);
  };

  update(state: SceneState) {
    const old = this.state;
    this.state = state;
    if (old.cameraRevision !== state.cameraRevision || old.camera !== state.camera)
      this.setCamera(state.camera);
    if (old.view !== state.view) {
      this.setCamera(state.camera);
    }
  }

  setCamera(preset: CameraPreset, immediate = false) {
    const exploded = this.state.view === 'exploded' || this.state.view === 'assembly';
    const positions = {
      hero: new THREE.Vector3(6.5, exploded ? 7.1 : 6.2, 8.4).multiplyScalar(exploded ? 1.2 : 1),
      top: new THREE.Vector3(0, 10.2, 0.07),
      macro: new THREE.Vector3(2.7, 3.1, 2.8),
      section: new THREE.Vector3(5.5, 3.1, 6.8),
    };
    const target = new THREE.Vector3(
      0,
      exploded ? 2.5 : preset === 'top' || preset === 'macro' ? PLATE_Y : 1.25,
      0,
    );
    const fit = preset === 'macro' ? 1 : Math.max(1, 0.85 / this.camera.aspect);
    positions[preset].sub(target).multiplyScalar(fit).add(target);
    this.cameraGoal = { position: positions[preset], target };
    this.dirty = true;
    if (immediate || this.state.reducedMotion) {
      this.camera.position.copy(positions[preset]);
      this.controls.target.copy(target);
      this.controls.update();
      this.cameraGoal = null;
    }
  }

  private createMechanism() {
    for (let i = 0; i < 4; i++) {
      const arrow = new THREE.ArrowHelper(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0.36, 0.65 + i * 0.42, 0.14),
        0.3,
        '#b8c6aa',
        0.08,
        0.045,
      );
      this.mechanism.add(arrow);
    }
  }

  private clearGroup(group: THREE.Group) {
    for (const object of [...group.children]) {
      group.remove(object);
      if (object instanceof THREE.Line || object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
      if (object instanceof THREE.ArrowHelper) {
        object.line.geometry.dispose();
        (object.line.material as THREE.Material).dispose();
        object.cone.geometry.dispose();
        (object.cone.material as THREE.Material).dispose();
      }
    }
  }

  private updateOverlays(modeIndex: number) {
    const s = this.state;
    const causalNodes = s.view === 'causal' && s.time >= 4.8;
    const key = `${modeIndex}:${s.view}:${s.nodes}:${causalNodes}`;
    if (key === this.lastOverlay) return;
    this.lastOverlay = key;
    this.clearGroup(this.overlay);
    this.clearGroup(this.arrows);
    const showContour = s.view === 'contour';
    const showNodes =
      s.nodes || showContour || s.view === 'mode' || s.view === 'motion' || causalNodes;
    if (showNodes) {
      for (const level of showContour ? [0, 0.18, 0.4, 0.65] : [0]) {
        const segments = contours(modeIndex, level, level !== 0);
        const array: number[] = [];
        for (let p = 0; p < segments.length; p += 2)
          array.push(
            segments[p] * HALF_PLATE,
            PLATE_Y + 0.02 + (showContour ? level * 0.01 : 0),
            segments[p + 1] * HALF_PLATE,
          );
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(array, 3));
        const line = new THREE.LineSegments(
          geometry,
          new THREE.LineBasicMaterial({
            color: level === 0 ? '#e1d0a9' : '#8ca6a0',
            transparent: true,
            opacity: level === 0 ? 0.88 : 0.45,
            depthTest: false,
            clippingPlanes: s.view === 'section' ? [this.clipping] : [],
          }),
        );
        line.renderOrder = 4;
        this.overlay.add(line);
      }
    }
    if (s.view === 'vector') {
      for (let z = -0.88; z <= 0.9; z += 0.16)
        for (let x = -0.88; x <= 0.9; x += 0.16) {
          const w = field(x, z, MODES[modeIndex]),
            [gx, gz] = gradient(x, z, MODES[modeIndex]);
          const vector = new THREE.Vector3(-w * gx, 0, -w * gz);
          if (vector.length() < 0.025 || Math.hypot(x, z) < 0.13) continue;
          const length = Math.min(0.16, vector.length() * 0.1);
          this.arrows.add(
            new THREE.ArrowHelper(
              vector.normalize(),
              new THREE.Vector3(x * HALF_PLATE, PLATE_Y + 0.035, z * HALF_PLATE),
              length,
              '#b8c8c2',
              0.04,
              0.025,
            ),
          );
        }
    }
  }

  private prepare(
    modeIndex: number,
    time: number,
    inverse: boolean,
    frequency = this.state.frequency,
  ) {
    const s = this.state,
      instrument = this.instrument,
      mode = MODES[modeIndex];
    const isStructure = ['exploded', 'assembly', 'cutaway', 'section', 'ghost'].includes(s.view);
    const exploded =
      s.view === 'exploded' ? s.explosion : s.view === 'assembly' ? 1 - time / DURATION : 0;
    this.level +=
      (exploded - this.level) * (s.reducedMotion ? 1 : 1 - Math.exp(-this.frameDelta * 6));
    const distances: Record<PartId, number> = {
      support: 0,
      speaker: 0.5,
      coupler: 1.25,
      plate: 2.3,
      bolt: 2.9,
      particles: 3.35,
    };
    for (const [id, part] of Object.entries(instrument.parts) as [PartId, THREE.Group][]) {
      const staged =
        s.view === 'assembly'
          ? Math.max(0, 1 - (time / DURATION) * 1.8 + (distances[id] / 3.35) * 0.8)
          : this.level;
      part.position.y = distances[id] * Math.min(1, staged);
      part.visible = !s.hiddenParts.includes(id);
      part.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || object === this.particles) return;
        const material = object.material as THREE.MeshStandardMaterial;
        const original = instrument.originals.get(material);
        if (!original) return;
        const ghost =
          s.view === 'ghost' && (id === 'plate' || id === 'support' || id === 'speaker');
        material.transparent = ghost;
        material.opacity = ghost ? (id === 'plate' ? 0.16 : 0.23) : 1;
        material.depthWrite = !ghost;
        const planes =
          s.view === 'section'
            ? [this.clipping]
            : s.view === 'cutaway' && id === 'speaker'
              ? [this.cutPlane]
              : [];
        if (material.clippingPlanes?.length !== planes.length) material.needsUpdate = true;
        material.clippingPlanes = planes;
        material.clipShadows = true;
        material.emissive.set(s.selectedPart === id ? '#5d7568' : '#000000');
        material.emissiveIntensity = s.selectedPart === id ? 0.17 : 0;
      });
    }
    this.mechanism.visible = s.view === 'mechanism' || (s.view === 'causal' && time < 5);
    this.mechanism.children.forEach((a, i) => {
      a.position.y = s.reducedMotion ? 0 : (time * 0.34 + i * 0.03) % 0.2;
    });
    const ampResponse = response(frequency, mode.frequency);
    const progress = Math.max(
      0,
      Math.min(
        1,
        ((s.view === 'causal' ? (time - 7.2) / 4.8 : time / DURATION) * ampResponse * s.amplitude) /
          0.68,
      ),
    );
    const data = cachedParticles(modeIndex, s.particleKind, inverse);
    const colorKey = `${s.particleKind}:${modeIndex}`;
    const colorChanged = colorKey !== this.lastParticleColor;
    this.lastParticleColor = colorKey;
    this.particles.visible = s.particles && !s.hiddenParts.includes('particles');
    const particlePlanes = s.view === 'section' ? [this.clipping] : [];
    if (this.materials.sand.clippingPlanes?.length !== particlePlanes.length)
      this.materials.sand.needsUpdate = true;
    this.materials.sand.clippingPlanes = particlePlanes;
    this.materials.sand.emissive.set(s.selectedPart === 'particles' ? '#7a8e62' : '#000000');
    this.materials.sand.emissiveIntensity = s.selectedPart === 'particles' ? 0.25 : 0;
    const magnified =
      ['motion', 'mode'].includes(s.view) || (s.view === 'causal' && time >= 2.4 && time < 7.2);
    const phase = Math.sin(time * Math.PI * 1.3);
    const displacement = magnified ? 0.17 * s.amplitude * ampResponse : 0;

    const positions = instrument.plate.geometry.attributes.position as THREE.BufferAttribute;
    if (this.lastFieldMode !== modeIndex) {
      this.plateField = new Float32Array(positions.count);
      for (let i = 0; i < positions.count; i++)
        this.plateField[i] = field(
          instrument.restPositions[i * 3] / HALF_PLATE,
          instrument.restPositions[i * 3 + 2] / HALF_PLATE,
          mode,
        );
      this.lastFieldMode = modeIndex;
    }
    const colorView =
      ['heatmap', 'mode', 'motion'].includes(s.view) ||
      (s.view === 'causal' && time >= 2.4 && time < 7.2);
    const plateMaterial = instrument.plate.material as THREE.MeshStandardMaterial;
    if (plateMaterial.vertexColors !== colorView) {
      plateMaterial.vertexColors = colorView;
      plateMaterial.needsUpdate = true;
    }
    plateMaterial.color.set(colorView ? '#ffffff' : '#929e9f');
    plateMaterial.metalness = colorView ? 0.35 : 0.92;
    if (!instrument.plate.geometry.attributes.color)
      instrument.plate.geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(new Float32Array(positions.count * 3).fill(1), 3),
      );
    const colors = instrument.plate.geometry.attributes.color as THREE.BufferAttribute;
    const color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const w = this.plateField[i];
      positions.setY(i, instrument.restPositions[i * 3 + 1] + w * phase * displacement);
      if (colorView) {
        if (s.view === 'heatmap') color.copy(lowColor).lerp(highColor, Math.abs(w));
        else color.copy(signedLow).lerp(signedHigh, (w * phase + 1) / 2);
        colors.setXYZ(i, color.r, color.g, color.b);
      }
    }
    positions.needsUpdate = true;
    if (magnified || this.wasDeformed) instrument.plate.geometry.computeVertexNormals();
    this.wasDeformed = magnified;
    if (colorView) colors.needsUpdate = true;

    for (let i = 0; i < data.count; i++) {
      const [x, z] = particleAt(data, i, progress);
      const seed = data.seeds[i * 3];
      const w = field(x, z, mode);
      const hop =
        s.playing && !isStructure && !s.reducedMotion
          ? Math.abs(Math.sin(time * 22 + seed * 130)) * Math.abs(w) * 0.025 * s.amplitude
          : 0;
      temp.position.set(
        x * HALF_PLATE,
        PLATE_Y + 0.025 + hop + w * phase * displacement,
        z * HALF_PLATE,
      );
      temp.rotation.set(seed * 6, data.seeds[i * 3 + 1] * 6, data.seeds[i * 3 + 2] * 6);
      const size = 0.6 + seed * 0.55;
      temp.scale.set(size, size * 0.6, size * (data.species[i] ? 0.9 : 1.3));
      temp.updateMatrix();
      this.particles.setMatrixAt(i, temp.matrix);
      if (colorChanged)
        this.particles.setColorAt(
          i,
          color.copy(data.species[i] ? salt : cream).multiplyScalar(0.73 + seed * 0.4),
        );
    }
    this.particles.instanceMatrix.needsUpdate = true;
    if (colorChanged && this.particles.instanceColor)
      this.particles.instanceColor.needsUpdate = true;
    this.updateOverlays(modeIndex);
    this.trace.visible = s.view === 'trace';
    if (this.trace.visible) {
      const vertices: number[] = [];
      const maxFrame = Math.floor(progress * (data.frames - 1));
      for (let i = 0; i < 68; i++) {
        const particle = i * 101;
        for (let t = 0; t < maxFrame; t += 2) {
          const a = particleAt(data, particle, t / (data.frames - 1)),
            b = particleAt(data, particle, Math.min(maxFrame, t + 2) / (data.frames - 1));
          vertices.push(
            a[0] * HALF_PLATE,
            PLATE_Y + 0.028,
            a[1] * HALF_PLATE,
            b[0] * HALF_PLATE,
            PLATE_Y + 0.028,
            b[1] * HALF_PLATE,
          );
        }
      }
      this.trace.geometry.dispose();
      this.trace.geometry = new THREE.BufferGeometry();
      this.trace.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    }
  }

  private animate = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    const now = performance.now();
    this.frameDelta = Math.min(0.15, (now - this.previousFrame) / 1000);
    this.previousFrame = now;
    const cameraMoving = Boolean(this.cameraGoal);
    if (this.cameraGoal) {
      const blend = 1 - Math.exp(-this.frameDelta * 4.6);
      this.camera.position.lerp(this.cameraGoal.position, blend);
      this.controls.target.lerp(this.cameraGoal.target, blend);
      if (this.camera.position.distanceTo(this.cameraGoal.position) < 0.002) this.cameraGoal = null;
    }
    const orbitChanged = this.controls.update();
    const time = (performance.now() - this.start) / 1000;
    const explodeMoving =
      this.state.view === 'exploded' && Math.abs(this.state.explosion - this.level) > 0.001;
    if (
      !this.dirty &&
      !cameraMoving &&
      !orbitChanged &&
      !explodeMoving &&
      this.lastRenderState === this.state &&
      time > 2.3
    )
      return;
    for (const label of this.labels) {
      const visible =
        this.state.annotations &&
        this.instrument.parts[label.part].visible &&
        (label.part !== 'particles' || this.state.particles) &&
        this.state.view !== 'compare' &&
        this.state.view !== 'before';
      label.element.classList.toggle('hidden', !visible);
      if (visible) {
        const point = label.point
          .clone()
          .add(this.instrument.parts[label.part].position)
          .project(this.camera);
        label.element.style.left = `${(point.x * 0.5 + 0.5) * this.width}px`;
        label.element.style.top = `${(-point.y * 0.5 + 0.5) * this.height}px`;
      }
    }
    this.renderer.toneMappingExposure = this.state.reducedMotion
      ? 1.12
      : THREE.MathUtils.lerp(0.38, 1.12, Math.min(1, time / 2.2));
    const split = this.state.view === 'compare' || this.state.view === 'before';
    if (split) {
      const leftWidth = Math.round((this.width * this.state.split) / 100);
      const before = this.state.view === 'before';
      const ratio = this.camera.aspect;
      const originalPosition = this.camera.position.clone();
      const distance = this.camera.position.distanceTo(this.controls.target);
      const paneAspect = Math.min(leftWidth, this.width - leftWidth) / this.height;
      const neededDistance =
        2.3 / (Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * paneAspect);
      if (distance < neededDistance)
        this.camera.position
          .sub(this.controls.target)
          .normalize()
          .multiplyScalar(neededDistance)
          .add(this.controls.target);
      this.camera.updateMatrixWorld();
      this.renderer.setScissorTest(true);
      this.camera.aspect = leftWidth / this.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setViewport(0, 0, leftWidth, this.height);
      this.renderer.setScissor(0, 0, leftWidth, this.height);
      this.prepare(this.state.modeIndex, before ? 0 : this.state.time, false);
      this.renderer.render(this.scene, this.camera);
      const rightWidth = this.width - leftWidth;
      this.camera.aspect = rightWidth / this.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setViewport(leftWidth, 0, rightWidth, this.height);
      this.renderer.setScissor(leftWidth, 0, rightWidth, this.height);
      this.prepare(
        before || this.state.compareKind !== 'frequency'
          ? this.state.modeIndex
          : this.state.compareModeIndex,
        before ? DURATION : this.state.time,
        this.state.compareKind === 'inverse' && !before,
        !before && this.state.compareKind === 'frequency'
          ? MODES[this.state.compareModeIndex].frequency
          : this.state.frequency,
      );
      this.renderer.render(this.scene, this.camera);
      this.renderer.setScissorTest(false);
      this.camera.aspect = ratio;
      this.camera.updateProjectionMatrix();
      this.renderer.setViewport(0, 0, this.width, this.height);
      this.camera.position.copy(originalPosition);
    } else {
      this.prepare(this.state.modeIndex, this.state.time, false);
      this.renderer.render(this.scene, this.camera);
    }
    this.lastRenderState = this.state;
    this.dirty = false;
  };

  async capture() {
    return new Promise<Blob | null>((resolve) =>
      this.renderer.domElement.toBlob(resolve, 'image/png'),
    );
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.dispose();
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        object.geometry.dispose();
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.environment.dispose();
    this.materials.brush.dispose();
    this.materials.roughness.dispose();
    this.renderer.dispose();
    this.labels.forEach((label) => label.element.remove());
    this.renderer.domElement.remove();
  }
}
