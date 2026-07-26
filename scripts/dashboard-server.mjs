import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import Busboy from 'busboy';
import sharp from 'sharp';
import nodemailer from 'nodemailer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function loadLocalEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (!fsSync.existsSync(envPath)) return;
  const lines = fsSync.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex < 1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

loadLocalEnv();

const assetsDir = path.join(projectRoot, 'assets');
const nodeModulesDir = path.join(projectRoot, 'node_modules');
const contentPath = path.join(projectRoot, 'src', 'content.json');
const modelsDir = path.join(assetsDir, 'models', '3d');
const thumbnailsDir = path.join(assetsDir, 'images', 'thumbnails');
const galleryDir = path.join(assetsDir, 'images', 'on-ground');
const uploadDir = path.join(projectRoot, '.dashboard-uploads');
const modelBackupDir = path.join(projectRoot, 'originals-backup', 'dashboard-model-uploads');
const imageBackupDir = path.join(projectRoot, 'originals-backup', 'dashboard-image-uploads');
const gltfCliPath = path.join(projectRoot, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');
const fixTexturesScript = path.join(projectRoot, 'scripts', 'fix-oversized-textures.cjs');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4174);
const isProduction = process.env.NODE_ENV === 'production' || process.env.DASHBOARD_PUBLIC === 'true';
const trustProxy = process.env.TRUST_PROXY === 'true';
const secureCookie = isProduction || process.env.DASHBOARD_SECURE_COOKIE === 'true';
const dashboardPassword = process.env.DASHBOARD_PASSWORD || '';
const passwordLoginEnabled = Boolean(dashboardPassword);
const dashboardSecret = process.env.DASHBOARD_SECRET || `dashboard:${dashboardPassword || randomUUID()}`;
const authCookieName = 'abm_dashboard_auth';
const sessionMaxAgeSeconds = 60 * 60 * 24 * 30;
const dashboardResetEmail = (process.env.DASHBOARD_RESET_EMAIL || 'ahmedbashamahmoud175@gmail.com').toLowerCase();
const resetCodeTtlMs = 10 * 60 * 1000;
const resetCodeMaxAttempts = 5;
const authRateLimitWindowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const authLoginMaxAttempts = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS || 8);
const authRecoveryMaxAttempts = Number(process.env.AUTH_RECOVERY_MAX_ATTEMPTS || 5);
const authCodeMaxAttempts = Number(process.env.AUTH_CODE_MAX_ATTEMPTS || 8);
const rateLimitStore = new Map();
let resetCodeState = null;

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendHtml(res, html, status = 200, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
  res.end(html);
}

function sendRedirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index < 0) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function getClientIp(req) {
  if (trustProxy && req.headers['x-forwarded-for']) {
    return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function rateLimitKey(req, scope) {
  return `${scope}:${getClientIp(req)}`;
}

function checkRateLimit(key, maxAttempts, windowMs = authRateLimitWindowMs) {
  const now = Date.now();
  const existing = rateLimitStore.get(key);
  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(key, { attempts: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  existing.attempts += 1;
  if (existing.attempts <= maxAttempts) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

function clearRateLimit(key) {
  rateLimitStore.delete(key);
}

function sendRateLimited(res, html, retryAfterSeconds) {
  sendHtml(res, html, 429, {
    'retry-after': String(retryAfterSeconds),
    'cache-control': 'no-store',
  });
}

function signToken(value) {
  return createHmac('sha256', dashboardSecret).update(value).digest('hex');
}

function createSessionToken() {
  const value = Buffer.from(
    JSON.stringify({
      id: randomUUID(),
      createdAt: Date.now(),
    }),
  ).toString('base64url');
  return `${value}.${signToken(value)}`;
}

function isValidSession(req) {
  const token = parseCookies(req)[authCookieName];
  if (!token) return false;
  const [value, signature] = token.split('.');
  if (!value || !signature) return false;
  const expected = signToken(value);
  const givenBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (givenBuffer.length !== expectedBuffer.length || !timingSafeEqual(givenBuffer, expectedBuffer)) return false;
  try {
    const session = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return Date.now() - Number(session.createdAt) < sessionMaxAgeSeconds * 1000;
  } catch {
    return false;
  }
}

function setAuthCookie(res) {
  const secureAttribute = secureCookie ? '; Secure' : '';
  res.writeHead(302, {
    location: '/dashboard',
    'set-cookie': `${authCookieName}=${encodeURIComponent(createSessionToken())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionMaxAgeSeconds}${secureAttribute}`,
  });
  res.end();
}

function clearAuthCookie(res) {
  const secureAttribute = secureCookie ? '; Secure' : '';
  res.writeHead(302, {
    location: '/login',
    'set-cookie': `${authCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureAttribute}`,
  });
  res.end();
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

function safeResolve(baseDir, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const resolved = path.resolve(baseDir, decoded.replace(/^\/+/, ''));
  if (!resolved.startsWith(path.resolve(baseDir))) {
    throw new Error('Invalid path.');
  }
  return resolved;
}

function publicUrlToAssetPath(publicUrl) {
  if (!publicUrl || !publicUrl.startsWith('/')) return null;
  return safeResolve(assetsDir, publicUrl);
}

async function getFileSizeMb(publicUrl) {
  const filePath = publicUrlToAssetPath(publicUrl);
  if (!filePath) return null;
  try {
    return formatMb((await fs.stat(filePath)).size);
  } catch {
    return null;
  }
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
  content.archivedCollageImages ||= [];
  return content;
}

async function writeContent(content) {
  content.archivedCollageImages ||= [];
  content.projects = content.projects.map((project, index) => ({
    ...project,
    index: String(index + 1).padStart(2, '0'),
  }));
  const seen = new Set();
  content.collageImages = content.collageImages.filter((image) => {
    if (seen.has(image)) return false;
    seen.add(image);
    return true;
  });
  const archivedSeen = new Set();
  content.archivedCollageImages = content.archivedCollageImages.filter((image) => {
    if (archivedSeen.has(image)) return false;
    archivedSeen.add(image);
    return true;
  });
  await fs.writeFile(contentPath, `${JSON.stringify(content, null, 2)}\n`);
}

async function enrichedContent() {
  const content = await readContent();
  const activeProjects = content.projects.filter((project) => !project.archived);
  const archivedProjects = content.projects.filter((project) => project.archived);
  return {
    projects: await Promise.all(
      activeProjects.map(async (project) => ({
        ...project,
        actualModelSizeMb: await getFileSizeMb(project.model),
        actualImageSizeMb: await getFileSizeMb(project.image),
      })),
    ),
    archivedProjects: await Promise.all(
      archivedProjects.map(async (project) => ({
        ...project,
        actualModelSizeMb: await getFileSizeMb(project.model),
        actualImageSizeMb: await getFileSizeMb(project.image),
      })),
    ),
    collageImages: await Promise.all(
      content.collageImages.map(async (src, index) => ({
        index,
        src,
        sizeMb: await getFileSizeMb(src),
      })),
    ),
    archivedCollageImages: await Promise.all(
      content.archivedCollageImages.map(async (src, index) => ({
        index,
        src,
        sizeMb: await getFileSizeMb(src),
      })),
    ),
  };
}

async function scanGalleryImages() {
  const files = await fs.readdir(galleryDir);
  return files
    .filter((name) => /\.(webp|jpe?g|png)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => `/images/on-ground/${name}`);
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

function parseJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('JSON request is too large.'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

async function parseForm(req) {
  const body = await new Promise((resolve, reject) => {
    let value = '';
    req.on('data', (chunk) => {
      value += chunk;
      if (value.length > 64 * 1024) {
        req.destroy();
        reject(new Error('Form request is too large.'));
      }
    });
    req.on('end', () => resolve(value));
    req.on('error', reject);
  });
  return Object.fromEntries(new URLSearchParams(body));
}

function safeEqualText(a, b) {
  const first = Buffer.from(String(a || ''));
  const second = Buffer.from(String(b || ''));
  return first.length === second.length && timingSafeEqual(first, second);
}

function createResetCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function resetCodeHash(code) {
  return createHmac('sha256', dashboardSecret).update(`reset-code:${code}`).digest('hex');
}

function smtpTransportConfig() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  };
}

function assertProductionSecurity() {
  if (!isProduction) {
    if (!process.env.DASHBOARD_SECRET) {
      console.warn('Dashboard security warning: set DASHBOARD_SECRET before publishing online.');
    }
    if (!passwordLoginEnabled) {
      console.warn('Dashboard security warning: set DASHBOARD_PASSWORD to enable password login.');
    }
    return;
  }

  const missing = [];
  for (const key of ['DASHBOARD_PASSWORD', 'DASHBOARD_SECRET', 'DASHBOARD_RESET_EMAIL', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) {
    if (!process.env[key]) missing.push(key);
  }
  if (missing.length) {
    throw new Error(`Refusing to start public dashboard. Missing secure environment variables: ${missing.join(', ')}`);
  }
  if (dashboardPassword.length < 16) {
    throw new Error('Refusing to start public dashboard. DASHBOARD_PASSWORD must be at least 16 characters.');
  }
  if (dashboardSecret.length < 32) {
    throw new Error('Refusing to start public dashboard. DASHBOARD_SECRET must be at least 32 characters.');
  }
}

async function sendResetEmail(code) {
  const config = smtpTransportConfig();
  if (!config) {
    console.warn(`Dashboard reset code for ${dashboardResetEmail}: ${code}`);
    return false;
  }
  const transporter = nodemailer.createTransport(config);
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: dashboardResetEmail,
    subject: 'Ahmed Portfolio Dashboard Login Code',
    text: `Your dashboard login code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your dashboard login code is:</p><h1 style="letter-spacing:4px">${code}</h1><p>This code expires in 10 minutes.</p>`,
  });
  return true;
}

async function createAndSendResetCode() {
  const code = createResetCode();
  resetCodeState = {
    hash: resetCodeHash(code),
    expiresAt: Date.now() + resetCodeTtlMs,
    attempts: 0,
  };
  return sendResetEmail(code);
}

function isValidResetCode(code) {
  if (!resetCodeState) return false;
  resetCodeState.attempts += 1;
  if (resetCodeState.attempts > resetCodeMaxAttempts || Date.now() > resetCodeState.expiresAt) {
    resetCodeState = null;
    return false;
  }
  const expected = Buffer.from(resetCodeState.hash);
  const given = Buffer.from(resetCodeHash(code));
  const ok = given.length === expected.length && timingSafeEqual(given, expected);
  if (ok) resetCodeState = null;
  return ok;
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
            const savedFile = { tempPath, filename: info.filename, mimeType: info.mimeType, size };
            if (files[name]) {
              files[name] = Array.isArray(files[name]) ? [...files[name], savedFile] : [files[name], savedFile];
            } else {
              files[name] = savedFile;
            }
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

async function cleanupUploads(files) {
  await Promise.all(
    Object.values(files)
      .flat()
      .map((file) => fs.rm(file.tempPath, { force: true }).catch(() => {})),
  );
}

function firstFile(fileOrFiles) {
  return Array.isArray(fileOrFiles) ? fileOrFiles[0] : fileOrFiles;
}

function fileList(fileOrFiles) {
  if (!fileOrFiles) return [];
  return Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
}

async function optimizeModel(inputPath, outputPath) {
  const tempOutput = outputPath.replace(/\.glb$/i, `.${randomUUID()}.optimized.glb`);
  const fixedInput = inputPath.replace(path.extname(inputPath), `.${randomUUID()}.textures-fixed.glb`);

  try {
    await run(process.execPath, [
      gltfCliPath,
      'optimize',
      inputPath,
      tempOutput,
      '--compress',
      'draco',
      '--texture-compress',
      'webp',
    ]);
  } catch {
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

function moveItem(items, from, to) {
  const safeFrom = Number(from);
  const safeTo = Number(to);
  if (!Number.isInteger(safeFrom) || !Number.isInteger(safeTo)) throw new Error('Invalid order index.');
  if (safeFrom < 0 || safeFrom >= items.length || safeTo < 0 || safeTo >= items.length) {
    throw new Error('Order index is out of range.');
  }
  const [item] = items.splice(safeFrom, 1);
  items.splice(safeTo, 0, item);
}

async function backupIfExists(filePath, backupDir, label) {
  try {
    await fs.stat(filePath);
  } catch {
    return;
  }
  await fs.copyFile(filePath, path.join(backupDir, `${label}.${Date.now()}${path.extname(filePath)}`));
}

async function handleAddProject(req, res) {
  const { fields, files } = await parseMultipart(req);
  try {
    const title = fields.title?.trim();
    const type = fields.type?.trim() || '3D Booth System';
    const modelFile = firstFile(files.model);
    const imageFile = firstFile(files.image);

    if (!title) throw new Error('Title is required.');
    if (!modelFile || path.extname(modelFile.filename).toLowerCase() !== '.glb') {
      throw new Error('Please upload a .glb model file.');
    }

    const { slug, filePath: modelPath } = await uniquePath(modelsDir, slugify(title, 'model'), '.glb');
    const thumbnailPath = path.join(thumbnailsDir, `${slug}.webp`);
    await fs.copyFile(modelFile.tempPath, path.join(modelBackupDir, `${slug}.original.glb`));
    const compressedModelSize = await optimizeModel(modelFile.tempPath, modelPath);

    let compressedImageSize = null;
    if (imageFile) {
      await fs.copyFile(imageFile.tempPath, path.join(imageBackupDir, `${slug}${path.extname(imageFile.filename)}`));
      compressedImageSize = await compressImage(imageFile.tempPath, thumbnailPath, { maxDim: 1600, quality: 76 });
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
      rotationY: Number(fields.rotationY || 0),
    });
    await writeContent(content);

    sendJson(res, 200, {
      ok: true,
      message: `Added "${title}" successfully.`,
      sizes: {
        modelMb: formatMb(compressedModelSize),
        imageMb: compressedImageSize === null ? null : formatMb(compressedImageSize),
      },
      content: await enrichedContent(),
    });
  } finally {
    await cleanupUploads(files);
  }
}

async function handleUpdateProject(req, res) {
  const { fields, files } = await parseMultipart(req);
  try {
    const content = await readContent();
    const project = content.projects.find((item) => item.id === fields.id);
    if (!project) throw new Error('Project not found.');

    const title = fields.title?.trim();
    const type = fields.type?.trim();
    if (title) project.title = title;
    if (type) project.type = type;
    if (fields.rotationY !== undefined && fields.rotationY !== '') {
      project.rotationY = Number(fields.rotationY);
    }

    const sizes = {};

    const replacementModel = firstFile(files.model);
    const replacementImage = firstFile(files.image);

    if (replacementModel) {
      if (path.extname(replacementModel.filename).toLowerCase() !== '.glb') {
        throw new Error('Replacement model must be a .glb file.');
      }
      const modelPath = publicUrlToAssetPath(project.model);
      await backupIfExists(modelPath, modelBackupDir, project.id);
      await fs.copyFile(replacementModel.tempPath, path.join(modelBackupDir, `${project.id}.replacement-source.${Date.now()}.glb`));
      const modelSize = await optimizeModel(replacementModel.tempPath, modelPath);
      project.sizeMb = formatMb(modelSize);
      project.fast = modelSize <= 8 * 1024 * 1024;
      sizes.modelMb = formatMb(modelSize);
    }

    if (replacementImage) {
      const imagePath =
        project.image && !project.image.includes('placeholder')
          ? publicUrlToAssetPath(project.image)
          : path.join(thumbnailsDir, `${project.id}.webp`);
      await backupIfExists(imagePath, imageBackupDir, project.id);
      await fs.copyFile(
        replacementImage.tempPath,
        path.join(imageBackupDir, `${project.id}.replacement-source.${Date.now()}${path.extname(replacementImage.filename)}`),
      );
      const imageSize = await compressImage(replacementImage.tempPath, imagePath, { maxDim: 1600, quality: 76 });
      project.image = `/images/thumbnails/${path.basename(imagePath)}`;
      sizes.imageMb = formatMb(imageSize);
    }

    await writeContent(content);
    sendJson(res, 200, {
      ok: true,
      message: `Updated "${project.title}" successfully.`,
      sizes,
      content: await enrichedContent(),
    });
  } finally {
    await cleanupUploads(files);
  }
}

async function handleAddGalleryImage(req, res) {
  const { fields, files } = await parseMultipart(req);
  try {
    const imageFiles = fileList(files.image || files.images);
    if (!imageFiles.length) throw new Error('Please upload at least one image.');

    const content = await readContent();
    const added = [];
    let totalSize = 0;

    for (const imageFile of imageFiles) {
      const base = slugify(fields.title || path.basename(imageFile.filename, path.extname(imageFile.filename)), 'image');
      const { slug, filePath } = await uniquePath(galleryDir, base, '.webp');
      await fs.copyFile(imageFile.tempPath, path.join(imageBackupDir, `${slug}${path.extname(imageFile.filename)}`));
      const imageSize = await compressImage(imageFile.tempPath, filePath, { maxDim: 1920, quality: 75 });
      totalSize += imageSize;
      content.collageImages.push(`/images/on-ground/${slug}.webp`);
      added.push({ file: `${slug}.webp`, imageMb: formatMb(imageSize) });
    }

    await writeContent(content);

    sendJson(res, 200, {
      ok: true,
      message: `Added ${added.length} gallery image${added.length === 1 ? '' : 's'}.`,
      sizes: { totalImageMb: formatMb(totalSize) },
      added,
      content: await enrichedContent(),
    });
  } finally {
    await cleanupUploads(files);
  }
}

async function handleUpdateGalleryImage(req, res) {
  const { fields, files } = await parseMultipart(req);
  try {
    const index = Number(fields.index);
    const imageFile = firstFile(files.image);
    const content = await readContent();
    if (!Number.isInteger(index) || !content.collageImages[index]) throw new Error('Gallery image not found.');
    if (!imageFile) throw new Error('Please upload a replacement image.');

    const imagePath = publicUrlToAssetPath(content.collageImages[index]);
    await backupIfExists(imagePath, imageBackupDir, `gallery-${index + 1}`);
    await fs.copyFile(
      imageFile.tempPath,
      path.join(imageBackupDir, `gallery-${index + 1}.replacement-source.${Date.now()}${path.extname(imageFile.filename)}`),
    );
    const imageSize = await compressImage(imageFile.tempPath, imagePath, { maxDim: 1920, quality: 75 });
    await writeContent(content);

    sendJson(res, 200, {
      ok: true,
      message: `Replaced gallery image #${index + 1}.`,
      sizes: { imageMb: formatMb(imageSize) },
      content: await enrichedContent(),
    });
  } finally {
    await cleanupUploads(files);
  }
}

async function handleProjectReorder(req, res) {
  const { from, to } = await parseJson(req);
  const content = await readContent();
  const activeProjects = content.projects.filter((project) => !project.archived);
  const archivedProjects = content.projects.filter((project) => project.archived);
  moveItem(activeProjects, from, to);
  content.projects = [...activeProjects, ...archivedProjects];
  await writeContent(content);
  sendJson(res, 200, { ok: true, message: 'Project order updated.', content: await enrichedContent() });
}

async function handleGalleryReorder(req, res) {
  const { from, to } = await parseJson(req);
  const content = await readContent();
  moveItem(content.collageImages, from, to);
  await writeContent(content);
  sendJson(res, 200, { ok: true, message: 'Gallery order updated.', content: await enrichedContent() });
}

async function handleProjectArchive(req, res) {
  const { id, archived = true } = await parseJson(req);
  const content = await readContent();
  const project = content.projects.find((item) => item.id === id);
  if (!project) throw new Error('Project not found.');
  project.archived = Boolean(archived);
  await writeContent(content);
  sendJson(res, 200, {
    ok: true,
    message: `${project.archived ? 'Archived' : 'Restored'} "${project.title}".`,
    content: await enrichedContent(),
  });
}

async function handleGalleryArchive(req, res) {
  const { index, archived = true } = await parseJson(req);
  const content = await readContent();
  content.archivedCollageImages ||= [];
  const source = archived ? content.collageImages : content.archivedCollageImages;
  const target = archived ? content.archivedCollageImages : content.collageImages;
  const safeIndex = Number(index);
  if (!Number.isInteger(safeIndex) || !source[safeIndex]) throw new Error('Gallery image not found.');
  const [image] = source.splice(safeIndex, 1);
  target.push(image);
  await writeContent(content);
  sendJson(res, 200, {
    ok: true,
    message: `${archived ? 'Archived' : 'Restored'} gallery image.`,
    content: await enrichedContent(),
  });
}

async function handleSyncGallery(_req, res) {
  const content = await readContent();
  content.collageImages = await scanGalleryImages();
  await writeContent(content);
  sendJson(res, 200, {
    ok: true,
    message: `Synced ${content.collageImages.length} gallery images from assets/images/on-ground.`,
    content: await enrichedContent(),
  });
}

async function serveStatic(url, res) {
  let filePath = null;
  if (url.pathname.startsWith('/models/') || url.pathname.startsWith('/images/') || url.pathname.startsWith('/draco/')) {
    filePath = safeResolve(assetsDir, url.pathname);
  } else if (url.pathname.startsWith('/node_modules/three/')) {
    filePath = safeResolve(nodeModulesDir, url.pathname.replace('/node_modules/', ''));
  }

  if (!filePath) return false;
  const data = await fs.readFile(filePath);
  res.writeHead(200, {
    'content-type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(data);
  return true;
}

function modelPreviewHtml(modelSrc, title) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} Preview</title>
    <script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; background: #0c0f14; color: #fff; font-family: Inter, Arial, sans-serif; }
      #canvas { width: 100%; height: 100%; display: block; }
      .hud { position: fixed; inset: 16px 16px auto; display: flex; justify-content: space-between; gap: 12px; pointer-events: none; }
      .card { background: rgba(255,255,255,.92); color: #0b0b0b; border: 1px solid rgba(0,0,0,.14); border-radius: 18px; padding: 12px 14px; box-shadow: 0 16px 44px rgba(0,0,0,.22); }
      strong { display: block; font-size: 14px; text-transform: uppercase; letter-spacing: .04em; }
      span { font-size: 12px; opacity: .72; }
    </style>
  </head>
  <body>
    <canvas id="canvas"></canvas>
    <div class="hud"><div class="card"><strong>${escapeHtml(title)}</strong><span>Drag rotate · Wheel zoom · Shift drag pan</span></div></div>
    <script type="module">
      import * as THREE from 'three';
      import { GLTFLoader } from '/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
      import { DRACOLoader } from '/node_modules/three/examples/jsm/loaders/DRACOLoader.js';
      import { OrbitControls } from '/node_modules/three/examples/jsm/controls/OrbitControls.js';

      const canvas = document.querySelector('#canvas');
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf7f7f4);
      const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      const controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true;
      scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 2.2));
      const key = new THREE.DirectionalLight(0xffffff, 2.8);
      key.position.set(4, 5, 5);
      scene.add(key);

      function resize() {
        const rect = canvas.getBoundingClientRect();
        camera.aspect = Math.max(rect.width, 1) / Math.max(rect.height, 1);
        camera.updateProjectionMatrix();
        renderer.setSize(rect.width, rect.height, false);
      }

      function frame(object) {
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxAxis = Math.max(size.x, size.y, size.z) || 1;
        object.position.sub(center);
        object.scale.setScalar(2.4 / maxAxis);
        object.updateWorldMatrix(true, true);
        const framed = new THREE.Box3().setFromObject(object);
        const framedSize = framed.getSize(new THREE.Vector3());
        const framedCenter = framed.getCenter(new THREE.Vector3());
        const fov = THREE.MathUtils.degToRad(camera.fov);
        const distance = Math.max(framedSize.y / (2 * Math.tan(fov / 2) * .82), 2) + framedSize.z * .25;
        controls.target.copy(framedCenter);
        camera.position.set(framedCenter.x, framedCenter.y + framedSize.y * .08, framedCenter.z + distance);
        camera.far = distance + framedSize.length() * 8;
        camera.updateProjectionMatrix();
      }

      window.addEventListener('resize', resize, { passive: true });
      resize();

      const draco = new DRACOLoader();
      draco.setDecoderPath('/draco/');
      draco.setDecoderConfig({ type: 'wasm' });
      const loader = new GLTFLoader();
      loader.setDRACOLoader(draco);
      loader.load(${JSON.stringify(modelSrc)}, (gltf) => {
        scene.add(gltf.scene);
        frame(gltf.scene);
      });

      function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      }
      animate();
    </script>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loginHtml(error = '') {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dashboard Login</title>
    <style>
      :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #fff; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 20px; background: radial-gradient(circle at 20% 10%, #334155 0, #0f172a 44%, #020617 100%); }
      .card { width: min(440px, 100%); padding: 28px; border: 1px solid rgba(255,255,255,.16); border-radius: 30px; background: rgba(255,255,255,.1); box-shadow: 0 30px 90px rgba(0,0,0,.38); backdrop-filter: blur(18px); }
      h1 { margin: 0 0 10px; font-size: clamp(36px, 8vw, 68px); line-height: .84; letter-spacing: -.08em; text-transform: uppercase; }
      p { color: #cbd5e1; line-height: 1.6; }
      label { display: grid; gap: 8px; margin: 18px 0; color: #e2e8f0; font-size: 12px; font-weight: 900; text-transform: uppercase; }
      input { width: 100%; border: 1px solid rgba(255,255,255,.22); border-radius: 16px; padding: 14px; background: rgba(255,255,255,.92); color: #0f172a; font: inherit; font-weight: 800; }
      button { width: 100%; border: 0; border-radius: 999px; padding: 13px 16px; background: #fff; color: #0f172a; font: inherit; font-weight: 950; text-transform: uppercase; cursor: pointer; }
      a { color: #fff; font-weight: 900; }
      .warn, .error { margin-top: 14px; border-radius: 16px; padding: 12px; font-size: 13px; font-weight: 800; }
      .warn { background: rgba(251,191,36,.18); color: #fde68a; }
      .error { background: rgba(239,68,68,.2); color: #fecaca; }
      code { color: #fff; }
    </style>
  </head>
  <body>
    <form class="card" method="post" action="/login">
      <p>Protected CMS</p>
      <h1>Dashboard Login</h1>
      <p>Enter the dashboard password to manage 3D models, gallery images, ordering, and uploads.</p>
      <label>Password <input name="password" type="password" autocomplete="current-password" ${passwordLoginEnabled ? 'required autofocus' : 'disabled placeholder="Set DASHBOARD_PASSWORD on the server"'} /></label>
      <button type="submit">Sign In</button>
      <p><a href="/forgot-password">Forgot password?</a></p>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      <div class="warn">Security note: password login only works when <code>DASHBOARD_PASSWORD</code> is set on the server.</div>
    </form>
  </body>
</html>`;
}

function forgotPasswordHtml(message = '', error = '') {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Forgot Password</title>
    <style>
      :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #fff; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 20px; background: radial-gradient(circle at 20% 10%, #334155 0, #0f172a 44%, #020617 100%); }
      .card { width: min(460px, 100%); padding: 28px; border: 1px solid rgba(255,255,255,.16); border-radius: 30px; background: rgba(255,255,255,.1); box-shadow: 0 30px 90px rgba(0,0,0,.38); backdrop-filter: blur(18px); }
      h1 { margin: 0 0 10px; font-size: clamp(34px, 8vw, 62px); line-height: .84; letter-spacing: -.08em; text-transform: uppercase; }
      p { color: #cbd5e1; line-height: 1.6; }
      label { display: grid; gap: 8px; margin: 18px 0; color: #e2e8f0; font-size: 12px; font-weight: 900; text-transform: uppercase; }
      input { width: 100%; border: 1px solid rgba(255,255,255,.22); border-radius: 16px; padding: 14px; background: rgba(255,255,255,.92); color: #0f172a; font: inherit; font-weight: 800; }
      button, .button { display: block; width: 100%; border: 0; border-radius: 999px; padding: 13px 16px; background: #fff; color: #0f172a; font: inherit; font-weight: 950; text-transform: uppercase; cursor: pointer; text-align: center; text-decoration: none; }
      a { color: #fff; font-weight: 900; }
      .message, .error { margin-top: 14px; border-radius: 16px; padding: 12px; font-size: 13px; font-weight: 800; }
      .message { background: rgba(16,185,129,.18); color: #bbf7d0; }
      .error { background: rgba(239,68,68,.2); color: #fecaca; }
    </style>
  </head>
  <body>
    <form class="card" method="post" action="/forgot-password">
      <p>Account Recovery</p>
      <h1>Forgot Password</h1>
      <p>Enter the owner email. If it matches the dashboard owner, a one-time login code will be sent.</p>
      <label>Email <input name="email" type="email" autocomplete="email" required autofocus /></label>
      <button type="submit">Send Login Code</button>
      <p><a href="/login">Back to login</a></p>
      ${message ? `<div class="message">${escapeHtml(message)}</div><p><a class="button" href="/reset-code">Enter Code</a></p>` : ''}
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    </form>
  </body>
</html>`;
}

function resetCodeHtml(error = '') {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Enter Login Code</title>
    <style>
      :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #fff; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 20px; background: radial-gradient(circle at 20% 10%, #334155 0, #0f172a 44%, #020617 100%); }
      .card { width: min(440px, 100%); padding: 28px; border: 1px solid rgba(255,255,255,.16); border-radius: 30px; background: rgba(255,255,255,.1); box-shadow: 0 30px 90px rgba(0,0,0,.38); backdrop-filter: blur(18px); }
      h1 { margin: 0 0 10px; font-size: clamp(34px, 8vw, 62px); line-height: .84; letter-spacing: -.08em; text-transform: uppercase; }
      p { color: #cbd5e1; line-height: 1.6; }
      label { display: grid; gap: 8px; margin: 18px 0; color: #e2e8f0; font-size: 12px; font-weight: 900; text-transform: uppercase; }
      input { width: 100%; border: 1px solid rgba(255,255,255,.22); border-radius: 16px; padding: 14px; background: rgba(255,255,255,.92); color: #0f172a; font: inherit; font-weight: 900; letter-spacing: .2em; text-align: center; }
      button { width: 100%; border: 0; border-radius: 999px; padding: 13px 16px; background: #fff; color: #0f172a; font: inherit; font-weight: 950; text-transform: uppercase; cursor: pointer; }
      a { color: #fff; font-weight: 900; }
      .error { margin-top: 14px; border-radius: 16px; padding: 12px; font-size: 13px; font-weight: 800; background: rgba(239,68,68,.2); color: #fecaca; }
    </style>
  </head>
  <body>
    <form class="card" method="post" action="/reset-code">
      <p>Secure Recovery</p>
      <h1>Enter Code</h1>
      <p>Use the 6-digit login code sent to the dashboard owner email. The code expires after 10 minutes.</p>
      <label>Code <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus /></label>
      <button type="submit">Verify Code</button>
      <p><a href="/forgot-password">Send another code</a></p>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    </form>
  </body>
</html>`;
}

function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ahmed Portfolio Dashboard</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #eef0f4;
        color: #111827;
      }
      * { box-sizing: border-box; }
      body { margin: 0; min-width: 320px; background: radial-gradient(circle at top left, #ffffff 0, #eef0f4 36%, #e5e7eb 100%); }
      button, input { font: inherit; }
      button { cursor: pointer; }
      .shell { width: min(1440px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 44px; }
      .hero {
        display: grid;
        grid-template-columns: 1.3fr .7fr;
        gap: 18px;
        align-items: stretch;
        margin-bottom: 18px;
      }
      .panel {
        border: 1px solid rgba(17, 24, 39, .12);
        border-radius: 28px;
        background: rgba(255,255,255,.82);
        box-shadow: 0 24px 70px rgba(15, 23, 42, .12);
        backdrop-filter: blur(16px);
      }
      .hero-card { padding: clamp(22px, 4vw, 44px); }
      .eyebrow { margin: 0 0 10px; color: #64748b; font-size: 12px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(44px, 8vw, 116px); line-height: .82; letter-spacing: -.08em; text-transform: uppercase; }
      h2 { margin: 0 0 14px; font-size: 20px; letter-spacing: -.03em; }
      p { color: #475569; line-height: 1.6; }
      .stats { display: grid; gap: 12px; padding: 18px; }
      .stat { padding: 18px; border-radius: 22px; background: #0f172a; color: #fff; }
      .stat small { display: block; color: #94a3b8; font-weight: 800; text-transform: uppercase; }
      .stat strong { font-size: 32px; }
      .grid { display: grid; grid-template-columns: minmax(320px, .85fr) minmax(0, 1.15fr); gap: 18px; align-items: start; }
      .stack { display: grid; gap: 18px; }
      .card { padding: 18px; }
      label { display: grid; gap: 7px; margin-bottom: 12px; color: #334155; font-size: 12px; font-weight: 900; text-transform: uppercase; }
      input {
        width: 100%;
        border: 1px solid #d7dce5;
        border-radius: 14px;
        background: #fff;
        padding: 12px 13px;
        color: #111827;
        font-weight: 700;
        outline: none;
      }
      input:focus { border-color: #111827; box-shadow: 0 0 0 4px rgba(17, 24, 39, .08); }
      .button-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .btn {
        border: 0;
        border-radius: 999px;
        background: #111827;
        color: #fff;
        padding: 10px 14px;
        font-weight: 950;
        text-transform: uppercase;
        letter-spacing: .02em;
      }
      .btn.secondary { background: #e5e7eb; color: #111827; }
      .btn.ghost { background: transparent; color: #111827; border: 1px solid #d7dce5; }
      .btn.danger { background: #fee2e2; color: #991b1b; }
      .btn:disabled { opacity: .46; cursor: wait; }
      .status {
        position: sticky;
        bottom: 14px;
        z-index: 5;
        border-radius: 22px;
        padding: 14px 16px;
        background: #111827;
        color: #fff;
        box-shadow: 0 18px 50px rgba(15, 23, 42, .24);
        white-space: pre-wrap;
      }
      .status.ok { background: #065f46; }
      .status.error { background: #991b1b; }
      [hidden] { display: none !important; }
      .list { display: grid; gap: 10px; max-height: 760px; overflow: auto; padding-right: 4px; }
      .item {
        display: grid;
        grid-template-columns: 74px minmax(0, 1fr);
        gap: 12px;
        align-items: start;
        padding: 12px;
        border: 1px solid #e2e8f0;
        border-radius: 20px;
        background: #fff;
      }
      .item[draggable="true"] { cursor: grab; }
      .item.is-dragging { opacity: .45; transform: scale(.99); }
      .item.is-drop-target { border-color: #111827; box-shadow: inset 0 0 0 2px #111827; }
      .drag-handle { color: #94a3b8; font-size: 18px; font-weight: 950; letter-spacing: -.16em; cursor: grab; user-select: none; }
      .thumb { width: 74px; height: 74px; border-radius: 16px; object-fit: cover; background: #e5e7eb; border: 1px solid #e2e8f0; }
      .meta { display: grid; gap: 9px; min-width: 0; }
      .title-row { display: flex; gap: 8px; align-items: baseline; justify-content: space-between; }
      .title-row strong { font-size: 15px; line-height: 1.15; }
      .badge { flex: none; border-radius: 999px; background: #f1f5f9; color: #475569; padding: 4px 8px; font-size: 11px; font-weight: 900; }
      .sub { color: #64748b; font-size: 12px; font-weight: 750; }
      .edit-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
      .edit-grid input { padding: 9px 10px; border-radius: 12px; font-size: 12px; }
      .file-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .mini-label { margin: 0; font-size: 10px; letter-spacing: .08em; }
      .tabs { display: flex; gap: 8px; margin-bottom: 14px; }
      .tab { border: 0; border-radius: 999px; padding: 10px 14px; background: #e5e7eb; font-weight: 950; }
      .tab.active { background: #111827; color: #fff; }
      .empty { padding: 20px; border: 1px dashed #cbd5e1; border-radius: 20px; color: #64748b; font-weight: 800; text-align: center; }
      .gallery-item { grid-template-columns: 92px minmax(0, 1fr); }
      .gallery-item .thumb { width: 92px; height: 92px; }
      dialog { width: min(960px, calc(100% - 24px)); border: 0; border-radius: 26px; padding: 0; box-shadow: 0 32px 90px rgba(15,23,42,.28); }
      dialog::backdrop { background: rgba(15,23,42,.56); backdrop-filter: blur(6px); }
      .modal-body { padding: 14px; background: #fff; }
      .modal-body img { width: 100%; max-height: 76vh; object-fit: contain; border-radius: 18px; background: #e5e7eb; }
      @media (max-width: 980px) {
        .hero, .grid { grid-template-columns: 1fr; }
        .edit-grid, .file-grid { grid-template-columns: 1fr; }
        .list { max-height: none; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div class="panel hero-card">
          <p class="eyebrow">Local CMS</p>
          <h1>Portfolio Dashboard</h1>
          <p>Manage 3D projects and gallery images without touching code. Uploads are optimized automatically before they appear on the live portfolio.</p>
          <div class="button-row">
            <a class="btn ghost" href="http://127.0.0.1:5173/" target="_blank" rel="noreferrer" style="text-decoration:none">Open Site</a>
            <button class="btn secondary" id="syncGallery" type="button">Sync Gallery Folder</button>
            <a class="btn ghost" href="/logout" style="text-decoration:none">Logout</a>
          </div>
        </div>
        <div class="panel stats">
          <div class="stat"><small>3D Models</small><strong id="projectCount">0</strong></div>
          <div class="stat"><small>Gallery Images</small><strong id="imageCount">0</strong></div>
        </div>
      </section>

      <section class="grid">
        <div class="stack">
          <section class="panel card">
            <h2>Add 3D Project</h2>
            <form id="projectForm">
              <label>Visible Title <input name="title" required placeholder="Exhibition Booth 21" /></label>
              <label>Category <input name="type" placeholder="3D Booth System" /></label>
              <label>Default Rotation Y <input name="rotationY" type="number" step="0.1" placeholder="0" /></label>
              <label>Thumbnail Image <input name="image" type="file" accept="image/*" /></label>
              <label>GLB Model <input name="model" type="file" accept=".glb,model/gltf-binary" required /></label>
              <button class="btn" type="submit">Upload + Optimize Model</button>
            </form>
          </section>

          <section class="panel card">
            <h2>Add Gallery Image</h2>
            <form id="imageForm">
              <label>Optional File Name <input name="title" placeholder="Bank branch opening" /></label>
              <label>Images <input name="images" type="file" accept="image/*" multiple required /></label>
              <button class="btn" type="submit">Bulk Upload + Convert to WebP</button>
            </form>
          </section>

          <div class="status" id="status">Ready.</div>
        </div>

        <section class="panel card">
          <div class="tabs">
            <button class="tab active" data-tab="projects" type="button">Models</button>
            <button class="tab" data-tab="gallery" type="button">Gallery</button>
            <button class="tab" data-tab="archive" type="button">Archive</button>
          </div>
          <div class="list" id="projectsList"></div>
          <div class="list" id="galleryList" hidden></div>
          <div class="list" id="archiveList" hidden></div>
        </section>
      </section>
    </main>

    <dialog id="imageModal">
      <div class="modal-body">
        <div class="button-row" style="justify-content:space-between;margin-bottom:10px">
          <strong>Image Preview</strong>
          <button class="btn secondary" id="closeModal" type="button">Close</button>
        </div>
        <img id="modalImage" alt="" />
      </div>
    </dialog>

    <script>
      let state = { projects: [], archivedProjects: [], collageImages: [], archivedCollageImages: [] };
      const statusEl = document.querySelector('#status');
      const projectCount = document.querySelector('#projectCount');
      const imageCount = document.querySelector('#imageCount');
      const projectsList = document.querySelector('#projectsList');
      const galleryList = document.querySelector('#galleryList');
      const archiveList = document.querySelector('#archiveList');
      const imageModal = document.querySelector('#imageModal');
      const modalImage = document.querySelector('#modalImage');

      function setStatus(message, type = '') {
        statusEl.textContent = message;
        statusEl.className = 'status' + (type ? ' ' + type : '');
      }

      async function requestJson(url, options = {}) {
        const res = await fetch(url, options);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Request failed');
        if (data.content) state = data.content;
        return data;
      }

      async function refresh() {
        state = await requestJson('/api/content');
        render();
      }

      function render() {
        projectCount.textContent = state.projects.length;
        imageCount.textContent = state.collageImages.length;
        projectsList.innerHTML = state.projects.length ? state.projects.map(renderProject).join('') : '<div class="empty">No active models yet.</div>';
        galleryList.innerHTML = state.collageImages.length ? state.collageImages.map(renderGalleryImage).join('') : '<div class="empty">No active gallery images yet.</div>';
        archiveList.innerHTML = renderArchive();
      }

      function renderProject(project, index) {
        return \`
          <article class="item" draggable="true" data-drag-type="project" data-index="\${index}">
            <img class="thumb" src="\${project.image}" alt="" />
            <div class="meta">
              <div class="title-row"><strong><span class="drag-handle" title="Drag to reorder">::</span> \${project.index}. \${escapeHtml(project.title)}</strong><span class="badge">\${project.actualModelSizeMb ?? project.sizeMb}MB</span></div>
              <div class="sub">\${escapeHtml(project.type)} - rotationY \${project.rotationY || 0}</div>
              <div class="edit-grid">
                <input data-field="title" data-id="\${project.id}" value="\${escapeAttr(project.title)}" />
                <input data-field="type" data-id="\${project.id}" value="\${escapeAttr(project.type)}" />
                <input data-field="rotationY" data-id="\${project.id}" type="number" step="0.1" value="\${project.rotationY || 0}" />
              </div>
              <div class="file-grid">
                <label class="mini-label">Replace thumbnail <input data-file="image" data-id="\${project.id}" type="file" accept="image/*" /></label>
                <label class="mini-label">Replace GLB <input data-file="model" data-id="\${project.id}" type="file" accept=".glb,model/gltf-binary" /></label>
              </div>
              <div class="button-row">
                <button class="btn secondary" data-action="save-project" data-id="\${project.id}" type="button">Save</button>
                <button class="btn ghost" data-action="preview-model" data-id="\${project.id}" type="button">Preview 3D</button>
                <button class="btn ghost" data-action="preview-image" data-src="\${project.image}" type="button">Preview Image</button>
                <button class="btn danger" data-action="archive-project" data-id="\${project.id}" type="button">Archive</button>
              </div>
            </div>
          </article>\`;
      }

      function renderGalleryImage(image, index) {
        return \`
          <article class="item gallery-item" draggable="true" data-drag-type="gallery" data-index="\${index}">
            <img class="thumb" src="\${image.src}" alt="" />
            <div class="meta">
              <div class="title-row"><strong><span class="drag-handle" title="Drag to reorder">::</span> #\${String(index + 1).padStart(2, '0')}</strong><span class="badge">\${image.sizeMb ?? '?'}MB</span></div>
              <div class="sub">\${escapeHtml(image.src.split('/').pop())}</div>
              <div class="file-grid">
                <label class="mini-label">Replace image <input data-gallery-file="\${index}" type="file" accept="image/*" /></label>
              </div>
              <div class="button-row">
                <button class="btn secondary" data-action="save-gallery" data-index="\${index}" type="button">Replace</button>
                <button class="btn ghost" data-action="preview-gallery" data-src="\${image.src}" type="button">Preview</button>
                <button class="btn danger" data-action="archive-gallery" data-index="\${index}" type="button">Archive</button>
              </div>
            </div>
          </article>\`;
      }

      function renderArchive() {
        const archivedProjects = state.archivedProjects || [];
        const archivedImages = state.archivedCollageImages || [];
        const projectHtml = archivedProjects
          .map(
            (project) => \`
              <article class="item">
                <img class="thumb" src="\${project.image}" alt="" />
                <div class="meta">
                  <div class="title-row"><strong>\${escapeHtml(project.title)}</strong><span class="badge">Model</span></div>
                  <div class="sub">\${escapeHtml(project.type)} - \${project.actualModelSizeMb ?? project.sizeMb}MB</div>
                  <div class="button-row">
                    <button class="btn secondary" data-action="restore-project" data-id="\${project.id}" type="button">Restore</button>
                    <button class="btn ghost" data-action="preview-model" data-id="\${project.id}" type="button">Preview 3D</button>
                  </div>
                </div>
              </article>\`,
          )
          .join('');
        const imageHtml = archivedImages
          .map(
            (image, index) => \`
              <article class="item gallery-item">
                <img class="thumb" src="\${image.src}" alt="" />
                <div class="meta">
                  <div class="title-row"><strong>\${escapeHtml(image.src.split('/').pop())}</strong><span class="badge">Image</span></div>
                  <div class="sub">\${image.sizeMb ?? '?'}MB</div>
                  <div class="button-row">
                    <button class="btn secondary" data-action="restore-gallery" data-index="\${index}" type="button">Restore</button>
                    <button class="btn ghost" data-action="preview-gallery" data-src="\${image.src}" type="button">Preview</button>
                  </div>
                </div>
              </article>\`,
          )
          .join('');
        return projectHtml || imageHtml ? projectHtml + imageHtml : '<div class="empty">Archive is empty.</div>';
      }

      function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
      }

      function escapeAttr(value) {
        return escapeHtml(value).replace(/\\n/g, ' ');
      }

      async function submitForm(form, url, busyText) {
        const button = form.querySelector('button');
        button.disabled = true;
        setStatus(busyText);
        try {
          const data = await requestJson(url, { method: 'POST', body: new FormData(form) });
          const sizeText = data.sizes ? '\\nSizes: ' + Object.entries(data.sizes).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => k + '=' + v + 'MB').join(', ') : '';
          setStatus(data.message + sizeText, 'ok');
          form.reset();
          render();
        } catch (error) {
          setStatus('ERROR: ' + error.message, 'error');
        } finally {
          button.disabled = false;
        }
      }

      async function saveProject(id) {
        const form = new FormData();
        form.set('id', id);
        document.querySelectorAll('[data-id="' + id + '"][data-field]').forEach((input) => form.set(input.dataset.field, input.value));
        document.querySelectorAll('[data-id="' + id + '"][data-file]').forEach((input) => {
          if (input.files[0]) form.set(input.dataset.file, input.files[0]);
        });
        setStatus('Saving project… model replacements may take a while.');
        const data = await requestJson('/api/project/update', { method: 'POST', body: form });
        const sizeText = data.sizes ? '\\nSizes: ' + Object.entries(data.sizes).map(([k, v]) => k + '=' + v + 'MB').join(', ') : '';
        setStatus(data.message + sizeText, 'ok');
        render();
      }

      async function saveGallery(index) {
        const input = document.querySelector('[data-gallery-file="' + index + '"]');
        if (!input.files[0]) {
          setStatus('Choose a replacement image first.', 'error');
          return;
        }
        const form = new FormData();
        form.set('index', index);
        form.set('image', input.files[0]);
        setStatus('Replacing gallery image…');
        const data = await requestJson('/api/gallery-image/update', { method: 'POST', body: form });
        setStatus(data.message + '\\nSizes: imageMb=' + data.sizes.imageMb + 'MB', 'ok');
        render();
      }

      async function move(url, from, to) {
        if (Number(to) < 0) return;
        setStatus('Updating order…');
        const data = await requestJson(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ from: Number(from), to: Number(to) }),
        });
        setStatus(data.message, 'ok');
        render();
      }

      async function archiveItem(url, payload) {
        setStatus('Updating archive…');
        const data = await requestJson(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setStatus(data.message, 'ok');
        render();
      }

      document.querySelector('#projectForm').addEventListener('submit', (event) => {
        event.preventDefault();
        submitForm(event.currentTarget, '/api/project', 'Uploading and optimizing 3D model…');
      });

      document.querySelector('#imageForm').addEventListener('submit', (event) => {
        event.preventDefault();
        submitForm(event.currentTarget, '/api/gallery-image', 'Uploading, resizing, and converting image to WebP…');
      });

      document.querySelector('#syncGallery').addEventListener('click', async () => {
        setStatus('Syncing gallery folder…');
        try {
          const data = await requestJson('/api/sync-gallery', { method: 'POST' });
          setStatus(data.message, 'ok');
          render();
        } catch (error) {
          setStatus('ERROR: ' + error.message, 'error');
        }
      });

      document.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
          document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab));
          projectsList.hidden = tab.dataset.tab !== 'projects';
          galleryList.hidden = tab.dataset.tab !== 'gallery';
          archiveList.hidden = tab.dataset.tab !== 'archive';
        });
      });

      document.addEventListener('dragstart', (event) => {
        const item = event.target.closest('.item[draggable="true"]');
        if (!item) return;
        item.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', JSON.stringify({
          type: item.dataset.dragType,
          index: Number(item.dataset.index),
        }));
      });

      document.addEventListener('dragover', (event) => {
        const item = event.target.closest('.item[draggable="true"]');
        if (!item) return;
        event.preventDefault();
        item.classList.add('is-drop-target');
      });

      document.addEventListener('dragleave', (event) => {
        event.target.closest('.item')?.classList.remove('is-drop-target');
      });

      document.addEventListener('dragend', () => {
        document.querySelectorAll('.is-dragging, .is-drop-target').forEach((item) => item.classList.remove('is-dragging', 'is-drop-target'));
      });

      document.addEventListener('drop', async (event) => {
        const target = event.target.closest('.item[draggable="true"]');
        if (!target) return;
        event.preventDefault();
        target.classList.remove('is-drop-target');
        try {
          const source = JSON.parse(event.dataTransfer.getData('text/plain'));
          const to = Number(target.dataset.index);
          if (source.type !== target.dataset.dragType || source.index === to) return;
          await move(source.type === 'project' ? '/api/projects/reorder' : '/api/gallery/reorder', source.index, to);
        } catch (error) {
          setStatus('ERROR: ' + error.message, 'error');
        }
      });

      document.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        try {
          if (action === 'save-project') await saveProject(button.dataset.id);
          if (action === 'preview-model') window.open('/preview/model?id=' + encodeURIComponent(button.dataset.id), '_blank', 'noopener,noreferrer');
          if (action === 'preview-image' || action === 'preview-gallery') {
            modalImage.src = button.dataset.src;
            imageModal.showModal();
          }
          if (action === 'move-project') await move('/api/projects/reorder', button.dataset.from, button.dataset.to);
          if (action === 'save-gallery') await saveGallery(button.dataset.index);
          if (action === 'move-gallery') await move('/api/gallery/reorder', button.dataset.from, button.dataset.to);
          if (action === 'archive-project') await archiveItem('/api/project/archive', { id: button.dataset.id, archived: true });
          if (action === 'restore-project') await archiveItem('/api/project/archive', { id: button.dataset.id, archived: false });
          if (action === 'archive-gallery') await archiveItem('/api/gallery/archive', { index: Number(button.dataset.index), archived: true });
          if (action === 'restore-gallery') await archiveItem('/api/gallery/archive', { index: Number(button.dataset.index), archived: false });
        } catch (error) {
          setStatus('ERROR: ' + error.message, 'error');
        }
      });

      document.querySelector('#closeModal').addEventListener('click', () => imageModal.close());
      refresh();
    </script>
  </body>
</html>`;
}

async function route(req, res) {
  try {
    await ensureDirs();
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && (await serveStatic(url, res))) return;

    if (req.method === 'GET' && url.pathname === '/login') {
      sendHtml(res, loginHtml(url.searchParams.get('error') || ''));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/login') {
      const loginLimitKey = rateLimitKey(req, 'login');
      const loginLimit = checkRateLimit(loginLimitKey, authLoginMaxAttempts);
      if (!loginLimit.allowed) {
        sendRateLimited(res, loginHtml(`Too many login attempts. Try again in ${loginLimit.retryAfterSeconds} seconds.`), loginLimit.retryAfterSeconds);
        return;
      }
      const form = await parseForm(req);
      if (passwordLoginEnabled && safeEqualText(form.password, dashboardPassword)) {
        clearRateLimit(loginLimitKey);
        setAuthCookie(res);
      } else {
        sendHtml(res, loginHtml('Incorrect password.'));
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/forgot-password') {
      sendHtml(res, forgotPasswordHtml());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/forgot-password') {
      const recoveryLimitKey = rateLimitKey(req, 'forgot-password');
      const recoveryLimit = checkRateLimit(recoveryLimitKey, authRecoveryMaxAttempts);
      if (!recoveryLimit.allowed) {
        sendRateLimited(
          res,
          forgotPasswordHtml('', `Too many recovery requests. Try again in ${recoveryLimit.retryAfterSeconds} seconds.`),
          recoveryLimit.retryAfterSeconds,
        );
        return;
      }
      const form = await parseForm(req);
      const email = String(form.email || '').trim().toLowerCase();
      if (email && safeEqualText(email, dashboardResetEmail)) {
        await createAndSendResetCode();
      }
      sendHtml(res, forgotPasswordHtml('If the email matches the dashboard owner, a login code has been sent.'));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/reset-code') {
      sendHtml(res, resetCodeHtml());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/reset-code') {
      const codeLimitKey = rateLimitKey(req, 'reset-code');
      const codeLimit = checkRateLimit(codeLimitKey, authCodeMaxAttempts);
      if (!codeLimit.allowed) {
        sendRateLimited(res, resetCodeHtml(`Too many code attempts. Try again in ${codeLimit.retryAfterSeconds} seconds.`), codeLimit.retryAfterSeconds);
        return;
      }
      const form = await parseForm(req);
      if (isValidResetCode(String(form.code || '').trim())) {
        clearRateLimit(codeLimitKey);
        setAuthCookie(res);
      } else {
        sendHtml(res, resetCodeHtml('Invalid or expired code.'));
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/logout') {
      clearAuthCookie(res);
      return;
    }

    const protectedPath =
      url.pathname === '/' ||
      url.pathname === '/dashboard' ||
      url.pathname === '/preview/model' ||
      url.pathname.startsWith('/api/');

    if (protectedPath && !isValidSession(req)) {
      if (url.pathname.startsWith('/api/')) {
        sendJson(res, 401, { ok: false, error: 'Authentication required.' });
      } else {
        sendRedirect(res, '/login');
      }
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) {
      sendHtml(res, dashboardHtml());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/preview/model') {
      const content = await readContent();
      const project = content.projects.find((item) => item.id === url.searchParams.get('id'));
      if (!project) throw new Error('Project not found.');
      sendHtml(res, modelPreviewHtml(project.model, project.title));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/content') {
      sendJson(res, 200, await enrichedContent());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/project') {
      await handleAddProject(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/project/update') {
      await handleUpdateProject(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/projects/reorder') {
      await handleProjectReorder(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/project/archive') {
      await handleProjectArchive(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/gallery-image') {
      await handleAddGalleryImage(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/gallery-image/update') {
      await handleUpdateGalleryImage(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/gallery/reorder') {
      await handleGalleryReorder(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/gallery/archive') {
      await handleGalleryArchive(req, res);
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

assertProductionSecurity();

http.createServer(route).listen(port, host, () => {
  console.log(`Dashboard: http://${host}:${port}/dashboard`);
});
