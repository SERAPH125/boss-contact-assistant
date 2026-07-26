// ===== 求职联系助手 · 侧边栏 =====
const $ = (id) => document.getElementById(id);

let currentTab = 'setup';
let activePlatform = 'boss';
let screenedCache = [];
let riskAccepted = false;
let byPlatformCache = {};
let runActive = false;
let pendingDeliveryIntentId = '';
let deliveryModalReturnFocus = null;
let deliveryConfirmationSubmitting = false;

// TRUSTEESHIP_UI_CONTROLLER_START
(function (root) {
  function failureText(code) {
    const messages = {
      MISSING_PREREQUISITE: '请补全开启托管的前置条件',
      TRUSTEESHIP_PREREQUISITE_FAILED: '请补全开启托管的前置条件',
      API_CONFIG_NOT_VERIFIED: '请先测试 API 配置',
      FEISHU_CONFIG_INVALID: '请检查飞书通知配置',
      RISK_NOT_ACCEPTED: '请先确认平台风险提示',
      SEND_RESULT_UNKNOWN: '发送结果未知，请人工核对 Boss 会话后再处理',
      TRUSTEESHIP_ACK_UNKNOWN_FAILED: '该记录暂时无法清除，请刷新后重试',
      CONVERSATION_NOT_REGISTERED: '该会话不可托管',
      SERVICE_WORKER_INTERRUPTED: '后台服务已中断，请重新打开扩展'
    };
    return messages[code] || '操作未完成，请稍后重试';
  }

  function missingText(missing) {
    const labels = {
      api: 'API 配置与测试',
      replyEvidence: '简历要点或 HR 常用问答',
      resumeText: '简历要点或 HR 常用问答',
      feishuTest: '飞书测试通知',
      riskAccepted: '平台风险确认'
    };
    const order = ['api', 'replyEvidence', 'resumeText', 'feishuTest', 'riskAccepted'];
    const list = Array.isArray(missing) ? missing : [];
    return order.filter((key) => list.indexOf(key) !== -1).map((key) => labels[key]);
  }

  function createController(deps) {
    async function saveSettings(payload, previousEnabled) {
      const response = await deps.send(Object.assign({ type: 'TRUSTEESHIP_SAVE_SETTINGS' }, payload));
      if (response && response.ok === true) return response;
      deps.setEnabled(previousEnabled);
      const code = response && (response.code || response.errorCode);
      const prerequisites = missingText(response && response.missing);
      deps.status('保存失败：' + (prerequisites.length ? '请完成：' + prerequisites.join('、') : failureText(code)));
      if (typeof deps.guide === 'function') {
        const missing = response && response.missing;
        deps.guide(Array.isArray(missing) ? missing : [missing]);
      }
      return response || { ok: false };
    }

    async function resolveApproval(card, action) {
      deps.disableCard(card.id, true);
      const message = {
        type: 'TRUSTEESHIP_RESOLVE_APPROVAL',
        approvalId: card.id,
        action: action
      };
      if (action === 'SEND_EDITED') message.draft = card.draft;
      let response;
      try {
        response = await deps.send(message);
      } catch (_) {
        response = { ok: false, code: 'SERVICE_WORKER_INTERRUPTED' };
      }
      const code = response && (response.code || response.errorCode);
      if (code === 'SEND_RESULT_UNKNOWN') {
        deps.status(failureText(code));
        await deps.refreshApprovals();
        return response || { ok: false };
      }
      deps.disableCard(card.id, false);
      if (!response || response.ok !== true) {
        deps.status(failureText(code));
        return response || { ok: false };
      }
      await deps.refreshApprovals();
      return response;
    }

    async function setConversation(conversationId, enabled, previousEnabled) {
      let response;
      try {
        response = await deps.send({
          type: 'TRUSTEESHIP_SET_CONVERSATION',
          conversationId: conversationId,
          enabled: enabled
        });
      } catch (_) {
        response = { ok: false, code: 'SERVICE_WORKER_INTERRUPTED' };
      }
      if (!response || response.ok !== true) {
        deps.setConversationEnabled(conversationId, previousEnabled);
        deps.status('更新失败：' + failureText(response && (response.code || response.errorCode)));
      }
      return response || { ok: false };
    }

    return { saveSettings: saveSettings, resolveApproval: resolveApproval, setConversation: setConversation };
  }

  root.TrusteeshipSidepanel = { createController: createController };
})(globalThis);
// TRUSTEESHIP_UI_CONTROLLER_END

let trusteeshipSnapshot = { settings: {}, managedConversations: {}, pendingApprovalCount: 0 };

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function meta() {
  return getPlatform(activePlatform);
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response || {});
    });
  });
}

function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.page').forEach((p) => {
    p.classList.toggle('hidden', p.dataset.page !== tab);
    p.hidden = p.dataset.page !== tab;
  });
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab);
    t.setAttribute('aria-selected', t.dataset.tab === tab ? 'true' : 'false');
  });
  if (tab === 'approvals') refreshApprovals();
}

function showSetup(page) {
  ['platform', 'api', 'filter', 'trusteeship'].forEach((id) => {
    const el = $('setup-' + id);
    if (el) el.classList.toggle('hidden', page !== id);
  });
  document.querySelectorAll('.subtab').forEach((t) => {
    t.classList.toggle('active', t.dataset.setup === page);
    t.setAttribute('aria-selected', t.dataset.setup === page ? 'true' : 'false');
  });
}

function stableTrusteeshipError(code) {
  const messages = {
    MISSING_PREREQUISITE: '请补全开启托管所需配置',
    TRUSTEESHIP_PREREQUISITE_FAILED: '请补全开启托管所需配置',
    TRUSTEESHIP_NOT_RUNNING: '请先开启 AI 对话托管并保存设置',
    API_CONFIG_NOT_VERIFIED: '请先测试 API 配置',
    FEISHU_CONFIG_INVALID: '请检查飞书通知配置',
    RISK_NOT_ACCEPTED: '请先确认平台风险提示',
    SEND_RESULT_UNKNOWN: '发送结果未知，请人工核对 Boss 会话',
    TRUSTEESHIP_ACK_UNKNOWN_FAILED: '该记录暂时无法清除，请刷新后重试',
    CONVERSATION_NOT_REGISTERED: '该会话不可托管',
    SERVICE_WORKER_INTERRUPTED: '后台服务已中断，请重新打开扩展',
    ACTIVE_CHAT_REQUIRED: '请先打开并聚焦 Boss 聊天页中的目标会话',
    CONTENT_SCRIPT_UNAVAILABLE: '无法连接 Boss 聊天页，请刷新页面后重试',
    UNRELIABLE_CONVERSATION_REF: '当前会话标识不可靠，无法登记',
    CONVERSATION_REF_CONFLICT: '该会话已用其他岗位登记，请先处理冲突',
    TRUSTEESHIP_REGISTER_FAILED: '登记失败，请稍后重试',
    PEER_ID_UNRESOLVED: '无法确认稳定会话标识（encryptUid），请刷新聊天页后重试',
    PEER_LIST_UNAVAILABLE: '无法读取 Boss 好友列表，请确认已登录后重试',
    TARGET_UNCERTAIN: '目标会话无法确认',
    SELECTOR_UNAVAILABLE: '页面结构暂不可用',
    LOGIN_REQUIRED: '需要重新登录 Boss',
    BOSS_BLOCKED: 'Boss 页面已阻止操作',
    API_PROOF_STALE: 'API 测试证明已失效，请重新测试 API',
    AI_CLASSIFY_FAILED: 'AI 分类失败，请检查 API 后重试',
    AI_CLASSIFICATION_INVALID: 'AI 分类结果无法安全接受',
    AI_DRAFT_FAILED: 'AI 草稿生成失败，请检查 API 后重试',
    AI_DRAFT_INVALID: 'AI 草稿结果无法安全接受',
    UNSUPPORTED_PLATFORM: '仅支持已登记的 Boss 会话',
    LIVE_DRILL_NOT_ALLOWED: '该会话当前不可演练，请先处理待确认、暂停或发送中的任务',
    TRUSTEESHIP_LIVE_DRILL_FAILED: '真实外发演练失败，请稍后重试'
  };
  return messages[code] || '操作未完成，请稍后重试';
}

function setTrusteeshipMessage(text) {
  if ($('trusteeshipConfigMsg')) $('trusteeshipConfigMsg').textContent = text || '';
}

function focusTrusteeshipTarget(targets) {
  const order = ['api', 'replyEvidence', 'resumeText', 'feishuTest', 'riskAccepted'];
  const target = order.find((item) => Array.isArray(targets) && targets.indexOf(item) !== -1) || targets[0];
  showTab('setup');
  if (target === 'api') {
    showSetup('api');
    const field = $('apiKey') || $('btnTestApi');
    if (field) field.focus();
    return;
  }
  if (target === 'replyEvidence' || target === 'resumeText') {
    showSetup('trusteeship');
    const firstPreset = document.querySelector('#hrFaqPresets .hr-faq-enabled');
    if (firstPreset) firstPreset.focus();
    else if ($('btnAddHrFaq')) $('btnAddHrFaq').focus();
    setTrusteeshipMessage('请勾选并填写基础问答，或到「求职设置」填写简历要点（至少一项）。');
    return;
  }
  if (target === 'feishuTest') {
    showSetup('trusteeship');
    if ($('btnTestFeishu')) $('btnTestFeishu').focus();
    return;
  }
  if (target === 'riskAccepted') {
    showSetup('trusteeship');
    setTrusteeshipMessage('请先确认平台风险提示后再开启托管。');
  }
}

