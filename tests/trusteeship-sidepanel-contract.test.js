const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/sidepanel.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'src/sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/sidepanel.css'), 'utf8');

test('provides an accessible AI trusteeship settings pane', () => {
  for (const id of [
    'trusteeshipEnabled', 'trusteeshipInterval', 'autoReplyDailyLimit',
    'quietHoursEnabled', 'quietHoursStart', 'quietHoursEnd', 'feishuEnabled',
    'feishuWebhook', 'feishuSigningSecret', 'btnToggleFeishuWebhook',
    'btnToggleFeishuSecret', 'btnTestFeishu', 'btnSaveTrusteeship',
    'btnRunTrusteeshipNow', 'btnRegisterActiveConversation', 'registerActiveEnable',
    'trusteeshipConfigMsg', 'trusteeshipStatus'
  ]) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /data-setup="trusteeship"/);
  assert.match(html, /id="trusteeshipStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="trusteeshipConfigMsg"[^>]*aria-live="polite"/);
  assert.match(html, /id="trusteeshipInterval"[\s\S]*?<option value="5"[\s\S]*?<option value="10"[\s\S]*?<option value="15"/);
  assert.match(html, /id="autoReplyDailyLimit"[^>]*min="1"[^>]*max="20"/);
  assert.match(html, /<input[^>]*(?:id="feishuWebhook"[^>]*type="password"|type="password"[^>]*id="feishuWebhook")/);
  assert.match(html, /<input[^>]*(?:id="feishuSigningSecret"[^>]*type="password"|type="password"[^>]*id="feishuSigningSecret")/);
  assert.match(html, /不是系统钥匙链/);
  assert.match(html, /风控\/封号/);
});

test('provides an approval workbench without regressing the delivery dialog', () => {
  for (const id of ['page-approvals', 'approvalBadge', 'approvalList', 'approvalEmpty', 'approvalStatus']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /data-tab="approvals"/);
  assert.match(html, /id="approvalStatus"[^>]*aria-live="polite"/);
  assert.match(html, /id="deliveryModal"/);
  for (const label of ['修改并确认发送', '不回复', '关闭此会话托管']) {
    assert.match(script, new RegExp(label));
  }
});

