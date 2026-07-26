import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import Busboy from 'busboy';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const contentPath = path.join(projectRoot, 'src', 'content.json');
const modelsDir = path.join(projectRoot, 'assets', 'models', '3d');
const thumbnailsDir = path.join(projectRoot, 'assets', 'images', 'thumbnails');
const galleryDir = path.join(projectRoot, 'assets', 'images', 'on-ground');
const uploadDir = path.join(projectRoot, '.dashboard-uploads');
const modelBackupDir = path.join(projectRoot, 'originals-backup', 'dashboard-model-uploads');
const imageBackupDir = path.join(projectRoot, 'originals-backup', 'dashboard-image-uploads');
const gltfCliPath = path.join(projectRoot, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');
const fixTexturesScript = path.join(projectRoot, 'scripts', 'fix-oversized-textures.cjs');
const host = '127.0.0.1';
const port = Number(process.env.PORT || 4174);

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendHtml(res, html) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: projectRoot, maxBuffer: 1024 * 1024 * 64 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function formatMb(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function slugify(value, fallback = 'asset') {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54);
  return slug || `${fallback}-${Date.now()}`;
}

async function uniquePath(dir, baseSlug, ext) {
  let slug = baseSlug;
  let index = 1;
  let filePath = path.join(dir, `${slug}${ext}`);
  while (fsSync.existsSync(filePath)) {
    index += 1;
    slug = `${baseSlug}-${index}`;
    filePath = path.join(dir, `${slug}${ext}`);
  }
  return { slug, filePath };
}

async function ensureDirs() {
  await Promise.all([
    fs.mkdir(modelsDir, { recursive: true }),
    fs.mkdir(thumbnailsDir, { recursive: true }),
    fs.mkdir(galleryDir, { recursive: true }),
    fs.mkdir(uploadDir, { recursive: true }),
    fs.mkdir(modelBackupDir, { recursive: true }),
    fs.mkdir(imageBackupDir, { recursive: true }),
  ]);
}

async function readContent() {
  const raw = await fs.readFile(contentPath, 'utf8');
  const content = JSON.parse(raw);
  content.projects ||= [];
  content.collageImages ||= [];
  return content;
}

async function writeContent(content) {
  content.projects = content.projects.map((project, index) => ({
    ...project,
    index: String(index + 1).padStart(2, '0'),
  }));
  content.collageImages = [...new Set(content.collageImages)].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  await fs.writeFile(contentPath, `${JSON.stringify(content, null, 2)}\n`);
}

async function scanGalleryImages() {
  const files = await fs.readdir(galleryDir);
  return files
    .filter((name) => /\.(webp|jpe?g|png)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => `/images/on-ground/${name}`);
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: 1024 * 1024 * 900 } });
    const fields = {};
    const files = {};
    const writes = [];

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('file', (name, file, info) => {
      if (!info.filename) {
        file.resume();
        return;
      }
      const ext = path.extname(info.filename) || '.upload';
      const tempPath = path.join(uploadDir, `${randomUUID()}${ext}`);
      const output = fsSync.createWriteStream(tempPath);
      let size = 0;

      file.on('data', (chunk) => {
        size += chunk.length;
      });
      file.pipe(output);

      writes.push(
        new Promise((fileResolve, fileReject) => {
          output.on('finish', () => {
            files[name] = { tempPath, filename: info.filename, mimeType: info.mimeType, size };
            fileResolve();
          });
          output.on('error', fileReject);
          file.on('error', fileReject);
        }),
      );
    });

    busboy.on('error', reject);
    busboy.on('close', async () => {
      try {
        await Promise.all(writes);
        resolve({ fields, files });
      } catch (error) {
        reject(error);
      }
    });

    req.pipe(busboy);
  });
}

async function optimizeModel(inputPath, outputPath) {
  const tempOutput = outputPath.replace(/\.glb$/i, `.${randomUUID()}.optimized.glb`);
  const fixedInput = inputPath.replace(/\.glb$/i, `.${randomUUID()}.textures-fixed.glb`);
  const optimizeArgs = ['optimize', inputPath, tempOutput, '--compress', 'draco', '--texture-compress', 'webp'];

  try {
    await run(process.execPath, [gltfCliPath, ...optimizeArgs]);
  } catch (firstError) {
    await run(process.execPath, [fixTexturesScript, inputPath, fixedInput, '4096']);
    await run(process.execPath, [
      gltfCliPath,
      'optimize',
      fixedInput,
      tempOutput,
      '--compress',
      'draco',
      '--texture-compress',
      'webp',
    ]);
  } finally {
    await fs.rm(fixedInput, { force: true });
  }

  const stat = await fs.stat(tempOutput);
  if (!stat.size) throw new Error('Compressed model output is empty.');
  await fs.rename(tempOutput, outputPath);
  return stat.size;
}

