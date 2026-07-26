// ===== 求职联系助手 Service Worker：多平台适配 · 扫描→筛选→仅联系已选 =====
importScripts(
  '/src/platform/search-filters.js',
  '/src/platform/registry.js',
  '/src/platform/config.js',
  '/src/platform/boss/selectors.js',
  '/src/humanize.js',
  '/src/greeting-template.js',
  '/src/run-safety.js',
  '/src/run-store.js',
  '/src/delivery-guard.js',
  '/src/conversation/trusteeship-policy.js',
  '/src/conversation/conversation-store.js',
  '/src/conversation/reply-ai.js',
  '/src/conversation/feishu-notifier.js',
  '/src/platform/boss/peer-identity.js',
  '/src/platform/boss/conversation-reader.js',
  '/src/conversation/monitor-engine.js',
  '/src/conversation/trusteeship-simulator.js',
  '/src/conversation/trusteeship-runtime.js'
);

const DEFAULT_DS = 'https://api.deepseek.com/v1/chat/completions';
// deepseek-chat 已于 2026-07-24 退役；非思考模式对应 v4-flash
const DS_MODEL = 'deepseek-v4-flash';
const TRUSTEESHIP_ALARM = 'boss-ai-chat-monitor';

let state = {
  phase: 'idle', paused: false, aborted: false, blocked: false,
  blockCode: '', blockReason: '', blockNextAction: '',
  jobs: [], screened: [], greetings: {}, results: [], processed: {},
  deliverLock: false, operationLock: false, activePlatform: 'boss',
  abortController: null, activeRunId: null
};
const runStore = RunStore.createRunStore(chrome.storage.local, () => Date.now());
const deliveryIntentStore = DeliveryGuard.createIntentStore(
  chrome.storage.local,
  () => Date.now(),
  () => {
    const suffix = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Date.now() + '-' + Math.random().toString(16).slice(2));
    return 'intent-' + suffix;
  }
);
const conversationStore = ConversationStore.create(
  chrome.storage.local,
  () => Date.now(),
  (kind) => {
    const suffix = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : (Date.now() + '-' + Math.random().toString(16).slice(2));
    return kind + '-' + suffix;
  }
);
const trusteeshipFeishuClient = FeishuNotifier.create({
  fetchFn: fetch,
  subtle: (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null,
  clock: () => Date.now()
});
let monitorEngine = null;
let trusteeshipRuntime = null;
let offscreenCreating = null;
let workerReady = Promise.resolve();
let workerInitializationFailed = false;
let apiProofEpoch = 0;

function apiIdentityStorageChanged(changes) {
  const keys = ['provider', 'apiKey', 'dsKey', 'baseUrl', 'apiConfigVersion'];
  return !!changes && keys.some((key) => {
    const change = changes[key];
    return change && !Object.is(change.oldValue, change.newValue);
  });
}

if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !apiIdentityStorageChanged(changes)) return;
    apiProofEpoch += 1;
    workerReady
      .then(() => {
        if (!trusteeshipRuntime) return;
        if (workerInitializationFailed) return trusteeshipRuntime.failClosed();
        return trusteeshipRuntime.invalidateApiProof();
      })
      .catch(() => {});
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  PlatformConfig.ensureMigrated().catch(() => {});
  reconcileTrusteeshipLifecycle().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  reconcileTrusteeshipLifecycle().catch(() => {});
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || alarm.name !== TRUSTEESHIP_ALARM) return;
  workerReady
    .then(() => {
      if (workerInitializationFailed) return;
      return trusteeshipRuntime.runScheduledCycle();
    })
    .catch(() => {});
});
try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}); } catch (e) {}
PlatformConfig.ensureMigrated().catch(() => {});

function reconcileTrusteeshipAlarm() {
  if (!trusteeshipRuntime) return Promise.resolve({ enabled: false });
  return trusteeshipRuntime.reconcileAlarm();
}

function reconcileTrusteeshipLifecycle() {
  return workerReady.then(() => {
    if (workerInitializationFailed) return trusteeshipRuntime.failClosed();
    return reconcileTrusteeshipAlarm();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function humanWait(minMs, maxMs) {
  const lo = Math.max(0, Number(minMs) || 0);
  const hi = Math.max(lo, Number(maxMs) || lo);
  const midpointBias = (Math.random() + Math.random()) / 2;
  const target = Math.round(lo + midpointBias * (hi - lo));
  return RunSafety.waitCancellable(target, {
    isCancelled: () => state.aborted || state.blocked,
    sleep: sleep,
    stepMs: 250
  });
}
function log(text, level) { chrome.runtime.sendMessage({ type: 'LOG', text: text, level: level || 'info' }).catch(() => {}); }
function pushPhase() { chrome.runtime.sendMessage({ type: 'PHASE', phase: state.phase }).catch(() => {}); }
function progress(cur, total, label) { chrome.runtime.sendMessage({ type: 'PROGRESS', cur: cur, total: total, label: label || '' }).catch(() => {}); }
async function waitIfPaused() {
  while (state.paused) {
    RunSafety.checkpoint(state);
    await RunSafety.waitCancellable(250, {
      isCancelled: () => state.aborted || state.blocked,
      sleep: sleep,
      stepMs: 250
    });
  }
  RunSafety.checkpoint(state);
}

async function getCfg() {
  const flat = await PlatformConfig.loadFlat();
  state.activePlatform = flat.activePlatform || 'boss';
  state.processed = flat.processed || state.processed || {};
  return flat;
}

function startAbortScope() {
  state.abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
}

function checkpoint() {
  return RunSafety.checkpoint(state);
}

async function hasOffscreenDocument() {
  const url = chrome.runtime.getURL('src/offscreen.html');
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [url]
    });
    return contexts.length > 0;
  }
  if (typeof clients !== 'undefined' && clients.matchAll) {
    const matched = await clients.matchAll();
    return matched.some((client) => client.url === url);
  }
  return false;
}

async function ensureRunKeeper() {
  if (!chrome.offscreen || await hasOffscreenDocument()) return;
  if (!offscreenCreating) {
    offscreenCreating = chrome.offscreen.createDocument({
      url: 'src/offscreen.html',
      reasons: ['LOCAL_STORAGE'],
      justification: '保存有界用户任务心跳，并在任务期间维持运行协调器可达'
    }).finally(() => { offscreenCreating = null; });
  }
  await offscreenCreating;
}

async function releaseRunKeeper() {
  if (!chrome.offscreen) return;
  try {
    if (await hasOffscreenDocument()) await chrome.offscreen.closeDocument();
  } catch (e) {}
}