test('uses trusteeship messages and DOM-safe approval rendering', () => {
  for (const type of [
    'TRUSTEESHIP_GET_STATE', 'TRUSTEESHIP_SAVE_SETTINGS', 'TRUSTEESHIP_TEST_FEISHU',
    'TRUSTEESHIP_RUN_NOW', 'TRUSTEESHIP_LIST_APPROVALS',
    'TRUSTEESHIP_RESOLVE_APPROVAL', 'TRUSTEESHIP_OPEN_CONVERSATION',
    'TRUSTEESHIP_SET_CONVERSATION', 'TRUSTEESHIP_REMOVE_CONVERSATION', 'TRUSTEESHIP_REGISTER_ACTIVE'
  ]) assert.match(script, new RegExp(type));
  assert.match(script, /从当前 Boss 聊天页登记/);
  assert.match(html, /从当前 Boss 聊天页登记/);
  assert.match(script, /从列表移除/);
  assert.match(css, /\.managed-remove/);
  assert.match(script, /function renderApprovals\(/);
  const rendererStart = script.indexOf('function renderApprovals(');
  const renderer = script.slice(rendererStart, script.indexOf('\nfunction setLoginBanner', rendererStart));
  assert.doesNotMatch(renderer, /\.innerHTML\s*=/);
  assert.match(renderer, /\.textContent\s*=/);
  assert.match(renderer, /document\.createElement\(/);
  assert.match(script, /showTab\(tab\)[\s\S]*?tab === 'approvals'[\s\S]*?refreshApprovals\(/);
  assert.match(script, /response\.ok === true[\s\S]*?refreshApprovals\(/);
});

test('has responsive approval and managed-conversation styling', () => {
  assert.match(css, /\.approval-card/);
  assert.match(css, /\.managed-conversation/);
  assert.match(css, /\.managed-actions/);
  assert.match(script, /TRUSTEESHIP_OPEN_CONVERSATION/);
  assert.match(script, /打开会话/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)/);
});

test('keeps sensitive controls uniquely labelled and long trusteeship content breakable', () => {
  assert.match(html, /id="btnToggleFeishuWebhook"[^>]*aria-controls="feishuWebhook"[^>]*aria-label="暂时显示飞书 Webhook"/);
  assert.match(html, /id="btnToggleFeishuSecret"[^>]*aria-controls="feishuSigningSecret"[^>]*aria-label="暂时显示签名密钥"/);
  assert.match(script, /button\.setAttribute\('aria-label', \(visible \? '隐藏' : '暂时显示'\) \+ name\)/);
  assert.match(css, /\.managed-conversation h3, \.approval-card h3[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(css, /\.approval-unknown[\s\S]*?overflow-wrap:\s*anywhere/);
});

test('keeps job materials in 求职设置 and API pane connection-only', () => {
  assert.match(html, /data-setup="filter">求职设置</);
  assert.match(html, /id="btnToJob"[^>]*>下一步：求职设置/);
  assert.match(html, /id="baseUrlRow"[^>]*class="[^"]*hidden/);
  const apiIdx = html.indexOf('id="setup-api"');
  const filterIdx = html.indexOf('id="setup-filter"');
  const resumeIdx = html.indexOf('id="resumeText"');
  const clearImgIdx = html.indexOf('id="btnClearResumeImg"');
  assert.ok(apiIdx >= 0 && filterIdx > apiIdx);
  assert.ok(resumeIdx > filterIdx, 'resumeText must live under 求职设置');
  assert.ok(clearImgIdx > filterIdx, 'resume image clear must live under 求职设置');
  assert.equal(html.slice(apiIdx, filterIdx).includes('id="resumeText"'), false);
  assert.match(script, /function syncBaseUrlVisibility\(/);
  assert.doesNotMatch(script, /syncBaseUrlVisibility[\s\S]{0,200}\$\('baseUrl'\)\.value\s*=\s*''/);
  assert.match(script, /focusTrusteeshipTarget[\s\S]*?showTab\('setup'\)/);
  assert.match(script, /replyEvidence: '简历要点或 HR 常用问答'/);
});

test('exposes HR FAQ controls on the AI trusteeship pane', () => {
  const trusteeshipIdx = html.indexOf('id="setup-trusteeship"');
  const filterIdx = html.indexOf('id="setup-filter"');
  const faqIdx = html.indexOf('id="hrFaqList"');
  const presetIdx = html.indexOf('id="hrFaqPresets"');
  assert.ok(trusteeshipIdx >= 0 && filterIdx > trusteeshipIdx);
  assert.ok(faqIdx > trusteeshipIdx && faqIdx < filterIdx, 'HR FAQ must live under AI 托管');
  assert.ok(presetIdx > trusteeshipIdx && presetIdx < faqIdx, 'presets should appear before custom FAQ');
  assert.match(html, /id="btnAddHrFaq"/);
  assert.match(html, /HR 常用问答/);
  assert.match(html, /添加自定义问答/);
  assert.match(script, /hrFaq:\s*readHrFaqFromDom\(\)/);
  assert.match(script, /function renderHrFaq\(/);
  assert.match(script, /const HR_FAQ_PRESETS\s*=/);
  assert.match(script, /question:\s*'还在看机会吗？'/);
  assert.match(script, /question:\s*'方便发一份简历吗？'/);
  const presetStart = script.indexOf('const HR_FAQ_PRESETS');
  const presetEnd = script.indexOf('];', presetStart);
  assert.ok(presetStart >= 0 && presetEnd > presetStart);
  const presetBlock = script.slice(presetStart, presetEnd);
  assert.doesNotMatch(presetBlock, /月薪|期望薪资|面试时间|到岗|微信|电话/);
});

test('provides an accessible live drill with explicit real-send consent and warnings', () => {
  for (const id of [
    'trusteeshipLiveDrill',
    'trusteeshipLiveDrillConversation',
    'trusteeshipLiveDrillMessage',
    'trusteeshipLiveDrillConsent',
    'btnRunTrusteeshipLiveDrill',
    'trusteeshipLiveDrillStatus',
    'trusteeshipLiveDrillResult'
  ]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /for="trusteeshipLiveDrillConversation"/);
  assert.match(html, /for="trusteeshipLiveDrillMessage"/);
  assert.match(html, /for="trusteeshipLiveDrillConsent"/);
  assert.match(html, /id="trusteeshipLiveDrillMessage"[^>]*maxlength="600"/);
  assert.match(html, /id="trusteeshipLiveDrillStatus"[^>]*aria-live="polite"/);
  assert.match(html, /id="trusteeshipLiveDrillResult"[^>]*aria-live="polite"/);
  assert.match(html, /真实外发演练/);
  assert.match(html, /飞书将收到模拟 HR 正文/);
  assert.match(html, /确认发送后会真实发送给所选 HR/);
  assert.match(script, /TRUSTEESHIP_STAGE_LIVE_DRILL/);
  assert.doesNotMatch(html, /仅模拟，未发送|运行安全模拟/);
  assert.doesNotMatch(script, /TRUSTEESHIP_SIMULATE_MESSAGE/);
  assert.match(css, /\.trusteeship-live-drill/);
  assert.match(css, /\.trusteeship-live-drill-result/);

  const rendererStart = script.indexOf('function renderTrusteeshipLiveDrillResult(');
  const rendererEnd = script.indexOf('\nfunction ', rendererStart + 1);
  assert.ok(rendererStart >= 0 && rendererEnd > rendererStart);
  const renderer = script.slice(rendererStart, rendererEnd);
  assert.doesNotMatch(renderer, /\.innerHTML\s*=/);
  assert.match(renderer, /\.textContent\s*=/);
  assert.match(renderer, /document\.createElement\(/);
});
