const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const searchPath = path.join(root, 'src/platform/boss/content-search.js');
const selectorsPath = path.join(root, 'src/platform/boss/selectors.js');
const registryPath = path.join(root, 'src/platform/registry.js');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const search = fs.readFileSync(searchPath, 'utf8');
const selectors = fs.readFileSync(selectorsPath, 'utf8');
const registry = fs.readFileSync(registryPath, 'utf8');

test('Boss job page content script order stays search-ready', () => {
  const entry = manifest.content_scripts.find((candidate) =>
    candidate.matches.some((pattern) => pattern.includes('zhipin.com/web/geek/job'))
  );
  assert.ok(entry);
  assert.deepEqual(entry.js, [
    'src/platform/boss/selectors.js',
    'src/humanize.js',
    'src/platform/boss/content-search.js'
  ]);
});

test('Boss search adapter exposes the scan and initiate protocol', () => {
  for (const type of ['PING', 'CHECK_LOGIN', 'SCRAPE', 'OPEN_JD']) {
    assert.match(search, new RegExp(`msg\\.type === '${type}'`));
  }
  assert.match(search, /msg\.type === 'GO_CHAT' \|\| msg\.type === 'INITIATE' \|\| msg\.type === 'CREATE_CONV'/);
  assert.match(search, /sendResponse\(\{ ok: true, page: 'search' \}\)/);
});

test('Boss search stops on captcha, daily limit, and login loss', () => {
  assert.match(search, /function detectBlock\(/);
  assert.match(search, /验证码/);
  assert.match(search, /今日沟通已达上限/);
  assert.match(search, /function detectLoginIssue\(/);
  assert.match(search, /passport\\.zhipin\\.com/);
  assert.match(search, /needLogin:\s*true/);
  assert.match(search, /blocked:\s*true/);
});

test('Boss search classifies unsafe contact outcomes without silent success', () => {
  assert.match(search, /selectorUnavailable:\s*true/);
  assert.doesNotMatch(search, /sendResponse\(\{\s*success:\s*true\s*\}\)/);
  assert.match(search, /立即沟通|继续沟通/);
});

test('Boss search dismisses dialogs via safeClick instead of raw click on javascript URLs', () => {
  assert.match(search, /async function safeClick\(/);
  assert.match(search, /Humanize\.humanClick/);
  assert.match(search, /javascript\s*:/);
  const dismissStart = search.indexOf('async function dismissCommonDialogs');
  const dismissEnd = search.indexOf('\n  function getCards', dismissStart);
  assert.ok(dismissStart >= 0 && dismissEnd > dismissStart);
  const dismiss = search.slice(dismissStart, dismissEnd);
  assert.match(dismiss, /await safeClick\(/);
  assert.doesNotMatch(dismiss, /\.click\(\)/);
});

test('Boss registry points job/chat scripts at zhipin geek paths', () => {
  assert.match(registry, /id:\s*'boss'/);
  assert.match(registry, /host:\s*'zhipin\.com'/);
  assert.match(registry, /chatPathHint:\s*'\/web\/geek\/chat'/);
  assert.match(registry, /searchScript:\s*'src\/platform\/boss\/content-search\.js'/);
  assert.match(registry, /chatScript:\s*'src\/platform\/boss\/content-chat\.js'/);
  assert.match(registry, /zhipin\.com\/web\/geek\/jobs/);
  assert.match(selectors, /jobCard|jobs/);
});