async function beginPersistentRun(kind, platformId, fields) {
  await ensureRunKeeper();
  const record = await runStore.start(Object.assign({
    id: (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : ('run-' + Date.now() + '-' + Math.random().toString(16).slice(2)),
    kind: kind,
    platformId: platformId,
    phase: state.phase
  }, fields || {}));
  state.activeRunId = record.id;
  return record;
}

async function patchPersistentRun(fields) {
  if (!state.activeRunId) return null;
  return runStore.patch(Object.assign({ phase: state.phase }, fields || {}));
}

async function finishPersistentRun(status, fields) {
  if (!state.activeRunId) {
    await releaseRunKeeper();
    return null;
  }
  try {
    return await runStore.finish(status, Object.assign({
      phase: state.phase,
      results: state.results
    }, fields || {}));
  } finally {
    state.activeRunId = null;
    await releaseRunKeeper();
  }
}

function platMeta(cfg) {
  return getPlatform((cfg && cfg.activePlatform) || state.activePlatform || 'boss');
}

function apiKeyOf(cfg) { return (cfg.apiKey || cfg.dsKey || '').trim(); }

function endpointOf(cfg) {
  if (cfg.baseUrl && cfg.baseUrl.trim()) {
    let u = cfg.baseUrl.trim().replace(/\/$/, '');
    if (!u.endsWith('/chat/completions')) u += '/chat/completions';
    return u;
  }
  if (cfg.provider === 'openai_compatible') return 'https://api.openai.com/v1/chat/completions';
  return DEFAULT_DS;
}

function modelOf(cfg) {
  return cfg.provider === 'openai_compatible' ? 'gpt-4o-mini' : DS_MODEL;
}

function resumeFull(cfg) { return (cfg.resumeText || '').trim(); }
function jobInfo(j) {
  return '岗位：' + (j.name || '') + '\n技能标签：' + ((j.tags || []).join('、')) + '\n薪资：' + (j.salary || '') + '\n公司：' + (j.company || '');
}
function findJob(id) {
  for (let i = 0; i < state.jobs.length; i++) if (state.jobs[i].id === id) return state.jobs[i];
  return null;
}
function splitWords(s) {
  return (s || '').split(/[,，、\s]+/).map((x) => x.trim()).filter(Boolean);
}

function pushUsage(count, limit) {
  chrome.runtime.sendMessage({ type: 'USAGE', count: count, limit: limit }).catch(() => {});
}

async function bumpDailyUsage(platformId) {
  const usage = await PlatformConfig.bumpDailyUsage(platformId);
  pushUsage(usage.count, usage.limit);
  return usage.count;
}

async function commitContactRecord(platformId, job, cursor) {
  const usage = await PlatformConfig.recordContact(platformId, job.id);
  state.processed = Object.assign({}, usage.processed || state.processed);
  pushUsage(usage.count, usage.limit);
  await patchPersistentRun({
    cursor: cursor,
    currentJobId: job.id,
    contactedJobIds: Object.keys(state.processed),
    results: state.results.slice()
  });
  return usage;
}

function notifyNeedLogin(text) {
  log(text, 'error');
  chrome.runtime.sendMessage({ type: 'NEED_LOGIN', text: text }).catch(() => {});
}

async function callLLM(messages, maxTokens, frozenConfig, options) {
  const cfg = frozenConfig || await getCfg();
  const key = apiKeyOf(cfg);
  if (!key) throw new Error('未配置 API Key');
  const opts = options || {};
  const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.5;
  const body = {
    model: modelOf(cfg),
    messages: messages,
    max_tokens: maxTokens || 500,
    temperature: temperature
  };
  // DeepSeek V4：默认可能开思考；业务筛选/招呼/连通测试需关闭，避免空 content 与延迟
  if ((cfg.provider || 'deepseek') !== 'openai_compatible') {
    body.thinking = { type: 'disabled' };
  }
  const signal = opts.ignoreAbort
    ? undefined
    : (state.abortController ? state.abortController.signal : undefined);
  const resp = await fetch(endpointOf(cfg), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify(body),
    signal: signal
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    // 状态码留给上层分类；正文截断仅进 Error，不直接回传面板
    throw new Error('LLM ' + resp.status + ': ' + t.slice(0, 160));
  }
  const data = await resp.json();
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  return (msg && (msg.content || msg.reasoning_content)) || '';
}

/** 连接测试约定回复：允许大小写、首行、常见标点/引号包裹，避免 DeepSeek 加「。」导致误判 */
function isApiTestOkReply(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return false;
  s = s.split(/\r?\n/)[0].trim();
  s = s.replace(/^[`"'「『【\[]+/, '').replace(/[`"'」』】\]]+$/, '');
  s = s.replace(/[.。!！…~～]+$/g, '').trim();
  return s === 'ok';
}

function classifyApiTestFailure(error) {
  const msg = (error && error.message) || '';
  if (/未配置 API Key/.test(msg)) {
    return { ok: false, code: 'API_KEY_MISSING', error: '请先填写 API Key' };
  }
  if (/LLM 401\b/.test(msg) || /authentication|invalid.*api.?key/i.test(msg)) {
    return { ok: false, code: 'API_UNAUTHORIZED', error: 'API Key 无效或未授权（401）' };
  }
  if (/LLM 402\b|LLM 403\b/.test(msg)) {
    return { ok: false, code: 'API_FORBIDDEN', error: 'API 拒绝访问（余额不足或无权限）' };
  }
  if (/LLM 429\b/.test(msg)) {
    return { ok: false, code: 'API_RATE_LIMITED', error: '请求过于频繁（429），请稍后重试' };
  }
  if (/LLM 400\b/.test(msg) && /model|Model|not (found|exist)|unknown|invalid_request/i.test(msg)) {
    return {
      ok: false,
      code: 'API_MODEL_INVALID',
      error: '模型不可用（DeepSeek 已切换至 deepseek-v4-flash，请重载扩展后再试）'
    };
  }
  if (/LLM 400\b/.test(msg)) {
    return { ok: false, code: 'API_BAD_REQUEST', error: 'API 请求被拒绝（400），请检查 Key 与服务商设置' };
  }
  if (/LLM 5\d\d\b/.test(msg)) {
    return { ok: false, code: 'API_SERVER_ERROR', error: 'API 服务暂时不可用，请稍后重试' };
  }
  if (/API_TEST_PROTOCOL_MISMATCH/.test(msg)) {
    return {
      ok: false,
      code: 'API_TEST_PROTOCOL_MISMATCH',
      error: '已连通，但模型未按约定回复 ok，请再试一次'
    };
  }
  if (/AbortError|The user aborted|aborted/i.test(msg)) {
    return { ok: false, code: 'API_ABORTED', error: '请求被中断，请停止其他任务后重试' };
  }
  if (/Failed to fetch|NetworkError|TypeError: fetch|net::ERR/i.test(msg)) {
    return { ok: false, code: 'API_NETWORK_ERROR', error: '网络请求失败，请检查网络或扩展权限' };
  }
  return { ok: false, code: 'API_TEST_FAILED', error: 'API 连接测试失败' };
}

function ruleScreen(cfg, job) {
  const blob = ((job.name || '') + ' ' + (job.company || '') + ' ' + ((job.tags || []).join(' '))).toLowerCase();
  const excludes = splitWords(cfg.excludeKeywords).map((w) => w.toLowerCase());
  for (let i = 0; i < excludes.length; i++) {
    if (excludes[i] && blob.indexOf(excludes[i]) >= 0) {
      return { match: false, reason: '命中排除词：' + excludes[i], score: 20 };
    }
  }
  // 活跃度二次过滤（扫描阶段已滤，此处兜底）
  const filterInactive = cfg.filterInactive !== false && cfg.filterInactive !== 'false';
  const maxDays = parseInt(cfg.activityMaxDays, 10);
  if (filterInactive && maxDays > 0 && typeof Humanize !== 'undefined' && !Humanize.activityOk(job.activeText, maxDays)) {
    return { match: false, reason: 'Boss 不够活跃：' + (job.activeText || '未知'), score: 15 };
  }
  const includes = splitWords(cfg.includeKeywords).map((w) => w.toLowerCase());
  if (includes.length) {
    const hit = includes.filter((w) => blob.indexOf(w) >= 0);
    if (!hit.length) return { match: false, reason: '未命中包含词', score: 35 };
    const score = Math.min(95, 55 + hit.length * 15);
    return { match: true, reason: '规则命中：' + hit.join('、'), score: score };
  }
  return { match: true, reason: '规则通过（无包含词过滤）', score: 60 };
}

async function screenJob(cfg, job) {
  const rule = ruleScreen(cfg, job);
  if (!apiKeyOf(cfg) || !resumeFull(cfg)) return rule;
  if (!rule.match) return rule; // 排除词硬拦，不再浪费 Token

  const sys = '你是资深求职助手。请完全依据【求职者简历】判断岗位是否值得沟通。\n保留(match=true)：方向相关且经验够得着。剔除(match=false)：明显无关或明显超纲。\n只输出JSON：{"match":true或false,"reason":"一句话","score":0到100整数}';
  const user = '求职者简历：\n' + resumeFull(cfg) + '\n\n待判断岗位：\n' + jobInfo(job) + '\n\n严格输出JSON。';
  try {
    const raw = await callLLM([{ role: 'system', content: sys }, { role: 'user', content: user }], 200);
    let p = null;
    try { p = JSON.parse(raw); } catch (e) {
      const m = raw && raw.match(/\{[\s\S]*\}/);
      if (m) { try { p = JSON.parse(m[0]); } catch (e2) {} }
    }
    if (!p) return Object.assign({}, rule, { reason: rule.reason + '｜AI解析失败，保留规则结果' });
    const score = typeof p.score === 'number' ? p.score : (p.match === true ? 80 : 35);
    return { match: p.match === true, reason: p.reason || rule.reason, score: score };
  } catch (e) {
    return Object.assign({}, rule, { reason: rule.reason + '｜AI失败降级：' + e.message });
  }
}

// 首条招呼只用用户模板（支持 {jobName}/{company}），不再调用 LLM。
function genGreetingFromJD(cfg, job) {
  return GreetingTemplate.renderGreetingTemplate(
    cfg && cfg.greetingTemplate,
    job
  );
}

async function ensureInjected(tabId, file, selectorsFile) {
  const want = /content-chat/.test(file || '') ? 'chat' : 'search';
  const ping = await sendToTab(tabId, { type: 'PING' });
  if (ping && ping.ok && ping.page === want) return;
  try {
    const files = [];
    if (want === 'search') files.push('src/platform/search-filters.js');
    files.push(selectorsFile || 'src/platform/boss/selectors.js', 'src/humanize.js');
    if (want === 'chat') files.push('src/message-send.js');
    files.push(file);
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: files
    });
  } catch (e) {}
}
function sendToTab(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({
          success: false,
          error: chrome.runtime.lastError.message,
          channelClosed: isChannelClosedError(chrome.runtime.lastError.message)
        });
      } else {
        resolve(resp || { success: false, error: 'no response' });
      }
    });
  });
}