const HR_FAQ_MAX = 20;

/** 基础问题预设（仅低风险沟通类；薪资/面试/到岗等不提供预设） */
const HR_FAQ_PRESETS = [
  {
    id: 'still_looking',
    question: '还在看机会吗？',
    placeholder: '如：是的，我还在看合适机会。'
  },
  {
    id: 'resume_permission',
    question: '方便发一份简历吗？',
    placeholder: '如：方便，我可以发一份近况简历。'
  },
  {
    id: 'interested',
    question: '对这个岗位感兴趣吗？',
    placeholder: '如：感兴趣，想进一步了解岗位与团队情况。'
  },
  {
    id: 'city',
    question: '目前在哪个城市？',
    placeholder: '如：目前在杭州。'
  },
  {
    id: 'seen_message',
    question: '看到消息了吗？',
    placeholder: '如：看到了，稍等我回复您。'
  },
  {
    id: 'please_wait',
    question: '现在方便聊吗？',
    placeholder: '如：方便的，您可以先说下岗位要点。'
  }
];

function normalizeFaqQuestion(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function readHrFaqFromDom() {
  const items = [];
  const seen = new Set();
  function pushItem(question, answer) {
    const q = String(question || '').trim();
    const a = String(answer || '').trim();
    if (!q && !a) return;
    const key = normalizeFaqQuestion(q);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    items.push({ question: q, answer: a });
  }
  document.querySelectorAll('#hrFaqPresets .hr-faq-preset').forEach((row) => {
    const enabled = row.querySelector('.hr-faq-enabled');
    if (!enabled || !enabled.checked) return;
    const question = row.getAttribute('data-question') || '';
    const answer = (row.querySelector('.hr-faq-a') || {}).value || '';
    pushItem(question, answer);
  });
  document.querySelectorAll('#hrFaqList .hr-faq-item').forEach((row) => {
    const question = (row.querySelector('.hr-faq-q') || {}).value || '';
    const answer = (row.querySelector('.hr-faq-a') || {}).value || '';
    pushItem(question, answer);
  });
  return items.slice(0, HR_FAQ_MAX);
}

function syncPresetRowState(row) {
  const enabled = row.querySelector('.hr-faq-enabled');
  const answer = row.querySelector('.hr-faq-a');
  const on = !!(enabled && enabled.checked);
  row.classList.toggle('is-off', !on);
  if (answer) {
    answer.disabled = !on;
    if (on) answer.removeAttribute('aria-disabled');
    else answer.setAttribute('aria-disabled', 'true');
  }
}

function renderHrFaqPresets(savedByQuestion) {
  const box = $('hrFaqPresets');
  if (!box) return;
  box.textContent = '';
  HR_FAQ_PRESETS.forEach((preset) => {
    const saved = savedByQuestion.get(normalizeFaqQuestion(preset.question));
    const row = document.createElement('div');
    row.className = 'hr-faq-preset';
    row.setAttribute('data-preset-id', preset.id);
    row.setAttribute('data-question', preset.question);
    const check = document.createElement('label');
    check.className = 'check-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'hr-faq-enabled';
    input.checked = !!saved;
    const title = document.createElement('span');
    title.textContent = preset.question;
    check.appendChild(input);
    check.appendChild(title);
    const answer = document.createElement('textarea');
    answer.className = 'hr-faq-a';
    answer.rows = 2;
    answer.maxLength = 600;
    answer.placeholder = preset.placeholder || '填写你的标准回答';
    answer.value = saved && saved.answer ? saved.answer : '';
    input.addEventListener('change', () => {
      syncPresetRowState(row);
      if (input.checked) answer.focus();
    });
    row.appendChild(check);
    row.appendChild(answer);
    box.appendChild(row);
    syncPresetRowState(row);
  });
}

function addHrFaqRow(item) {
  const list = $('hrFaqList');
  if (!list) return;
  const presetCount = document.querySelectorAll('#hrFaqPresets .hr-faq-preset .hr-faq-enabled:checked').length;
  const customCount = list.querySelectorAll('.hr-faq-item').length;
  if (presetCount + customCount >= HR_FAQ_MAX) {
    setTrusteeshipMessage('常用问答最多 ' + HR_FAQ_MAX + ' 条。');
    return;
  }
  const row = document.createElement('div');
  row.className = 'hr-faq-item';
  const qLabel = document.createElement('label');
  qLabel.textContent = '自定义问题';
  const qInput = document.createElement('input');
  qInput.type = 'text';
  qInput.className = 'hr-faq-q';
  qInput.maxLength = 200;
  qInput.placeholder = '如：是否接受偶尔加班？';
  qInput.value = item && item.question ? item.question : '';
  const aLabel = document.createElement('label');
  aLabel.textContent = '标准回答';
  const aInput = document.createElement('textarea');
  aInput.className = 'hr-faq-a';
  aInput.rows = 2;
  aInput.maxLength = 600;
  aInput.placeholder = '填写你的标准回答';
  aInput.value = item && item.answer ? item.answer : '';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn-ghost hr-faq-remove';
  remove.textContent = '删除';
  remove.addEventListener('click', () => {
    row.remove();
  });
  row.appendChild(qLabel);
  row.appendChild(qInput);
  row.appendChild(aLabel);
  row.appendChild(aInput);
  row.appendChild(remove);
  list.appendChild(row);
}

function renderHrFaq(items) {
  const list = $('hrFaqList');
  if (!list) return;
  const saved = Array.isArray(items) ? items.slice(0, HR_FAQ_MAX) : [];
  const savedByQuestion = new Map();
  saved.forEach((item) => {
    if (!item || !item.question) return;
    savedByQuestion.set(normalizeFaqQuestion(item.question), item);
  });
  renderHrFaqPresets(savedByQuestion);
  list.textContent = '';
  const custom = saved.filter((item) => {
    if (!item || !item.question) return !!(item && item.answer);
    return !HR_FAQ_PRESETS.some(
      (preset) => normalizeFaqQuestion(preset.question) === normalizeFaqQuestion(item.question)
    );
  });
  custom.forEach((item) => addHrFaqRow(item));
}

function applyTrusteeshipState(state) {
  trusteeshipSnapshot = state || trusteeshipSnapshot;
  const settings = trusteeshipSnapshot.settings || {};
  const feishu = trusteeshipSnapshot.feishuNotification || {};
  if ($('trusteeshipEnabled')) $('trusteeshipEnabled').checked = settings.enabled === true;
  if ($('trusteeshipInterval')) $('trusteeshipInterval').value = String(settings.intervalMinutes || 10);
  if ($('autoReplyDailyLimit')) $('autoReplyDailyLimit').value = String(settings.dailyAutoReplyLimit || 10);
  const quiet = settings.quietHours || {};
  if ($('quietHoursEnabled')) $('quietHoursEnabled').checked = quiet.enabled === true;
  if ($('quietHoursStart')) $('quietHoursStart').value = quiet.start || '22:00';
  if ($('quietHoursEnd')) $('quietHoursEnd').value = quiet.end || '08:00';
  if ($('feishuEnabled')) $('feishuEnabled').checked = feishu.enabled === true;
  if ($('feishuWebhook')) $('feishuWebhook').placeholder = feishu.hasWebhook ? '已保存；重新输入可替换' : '';
  if ($('feishuSigningSecret')) $('feishuSigningSecret').placeholder = feishu.hasSigningSecret ? '已保存；重新输入可替换' : '';
  renderHrFaq(trusteeshipSnapshot.hrFaq);
  const pending = Number(trusteeshipSnapshot.pendingApprovalCount) || 0;
  const conversations = Object.values(trusteeshipSnapshot.managedConversations || {});
  const active = conversations.filter((conversation) =>
    conversation &&
    conversation.enabled === true &&
    conversation.state !== 'ENDED_UNMATCHED'
  ).length;
  const status = settings.enabled !== true ? '托管已关闭'
    : settings.paused === true ? '托管已暂停'
      : pending > 0 ? '等待确认 ' + pending + ' 条'
        : '正在托管 ' + active + ' 个岗位';
  if ($('trusteeshipStatus')) $('trusteeshipStatus').textContent = status;
  if (settings.paused === true && settings.pauseCode === 'LOGIN_REQUIRED') {
    setTrusteeshipMessage('Boss 登录已失效，请重新登录 Boss；确认页面正常后在插件中手动恢复托管。');
  } else if (settings.paused === true && settings.pauseCode === 'BOSS_BLOCKED') {
    setTrusteeshipMessage('Boss 页面出现验证码或风控，请先手动处理并等待恢复，不要反复重试；确认正常后再手动恢复托管。');
  }
  updateApprovalBadge(pending);
  renderManagedConversations(conversations);
}

async function refreshTrusteeshipState() {
  try {
    const response = await sendRuntimeMessage({ type: 'TRUSTEESHIP_GET_STATE' });
    if (response && response.ok === true) applyTrusteeshipState(response);
  } catch (_) {
    if ($('trusteeshipStatus')) $('trusteeshipStatus').textContent = '托管已暂停';
  }
}

function updateApprovalBadge(count) {
  const label = '待确认 ' + count + ' 条';
  ['approvalBadge', 'approvalTabBadge'].forEach((id) => {
    const badge = $(id);
    if (badge) {
      badge.textContent = String(count);
      badge.setAttribute('aria-label', label);
    }
  });
}

function setManagedConversationEnabled(conversationId, enabled) {
  const checkbox = document.querySelector('#managedConversations input[data-conversation-id="' + conversationId + '"]');
  if (checkbox) checkbox.checked = enabled === true;
}

function renderTrusteeshipLiveDrillConversations(conversations) {
  const select = $('trusteeshipLiveDrillConversation');
  if (!select) return;
  const previous = select.value;
  select.replaceChildren();
  if (!conversations.length) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '暂无已登记岗位';
    select.appendChild(empty);
    select.value = '';
    return;
  }
  conversations.forEach((conversation) => {
    const option = document.createElement('option');
    option.value = String(conversation.conversationId || '').slice(0, 128);
    option.textContent = (
      (conversation.company || '未知公司') +
      ' · ' +
      (conversation.position || '未知岗位') +
      ' · ' +
      (conversation.hrName || '未知 HR')
    ).slice(0, 300);
    select.appendChild(option);
  });
  const preserved = conversations.some(
    (conversation) => conversation && conversation.conversationId === previous
  );
  select.value = preserved ? previous : String(conversations[0].conversationId || '');
}

