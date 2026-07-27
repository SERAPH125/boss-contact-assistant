const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'src/sidepanel.js'), 'utf8');

function loadController() {
  const start = script.indexOf('// TRUSTEESHIP_UI_CONTROLLER_START');
  const end = script.indexOf('// TRUSTEESHIP_UI_CONTROLLER_END');
  assert.ok(start >= 0 && end > start, 'sidepanel must expose the small trusteeship UI controller');
  const context = { globalThis: {}, Promise };
  vm.runInNewContext(script.slice(start, end), context);
  return context.globalThis.TrusteeshipSidepanel.createController;
}

test('restores the global toggle after a failed save', async () => {
  const createController = loadController();
  const calls = [];
  const controller = createController({
    send: async () => ({ ok: false, code: 'MISSING_PREREQUISITE' }),
    setEnabled: (value) => calls.push(['enabled', value]),
    status: (value) => calls.push(['status', value]),
    guide: () => calls.push(['guide'])
  });

  const result = await controller.saveSettings({ settings: { enabled: true } }, false);
  assert.equal(result.ok, false);
  assert.deepEqual(calls, [
    ['enabled', false],
    ['status', '保存失败：请补全开启托管的前置条件'],
    ['guide']
  ]);
});

test('guides missing prerequisites to their corresponding UI targets', async () => {
  const createController = loadController();
  const focused = [];
  const controller = createController({
    send: async () => ({ ok: false, code: 'MISSING_PREREQUISITE', missing: ['replyEvidence'] }),
    setEnabled() {}, status() {},
    guide: (target) => focused.push(target)
  });
  await controller.saveSettings({ settings: { enabled: true } }, false);
  assert.deepEqual(focused, [['replyEvidence']]);
});

test('reports every missing prerequisite in stable order while preserving the complete guide list', async () => {
  const createController = loadController();
  const focused = [];
  const messages = [];
  const controller = createController({
    send: async () => ({ ok: false, code: 'TRUSTEESHIP_PREREQUISITE_FAILED', missing: ['riskAccepted', 'feishuTest', 'replyEvidence', 'api'] }),
    setEnabled() {}, status: (value) => messages.push(value), guide: (targets) => focused.push(targets)
  });
  await controller.saveSettings({ settings: { enabled: true } }, false);
  assert.deepEqual(messages, ['保存失败：请完成：API 配置与测试、简历要点或 HR 常用问答、飞书测试通知、平台风险确认']);
  assert.deepEqual(focused, [['riskAccepted', 'feishuTest', 'replyEvidence', 'api']]);
});

test('keeps ordinary failed approval cards editable while unknown and successful resolutions refresh', async () => {
  const createController = loadController();
  const calls = [];
  let response = { ok: false, code: 'CONVERSATION_NOT_REGISTERED' };
  const controller = createController({
    send: async (message) => { calls.push(message); return response; },
    disableCard: (id, value) => calls.push(['disabled', id, value]),
    status: (value) => calls.push(['status', value]),
    refreshApprovals: async () => calls.push(['refresh'])
  });
  const card = { id: 'a-1', draft: '保留的草稿' };

  await controller.resolveApproval(card, 'SEND_EDITED');
  assert.equal(card.draft, '保留的草稿');
  assert.equal(calls.some((entry) => entry[0] === 'refresh'), false);
  assert.deepEqual(calls[0], ['disabled', 'a-1', true]);
  assert.equal(calls[1].draft, '保留的草稿');
  assert.equal(calls.some((entry) => Array.isArray(entry) && entry[0] === 'disabled' && entry[2] === false), true);

  calls.length = 0;
  response = { ok: false, status: 'SEND_RESULT_UNKNOWN', code: 'SEND_RESULT_UNKNOWN' };
  await controller.resolveApproval(card, 'SEND_EDITED');
  assert.equal(calls.some((entry) => Array.isArray(entry) && entry[0] === 'disabled' && entry[2] === false), false);
  assert.equal(calls.some((entry) => entry[0] === 'refresh'), true);

  calls.length = 0;
  response = { ok: true };
  await controller.resolveApproval(card, 'NO_REPLY');
  assert.deepEqual({ ...calls[1] }, { type: 'TRUSTEESHIP_RESOLVE_APPROVAL', approvalId: 'a-1', action: 'NO_REPLY' });
  assert.deepEqual(calls.slice(-2), [['disabled', 'a-1', false], ['refresh']]);

  calls.length = 0;
  response = { ok: false, code: 'raw-error-CANARY-sidepanel-298e' };
  await controller.resolveApproval(card, 'SEND_EDITED');
  assert.equal(JSON.stringify(calls).includes('raw-error-CANARY-sidepanel-298e'), false);
});