function isChannelClosedError(err) {
  return /back\/forward cache|message channel is closed|Receiving end does not exist|Extension context invalidated|The message port closed/i.test(err || '');
}

async function waitForUrlMatch(tabId, hint, timeoutMs) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < (timeoutMs || 12000)) {
    checkpoint();
    last = await curUrl(tabId);
    checkpoint();
    if (!hint || last.indexOf(hint) >= 0) return { ok: true, url: last };
    await humanWait(350, 450);
  }
  return { ok: false, url: last };
}
async function waitTabComplete(tabId, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < (timeoutMs || 30000)) {
    checkpoint();
    let tab = null;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (e) {
      throw new Error('目标标签页已关闭');
    }
    checkpoint();
    if (tab && tab.status === 'complete') {
      await humanWait(1000, 1300);
      checkpoint();
      return true;
    }
    await humanWait(200, 350);
  }
  throw new Error('等待页面加载超时');
}
function buildSearchUrl(cfg) {
  return platMeta(cfg).buildSearchUrl(cfg);
}
async function ensureTab(url, tabQuery) {
  let tabs = await chrome.tabs.query({ url: tabQuery || '*://*.zhipin.com/*' });
  let tab = tabs[0];
  if (!tab) tab = await chrome.tabs.create({ url: url });
  else await chrome.tabs.update(tab.id, { url: url });
  checkpoint();
  await waitTabComplete(tab.id);
  await humanWait(1700, 2200);
  checkpoint();
  return tab;
}
async function getSearchTab(cfg) {
  const meta = platMeta(cfg);
  return ensureTab(buildSearchUrl(cfg), meta.tabQuery);
}
async function curUrl(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return (tab && tab.url) || '';
  } catch (e) {
    return '';
  }
}

function clearBlockState() {
  state.blocked = false;
  state.blockCode = '';
  state.blockReason = '';
  state.blockNextAction = '';
}

function blockRun(reason, code) {
  const stableCode = code || 'RUN_BLOCKED';
  const guidance = DeliveryGuard.guidanceFor(stableCode);
  state.aborted = true;
  state.blocked = true;
  state.blockCode = stableCode;
  state.blockReason = reason || guidance.message;
  state.blockNextAction = guidance.nextAction;
  state.phase = 'blocked';
  pushPhase();
  chrome.runtime.sendMessage({
    type: 'BLOCKED',
    code: state.blockCode,
    reason: state.blockReason,
    nextAction: state.blockNextAction
  }).catch(() => {});
  log('已停机：' + state.blockReason + '（不会自动重试）', 'error');
  patchPersistentRun({
    status: 'blocked',
    code: state.blockCode,
    reason: state.blockReason,
    nextAction: state.blockNextAction
  }).catch(() => {});
}

function deliveryErrorResponse(error) {
  const code = (error && error.code) || 'RUN_BLOCKED';
  const guidance = DeliveryGuard.guidanceFor(code);
  return {
    ok: false,
    code: code,
    error: (error && error.message) || guidance.message,
    nextAction: (error && error.nextAction) || guidance.nextAction
  };
}

async function buildDeliveryPlan(selectedIds, expectedPlatformId) {
  const cfg = RunSafety.snapshotRunConfig(await PlatformConfig.loadFlat());
  const meta = platMeta(cfg);
  if (expectedPlatformId && meta.id !== expectedPlatformId) {
    throw DeliveryGuard.runError('PLATFORM_MISMATCH');
  }

  const cached = await chrome.storage.local.get([
    'sw_jobs',
    'sw_greetings',
    'sw_platform'
  ]);
  const jobs = Array.isArray(cached.sw_jobs)
    ? cached.sw_jobs.slice()
    : state.jobs.slice();
  const cachedPlatform = cached.sw_platform
    || (jobs[0] && jobs[0].platform)
    || meta.id;
  if (cachedPlatform !== meta.id) {
    throw DeliveryGuard.runError('PLATFORM_MISMATCH');
  }

  state.jobs = jobs;
  if (!Object.keys(state.greetings || {}).length) {
    state.greetings = cached.sw_greetings || {};
  }
  state.activePlatform = meta.id;
  state.processed = Object.assign({}, cfg.processed || {});
  const usage = PlatformConfig.getUsage(cfg);
  const dailyLimit = Math.min(50, parseInt(cfg.dailyLimit, 10) || 20);
  const plan = DeliveryGuard.prepare({
    platformId: meta.id,
    selectedIds: selectedIds,
    jobs: jobs,
    processed: state.processed,
    usageCount: usage.count,
    dailyLimit: dailyLimit,
    intervalMinSec: cfg.intervalMinSec,
    intervalMaxSec: cfg.intervalMaxSec,
    batchSize: cfg.batchSize,
    batchRestMinSec: cfg.batchRestMinSec,
    batchRestMaxSec: cfg.batchRestMaxSec,
    sendsResumeImage: !!cfg.resumeImage
  });
  return { cfg: cfg, plan: plan };
}

async function prepareDelivery(jobIds) {
  if (state.deliverLock || state.operationLock) {
    throw DeliveryGuard.runError('RUN_ACTIVE');
  }
  const prepared = await buildDeliveryPlan(jobIds);
  const intent = await deliveryIntentStore.create(prepared.plan);
  return {
    ok: true,
    intentId: intent.id,
    expiresAt: intent.expiresAt,
    plan: Object.assign({}, prepared.plan, { expiresAt: intent.expiresAt })
  };
}

