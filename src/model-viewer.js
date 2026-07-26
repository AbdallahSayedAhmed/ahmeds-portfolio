import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// Caps how many decoded scenes we keep in memory at once. The library spans
// 20 GLBs from ~0.6MB up to ~276MB, so caching everything forever would blow
// the tab's memory budget -- oldest, non-active entries get evicted first.
const MAX_CACHE_ENTRIES = 6;
// A couple of the heavier booth exports occasionally hiccup on the first
// fetch attempt (large single request over the dev/prod server). Retry a
// couple of times before surfacing a real failure to the visitor.
const MAX_LOAD_ATTEMPTS = 3;
const NORMALIZED_FRONT_SIZE = 2.4;
const CAMERA_FILL_RATIO = 0.86;

export class FastModelViewer {
  constructor(canvas, projects, ui) {
    this.canvas = canvas;
    this.projects = projects;
    this.ui = ui;
    this.loader = new GLTFLoader();
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('/draco/');
    this.dracoLoader.setDecoderConfig({ type: 'wasm' });
    this.loader.setDRACOLoader(this.dracoLoader);
    this.cache = new Map();
    this.cacheOrder = [];
    this.activeProject = projects[0];
    this.model = null;
    this.needsRender = true;
    this.isVisible = true;
    this.setupScene();
    this.bindEvents();
    this.resize();
    this.loadProject(projects[0], true);
    this.animate();
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf7f7f4);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 1.1, 6);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // Lower cap than before -- most of the viewer's cost is fragment shading,
    // so trimming device pixel ratio buys real frame-time headroom on hi-DPI
    // laptops/phones without a visible sharpness hit at this canvas size.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = true;
    this.controls.minDistance = 1.8;
    this.controls.maxDistance = 9;
    // No auto-rotate and no scripted drift: the model only ever moves when
    // the visitor actively drags/zooms it.
    this.controls.autoRotate = false;
    let logRotationTimer;
    this.controls.addEventListener('change', () => {
      this.needsRender = true;
      // Dev helper: drag a model to the angle you want as its default
      // "front" view, wait half a second, then check the console --
      // paste the logged rotationY (degrees) into that project's entry
      // in main.js so it opens facing that way every time.
      clearTimeout(logRotationTimer);
      logRotationTimer = setTimeout(() => {
        const azimuth = THREE.MathUtils.radToDeg(this.controls.getAzimuthalAngle());
        const suggested = (this.activeProject.rotationY || 0) - azimuth;
        console.log(`[${this.activeProject.id}] suggested rotationY: ${suggested.toFixed(1)}`);
      }, 500);
    });

    const ambient = new THREE.HemisphereLight(0xffffff, 0x222222, 2.1);
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(4, 5, 5);
    const rim = new THREE.DirectionalLight(0xffffff, 1.2);
    rim.position.set(-4, 2, -3);
    this.scene.add(ambient, key, rim);
    // Grid helper intentionally omitted -- the WebGL surface only ever
    // shows the model itself now.
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize(), { passive: true });
    document.addEventListener('visibilitychange', () => {
      this.needsRender = true;
    });

    // Pause rendering work entirely while the canvas is scrolled out of
    // view (e.g. visitor is reading the collage section further down).
    this.visibilityObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          this.isVisible = entry.isIntersecting;
          if (this.isVisible) this.needsRender = true;
        });
      },
      { threshold: 0.05 },
    );
    this.visibilityObserver.observe(this.canvas);
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.camera.aspect = Math.max(rect.width, 1) / Math.max(rect.height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(rect.width, rect.height, false);
    this.needsRender = true;
  }

  // Called by main.js whenever the visible pagination page changes, so we
  // only ever warm the cache for the ~8 projects a visitor can currently see.
  setPreloadPool(pageProjects) {
    const fast = pageProjects.filter((project) => project.fast && project.id !== this.activeProject.id);
    if (!fast.length) return;
    const run = () => fast.forEach((project) => this.fetchModel(project).catch(() => {}));
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(run, { timeout: 2000 });
    } else {
      window.setTimeout(run, 800);
    }
  }

  cacheModel(key, prepared) {
    this.cache.set(key, prepared);
    this.cacheOrder = this.cacheOrder.filter((existing) => existing !== key);
    this.cacheOrder.push(key);

    while (this.cacheOrder.length > MAX_CACHE_ENTRIES) {
      const oldest = this.cacheOrder[0];
      if (oldest === this.activeProject.model) {
        // Keep the active model resident; try evicting the next oldest instead.
        this.cacheOrder.push(this.cacheOrder.shift());
        if (this.cacheOrder.length <= MAX_CACHE_ENTRIES) break;
        continue;
      }
      this.cacheOrder.shift();
      const evicted = this.cache.get(oldest);
      evicted?.traverse?.((child) => {
        child.geometry?.dispose?.();
      });
      this.cache.delete(oldest);
    }
  }

  fetchModel(project, attempt = 0) {
    if (this.cache.has(project.model)) {
      this.cacheOrder = this.cacheOrder.filter((existing) => existing !== project.model);
      this.cacheOrder.push(project.model);
      return Promise.resolve(this.cache.get(project.model).clone(true));
    }
    return new Promise((resolve, reject) => {
      this.loader.load(
        project.model,
        (gltf) => {
          const prepared = this.prepareModel(gltf.scene, project.rotationY);
          this.cacheModel(project.model, prepared);
          resolve(prepared.clone(true));
        },
        undefined,
        (error) => {
          if (attempt < MAX_LOAD_ATTEMPTS - 1) {
            const delay = 500 * (attempt + 1);
            window.setTimeout(() => {
              this.fetchModel(project, attempt + 1).then(resolve, reject);
            }, delay);
          } else {
            reject(error);
          }
        },
      );
    });
  }

  prepareModel(root, rotationYDeg = 0) {
    root.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.frustumCulled = true;
        if (child.material) {
          child.material.envMapIntensity = 0.65;
          child.material.needsUpdate = false;
        }
      }
    });

    // Measure only VISIBLE meshes first (hidden helper geometry -- site
    // outlines, scale references, stray proxy meshes -- would otherwise
    // get pulled into the box). Then go a step further: a handful of the
    // heavier booth exports still carry ONE visible stray mesh (an old
    // reference plane, a leftover modeling marker) sitting far from the
    // real model. A single outlier like that is enough to blow up a naive
    // combined box, which then makes prepareModel scale the real geometry
    // down to a barely-visible speck (the "model is tiny and far away"
    // bug). So we collect a per-mesh box for every visible mesh, then drop
    // anything sitting way outside the weighted centroid of the rest
    // before building the final box.
    const meshEntries = [];
    root.traverseVisible((child) => {
      if (!child.isMesh) return;
      const meshBox = new THREE.Box3().setFromObject(child);
      if (meshBox.isEmpty()) return;
      const meshSize = meshBox.getSize(new THREE.Vector3());
      const meshCenter = meshBox.getCenter(new THREE.Vector3());
      meshEntries.push({ box: meshBox, center: meshCenter, diagonal: meshSize.length() || 0.0001 });
    });

    let coreEntries = meshEntries;
    if (meshEntries.length > 1) {
      const totalWeight = meshEntries.reduce((sum, entry) => sum + entry.diagonal, 0) || 1;
      const centroid = meshEntries.reduce(
        (acc, entry) => acc.addScaledVector(entry.center, entry.diagonal / totalWeight),
        new THREE.Vector3(),
      );
      const distances = meshEntries.map((entry) => entry.center.distanceTo(centroid)).sort((a, b) => a - b);
      const median = distances[Math.floor(distances.length / 2)] || 0;
      // Generous multiplier -- real booths legitimately have wide parts
      // (gates, extended counters). This only needs to catch geometry
      // sitting way outside the model, not trim its real footprint.
      const threshold = Math.max(median * 6, 2);
      const filtered = meshEntries.filter((entry) => entry.center.distanceTo(centroid) <= threshold);
      if (filtered.length) coreEntries = filtered;
    }

    const box = new THREE.Box3();
    coreEntries.forEach((entry) => box.union(entry.box));
    if (!coreEntries.length) box.setFromObject(root);

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // The old code scaled against the largest axis, so deep exhibition booths
    // with long floor/reference geometry were shrunk until the actual facade
    // looked like a tiny dot. For the default front view we care about the
    // projected face (width/height), while depth is handled by the camera.
    const frontAxis = Math.max(size.x, size.y, size.z * 0.35) || 1;
    const normalized = new THREE.Group();
    root.position.copy(center).multiplyScalar(-1);
    normalized.add(root);
    normalized.scale.setScalar(NORMALIZED_FRONT_SIZE / frontAxis);

    // Per-project rotation so a model's "front" always faces the camera.
    if (rotationYDeg) {
      normalized.rotation.y = THREE.MathUtils.degToRad(rotationYDeg);
    }
    normalized.updateWorldMatrix(true, true);
    return normalized;
  }

  frameModel(model) {
    model.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    const heightDistance = size.y / (2 * Math.tan(verticalFov / 2) * CAMERA_FILL_RATIO);
    const widthDistance = size.x / (2 * Math.tan(horizontalFov / 2) * CAMERA_FILL_RATIO);
    const depthPadding = size.z * 0.18;
    const distance = Math.max(heightDistance, widthDistance, 1.6) + depthPadding;
    const lookAt = center.clone();
    lookAt.y += size.y * 0.04;

    this.controls.target.copy(lookAt);
    this.camera.position.set(lookAt.x, lookAt.y + size.y * 0.08, lookAt.z + distance);
    this.camera.near = Math.max(distance / 100, 0.01);
    this.camera.far = distance + size.length() * 6;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = Math.max(distance * 0.18, 0.25);
    this.controls.maxDistance = Math.max(distance * 4, 6);
    this.controls.update();
    this.controls.saveState();
  }

  async loadProject(project, force = false) {
    this.activeProject = project;
    this.ui.activeTitle.textContent = project.title;
    this.ui.modelPoster.src = project.image;
    this.ui.loadHdButton.hidden = true;
    this.ui.loadHdButton.dataset.project = project.id;

    this.ui.loaderState.textContent = 'Loading 3D';
    this.ui.loaderState.classList.remove('is-hidden');
    try {
      const model = await this.fetchModel(project);
      if (this.activeProject.id !== project.id) return;
      this.setModel(model);
      this.ui.loaderState.classList.add('is-hidden');
    } catch (error) {
      if (this.activeProject.id !== project.id) return;
      this.ui.loaderState.textContent = '3D unavailable';
      this.ui.loaderState.classList.remove('is-hidden');
      console.error(error);
    }
  }

  removeModel() {
    if (this.model) {
      this.scene.remove(this.model);
      this.model = null;
    }
  }

  setModel(model) {
    this.removeModel();
    this.model = model;
    this.scene.add(this.model);
    this.frameModel(this.model);
    this.needsRender = true;
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    if (document.hidden || !this.isVisible) return;

    this.controls.update();

    if (this.needsRender) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
  }
}