function simulationText(value, limit) {
  return typeof value === 'string'
    ? Array.from(value).slice(0, limit).join('')
    : '';
}

function renderTrusteeshipLiveDrillResult(result) {
  const root = $('trusteeshipLiveDrillResult');
  if (!root) return;
  root.replaceChildren();
  const source = result && typeof result === 'object' ? result : {};
  const classification = source.classification && typeof source.classification === 'object'
    ? source.classification
    : {};
  const decision = source.decision && typeof source.decision === 'object'
    ? source.decision
    : {};
  const rows = [
    ['AI 分类', simulationText(classification.category, 80) || '无可信分类'],
    ['置信度', Number.isFinite(classification.confidence)
      ? String(Math.round(classification.confidence * 100)) + '%'
      : '—'],
    ['AI 原因', simulationText(classification.reasonCode, 120) || '—'],
    ['引用依据', Array.isArray(classification.evidenceIds) && classification.evidenceIds.length
      ? classification.evidenceIds.map((id) => simulationText(id, 160)).join('、')
      : '无'],
    ['策略动作', decision.action === 'AUTO_REPLY' ||
      decision.action === 'AUTO_CLOSE' ||
      decision.action === 'REQUIRE_CONFIRMATION'
      ? decision.action
      : 'REQUIRE_CONFIRMATION'],
    ['策略原因', simulationText(decision.reasonCode, 120) || '—'],
    ['拟回复', simulationText(source.draft, 300) || '无'],
    ['待确认编号', simulationText(source.approvalId, 160) || '—'],
    ['飞书通知', source.notificationStatus === 'SUCCESS'
      ? '飞书通知已发送'
      : source.notificationStatus === 'FAILED'
        ? '飞书通知失败，可在后续周期按规则重试'
        : source.notificationStatus === 'UNKNOWN'
          ? '飞书通知结果未知'
          : '本轮未发送飞书通知'],
    ['当前状态', '已创建待确认，尚未发送给 HR']
  ];
  rows.forEach(([label, value]) => {
    const line = document.createElement('p');
    line.textContent = label + '：' + value;
    root.appendChild(line);
  });
  const marker = document.createElement('p');
  marker.className = 'live-drill-marker';
  marker.textContent = '已创建真实发送待确认，当前尚未发送给 HR';
  root.appendChild(marker);
}

function renderManagedConversations(conversations) {
  renderTrusteeshipLiveDrillConversations(conversations);
  const container = $('managedConversations');
  if (!container) return;
  const heading = $('managedConversationsHeading');
  if (heading) heading.textContent = '已登记岗位（' + conversations.length + '）';
  container.replaceChildren();
  if (!conversations.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '暂无已登记岗位。可先联系岗位，或打开 Boss 聊天页后点上方「从当前 Boss 聊天页登记」。';
    container.appendChild(empty);
    return;
  }
  conversations.forEach((conversation) => {
    const card = document.createElement('article');
    card.className = 'managed-conversation';
    const title = document.createElement('h3');
    title.textContent = (conversation.company || '未知公司') + ' · ' + (conversation.position || '未知岗位');
    const details = document.createElement('p');
    details.className = 'managed-meta';
    details.textContent = 'HR：' + (conversation.hrName || '未知') + '｜状态：' + managedStateText(conversation.state) + (conversation.pauseCode ? '｜' + pauseText(conversation.pauseCode) : '') + readRetryText(conversation) + '｜' + lastCheckedText(conversation.lastCheckedAt);
    const label = document.createElement('label');
    label.className = 'check-row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = conversation.enabled === true;
    input.setAttribute('data-conversation-id', conversation.conversationId || '');
    label.append(input, document.createTextNode(' 托管此岗位'));
    input.addEventListener('change', async () => {
      const wanted = input.checked;
      const previous = !wanted;
      if (!wanted && !window.confirm('关闭后会删除该会话保存的最近聊天上下文，并停止托管。是否继续？')) {
        input.checked = true;
        return;
      }
      input.disabled = true;
      const controller = TrusteeshipSidepanel.createController({
        send: sendRuntimeMessage,
        setConversationEnabled: setManagedConversationEnabled,
        status: setTrusteeshipMessage
      });
      const response = await controller.setConversation(conversation.conversationId, wanted, previous);
      input.disabled = false;
      if (response && response.ok === true) await refreshTrusteeshipState();
    });
    const actions = document.createElement('div');
    actions.className = 'managed-actions';
    if (conversation.state === 'PAUSED' &&
        ['CONVERSATION_UNAVAILABLE', 'SELECTOR_UNAVAILABLE', 'CONTENT_SCRIPT_UNAVAILABLE'].includes(conversation.pauseCode)) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn-ghost';
      retry.textContent = '重试托管';
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        try {
          const result = await sendRuntimeMessage({
            type: 'TRUSTEESHIP_SET_CONVERSATION',
            conversationId: conversation.conversationId,
            enabled: true
          });
          if (!result || result.ok !== true) {
            setTrusteeshipMessage(
              '恢复失败：' + stableTrusteeshipError(result && (result.code || result.errorCode))
            );
            retry.disabled = false;
            return;
          }
          setTrusteeshipMessage('已恢复该岗位托管，可再次立即检查。');
          await refreshTrusteeshipState();
        } catch (_) {
          setTrusteeshipMessage(
            '恢复失败：' + stableTrusteeshipError('SERVICE_WORKER_INTERRUPTED')
          );
          retry.disabled = false;
        }
      });
      actions.append(retry);
    }
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn-ghost';
    open.textContent = '打开会话';
    open.addEventListener('click', async () => {
      open.disabled = true;
      try {
        const result = await sendRuntimeMessage({
          type: 'TRUSTEESHIP_OPEN_CONVERSATION',
          conversationId: conversation.conversationId
        });
        if (!result || result.ok !== true) {
          setTrusteeshipMessage(
            '无法打开会话：' + stableTrusteeshipError(result && (result.code || result.errorCode))
          );
        }
      } catch (_) {
        setTrusteeshipMessage(
          '无法打开会话：' + stableTrusteeshipError('SERVICE_WORKER_INTERRUPTED')
        );
      } finally {
        open.disabled = false;
      }
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-ghost managed-remove';
    remove.textContent = '从列表移除';
    remove.addEventListener('click', async () => {
      if (!window.confirm('将彻底删除该岗位的登记与待确认记录，且不可恢复。是否继续？')) {
        return;
      }
      remove.disabled = true;
      open.disabled = true;
      input.disabled = true;
      try {
        const result = await sendRuntimeMessage({
          type: 'TRUSTEESHIP_REMOVE_CONVERSATION',
          conversationId: conversation.conversationId
        });
        if (!result || result.ok !== true) {
          setTrusteeshipMessage(
            '移除失败：' + stableTrusteeshipError(result && (result.code || result.errorCode))
          );
          remove.disabled = false;
          open.disabled = false;
          input.disabled = false;
          return;
        }
        setTrusteeshipMessage('已从列表移除该岗位登记。');
        await refreshTrusteeshipState();
      } catch (_) {
        setTrusteeshipMessage(
          '移除失败：' + stableTrusteeshipError('SERVICE_WORKER_INTERRUPTED')
        );
        remove.disabled = false;
        open.disabled = false;
        input.disabled = false;
      }
    });
    actions.append(open, remove);
    card.append(title, details);
    if (conversation.state !== 'ENDED_UNMATCHED') card.append(label);
    card.append(actions);
    container.appendChild(card);
  });
}

function managedStateText(state) {
  const map = {
    WAITING_HR: '等待 HR',
    WAITING_CONFIRMATION: '等待确认',
    WAITING_AUTO_CLOSE: '等待静默结束后礼貌回复',
    ENDED_UNMATCHED: '已结束－未匹配',
    PAUSED: '已暂停',
    DISABLED: '已关闭'
  };
  return map[state] || '状态待确认';
}