async function confirmDelivery(intentId) {
  if (state.deliverLock || state.operationLock) {
    throw DeliveryGuard.runError('RUN_ACTIVE');
  }

  // 预占全局操作锁，避免消费意图与启动状态机之间插入另一个任务。
  state.operationLock = true;
  try {
    const intent = await deliveryIntentStore.consume(intentId);
    const prepared = await buildDeliveryPlan(intent.jobIds, intent.platformId);
    const plan = prepared.plan;
    DeliveryGuard.assertIntentMatchesPlan(intent, plan);
    runDeliver(intent.jobIds, { reserved: true })
      .catch((error) => log('启动联系失败：' + error.message, 'error'));
    return { ok: true, jobIds: intent.jobIds.slice() };
  } catch (error) {
    state.operationLock = false;
    throw error;
  }
}

async function runCollect() {
  if (state.operationLock) {
    log('已有任务在执行，请先停止当前任务', 'warn');
    return;
  }
  state.operationLock = true;
  state.aborted = false; state.paused = false; clearBlockState();
  state.jobs = []; state.screened = []; state.greetings = {}; state.results = [];
  startAbortScope();
  state.phase = 'collecting'; pushPhase();
  try {
  const cfg = RunSafety.snapshotRunConfig(await getCfg());
  checkpoint();
  const meta = platMeta(cfg);

  if (!meta.ready) {
    log(meta.short + ' 适配器尚未就绪（架构已预留）。请先使用 Boss，或等待后续版本。', 'error');
    state.phase = 'idle'; pushPhase();
    return;
  }
  if (!cfg.keyword) { log('请先填写岗位关键词', 'error'); state.phase = 'idle'; pushPhase(); return; }
  const count = Math.min(100, parseInt(cfg.count, 10) || 20);
  await beginPersistentRun('collect', meta.id, { total: count });
  checkpoint();

  const hasKey = !!apiKeyOf(cfg);
  if (!hasKey) log('未配置 API Key，将使用规则筛选（可勾选后联系）', 'warn');
  else if (!resumeFull(cfg)) log('未填简历文字：AI 筛选降级为规则分', 'warn');

  const _c = meta.resolveCityLabel(cfg);
  log('[' + meta.short + '] 打开搜索页：' + cfg.keyword + ' | 城市：' + (_c.found ? _c.name : '未指定/默认'));
  if (cfg.city && !_c.found) {
    log('城市“' + cfg.city + '”未识别，已停止扫描，避免误扫全国岗位', 'error');
    state.phase = 'idle'; pushPhase();
    return;
  }
  const tab = await getSearchTab(cfg);
  checkpoint();

  log('扫描岗位中（目标 ' + count + ' 个）…');
  await ensureInjected(tab.id, meta.searchScript, meta.selectorsFile);
  checkpoint();
  const loginCheck = await sendToTab(tab.id, { type: 'CHECK_LOGIN' });
  checkpoint();
  if (loginCheck && loginCheck.needLogin) {
    notifyNeedLogin(loginCheck.error || meta.loginHint);
    state.phase = 'idle'; pushPhase();
    return;
  }
  const r = await sendToTab(tab.id, {
    type: 'SCRAPE',
    count: count,
    filterInactive: cfg.filterInactive !== false && cfg.filterInactive !== 'false',
    activityMaxDays: parseInt(cfg.activityMaxDays, 10) || 7,
    city: cfg.city || '',
    experience: cfg.experience || '',
    education: cfg.education || ''
  });
  checkpoint();
  if (r && r.needLogin) {
    notifyNeedLogin(r.error || meta.loginHint);
    state.phase = 'idle'; pushPhase();
    return;
  }
  if (r && r.blocked) {
    blockRun(r.reason || r.error || '页面风控提示');
    return;
  }
  if (!r || !r.success) {
    log('扫描失败：' + (r && r.error), 'error');
    state.phase = 'idle'; pushPhase();
    return;
  }
  state.jobs = (r.jobs || []).map((j) => Object.assign({}, j, { platform: meta.id }));
  if (r.skippedInactive) log('已过滤不活跃 ' + r.skippedInactive + ' 个（拟人化降风险）', 'info');
  if (r.skippedFilters) {
    const sf = r.skippedFilters;
    const details = [];
    if (sf.city) details.push('城市 ' + sf.city);
    if (sf.experience) details.push('经验 ' + sf.experience);
    if (sf.education) details.push('学历 ' + sf.education);
    if (details.length) log('智联结果二次校验已过滤：' + details.join('、'), 'info');
  }
  log('扫描到 ' + state.jobs.length + ' 个岗位', 'success');
  if (!state.jobs.length) {
    log('未扫到岗位。请确认已登录且关键词有结果', 'warn');
    state.phase = 'idle'; pushPhase();
    return;
  }

  state.phase = 'screening'; pushPhase();
  await patchPersistentRun({ phase: 'screening', total: state.jobs.length, cursor: 0 });
  checkpoint();
  log(hasKey && resumeFull(cfg) ? 'AI + 规则筛选中…' : '规则筛选中…');
  let done = 0;
  const total = state.jobs.length;
  progress(0, total, '筛选');
  const CONC = hasKey ? 3 : 8;
  for (let i = 0; i < state.jobs.length; i += CONC) {
    if (state.aborted) break;
    await waitIfPaused();
    checkpoint();
    const batch = state.jobs.slice(i, i + CONC);
    await Promise.all(batch.map(async (job) => {
      const res = await screenJob(cfg, job);
      checkpoint();
      state.screened.push(Object.assign({}, job, { match: res.match, reason: res.reason, score: res.score }));
      done++;
      progress(done, total, '筛选');
    }));
    checkpoint();
    await patchPersistentRun({ cursor: done, total: total });
    checkpoint();
  }
  checkpoint();
  const matched = state.screened.filter((j) => j.match).length;
  log('筛选完成：建议 ' + matched + ' / ' + total + '（默认不勾选，请人工确认）', 'success');
  await chrome.storage.local.set({
    sw_jobs: state.jobs,
    sw_greetings: state.greetings,
    sw_screened: state.screened,
    sw_platform: meta.id
  });
  checkpoint();
  state.phase = 'review';
  pushPhase();
  chrome.runtime.sendMessage({ type: 'SCREENED', screened: state.screened, platform: meta.id }).catch(() => {});
  } catch (e) {
    if (RunSafety.isRunStop(e)) {
      if (!state.blocked) {
        state.phase = 'idle';
        pushPhase();
      }
      return;
    }
    state.phase = 'idle';
    pushPhase();
    log('扫描异常：' + e.message, 'error');
  } finally {
    state.abortController = null;
    const status = state.blocked
      ? 'blocked'
      : (state.aborted ? 'stopped' : (state.phase === 'review' ? 'review' : state.phase));
    try {
      await finishPersistentRun(status, {
        cursor: state.screened.length,
        total: state.jobs.length
      });
    } catch (e) {
      log('运行记录写入失败：' + e.message, 'error');
      await releaseRunKeeper();
    }
    state.operationLock = false;
  }
}