test('restores an individual conversation switch when its update fails', async () => {
  const createController = loadController();
  const calls = [];
  const controller = createController({
    send: async () => ({ ok: false, code: 'CONVERSATION_NOT_REGISTERED' }),
    setConversationEnabled: (id, value) => calls.push([id, value]),
    status: (value) => calls.push(value)
  });
  const result = await controller.setConversation('c-1', true, false);
  assert.equal(result.ok, false);
  assert.deepEqual(calls, [['c-1', false], '更新失败：该会话不可托管']);
});

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  toggle(value, enabled) { if (enabled) this.add(value); else this.remove(value); return !!enabled; }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tagName, id) {
    this.tagName = tagName.toUpperCase(); this.id = id || ''; this.children = [];
    this.dataset = {}; this.classList = new FakeClassList(); this.listeners = {};
    this.attributes = {}; this.style = {}; this.value = ''; this.textContent = '';
    this.checked = false; this.disabled = false; this.hidden = false; this.type = '';
  }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); }
  getAttribute(name) { return this.attributes[name] || null; }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  async trigger(type, event) {
    if (type === 'click' && this.disabled) return;
    for (const listener of this.listeners[type] || []) await listener(event || { target: this, preventDefault() {}, stopPropagation() {} });
  }
  focus() { this.focused = true; }
  querySelectorAll(selector) { return findDescendants(this, selector); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function findDescendants(root, selector) {
  const all = [];
  (function walk(node) { (node.children || []).forEach((child) => { all.push(child); walk(child); }); })(root);
  if (selector === 'button, textarea') return all.filter((item) => item.tagName === 'BUTTON' || item.tagName === 'TEXTAREA');
  const data = selector.match(/\[data-([\w-]+)="([^"]+)"\]/);
  if (data) return all.filter((item) => item.dataset[data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === data[2]);
  if (selector === 'button') return all.filter((item) => item.tagName === 'BUTTON');
  if (selector === 'textarea') return all.filter((item) => item.tagName === 'TEXTAREA');
  return [];
}

async function loadFullSidepanel(options) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src/sidepanel.html'), 'utf8');
  const ids = {};
  for (const match of html.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) ids[match[2]] = new FakeElement(match[1], match[2]);
  const pages = ['setup', 'review', 'run', 'approvals'].map((name) => { const el = ids['page-' + name]; el.dataset.page = name; return el; });
  const tabs = ['setup', 'review', 'run', 'approvals'].map((name) => { const el = new FakeElement('button'); el.classList.add('tab'); el.dataset.tab = name; return el; });
  const subtabs = ['platform', 'api', 'filter', 'trusteeship'].map((name) => { const el = new FakeElement('button'); el.classList.add('subtab'); el.dataset.setup = name; return el; });
  const document = {
    activeElement: null,
    getElementById(id) { return ids[id] || null; },
    createElement(tag) { return new FakeElement(tag); },
    createTextNode(text) { const node = new FakeElement('#text'); node.textContent = text; return node; },
    querySelectorAll(selector) { if (selector === '.page') return pages; if (selector === '.tab') return tabs; if (selector === '.subtab') return subtabs; return []; },
    querySelector(selector) { if (selector.startsWith('#managedConversations')) return ids.managedConversations.querySelector(selector); if (selector.startsWith('#approvalList')) return ids.approvalList.querySelector(selector); return null; },
    addEventListener() {}
  };
  const state = options.state;
  const approvals = options.approvals;
  const sent = [];
  const storageChangedListeners = [];
  const chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        sent.push(message);
        if (message.type === 'TRUSTEESHIP_GET_STATE') callback({ ok: true, ...state });
        else if (message.type === 'TRUSTEESHIP_LIST_APPROVALS') {
          if (options.listApprovals) options.listApprovals(message, callback);
          else callback({ ok: true, approvals });
        }
        else if (message.type === 'TRUSTEESHIP_RESOLVE_APPROVAL') callback(options.resolve ? options.resolve(message) : { ok: true });
        else if (message.type === 'TRUSTEESHIP_RUN_NOW') callback(options.runNow ? options.runNow(message) : { ok: true });
        else if (message.type === 'TRUSTEESHIP_STAGE_LIVE_DRILL') {
          callback(options.liveDrill ? options.liveDrill(message) : { ok: false, code: 'TRUSTEESHIP_LIVE_DRILL_FAILED' });
        }
        else if (message.type === 'TRUSTEESHIP_SET_ALL_CONVERSATIONS') {
          callback(options.setAll ? options.setAll(message) : {
            ok: true, enabled: 0, unchanged: 0, skipped: 0, failed: 0
          });
        }
        else if (message.type === 'TRUSTEESHIP_SET_CONVERSATION') callback({ ok: false, code: 'CONVERSATION_NOT_REGISTERED' });
        else if (message.type === 'GET_STATE') callback({ phase: 'idle' });
        else callback({ ok: true });
      }, onMessage: { addListener() {} }
    },
    storage: {
      local: { set() {} },
      onChanged: {
        addListener(listener) { storageChangedListeners.push(listener); }
      }
    },
    tabs: { query() {} }
  };
  const context = {
    globalThis: null, document, window: { confirm: () => true }, chrome,
    PlatformConfig: { ensureMigrated: async () => ({ activePlatform: 'boss', byPlatform: {} }), savePlatformFields: async () => {}, setActivePlatform: async () => {} },
    RunSafety: { canSwitchPlatform: () => true, canResetRun: () => true },
    ApiPermissions: { ensure: async () => ({ ok: true }) }, DeliveryGuard: {},
    getPlatform: () => ({ short: 'Boss', name: 'Boss', ready: true, tabQuery: [] }), defaultPlatformCfg: () => ({}),
    setTimeout, clearTimeout, FileReader: function () {}
  };
  context.globalThis = context;
  vm.runInNewContext(script, context);
  await Promise.resolve(); await Promise.resolve();
  return {
    ids,
    tabs,
    sent,
    context,
    async triggerStorageChange(changes) {
      storageChangedListeners.forEach((listener) => listener(changes, 'local'));
      await new Promise((resolve) => setTimeout(resolve, 180));
      await Promise.resolve();
    }
  };
}