function pauseText(code) {
  const map = { SEND_RESULT_UNKNOWN: '发送结果未知，请人工核对', RECOVERY_STATE_UNCERTAIN: '恢复状态无法确认，请人工核对后重新开启此岗位托管', UNKNOWN_PROCESSING_FAILURE: '处理状态异常，请人工核对后重试', LOGIN_REQUIRED: '需要重新登录 Boss', BOSS_BLOCKED: 'Boss 页面已阻止操作', TARGET_UNCERTAIN: '目标会话无法确认', SELECTOR_UNAVAILABLE: '页面结构暂不可用', MESSAGE_ORDER_UNCERTAIN: 'Boss 消息结构发生变化，已停止自动回复，请人工核对', BASELINE_NOT_FOUND: '历史消息基线已失效，请打开目标会话并重新登记', BASELINE_REQUIRED: '登记消息基线缺失，请打开目标会话并重新登记', CONTENT_SCRIPT_UNAVAILABLE: '后台页面脚本未就绪，请重试托管', CONVERSATION_UNAVAILABLE: '会话暂不可用' };
  return map[code] || '已暂停，需要人工核对';
}

function readRetryText(conversation) {
  const count = Number.isSafeInteger(conversation.readFailureCount)
    ? conversation.readFailureCount
    : 0;
  if (count <= 0 || conversation.state === 'PAUSED') return '';
  const limit = Number.isSafeInteger(conversation.readRetryLimit) && conversation.readRetryLimit > 0
    ? conversation.readRetryLimit
    : 3;
  return '｜上次检查失败（' + pauseText(conversation.lastReadErrorCode) +
    '），第 ' + count + '/' + limit + ' 次，下轮自动重试';
}

function lastCheckedText(value) {
  if (!Number.isSafeInteger(value) || value <= 0) return '最近检查：暂无记录';
  return '最近检查：' + new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function trusteeshipRunMessage(response) {
  const summary = response && response.summary && typeof response.summary === 'object'
    ? response.summary
    : null;
  if (!summary) return '本轮检查已完成。';
  const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const checked = count(summary.checked);
  if (Array.isArray(summary.errors) && summary.errors.length > 0) {
    return '检查未全部完成：成功检查 ' + checked + ' 个；请查看下方岗位的失败原因，可自动重试的会在下一轮继续。';
  }
  return '本轮检查已完成：检查 ' + checked +
    ' 个，新消息 ' + count(summary.newMessages) +
    ' 条，待确认 ' + count(summary.pending) +
    ' 条，自动回复 ' + count(summary.autoSent) + ' 条。';
}

function approvalStageText(stage) {
  const map = { WAITING_CONFIRMATION: '等待确认', PAUSED: '已暂停', CLASSIFYING: '正在分类' };
  return map[stage] || '需要人工处理';
}

function approvalReasonText(code) {
  const map = {
    HARD_RISK_SALARY: '涉及薪资，需要人工确认',
    HARD_RISK_INTERVIEW: '涉及面试，需要人工确认',
    HARD_RISK_ARRIVAL: '涉及到岗，需要人工确认',
    HARD_RISK_CONTACT: '涉及联系方式，需要人工确认',
    SEND_RESULT_UNKNOWN: '发送结果未知，请先核对 Boss 会话',
    AI_CONFIDENCE_TOO_LOW: 'AI 置信度不足，需要人工确认',
    CATEGORY_REQUIRES_CONFIRMATION: '问题不在低风险范围内'
  };
  return map[code] || '需要人工确认';
}

function setApprovalCardBusy(approvalId, busy) {
  const card = document.querySelector('#approvalList [data-approval-id="' + approvalId + '"]');
  if (card) card.querySelectorAll('button, textarea').forEach((element) => {
    element.disabled = busy;
    if (element.tagName === 'TEXTAREA') element.readOnly = busy;
  });
}

async function refreshApprovals() {
  const list = $('approvalList');
  const empty = $('approvalEmpty');
  if (!list || !empty) return;
  try {
    const response = await sendRuntimeMessage({ type: 'TRUSTEESHIP_LIST_APPROVALS' });
    if (!response || response.ok !== true) throw new Error('LIST_FAILED');
    const approvals = Array.isArray(response.approvals) ? response.approvals : [];
    list.replaceChildren();
    empty.hidden = approvals.length > 0;
    updateApprovalBadge(approvals.length);
    if ($('approvalStatus')) $('approvalStatus').textContent = approvals.length ? '请逐条核对后处理。' : '';
    approvals.forEach(renderApprovals);
    await refreshTrusteeshipState();
  } catch (_) {
    if ($('approvalStatus')) $('approvalStatus').textContent = '暂时无法刷新待确认，请稍后重试。';
  }
}

function renderApprovals(approval) {
  const list = $('approvalList');
  const card = document.createElement('article');
  card.className = 'approval-card';
  card.setAttribute('data-approval-id', approval.approvalId || '');
  const title = document.createElement('h3');
  title.textContent = (approval.company || '未知公司') + ' · ' + (approval.position || '未知岗位');
  const meta = document.createElement('p');
  meta.className = 'approval-meta';
  meta.textContent = 'HR：' + (approval.hrName || '未知') + '｜阶段：' + approvalStageText(approval.stage);
  const reason = document.createElement('p');
  reason.className = 'approval-meta';
  reason.textContent = '原因：' + approvalReasonText(approval.reasonCode);
  const unknown = approval.status === 'SEND_RESULT_UNKNOWN';
  if (unknown) {
    const warning = document.createElement('p');
    warning.className = 'approval-unknown';
    warning.textContent = '发送结果未知：请先打开 Boss 会话人工核对，系统不会重试。';
    card.appendChild(warning);
  }
  const context = document.createElement('p');
  context.className = 'approval-context';
  const messages = Array.isArray(approval.messages) ? approval.messages : [];
  context.textContent = messages.map((message) => typeof message === 'string' ? message : (message && message.text) || '').filter(Boolean).join('\n');
  const fields = document.createElement('ul');
  fields.className = 'approval-field-list';
  (Array.isArray(approval.fieldsNeeded) ? approval.fieldsNeeded : []).forEach((field) => {
    const item = document.createElement('li');
    item.textContent = field;
    fields.appendChild(item);
  });
  const draftLabel = document.createElement('label');
  const draftId = 'approval-draft-' + (approval.approvalId || 'item');
  draftLabel.htmlFor = draftId;
  draftLabel.textContent = unknown ? '本次尝试草稿（只读）' : '建议回复（可编辑，最多 300 字）';
  const draft = document.createElement('textarea');
  draft.id = draftId;
  draft.maxLength = 300;
  draft.rows = 3;
  draft.value = approval.draft || '';
  draft.readOnly = unknown;
  const actions = document.createElement('div');
  actions.className = 'approval-actions';
  const open = document.createElement('button');
  open.type = 'button'; open.className = 'btn-ghost'; open.textContent = '打开 Boss 会话';
  open.addEventListener('click', async () => {
    open.disabled = true;
    try {
      const result = await sendRuntimeMessage({ type: 'TRUSTEESHIP_OPEN_CONVERSATION', conversationId: approval.conversationId });
      if (!result || result.ok !== true) $('approvalStatus').textContent = '无法打开 Boss 会话：' + stableTrusteeshipError(result && (result.code || result.errorCode));
    } catch (_) {
      $('approvalStatus').textContent = '无法打开 Boss 会话：' + stableTrusteeshipError('SERVICE_WORKER_INTERRUPTED');
    } finally { open.disabled = false; }
  });
  const send = document.createElement('button');
  send.type = 'button'; send.className = 'btn-go'; send.textContent = '修改并确认发送';
  const noReply = document.createElement('button');
  noReply.type = 'button'; noReply.className = 'btn-ghost'; noReply.textContent = '不回复并移除';
  const disable = document.createElement('button');
  disable.type = 'button'; disable.className = 'btn-ghost approval-disable'; disable.textContent = '关闭此会话托管';
  const controller = TrusteeshipSidepanel.createController({
    send: sendRuntimeMessage,
    disableCard: setApprovalCardBusy,
    status: (text) => { if ($('approvalStatus')) $('approvalStatus').textContent = text; },
    refreshApprovals: refreshApprovals
  });
  if (!unknown) {
    send.addEventListener('click', () => controller.resolveApproval({ id: approval.approvalId, draft: draft.value.trim() }, 'SEND_EDITED'));
    noReply.addEventListener('click', () => controller.resolveApproval({ id: approval.approvalId, draft: draft.value.trim() }, 'NO_REPLY'));
    disable.addEventListener('click', () => {
      if (window.confirm('关闭托管会删除该会话保存的最近聊天上下文。是否继续？')) controller.resolveApproval({ id: approval.approvalId, draft: draft.value.trim() }, 'DISABLE_CONVERSATION');
    });
    actions.append(open, send, noReply, disable);
  } else {
    const acknowledge = document.createElement('button');
    acknowledge.type = 'button';
    acknowledge.className = 'btn-ghost';
    acknowledge.textContent = '已核对，清除此项';
    acknowledge.addEventListener('click', async () => {
      if (!window.confirm('请确认你已经在 Boss 会话中核对实际发送结果。此操作只清除插件本地待确认记录，不会发送或删除 Boss 消息。')) return;
      setApprovalCardBusy(approval.approvalId, true);
      try {
        const result = await sendRuntimeMessage({
          type: 'TRUSTEESHIP_ACK_UNKNOWN_SEND',
          approvalId: approval.approvalId
        });
        if (!result || result.ok !== true) {
          setApprovalCardBusy(approval.approvalId, false);
          $('approvalStatus').textContent = '清除失败：' +
            stableTrusteeshipError(result && (result.code || result.errorCode));
          return;
        }
        await refreshApprovals();
      } catch (_) {
        setApprovalCardBusy(approval.approvalId, false);
        $('approvalStatus').textContent = '清除失败：' +
          stableTrusteeshipError('SERVICE_WORKER_INTERRUPTED');
      }
    });
    actions.append(open, acknowledge);
  }
  card.append(title, meta, reason, context, fields, draftLabel, draft, actions);
  list.appendChild(card);
}

function setLoginBanner(show, text) {
  const el = $('loginBanner');
  if (!el) return;
  if (text) el.textContent = text;
  el.classList.toggle('hidden', !show);
}

function showRecovery(code, reason, nextAction) {
  $('recoveryCode').textContent = code || 'RUN_BLOCKED';
  $('recoveryReason').textContent = reason || '自动操作已停止。';
  $('recoveryNextAction').textContent = nextAction || '核对招聘平台状态后重新扫描';
  $('recoveryCard').classList.remove('hidden');
}

function hideRecovery() {
  $('recoveryCard').classList.add('hidden');
}

function refreshHeader() {
  const m = meta();
  if ($('platPill')) $('platPill').textContent = m.short;
  if ($('subLine')) $('subLine').textContent = '扫描 → 勾选 → 仅联系已选 · ' + m.name;
  if ($('platDetail')) {
    $('platDetail').innerHTML =
      '<div class="job-title">' + m.name + (m.ready ? '' : '（适配器开发中）') + '</div>' +
      '<div class="job-sub">登录：' + m.host + '</div>' +
      '<div class="job-sub">主操作：' + m.actionWord + '</div>';
  }
  if ($('btnScan')) {
    $('btnScan').textContent = m.ready ? ('保存并扫描' + m.short) : (m.short + '即将支持');
    $('btnScan').disabled = runActive || !m.ready;
  }
  if ($('scanHint')) {
    $('scanHint').textContent = m.ready
      ? '保存本页后开始扫描；不会自动联系。完成后到「审核」勾选。意向与节奏按平台独立存储。'
      : (m.short + ' 架构已预留，适配器尚未上线。请先用 Boss 或等待后续版本。');
  }
  if ($('filterPlatTitle')) {
    $('filterPlatTitle').textContent = '当前平台：' + m.short + (m.ready ? '' : '（即将支持）');
  }
  if ($('filterPlatHint')) {
    const exclusive = {
      boss: '平台条件：活跃过滤、活跃天数。',
      zhilian: '平台条件：工作经验、学历。投递前请设好默认简历。',
      liepin: '平台条件：年薪区间、急聘优先。'
    };
    $('filterPlatHint').textContent =
      '求职意向、简历材料、招呼语与联系节奏均只作用于本平台。' + (exclusive[m.id] || '');
  }
  ['boss', 'zhilian', 'liepin'].forEach((id) => {
    const box = $('fields-' + id);
    if (box) box.classList.toggle('hidden', id !== activePlatform);
  });
  document.querySelectorAll('.plat-card').forEach((c) => {
    c.classList.toggle('active', c.dataset.platform === activePlatform);
  });
}

function refreshUsage(override) {
  const apply = (count, limit) => {
    const pill = $('usagePill');
    if ($('usageCount')) $('usageCount').textContent = String(count);
    if ($('usageLimit')) $('usageLimit').textContent = String(limit);
    if (pill) {
      pill.textContent = '今日 ' + count + '/' + limit;
      pill.classList.remove('warn', 'full');
      if (count >= limit) pill.classList.add('full');
      else if (count >= Math.max(1, Math.floor(limit * 0.8))) pill.classList.add('warn');
    }
  };
  if (override) {
    apply(override.count, override.limit);
    return;
  }
  const plat = byPlatformCache[activePlatform] || defaultPlatformCfg(activePlatform);
  const day = todayStr();
  const count = plat.contactDay === day ? (parseInt(plat.contactCount, 10) || 0) : 0;
  const limit = Math.min(50, parseInt(plat.dailyLimit || $('dailyLimit').value, 10) || 20);
  apply(count, limit);
}

function fillFilterForm(plat) {
  const p = plat || defaultPlatformCfg(activePlatform);
  ['keyword', 'city', 'includeKeywords', 'excludeKeywords', 'greetingTemplate', 'experience', 'education'].forEach((f) => {
    if ($(f) && p[f] !== undefined) $(f).value = p[f];
  });
  ['count', 'dailyLimit', 'intervalMinSec', 'intervalMaxSec', 'batchSize', 'batchRestMinSec', 'batchRestMaxSec', 'salaryYearMin', 'salaryYearMax'].forEach((f) => {
    if ($(f) && p[f] !== undefined && p[f] !== '') $(f).value = p[f];
  });
  if ($('filterInactive')) $('filterInactive').checked = p.filterInactive !== false && p.filterInactive !== 'false';
  if ($('activityMaxDays') && p.activityMaxDays !== undefined) $('activityMaxDays').value = String(p.activityMaxDays);
  if ($('preferUrgent')) $('preferUrgent').checked = !!p.preferUrgent;
}

function collectPlatformFields() {
  const fields = {
    keyword: $('keyword').value.trim(),
    city: $('city').value.trim(),
    includeKeywords: $('includeKeywords').value.trim(),
    excludeKeywords: $('excludeKeywords').value.trim(),
    count: $('count').value,
    dailyLimit: $('dailyLimit').value,
    intervalMinSec: $('intervalMinSec').value,
    intervalMaxSec: $('intervalMaxSec').value,
    batchSize: $('batchSize').value,
    batchRestMinSec: $('batchRestMinSec').value,
    batchRestMaxSec: $('batchRestMaxSec').value,
    greetingTemplate: $('greetingTemplate').value.trim()
  };
  if (activePlatform === 'boss') {
    fields.filterInactive = $('filterInactive').checked;
    fields.activityMaxDays = $('activityMaxDays').value;
  }
  if (activePlatform === 'zhilian') {
    fields.experience = $('experience').value.trim();
    fields.education = $('education').value.trim();
  }
  if (activePlatform === 'liepin') {
    fields.salaryYearMin = $('salaryYearMin').value;
    fields.salaryYearMax = $('salaryYearMax').value;
    fields.preferUrgent = $('preferUrgent').checked;
  }
  return fields;
}

async function switchPlatform(pid) {
  if (pid === activePlatform) return;
  if (!RunSafety.canSwitchPlatform(runActive, activePlatform, pid)) {
    addLog('运行中不能切换平台，请先停止当前任务', 'warn');
    return;
  }
  const fields = collectPlatformFields();
  await PlatformConfig.savePlatformFields(activePlatform, fields);
  byPlatformCache[activePlatform] = Object.assign({}, byPlatformCache[activePlatform] || {}, fields);

  activePlatform = pid;
  await PlatformConfig.setActivePlatform(pid);
  fillFilterForm(byPlatformCache[pid] || defaultPlatformCfg(pid));
  screenedCache = [];
  $('reviewList').innerHTML = '<div class="empty">已切换平台，请重新扫描</div>';
  $('reviewCount').textContent = '尚未扫描';
  updateContactBtn();
  setLoginBanner(false);
  refreshHeader();
  refreshUsage();
  addLog('已切换到 ' + meta().short + '（勾选已清空）', 'warn');
}

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => showTab(t.dataset.tab));
});
document.querySelectorAll('.subtab').forEach((t) => {
  t.addEventListener('click', () => showSetup(t.dataset.setup));
});
document.querySelectorAll('.plat-card').forEach((c) => {
  c.addEventListener('click', () => switchPlatform(c.dataset.platform));
});
$('btnToApi').addEventListener('click', () => showSetup('api'));
if ($('btnToJob')) $('btnToJob').addEventListener('click', () => showSetup('filter'));