async function compressImage(inputPath, outputPath, { maxDim, quality }) {
  await sharp(inputPath, { limitInputPixels: false })
    .rotate()
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toFile(outputPath);
  return (await fs.stat(outputPath)).size;
}

async function handleAddProject(req, res) {
  const { fields, files } = await parseMultipart(req);
  const title = fields.title?.trim();
  const type = fields.type?.trim() || '3D Booth System';
  const modelFile = files.model;
  const imageFile = files.image;

  if (!title) throw new Error('Title is required.');
  if (!modelFile || path.extname(modelFile.filename).toLowerCase() !== '.glb') {
    throw new Error('Please upload a .glb model file.');
  }

  const { slug, filePath: modelPath } = await uniquePath(modelsDir, slugify(title, 'model'), '.glb');
  const thumbnailPath = path.join(thumbnailsDir, `${slug}.webp`);
  const originalBackup = path.join(modelBackupDir, `${slug}.original.glb`);

  await fs.copyFile(modelFile.tempPath, originalBackup);
  const compressedModelSize = await optimizeModel(modelFile.tempPath, modelPath);

  if (imageFile) {
    await fs.copyFile(imageFile.tempPath, path.join(imageBackupDir, `${slug}${path.extname(imageFile.filename)}`));
    await compressImage(imageFile.tempPath, thumbnailPath, { maxDim: 1600, quality: 76 });
  }

  const content = await readContent();
  content.projects.push({
    id: slug,
    index: String(content.projects.length + 1).padStart(2, '0'),
    title,
    type,
    model: `/models/3d/${slug}.glb`,
    image: imageFile ? `/images/thumbnails/${slug}.webp` : '/images/thumbnails/placeholder.webp',
    sizeMb: formatMb(compressedModelSize),
    fast: compressedModelSize <= 8 * 1024 * 1024,
    rotationY: 0,
  });
  await writeContent(content);
  await cleanupUploads(files);

  sendJson(res, 200, {
    ok: true,
    message: `Added "${title}" and compressed model to ${formatMb(compressedModelSize)}MB.`,
    projectCount: content.projects.length,
  });
}

async function handleAddGalleryImage(req, res) {
  const { fields, files } = await parseMultipart(req);
  const imageFile = files.image;
  if (!imageFile) throw new Error('Please upload an image.');

  const base = slugify(fields.title || path.basename(imageFile.filename, path.extname(imageFile.filename)), 'image');
  const { slug, filePath } = await uniquePath(galleryDir, base, '.webp');
  await fs.copyFile(imageFile.tempPath, path.join(imageBackupDir, `${slug}${path.extname(imageFile.filename)}`));
  const imageSize = await compressImage(imageFile.tempPath, filePath, { maxDim: 1920, quality: 75 });

  const content = await readContent();
  content.collageImages.push(`/images/on-ground/${slug}.webp`);
  await writeContent(content);
  await cleanupUploads(files);

  sendJson(res, 200, {
    ok: true,
    message: `Added gallery image "${slug}.webp" (${formatMb(imageSize)}MB).`,
    imageCount: content.collageImages.length,
  });
}

async function handleSyncGallery(_req, res) {
  const content = await readContent();
  content.collageImages = await scanGalleryImages();
  await writeContent(content);
  sendJson(res, 200, {
    ok: true,
    message: `Synced ${content.collageImages.length} gallery images from assets/images/on-ground.`,
    imageCount: content.collageImages.length,
  });
}