test('full sidepanel wiring keeps unknown outcomes visible and disables unsafe retries', async () => {
  const unknown = { approvalId: 'a-unknown', conversationId: 'conv-1', company: '甲'.repeat(40), position: '前端', hrName: '李', status: 'SEND_RESULT_UNKNOWN', stage: 'PAUSED', reasonCode: 'SEND_RESULT_UNKNOWN', messages: ['请核对发送结果'], fieldsNeeded: [], draft: '保留草稿' };
  const h = await loadFullSidepanel({
    state: { settings: { enabled: true, paused: false }, managedConversations: {}, pendingApprovalCount: 1 }, approvals: [unknown]
  });
  assert.ok(h.sent.some((item) => item.type === 'TRUSTEESHIP_GET_STATE'));
  assert.equal(h.ids.trusteeshipStatus.textContent, '等待确认 1 条');
  await h.tabs.find((tab) => tab.dataset.tab === 'approvals').trigger('click');
  const card = h.ids.approvalList.children[0];
  assert.match(card.children.find((child) => child.tagName === 'P').textContent, /人工核对/);
  assert.equal(findDescendants(card, 'button').some((button) => button.textContent === '修改并确认发送'), false);
  assert.equal(findDescendants(card, 'button').filter((button) => button.textContent === '打开 Boss 会话')[0].disabled, false);
});

test('full sidepanel preserves a real unknown resolve draft and refreshes only a successful resolve', async () => {
  const approvals = [{ approvalId: 'a-pending', conversationId: 'conv-1', company: '甲公司', position: '前端', hrName: '李', status: 'PENDING', stage: 'WAITING_CONFIRMATION', reasonCode: 'HARD_RISK_SALARY', messages: ['请说明薪资期望'], fieldsNeeded: [], draft: '保留草稿' }];
  let resolveCount = 0;
  const h = await loadFullSidepanel({
    state: { settings: { enabled: true, paused: false }, managedConversations: {}, pendingApprovalCount: 1 }, approvals,
    resolve() {
      resolveCount += 1;
      if (resolveCount === 1) { approvals[0].status = 'SEND_RESULT_UNKNOWN'; return { ok: false, status: 'SEND_RESULT_UNKNOWN', errorCode: 'SEND_RESULT_UNKNOWN' }; }
      approvals.length = 0; return { ok: true };
    }
  });
  const approvalsTab = h.tabs.find((tab) => tab.dataset.tab === 'approvals');
  await approvalsTab.trigger('click');
  let card = h.ids.approvalList.children[0];
  const draft = findDescendants(card, 'textarea')[0];
  draft.value = '编辑后保留';
  await findDescendants(card, 'button').find((button) => button.textContent === '修改并确认发送').trigger('click');
  assert.match(h.ids.approvalList.children[0].children.find((child) => /发送结果未知/.test(child.textContent)).textContent, /发送结果未知/);
  assert.equal(draft.value, '编辑后保留');
  await approvalsTab.trigger('click');
  card = h.ids.approvalList.children[0];
  assert.equal(findDescendants(card, 'button').some((button) => button.textContent === '修改并确认发送'), false);

  approvals[0].status = 'PENDING';
  await approvalsTab.trigger('click');
  card = h.ids.approvalList.children[0];
  await findDescendants(card, 'button').find((button) => button.textContent === '不回复并移除').trigger('click');
  assert.equal(h.ids.approvalList.children.length, 0);
  assert.equal(h.ids.approvalEmpty.hidden, false);
});