function trusteeshipPayload() {
  const feishuNotification = { enabled: $('feishuEnabled').checked };
  const webhook = $('feishuWebhook').value;
  const signingSecret = $('feishuSigningSecret').value;
  if (webhook) feishuNotification.webhook = webhook;
  if (signingSecret) feishuNotification.signingSecret = signingSecret;
  return {
    settings: {
      enabled: $('trusteeshipEnabled').checked,
      intervalMinutes: Number($('trusteeshipInterval').value),
      dailyAutoReplyLimit: Number($('autoReplyDailyLimit').value),
      quietHours: {
        enabled: $('quietHoursEnabled').checked,
        start: $('quietHoursStart').value,
        end: $('quietHoursEnd').value
      }
    },
    feishuNotification: feishuNotification,
    hrFaq: readHrFaqFromDom()
  };
}

function toggleSensitiveInput(inputId, buttonId) {
  const input = $(inputId);
  const button = $(buttonId);
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  button.setAttribute('aria-pressed', visible ? 'true' : 'false');
  const name = button.dataset.sensitiveName || '敏感字段';
  button.textContent = visible ? '隐藏' : '暂时显示';
  button.setAttribute('aria-label', (visible ? '隐藏' : '暂时显示') + name);
}

$('btnToggleFeishuWebhook').addEventListener('click', () => toggleSensitiveInput('feishuWebhook', 'btnToggleFeishuWebhook'));
$('btnToggleFeishuSecret').addEventListener('click', () => toggleSensitiveInput('feishuSigningSecret', 'btnToggleFeishuSecret'));
if ($('btnAddHrFaq')) {
  $('btnAddHrFaq').addEventListener('click', () => addHrFaqRow());
}
if ($('hrFaqPresets') && !$('hrFaqPresets').querySelector('.hr-faq-preset')) {
  renderHrFaq([]);
}

