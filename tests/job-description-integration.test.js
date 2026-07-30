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
  assert.match(background, /JobDescription\.keywordScreen\(job/);
  assert.match(background, /JobDescription\.promptText\(j\)/);
  assert.match(background, /reviewRequired/);
});

test('Boss reads its shared SPA detail panel sequentially while Zhilian keeps detail fetches', () => {
  assert.match(bossSearch, /JobDescription\.enrichJobsWithReader/);
  assert.match(bossSearch, /extractFromDocument\(\s*'boss-search'/);
  assert.match(bossSearch, /job-detail-header \.job-name/);
  assert.match(bossSearch, /\.more-job-btn\[href\*="\/job_detail\/"\]/);
  assert.match(bossSearch, /JobDescription\.bossDetailMatches/);
  assert.match(bossSearch, /await safeClick\(/);
  assert.match(
    bossSearch,
    /const discovered[\s\S]+await enrichDescriptions\(discovered\)[\s\S]+humanScrollStep/
  );
  assert.match(bossSearch, /shouldRethrow/);
  assert.match(bossSearch, /error\.code === 'BLOCKED'/);
  assert.doesNotMatch(bossSearch, /concurrency:\s*3/);

  assert.match(zhilianSearch, /JobDescription\.enrichJobs/);
  assert.match(zhilianSearch, /credentials:\s*'include'/);
  assert.match(zhilianSearch, /includeDescription/);
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

test('AI screening downgrades an unavailable description to manual review', () => {
  assert.match(background, /JobDescription\.requireDescriptionForAi\(rule,\s*job\)/);
});