async function runDeliver(jobIds, options) {
  const reserved = !!(options && options.reserved);
  if (state.deliverLock || (state.operationLock && !reserved)) {
    log('已有联系任务在执行，请勿重复点击（操作锁）', 'warn');
    return;
  }
  if (!reserved) state.operationLock = true;
  state.deliverLock = true;
  state.aborted = false; state.paused = false; clearBlockState(); state.results = [];
  startAbortScope();
  state.phase = 'delivering'; pushPhase();
  let runCursor = 0;
  let runTotal = (jobIds || []).length;
  try {
    if (!jobIds || !jobIds.length) {
      log('未收到已选岗位，已取消（禁止空选联系）', 'error');
      state.phase = 'idle'; pushPhase();
      return;
    }
    if (!state.jobs.length) {
      const d = await chrome.storage.local.get(['sw_jobs', 'sw_greetings', 'sw_platform']);
      checkpoint();
      state.jobs = d.sw_jobs || [];
      state.greetings = d.sw_greetings || {};
    }
    const cfg = RunSafety.snapshotRunConfig(await getCfg());
    checkpoint();
    const meta = platMeta(cfg);
    const runPlatformId = meta.id;
    state.processed = Object.assign({}, cfg.processed || {});
    if (state.jobs.some((job) => job && job.platform !== runPlatformId)) {
      blockRun('缓存岗位平台与当前运行平台不一致，请重新扫描', 'PLATFORM_MISMATCH');
      return;
    }
    if (!meta.ready) {
      log(meta.short + ' 尚未就绪', 'error');
      state.phase = 'idle'; pushPhase();
      return;
    }
    if (!cfg.resumeImage) log('未上传简历图片，将只发招呼语', 'warn');

    const usage = PlatformConfig.getUsage(cfg);
    const dailyLimit = Math.min(50, parseInt(cfg.dailyLimit, 10) || 20);
    pushUsage(usage.count, dailyLimit);
    if (usage.count >= dailyLimit) {
      blockRun('已达每日上限 ' + dailyLimit + '（' + meta.short + '）', 'DAILY_LIMIT_REACHED');
      chrome.runtime.sendMessage({ type: 'DONE', ok: 0, fail: 0 }).catch(() => {});
      return;
    }

    const ids = jobIds.filter((id) => !state.processed[id]);
    if (!ids.length) { log('没有可联系的岗位（可能已联系过，可点重置）', 'warn'); finishDeliver(); return; }
    runTotal = ids.length;
    await beginPersistentRun('deliver', runPlatformId, {
      total: ids.length,
      jobIds: ids.slice()
    });
    checkpoint();

    let minSec = parseInt(cfg.intervalMinSec, 10) || 8;
    let maxSec = parseInt(cfg.intervalMaxSec, 10) || 25;
    if (maxSec < minSec) { const t = minSec; minSec = maxSec; maxSec = t; }
    minSec = Math.max(5, minSec);
    maxSec = Math.max(minSec + 1, maxSec);

    const batchSize = Math.max(1, parseInt(cfg.batchSize, 10) || 5);
    let batchRestMin = parseInt(cfg.batchRestMinSec, 10) || 45;
    let batchRestMax = parseInt(cfg.batchRestMaxSec, 10) || 90;
    if (batchRestMax < batchRestMin) { const t = batchRestMin; batchRestMin = batchRestMax; batchRestMax = t; }

    log('[' + meta.short + '] 拟人化：间隔 ' + minSec + '-' + maxSec + 's，每 ' + batchSize + ' 个后休息 ' + batchRestMin + '-' + batchRestMax + 's', 'info');

    const searchUrl = buildSearchUrl(cfg);
    let contactedThisRun = 0;

    for (let k = 0; k < ids.length; k++) {
      runCursor = k;
      if (state.aborted) break;
      await waitIfPaused();

      const usageCfg = await PlatformConfig.loadFlatFor(runPlatformId);
      checkpoint();
      const usageNow = PlatformConfig.getUsage(usageCfg);
      if (usageNow.count >= dailyLimit) {
        blockRun('已达每日上限 ' + dailyLimit + '（' + meta.short + '）', 'DAILY_LIMIT_REACHED');
        break;
      }

      const job = findJob(ids[k]);
      if (!job) { log('[' + (k + 1) + '/' + ids.length + '] 找不到岗位数据，跳过', 'warn'); continue; }
      RunSafety.validateJobPlatform(job, runPlatformId);
      await patchPersistentRun({
        cursor: k,
        currentJobId: job.id,
        results: state.results.slice()
      });
      checkpoint();
      const activeHint = job.activeText ? (' · ' + job.activeText) : '';
      log('[' + (k + 1) + '/' + ids.length + '] ' + job.name + ' - ' + (job.company || '') + activeHint);

      await humanWait(400, 1200);
      checkpoint();

      const tab = await ensureTab(searchUrl, meta.tabQuery);
      checkpoint();
      await ensureInjected(tab.id, meta.searchScript, meta.selectorsFile);
      checkpoint();
      log('  读取岗位JD…');
      const jdr = await sendToTab(tab.id, { type: 'OPEN_JD', job: job });
      checkpoint();
      if (jdr && jdr.needLogin) {
        notifyNeedLogin(jdr.error || meta.loginHint);
        blockRun(jdr.error || meta.loginHint, 'LOGIN_REQUIRED');
        break;
      }
      if (jdr && jdr.blocked) {
        blockRun(jdr.reason || '页面风控提示', jdr.code || 'RUN_BLOCKED');
        break;
      }
      if (jdr && jdr.staleReview) {
        blockRun(jdr.error || '岗位列表已变化', 'STALE_REVIEW');
        break;
      }
      if (jdr && jdr.selectorUnavailable) {
        blockRun(jdr.error || '招聘网站页面结构已变化', 'SELECTOR_UNAVAILABLE');
        break;
      }
      if (jdr && jdr.success === false) {
        blockRun(jdr.error || '无法安全读取岗位详情', 'SELECTOR_UNAVAILABLE');
        break;
      }
      const jd = (jdr && jdr.jd) || '';

      log('  使用招呼语模板…');
      let greeting = genGreetingFromJD(cfg, job);
      checkpoint();
      if (!greeting) { recordFail(job, '招呼语为空'); log('  招呼语为空，跳过', 'warn'); progress(k + 1, ids.length, '联系'); continue; }

      await humanWait(500, 1400);
      checkpoint();
      log('  发起沟通（' + meta.actionWord + '）…');
      checkpoint();
      const chatR = await sendToTab(tab.id, { type: 'GO_CHAT', job: job });
      checkpoint();
      // 点「继续沟通」会跳转聊天页，旧页进 bfcache 时通道关闭属预期，不算失败
      const goChatOk = (chatR && chatR.success !== false && !chatR.needLogin && !chatR.blocked)
        || (chatR && chatR.channelClosed)
        || (chatR && isChannelClosedError(chatR.error));
      if (chatR && chatR.needLogin) {
        notifyNeedLogin(chatR.error || meta.loginHint);
        blockRun(chatR.error || meta.loginHint, 'LOGIN_REQUIRED');
        break;
      }
      if (chatR && chatR.sendResultUnknown) {
        const uncertainUsage = await commitContactRecord(runPlatformId, job, k);
        if (uncertainUsage.added) contactedThisRun++;
        recordFail(job, chatR.error || '联系结果未知');
        blockRun(chatR.error || '联系结果未知', 'SEND_RESULT_UNKNOWN');
        progress(k + 1, ids.length, '联系');
        break;
      }
      if (chatR && chatR.targetUncertain) {
        if (chatR.externalActionPossible !== false) {
          const uncertainUsage = await commitContactRecord(runPlatformId, job, k);
          if (uncertainUsage.added) contactedThisRun++;
        }
        recordFail(job, chatR.error || '无法确认目标岗位或会话');
        blockRun(chatR.error || '无法确认目标岗位或会话', 'TARGET_UNCERTAIN');
        progress(k + 1, ids.length, '联系');
        break;
      }
      if (chatR && chatR.selectorUnavailable) {
        blockRun(chatR.error || '招聘网站页面结构已变化', 'SELECTOR_UNAVAILABLE');
        break;
      }
      if (chatR && chatR.blocked) {
        blockRun(chatR.reason || '沟通受限', chatR.code || 'RUN_BLOCKED');
        break;
      }
      if (!goChatOk) {
        recordFail(job, (chatR && chatR.error) || '发起沟通失败');
        log('  失败：' + ((chatR && chatR.error) || '发起沟通失败'), 'error');
        progress(k + 1, ids.length, '联系');
        continue;
      }
      if (chatR && (chatR.channelClosed || isChannelClosedError(chatR.error))) {
        log('  页面跳转中（消息通道关闭，继续等待聊天页）…', 'info');
      }

      // GO_CHAT 已产生或可能已产生平台外部副作用：立即原子记入去重与日限。
      const contactUsage = await commitContactRecord(runPlatformId, job, k);
      if (contactUsage.added) contactedThisRun++;
      checkpoint();

      // 智联等：列表页已投递成功，无需进聊天页发招呼
      if (chatR && (chatR.skipChat || chatR.applied)) {
        recordOk(job);
        log('  ✓ 已投递/联系（' + meta.short + ' 今日 ' + contactUsage.count + '/' + dailyLimit + '）' + (greeting ? '（已按模板准备招呼语，网页未开聊则未发出）' : ''), 'success');
        progress(k + 1, ids.length, '联系');
      } else {
        await waitTabComplete(tab.id);
        checkpoint();
        const chatWait = await waitForUrlMatch(tab.id, meta.chatPathHint, 15000);
        checkpoint();
        await humanWait(800, 1600);
        checkpoint();

        const u = chatWait.url || await curUrl(tab.id);
        if (meta.chatPathHint && u.indexOf(meta.chatPathHint) < 0) {
          recordFail(job, '已建联，但未跳转聊天页');
          log('  已按建联计入日限，但未进入聊天页（当前：' + (u || '').slice(0, 80) + '），不自动重试', 'error');
          progress(k + 1, ids.length, '联系');
          continue;
        }
        // 聊天页是新文档，必须重新注入
        await ensureInjected(tab.id, meta.chatScript, meta.selectorsFile);
        checkpoint();
        await humanWait(500, 700);
        checkpoint();
        // 若首次注入被导航打断，再试一次
        let ping = await sendToTab(tab.id, { type: 'PING' });
        if (!ping || !ping.ok) {
          await ensureInjected(tab.id, meta.chatScript, meta.selectorsFile);
          checkpoint();
          await humanWait(700, 900);
          checkpoint();
          ping = await sendToTab(tab.id, { type: 'PING' });
          checkpoint();
        }
        if (!ping || !ping.ok) {
          recordFail(job, '已建联，但聊天页脚本未就绪');
          blockRun('聊天页脚本未就绪，无法安全定位发送控件', 'SELECTOR_UNAVAILABLE');
          progress(k + 1, ids.length, '联系');
          break;
        }
        log('  发送招呼语…');
        const expected = { id: job.id, name: job.name, company: job.company, hrName: job.hrName || '' };
        checkpoint();
        let r = await sendToTab(tab.id, { type: 'SEND_ACTIVE', image: cfg.resumeImage || '', greeting: greeting, expected: expected });
        checkpoint();
        if (r && (r.channelClosed || isChannelClosedError(r.error))) {
          await ensureInjected(tab.id, meta.chatScript, meta.selectorsFile);
          checkpoint();
          await humanWait(700, 900);
          checkpoint();
          // 发送结果未知时禁止自动重放，避免重复招呼。
          r = { success: false, unknown: true, error: '发送结果未知，已停止自动重试' };
        }
        if (r && r.needLogin) {
          notifyNeedLogin(r.error || meta.loginHint);
          blockRun(r.error || meta.loginHint, 'LOGIN_REQUIRED');
          break;
        }
        if (r && r.blocked) {
          blockRun(r.reason || '发送时触发风控', r.code || 'RUN_BLOCKED');
          break;
        }
        if (r && r.unknown) {
          recordFail(job, '已建联；' + r.error);
          blockRun(r.error, 'SEND_RESULT_UNKNOWN');
          progress(k + 1, ids.length, '联系');
          break;
        }
        if (r && r.targetUncertain) {
          recordFail(job, '已建联；' + r.error);
          blockRun(r.error, 'TARGET_UNCERTAIN');
          progress(k + 1, ids.length, '联系');
          break;
        }
        if (r && r.selectorUnavailable) {
          recordFail(job, '已建联；' + r.error);
          blockRun(r.error, 'SELECTOR_UNAVAILABLE');
          progress(k + 1, ids.length, '联系');
          break;
        }
        if (r && r.success) {
          if (r && r.success && r.conversationRef &&
              typeof r.baselineIncomingFingerprint === 'string') {
            try {
              await conversationStore.registerConversation({
                platform: 'boss',
                conversationId: r.conversationRef.conversationId,
                url: r.conversationRef.url,
                jobId: job.id,
                company: job.company || '',
                position: job.name || '',
                hrName: job.hrName || '',
                aliases: Array.isArray(r.conversationRef.aliases)
                  ? r.conversationRef.aliases
                  : [],
                peerSource: 'encryptUid',
                initialIncomingFingerprint: r.baselineIncomingFingerprint
              });
            } catch (_registrationFailure) {
              // 联系已明确成功；不可靠的托管元数据不能追溯改变本次结果。
            }
          }
          recordOk(job);
          log('  ✓ 已联系（' + meta.short + ' 今日 ' + contactUsage.count + '/' + dailyLimit + '）', 'success');
        } else {
          recordFail(job, '已建联；招呼语失败：' + ((r && r.error) || '发送失败'));
          log('  已按建联计入日限；招呼语失败且不会自动重试：' + ((r && r.error) || '发送失败'), 'error');
        }
        progress(k + 1, ids.length, '联系');
      }

      if (k < ids.length - 1 && !state.aborted && !state.blocked) {
        if (contactedThisRun > 0 && contactedThisRun % batchSize === 0) {
          log('批次休息 ' + batchRestMin + '-' + batchRestMax + ' 秒，降低风控触发…', 'warn');
          await humanWait(batchRestMin * 1000, batchRestMax * 1000);
          checkpoint();
        } else {
          const waited = await humanWait(minSec * 1000, maxSec * 1000);
          checkpoint();
          log('  等待约 ' + Math.round(waited / 1000) + 's 后继续', 'info');
        }
      }
      runCursor = k + 1;
    }
    if (!state.blocked && !state.aborted) finishDeliver();
    else chrome.runtime.sendMessage({ type: 'DONE', ok: state.results.filter((x) => x.ok).length, fail: state.results.filter((x) => !x.ok).length }).catch(() => {});
  } catch (e) {
    if (RunSafety.isRunStop(e)) {
      if (!state.blocked) {
        state.phase = 'idle';
        pushPhase();
      }
    } else {
      blockRun('运行异常：' + e.message, e.code || 'RUN_BLOCKED');
    }
  } finally {
    state.deliverLock = false;
    state.abortController = null;
    const status = state.blocked
      ? 'blocked'
      : (state.aborted ? 'stopped' : (state.phase === 'done' ? 'done' : state.phase));
    try {
      await finishPersistentRun(status, { cursor: runCursor, total: runTotal });
    } catch (e) {
      log('运行记录写入失败：' + e.message, 'error');
      await releaseRunKeeper();
    }
    state.operationLock = false;
  }
}