async function cleanupUploads(files) {
  await Promise.all(
    Object.values(files).map((file) => fs.rm(file.tempPath, { force: true }).catch(() => {})),
  );
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ahmed Portfolio Dashboard</title>
    <style>
      :root { font-family: Inter, Arial, sans-serif; color: #000; background: #f4f4f1; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 28px; }
      main { max-width: 1120px; margin: auto; display: grid; gap: 18px; }
      header, section { background: #fff; border: 2px solid #000; padding: 18px; box-shadow: 6px 6px 0 #000; }
      h1, h2, p { margin-top: 0; }
      h1 { font-size: clamp(30px, 5vw, 64px); line-height: .9; text-transform: uppercase; }
      h2 { font-size: 22px; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
      label { display: grid; gap: 8px; font-weight: 900; margin-bottom: 12px; }
      input, button { border: 2px solid #000; padding: 12px; font: inherit; font-weight: 800; background: #fff; }
      button { cursor: pointer; background: #000; color: #fff; text-transform: uppercase; }
      button:disabled { opacity: .45; cursor: wait; }
      small { color: #333; font-weight: 700; }
      .status { min-height: 44px; border: 2px dashed #000; padding: 12px; background: #fafafa; white-space: pre-wrap; direction: ltr; text-align: left; }
      .counts { display: flex; gap: 10px; flex-wrap: wrap; }
      .pill { border: 2px solid #000; padding: 8px 10px; font-weight: 950; background: #f4f4f1; }
      @media (max-width: 820px) { body { padding: 14px; } .grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Portfolio Dashboard</h1>
        <p>ارفع موديلات GLB وصور بسهولة. الداشبورد بيضغط الموديل بـ Draco/WebP، وبيحوّل الصور لـ WebP، وبيحدّث بيانات الموقع تلقائيًا.</p>
        <div class="counts">
          <span class="pill" id="projectCount">Models: …</span>
          <span class="pill" id="imageCount">Images: …</span>
        </div>
      </header>

      <div class="grid">
        <section>
          <h2>إضافة مشروع 3D</h2>
          <form id="projectForm">
            <label>عنوان المشروع <input name="title" required placeholder="Exhibition Booth 21" /></label>
            <label>نوع المشروع <input name="type" placeholder="3D Booth System" /></label>
            <label>صورة للمشروع <input name="image" type="file" accept="image/*" /></label>
            <label>موديل GLB <input name="model" type="file" accept=".glb,model/gltf-binary" required /></label>
            <small>لو الموديل فيه texture ضخمة، السكربت هيقللها قبل الضغط تلقائيًا.</small>
            <button type="submit">Add 3D Project</button>
          </form>
        </section>

        <section>
          <h2>إضافة صورة للمعرض</h2>
          <form id="imageForm">
            <label>اسم اختياري <input name="title" placeholder="Bank branch opening" /></label>
            <label>الصورة <input name="image" type="file" accept="image/*" required /></label>
            <small>الصورة هتتصغر بحد أقصى 1920px وتتحول WebP قبل إضافتها للصفحات.</small>
            <button type="submit">Add Gallery Image</button>
          </form>
        </section>
      </div>

      <section>
        <h2>صيانة سريعة</h2>
        <p>لو ضفت صور يدويًا في <code>assets/images/on-ground</code>، دوس Sync عشان تظهر في صفحات المعرض.</p>
        <button id="syncGallery" type="button">Sync Gallery From Folder</button>
      </section>

      <section>
        <h2>الحالة</h2>
        <div class="status" id="status">جاهز.</div>
      </section>
    </main>

    <script>
      const statusEl = document.querySelector('#status');
      const projectCount = document.querySelector('#projectCount');
      const imageCount = document.querySelector('#imageCount');

      async function refreshCounts() {
        const res = await fetch('/api/content');
        const data = await res.json();
        projectCount.textContent = 'Models: ' + data.projects.length;
        imageCount.textContent = 'Images: ' + data.collageImages.length;
      }

      async function submitForm(form, url, busyText) {
        const button = form.querySelector('button');
        button.disabled = true;
        statusEl.textContent = busyText;
        try {
          const res = await fetch(url, { method: 'POST', body: new FormData(form) });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Request failed');
          statusEl.textContent = data.message;
          form.reset();
          await refreshCounts();
        } catch (error) {
          statusEl.textContent = 'ERROR: ' + error.message;
        } finally {
          button.disabled = false;
        }
      }

      document.querySelector('#projectForm').addEventListener('submit', (event) => {
        event.preventDefault();
        submitForm(event.currentTarget, '/api/project', 'جاري رفع وضغط الموديل… الملفات الكبيرة ممكن تاخد شوية.');
      });

      document.querySelector('#imageForm').addEventListener('submit', (event) => {
        event.preventDefault();
        submitForm(event.currentTarget, '/api/gallery-image', 'جاري ضغط الصورة وتحويلها WebP…');
      });

      document.querySelector('#syncGallery').addEventListener('click', async (event) => {
        event.currentTarget.disabled = true;
        statusEl.textContent = 'Syncing gallery…';
        try {
          const res = await fetch('/api/sync-gallery', { method: 'POST' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Request failed');
          statusEl.textContent = data.message;
          await refreshCounts();
        } catch (error) {
          statusEl.textContent = 'ERROR: ' + error.message;
        } finally {
          event.currentTarget.disabled = false;
        }
      });

      refreshCounts();
    </script>
  </body>
</html>`;
}

async function route(req, res) {
  try {
    await ensureDirs();
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
      sendHtml(res, dashboardHtml());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/content') {
      sendJson(res, 200, await readContent());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/project') {
      await handleAddProject(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/gallery-image') {
      await handleAddGalleryImage(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/sync-gallery') {
      await handleSyncGallery(req, res);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found.' });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message, details: error.stderr || error.stdout || undefined });
  }
}

http.createServer(route).listen(port, host, () => {
  console.log(`Dashboard: http://${host}:${port}/dashboard`);
});
