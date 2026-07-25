import sharp from 'sharp';
import { readdir, mkdir, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const srcDir = path.join(projectRoot, 'assets', 'images', 'on-ground');
const backupDir = path.join(projectRoot, 'originals-backup', 'on-ground');

const MAX_DIM = 1920;
const QUALITY = 75;

async function run() {
  await mkdir(backupDir, { recursive: true });
  const files = (await readdir(srcDir)).filter((f) => f.toLowerCase().endsWith('.webp'));
  let totalBefore = 0;
  let totalAfter = 0;

  for (const file of files) {
    const srcPath = path.join(srcDir, file);
    const backupPath = path.join(backupDir, file);

    const before = (await stat(srcPath)).size;
    totalBefore += before;

    let hasBackup = true;
    try {
      await stat(backupPath);
    } catch {
      hasBackup = false;
    }

    if (hasBackup && before < 1.5 * 1024 * 1024) {
      // Already optimized in a previous run; skip re-processing.
      totalAfter += before;
      console.log(file.padEnd(50), 'already optimized, skipping');
      continue;
    }

    if (!hasBackup) {
      await copyFile(srcPath, backupPath);
    }

    const buffer = await sharp(backupPath)
      .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY, effort: 4 })
      .toBuffer();

    await sharp(buffer).toFile(srcPath);
    totalAfter += buffer.length;

    console.log(
      file.padEnd(50),
      (before / 1024 / 1024).toFixed(2).padStart(8) + 'MB ->',
      (buffer.length / 1024 / 1024).toFixed(2).padStart(8) + 'MB',
    );
  }

  console.log('\n--- Summary ---');
  console.log('Files processed:', files.length);
  console.log('Total before:', (totalBefore / 1024 / 1024).toFixed(1), 'MB');
  console.log('Total after: ', (totalAfter / 1024 / 1024).toFixed(1), 'MB');
  console.log('Originals backed up to:', backupDir);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