test('full sidepanel immediately locks an unknown response while its durable refresh is pending', async () => {
  const pending = { approvalId: 'a-pending', conversationId: 'conv-1', company: '甲公司', position: '前端', hrName: '李', status: 'PENDING', stage: 'WAITING_CONFIRMATION', reasonCode: 'HARD_RISK_SALARY', messages: ['请说明薪资期望'], fieldsNeeded: [], draft: '保留草稿' };
  const unknown = { ...pending, status: 'SEND_RESULT_UNKNOWN', stage: 'PAUSED', reasonCode: 'SEND_RESULT_UNKNOWN' };
  let listCalls = 0;
  let releaseRefresh;
  const h = await loadFullSidepanel({
    state: { settings: { enabled: true, paused: false }, managedConversations: {}, pendingApprovalCount: 1 }, approvals: [pending],
    resolve: () => ({ ok: false, status: 'SEND_RESULT_UNKNOWN', code: 'SEND_RESULT_UNKNOWN' }),
    listApprovals(_message, callback) {
      listCalls += 1;
      if (listCalls === 1) callback({ ok: true, approvals: [pending] });
      else releaseRefresh = () => callback({ ok: true, approvals: [unknown] });
    }
  });
  await h.tabs.find((tab) => tab.dataset.tab === 'approvals').trigger('click');
  const oldCard = h.ids.approvalList.children[0];
  const draft = findDescendants(oldCard, 'textarea')[0];
  const send = findDescendants(oldCard, 'button').find((button) => button.textContent === '修改并确认发送');
  const resolveAttempt = send.trigger('click');
  await Promise.resolve(); await Promise.resolve();

  assert.equal(draft.disabled, true);
  assert.equal(draft.readOnly, true);
  assert.deepEqual(findDescendants(oldCard, 'button').map((button) => button.disabled), [true, true, true, true]);
  assert.match(h.ids.approvalStatus.textContent, /发送结果未知/);
  await send.trigger('click');
  assert.equal(h.sent.filter((message) => message.type === 'TRUSTEESHIP_RESOLVE_APPROVAL').length, 1);

  releaseRefresh();
  await resolveAttempt;
  const durableCard = h.ids.approvalList.children[0];
  assert.equal(findDescendants(durableCard, 'textarea')[0].readOnly, true);
  assert.match(durableCard.children.find((child) => child.tagName === 'LABEL').textContent, /本次尝试草稿（只读）/);
  assert.deepEqual(
    findDescendants(durableCard, 'button').map((button) => button.textContent),
    ['打开 Boss 会话', '已核对，清除此项']
  );
});

test('full sidepanel uses the global enabled gate and rolls back a confirmed conversation close', async () => {
  const conversation = { conversationId: 'conv-1', company: '甲公司', position: '前端', hrName: '李', enabled: true, state: 'WAITING_HR', lastCheckedAt: 1234 };
  const h = await loadFullSidepanel({ state: { settings: { enabled: false, paused: false }, managedConversations: { 'conv-1': conversation }, pendingApprovalCount: 1 }, approvals: [] });
  assert.equal(h.ids.trusteeshipStatus.textContent, '托管已关闭');
  assert.equal(h.ids.managedConversationsHeading.textContent, '已登记岗位（1）');
  h.context.applyTrusteeshipState({ settings: { enabled: true, paused: false }, managedConversations: {}, pendingApprovalCount: 0 });
  assert.equal(h.ids.trusteeshipStatus.textContent, '正在托管 0 个岗位');
  assert.equal(h.ids.managedConversationsHeading.textContent, '已登记岗位（0）');
  h.context.applyTrusteeshipState({ settings: { enabled: true, paused: true }, managedConversations: {}, pendingApprovalCount: 1 });
  assert.equal(h.ids.trusteeshipStatus.textContent, '托管已暂停');
  h.context.applyTrusteeshipState({ settings: { enabled: true, paused: false }, managedConversations: { 'conv-1': conversation }, pendingApprovalCount: 0 });
  const checkbox = findDescendants(h.ids.managedConversations, '[data-conversation-id="conv-1"]')[0];
  checkbox.checked = false;
  await checkbox.trigger('change');
  assert.equal(checkbox.checked, true);
});

