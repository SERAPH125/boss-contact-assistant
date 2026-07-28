const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const allowlistPath = path.join(root, 'scripts/chrome-store-files.mjs');
const builderPath = path.join(root, 'scripts/build-chrome-store-package.mjs');

function localHtmlDependencies(relativeHtml) {
  const html = fs.readFileSync(path.join(root, relativeHtml), 'utf8');
  const parent = path.posix.dirname(relativeHtml);
  const refs = [];
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const value = match[1];
    if (/^(?:https?:|data:|#)/.test(value)) continue;
    refs.push(path.posix.normalize(path.posix.join(parent, value)));
  }
  return refs;
}

function manifestRuntimeFiles(manifest) {
  const files = new Set([
    'manifest.json',
    manifest.background.service_worker,
    manifest.side_panel.default_path,
    ...Object.values(manifest.icons)
  ]);
  for (const entry of manifest.content_scripts) {
    for (const file of entry.js || []) files.add(file);
    for (const file of entry.css || []) files.add(file);
  }
  const worker = fs.readFileSync(
    path.join(root, manifest.background.service_worker),
    'utf8'
  );
  for (const match of worker.matchAll(/['"]\/?(src\/[^'"]+)['"]/g)) {
    files.add(match[1]);
  }
  for (const html of [...files].filter((file) => file.endsWith('.html'))) {
    for (const dependency of localHtmlDependencies(html)) files.add(dependency);
  }
  return files;
}

test('builds an exact allowlisted Chrome Web Store archive', async () => {
  assert.equal(
    fs.existsSync(allowlistPath),
    true,
    'release allowlist module must exist'
  );
  assert.equal(
    fs.existsSync(builderPath),
    true,
    'release package builder must exist'
  );

  const { CHROME_STORE_FILES } = await import(pathToFileURL(allowlistPath));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')
  );
  const required = manifestRuntimeFiles(manifest);
  for (const file of required) {
    assert.ok(
      CHROME_STORE_FILES.includes(file),
      `manifest runtime dependency must be packaged: ${file}`
    );
  }

  const result = spawnSync(process.execPath, [builderPath], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const archive = path.join(
    root,
    'dist/chrome-web-store',
    `boss-contact-assistant-${manifest.version}.zip`
  );
  assert.equal(fs.existsSync(archive), true);
  const listing = spawnSync('/usr/bin/unzip', ['-Z1', archive], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(listing.status, 0, listing.stderr);
  const entries = listing.stdout
    .split(/\r?\n/)
    .map((entry) => entry.replace(/\/$/, ''))
    .filter(Boolean);

  assert.ok(entries.includes('manifest.json'));
  assert.deepEqual(entries.sort(), [...CHROME_STORE_FILES].sort());
  for (const forbidden of [
    /^tests\//,
    /^docs\//,
    /^scripts\//,
    /^package\.json$/,
    /(^|\/)\.DS_Store$/,
    /\.env/,
    /\.zip$/,
    /^src\/content-(chat|search)\.js$/,
    /^src\/selectors\.js$/
  ]) {
    assert.equal(
      entries.some((entry) => forbidden.test(entry)),
      false,
      `archive must exclude ${forbidden}`
    );
  }
});
