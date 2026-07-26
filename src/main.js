import './styles.css';

// Every project below maps to a real .glb in /assets/models/3d.
// `fast` = safe to auto-preload in the background. Every model still loads
// directly on click; this only controls quiet preloading for nearby rows.
const projects = [
  {
    id: 'stand',
    index: '01',
    title: 'Compact Display Stand',
    type: 'Retail Display',
    model: '/models/3d/stand.glb',
    image: '/images/thumbnails/display-stand-primary.webp',
    sizeMb: 0.1,
    fast: true,
    rotationY: 0,
  },
  {
    id: 'gate',
    index: '02',
    title: 'Modern Exhibition Gate Stand',
    type: 'Exhibition Gateway',
    model: '/models/3d/Gate.glb',
    image: '/images/thumbnails/exhibition-gate.webp',
    sizeMb: 0.1,
    fast: true,
    rotationY: 0,
  },
  {
    id: 'dd',
    index: '03',
    title: 'Display Unit DD',
    type: 'Product Counter',
    model: '/models/3d/dd.glb',
    image: '/images/thumbnails/display-unit-dd.webp',
    sizeMb: 0.3,
    fast: true,
    rotationY: 0,
  },
  {
    id: 'trophy',
    index: '04',
    title: 'Trophy & Award Podium',
    type: 'Award Display',
    model: '/models/3d/trophy.glb',
    image: '/images/thumbnails/brand-trophy.webp',
    sizeMb: 0.2,
    fast: true,
    rotationY: 0,
  },
  {
    id: 'was17',
    index: '05',
    title: 'WAS Series Booth 17',
    type: '3D Booth System',
    model: '/models/3d/was17.glb',
    image: '/images/thumbnails/was-series-17.webp',
    sizeMb: 1.8,
    fast: true,
    rotationY: 0,
  },
  {
    id: 'was15',
    index: '06',
    title: 'WAS Series Booth 15',
    type: '3D Booth System',
    model: '/models/3d/was15.glb',
    image: '/images/thumbnails/was-series-15.webp',
    sizeMb: 0.2,
    fast: true,
    rotationY: 0,
  },
  {
    id: 'podium',
    index: '07',
    title: 'Customer Interaction Podium',
    type: 'Brand Activation',
    model: '/models/3d/Poduom.glb',
    image: '/images/thumbnails/brand-podium.webp',
    sizeMb: 0.3,
    fast: true,
    rotationY: 0,
  },
  {
    id: 'bank',
    index: '08',
    title: 'Housing Bank Exhibition Stand',
    type: 'Large Booth Build',
    model: '/models/3d/bank.glb',
    image: '/images/thumbnails/housing-bank-booth.webp',
    sizeMb: 6.2,
    fast: false,
    rotationY: 0,
  },
  {
    id: 'booth',
    index: '09',
    title: 'Exhibition Counter Unit',
    type: 'Product Counter',
    model: '/models/3d/Booth.glb',
    image: '/images/thumbnails/housing-bank-counter.webp',
    sizeMb: 1,
    fast: false,
    rotationY: 0,
  },
  {
    id: 'stande',
    index: '10',
    title: 'Extended Display Stand',
    type: 'Retail Display',
    model: '/models/3d/stande.glb',
    image: '/images/thumbnails/display-stand-extended.webp',
    sizeMb: 0.3,
    fast: false,
    rotationY: 0,
  },
  {
    id: 'booth11',
    index: '11',
    title: 'Exhibition Booth 11',
    type: '3D Booth System',
    model: '/models/3d/Booth11.glb',
    image: '/images/thumbnails/exhibition-booth-11.webp',
    sizeMb: 3.6,
    fast: false,
    rotationY: 0,
  },
  {
    id: 'was16',
    index: '12',
    title: 'WAS Series Booth 16',
    type: '3D Booth System',
    model: '/models/3d/was16.glb',
    image: '/images/thumbnails/was-series-16.webp',
    sizeMb: 2.7,
    fast: false,
    rotationY: 0,
  },
  {
    id: 'was14',
    index: '13',
    title: 'WAS Series Booth 14',
    type: '3D Booth System',
    model: '/models/3d/was14.glb',
    image: '/images/thumbnails/was-series-14.webp',
    sizeMb: 4.5,
    fast: false,
    rotationY: 0,
  },
  {
    id: 'registration',
    index: '14',
    title: 'Registration Gate Stand',
    type: 'Entry Gateway',
    model: '/models/3d/Registration.glb',
    image: '/images/thumbnails/registration-gate.webp',
    sizeMb: 4,
    fast: false,
    rotationY: 0,
  },
  {
    id: 'booth12',
    index: '15',
    title: 'Exhibition Booth 12',
    type: '3D Booth System',
    model: '/models/3d/Booth12.glb',
    image: '/images/thumbnails/exhibition-booth-12.webp',
    sizeMb: 4.3,
    fast: false,
    rotationY: 0,
  },
  {
    id: 'booth14',
    index: '16',
    title: 'Exhibition Booth 14',
    type: '3D Booth System',
    model: '/models/3d/Booth14.glb',
    image: '/images/thumbnails/exhibition-booth-14.webp',
    sizeMb: 4.9,
    fast: false,
    rotationY: 0,
  },
  {
    id: 'booth13',
    index: '17',
    title: 'Exhibition Booth 13',
    type: '3D Booth System',
    model: '/models/3d/Booth13.glb',
    image: '/images/thumbnails/exhibition-booth-13.webp',
    sizeMb: 8.1,
    fast: false,
    rotationY: 0,
  },
  {
    id: 'bank2',
    index: '18',
    title: 'Housing Bank Booth V2',
    type: 'Large Booth Build',
    model: '/models/3d/Bank2.glb',
    image: '/images/thumbnails/bank-booth-v2.webp',
    sizeMb: 6.8,
    fast: false,
    rotationY: 0,
  },
  {
    id: 'concept3',
    index: '19',
    title: 'Exhibition Concept 03',
    type: 'Concept Design',
    model: '/models/3d/3.glb',
    image: '/images/thumbnails/exhibition-concept-3.webp',
    sizeMb: 9.6,
    fast: false,
    rotationY: 0,
  },
  {
    id: 'floor',
    index: '20',
    title: 'Full Floor Plan Layout',
    type: 'Large Venue Plan',
    model: '/models/3d/plan-1.glb',
    image: '/images/thumbnails/floor-plan-layout.webp',
    sizeMb: 24.6,
    fast: false,
    rotationY: 0,
  },
];

