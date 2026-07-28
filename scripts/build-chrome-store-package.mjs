import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  utimes
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {
  CHROME_STORE_FILES,
  validateReleaseFile
} from './chrome-store-files.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const outputDir = path.join(root, 'dist/chrome-web-store');
const stagingDir = path.join(outputDir, 'staging');
const reproducibleTimestamp = new Date('1980-01-01T00:00:00.000Z');
let archivePath = '';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  });
  if (result.error) {
    throw new Error(`${path.basename(command)} is unavailable`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
    throw new Error(`${path.basename(command)} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function normalizedListing(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((entry) => entry.replace(/\/$/, ''))
    .filter(Boolean)
    .sort();
}

async function build() {
  const manifest = JSON.parse(
    await readFile(path.join(root, 'manifest.json'), 'utf8')
  );
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version)) {
    throw new Error('manifest.version must be a Chrome version string');
  }

  const duplicates = CHROME_STORE_FILES.filter(
    (entry, index) => CHROME_STORE_FILES.indexOf(entry) !== index
  );
  if (duplicates.length > 0) {
    throw new Error(`release allowlist contains duplicates: ${duplicates[0]}`);
  }
  for (const entry of CHROME_STORE_FILES) {
    await validateReleaseFile(root, entry);
  }

  archivePath = path.join(
    outputDir,
    `boss-contact-assistant-${manifest.version}.zip`
  );
  await mkdir(outputDir, { recursive: true });
  await rm(stagingDir, { recursive: true, force: true });
  await rm(archivePath, { force: true });

  for (const entry of CHROME_STORE_FILES) {
    const destination = path.join(stagingDir, ...entry.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, ...entry.split('/')), destination);
    await chmod(destination, 0o644);
    await utimes(
      destination,
      reproducibleTimestamp,
      reproducibleTimestamp
    );
  }

  run('/usr/bin/zip', ['-X', '-q', archivePath, ...CHROME_STORE_FILES], {
    cwd: stagingDir,
    env: {
      ...process.env,
      TZ: 'UTC'
    }
  });
  const entries = normalizedListing(
    run('/usr/bin/unzip', ['-Z1', archivePath], { cwd: root })
  );
  const expected = [...CHROME_STORE_FILES].sort();
  if (
    entries.length !== expected.length ||
    entries.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error('archive entries do not exactly match the release allowlist');
  }

  await rm(stagingDir, { recursive: true, force: true });
  process.stdout.write(
    `Chrome Web Store package: ${archivePath}\n` +
    `Version: ${manifest.version}\n` +
    `Files: ${entries.length}\n`
  );
}

try {
  await build();
} catch (error) {
  await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  if (archivePath) await rm(archivePath, { force: true }).catch(() => {});
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Chrome package failed: ${message.slice(0, 500)}\n`);
  process.exitCode = 1;
}
