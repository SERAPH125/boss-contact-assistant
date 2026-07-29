const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');
const bossSearch = fs.readFileSync(
  path.join(root, 'src/platform/boss/content-search.js'),
  'utf8'
);
const zhilianSearch = fs.readFileSync(
  path.join(root, 'src/platform/zhilian/content-search.js'),
  'utf8'
);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('service worker resolves platform cities before opening a search page', () => {
  assert.match(background, /createCityCatalogResolver/);
  assert.match(background, /await getCityCatalogResolver\(\)\.resolve\(/);
  assert.match(background, /resolvedCityCode/);
});

test('service worker requests descriptions when keywords or AI screening need them', () => {
  assert.match(background, /includeDescription/);
  assert.match(background, /JobDescription\.screeningText\(job\)/);
  assert.match(background, /JobDescription\.promptText\(j\)/);
  assert.match(background, /职位描述读取失败/);
});

test('both platform scanners enrich jobs from read-only detail fetches', () => {
  for (const source of [bossSearch, zhilianSearch]) {
    assert.match(source, /JobDescription\.enrichJobs/);
    assert.match(source, /credentials:\s*'include'/);
    assert.match(source, /includeDescription/);
  }
});

test('job-description helper loads before both search adapters', () => {
  const boss = manifest.content_scripts.find((entry) =>
    entry.matches.some((pattern) => pattern.includes('zhipin.com/web/geek/job'))
  );
  const zhilian = manifest.content_scripts.find((entry) =>
    entry.matches.some((pattern) => pattern.includes('zhaopin.com/sou'))
  );

  assert.ok(boss.js.indexOf('src/platform/job-description.js') >= 0);
  assert.ok(zhilian.js.indexOf('src/platform/job-description.js') >= 0);
  assert.ok(
    boss.js.indexOf('src/platform/job-description.js') <
      boss.js.indexOf('src/platform/boss/content-search.js')
  );
  assert.ok(
    zhilian.js.indexOf('src/platform/job-description.js') <
      zhilian.js.indexOf('src/platform/zhilian/content-search.js')
  );
});
