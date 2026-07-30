import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE_ASSET_SCENES } from '../docs/store-assets/source/scenes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const assetsDirFlag = args.indexOf('--assets-dir');
const assetsDir = assetsDirFlag >= 0
  ? path.resolve(args[assetsDirFlag + 1] || '')
  : path.join(root, 'docs/store-assets');

const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
]);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function readSipsProperty(output, name) {
  const match = output.match(new RegExp(`${name}:\\s*([^\\n]+)`));
  return match ? match[1].trim() : '';
}

for (const scene of Object.values(STORE_ASSET_SCENES)) {
  const assetPath = path.join(assetsDir, scene.output);
  if (!fs.existsSync(assetPath)) {
    fail(`缺少商店素材：${scene.output}`);
    break;
  }

  const handle = fs.openSync(assetPath, 'r');
  const signature = Buffer.alloc(pngSignature.length);
  fs.readSync(handle, signature, 0, signature.length, 0);
  fs.closeSync(handle);
  if (!signature.equals(pngSignature)) {
    fail(`商店素材不是 PNG：${scene.output}`);
    break;
  }

  let metadata;
  try {
    metadata = execFileSync(
      '/usr/bin/sips',
      ['-g', 'format', '-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', assetPath],
      { encoding: 'utf8' }
    );
  } catch {
    fail(`无法读取商店素材元数据：${scene.output}`);
    break;
  }

  const format = readSipsProperty(metadata, 'format').toLowerCase();
  const width = Number(readSipsProperty(metadata, 'pixelWidth'));
  const height = Number(readSipsProperty(metadata, 'pixelHeight'));
  const hasAlpha = readSipsProperty(metadata, 'hasAlpha').toLowerCase();

  if (format !== 'png') {
    fail(`商店素材格式错误：${scene.output}（${format || '未知'}）`);
    break;
  }
  if (width !== scene.width || height !== scene.height) {
    fail(
      `商店素材尺寸错误：${scene.output}（实际 ${width}×${height}，期望 ${scene.width}×${scene.height}）`
    );
    break;
  }
  if (hasAlpha !== 'no') {
    fail(`商店素材包含 Alpha 透明层：${scene.output}`);
    break;
  }

  process.stdout.write(
    `✓ ${scene.output} ${scene.width}×${scene.height} PNG 无 Alpha\n`
  );
}
