/**
 * compress-models.cjs
 * -------------------------------------------------------------------------
 * Compresses .glb files in assets/models/3d using the locally installed
 * @gltf-transform/cli, with mandatory backup + verification before any
 * original file is replaced.
 *
 * Lesson from the earlier session: the temp output filename MUST end in
 * ".glb" (never ".tmp"), because gltf-transform decides whether to embed
 * all data into one file or split it into sibling .bin/.png files based on
 * the output extension. This script always writes to a real ".glb" temp
 * name and verifies no stray sibling files appear before replacing anything.
 *
 * Usage:
 *   node scripts/compress-models.cjs            (process all that need it)
 *   node scripts/compress-models.cjs --force     (reprocess everything)
 *   node scripts/compress-models.cjs Booth.glb   (process just one file)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(PROJECT_ROOT, 'assets', 'models', '3d');
const BACKUP_DIR = path.join(PROJECT_ROOT, 'originals-backup', 'models-3d-precompression');
const CLI_PATH = path.join(PROJECT_ROOT, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js');

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const onlyFile = argv.find(a => !a.startsWith('--'));

function fmt(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function listDir(dir) {
  try { return new Set(fs.readdirSync(dir)); } catch { return new Set(); }
}

let targets = fs.readdirSync(MODELS_DIR).filter(f => f.toLowerCase().endsWith('.glb'));
if (onlyFile) targets = targets.filter(f => f === onlyFile);

console.log(`gltf-transform CLI: ${CLI_PATH}`);
console.log(`Models dir: ${MODELS_DIR}`);
console.log(`Backup dir: ${BACKUP_DIR}`);
console.log(`Found ${targets.length} target file(s).\n`);

// Process smallest-first for quick wins/confidence before the huge ones.
targets.sort((a, b) => {
  const sa = fs.statSync(path.join(MODELS_DIR, a)).size;
  const sb = fs.statSync(path.join(MODELS_DIR, b)).size;
  return sa - sb;
});

const summary = [];

for (const name of targets) {
  const file = path.join(MODELS_DIR, name);
  const backupPath = path.join(BACKUP_DIR, name);
  const liveSize = fs.statSync(file).size;

  if (!fs.existsSync(backupPath)) {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(file, backupPath);
    console.log(`(backed up ${name} — no prior backup found)`);
  }
  const backupSize = fs.statSync(backupPath).size;

  // Already smaller than its own backup by a meaningful margin => already compressed.
  if (!force && liveSize < backupSize * 0.95) {
    console.log(`SKIP  (already compressed): ${name}  [${fmt(liveSize)} vs backup ${fmt(backupSize)}]`);
    summary.push({ file: name, status: 'skipped-already-compressed', liveSize });
    continue;
  }

  const dir = path.dirname(file);
  const base = path.basename(file, '.glb');
  const tempOutput = path.join(dir, `${base}.__optimized_tmp.glb`);
  if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);

  const beforeFiles = listDir(dir);
  const startedAt = Date.now();
  console.log(`Compressing ${name} (${fmt(liveSize)}) ...`);

  try {
    execFileSync(
      process.execPath,
      [CLI_PATH, 'optimize', file, tempOutput, '--compress', 'draco', '--texture-compress', 'webp'],
      { stdio: 'pipe', maxBuffer: 1024 * 1024 * 64 }
    );
  } catch (err) {
    console.log(`FAIL  (gltf-transform error) ${name}: ${err.message.split('\n')[0]}`);
    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
    summary.push({ file: name, status: 'failed-transform-error' });
    continue;
  }

  const afterFiles = listDir(dir);
  const newFiles = [...afterFiles].filter(f => !beforeFiles.has(f) && f !== path.basename(tempOutput));

  const outputExists = fs.existsSync(tempOutput);
  const outputSize = outputExists ? fs.statSync(tempOutput).size : 0;
  const isSmaller = outputSize > 0 && outputSize < liveSize;
  const noStrayFiles = newFiles.length === 0;
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (outputExists && isSmaller && noStrayFiles) {
    fs.renameSync(tempOutput, file);
    const pct = (100 * (1 - outputSize / liveSize)).toFixed(0);
    console.log(`OK    ${name}: ${fmt(liveSize)} -> ${fmt(outputSize)} (-${pct}%) [${seconds}s]`);
    summary.push({ file: name, status: 'compressed', originalSize: liveSize, outputSize });
  } else {
    if (outputExists) fs.unlinkSync(tempOutput);
    for (const f of newFiles) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
    const reason = !outputExists ? 'no-output' : !isSmaller ? 'not-smaller' : 'stray-files-created';
    console.log(`FAIL  (${reason}, original untouched) ${name} [${seconds}s]`);
    summary.push({ file: name, status: `failed-${reason}` });
  }
}

console.log('\n--- Summary ---');
for (const s of summary) console.log(JSON.stringify(s));
const ok = summary.filter(s => s.status === 'compressed').length;
const fail = summary.filter(s => s.status.startsWith('failed')).length;
const skip = summary.filter(s => s.status.startsWith('skipped')).length;
console.log(`\nDone: ${ok} compressed, ${fail} failed, ${skip} skipped.`);