$('btnSaveTrusteeship').addEventListener('click', async () => {
  const button = $('btnSaveTrusteeship');
  const previousEnabled = (trusteeshipSnapshot.settings || {}).enabled === true;
  button.disabled = true;
  setTrusteeshipMessage('正在保存…');
  const controller = TrusteeshipSidepanel.createController({
    send: sendRuntimeMessage,
    setEnabled: (value) => { $('trusteeshipEnabled').checked = value === true; },
    status: setTrusteeshipMessage,
    guide: focusTrusteeshipTarget
  });
  try {
    const response = await controller.saveSettings(trusteeshipPayload(), previousEnabled);
    if (response && response.ok === true) {
      setTrusteeshipMessage('托管设置已保存。');
      await refreshTrusteeshipState();
    }
  } catch (_) {
    $('trusteeshipEnabled').checked = previousEnabled;
    setTrusteeshipMessage('保存失败：' + stableTrusteeshipError('SERVICE_WORKER_INTERRUPTED'));
  } finally {
    button.disabled = false;
  }
});

$('btnTestFeishu').addEventListener('click', async () => {
  const button = $('btnTestFeishu');
  button.disabled = true;
  setTrusteeshipMessage('正在发送测试通知…');
  try {
    const response = await sendRuntimeMessage({ type: 'TRUSTEESHIP_TEST_FEISHU' });
    setTrusteeshipMessage(response && response.ok === true ? '飞书测试通知已发送。' : '飞书测试失败：' + stableTrusteeshipError(response && response.code));
    if (response && response.ok === true) await refreshTrusteeshipState();
  } catch (_) {
    setTrusteeshipMessage('飞书测试失败：' + stableTrusteeshipError('SERVICE_WORKER_INTERRUPTED'));
  } finally {
    button.disabled = false;
  }
});

$('btnRunTrusteeshipNow').addEventListener('click', async () => {
  const button = $('btnRunTrusteeshipNow');
  button.disabled = true;
  setTrusteeshipMessage('正在检查已登记岗位…');
  try {
    const response = await sendRuntimeMessage({ type: 'TRUSTEESHIP_RUN_NOW' });
    setTrusteeshipMessage(response && response.ok === true
      ? trusteeshipRunMessage(response)
      : '无法开始检查：' + stableTrusteeshipError(response && response.code));
    if (response && response.ok === true) await refreshTrusteeshipState();
  } catch (_) {
    setTrusteeshipMessage('无法开始检查：' + stableTrusteeshipError('SERVICE_WORKER_INTERRUPTED'));
  } finally {
    button.disabled = false;
  }
});

if ($('btnRunTrusteeshipLiveDrill')) {
  $('btnRunTrusteeshipLiveDrill').addEventListener('click', async () => {
    const button = $('btnRunTrusteeshipLiveDrill');
    const conversationId = String(
      ($('trusteeshipLiveDrillConversation') || {}).value || ''
    ).trim();
    const message = String(
      ($('trusteeshipLiveDrillMessage') || {}).value || ''
    ).trim();
    const consent = $('trusteeshipLiveDrillConsent');
    const status = $('trusteeshipLiveDrillStatus');
    if (!conversationId) {
      if (status) status.textContent = '请选择已登记会话。';
      return;
    }
    if (!message) {
      if (status) status.textContent = '请输入模拟 HR 消息。';
      return;
    }
    if (Array.from(message).length > 600) {
      if (status) status.textContent = '模拟消息不能超过 600 个字符。';
      return;
    }
    if (!consent || consent.checked !== true) {
      if (status) status.textContent = '请先确认本轮演练可能真实发送给所选 HR。';
      return;
    }
    button.disabled = true;
    if (status) status.textContent = '正在使用真实 AI 创建生产待确认…';
    if ($('trusteeshipLiveDrillResult')) {
      $('trusteeshipLiveDrillResult').replaceChildren();
    }
    try {
      const response = await sendRuntimeMessage({
        type: 'TRUSTEESHIP_STAGE_LIVE_DRILL',
        conversationId,
        message
      });
      if (!response || response.ok !== true) {
        if (status) {
          status.textContent = '演练失败：' + stableTrusteeshipError(
            response && (response.code || response.errorCode)
          );
        }
        return;
      }
      renderTrusteeshipLiveDrillResult(response.result);
      if (consent) consent.checked = false;
      if (status) status.textContent = '已创建真实发送待确认，当前尚未发送给 HR。';
      await refreshTrusteeshipState();
      await refreshApprovals();
    } catch (_) {
      if (status) {
        status.textContent = '演练失败：' +
          stableTrusteeshipError('SERVICE_WORKER_INTERRUPTED');
      }
    } finally {
      button.disabled = false;
    }
  });
}

if ($('btnRegisterActiveConversation')) {
  $('btnRegisterActiveConversation').addEventListener('click', async () => {
    const button = $('btnRegisterActiveConversation');
    const enable = !($('registerActiveEnable') && $('registerActiveEnable').checked === false);
    button.disabled = true;
    setTrusteeshipMessage('正在从当前 Boss 聊天页登记…');
    try {
      const response = await sendRuntimeMessage({
        type: 'TRUSTEESHIP_REGISTER_ACTIVE',
        enable: enable
      });
      if (response && response.ok === true) {
        const label = ((response.conversation && response.conversation.company) || '未知公司') +
          ' · ' +
          ((response.conversation && response.conversation.position) || '未知岗位');
        const peer = response.conversation && response.conversation.conversationId
          ? '（peer ' + String(response.conversation.conversationId).slice(0, 16) + '…）'
          : '';
        const action = enable ? '已登记并开启托管：' : '已登记（未开启托管）：';
        setTrusteeshipMessage((response.alreadyRegistered ? '已更新登记：' : action) + label + peer);
        await refreshTrusteeshipState();
      } else {
        const detail = response && typeof response.detail === 'string' && response.detail.trim()
          ? '（' + response.detail.trim().slice(0, 120) + '）'
          : '';
        setTrusteeshipMessage(
          '登记失败：' + stableTrusteeshipError(response && response.code) + detail
        );
      }
    } catch (_) {
      setTrusteeshipMessage('登记失败：' + stableTrusteeshipError('SERVICE_WORKER_INTERRUPTED'));
    } finally {
      button.disabled = false;
    }
  });
}

PlatformConfig.ensureMigrated().then((all) => {
  riskAccepted = !!all.riskAccepted;
  if (!riskAccepted) $('riskModal').classList.remove('hidden');
  activePlatform = all.activePlatform || 'boss';
  byPlatformCache = all.byPlatform || {};
  if ($('provider')) $('provider').value = all.provider || 'deepseek';
  if ($('apiKey')) $('apiKey').value = all.apiKey || all.dsKey || '';
  if ($('baseUrl') && all.baseUrl) $('baseUrl').value = all.baseUrl;
  syncBaseUrlVisibility();
  if ($('resumeText') && all.resumeText) $('resumeText').value = all.resumeText;
  if (all.resumeImage) showImg(all.resumeImage);
  fillFilterForm(byPlatformCache[activePlatform]);
  refreshHeader();
  refreshUsage();
  refreshTrusteeshipState();
  if (all.sw_screened && all.sw_screened.length && all.sw_platform === activePlatform) {
    renderReview(all.sw_screened);
  }
  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (snapshot) => {
    if (chrome.runtime.lastError || !snapshot) return;
    const active = ['collecting', 'screening', 'delivering'].includes(snapshot.phase);
    setRunning(active);
    if (snapshot.phase === 'blocked') {
      $('phaseText').textContent = '已停机';
      showRecovery(
        snapshot.blockCode,
        snapshot.blockReason,
        snapshot.blockNextAction
      );
      showTab('run');
    }
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.byPlatform) {
    byPlatformCache = changes.byPlatform.newValue || byPlatformCache;
    refreshUsage();
  }
});

$('riskOk').addEventListener('click', () => {
  riskAccepted = true;
  chrome.storage.local.set({ riskAccepted: true });
  $('riskModal').classList.add('hidden');
});

$('dailyLimit').addEventListener('change', () => {
  refreshUsage({
    count: parseInt($('usageCount').textContent, 10) || 0,
    limit: Math.min(50, parseInt($('dailyLimit').value, 10) || 20)
  });
});

function showImg(dataUrl) {
  if (!$('imgPrev') || !$('imgPrevWrap')) return;
  if (!dataUrl) {
    $('imgPrev').innerHTML = '';
    $('imgPrevWrap').classList.add('hidden');
    return;
  }
  $('imgPrev').innerHTML = '<img src="' + dataUrl + '" alt="resume">';
  $('imgPrevWrap').classList.remove('hidden');
}

function clearResumeImg() {
  if ($('resumeImg')) $('resumeImg').value = '';
  showImg('');
  chrome.storage.local.remove('resumeImage');
}

if ($('resumeImg')) {
  $('resumeImg').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      showImg(ev.target.result);
      chrome.storage.local.set({ resumeImage: ev.target.result });
    };
    reader.readAsDataURL(file);
  });
}

if ($('btnClearResumeImg')) {
  $('btnClearResumeImg').addEventListener('click', () => {
    clearResumeImg();
  });
}

