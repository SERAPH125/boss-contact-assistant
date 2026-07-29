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

test('parses small-city codes from the platforms official city catalogs', () => {
  const bossCodes = SearchFilters.parseBossCityCatalog({
    code: 0,
    zpData: {
      otherCitySites: [{ name: '金华', code: 101210900, url: '/jinhua/' }],
      siteGroup: [],
      siteList: []
    }
  });
  const zhilianCodes = SearchFilters.parseZhilianCityCatalog({
    code: 200,
    data: {
      allCity: [{
        name: '浙江',
        code: '540',
        sublist: [{
          name: '金华',
          code: '659',
          sublist: [{ name: '义乌市', code: '3376' }]
        }]
      }]
    }
  });

  assert.equal(bossCodes['金华'], '101210900');
  assert.equal(zhilianCodes['金华'], '659');
  assert.equal(zhilianCodes['义乌'], undefined, 'districts must not shadow city names');
});

test('resolves uncached small cities from the official catalog and persists the result', async () => {
  const writes = [];
  const resolver = SearchFilters.createCityCatalogResolver({
    now: () => 1_000,
    readCache: async () => null,
    writeCache: async (cache) => writes.push(cache),
    fetchJson: async (url) => {
      if (url.includes('zhipin.com')) {
        return {
          zpData: {
            otherCitySites: [{ name: '测试城', code: 101999900 }],
            siteGroup: [],
            siteList: []
          }
        };
      }
      return {
        data: {
          allCity: [{
            name: '浙江',
            code: '540',
            sublist: [{ name: '测试城', code: '999', sublist: [] }]
          }]
        }
      };
    }
  });

  assert.deepEqual(
    await resolver.resolve('boss', '测试城市'),
    { name: '测试城', code: '101999900', found: true, source: 'remote' }
  );
  assert.deepEqual(
    await resolver.resolve('zhilian', '测试城'),
    { name: '测试城', code: '999', found: true, source: 'remote' }
  );
  assert.equal(writes.length, 2);
});

test('keeps unknown cities fail-closed when the official catalog is unavailable', async () => {
  const resolver = SearchFilters.createCityCatalogResolver({
    readCache: async () => null,
    writeCache: async () => {},
    fetchJson: async () => {
      throw new Error('offline');
    }
  });

  assert.deepEqual(
    await resolver.resolve('boss', '不存在市'),
    { name: '不存在', code: '', found: false, source: 'unresolved' }
  );
  assert.deepEqual(
    await resolver.resolve('zhilian', '不存在市'),
    { name: '不存在', code: '', found: false, source: 'unresolved' }
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
