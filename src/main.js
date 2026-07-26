import './styles.css';
import content from './content.json';

const { projects, collageImages } = content;

const PAGE_SIZE = 8;
const TOTAL_PAGES = Math.ceil(projects.length / PAGE_SIZE);
const COLLAGE_PAGE_SIZE = 9;
const TOTAL_COLLAGE_PAGES = Math.ceil(collageImages.length / COLLAGE_PAGE_SIZE);
let currentPage = 0;
let currentCollagePage = 0;

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
      <div class="collage-grid" id="collageGrid"></div>
      <div class="pagination collage-pagination" aria-label="On-ground image pages">
        <button class="page-arrow" id="prevCollagePage" type="button" aria-label="Previous image page">&larr;</button>
        <span class="page-label" id="collagePageLabel"></span>
        <button class="page-arrow" id="nextCollagePage" type="button" aria-label="Next image page">&rarr;</button>
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
const processSection = document.querySelector('#process');
const collageGrid = document.querySelector('#collageGrid');
const prevCollagePageBtn = document.querySelector('#prevCollagePage');
const nextCollagePageBtn = document.querySelector('#nextCollagePage');
const collagePageLabel = document.querySelector('#collagePageLabel');
let viewer;
let collageItems = [];

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

function renderCollagePage(page, shouldScroll = false) {
  currentCollagePage = Math.min(Math.max(page, 0), TOTAL_COLLAGE_PAGES - 1);
  const start = currentCollagePage * COLLAGE_PAGE_SIZE;
  const pageImages = collageImages.slice(start, start + COLLAGE_PAGE_SIZE);

  collageGrid.innerHTML = pageImages
    .map(
      (src, imageIndex) => `
        <figure class="collage-item depth-${(imageIndex % 3) + 1}">
          <img src="${src}" alt="Ahmed Basha project visual ${start + imageIndex + 1}" loading="${imageIndex < 3 ? 'eager' : 'lazy'}" decoding="async" />
        </figure>
      `,
    )
    .join('');

  collageItems = [...collageGrid.querySelectorAll('.collage-item')];
  collagePageLabel.textContent = `Page ${currentCollagePage + 1} of ${TOTAL_COLLAGE_PAGES}`;
  prevCollagePageBtn.disabled = currentCollagePage === 0;
  nextCollagePageBtn.disabled = currentCollagePage === TOTAL_COLLAGE_PAGES - 1;
  updateParallax();

  if (shouldScroll) {
    processSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

prevCollagePageBtn.addEventListener('click', () => renderCollagePage(currentCollagePage - 1, true));
nextCollagePageBtn.addEventListener('click', () => renderCollagePage(currentCollagePage + 1, true));

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
renderCollagePage(0);

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      entry.target.classList.toggle('is-visible', entry.isIntersecting);
    });
  },
  { threshold: 0.25 },
);
document.querySelectorAll('.drop-card, .section-intro').forEach((item) => observer.observe(item));