function syncBaseUrlVisibility() {
  const compatible = $('provider') && $('provider').value === 'openai_compatible';
  if ($('baseUrlRow')) $('baseUrlRow').classList.toggle('hidden', !compatible);
  if ($('deepseekHint')) $('deepseekHint').classList.toggle('hidden', !!compatible);
  // 不在切换服务商时清空输入，避免误切后丢失未保存的自定义地址；持久化由 saveApi 决定
}

async function saveApi() {
  const provider = $('provider') ? $('provider').value : 'deepseek';
  const baseUrl = provider === 'openai_compatible' && $('baseUrl')
    ? $('baseUrl').value.trim()
    : '';
  const permission = await ApiPermissions.ensure(chrome, baseUrl);
  if (!permission.ok) throw new Error(permission.error);
  const response = await sendRuntimeMessage({
    type: 'SAVE_API_CONFIG',
    config: {
      provider: provider,
      apiKey: $('apiKey') ? $('apiKey').value.trim() : '',
      baseUrl: baseUrl,
      resumeText: $('resumeText') ? $('resumeText').value.trim() : ''
    }
  });
  if (!response.ok) {
    const messages = {
      API_CONFIG_INPUT_INVALID: 'API 配置格式无效',
      API_CONFIG_SAVE_FAILED: 'API 配置写入失败',
      TRUSTEESHIP_UNAUTHORIZED: '当前页面无权保存 API 配置',
      SERVICE_WORKER_INTERRUPTED: '后台服务已中断，请重新打开扩展'
    };
    throw new Error(messages[response.code] || 'API 配置保存失败');
  }
}

async function saveFilter() {
  const fields = collectPlatformFields();
  await PlatformConfig.savePlatformFields(activePlatform, fields);
  byPlatformCache[activePlatform] = Object.assign({}, byPlatformCache[activePlatform] || {}, fields);
  refreshUsage();
}

if ($('provider')) {
  $('provider').addEventListener('change', () => {
    syncBaseUrlVisibility();
  });
}

$('saveApi').addEventListener('click', async () => {
  try {
    await saveApi();
    $('apiTestMsg').textContent = '已保存';
    setTimeout(() => { $('apiTestMsg').textContent = ''; }, 1500);
  } catch (e) {
    $('apiTestMsg').textContent = '保存失败：' + e.message;
  }
});

function apiTestFailureText(r) {
  if (r && r.error) return r.error;
  const map = {
    API_KEY_MISSING: '请先填写 API Key',
    API_UNAUTHORIZED: 'API Key 无效或未授权（401）',
    API_FORBIDDEN: 'API 拒绝访问（余额不足或无权限）',
    API_RATE_LIMITED: '请求过于频繁（429），请稍后重试',
    API_MODEL_INVALID: '模型不可用（请重载扩展以使用 deepseek-v4-flash）',
    API_BAD_REQUEST: 'API 请求被拒绝（400），请检查 Key 与服务商设置',
    API_SERVER_ERROR: 'API 服务暂时不可用，请稍后重试',
    API_TEST_PROTOCOL_MISMATCH: '已连通，但模型未按约定回复 ok，请再试一次',
    API_ABORTED: '请求被中断，请停止其他任务后重试',
    API_NETWORK_ERROR: '网络请求失败，请检查网络或扩展权限',
    API_TEST_STALE: '测试期间配置被修改，请重新测试',
    API_TEST_PERSIST_FAILED: '测试结果写入失败，请重试',
    API_TEST_FAILED: 'API 连接测试失败',
    TRUSTEESHIP_UNAUTHORIZED: '当前页面无权测试 API',
    TRUSTEESHIP_MESSAGE_INVALID: '测试请求格式无效',
    SERVICE_WORKER_INTERRUPTED: '后台服务已中断，请重新打开扩展'
  };
  return (r && map[r.code]) || '未知错误';
}

$('btnTestApi').addEventListener('click', async () => {
  try {
    await saveApi();
  } catch (e) {
    $('apiTestMsg').textContent = '失败：' + e.message;
    return;
  }
  if (!$('apiKey').value.trim()) {
    $('apiTestMsg').textContent = '失败：请先填写 API Key';
    return;
  }
  $('apiTestMsg').textContent = '测试中…';
  chrome.runtime.sendMessage({ type: 'TEST_API' }, (r) => {
    if (chrome.runtime.lastError) {
      $('apiTestMsg').textContent = '失败：' + chrome.runtime.lastError.message;
      return;
    }
    $('apiTestMsg').textContent = (r && r.ok) ? '连接成功' : ('失败：' + apiTestFailureText(r));
  });
});

$('btnScan').addEventListener('click', async () => {
  if (!riskAccepted) {
    $('riskModal').classList.remove('hidden');
    return addLog('请先确认使用须知', 'warn');
  }
  if (!meta().ready) {
    return addLog(meta().short + ' 尚未就绪', 'warn');
  }
  try {
    await saveApi();
  } catch (e) {
    return addLog('API 配置保存失败：' + e.message, 'error');
  }
  await saveFilter();
  const fields = collectPlatformFields();
  if (!fields.keyword) return addLog('请先填岗位关键词', 'error');
  setLoginBanner(false);
  hideRecovery();
  showTab('run');
  setRunning(true);
  addLog('[' + meta().short + '] 开始扫描（不会自动联系）', 'info');
  chrome.runtime.sendMessage({ type: 'START_COLLECT' });
});

function selectedIds() {
  return Array.from(document.querySelectorAll('.job-item:not(.skip) input:checked')).map((c) => c.dataset.id);
}

function formatDurationRange(minSec, maxSec) {
  function human(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return value + ' 秒';
    const minutes = Math.ceil(value / 60);
    return minutes + ' 分钟';
  }
  return human(minSec) + '–' + human(maxSec);
}

function renderDeliveryPlan(plan) {
  const platform = getPlatform(plan.platformId || activePlatform);
  const resumeText = plan.sendsResumeImage ? '将尝试发送' : '未配置';
  $('deliverySummary').innerHTML =
    '<dl>' +
      '<div><dt>平台</dt><dd>' + esc(platform.short) + '</dd></div>' +
      '<div><dt>选择 / 实际联系</dt><dd>' + plan.selectedCount + ' / ' + plan.executableCount + '</dd></div>' +
      '<div><dt>已联系排除</dt><dd>' + plan.skippedProcessedCount + '</dd></div>' +
      '<div><dt>今日额度</dt><dd>' + plan.usageCount + ' / ' + plan.dailyLimit + '，完成后剩 ' + plan.remainingAfter + '</dd></div>' +
      '<div><dt>预计等待</dt><dd>' + formatDurationRange(plan.estimatedMinSec, plan.estimatedMaxSec) + '</dd></div>' +
      '<div><dt>简历图片</dt><dd>' + resumeText + '</dd></div>' +
      '<div><dt>招呼语</dt><dd>使用当前平台招呼语模板</dd></div>' +
    '</dl>';
  $('deliveryJobs').innerHTML = (plan.jobs || []).map((job) =>
    '<li><strong>' + esc(job.name) + '</strong><span>' + esc(job.company) + '</span></li>'
  ).join('');
  $('btnConfirmDelivery').textContent = '确认联系这 ' + plan.executableCount + ' 个岗位';
}

function openDeliveryModal(intentId, plan) {
  pendingDeliveryIntentId = intentId;
  deliveryConfirmationSubmitting = false;
  deliveryModalReturnFocus = document.activeElement;
  renderDeliveryPlan(plan);
  $('deliveryModal').classList.remove('hidden');
  $('btnConfirmDelivery').disabled = false;
  $('btnCancelDelivery').disabled = false;
  $('btnConfirmDelivery').focus();
}

function hideDeliveryModal() {
  $('deliveryModal').classList.add('hidden');
  pendingDeliveryIntentId = '';
  deliveryConfirmationSubmitting = false;
  $('btnConfirmDelivery').disabled = false;
  $('btnCancelDelivery').disabled = false;
  if (deliveryModalReturnFocus && typeof deliveryModalReturnFocus.focus === 'function') {
    deliveryModalReturnFocus.focus();
  }
  deliveryModalReturnFocus = null;
}

async function cancelDeliveryConfirmation() {
  if (deliveryConfirmationSubmitting) return;
  const intentId = pendingDeliveryIntentId;
  if (intentId) {
    try {
      await sendRuntimeMessage({ type: 'CANCEL_DELIVERY', intentId: intentId });
    } catch (error) {
      addLog('撤销确认单失败：' + error.message, 'warn');
    }
  }
  hideDeliveryModal();
}

function updateContactBtn() {
  const n = selectedIds().length;
  const btn = $('btnContact');
  if (n === 0) {
    btn.disabled = true;
    btn.textContent = '请先勾选岗位';
  } else {
    btn.disabled = false;
    btn.textContent = '联系已选 (' + n + ')';
  }
}

$('btnContact').addEventListener('click', async () => {
  if (!riskAccepted) {
    $('riskModal').classList.remove('hidden');
    return addLog('请先确认使用须知', 'warn');
  }
  const ids = selectedIds();
  if (!ids.length) return;
  $('btnContact').disabled = true;
  $('btnContact').textContent = '正在生成确认单…';
  try {
    const response = await sendRuntimeMessage({ type: 'PREPARE_DELIVERY', jobIds: ids });
    if (!response.ok) {
      addLog((response.error || '无法生成确认单') + '；' + (response.nextAction || '请重新扫描'), 'error');
      return;
    }
    openDeliveryModal(response.intentId, response.plan);
  } catch (error) {
    addLog('生成确认单失败：' + error.message, 'error');
  } finally {
    updateContactBtn();
  }
});

