const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.resolve(__dirname, '../src/platform/config.js'),
  'utf8'
);
const registrySource = fs.readFileSync(
  path.resolve(__dirname, '../src/platform/registry.js'),
  'utf8'
);

function createHarness(initial) {
  const data = structuredClone(initial || {});
  const writes = [];
  const context = {
    chrome: {
      storage: {
        local: {
          async get() {
            return structuredClone(data);
          },
          async set(patch) {
            writes.push(structuredClone(patch));
            Object.assign(data, structuredClone(patch));
          }
        }
      }
    },
    defaultPlatformCfg() {
      return {};
    },
    RunSafety: {},
    Date,
    Object,
    String,
    Promise
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'src/platform/config.js' });
  return { PlatformConfig: context.PlatformConfig, data, writes };
}

test('loadFlat preserves the complete credential-bound API proof snapshot', async () => {
  const h = createHarness({
    configVersion: 2,
    activePlatform: 'boss',
    byPlatform: { boss: {} },
    provider: 'deepseek',
    apiKey: 'test-key',
    dsKey: 'test-key',
    baseUrl: '',
    apiConfigVersion: 3,
    apiLastTestVersion: 3,
    apiLastTestOk: true,
    apiLastTestAt: 123456
  });

  const flat = await h.PlatformConfig.loadFlat();

  assert.equal(flat.apiConfigVersion, 3);
  assert.equal(flat.apiLastTestVersion, 3);
  assert.equal(flat.apiLastTestOk, true);
  assert.equal(flat.apiLastTestAt, 123456);
});

test('migration initializes only implemented platform configurations', async () => {
  const h = createHarness({});

  const result = await h.PlatformConfig.ensureMigrated();

  assert.deepEqual(Object.keys(result.byPlatform).sort(), ['boss', 'zhilian']);
});

test('registry exposes only implemented recruitment platforms', () => {
  const context = {
    SearchFilters: {
      buildZhilianSearchUrl() {
        return '';
      },
      resolveZhilianCity() {
        return { name: '', found: false };
      }
    },
    URLSearchParams
  };
  context.globalThis = context;

  vm.runInNewContext(registrySource, context, {
    filename: 'src/platform/registry.js'
  });

  assert.deepEqual(Object.keys(context.PLATFORMS).sort(), ['boss', 'zhilian']);
});

test('API connection proof is bound to provider, key and base URL credentials', async () => {
  for (const [field, changed] of [
    ['provider', 'openai-compatible'],
    ['apiKey', 'new-key'],
    ['baseUrl', 'https://api.example.com/v1/chat/completions']
  ]) {
    const h = createHarness({
      provider: 'deepseek',
      apiKey: 'old-key',
      dsKey: 'old-key',
      baseUrl: 'https://api.deepseek.com/v1/chat/completions',
      resumeText: '五年前端经验',
      apiLastTestOk: true,
      apiLastTestAt: 123
    });
    await h.PlatformConfig.saveApi({
      provider: field === 'provider' ? changed : 'deepseek',
      apiKey: field === 'apiKey' ? changed : 'old-key',
      baseUrl: field === 'baseUrl'
        ? changed
        : 'https://api.deepseek.com/v1/chat/completions',
      resumeText: '五年前端经验'
    });
    assert.equal(h.data.apiLastTestOk, false, `${field} change must invalidate proof`);
    assert.equal(h.data.apiLastTestAt, 0, `${field} change must clear proof time`);
    assert.equal(h.data.apiConfigVersion, 1, `${field} change must advance version`);
  }
});

test('resume-only API settings save preserves the credential-bound connection proof', async () => {
  const h = createHarness({
    provider: 'deepseek',
    apiKey: 'same-key',
    dsKey: 'same-key',
    baseUrl: '',
    resumeText: '旧简历',
    apiLastTestOk: true,
    apiLastTestAt: 123,
    apiConfigVersion: 7,
    apiLastTestVersion: 7
  });
  await h.PlatformConfig.saveApi({
    provider: 'deepseek',
    apiKey: 'same-key',
    baseUrl: '',
    resumeText: '新简历'
  });
  assert.equal(h.data.apiLastTestOk, true);
  assert.equal(h.data.apiLastTestAt, 123);
  assert.equal(h.data.apiConfigVersion, 7);
  assert.equal(h.data.apiLastTestVersion, 7);
});

test('API config version prevents ABA from reviving proof for the same visible identity', async () => {
  const h = createHarness({
    provider: 'deepseek',
    apiKey: 'key-a',
    dsKey: 'key-a',
    baseUrl: '',
    resumeText: '简历',
    apiLastTestOk: true,
    apiLastTestAt: 123
  });
  await h.PlatformConfig.saveApi({
    provider: 'deepseek',
    apiKey: 'key-b',
    baseUrl: '',
    resumeText: '简历'
  });
  await h.PlatformConfig.saveApi({
    provider: 'deepseek',
    apiKey: 'key-a',
    baseUrl: '',
    resumeText: '简历'
  });

  assert.equal(h.data.apiConfigVersion, 2);
  assert.equal(h.data.apiLastTestOk, false);
  assert.equal(h.data.apiLastTestAt, 0);
  assert.notEqual(h.data.apiLastTestVersion, h.data.apiConfigVersion);
});