// Small, already-optimized webp thumbnails only -- never raw /images/3d/*.png
// (those source renders run 5-60MB each and previously loaded straight into
// the collage, which was the main cause of slow image loading on the site).
const collageImages = [
  '/images/thumbnails/housing-bank-booth.webp',
  '/images/thumbnails/exhibition-booth-14.webp',
  '/images/thumbnails/registration-gate.webp',
  '/images/thumbnails/on-ground-showcase.webp',
  '/images/on-ground/IMG20250325042304.webp',
  '/images/on-ground/IMG20240523152015.webp',
  '/images/on-ground/IMG20250928155518.webp',
  '/images/thumbnails/exhibition-booth-11.webp',
  '/images/thumbnails/exhibition-gate.webp',
];

const PAGE_SIZE = 8;
const TOTAL_PAGES = Math.ceil(projects.length / PAGE_SIZE);
let currentPage = 0;

const app = document.querySelector('#app');

app.innerHTML = `
  <header class="site-header" aria-label="Primary navigation">
    <a class="brand" href="#top" aria-label="Ahmed Basha home">ABM</a>
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
        <h1 id="hero-title">Ahmed Basha</h1>
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
        <p class="eyebrow">Interactive 3D Work &middot; ${projects.length} Models</p>
        <h2 id="work-title">Click a title. Rotate and zoom the model.</h2>
      </div>
      <div class="showcase-grid" id="showcaseGrid">
        <div class="project-list-wrap">
          <div class="project-list" id="projectList" role="list"></div>
          <div class="pagination" aria-label="Project pages">
            <button class="page-arrow" id="prevPage" type="button" aria-label="Previous page">&larr;</button>
            <span class="page-label" id="pageLabel"></span>
            <button class="page-arrow" id="nextPage" type="button" aria-label="Next page">&rarr;</button>
          </div>
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

const showcaseGrid = document.querySelector('#showcaseGrid');
const projectListEl = document.querySelector('#projectList');
const prevPageBtn = document.querySelector('#prevPage');
const nextPageBtn = document.querySelector('#nextPage');
const pageLabel = document.querySelector('#pageLabel');
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

function renderProjectRow(project) {
  const activeId = showcaseGrid.classList.contains('is-open') && viewer ? viewer.activeProject.id : null;
  return `
    <button class="project-row ${project.id === activeId ? 'is-active' : ''}" data-project="${project.id}" role="listitem">
      <span class="project-index">${project.index}</span>
      <span class="project-main">
        <strong>${project.title}</strong>
        <small>${project.type} / ${project.sizeMb}MB optimized GLB</small>
      </span>
    </button>
  `;
}

function renderPage(page) {
  currentPage = Math.min(Math.max(page, 0), TOTAL_PAGES - 1);
  const start = currentPage * PAGE_SIZE;
  const pageItems = projects.slice(start, start + PAGE_SIZE);

  projectListEl.innerHTML = pageItems.map(renderProjectRow).join('');
  pageLabel.textContent = `Page ${currentPage + 1} of ${TOTAL_PAGES}`;
  prevPageBtn.disabled = currentPage === 0;
  nextPageBtn.disabled = currentPage === TOTAL_PAGES - 1;

  // Only warm the cache for models that are actually visible on this page.
  viewerReady.then((instance) => instance.setPreloadPool(pageItems));
}

function foldViewer() {
  showcaseGrid.classList.remove('is-open');
  projectListEl.querySelectorAll('.project-row').forEach((row) => row.classList.remove('is-active'));
}

function activateRow(row) {
  if (!row) return;
  const project = projects.find((item) => item.id === row.dataset.project);
  if (!project) return;

  projectListEl.querySelectorAll('.project-row').forEach((r) => r.classList.toggle('is-active', r === row));
  showcaseGrid.classList.add('is-open');

  if (!viewer || viewer.activeProject.id !== project.id) {
    getViewer().then((instance) => instance.loadProject(project));
  }
}

projectListEl.addEventListener('click', (event) => activateRow(event.target.closest('.project-row')));

document.addEventListener('click', (event) => {
  if (!showcaseGrid.classList.contains('is-open')) return;
  if (event.target.closest('.project-row') || event.target.closest('.viewer-panel')) return;
  foldViewer();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') foldViewer();
});

prevPageBtn.addEventListener('click', () => renderPage(currentPage - 1));
nextPageBtn.addEventListener('click', () => renderPage(currentPage + 1));

renderPage(0);

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