test('full sidepanel renders deferred and ended unmatched without counting or retrying the ended card', async () => {
  const deferred = {
    conversationId: 'deferred',
    company: '甲公司',
    position: '前端',
    hrName: '李',
    enabled: true,
    state: 'WAITING_AUTO_CLOSE',
    lastCheckedAt: 1234
  };
  const ended = {
    conversationId: 'ended',
    company: '乙公司',
    position: '运营',
    hrName: '王',
    enabled: true,
    state: 'ENDED_UNMATCHED',
    lastCheckedAt: 5678
  };
  const h = await loadFullSidepanel({
    state: {
      settings: { enabled: true, paused: false },
      managedConversations: { deferred, ended },
      pendingApprovalCount: 0
    },
    approvals: []
  });

  assert.equal(h.ids.trusteeshipStatus.textContent, '正在托管 1 个岗位');
  const rendered = JSON.stringify(h.ids.managedConversations.children.map((card) =>
    card.children.map((child) => child.textContent)
  ));
  assert.match(rendered, /等待静默结束后礼貌回复/);
  assert.match(rendered, /已结束－未匹配/);

  const endedCard = h.ids.managedConversations.children.find((card) =>
    card.children[0].textContent.includes('乙公司')
  );
  assert.equal(findDescendants(endedCard, 'input').length, 0);
  assert.deepEqual(
    findDescendants(endedCard, 'button').map((button) => button.textContent),
    ['打开会话', '从列表移除']
  );
});

test('one-click trusteeship uses one bulk command and reports ended conversations as skipped', async () => {
  const ended = {
    conversationId: 'ended',
    company: '乙公司',
    position: '运营',
    hrName: '王',
    enabled: false,
    state: 'ENDED_UNMATCHED'
  };
  const waiting = {
    conversationId: 'waiting',
    company: '甲公司',
    position: '前端',
    hrName: '李',
    enabled: false,
    state: 'DISABLED'
  };
  const state = {
    settings: { enabled: true, paused: false },
    managedConversations: { ended, waiting },
    pendingApprovalCount: 0
  };
  const h = await loadFullSidepanel({
    state,
    approvals: [],
    setAll(message) {
      assert.deepEqual({ ...message }, {
        type: 'TRUSTEESHIP_SET_ALL_CONVERSATIONS',
        enabled: true
      });
      waiting.enabled = true;
      waiting.state = 'WAITING_HR';
      return { ok: true, enabled: 1, unchanged: 0, skipped: 1, failed: 0 };
    }
  });

  await h.ids.btnEnableAllManagedConversations.trigger('click');

  const bulkMessages = h.sent.filter(
    (message) => message.type === 'TRUSTEESHIP_SET_ALL_CONVERSATIONS'
  );
  assert.equal(bulkMessages.length, 1);
  assert.match(h.ids.managedBulkStatus.textContent, /已启用 1 个/);
  assert.match(h.ids.managedBulkStatus.textContent, /跳过 1 个/);
  assert.match(h.ids.managedBulkStatus.textContent, /明确拒绝/);
  const endedCard = h.ids.managedConversations.children.find((card) =>
    card.children[0].textContent.includes('乙公司')
  );
  assert.equal(findDescendants(endedCard, 'input').length, 0);
});

test('managed conversation storage changes refresh cards without overwriting dirty settings fields', async () => {
  const state = {
    settings: {
      enabled: true,
      paused: false,
      intervalMinutes: 10,
      dailyAutoReplyLimit: 10
    },
    managedConversations: {},
    pendingApprovalCount: 0
  };
  const h = await loadFullSidepanel({ state, approvals: [] });
  h.ids.trusteeshipInterval.value = '5';
  h.ids.autoReplyDailyLimit.value = '17';
  state.managedConversations['new-conversation'] = {
    conversationId: 'new-conversation',
    company: '新登记公司',
    position: '运营',
    hrName: '陈女士',
    enabled: true,
    state: 'WAITING_HR'
  };

  await h.triggerStorageChange({
    managedConversations: { oldValue: {}, newValue: state.managedConversations }
  });

  assert.equal(h.ids.managedConversationsHeading.textContent, '已登记岗位（1）');
  assert.match(h.ids.managedConversations.children[0].children[0].textContent, /新登记公司/);
  assert.equal(h.ids.trusteeshipInterval.value, '5');
  assert.equal(h.ids.autoReplyDailyLimit.value, '17');
  assert.equal(
    h.sent.filter((message) => message.type === 'TRUSTEESHIP_GET_STATE').length >= 2,
    true
  );
});