function recordOk(job) { state.results.push({ id: job.id, name: job.name, ok: true }); }
function recordFail(job, msg) { state.results.push({ id: job.id, name: job.name, ok: false, msg: msg }); }
function finishDeliver() {
  const ok = state.results.filter((r) => r.ok).length;
  const fail = state.results.length - ok;
  state.phase = 'done';
  pushPhase();
  log('本轮联系完成：成功 ' + ok + ' | 失败 ' + fail, 'success');
  chrome.runtime.sendMessage({ type: 'DONE', ok: ok, fail: fail }).catch(() => {});
}

function apiConfigVersion(config) {
  return Number.isSafeInteger(config && config.apiConfigVersion) &&
    config.apiConfigVersion >= 0 ? config.apiConfigVersion : 0;
}

function apiOutboundIdentity(config) {
  const source = config || {};
  return {
    provider: typeof source.provider === 'string' && source.provider
      ? source.provider
      : 'deepseek',
    apiKey: typeof source.apiKey === 'string' && source.apiKey.trim()
      ? source.apiKey.trim()
      : (typeof source.dsKey === 'string' ? source.dsKey.trim() : ''),
    baseUrl: typeof source.baseUrl === 'string' ? source.baseUrl.trim() : ''
  };
}

function sameApiTestConfig(left, right) {
  const leftIdentity = apiOutboundIdentity(left);
  const rightIdentity = apiOutboundIdentity(right);
  return apiConfigVersion(left) === apiConfigVersion(right) &&
    leftIdentity.provider === rightIdentity.provider &&
    leftIdentity.apiKey === rightIdentity.apiKey &&
    leftIdentity.baseUrl === rightIdentity.baseUrl;
}

