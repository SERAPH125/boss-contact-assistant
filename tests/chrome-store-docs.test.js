const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const privacyPath = path.join(root, 'docs/privacy-policy.md');
const listingPath = path.join(root, 'docs/chrome-web-store-listing.md');

test('privacy policy discloses stored data, third parties, deletion and auto-send', () => {
  assert.equal(fs.existsSync(privacyPath), true, 'privacy policy must exist');
  const privacy = fs.readFileSync(privacyPath, 'utf8');
  for (const phrase of [
    'API Key',
    '飞书',
    'AI 服务商',
    '浏览器本地',
    '自动发送',
    '删除',
    '不会出售',
    '招聘网站消息',
    'GitHub Issues'
  ]) {
    assert.match(privacy, new RegExp(phrase), `privacy policy must mention ${phrase}`);
  }
});

test('store listing includes permission reasons, reviewer steps and policy risk', () => {
  assert.equal(fs.existsSync(listingPath), true, 'store listing must exist');
  const listing = fs.readFileSync(listingPath, 'utf8');
  for (const phrase of [
    '单一用途',
    '简短描述',
    '详细描述',
    '`storage`',
    '`tabs`',
    '`scripting`',
    '`sidePanel`',
    '`offscreen`',
    '`alarms`',
    '主机权限',
    '数据披露',
    '审核测试步骤',
    '截图清单',
    '自动外发审核风险'
  ]) {
    assert.match(listing, new RegExp(phrase), `store listing must mention ${phrase}`);
  }
});