test('full sidepanel gives stable Chinese recovery guidance for login and Boss verification pauses', async () => {
  const h = await loadFullSidepanel({
    state: {
      settings: {
        enabled: true,
        paused: true,
        pauseCode: 'LOGIN_REQUIRED'
      },
      managedConversations: {},
      pendingApprovalCount: 0
    },
    approvals: []
  });

  assert.match(h.ids.trusteeshipConfigMsg.textContent, /重新登录 Boss/);
  assert.match(h.ids.trusteeshipConfigMsg.textContent, /手动恢复/);

  h.context.applyTrusteeshipState({
    settings: {
      enabled: true,
      paused: true,
      pauseCode: 'BOSS_BLOCKED'
    },
    managedConversations: {},
    pendingApprovalCount: 0
  });
  assert.match(h.ids.trusteeshipConfigMsg.textContent, /验证码或风控/);
  assert.match(h.ids.trusteeshipConfigMsg.textContent, /不要反复重试/);
});

test('full sidepanel gives manual recovery guidance for uncertain interrupted classification state', async () => {
  const conversation = {
    conversationId: 'conv-recovery',
    company: '恢复测试公司',
    position: '前端',
    hrName: '李',
    enabled: true,
    state: 'PAUSED',
    pauseCode: 'RECOVERY_STATE_UNCERTAIN',
    lastCheckedAt: 0
  };
  const h = await loadFullSidepanel({
    state: {
      settings: { enabled: true, paused: false },
      managedConversations: { 'conv-recovery': conversation },
      pendingApprovalCount: 0
    },
    approvals: []
  });

  const card = h.ids.managedConversations.children[0];
  const details = card.children.find((child) => child.tagName === 'P');
  assert.match(details.textContent, /恢复状态无法确认/);
  assert.match(details.textContent, /人工核对/);
});

test('full sidepanel gives stable manual guidance for normalized unknown processing pauses', async () => {
  const h = await loadFullSidepanel({
    state: {
      settings: { enabled: true, paused: false },
      managedConversations: {
        'conv-fallback': {
          conversationId: 'conv-fallback',
          company: '恢复测试公司',
          position: '前端',
          hrName: '李',
          enabled: true,
          state: 'PAUSED',
          pauseCode: 'UNKNOWN_PROCESSING_FAILURE',
          lastCheckedAt: 0
        }
      },
      pendingApprovalCount: 0
    },
    approvals: []
  });

  const details = h.ids.managedConversations.children[0].children
    .find((child) => child.tagName === 'P');
  assert.match(details.textContent, /处理状态异常/);
  assert.match(details.textContent, /人工核对后重试/);
});

test('full sidepanel identifies a Boss message-structure pause', async () => {
  const h = await loadFullSidepanel({
    state: {
      settings: { enabled: true, paused: false },
      managedConversations: {
        'conv-order': {
          conversationId: 'conv-order',
          company: '结构测试公司',
          position: '前端',
          hrName: '李',
          enabled: true,
          state: 'PAUSED',
          pauseCode: 'MESSAGE_ORDER_UNCERTAIN',
          lastCheckedAt: 0
        }
      },
      pendingApprovalCount: 0
    },
    approvals: []
  });

  const details = h.ids.managedConversations.children[0].children
    .find((child) => child.tagName === 'P');
  assert.match(details.textContent, /Boss 消息结构发生变化/);
  assert.match(details.textContent, /停止自动回复/);
});

test('full sidepanel identifies missing history baselines and content-script failures', async () => {
  for (const [pauseCode, expectedText] of [
    ['BASELINE_NOT_FOUND', /历史消息基线已失效/],
    ['BASELINE_REQUIRED', /登记消息基线缺失/],
    ['CONTENT_SCRIPT_UNAVAILABLE', /后台页面脚本未就绪/]
  ]) {
    const h = await loadFullSidepanel({
      state: {
        settings: { enabled: true, paused: false },
        managedConversations: {
          ['conv-' + pauseCode]: {
            conversationId: 'conv-' + pauseCode,
            company: '诊断公司',
            position: '前端',
            hrName: '李',
            enabled: true,
            state: 'PAUSED',
            pauseCode,
            lastCheckedAt: 0
          }
        },
        pendingApprovalCount: 0
      },
      approvals: []
    });
    const details = h.ids.managedConversations.children[0].children
      .find((child) => child.tagName === 'P');
    assert.match(details.textContent, expectedText);
  }
});

test('full sidepanel offers a non-destructive retry for a transient unavailable pause', async () => {
  const sent = [];
  const conversation = {
    conversationId: 'conv-unavailable',
    company: '甲公司',
    position: '前端',
    hrName: '李',
    enabled: true,
    state: 'PAUSED',
    pauseCode: 'CONVERSATION_UNAVAILABLE',
    lastCheckedAt: 0
  };
  const h = await loadFullSidepanel({
    state: {
      settings: { enabled: true, paused: false },
      managedConversations: { 'conv-unavailable': conversation },
      pendingApprovalCount: 0
    },
    approvals: []
  });
  h.context.chrome.runtime.sendMessage = (message, callback) => {
    sent.push(message);
    callback(message.type === 'TRUSTEESHIP_SET_CONVERSATION'
      ? { ok: true }
      : { ok: true, settings: { enabled: true, paused: false }, managedConversations: {}, pendingApprovalCount: 0 });
  };

  const retry = findDescendants(h.ids.managedConversations, 'button')
    .find((button) => button.textContent === '重试托管');
  assert.ok(retry);
  await retry.trigger('click');
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0])), {
    type: 'TRUSTEESHIP_SET_CONVERSATION',
    conversationId: 'conv-unavailable',
    enabled: true
  });
});