async function readApiTestConfig() {
  return chrome.storage.local.get([
    'provider',
    'apiKey',
    'dsKey',
    'baseUrl',
    'apiConfigVersion',
    'apiLastTestOk',
    'apiLastTestAt',
    'apiLastTestVersion'
  ]);
}

async function testApi() {
  let started;
  try {
    started = await readApiTestConfig();
  } catch (_) {
    return { ok: false, code: 'API_TEST_PERSIST_FAILED', error: '读取 API 配置失败' };
  }
  const startedVersion = apiConfigVersion(started);
  let result;
  try {
    if (!apiOutboundIdentity(started).apiKey) {
      throw new Error('未配置 API Key');
    }
    const response = await callLLM(
      [
        {
          role: 'system',
          content: 'You are a connectivity probe. Reply with exactly the two ASCII letters ok and nothing else.'
        },
        { role: 'user', content: 'Reply with exactly: ok' }
      ],
      16,
      Object.assign({}, started, apiOutboundIdentity(started)),
      { temperature: 0, ignoreAbort: true }
    );
    if (!isApiTestOkReply(response)) {
      throw new Error('API_TEST_PROTOCOL_MISMATCH');
    }
    result = { ok: true, code: 'OK' };
  } catch (e) {
    result = classifyApiTestFailure(e);
  }

  let beforeWrite;
  try {
    beforeWrite = await readApiTestConfig();
  } catch (_) {
    return { ok: false, code: 'API_TEST_PERSIST_FAILED' };
  }
  if (!sameApiTestConfig(started, beforeWrite)) {
    return { ok: false, code: 'API_TEST_STALE' };
  }

  try {
    await chrome.storage.local.set({
      apiLastTestOk: result.ok === true,
      apiLastTestAt: Date.now(),
      apiLastTestVersion: startedVersion
    });
  } catch (_) {
    return { ok: false, code: 'API_TEST_PERSIST_FAILED' };
  }

  let afterWrite;
  try {
    afterWrite = await readApiTestConfig();
  } catch (_) {
    return { ok: false, code: 'API_TEST_PERSIST_FAILED' };
  }
  if (!sameApiTestConfig(started, afterWrite) ||
    apiConfigVersion(afterWrite) !== startedVersion ||
    afterWrite.apiLastTestVersion !== startedVersion) {
    try {
      await chrome.storage.local.set({
        apiLastTestOk: false,
        apiLastTestAt: 0,
        apiLastTestVersion: startedVersion
      });
    } catch (_) {
      return { ok: false, code: 'API_TEST_PERSIST_FAILED' };
    }
    return { ok: false, code: 'API_TEST_STALE' };
  }
  return result;
}

function apiProofStaleError() {
  const error = new Error('API_PROOF_STALE');
  error.code = 'API_PROOF_STALE';
  return error;
}

async function loadCurrentProvenApiConfig() {
  const leaseEpoch = apiProofEpoch;
  const config = await PlatformConfig.loadFlat();
  const configVersion = apiConfigVersion(config);
  const proofVersion = Number.isSafeInteger(config.apiLastTestVersion) &&
    config.apiLastTestVersion >= 0 ? config.apiLastTestVersion : 0;
  const testedAt = Number(config.apiLastTestAt);
  const now = Date.now();
  const recent = config.apiLastTestOk === true &&
    Number.isFinite(testedAt) &&
    testedAt > 0 &&
    now >= testedAt &&
    now - testedAt <= 24 * 60 * 60 * 1000;
  if (leaseEpoch !== apiProofEpoch ||
    !apiKeyOf(config) ||
    proofVersion !== configVersion ||
    !recent) {
    throw apiProofStaleError();
  }
  return { cfg: config, epoch: leaseEpoch };
}

function assertApiProofLease(lease) {
  if (!lease || lease.epoch !== apiProofEpoch) throw apiProofStaleError();
}

const trusteeshipPageAdapter = TrusteeshipRuntime.createPageAdapter({
  chromeApi: chrome,
  store: conversationStore
});
const trusteeshipClassifier = TrusteeshipRuntime.createClassifier({
  replyAI: ReplyAI,
  callLLM: callLLM
});
const trusteeshipNotifier = TrusteeshipRuntime.createNotifier({
  store: conversationStore,
  client: trusteeshipFeishuClient,
  notifierModule: FeishuNotifier
});
const protectedTrusteeshipPageAdapter = {
  async read() {
    const args = Array.from(arguments);
    const lease = await loadCurrentProvenApiConfig();
    const assertLease = () => assertApiProofLease(lease);
    assertLease();
    return trusteeshipPageAdapter.read(args[0], assertLease);
  },
  async send() {
    const args = Array.from(arguments);
    const lease = await loadCurrentProvenApiConfig();
    const assertLease = () => assertApiProofLease(lease);
    assertLease();
    return trusteeshipPageAdapter.send(args[0], args[1], args[2], assertLease);
  }
};
const protectedTrusteeshipClassifier = {
  async classify(input) {
    const lease = await loadCurrentProvenApiConfig();
    const assertLease = () => assertApiProofLease(lease);
    assertLease();
    return trusteeshipClassifier.classify(input, lease.cfg, assertLease);
  },
  async draft(input) {
    const lease = await loadCurrentProvenApiConfig();
    const assertLease = () => assertApiProofLease(lease);
    assertLease();
    return trusteeshipClassifier.draft(input, lease.cfg, assertLease);
  }
};
const protectedTrusteeshipNotifier = {
  async notifyApproval() {
    const args = Array.from(arguments);
    const lease = await loadCurrentProvenApiConfig();
    const callerAssertLease = args[1];
    const assertLease = (snapshot) => {
      assertApiProofLease(lease);
      if (typeof callerAssertLease === 'function') callerAssertLease(snapshot);
    };
    assertApiProofLease(lease);
    return trusteeshipNotifier.notifyApproval(args[0], assertLease);
  },
  async notifyResolved() {
    const args = Array.from(arguments);
    const lease = await loadCurrentProvenApiConfig();
    const callerAssertLease = args[1];
    const assertLease = (snapshot) => {
      assertApiProofLease(lease);
      if (typeof callerAssertLease === 'function') callerAssertLease(snapshot);
    };
    assertApiProofLease(lease);
    return trusteeshipNotifier.notifyResolved(args[0], assertLease);
  }
};
const getTrusteeshipResumeFacts = TrusteeshipRuntime.createResumeFacts(
  () => PlatformConfig.loadFlat()
);
function makeTrusteeshipSimulationId(kind) {
  const suffix = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : (Date.now() + '-' + Math.random().toString(16).slice(2));
  return 'simulation-' + kind + '-' + suffix;
}
const trusteeshipSimulator = TrusteeshipSimulator.create({
  storeModule: ConversationStore,
  engineModule: MonitorEngine,
  productionStore: conversationStore,
  classifier: protectedTrusteeshipClassifier,
  policy: TrusteeshipPolicy,
  getResumeFacts: getTrusteeshipResumeFacts,
  clock: () => Date.now(),
  idFactory: makeTrusteeshipSimulationId
});
monitorEngine = MonitorEngine.create({
  store: conversationStore,
  reader: protectedTrusteeshipPageAdapter,
  classifier: protectedTrusteeshipClassifier,
  notifier: protectedTrusteeshipNotifier,
  policy: TrusteeshipPolicy,
  clock: () => new Date(),
  getResumeFacts: getTrusteeshipResumeFacts,
  guardExternalAction: loadCurrentProvenApiConfig
});
trusteeshipRuntime = TrusteeshipRuntime.createController({
  chromeApi: chrome,
  storage: chrome.storage.local,
  store: conversationStore,
  engine: monitorEngine,
  simulator: trusteeshipSimulator,
  policy: TrusteeshipPolicy,
  notifierModule: FeishuNotifier,
  feishuClient: trusteeshipFeishuClient,
  saveApi: PlatformConfig.saveApi,
  runApiTest: testApi,
  now: () => Date.now()
});

