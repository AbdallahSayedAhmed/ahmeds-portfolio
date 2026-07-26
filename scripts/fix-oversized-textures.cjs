/**
 * fix-oversized-textures.cjs
 * -------------------------------------------------------------------------
 * Some models contain an accidental/anomalous texture with pixel dimensions
 * far beyond anything a browser or the WebP/JPEG encoder can safely handle
 * (e.g. a 41266x35428 baseColor texture found in Bank2.glb -- ~1.46 billion
 * pixels, versus a normal 2K-4K texture's ~4-16 million). These trip sharp's
 * safety pixel-limit and make `gltf-transform optimize --texture-compress`
 * fail outright with "Input image exceeds pixel limit".
 *
 * This script loads the glTF document directly via the scripting API,
 * downsamples any texture larger than --max-dim (default 4096px) on either
 * side using sharp with limitInputPixels disabled (safe here since we
 * already know the source), and writes a fixed .glb that `optimize` can
 * then process normally.
 *
 * Usage:
 *   node scripts/fix-oversized-textures.cjs <input.glb> <output.glb> [maxDim]
 */

const path = require('path');
const sharp = require('sharp');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');

const [, , inputPath, outputPath, maxDimArg] = process.argv;
const maxDim = maxDimArg ? parseInt(maxDimArg, 10) : 4096;

if (!inputPath || !outputPath) {
  console.error('Usage: node fix-oversized-textures.cjs <input.glb> <output.glb> [maxDim]');
  process.exit(1);
}

async function main() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(path.resolve(inputPath));
  const textures = document.getRoot().listTextures();

  let fixedCount = 0;

  for (const texture of textures) {
    const image = texture.getImage();
    if (!image) continue;

    const buffer = Buffer.from(image);
    const meta = await sharp(buffer, { limitInputPixels: false }).metadata();
    const { width, height } = meta;

    if (width > maxDim || height > maxDim) {
      const name = texture.getName() || '(unnamed)';
      console.log(`Resizing "${name}": ${width}x${height} -> fit within ${maxDim}x${maxDim}`);

      const mimeType = texture.getMimeType(); // e.g. 'image/jpeg' or 'image/png'
      let pipeline = sharp(buffer, { limitInputPixels: false }).resize(maxDim, maxDim, {
        fit: 'inside',
        withoutEnlargement: true,
      });

      let newBuffer;
      if (mimeType === 'image/png') {
        newBuffer = await pipeline.png().toBuffer();
      } else {
        // default to jpeg for anything else (jpg/jpeg/webp source)
        newBuffer = await pipeline.jpeg({ quality: 90 }).toBuffer();
        texture.setMimeType('image/jpeg');
      }

      texture.setImage(newBuffer);
      fixedCount++;
    }
  }

  if (fixedCount === 0) {
    console.log('No oversized textures found (nothing exceeded maxDim). Copying through unchanged.');
  }

  await io.write(path.resolve(outputPath), document);
  console.log(`Wrote ${outputPath} (${fixedCount} texture(s) resized).`);
}

main().catch((err) => {
  console.error('FAILED:', err.stack || err.message);
  process.exit(1);
});
