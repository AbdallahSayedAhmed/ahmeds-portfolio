import './styles.css';

const projects = [
  {
    id: 'stand',
    index: '01',
    title: 'Compact Display Stand',
    type: 'Retail Display',
    model: '/models/3d/stand.glb',
    image: '/images/thumbnails/display-stand-primary.webp',
    sizeMb: 0.6,
    fast: true,
  },
  {
    id: 'gate',
    index: '02',
    title: 'Modern Exhibition Gate Stand',
    type: 'Exhibition Gateway',
    model: '/models/3d/Gate.glb',
    image: '/images/thumbnails/exhibition-gate.webp',
    sizeMb: 0.7,
    fast: true,
  },
  {
    id: 'dd',
    index: '03',
    title: 'Display Unit DD',
    type: 'Product Counter',
    model: '/models/3d/dd.glb',
    image: '/images/thumbnails/display-unit-dd.webp',
    sizeMb: 2.3,
    fast: true,
  },
  {
    id: 'trophy',
    index: '04',
    title: 'Trophy & Award Podium',
    type: 'Award Display',
    model: '/models/3d/trophy.glb',
    image: '/images/thumbnails/brand-trophy.webp',
    sizeMb: 3,
    fast: true,
  },
  {
    id: 'podium',
    index: '05',
    title: 'Customer Interaction Podium',
    type: 'Brand Activation',
    model: '/models/3d/Poduom.glb',
    image: '/images/thumbnails/brand-podium.webp',
    sizeMb: 7.5,
    fast: true,
  },
  {
    id: 'was17',
    index: '06',
    title: 'WAS Series Exhibition Booth',
    type: '3D Booth System',
    model: '/models/3d/was17.glb',
    image: '/images/thumbnails/was-series-17.webp',
    sizeMb: 5.8,
    fast: true,
  },
  {
    id: 'bank',
    index: '07',
    title: 'Housing Bank Exhibition Stand',
    type: 'Large Booth Build',
    model: '/models/3d/bank.glb',
    image: '/images/thumbnails/housing-bank-booth.webp',
    sizeMb: 25,
    fast: false,
  },
  {
    id: 'floor',
    index: '08',
    title: 'Full Floor Plan Layout',
    type: 'Large Venue Plan',
    model: '/models/3d/plan-1.glb',
    image: '/images/thumbnails/floor-plan-layout.webp',
    sizeMb: 290,
    fast: false,
  },
];

const collageImages = [
  '/images/thumbnails/housing-bank-booth.webp',
  '/images/thumbnails/exhibition-booth-14.webp',
  '/images/thumbnails/registration-gate.webp',
  '/images/thumbnails/on-ground-showcase.webp',
  '/images/on-ground/IMG20250325042304.webp',
  '/images/on-ground/IMG20240523152015.webp',
  '/images/on-ground/IMG20250928155518.webp',
  '/images/3d/Booth14.png',
  '/images/3d/Gate.png',
];

const app = document.querySelector('#app');