function isTrusteeshipMessage(msg) {
  return !!msg && typeof msg.type === 'string' &&
    msg.type.indexOf('TRUSTEESHIP_') === 0;
}

function isTrustedTrusteeshipSender(sender) {
  return !!sender &&
    sender.tab === undefined &&
    sender.frameId === undefined &&
    typeof sender.url === 'string' &&
    sender.url === chrome.runtime.getURL('/src/sidepanel.html');
}

function handleTrusteeshipRuntimeMessage(msg, sender, sendResponse) {
  if (!isTrustedTrusteeshipSender(sender)) {
    sendResponse({ ok: false, code: 'TRUSTEESHIP_UNAUTHORIZED' });
    return;
  }
  if (!TrusteeshipRuntime.validateUserMessage(msg)) {
    sendResponse({ ok: false, code: 'TRUSTEESHIP_MESSAGE_INVALID' });
    return;
  }
  workerReady
    .then(() => {
      if (workerInitializationFailed) {
        return { ok: false, code: 'SERVICE_WORKER_INTERRUPTED' };
      }
      return trusteeshipRuntime.handleMessage(msg);
    })
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, code: 'SERVICE_WORKER_INTERRUPTED' }));
}

function handleApiTestMessage(msg, sender, sendResponse) {
  if (!isTrustedTrusteeshipSender(sender)) {
    sendResponse({ ok: false, code: 'TRUSTEESHIP_UNAUTHORIZED' });
    return;
  }
  if (Object.keys(msg).length !== 1 || msg.type !== 'TEST_API') {
    sendResponse({ ok: false, code: 'TRUSTEESHIP_MESSAGE_INVALID' });
    return;
  }
  workerReady
    .then(() => {
      if (workerInitializationFailed) {
        return { ok: false, code: 'SERVICE_WORKER_INTERRUPTED' };
      }
      return trusteeshipRuntime.runApiTest();
    })
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, code: 'API_TEST_PERSIST_FAILED' }));
}

function handleApiConfigSaveMessage(msg, sender, sendResponse) {
  if (!isTrustedTrusteeshipSender(sender)) {
    sendResponse({ ok: false, code: 'TRUSTEESHIP_UNAUTHORIZED' });
    return;
  }
  if (!TrusteeshipRuntime.validateApiConfigMessage(msg)) {
    sendResponse({ ok: false, code: 'API_CONFIG_INPUT_INVALID' });
    return;
  }
  workerReady
    .then(() => {
      if (workerInitializationFailed) {
        return { ok: false, code: 'SERVICE_WORKER_INTERRUPTED' };
      }
      return trusteeshipRuntime.saveApiConfig(msg);
    })
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, code: 'API_CONFIG_SAVE_FAILED' }));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'KEEPALIVE' && msg.source === 'offscreen') {
    sendResponse({ ok: true, active: !!state.operationLock });
    return;
  }
  if (msg.type === 'START_COLLECT') {
    workerReady.then(() => runCollect()).catch((e) => log('启动扫描失败：' + e.message, 'error'));
    sendResponse({ ok: true });
    return;
  }
  if (isTrusteeshipMessage(msg)) {
    handleTrusteeshipRuntimeMessage(msg, sender, sendResponse);
    return true;
  }
  if (msg.type === 'SAVE_API_CONFIG') {
    handleApiConfigSaveMessage(msg, sender, sendResponse);
    return true;
  }
  if (msg.type === 'TEST_API') {
    handleApiTestMessage(msg, sender, sendResponse);
    return true;
  }
  if (msg.type === 'PREPARE_DELIVERY') {
    workerReady
      .then(() => prepareDelivery(msg.jobIds || []))
      .then(sendResponse)
      .catch((error) => sendResponse(deliveryErrorResponse(error)));
    return true;
  }
  if (msg.type === 'CONFIRM_DELIVERY') {
    workerReady
      .then(() => confirmDelivery(msg.intentId))
      .then(sendResponse)
      .catch((error) => sendResponse(deliveryErrorResponse(error)));
    return true;
  }
  if (msg.type === 'CANCEL_DELIVERY') {
    workerReady
      .then(() => deliveryIntentStore.cancel(msg.intentId))
      .then((cancelled) => sendResponse({ ok: true, cancelled: cancelled }))
      .catch((error) => sendResponse(deliveryErrorResponse(error)));
    return true;
  }
  if (msg.type === 'START_DELIVER') {
    sendResponse(deliveryErrorResponse(
      DeliveryGuard.runError('CONFIRMATION_REQUIRED')
    ));
    return;
  }
  if (msg.type === 'PAUSE') { state.paused = true; log('已暂停', 'warn'); sendResponse({ ok: true }); return; }
  if (msg.type === 'RESUME') { state.paused = false; log('继续', 'info'); sendResponse({ ok: true }); return; }
  if (msg.type === 'STOP') {
    state.aborted = true; state.paused = false;
    if (state.abortController) state.abortController.abort();
    log('已停止', 'warn');
    state.phase = 'idle'; pushPhase();
    patchPersistentRun({ status: 'stopping', reason: 'user_stopped' }).catch(() => {});
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'RESET') {
    if (state.operationLock) {
      sendResponse({ ok: false, error: '运行中不能重置会话' });
      return;
    }
    state.processed = {};
    getCfg().then((cfg) => {
      PlatformConfig.setProcessed(cfg.activePlatform || 'boss', {});
    });
    state.jobs = []; state.screened = []; state.greetings = {}; state.results = [];
    clearBlockState();
    state.phase = 'idle'; pushPhase();
    log('已重置会话去重（未清每日计数）', 'warn');
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'GET_STATE') {
    runStore.current().then((persistentRun) => {
      sendResponse({
        phase: state.phase,
        screened: state.screened,
        platform: state.activePlatform,
        blockCode: state.blockCode,
        blockReason: state.blockReason,
        blockNextAction: state.blockNextAction,
        persistentRun: persistentRun
      });
    }).catch((e) => sendResponse({ phase: state.phase, error: e.message }));
    return true;
  }
  if (msg.type === 'MIGRATE_CONFIG') {
    PlatformConfig.ensureMigrated().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

workerReady = (async function initializeWorker() {
  try {
    const recovered = await runStore.recoverInterrupted();
    const cfg = await PlatformConfig.loadFlat();
    state.activePlatform = (recovered && recovered.platformId) || cfg.activePlatform || 'boss';
    state.processed = cfg.processed || {};
    if (recovered) {
      blockRun(
        '检测到浏览器后台意外中断。为避免重复联系，任务已阻塞。',
        'SERVICE_WORKER_INTERRUPTED'
      );
      await releaseRunKeeper();
    }
    await reconcileTrusteeshipAlarm();
  } catch (e) {
    workerInitializationFailed = true;
    try {
      await trusteeshipRuntime.failClosed();
    } catch (_) {}
    blockRun(
      '后台初始化失败。为避免重复联系，托管与批量流程均已暂停。',
      'SERVICE_WORKER_INTERRUPTED'
    );
    return false;
  }
})();
