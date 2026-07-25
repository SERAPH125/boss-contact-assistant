const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SearchFilters = require('../src/platform/search-filters.js');
const root = path.resolve(__dirname, '..');

test('builds Zhilian search URLs with the current numeric city id', () => {
  const city = SearchFilters.resolveZhilianCity('杭州市');
  assert.deepEqual(city, { name: '杭州', code: '653', found: true });

  const url = new URL(SearchFilters.buildZhilianSearchUrl({
    city: '杭州',
    keyword: '前端'
  }));
  assert.equal(url.pathname, '/sou/');
  assert.equal(url.searchParams.get('jl'), '653');
  assert.equal(url.searchParams.get('kw'), '前端');
});

test('does not silently treat an unknown Zhilian city as nationwide', () => {
  assert.deepEqual(
    SearchFilters.resolveZhilianCity('不存在市'),
    { name: '不存在', code: '', found: false }
  );
  assert.throws(
    () => SearchFilters.buildZhilianSearchUrl({ city: '不存在市', keyword: '前端' }),
    /暂不支持城市/
  );
});

test('matches Zhilian city, experience and education against parsed card fields', () => {
  const cfg = { city: '杭州', experience: '3-5年', education: '本科' };
  assert.deepEqual(
    SearchFilters.matchZhilianJob({
      location: '杭州·滨江·长河',
      experience: '3-5年',
      education: '本科'
    }, cfg),
    { match: true, reason: '' }
  );
  assert.deepEqual(
    SearchFilters.matchZhilianJob({
      location: '上海·浦东',
      experience: '3-5年',
      education: '本科'
    }, cfg),
    { match: false, reason: 'city' }
  );
  assert.deepEqual(
    SearchFilters.matchZhilianJob({
      location: '杭州·滨江',
      experience: '1-3年',
      education: '本科'
    }, cfg),
    { match: false, reason: 'experience' }
  );
  assert.deepEqual(
    SearchFilters.matchZhilianJob({
      location: '杭州·滨江',
      experience: '3-5年',
      education: '大专'
    }, cfg),
    { match: false, reason: 'education' }
  );
});

test('empty Zhilian filters leave the parsed job unchanged', () => {
  assert.deepEqual(
    SearchFilters.matchZhilianJob({
      location: '任意城市',
      experience: '经验不限',
      education: '学历不限'
    }, {}),
    { match: true, reason: '' }
  );
});

test('passes every visible Zhilian filter into the page scanner', () => {
  const background = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');
  const content = fs.readFileSync(
    path.join(root, 'src/platform/zhilian/content-search.js'),
    'utf8'
  );

  assert.match(background, /city:\s*cfg\.city/);
  assert.match(background, /experience:\s*cfg\.experience/);
  assert.match(background, /education:\s*cfg\.education/);
  assert.match(content, /experience:\s*others\[1\]/);
  assert.match(content, /education:\s*others\[2\]/);
  assert.match(content, /SearchFilters\.matchZhilianJob/);
});