$('btnCancelDelivery').addEventListener('click', () => {
  cancelDeliveryConfirmation();
});

$('btnConfirmDelivery').addEventListener('click', async () => {
  const intentId = pendingDeliveryIntentId;
  if (!intentId) return;
  deliveryConfirmationSubmitting = true;
  $('btnConfirmDelivery').disabled = true;
  $('btnCancelDelivery').disabled = true;
  try {
    const response = await sendRuntimeMessage({
      type: 'CONFIRM_DELIVERY',
      intentId: intentId
    });
    if (!response.ok) {
      addLog((response.error || '无法启动联系') + '；' + (response.nextAction || '请重新确认'), 'error');
      hideDeliveryModal();
      showTab('review');
      return;
    }
    const count = (response.jobIds || []).length;
    hideDeliveryModal();
    showTab('run');
    hideRecovery();
    setRunning(true);
    addLog('[' + meta().short + '] 已确认，开始联系 ' + count + ' 个岗位', 'info');
  } catch (error) {
    hideDeliveryModal();
    showTab('review');
    addLog('确认失败：' + error.message, 'error');
  }
});

$('deliveryModal').addEventListener('click', (event) => {
  if (event.target === $('deliveryModal')) cancelDeliveryConfirmation();
});

document.addEventListener('keydown', (event) => {
  if ($('deliveryModal').classList.contains('hidden')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    cancelDeliveryConfirmation();
    return;
  }
  if (event.key === 'Tab') {
    const focusable = Array.from(
      $('deliveryModal').querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

$('btnSelectHigh').addEventListener('click', () => {
  document.querySelectorAll('.job-item:not(.skip)').forEach((row) => {
    const score = parseInt(row.dataset.score || '0', 10);
    const suggested = row.dataset.suggested === '1';
    const cb = row.querySelector('input');
    if (cb) cb.checked = suggested || score >= 70;
  });
  updateContactBtn();
});

$('btnClearSel').addEventListener('click', () => {
  document.querySelectorAll('.job-item:not(.skip) input').forEach((c) => { c.checked = false; });
  updateContactBtn();
});

$('btnPause').addEventListener('click', () => {
  if ($('btnPause').textContent === '暂停') {
    $('btnPause').textContent = '继续';
    chrome.runtime.sendMessage({ type: 'PAUSE' });
  } else {
    $('btnPause').textContent = '暂停';
    chrome.runtime.sendMessage({ type: 'RESUME' });
  }
});
$('btnStop').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP' });
  setRunning(false);
});
$('btnReset').addEventListener('click', () => {
  if (!RunSafety.canResetRun(runActive)) {
    addLog('运行中不能重置会话，请先停止当前任务', 'warn');
    return;
  }
  chrome.runtime.sendMessage({ type: 'RESET' });
  screenedCache = [];
  $('reviewList').innerHTML = '<div class="empty">已重置，请重新扫描</div>';
  $('reviewCount').textContent = '尚未扫描';
  updateContactBtn();
  setRunning(false);
  hideRecovery();
  refreshUsage();
});
$('btnRecovery').addEventListener('click', () => {
  if (screenedCache.length) showTab('review');
  else {
    showTab('setup');
    showSetup('filter');
  }
});
$('clearLog').addEventListener('click', () => { $('log').innerHTML = ''; });

function setRunning(running) {
  runActive = !!running;
  $('btnScan').disabled = running || !meta().ready;
  $('btnContact').disabled = running || selectedIds().length === 0;
  $('btnPause').disabled = !running;
  $('btnStop').disabled = !running;
  $('btnReset').disabled = !!running;
  document.querySelectorAll('.plat-card').forEach((card) => {
    card.disabled = !!running;
    card.setAttribute('aria-disabled', running ? 'true' : 'false');
  });
  if (!running) {
    $('btnPause').textContent = '暂停';
    updateContactBtn();
  }
}

function jobTitleHtml(j) {
  const name = esc(j.name);
  const link = (j.link || '').trim();
  if (link && /^https?:\/\//i.test(link)) {
    return '<button type="button" class="job-title-link" data-link="' + esc(link) + '" title="打开岗位详情">'
      + name + '<span class="job-open-hint">打开</span></button>';
  }
  return '<div class="job-title">' + name + '</div>';
}

function openJobOnBoss(url) {
  if (!url) {
    addLog('该岗位没有可跳转链接', 'warn');
    return;
  }
  const m = meta();
  chrome.tabs.query({ url: m.tabQuery }, (tabs) => {
    if (chrome.runtime.lastError) {
      addLog('打开失败：' + chrome.runtime.lastError.message, 'error');
      return;
    }
    const tab = tabs && tabs[0];
    if (tab && tab.id != null) {
      chrome.tabs.update(tab.id, { url: url, active: true }, () => {
        if (chrome.runtime.lastError) chrome.tabs.create({ url: url });
        else if (tab.windowId != null) chrome.windows.update(tab.windowId, { focused: true });
      });
    } else {
      chrome.tabs.create({ url: url });
    }
  });
}

function renderReview(screened) {
  screenedCache = screened || [];
  const matched = screenedCache.filter((j) => j.match);
  const skipped = screenedCache.filter((j) => !j.match);
  $('reviewCount').textContent = meta().short + ' · 建议 ' + matched.length + ' / 共 ' + screenedCache.length + '（默认不选）';
  let html = '';
  matched.forEach((j) => {
    const score = j.score != null ? j.score : (j.match ? 80 : 40);
    html += '<div class="job-item" data-score="' + score + '" data-suggested="' + (j.match ? '1' : '0') + '">'
      + '<input type="checkbox" data-id="' + esc(j.id) + '">'
      + '<div class="job-main">' + jobTitleHtml(j)
      + '<div class="job-sub">' + esc(j.company) + ' · ' + esc(j.salary)
      + (j.activeText ? (' · ' + esc(j.activeText)) : '') + '</div>'
      + '<div class="job-score">分 ' + score + '</div>'
      + '<div class="job-reason m">✓ ' + esc(j.reason) + '</div></div></div>';
  });
  skipped.forEach((j) => {
    html += '<div class="job-item skip" data-score="0">'
      + '<input type="checkbox" disabled data-id="' + esc(j.id) + '">'
      + '<div class="job-main">' + jobTitleHtml(j)
      + '<div class="job-sub">' + esc(j.company) + ' · ' + esc(j.salary)
      + (j.activeText ? (' · ' + esc(j.activeText)) : '') + '</div>'
      + '<div class="job-reason s">✗ ' + esc(j.reason) + '</div></div></div>';
  });
  $('reviewList').innerHTML = html || '<div class="empty">无岗位</div>';
  $('reviewList').querySelectorAll('.job-item:not(.skip)').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.job-title-link')) return;
      const cb = row.querySelector('input');
      if (cb) { cb.checked = !cb.checked; updateContactBtn(); }
    });
  });
  $('reviewList').querySelectorAll('.job-title-link').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openJobOnBoss(btn.dataset.link);
    });
  });
  updateContactBtn();
  showTab('review');
}

function esc(s) {
  return (s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'LOG') addLog(msg.text, msg.level);
  if (msg.type === 'PROGRESS') {
    $('progText').textContent = (msg.label ? msg.label + ' ' : '') + msg.cur + '/' + msg.total;
  }
  if (msg.type === 'PHASE') {
    const map = {
      idle: '未开始', collecting: '扫描中', screening: '筛选中',
      review: '待审核', delivering: '联系中', done: '已完成', blocked: '已停机'
    };
    $('phaseText').textContent = map[msg.phase] || msg.phase;
    if (msg.phase === 'collecting' || msg.phase === 'screening' || msg.phase === 'delivering') {
      setRunning(true);
    }
    if (msg.phase === 'review' || msg.phase === 'done' || msg.phase === 'idle' || msg.phase === 'blocked') {
      setRunning(false);
    }
    if (msg.phase === 'blocked') showTab('run');
  }
  if (msg.type === 'SCREENED') renderReview(msg.screened);
  if (msg.type === 'DONE') {
    setRunning(false);
    $('progText').textContent = '';
    PlatformConfig.ensureMigrated().then((all) => {
      byPlatformCache = all.byPlatform || byPlatformCache;
      refreshUsage();
    });
  }
  if (msg.type === 'USAGE') {
    refreshUsage({ count: msg.count, limit: msg.limit });
  }
  if (msg.type === 'NEED_LOGIN') {
    setLoginBanner(true, msg.text || meta().loginHint);
    showTab('setup');
    setRunning(false);
  }
  if (msg.type === 'BLOCKED') {
    showRecovery(msg.code, msg.reason, msg.nextAction);
    $('phaseText').textContent = '已停机';
    setRunning(false);
    showTab('run');
  }
});

function addLog(text, level) {
  level = level || 'info';
  const now = new Date();
  const t = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  const el = document.createElement('div');
  el.className = 'log-item ' + level;
  el.innerHTML = '<span class="log-time">[' + t + ']</span>' + esc(text);
  $('log').appendChild(el);
  $('log').scrollTop = $('log').scrollHeight;
}