test('full sidepanel shows the automatic retry progress instead of a pause for a deferred read failure', async () => {
  const h = await loadFullSidepanel({
    state: {
      settings: { enabled: true, paused: false },
      managedConversations: {
        'conv-deferred': {
          conversationId: 'conv-deferred',
          company: '重试测试公司',
          position: '前端',
          hrName: '李',
          enabled: true,
          state: 'WAITING_HR',
          pauseCode: '',
          readFailureCount: 2,
          readRetryLimit: 3,
          lastReadErrorCode: 'CONTENT_SCRIPT_UNAVAILABLE',
          lastCheckedAt: 0
        }
      },
      pendingApprovalCount: 0
    },
    approvals: []
  });

  const card = h.ids.managedConversations.children[0];
  const details = card.children.find((child) => child.tagName === 'P');
  assert.match(details.textContent, /状态：等待 HR/);
  assert.match(details.textContent, /上次检查失败（后台页面脚本未就绪，请重试托管）/);
  assert.match(details.textContent, /第 2\/3 次，下轮自动重试/);
  assert.equal(
    findDescendants(h.ids.managedConversations, 'button')
      .some((button) => button.textContent === '重试托管'),
    false
  );
});

test('full sidepanel reports a failed manual monitoring cycle instead of claiming completion', async () => {
  const h = await loadFullSidepanel({
    state: {
      settings: { enabled: true, paused: false },
      managedConversations: {},
      pendingApprovalCount: 0
    },
    approvals: [],
    runNow: () => ({
      ok: true,
      summary: {
        checked: 0,
        newMessages: 0,
        autoSent: 0,
        pending: 0,
        skipped: 0,
        errors: ['CONVERSATION_UNAVAILABLE']
      }
    })
  });

  await h.ids.btnRunTrusteeshipNow.trigger('click');

  assert.match(h.ids.trusteeshipConfigMsg.textContent, /检查未全部完成/);
  assert.match(h.ids.trusteeshipConfigMsg.textContent, /成功检查 0 个/);
});

test('full sidepanel tells the user to enable and save trusteeship when a manual check is globally gated', async () => {
  const h = await loadFullSidepanel({
    state: {
      settings: {
        enabled: false,
        paused: true,
        pauseCode: 'PREREQUISITE_CHANGED'
      },
      managedConversations: {
        'conv-1': {
          conversationId: 'conv-1',
          company: '甲公司',
          position: '前端',
          hrName: '李',
          enabled: true,
          state: 'WAITING_HR'
        }
      },
      pendingApprovalCount: 0
    },
    approvals: [],
    runNow: () => ({
      ok: false,
      code: 'TRUSTEESHIP_NOT_RUNNING'
    })
  });

  await h.ids.btnRunTrusteeshipNow.trigger('click');

  assert.equal(
    h.ids.trusteeshipConfigMsg.textContent,
    '无法开始检查：请先开启 AI 对话托管并保存设置'
  );
});

