// ===== 聊天页 content script：打开会话 + 先发图片 + 再发招呼语 =====
(function () {
  if (window.__bossContactChat) return;
  window.__bossContactChat = true;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /** 避免对 javascript: 链接调用原生 click() 触发 CSP 报错 */
  async function safeClick(el) {
    if (!el) return false;
    if (typeof Humanize !== 'undefined' && typeof Humanize.humanClick === 'function') {
      return Humanize.humanClick(el);
    }
    try {
      let anchor = null;
      try {
        if (typeof el.closest === 'function') anchor = el.closest('a[href]');
      } catch (e) {}
      if (!anchor && String(el.tagName || '').toLowerCase() === 'a') anchor = el;
      const href = anchor && typeof anchor.getAttribute === 'function'
        ? (anchor.getAttribute('href') || '')
        : '';
      if (/^\s*javascript\s*:/i.test(href)) {
        const opts = { bubbles: true, cancelable: true, view: window };
        const ev = new MouseEvent('click', opts);
        ev.preventDefault();
        el.dispatchEvent(ev);
        return true;
      }
      el.click();
      return true;
    } catch (e) {
      return false;
    }
  }

  function detectBlock() {
    const body = (document.body && document.body.innerText) || '';
    const hints = ['验证码', '滑动验证', '人机验证', '今日沟通已达上限', '沟通次数已达上限', '操作过于频繁'];
    for (let i = 0; i < hints.length; i++) {
      if (body.indexOf(hints[i]) >= 0) return { blocked: true, reason: '检测到：' + hints[i] };
    }
    return null;
  }

  function detectLoginIssue() {
    const href = location.href || '';
    if (/\/web\/user\/|\/login|passport\.zhipin\.com/i.test(href)) {
      return { needLogin: true, error: '聊天页跳到登录，请重新登录 Boss' };
    }
    return null;
  }

  async function dismissCommonDialogs() {
    const blocked = detectBlock();
    if (blocked) return blocked;
    const preferExact = ['确定', '我知道了', '知道了', '确认', '好的', '继续沟通', '继续'];
    const avoid = ['取消', '拒绝', '暂不', '下次再说'];
    for (let round = 0; round < 3; round++) {
      let hit = null;
      const els = document.querySelectorAll('a, button, span, div[role="button"]');
      for (const el of els) {
        if (!el || el.offsetParent === null) continue;
        const tx = (el.textContent || '').trim();
        if (!tx || tx.length > 12) continue;
        if (avoid.indexOf(tx) >= 0) continue;
        if (preferExact.indexOf(tx) >= 0) { hit = el; break; }
      }
      if (!hit) break;
      try { await safeClick(hit); } catch (e) {}
      await sleep(400);
      const b2 = detectBlock();
      if (b2) return b2;
    }
    return null;
  }

  // 多选择器找第一个可见元素
  function findVisible(selList) {
    for (const sel of selList) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (el && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed')) return el;
      }
    }
    return null;
  }
  async function waitVisible(selList, timeout) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const el = findVisible(selList);
      if (el) return el;
      await sleep(250);
    }
    return null;
  }

  const INPUT_SELS = ['div#chat-input', '#chat-input', 'div.chat-input', '.chat-input[contenteditable]', '[contenteditable="true"]', 'textarea.input-area', '.chat-editor textarea', 'textarea[placeholder]', 'textarea'];
  const SEND_SELS = ['button.btn-send', '.btn-send', 'button[class*="send"]', '[class*="send-btn"]'];
  const IMG_SELS = ['.btn-sendimg input[type=file]', '.toolbar input[type=file]', 'input[type=file]'];

  // 诊断：把页面里可编辑元素结构dump成字符串（找不到输入框时回传，便于定位）
  function dumpInputs() {
    const out = [];
    document.querySelectorAll('[contenteditable="true"], textarea, div[id*="input"], div[class*="input"]').forEach((el, i) => {
      if (i < 8) out.push(el.tagName + '#' + (el.id || '') + '.' + (typeof el.className === 'string' ? el.className.slice(0, 40) : ''));
    });
    return out.join(' | ') || '无可编辑元素';
  }

  function dataURLtoFile(dataUrl, name) {
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const bin = atob(parts[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], name || 'resume.png', { type: mime });
  }

  async function openConversation(company, hrName, position) {
    await waitVisible([SELECTORS.chat.userList], 8000);
    const items = Array.from(document.querySelectorAll(SELECTORS.chat.userList));
    if (!items.length) return { ok: false, selectorUnavailable: true, err: '会话列表为空' };
    let target = null;
    const ck = (company || '').replace(/\s/g, '');
    const hk = (hrName || '').replace(/\s/g, '');
    const pk = (position || '').replace(/\s/g, '');
    for (const li of items) {
      const tx = (li.textContent || '').replace(/\s/g, '');
      if (ck && tx.indexOf(ck) >= 0) { target = li; break; }
      if (pk && tx.indexOf(pk) >= 0) { target = li; break; }
      if (hk && tx.indexOf(hk) >= 0) { target = li; break; }
    }
    if (!target) return { ok: false, targetUncertain: true, err: '未找到与目标岗位匹配的会话，已停止发送' };
    target.click();
    await sleep(1600);
    return { ok: true };
  }

  async function sendImage(image) {
    if (!image) return true;
    const input = findVisible(IMG_SELS) || document.querySelector('input[type=file]');
    if (!input) return false;
    const file = dataURLtoFile(image, 'resume.png');
    const dt = new DataTransfer();
    dt.items.add(file);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files').set;
    setter.call(input, dt.files);
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(2500);
    return true;
  }

  function inputText(el) { return (el.isContentEditable || el.getAttribute('contenteditable') === 'true') ? (el.textContent || '') : (el.value || ''); }

  function pressEnter(el) {
    const opt = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opt));
    el.dispatchEvent(new KeyboardEvent('keypress', opt));
    el.dispatchEvent(new KeyboardEvent('keyup', opt));
  }

  function activeConversationText() {
    const selectors = (SELECTORS.chat.activeContext || '').split(',').map((s) => s.trim()).filter(Boolean);
    const parts = [];
    const seen = new Set();
    function pushText(value) {
      const text = String(value || '').trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      parts.push(text);
    }
    const activeUsers = SELECTORS.chat.activeUser
      ? Array.from(document.querySelectorAll(SELECTORS.chat.activeUser))
      : [];
    activeUsers.forEach((el) => {
      if (el && el.offsetParent !== null) pushText(el.innerText || el.textContent || '');
    });
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        if (el && el.offsetParent !== null) pushText(el.innerText || el.textContent || '');
      });
    });
    return parts.join(' | ').slice(0, 1200);
  }

  async function waitForExpectedConversation(expected, timeoutMs) {
    const target = expectedFromSession(expected);
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    let text = activeConversationText();
    while (true) {
      if (MessageSend.matchesExpectedConversation(text, target)) {
        return { ok: true, target: target, text: text };
      }
      if (Date.now() >= deadline) {
        return { ok: false, target: target, text: text };
      }
      await sleep(350);
      text = activeConversationText();
    }
  }

  function expectedFromSession(fallback) {
    try {
      const saved = JSON.parse(sessionStorage.getItem('__job_contact_expected__') || 'null');
      if (saved && Date.now() - Number(saved.at || 0) < 10 * 60 * 1000) return saved;
    } catch (e) {}
    return fallback || {};
  }

  function selectorFailure(error) {
    return {
      success: false,
      errorCode: 'SELECTOR_UNAVAILABLE',
      selectorUnavailable: true,
      error: error
    };
  }

  function targetFailure(error) {
    return {
      success: false,
      errorCode: 'TARGET_UNCERTAIN',
      targetUncertain: true,
      error: error
    };
  }

  function managedPreflight() {
    const login = detectLoginIssue();
    if (login) {
      return {
        success: false,
        errorCode: 'LOGIN_REQUIRED',
        needLogin: true,
        error: login.error || 'Boss 登录态不可用'
      };
    }
    const blocked = detectBlock();
    if (blocked) {
      return {
        success: false,
        errorCode: 'BOSS_BLOCKED',
        blocked: true,
        error: blocked.reason || 'Boss 页面已阻止自动操作'
      };
    }
    return null;
  }

  function managedBackgroundPreflight() {
    if (document.visibilityState === 'visible') {
      return targetFailure('托管后台标签已被用户接管');
    }
    return managedPreflight();
  }

  function isVisible(element) {
    return !!element && (
      element.offsetParent !== null ||
      getComputedStyle(element).position === 'fixed'
    );
  }

  function ownDatasetIds(elements) {
    const ids = [];
    const re = /^[A-Za-z0-9_~-]{1,128}$/;
    for (const element of elements) {
      if (!element || !element.dataset) continue;
      for (const key of ['conversationId', 'uid']) {
        if (!Object.prototype.hasOwnProperty.call(element.dataset, key)) continue;
        let value;
        try {
          value = element.dataset[key];
        } catch (e) {
          return null;
        }
        if (typeof value !== 'string' || !re.test(value)) return null;
        ids.push({ key: key, value: value });
      }
    }
    return ids;
  }

  function uniqueDataset(ids) {
    const values = Array.from(new Set(ids.map((item) => item.value)));
    if (values.length > 1) return null;
    const dataset = {};
    ids.forEach((item) => {
      dataset[item.key] = item.value;
    });
    return dataset;
  }

  function hasOwnedRelation(link, activeItem, container, activeIds, containerIds) {
    const datasetMatch = activeIds.some((left) =>
      containerIds.some((right) => left.key === right.key && left.value === right.value)
    );
    if (datasetMatch) return true;

    const controlledId = (
      activeItem.getAttribute('aria-controls') ||
      link.getAttribute('aria-controls') ||
      ''
    ).trim();
    if (controlledId && container.id && controlledId === container.id) return true;

    const labelledBy = (container.getAttribute('aria-labelledby') || '').trim();
    const activeIdsForAria = [activeItem.id, link.id].filter(Boolean);
    return !!labelledBy && activeIdsForAria.indexOf(labelledBy) >= 0;
  }

  function scopedConversationText(scope) {
    const parts = [];
    const activeText = (
      scope.activeItem.innerText ||
      scope.activeItem.textContent ||
      scope.link.innerText ||
      scope.link.textContent ||
      ''
    ).trim();
    if (activeText) parts.push(activeText);
    const selectors = (SELECTORS.chat.activeContext || '')
      .split(',')
      .map((selector) => selector.trim())
      .filter(Boolean);
    selectors.forEach((selector) => {
      scope.pane.querySelectorAll(selector).forEach((element) => {
        if (!isVisible(element)) return;
        const text = (element.innerText || element.textContent || '').trim();
        if (text) parts.push(text);
      });
    });
    return parts.join(' | ').slice(0, 1200);
  }

  function resolveOwnedConversation() {
    if (typeof BossConversationReader === 'undefined') {
      return selectorFailure('Boss 会话读取器不可用');
    }
    const linkSelector = SELECTORS.chat.conversationLink;
    const listSelector = SELECTORS.chat.messageList;
    if (!linkSelector || !listSelector) {
      return selectorFailure('活动会话或消息容器选择器不可用');
    }
    let links;
    let containers;
    try {
      links = Array.from(document.querySelectorAll(linkSelector)).filter(isVisible);
      containers = Array.from(document.querySelectorAll(listSelector)).filter(isVisible);
    } catch (e) {
      return selectorFailure('活动会话或消息容器选择器不可用');
    }
    if (!links.length || !containers.length) {
      return selectorFailure('未找到明确的活动会话链接');
    }
    if (links.length !== 1 || containers.length !== 1) {
      return targetFailure('页面存在多个可见活动会话或消息容器');
    }
    const link = links[0];
    const container = containers[0];
    const activeItem = typeof link.closest === 'function'
      ? (link.closest('li.active') || link)
      : link;
    const pane = container.parentElement;
    if (!pane) return selectorFailure('目标会话消息容器缺少明确父级面板');

    const activeIds = ownDatasetIds(activeItem === link ? [link] : [activeItem, link]);
    const containerIds = ownDatasetIds([container]);
    if (!activeIds || !containerIds) {
      return targetFailure('活动会话或消息容器标识不安全');
    }
    const activeDataset = uniqueDataset(activeIds);
    if (!activeDataset) return targetFailure('活动会话存在冲突标识');
    if (!hasOwnedRelation(link, activeItem, container, activeIds, containerIds)) {
      return targetFailure('活动会话与消息容器缺少明确归属关系');
    }

    const ref = BossConversationReader.extractConversationRef({
      pageUrl: location.href || '',
      activeHref: link.href || '',
      activeDataset: activeDataset
    });
    if (!ref) {
      return targetFailure('当前活动会话缺少可靠标识，已停止托管操作');
    }
    if (containerIds.some((item) => item.value !== ref.conversationId)) {
      return targetFailure('消息容器标识与活动会话不一致');
    }
    return {
      success: true,
      conversationRef: ref,
      scope: {
        link: link,
        activeItem: activeItem,
        container: container,
        pane: pane
      }
    };
  }

  function sanitizedExpectedRef(expectedRef) {
    if (!expectedRef || typeof expectedRef !== 'object') return null;
    const peerId = typeof expectedRef.conversationId === 'string'
      ? expectedRef.conversationId
      : '';
    if (typeof BossPeerIdentity !== 'undefined' && BossPeerIdentity.isPeerId(peerId)) {
      const aliases = Array.isArray(expectedRef.aliases) ? expectedRef.aliases : [];
      const canonical = BossPeerIdentity.toCanonicalRef(
        peerId,
        'https://www.zhipin.com',
        aliases
      );
      if (!canonical) return null;
      if (typeof expectedRef.url === 'string' && expectedRef.url &&
          expectedRef.url !== canonical.url) {
        // 允许历史 conversationId= URL，只要 ID 集合能覆盖
        const fromUrl = BossConversationReader.extractConversationRef({
          pageUrl: expectedRef.url
        });
        if (!fromUrl || !BossPeerIdentity.matchesManagedIdentity(fromUrl.conversationId, {
          conversationId: peerId,
          aliases: aliases
        })) {
          return null;
        }
      }
      return {
        conversationId: canonical.conversationId,
        url: typeof expectedRef.url === 'string' && expectedRef.url
          ? expectedRef.url
          : canonical.url,
        aliases: canonical.aliases
      };
    }
    const ref = BossConversationReader.extractConversationRef({
      pageUrl: expectedRef.url
    });
    if (!ref || ref.conversationId !== expectedRef.conversationId) return null;
    return Object.assign({ aliases: [] }, ref);
  }

  function validateManagedTarget(expected, expectedRef) {
    const active = resolveOwnedConversation();
    if (!active.success) return active;
    let conversationRef = active.conversationRef;
    if (expectedRef) {
      const wanted = sanitizedExpectedRef(expectedRef);
      if (!wanted) {
        return targetFailure('当前活动会话与登记会话标识不一致，已停止托管操作');
      }
      const managed = {
        conversationId: wanted.conversationId,
        aliases: wanted.aliases || []
      };
      const activeId = active.conversationRef.conversationId;
      const matched = typeof BossPeerIdentity !== 'undefined'
        ? BossPeerIdentity.matchesManagedIdentity(activeId, managed)
        : activeId === wanted.conversationId;
      if (!matched) {
        return targetFailure('当前活动会话与登记会话标识不一致，已停止托管操作');
      }
      // 向 engine 返回 canonical peerId，避免 DOM 临时 ID 与持久主键不一致
      conversationRef = {
        conversationId: wanted.conversationId,
        url: wanted.url,
        aliases: managed.aliases
      };
    }
    if (!MessageSend.matchesExpectedConversation(scopedConversationText(active.scope), expected || {})) {
      return targetFailure('当前会话无法与预期岗位/公司/HR 匹配，已停止托管操作');
    }
    return {
      success: true,
      conversationRef: conversationRef,
      scope: active.scope
    };
  }

  async function fetchGeekFriendList() {
    try {
      const response = await fetch(
        'https://www.zhipin.com/wapi/zprelation/friend/getGeekFriendList.json?page=1',
        {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        }
      );
      if (!response.ok) {
        return { ok: false, errorCode: 'PEER_LIST_UNAVAILABLE' };
      }
      const data = await response.json();
      if (!data || data.code !== 0) {
        return { ok: false, errorCode: 'PEER_LIST_UNAVAILABLE' };
      }
      const zpData = data.zpData && typeof data.zpData === 'object' ? data.zpData : {};
      const friends = Array.isArray(zpData.result)
        ? zpData.result
        : (Array.isArray(zpData.friendList) ? zpData.friendList : []);
      return { ok: true, friends: friends };
    } catch (_) {
      return { ok: false, errorCode: 'PEER_LIST_UNAVAILABLE' };
    }
  }

  async function resolvePeerFromActive(active) {
    if (typeof BossPeerIdentity === 'undefined') {
      return {
        success: false,
        errorCode: 'PEER_ID_UNRESOLVED',
        targetUncertain: true,
        error: '会话主键解析器不可用'
      };
    }
    const list = await fetchGeekFriendList();
    if (!list.ok) {
      return {
        success: false,
        errorCode: 'PEER_LIST_UNAVAILABLE',
        targetUncertain: true,
        error: '无法读取 Boss 好友列表以确认稳定会话标识'
      };
    }
    const resolved = BossPeerIdentity.resolvePeerIdentity({
      domIds: [active.conversationRef.conversationId],
      friends: list.friends,
      origin: location.origin || 'https://www.zhipin.com'
    });
    if (!resolved.ok) {
      return {
        success: false,
        errorCode: resolved.errorCode || 'PEER_ID_UNRESOLVED',
        targetUncertain: true,
        error: '无法将当前会话对齐到稳定的 encryptUid'
      };
    }
    return {
      success: true,
      conversationRef: {
        conversationId: resolved.peerId,
        url: resolved.url,
        aliases: resolved.aliases
      },
      peerSource: resolved.peerSource,
      domId: active.conversationRef.conversationId,
      matchedName: resolved.matchedName || '',
      matchedCompany: resolved.matchedCompany || ''
    };
  }

  function readStableTime(element) {
    if (!element) return null;
    const raw = element.getAttribute('data-time') || element.getAttribute('datetime') || '';
    if (/^\d{10,16}$/.test(raw)) return Number(raw);
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }

  function readStrictMessages(scope) {
    const fields = ['messageList', 'messageItem', 'messageIncoming', 'messageOutgoing', 'messageText', 'messageTime'];
    for (const field of fields) {
      if (typeof SELECTORS.chat[field] !== 'string' || !SELECTORS.chat[field]) {
        return selectorFailure('消息读取选择器不可用：' + field);
      }
    }

    let nodes;
    try {
      nodes = Array.from(scope.container.querySelectorAll(SELECTORS.chat.messageItem));
    } catch (e) {
      return selectorFailure('消息列表选择器不可用');
    }
    if (!nodes.length) return selectorFailure('未找到目标会话消息列表');

    const rawItems = nodes.slice(-200).map((node) => {
      let incoming = false;
      let outgoing = false;
      try {
        incoming = node.matches(SELECTORS.chat.messageIncoming);
        outgoing = node.matches(SELECTORS.chat.messageOutgoing);
      } catch (e) {
        return null;
      }
      if (incoming === outgoing) return null;

      let textElement = null;
      let timeElement = null;
      try {
        textElement = node.querySelector(SELECTORS.chat.messageText);
        timeElement = node.querySelector(SELECTORS.chat.messageTime);
      } catch (e) {
        return null;
      }
      const explicitKind = node.dataset && node.dataset.kind;
      const kind = explicitKind || (textElement ? 'text' : '');
      return {
        id: (node.dataset && (node.dataset.messageId || node.dataset.id)) || '',
        direction: incoming ? 'incoming' : 'outgoing',
        kind: kind,
        text: textElement ? (textElement.textContent || '') : '',
        at: readStableTime(timeElement)
      };
    }).filter(Boolean);

    const messages = BossConversationReader.normalizeMessages(rawItems);
    if (!messages.length) {
      return selectorFailure('消息结构无法可靠识别，已停止读取');
    }
    return { success: true, messages: messages };
  }

  function lastIncomingFingerprint(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].direction === 'incoming') return messages[i].fingerprint;
    }
    return '';
  }

  async function captureManagementMetadata(expected) {
    const active = validateManagedTarget(expected);
    if (!active.success) return null;
    const read = readStrictMessages(active.scope);
    if (!read.success) return null;
    const owned = resolveOwnedConversation();
    if (!owned.success) return null;
    const peer = await resolvePeerFromActive(owned);
    if (!peer.success) return null;
    return {
      conversationRef: peer.conversationRef,
      peerSource: peer.peerSource,
      baselineIncomingFingerprint: lastIncomingFingerprint(read.messages)
    };
  }

  async function sendText(greeting, expected) {
    const input = await waitVisible(INPUT_SELS, 8000);
    if (!input) return { ok: false, selectorUnavailable: true, err: '未找到输入框｜页面候选：' + dumpInputs() };
    const target = expectedFromSession(expected);
    if (!MessageSend.matchesExpectedConversation(activeConversationText(), target)) {
      return { ok: false, targetUncertain: true, err: '当前会话无法与目标岗位/公司/HR 匹配，已停止发送' };
    }
    input.focus();
    await sleep(300);
    const editable = input.isContentEditable || input.getAttribute('contenteditable') === 'true';
    if (editable) {
      input.textContent = greeting;
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: greeting }));
    } else {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input, greeting);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(700);
    if (!inputText(input).trim()) return { ok: false, err: '文字未填入输入框' };

    const sent = await MessageSend.sendExactlyOnce({
      readInput: () => inputText(input),
      readSentCount: () => document.querySelectorAll(SELECTORS.chat.messageSent).length,
      pressEnter: () => pressEnter(input),
      clickSend: () => {
        const btn = findVisible(SEND_SELS);
        if (!btn || btn.classList.contains('disabled') || btn.disabled) return false;
        btn.click();
        return true;
      },
      wait: sleep,
      attempts: 12
    });
    return sent.ok ? { ok: true, via: sent.via } : { ok: false, err: sent.error };
  }

  async function doSend(msg) {
    const oc = await openConversation(msg.company, msg.hrName, msg.position);
    if (!oc.ok) {
      return {
        success: false,
        error: oc.err,
        targetUncertain: !!oc.targetUncertain,
        selectorUnavailable: !!oc.selectorUnavailable
      };
    }
    const imgOk = await sendImage(msg.image);
    await sleep(800);
    const tr = await sendText(msg.greeting, {
      company: msg.company,
      hrName: msg.hrName,
      name: msg.position
    });
    if (!tr.ok) {
      return {
        success: false,
        error: tr.err,
        targetUncertain: !!tr.targetUncertain,
        selectorUnavailable: !!tr.selectorUnavailable
      };
    }
    const metadata = await captureManagementMetadata({
      company: msg.company,
      hrName: msg.hrName,
      name: msg.position
    });
    return Object.assign({ success: true, imageOk: imgOk }, metadata || {});
  }

  // 发给当前已打开的会话（继续沟通跳入后做身份复核；页面文案晚到时短重试）
  async function sendActive(image, greeting, expected) {
    const login = detectLoginIssue();
    if (login) return login;
    const dlg = await dismissCommonDialogs();
    if (dlg) return dlg;
    const blocked = detectBlock();
    if (blocked) return blocked;
    let input = await waitVisible(INPUT_SELS, 6000);
    if (!input) return { success: false, selectorUnavailable: true, error: '未找到输入框｜' + dumpInputs() };
    const matched = await waitForExpectedConversation(expected, 4500);
    if (!matched.ok) {
      return {
        success: false,
        targetUncertain: true,
        error: '当前会话无法与目标岗位/公司/HR 匹配，未发送简历或招呼语'
      };
    }
    const target = matched.target;
    if (typeof Humanize !== 'undefined') await Humanize.humanDelay(400, 1100);
    const imgOk = await sendImage(image);
    await sleep(800);
    if (typeof Humanize !== 'undefined') await Humanize.humanDelay(300, 900);
    const tr = await sendText(greeting, target);
    if (!tr.ok) {
      return {
        success: false,
        error: tr.err,
        targetUncertain: !!tr.targetUncertain,
        selectorUnavailable: !!tr.selectorUnavailable
      };
    }
    const metadata = await captureManagementMetadata(target);
    return Object.assign({ success: true, imageOk: imgOk }, metadata || {});
  }

  function getActiveConversationRef(msg) {
    const preflight = managedPreflight();
    if (preflight) return preflight;
    const active = validateManagedTarget(msg.expected);
    if (!active.success) return active;
    const read = readStrictMessages(active.scope);
    if (!read.success) return read;
    return {
      success: true,
      conversationRef: active.conversationRef,
      baselineIncomingFingerprint: lastIncomingFingerprint(read.messages)
    };
  }

  function textOf(element) {
    if (!element) return '';
    return String(element.innerText || element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }

  function extractActiveIdentity(scope) {
    let hrName = '';
    let company = '';
    let position = '';
    try {
      if (SELECTORS.chat.userName) {
        hrName = textOf(scope.activeItem.querySelector(SELECTORS.chat.userName));
      }
      if (SELECTORS.chat.userCompany) {
        company = textOf(scope.activeItem.querySelector(SELECTORS.chat.userCompany));
      }
    } catch (_) {}
    try {
      const positionNode = scope.pane.querySelector(
        '.position-name, [class*="position-name"], .base-info, [class*="base-info"]'
      );
      position = textOf(positionNode);
    } catch (_) {}
    if (!hrName && !company && !position) {
      const fallback = textOf(scope.activeItem) || textOf(scope.link);
      company = fallback.slice(0, 80);
    }
    return {
      company: company,
      position: position,
      hrName: hrName
    };
  }

  // 用户手动登记：对齐好友列表 encryptUid，不依赖扫描岗位 expected 身份。
  async function captureActiveConversation() {
    const preflight = managedPreflight();
    if (preflight) return preflight;
    const active = resolveOwnedConversation();
    if (!active.success) return active;
    const read = readStrictMessages(active.scope);
    if (!read.success) return read;
    const identity = extractActiveIdentity(active.scope);
    if (!identity.company && !identity.position && !identity.hrName) {
      return targetFailure('当前会话缺少可识别的岗位/公司/HR 信息，无法登记托管');
    }
    const peer = await resolvePeerFromActive(active);
    if (!peer.success) return peer;
    return {
      success: true,
      conversationRef: peer.conversationRef,
      peerSource: peer.peerSource || 'encryptUid',
      baselineIncomingFingerprint: lastIncomingFingerprint(read.messages),
      company: identity.company,
      position: identity.position,
      hrName: identity.hrName
    };
  }

  async function probePeerIdentity() {
    const preflight = managedPreflight();
    if (preflight) return preflight;
    const active = resolveOwnedConversation();
    if (!active.success) return active;
    const list = await fetchGeekFriendList();
    if (!list.ok) {
      return {
        success: false,
        errorCode: 'PEER_LIST_UNAVAILABLE',
        domId: active.conversationRef.conversationId,
        error: '无法读取 Boss 好友列表'
      };
    }
    const resolved = typeof BossPeerIdentity !== 'undefined'
      ? BossPeerIdentity.resolvePeerIdentity({
        domIds: [active.conversationRef.conversationId],
        friends: list.friends,
        origin: location.origin || 'https://www.zhipin.com'
      })
      : { ok: false, errorCode: 'PEER_ID_UNRESOLVED' };
    return {
      success: resolved.ok === true,
      errorCode: resolved.ok === true ? undefined : (resolved.errorCode || 'PEER_ID_UNRESOLVED'),
      domId: active.conversationRef.conversationId,
      peerId: resolved.ok === true ? resolved.peerId : '',
      url: resolved.ok === true ? resolved.url : '',
      aliases: resolved.ok === true ? resolved.aliases : [],
      peerSource: resolved.ok === true ? resolved.peerSource : '',
      sameAsDom: resolved.ok === true && resolved.peerId === active.conversationRef.conversationId,
      matchedName: resolved.ok === true ? (resolved.matchedName || '') : '',
      matchedCompany: resolved.ok === true ? (resolved.matchedCompany || '') : ''
    };
  }

  function readActiveConversation(msg) {
    const preflight = managedBackgroundPreflight();
    if (preflight) return preflight;
    if (!Object.prototype.hasOwnProperty.call(msg, 'lastFingerprint') ||
        typeof msg.lastFingerprint !== 'string') {
      return {
        success: false,
        errorCode: 'BASELINE_REQUIRED',
        baselineRequired: true,
        error: '增量读取必须提供明确的消息基线'
      };
    }
    const active = validateManagedTarget(msg.expected, msg.conversationRef);
    if (!active.success) return active;
    const read = readStrictMessages(active.scope);
    if (!read.success) return read;

    const baseline = msg.lastFingerprint;
    if (baseline && !read.messages.some((item) =>
      item.direction === 'incoming' && item.fingerprint === baseline
    )) {
      return {
        success: false,
        errorCode: 'BASELINE_NOT_FOUND',
        baselineMissing: true,
        error: '消息基线不在当前目标会话中，已停止增量读取'
      };
    }
    const selected = BossConversationReader.selectNewIncoming(read.messages, baseline);
    return {
      success: true,
      conversationRef: active.conversationRef,
      messages: selected,
      baselineIncomingFingerprint: selected.length
        ? selected[selected.length - 1].fingerprint
        : baseline
    };
  }

  function strictManagedInput(scope) {
    const inputSelector = SELECTORS.chat.chatInput;
    const sendSelector = SELECTORS.chat.btnSend;
    const sentSelector = SELECTORS.chat.messageOutgoing;
    if (!inputSelector || !sendSelector || !sentSelector) {
      return selectorFailure('托管发送选择器不可用');
    }
    let inputs;
    let buttons;
    try {
      inputs = Array.from(scope.pane.querySelectorAll(inputSelector)).filter(isVisible);
      buttons = Array.from(scope.pane.querySelectorAll(sendSelector)).filter(isVisible);
    } catch (e) {
      return selectorFailure('托管输入框或发送按钮选择器不可用');
    }
    if (!inputs.length || !buttons.length) {
      return selectorFailure('未找到明确的托管输入框或发送按钮');
    }
    if (inputs.length !== 1 || buttons.length !== 1) {
      return targetFailure('目标会话存在多个可见输入框或发送按钮');
    }
    return {
      success: true,
      input: inputs[0],
      button: buttons[0],
      sentSelector: sentSelector
    };
  }

  function fillManagedInput(input, text) {
    input.focus();
    const editable = input.isContentEditable || input.getAttribute('contenteditable') === 'true';
    if (editable) {
      input.textContent = text;
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: text
      }));
      return;
    }
    if (input.tagName !== 'TEXTAREA') return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function sameOwnedScope(left, right) {
    return !!left && !!right &&
      left.link === right.link &&
      left.activeItem === right.activeItem &&
      left.container === right.container &&
      left.pane === right.pane;
  }

  function unknownSendFailure() {
    return {
      success: false,
      errorCode: 'SEND_RESULT_UNKNOWN',
      sendResultUnknown: true,
      error: '托管回复发送结果未知，请人工核对 Boss 会话'
    };
  }

  async function sendManagedReply(msg) {
    const preflight = managedBackgroundPreflight();
    if (preflight) return preflight;
    const active = validateManagedTarget(msg.expected, msg.conversationRef);
    if (!active.success) return active;

    const draft = typeof msg.draft === 'string' ? msg.draft.trim() : '';
    if (!draft || Array.from(draft).length > 300) {
      return { success: false, errorCode: 'DRAFT_INVALID', error: '托管回复草稿无效' };
    }
    const beforeRead = readStrictMessages(active.scope);
    if (!beforeRead.success) return beforeRead;
    const beforeOutgoing = new Set(
      beforeRead.messages
        .filter((message) => message.direction === 'outgoing')
        .map((message) => message.fingerprint)
    );
    const controls = strictManagedInput(active.scope);
    if (!controls.success) return controls;

    fillManagedInput(controls.input, draft);
    await sleep(300);
    if (inputText(controls.input).trim() !== draft) {
      return { success: false, errorCode: 'INPUT_NOT_FILLED', error: '托管回复未可靠填入输入框' };
    }

    let actionStarted = false;
    let preActionFailure = null;
    let fallbackUnsafe = false;
    function revalidateBeforeAction() {
      const ownership = managedBackgroundPreflight();
      if (ownership) {
        preActionFailure = ownership;
        return null;
      }
      const latest = validateManagedTarget(msg.expected, msg.conversationRef);
      if (!latest.success) {
        preActionFailure = latest;
        return null;
      }
      if (!sameOwnedScope(active.scope, latest.scope)) {
        preActionFailure = targetFailure('目标会话作用域在发送前发生变化');
        return null;
      }
      return latest;
    }

    const sent = await MessageSend.sendExactlyOnce({
      readInput: () => inputText(controls.input),
      readSentCount: () => active.scope.container.querySelectorAll(controls.sentSelector).length,
      pressEnter: () => {
        const latest = revalidateBeforeAction();
        if (!latest) return;
        const latestControls = strictManagedInput(latest.scope);
        if (!latestControls.success || latestControls.input !== controls.input) {
          preActionFailure = latestControls.success
            ? targetFailure('目标会话输入框在发送前发生变化')
            : latestControls;
          return;
        }
        actionStarted = true;
        pressEnter(latestControls.input);
      },
      clickSend: () => {
        const latest = revalidateBeforeAction();
        if (!latest) {
          fallbackUnsafe = true;
          return false;
        }
        const latestControls = strictManagedInput(latest.scope);
        if (!latestControls.success) {
          preActionFailure = latestControls;
          fallbackUnsafe = true;
          return false;
        }
        if (latestControls.input !== controls.input ||
            latestControls.button !== controls.button ||
            inputText(latestControls.input) !== draft) {
          fallbackUnsafe = true;
          return false;
        }
        if (latestControls.button.classList.contains('disabled') || latestControls.button.disabled) {
          return false;
        }
        actionStarted = true;
        latestControls.button.click();
        return true;
      },
      wait: sleep,
      attempts: 12
    });
    if (fallbackUnsafe && actionStarted) return unknownSendFailure();
    if (preActionFailure && !actionStarted) return preActionFailure;
    if (!sent.ok) {
      return actionStarted ? unknownSendFailure() : (preActionFailure || unknownSendFailure());
    }

    const postTarget = validateManagedTarget(msg.expected, msg.conversationRef);
    if (!postTarget.success || !sameOwnedScope(active.scope, postTarget.scope)) {
      return unknownSendFailure();
    }
    const read = readStrictMessages(postTarget.scope);
    if (!read.success) return unknownSendFailure();
    const evidence = read.messages.filter((message) =>
      message.direction === 'outgoing' &&
      message.kind === 'text' &&
      message.text === draft &&
      !beforeOutgoing.has(message.fingerprint)
    );
    if (evidence.length !== 1 || !evidence[0].fingerprint) return unknownSendFailure();
    const finalTarget = validateManagedTarget(msg.expected, msg.conversationRef);
    if (!finalTarget.success || !sameOwnedScope(active.scope, finalTarget.scope)) {
      return unknownSendFailure();
    }
    const observedAt = Date.now();
    if (!Number.isFinite(observedAt) || observedAt <= 0) return unknownSendFailure();
    return {
      success: true,
      via: sent.via,
      conversationRef: finalTarget.conversationRef,
      targetConversationId: finalTarget.conversationRef.conversationId,
      sentFingerprint: evidence[0].fingerprint,
      baselineIncomingFingerprint: lastIncomingFingerprint(read.messages),
      observedAt: observedAt
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ ok: true, page: 'chat' });
      return;
    }
    if (msg.type === 'SEND') {
      doSend(msg).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (msg.type === 'SEND_ACTIVE') {
      sendActive(msg.image, msg.greeting, msg.expected).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (msg.type === 'GET_ACTIVE_CONVERSATION_REF') {
      sendResponse(getActiveConversationRef(msg));
      return;
    }
    if (msg.type === 'CAPTURE_ACTIVE_CONVERSATION') {
      captureActiveConversation().then((r) => sendResponse(r)).catch(() => sendResponse({
        success: false,
        errorCode: 'PEER_ID_UNRESOLVED',
        targetUncertain: true,
        error: '登记当前会话失败'
      }));
      return true;
    }
    if (msg.type === 'PROBE_PEER_IDENTITY') {
      probePeerIdentity().then((r) => sendResponse(r)).catch(() => sendResponse({
        success: false,
        errorCode: 'PEER_LIST_UNAVAILABLE',
        error: '探测会话标识失败'
      }));
      return true;
    }
    if (msg.type === 'READ_ACTIVE_CONVERSATION') {
      sendResponse(readActiveConversation(msg));
      return;
    }
    if (msg.type === 'SEND_MANAGED_REPLY') {
      sendManagedReply(msg).then(r => sendResponse(r)).catch(() => sendResponse({
        success: false,
        errorCode: 'SEND_RESULT_UNKNOWN',
        sendResultUnknown: true,
        error: '托管回复发送结果未知，请人工核对 Boss 会话'
      }));
      return true;
    }
  });
})();