app.innerHTML = `
  <header class="site-header" aria-label="Primary navigation">
    <a class="brand" href="#top" aria-label="Ahmed Basha Mahmoud home">ABM</a>
    <nav>
      <a href="#work">Work</a>
      <a href="#process">Process</a>
      <a href="#contact">Contact</a>
    </nav>
  </header>

  <main id="top">
    <section class="hero section-shell" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="eyebrow">Senior Graphic Designer & 3D Designer</p>
        <h1 id="hero-title">Ahmed Basha Mahmoud</h1>
        <p class="hero-punch">Not your average designer.</p>
        <p class="morph-line">Built for <span id="morphWord">3D Artist</span></p>
      </div>
      <div class="hero-strip" aria-hidden="true">
        <span>Exhibition Branding</span>
        <span>Display Stands</span>
        <span>Production</span>
        <span>Installation</span>
      </div>
    </section>

    <section id="work" class="showcase section-shell" aria-labelledby="work-title">
      <div class="section-intro">
        <p class="eyebrow">Interactive 3D Work</p>
        <h2 id="work-title">Hover the titles. Rotate and zoom the model.</h2>
      </div>
      <div class="showcase-grid">
        <div class="project-list" role="list">
          ${projects
            .map(
              (project, i) => `
                <button class="project-row ${i === 0 ? 'is-active' : ''}" data-project="${project.id}" role="listitem">
                  <span class="project-index">${project.index}</span>
                  <span class="project-main">
                    <strong>${project.title}</strong>
                    <small>${project.type} / ${project.sizeMb}MB ${project.fast ? 'fast GLB' : 'manual HD load'}</small>
                  </span>
                </button>
              `,
            )
            .join('')}
        </div>

        <aside class="viewer-panel" aria-label="Interactive 3D model viewer">
          <div class="viewer-meta">
            <div>
              <p class="eyebrow">Live WebGL</p>
              <h3 id="activeTitle">${projects[0].title}</h3>
            </div>
            <button id="loadHdButton" class="ghost-button" type="button" hidden>Load full 3D</button>
          </div>
          <div class="canvas-wrap">
            <canvas id="modelCanvas" aria-label="3D portfolio model"></canvas>
            <img id="modelPoster" alt="" src="${projects[0].image}" />
            <div id="loaderState" class="loader-state">Loading 3D</div>
          </div>
          <div class="viewer-controls" aria-label="3D controls">
            <span>Drag rotate</span>
            <span>Wheel zoom</span>
            <span>Shift drag pan</span>
          </div>
        </aside>
      </div>
    </section>

    <section id="process" class="collage section-shell" aria-labelledby="process-title">
      <div class="section-intro inverted">
        <p class="eyebrow">Built On Ground</p>
        <h2 id="process-title">Concept, booth, print, production, installation.</h2>
      </div>
      <div class="collage-grid">
        ${collageImages
          .map(
            (src, i) => `
              <figure class="collage-item depth-${(i % 3) + 1}">
                <img src="${src}" alt="Ahmed Basha project visual ${i + 1}" loading="${i < 3 ? 'eager' : 'lazy'}" decoding="async" />
              </figure>
            `,
          )
          .join('')}
      </div>
    </section>

    <section id="contact" class="cta section-shell" aria-labelledby="contact-title">
      <div class="section-intro">
        <p class="eyebrow">Direct Inquiry</p>
        <h2 id="contact-title">Let's build your next exhibition moment.</h2>
      </div>
      <div class="card-stage">
        ${['Brands', 'Studios', 'Creators', 'Exhibition Management']
          .map(
            (label, i) => `
              <a class="drop-card" style="--i:${i}" href="mailto:hello@example.com?subject=Portfolio%20Inquiry%20for%20Ahmed%20Basha">
                <span>${String(i + 1).padStart(2, '0')}</span>
                <strong>${label}</strong>
              </a>
            `,
          )
          .join('')}
      </div>
    </section>
  </main>
`;

const morphWords = ['3D Artist', '2D Animator', 'Visual Designer', 'Exhibition Lead'];
const morphWord = document.querySelector('#morphWord');
let morphIndex = 0;
setInterval(() => {
  morphIndex = (morphIndex + 1) % morphWords.length;
  morphWord.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], {
    duration: 360,
    easing: 'cubic-bezier(.2,.8,.2,1)',
  });
  morphWord.textContent = morphWords[morphIndex];
}, 1600);

const activeTitle = document.querySelector('#activeTitle');
const modelPoster = document.querySelector('#modelPoster');
const loaderState = document.querySelector('#loaderState');
const loadHdButton = document.querySelector('#loadHdButton');
let viewer;

async function getViewer() {
  if (viewer) return viewer;
  const { FastModelViewer } = await import('./model-viewer.js');
  viewer = new FastModelViewer(document.querySelector('#modelCanvas'), projects, {
    activeTitle,
    modelPoster,
    loaderState,
    loadHdButton,
  });
  return viewer;
}

const viewerReady = getViewer();

document.querySelectorAll('.project-row').forEach((button) => {
  const activate = () => {
    const project = projects.find((item) => item.id === button.dataset.project);
    if (!project || viewer?.activeProject.id === project.id) return;
    document.querySelectorAll('.project-row').forEach((row) => row.classList.toggle('is-active', row === button));
    getViewer().then((instance) => instance.loadProject(project));
  };
  button.addEventListener('pointerenter', activate, { passive: true });
  button.addEventListener('focus', activate);
  button.addEventListener('click', activate);
});

loadHdButton.addEventListener('click', () => {
  const project = projects.find((item) => item.id === loadHdButton.dataset.project);
  if (project) getViewer().then((instance) => instance.loadProject(project, true));
});

const collageItems = [...document.querySelectorAll('.collage-item')];
let ticking = false;
function updateParallax() {
  ticking = false;
  const viewportH = window.innerHeight || 1;
  collageItems.forEach((item) => {
    const rect = item.getBoundingClientRect();
    const progress = (rect.top - viewportH) / (viewportH + rect.height);
    const depth = item.classList.contains('depth-1') ? 24 : item.classList.contains('depth-2') ? -36 : 52;
    item.style.transform = `translate3d(0, ${progress * depth}px, 0) rotate(${progress * 2}deg)`;
  });
}
window.addEventListener(
  'scroll',
  () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateParallax);
    }
  },
  { passive: true },
);
updateParallax();

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      entry.target.classList.toggle('is-visible', entry.isIntersecting);
    });
  },
  { threshold: 0.25 },
);
document.querySelectorAll('.drop-card, .section-intro').forEach((item) => observer.observe(item));