test('full sidepanel stages one bounded live drill only after explicit consent', async () => {
  const result = {
    conversationId: 'conv-1',
    message: '还在看机会吗？',
    classification: {
      category: 'still_looking',
      confidence: 0.91,
      reasonCode: 'SAFE',
      evidenceIds: ['faq-line-1'],
      fieldsNeeded: []
    },
    decision: { action: 'AUTO_REPLY', reasonCode: 'AUTO_REPLY_ALLOWED' },
    draft: '是的，我还在看合适机会。',
    draftEvidenceIds: ['faq-line-1'],
    approvalId: 'approval-live-drill',
    sentToBoss: false,
    notificationStatus: 'SUCCESS',
    liveDrill: true
  };
  const h = await loadFullSidepanel({
    state: {
      settings: { enabled: true, paused: false },
      managedConversations: {
        'conv-1': {
          conversationId: 'conv-1',
          company: '甲公司',
          position: '前端工程师',
          hrName: '李经理',
          state: 'WAITING_HR',
          enabled: true
        }
      },
      pendingApprovalCount: 0
    },
    approvals: [],
    liveDrill: () => ({ ok: true, result })
  });
  h.ids.trusteeshipLiveDrillConversation.value = 'conv-1';
  h.ids.trusteeshipLiveDrillMessage.value = '  还在看机会吗？  ';

  await h.ids.btnRunTrusteeshipLiveDrill.trigger('click');
  assert.match(h.ids.trusteeshipLiveDrillStatus.textContent, /请先确认本轮演练可能真实发送/);
  assert.equal(h.sent.some((item) => item.type === 'TRUSTEESHIP_STAGE_LIVE_DRILL'), false);

  h.ids.trusteeshipLiveDrillConsent.checked = true;
  await h.ids.btnRunTrusteeshipLiveDrill.trigger('click');
  assert.deepEqual({
    ...h.sent.find((item) => item.type === 'TRUSTEESHIP_STAGE_LIVE_DRILL')
  }, {
    type: 'TRUSTEESHIP_STAGE_LIVE_DRILL',
    conversationId: 'conv-1',
    message: '还在看机会吗？'
  });
  const rendered = h.ids.trusteeshipLiveDrillResult.children
    .map((child) => child.textContent)
    .join('|');
  assert.match(rendered, /AUTO_REPLY/);
  assert.match(rendered, /是的，我还在看合适机会/);
  assert.match(rendered, /approval-live-drill/);
  assert.match(rendered, /飞书通知已发送/);
  assert.match(rendered, /已创建真实发送待确认，当前尚未发送给 HR/);
  h.context.renderTrusteeshipLiveDrillResult({
    ...result,
    classification: {
      category: 'explicit_rejection',
      confidence: 0.99,
      reasonCode: 'EXPLICIT_REJECTION',
      evidenceIds: [],
      fieldsNeeded: []
    },
    decision: {
      action: 'AUTO_CLOSE',
      reasonCode: 'EXPLICIT_REJECTION_AUTO_CLOSE'
    },
    draft: '好的，感谢您的回复，祝工作顺利。'
  });
  assert.match(
    h.ids.trusteeshipLiveDrillResult.children
      .map((child) => child.textContent)
      .join('|'),
    /AUTO_CLOSE/
  );
  assert.equal(h.ids.btnRunTrusteeshipLiveDrill.disabled, false);
  assert.equal(h.ids.trusteeshipLiveDrillConsent.checked, false);
});

test('full sidepanel validates live drill inputs and masks provider failures', async () => {
  const h = await loadFullSidepanel({
    state: {
      settings: { enabled: true, paused: false },
      managedConversations: {},
      pendingApprovalCount: 0
    },
    approvals: [],
    liveDrill: () => ({ ok: false, code: 'provider-secret-live-drill-canary' })
  });

  await h.ids.btnRunTrusteeshipLiveDrill.trigger('click');
  assert.match(h.ids.trusteeshipLiveDrillStatus.textContent, /请选择已登记会话/);
  assert.equal(h.sent.some((item) => item.type === 'TRUSTEESHIP_STAGE_LIVE_DRILL'), false);

  h.ids.trusteeshipLiveDrillConversation.value = 'conv-1';
  await h.ids.btnRunTrusteeshipLiveDrill.trigger('click');
  assert.match(h.ids.trusteeshipLiveDrillStatus.textContent, /请输入模拟 HR 消息/);

  h.ids.trusteeshipLiveDrillMessage.value = '您好';
  h.ids.trusteeshipLiveDrillConsent.checked = true;
  await h.ids.btnRunTrusteeshipLiveDrill.trigger('click');
  assert.equal(h.ids.trusteeshipLiveDrillStatus.textContent.includes('provider-secret'), false);
  assert.equal(h.ids.btnRunTrusteeshipLiveDrill.disabled, false);
});

test('full sidepanel status and managed DOM mask unknown provider and credential-shaped pause canaries', async () => {
  const canary = 'provider-raw-error-CANARY-sidepanel-4b92';
  const h = await loadFullSidepanel({
    state: {
      settings: { enabled: true, paused: true, pauseCode: canary },
      managedConversations: {
        'conv-sensitive': {
          conversationId: 'conv-sensitive',
          company: '甲公司',
          position: '前端',
          hrName: '李',
          enabled: true,
          state: 'PAUSED',
          pauseCode: canary,
          lastCheckedAt: 0
        }
      },
      pendingApprovalCount: 0
    },
    approvals: []
  });

  const visibleText = JSON.stringify(Object.fromEntries(
    Object.entries(h.ids).map(([id, element]) => [id, element.textContent])
  )) + JSON.stringify(h.ids.managedConversations.children.map((card) =>
    card.children.map((child) => child.textContent)
  ));
  assert.equal(visibleText.includes(canary), false);
  assert.equal(h.ids.trusteeshipStatus.textContent, '托管已暂停');
  assert.match(h.ids.managedConversations.children[0].children[1].textContent, /人工核对/);
});
