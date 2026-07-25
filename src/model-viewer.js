import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class FastModelViewer {
  constructor(canvas, projects, ui) {
    this.canvas = canvas;
    this.projects = projects;
    this.ui = ui;
    this.loader = new GLTFLoader();
    this.cache = new Map();
    this.activeProject = projects[0];
    this.model = null;
    this.pointer = new THREE.Vector2();
    this.targetPointer = new THREE.Vector2();
    this.needsRender = true;
    this.clock = new THREE.Clock();
    this.setupScene();
    this.bindEvents();
    this.resize();
    this.loadProject(projects[0], true);
    this.preloadFastModels();
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = true;
    this.controls.minDistance = 1.8;
    this.controls.maxDistance = 9;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.75;
    this.controls.addEventListener('change', () => {
      this.needsRender = true;
    });

    const ambient = new THREE.HemisphereLight(0xffffff, 0x222222, 2.1);
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(4, 5, 5);
    const rim = new THREE.DirectionalLight(0xffffff, 1.2);
    rim.position.set(-4, 2, -3);
    this.scene.add(ambient, key, rim);

    const grid = new THREE.GridHelper(7, 12, 0x111111, 0xd4d4d4);
    grid.position.y = -1.15;
    this.scene.add(grid);
  }

  bindEvents() {
    this.canvas.addEventListener(
      'pointermove',
      (event) => {
        const rect = this.canvas.getBoundingClientRect();
        this.targetPointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
        this.targetPointer.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
        this.needsRender = true;
      },
      { passive: true },
    );
    window.addEventListener('resize', () => this.resize(), { passive: true });
    document.addEventListener('visibilitychange', () => {
      this.needsRender = true;
    });
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.camera.aspect = Math.max(rect.width, 1) / Math.max(rect.height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(rect.width, rect.height, false);
    this.needsRender = true;
  }

  preloadFastModels() {
    const fast = this.projects.filter((project) => project.fast && project.id !== this.activeProject.id).slice(0, 4);
    const preload = () => {
      fast.forEach((project) => this.fetchModel(project).catch(() => {}));
    };
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(preload, { timeout: 2500 });
    } else {
      window.setTimeout(preload, 1200);
    }
  }

  fetchModel(project) {
    if (this.cache.has(project.model)) {
      return Promise.resolve(this.cache.get(project.model).clone(true));
    }
    return new Promise((resolve, reject) => {
      this.loader.load(
        project.model,
        (gltf) => {
          const prepared = this.prepareModel(gltf.scene);
          this.cache.set(project.model, prepared);
          resolve(prepared.clone(true));
        },
        undefined,
        reject,
      );
    });
  }

  prepareModel(root) {
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
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxAxis = Math.max(size.x, size.y, size.z) || 1;
    root.position.sub(center);
    root.scale.setScalar(1.35 / maxAxis);
    return root;
  }

  async loadProject(project, force = false) {
    this.activeProject = project;
    this.ui.activeTitle.textContent = project.title;
    this.ui.modelPoster.src = project.image;
    this.ui.loadHdButton.hidden = project.fast || force;
    this.ui.loadHdButton.dataset.project = project.id;

    if (!project.fast && !force) {
      this.ui.loaderState.textContent = 'Preview mode';
      this.ui.loaderState.classList.remove('is-hidden');
      this.removeModel();
      this.needsRender = true;
      return;
    }

    this.ui.loaderState.textContent = 'Loading 3D';
    this.ui.loaderState.classList.remove('is-hidden');
    try {
      const model = await this.fetchModel(project);
      if (this.activeProject.id !== project.id) return;
      this.setModel(model);
      this.ui.loaderState.classList.add('is-hidden');
    } catch (error) {
      this.ui.loaderState.textContent = '3D unavailable';
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
    this.model.rotation.y = -0.25;
    this.scene.add(this.model);
    this.controls.reset();
    this.needsRender = true;
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    if (document.hidden) return;

    const delta = Math.min(this.clock.getDelta(), 0.033);
    this.pointer.lerp(this.targetPointer, 0.08);
    this.controls.update();

    if (this.model) {
      this.model.rotation.y += delta * 0.22;
      this.model.rotation.x = THREE.MathUtils.lerp(this.model.rotation.x, this.pointer.y * 0.12, 0.08);
      this.model.rotation.z = THREE.MathUtils.lerp(this.model.rotation.z, -this.pointer.x * 0.08, 0.08);
      this.model.position.x = THREE.MathUtils.lerp(this.model.position.x, this.pointer.x * 0.16, 0.08);
      this.needsRender = true;
    }

    if (this.needsRender) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
  }
}
