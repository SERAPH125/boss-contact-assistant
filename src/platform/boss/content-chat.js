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
    // 通用清理只能关闭明确的提示类弹窗。确认、继续沟通等按钮可能产生
    // 平台外部副作用，必须留给已绑定目标身份的专用写路径处理。
    const preferExact = ['我知道了', '知道了'];
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
      if (MessageSend.matchesExpectedConversationStrict(text, target)) {
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

  function messageOrderFailure(error) {
    return {
      success: false,
      errorCode: 'MESSAGE_ORDER_UNCERTAIN',
      messageOrderUncertain: true,
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

  function nearestManagedControlPane(container) {
    const inputSelector = SELECTORS.chat.chatInput;
    const sendSelector = SELECTORS.chat.btnSend;
    if (!container || !inputSelector || !sendSelector) return null;
    let current = container.parentElement;
    for (let depth = 0; current && depth < 8; depth++) {
      try {
        const inputs = Array.from(current.querySelectorAll(inputSelector)).filter(isVisible);
        const buttons = Array.from(current.querySelectorAll(sendSelector)).filter(isVisible);
        if (inputs.length && buttons.length) return current;
      } catch (_) {
        return null;
      }
      current = current.parentElement;
    }
    return null;
  }

  function elementHref(element) {
    if (!element) return '';
    if (typeof element.href === 'string' && element.href) return element.href;
    try {
      const attr = element.getAttribute && element.getAttribute('href');
      return typeof attr === 'string' ? attr : '';
    } catch (_) {
      return '';
    }
  }

  // conversationLink 可能同时命中父级 .friend-content 与内部 a，只保留最内层节点。
  function preferInnermostNodes(nodes) {
    return nodes.filter((node) =>
      !nodes.some((other) =>
        other !== node &&
        typeof node.contains === 'function' &&
        node.contains(other)
      )
    );
  }

  // 现网活动会话常无 DOM dataset；用户切换会话后，最新一条同源、精确路径的
  // historyMsg 请求对应当前会话。旧请求会一直保留在 Performance 记录中。
  function extractBossIdFromHistoryRequests() {
    try {
      if (typeof performance === 'undefined' ||
          typeof performance.getEntriesByType !== 'function') {
        return '';
      }
      const pageOrigin = new URL(location.href || '').origin;
      const entries = performance.getEntriesByType('resource');
      for (let i = entries.length - 1; i >= 0; i--) {
        const name = entries[i] && entries[i].name ? String(entries[i].name) : '';
        let resource;
        try {
          resource = new URL(name);
        } catch (_) {
          continue;
        }
        if (resource.protocol !== 'https:' ||
            resource.origin !== pageOrigin ||
            resource.pathname !== '/wapi/zpchat/geek/historyMsg') {
          continue;
        }
        const values = resource.searchParams.getAll('bossId');
        if (values.length !== 1 || !/^[A-Za-z0-9_~-]{1,128}$/.test(values[0])) {
          return '';
        }
        return values[0];
      }
      return '';
    } catch (_) {}
    return '';
  }

  function resolveOwnedConversation() {
    if (typeof BossConversationReader === 'undefined') {
      return selectorFailure('Boss 会话读取器不可用');
    }
    const linkSelector = SELECTORS.chat.conversationLink;
    const activeSelector = SELECTORS.chat.activeUser;
    const listSelector = SELECTORS.chat.messageList;
    if (!listSelector || (!linkSelector && !activeSelector)) {
      return selectorFailure('活动会话或消息容器选择器不可用');
    }
    let links;
    let containers;
    try {
      links = linkSelector
        ? Array.from(document.querySelectorAll(linkSelector)).filter(isVisible)
        : [];
      if (!links.length && activeSelector) {
        links = Array.from(document.querySelectorAll(activeSelector)).filter(isVisible);
      }
      links = preferInnermostNodes(links);
      containers = preferInnermostNodes(
        Array.from(document.querySelectorAll(listSelector)).filter(isVisible)
      );
    } catch (e) {
      return selectorFailure('活动会话或消息容器选择器不可用');
    }
    if (!links.length || !containers.length) {
      return selectorFailure('未找到明确的活动会话或消息容器');
    }
    if (links.length !== 1 || containers.length !== 1) {
      return targetFailure('页面存在多个可见活动会话或消息容器');
    }
    const link = links[0];
    const container = containers[0];
    const activeItem = typeof link.closest === 'function'
      ? (link.closest('li.active') ||
        link.closest('.friend-content.active') ||
        link.closest('.friend-content') ||
        link)
      : link;
    const pane = container.parentElement;
    if (!pane) return selectorFailure('目标会话消息容器缺少明确父级面板');
    const controlPane = nearestManagedControlPane(container);

    const activeIds = ownDatasetIds(activeItem === link ? [link] : [activeItem, link]);
    const containerIds = ownDatasetIds([container]);
    if (!activeIds || !containerIds) {
      return targetFailure('活动会话或消息容器标识不安全');
    }
    let activeDataset = uniqueDataset(activeIds);
    if (!activeDataset) return targetFailure('活动会话存在冲突标识');

    const historyBossId = extractBossIdFromHistoryRequests();
    const pageOnlyRef = BossConversationReader.extractConversationRef({
      pageUrl: location.href || ''
    });
    const pageConversationId = pageOnlyRef && pageOnlyRef.conversationId
      ? pageOnlyRef.conversationId
      : '';
    const softId = pageConversationId || historyBossId || '';
    const ownedByRelation = hasOwnedRelation(
      link, activeItem, container, activeIds, containerIds
    );
    // 现网常见：单活动会话 + 单消息容器，但两侧无共享 dataset/ARIA。
    // 仅当页面 URL 或 historyMsg bossId 能提供稳定 ID，且不与两侧 dataset 冲突时放行。
    if (!ownedByRelation) {
      if (!softId) {
        return targetFailure('活动会话与消息容器缺少明确归属关系');
      }
      const activeId = activeDataset.conversationId || activeDataset.uid || '';
      if (activeId && activeId !== softId) {
        return targetFailure('活动会话标识与页面/history 不一致');
      }
      if (containerIds.some((item) => item.value !== softId)) {
        return targetFailure('消息容器标识与活动会话不一致');
      }
      if (!activeDataset.conversationId && !activeDataset.uid) {
        activeDataset = Object.assign({}, activeDataset, { uid: softId });
      }
    }

    const activeHref = elementHref(link);
    const refInput = {
      pageUrl: location.href || '',
      activeDataset: activeDataset
    };
    if (activeHref) refInput.activeHref = activeHref;
    const ref = BossConversationReader.extractConversationRef(refInput);
    if (!ref) {
      return targetFailure('当前活动会话缺少可靠标识，已停止托管操作');
    }
    if (containerIds.some((item) => item.value !== ref.conversationId)) {
      return targetFailure('消息容器标识与活动会话不一致');
    }
    const conversationCandidateIds = typeof BossPeerIdentity !== 'undefined'
      ? BossPeerIdentity.uniqueIds(
        [ref.conversationId, historyBossId, pageConversationId]
          .concat(activeIds.map((item) => item.value))
          .concat(containerIds.map((item) => item.value))
      )
      : [ref.conversationId];
    return {
      success: true,
      conversationRef: ref,
      conversationCandidateIds: conversationCandidateIds,
      scope: {
        link: link,
        activeItem: activeItem,
        container: container,
        pane: pane,
        controlPane: controlPane
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
        aliases,
        expectedRef.peerUid
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
        aliases: canonical.aliases,
        peerUid: canonical.peerUid || ''
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
      const candidateIds = Array.isArray(active.conversationCandidateIds) &&
        active.conversationCandidateIds.length
        ? active.conversationCandidateIds
        : [active.conversationRef.conversationId];
      const matched = candidateIds.some((activeId) =>
        typeof BossPeerIdentity !== 'undefined'
          ? BossPeerIdentity.matchesManagedIdentity(activeId, managed)
          : activeId === wanted.conversationId
      );
      if (!matched) {
        return targetFailure('当前活动会话与登记会话标识不一致，已停止托管操作');
      }
      // 向 engine 返回 canonical peerId，避免 DOM 临时 ID 与持久主键不一致
      conversationRef = {
        conversationId: wanted.conversationId,
        url: wanted.url,
        aliases: managed.aliases,
        peerUid: wanted.peerUid || ''
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
    const candidateIds = BossPeerIdentity.uniqueIds(
      [active.conversationRef.conversationId]
        .concat(active.conversationCandidateIds || [])
    );
    const resolvedCandidates = [];
    candidateIds.forEach((candidateId) => {
      const candidate = BossPeerIdentity.resolvePeerIdentity({
        domIds: [candidateId],
        friends: list.friends,
        origin: location.origin || 'https://www.zhipin.com'
      });
      if (!candidate.ok) return;
      if (resolvedCandidates.some((item) => item.peerId === candidate.peerId)) return;
      resolvedCandidates.push(candidate);
    });
    let resolved = resolvedCandidates[0] || null;
    if (resolvedCandidates.length > 1) {
      const activeText = scopedConversationText(active.scope);
      const matching = resolvedCandidates.filter((candidate) =>
        MessageSend.matchesExpectedConversation(activeText, {
          hrName: candidate.matchedName || '',
          company: candidate.matchedCompany || '',
          name: candidate.matchedPosition || ''
        })
      );
      resolved = matching.length === 1 ? matching[0] : null;
    }
    if (!resolved) {
      return {
        success: false,
        errorCode: 'PEER_ID_UNRESOLVED',
        targetUncertain: true,
        error: '无法将当前会话对齐到稳定的 encryptUid'
      };
    }
    return {
      success: true,
      conversationRef: {
        conversationId: resolved.peerId,
        url: resolved.url,
        aliases: resolved.aliases,
        peerUid: resolved.peerUid || ''
      },
      peerSource: resolved.peerSource,
      domId: resolved.peerId,
      matchedName: resolved.matchedName || '',
      matchedCompany: resolved.matchedCompany || '',
      matchedPosition: resolved.matchedPosition || ''
    };
  }

  function stablePeerMatchesExpected(peer, expected, options) {
    const target = expected && typeof expected === 'object' ? expected : {};
    const domMatched = !!(options && options.domMatched === true);
    // HR 必须硬匹配；公司/岗位在 DOM 已证明后允许简称漂移（如「花生企管」
    // vs 工商全称），只是不计为证据，不能因此否决唯一收敛的 peer。
    const pairs = [
      {
        actual: peer && peer.matchedName,
        wanted: target.hrName,
        hard: true
      },
      {
        actual: peer && peer.matchedCompany,
        wanted: target.company,
        hard: !domMatched
      },
      {
        actual: peer && peer.matchedPosition,
        wanted: target.name || target.position,
        hard: !domMatched
      }
    ];
    let evidenceCount = 0;
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const actual = typeof pair.actual === 'string' ? pair.actual.trim() : '';
      const wanted = typeof pair.wanted === 'string' ? pair.wanted.trim() : '';
      if (!actual || !wanted) continue;
      if (!MessageSend.matchesExpectedConversation(actual, {
        company: wanted
      })) {
        if (pair.hard) return false;
        continue;
      }
      evidenceCount += 1;
    }
    // 好友列表常缺岗位名；若活动 DOM 已与原目标严格匹配，且 peer 由该活动
    // 会话唯一收敛，则 HR 或公司任一稳定字段即可完成二次佐证。
    const minEvidence = domMatched ? 1 : 2;
    return evidenceCount >= minEvidence;
  }

  // 岗位卡与系统通知不属于对话正文，排除后不参与基线与游标。
  const HISTORY_SYSTEM_BODY_TYPES = new Set([8, 16]);

  function safeHistoryMessageId(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      return String(value);
    }
    if (typeof value === 'string' && BossConversationReader.ID_RE.test(value)) {
      return value;
    }
    return '';
  }

  // 历史接口的 mid/time 在协议里都是 int64；protobufjs 系实现会把它们序列化成字符串。
  function safeHistoryTime(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      return value;
    }
    if (typeof value === 'string' && /^[0-9]{1,15}$/.test(value)) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
    }
    return null;
  }

  function compareDecimalStrings(left, right) {
    const a = String(left || '').replace(/^0+(?=\d)/, '');
    const b = String(right || '').replace(/^0+(?=\d)/, '');
    if (a.length !== b.length) return a.length - b.length;
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  function orderHistoryMessages(messages) {
    const items = messages.slice(0, 200).map((message, index) => ({
      message: message,
      index: index,
      at: safeHistoryTime(message && message.time),
      id: safeHistoryMessageId(message && message.mid)
    }));
    const allHaveTime = items.every((item) => item.at !== null);
    const allHaveNumericId = items.every((item) => /^[0-9]+$/.test(item.id));
    if (!allHaveTime && !allHaveNumericId) {
      // 兼容没有可靠 int64 游标的旧响应；后续归一化仍会对无法跟踪的消息失败关闭。
      return items.reverse().map((item) => item.message);
    }
    items.sort((left, right) => {
      if (allHaveTime && left.at !== right.at) return left.at - right.at;
      if (allHaveNumericId) {
        const byId = compareDecimalStrings(left.id, right.id);
        if (byId !== 0) return byId;
      }
      return left.index - right.index;
    });
    return items.map((item) => item.message);
  }

  function safeHistoryDiagnosticValue(value) {
    if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(value)) {
      return 'string:' + value;
    }
    if (value === null) return 'null';
    return typeof value;
  }

  // 游标字段只回传形状，不回传标识本身。
  function cursorFieldShape(value) {
    if (value === null) return 'null';
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) ? 'safe-int' : 'unsafe-number';
    }
    if (typeof value === 'string') {
      return /^[0-9]{1,15}$/.test(value) ? 'digits' : 'string';
    }
    return typeof value;
  }

  function historyMessageShape(message) {
    if (!message || typeof message !== 'object') return 'message=' + typeof message;
    const body = message.body && typeof message.body === 'object'
      ? message.body
      : {};
    return 'type=' + safeHistoryDiagnosticValue(message.type) +
      ', body.type=' + safeHistoryDiagnosticValue(body.type) +
      ', received=' + safeHistoryDiagnosticValue(message.received) +
      ', mid=' + cursorFieldShape(message.mid) +
      ', time=' + cursorFieldShape(message.time);
  }

  function historyParticipantUid(value) {
    if (!value || typeof value !== 'object') return '';
    if (typeof BossPeerIdentity !== 'undefined' &&
        typeof BossPeerIdentity.asNumericUid === 'function') {
      return BossPeerIdentity.asNumericUid(value.uid);
    }
    if (typeof value.uid === 'number' && Number.isSafeInteger(value.uid) && value.uid > 0) {
      return String(value.uid);
    }
    return typeof value.uid === 'string' && /^[1-9][0-9]{0,19}$/.test(value.uid)
      ? value.uid
      : '';
  }

  function historyDirection(message, peerUid) {
    const fromUid = historyParticipantUid(message && message.from);
    const toUid = historyParticipantUid(message && message.to);
    if (!peerUid || !fromUid || !toUid || fromUid === toUid) return '';
    if (fromUid === peerUid && toUid !== peerUid) return 'incoming';
    if (toUid === peerUid && fromUid !== peerUid) return 'outgoing';
    return '';
  }

  async function readHistoryMessages(conversationId, peerUid) {
    if (typeof conversationId !== 'string' ||
        !BossConversationReader.ID_RE.test(conversationId)) {
      return targetFailure('当前活动会话缺少可靠的历史消息标识');
    }
    const normalizedPeerUid = typeof BossPeerIdentity !== 'undefined' &&
      typeof BossPeerIdentity.asNumericUid === 'function'
      ? BossPeerIdentity.asNumericUid(peerUid)
      : '';
    if (!normalizedPeerUid) {
      return messageOrderFailure('Boss 会话缺少可靠的对端身份，已停止读取');
    }
    let response;
    let data;
    try {
      const params = new URLSearchParams({
        bossId: conversationId,
        maxMsgId: '0',
        c: '20',
        page: '1',
        src: '0'
      });
      response = await fetch('/wapi/zpchat/geek/historyMsg?' + params.toString(), {
        cache: 'no-store',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        return messageOrderFailure('Boss 历史消息接口不可用，已停止读取');
      }
      data = await response.json();
    } catch (_) {
      return messageOrderFailure('Boss 历史消息接口不可用，已停止读取');
    }
    if (!data || data.code !== 0 || !data.zpData ||
        !Array.isArray(data.zpData.messages)) {
      return messageOrderFailure('Boss 历史消息响应无法确认，已停止读取');
    }

    // 顶层 type 的口径在各公开实现之间并不一致（一处记为 3=普通/4=系统，另一处记为
    // 1=文本…5=系统），因此它只作为诊断标量，不再当作判据。实号接口里的 received
    // 可能对双方消息同时为 true，方向必须由已登记对端 uid 与 from/to 交叉确认。
    // 游标由 mid/time 决定，正文种类由 body.type 决定；无法归类的正文降级为非文本，
    // 由上层策略强制人工确认，而不是让整批读取失败关闭。
    let hasUntrackableMessage = false;
    let untrackableShape = '';
    const rawItems = orderHistoryMessages(data.zpData.messages).map((message) => {
      if (!message || typeof message !== 'object') return null;
      if (message.type === 4) return null;
      const body = message.body && typeof message.body === 'object'
        ? message.body
        : {};
      const bodyType = Number(body.type);
      if (!Number.isFinite(bodyType) || HISTORY_SYSTEM_BODY_TYPES.has(bodyType)) return null;
      const direction = historyDirection(message, normalizedPeerUid);
      if (!direction) {
        hasUntrackableMessage = true;
        if (!untrackableShape) untrackableShape = historyMessageShape(message);
        return null;
      }
      const id = safeHistoryMessageId(message.mid);
      const at = safeHistoryTime(message.time);
      if (!id && at === null) {
        hasUntrackableMessage = true;
        if (!untrackableShape) untrackableShape = historyMessageShape(message);
        return null;
      }
      const text = bodyType === 1 && typeof body.text === 'string' ? body.text : '';
      const isText = bodyType === 1 && text.trim() !== '';
      return {
        id: id,
        direction: direction,
        kind: isText ? 'text' : 'attachment',
        text: isText ? text : '',
        at: at
      };
    }).filter(Boolean);
    if (hasUntrackableMessage) {
      return messageOrderFailure(
        'Boss 历史消息缺少可靠游标（' + untrackableShape + '），已停止读取'
      );
    }
    const messages = BossConversationReader.normalizeMessages(rawItems);
    if (messages.length !== rawItems.length) {
      return messageOrderFailure('Boss 历史消息游标无法确认，已停止读取');
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
    const owned = resolveOwnedConversation();
    if (!owned.success) return null;
    const peer = await resolvePeerFromActive(owned);
    if (!peer.success) return null;
    const read = await readHistoryMessages(
      peer.conversationRef.conversationId,
      peer.conversationRef.peerUid
    );
    if (!read.success) return null;
    return {
      conversationRef: peer.conversationRef,
      peerSource: peer.peerSource,
      baselineIncomingFingerprint: lastIncomingFingerprint(read.messages),
      company: peer.matchedCompany || '',
      position: peer.matchedPosition || '',
      hrName: peer.matchedName || ''
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
    const initial = validateManagedTarget(matched.target);
    if (!initial.success) return initial;
    const peer = await resolvePeerFromActive(initial);
    if (!peer.success) return peer;
    if (!stablePeerMatchesExpected(peer, matched.target, { domMatched: true })) {
      return targetFailure('当前会话的稳定联系人身份与原目标不一致，未发送简历或招呼语');
    }
    const target = expectedFromResolvedPeerPreserving(matched.target, peer);
    if (!MessageSend.matchesExpectedConversationStrict(
      scopedConversationText(initial.scope),
      target
    )) {
      return targetFailure('当前会话的稳定身份不足以确认目标，未发送简历或招呼语');
    }
    const lockedScope = initial.scope;
    function revalidateInitialTarget() {
      const latest = validateManagedTarget(target, peer.conversationRef);
      if (!latest.success) return latest;
      if (!sameOwnedScope(lockedScope, latest.scope)) {
        return targetFailure('目标会话作用域在初次发送前发生变化');
      }
      if (!MessageSend.matchesExpectedConversationStrict(
        scopedConversationText(latest.scope),
        target
      )) {
        return targetFailure('目标会话身份在初次发送前发生变化');
      }
      return latest;
    }

    if (typeof Humanize !== 'undefined') await Humanize.humanDelay(400, 1100);
    let latest = revalidateInitialTarget();
    if (!latest.success) return latest;
    const imgOk = await sendImage(image);
    await sleep(800);
    latest = revalidateInitialTarget();
    if (!latest.success) {
      if (image && imgOk) {
        return {
          success: false,
          errorCode: 'SEND_RESULT_UNKNOWN',
          unknown: true,
          sendResultUnknown: true,
          error: '简历图片操作后目标会话发生变化，请人工核对'
        };
      }
      return latest;
    }
    if (typeof Humanize !== 'undefined') await Humanize.humanDelay(300, 900);
    latest = revalidateInitialTarget();
    if (!latest.success) {
      return image && imgOk
        ? {
          success: false,
          errorCode: 'SEND_RESULT_UNKNOWN',
          unknown: true,
          sendResultUnknown: true,
          error: '简历图片操作后目标会话发生变化，请人工核对'
        }
        : latest;
    }
    const sent = await sendManagedReply({
      allowVisible: true,
      draft: greeting,
      expected: target,
      conversationRef: peer.conversationRef,
      lockedScope: lockedScope
    });
    if (!sent.success) return sent;
    return {
      success: true,
      imageOk: imgOk,
      conversationRef: sent.conversationRef,
      peerSource: peer.peerSource,
      baselineIncomingFingerprint: sent.baselineIncomingFingerprint,
      sentFingerprint: sent.sentFingerprint,
      company: peer.matchedCompany || target.company || '',
      position: peer.matchedPosition || target.name || '',
      hrName: peer.matchedName || target.hrName || ''
    };
  }

  async function getActiveConversationRef(msg) {
    const preflight = managedPreflight();
    if (preflight) return preflight;
    const active = validateManagedTarget(msg.expected);
    if (!active.success) return active;
    const peer = await resolvePeerFromActive(active);
    if (!peer.success) return peer;
    const read = await readHistoryMessages(
      peer.conversationRef.conversationId,
      peer.conversationRef.peerUid
    );
    if (!read.success) return read;
    return {
      success: true,
      conversationRef: peer.conversationRef,
      baselineIncomingFingerprint: lastIncomingFingerprint(read.messages)
    };
  }

  // BOSS「立即沟通」成功回执已经发送首条招呼。此路径只核验目标、
  // 解析 canonical peer、读取消息基线并登记托管，绝不触碰输入框。
  async function captureContactedConversation(msg) {
    const preflight = managedPreflight();
    if (preflight) return preflight;
    const matched = await waitForExpectedConversation(msg.expected, 4500);
    if (!matched.ok) {
      return targetFailure('已联系，但当前会话无法与原岗位、公司和 HR 严格匹配');
    }
    const initial = validateManagedTarget(matched.target);
    if (!initial.success) return initial;
    const peer = await resolvePeerFromActive(initial);
    if (!peer.success) return peer;
    // DOM 已与原目标严格匹配，且 peer 由该活动会话唯一收敛；好友列表常缺岗位。
    if (!stablePeerMatchesExpected(peer, matched.target, { domMatched: true })) {
      return targetFailure('已联系，但稳定联系人身份与原目标不一致');
    }
    const target = expectedFromResolvedPeerPreserving(matched.target, peer);
    if (!MessageSend.matchesExpectedConversationStrict(
      scopedConversationText(initial.scope),
      target
    )) {
      return targetFailure('已联系，但当前会话缺少足够的目标身份依据');
    }
    const read = await readHistoryMessages(
      peer.conversationRef.conversationId,
      peer.conversationRef.peerUid
    );
    if (!read.success) return read;
    const latest = validateManagedTarget(target, peer.conversationRef);
    if (!latest.success) return latest;
    if (!sameOwnedScope(initial.scope, latest.scope) ||
        !MessageSend.matchesExpectedConversationStrict(
          scopedConversationText(latest.scope),
          target
        )) {
      return targetFailure('登记托管前当前会话已发生切换');
    }
    return {
      success: true,
      conversationRef: peer.conversationRef,
      peerSource: peer.peerSource,
      baselineIncomingFingerprint: lastIncomingFingerprint(read.messages),
      company: peer.matchedCompany || target.company || '',
      position: peer.matchedPosition || target.name || '',
      hrName: peer.matchedName || target.hrName || ''
    };
  }

  function textOf(element) {
    if (!element) return '';
    return String(element.innerText || element.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  }

  function cleanPositionText(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    // 保留薪资/城市后缀（如「跨境电商运营 9-14K 杭州」）；仅过滤明显非岗位文案
    if (/^(HR|hr|招聘者|人事|猎头)$/.test(text)) return '';
    return text.slice(0, 80);
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
      const positionSelectors = [
        '.position-name',
        '[class*="position-name"]',
        '.chat-position',
        '[class*="chat-position"]',
        '.job-name',
        'a[href*="/job_detail/"]',
        '.base-info .name',
        '.base-info [class*="position"]',
        '[class*="base-info"] [class*="position"]',
        '.chat-info [class*="job"]',
        '.chat-top [class*="position"]',
        '.conversation-title'
      ].join(', ');
      const nodes = Array.from(scope.pane.querySelectorAll(positionSelectors));
      for (let i = 0; i < nodes.length; i++) {
        if (!isVisible(nodes[i])) continue;
        const cleaned = cleanPositionText(textOf(nodes[i]));
        if (!cleaned || cleaned === company || cleaned === hrName) continue;
        // 排除明显是公司名/整段会话摘要的误匹配
        if (company && cleaned.indexOf(company) >= 0 && cleaned.length <= company.length + 4) {
          continue;
        }
        position = cleaned;
        break;
      }
    } catch (_) {}
    if (!hrName && !company && !position) {
      const fallback = textOf(scope.activeItem) || textOf(scope.link);
      company = fallback.slice(0, 80);
    }
    company = company.replace(/\s*(招聘者|HR|人事)$/, '').trim().slice(0, 80);
    if (position === company || position === hrName) position = '';
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
    const identity = extractActiveIdentity(active.scope);
    if (!identity.company && !identity.position && !identity.hrName) {
      return targetFailure('当前会话缺少可识别的岗位/公司/HR 信息，无法登记托管');
    }
    const peer = await resolvePeerFromActive(active);
    if (!peer.success) return peer;
    const read = await readHistoryMessages(
      peer.conversationRef.conversationId,
      peer.conversationRef.peerUid
    );
    if (!read.success) return read;
    return {
      success: true,
      conversationRef: peer.conversationRef,
      peerSource: peer.peerSource || 'encryptUid',
      baselineIncomingFingerprint: lastIncomingFingerprint(read.messages),
      company: peer.matchedCompany || identity.company || '',
      position: peer.matchedPosition || identity.position || '',
      hrName: peer.matchedName || identity.hrName || ''
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

  function managedIdentityNeedles(expected) {
    const source = expected && typeof expected === 'object' ? expected : {};
    const placeholders = new Set(['未知', '未知公司', '未知岗位']);
    return [source.company, source.hrName, source.name, source.position]
      .map((value) => typeof value === 'string'
        ? value.replace(/\s+/g, '').trim()
        : '')
      .filter((value, index, values) =>
        value &&
        !placeholders.has(value) &&
        values.indexOf(value) === index
      );
  }

  function uniqueManagedConversationCandidate(expected) {
    const selector = SELECTORS.chat.userList;
    const needles = managedIdentityNeedles(expected);
    if (!selector || !needles.length) return null;
    let items;
    try {
      items = preferInnermostNodes(
        Array.from(document.querySelectorAll(selector)).filter(isVisible)
      );
    } catch (_) {
      return null;
    }
    const requiredMatches = Math.min(2, needles.length);
    const scored = items.map((item) => {
      const text = String(item.innerText || item.textContent || '')
        .replace(/\s+/g, '');
      return {
        item: item,
        score: needles.filter((needle) => text.indexOf(needle) >= 0).length
      };
    }).filter((candidate) => candidate.score >= requiredMatches)
      .sort((left, right) => right.score - left.score);
    if (!scored.length ||
        (scored.length > 1 && scored[0].score === scored[1].score)) {
      return null;
    }
    return scored[0].item;
  }

  // Boss 实号页面不会可靠地通过 ?uid= 直接激活会话；需要在会话列表中点击，
  // 然后再用 canonical peerId/alias 和 scoped identity 证明打开的是登记目标。
  async function activateManagedConversation(expected, conversationRef, options) {
    let active = validateManagedTarget(expected, conversationRef);
    if (active.success) return active;
    const maxAttempts = options &&
      Number.isSafeInteger(options.maxAttempts) &&
      options.maxAttempts >= 1 &&
      options.maxAttempts <= 60
      ? options.maxAttempts
      : 24;

    await waitVisible([SELECTORS.chat.userList], 8000);
    const candidate = uniqueManagedConversationCandidate(expected);
    if (!candidate) return active;
    if (!await safeClick(candidate)) {
      return targetFailure('无法激活唯一匹配的登记会话');
    }

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const preflight = options && options.allowVisible === true
        ? managedPreflight()
        : managedBackgroundPreflight();
      if (preflight) return preflight;
      active = validateManagedTarget(expected, conversationRef);
      if (active.success) return active;
      await sleep(350);
    }
    return active;
  }

  async function openManagedConversation(msg) {
    const preflight = managedPreflight();
    if (preflight) return preflight;
    const metadata = await resolveStoredConversationMetadata(msg.conversationRef);
    const peer = metadata.success
      ? metadata
      : await ensureStoredPeerUid(msg.conversationRef);
    if (!peer.success) return peer;
    const expected = metadata.success
      ? expectedFromResolvedPeer(msg.expected, metadata)
      : msg.expected;
    const active = await activateManagedConversation(
      expected,
      peer.conversationRef,
      { allowVisible: true, maxAttempts: 60 }
    );
    if (!active.success) return active;
    return {
      success: true,
      conversationRef: active.conversationRef,
      peerSource: metadata.success ? metadata.peerSource : '',
      company: metadata.success ? metadata.matchedCompany : '',
      position: metadata.success ? metadata.matchedPosition : '',
      hrName: metadata.success ? metadata.matchedName : ''
    };
  }

  function verifyStoredConversationRef(conversationRef) {
    const wanted = sanitizedExpectedRef(conversationRef);
    if (!wanted) {
      return targetFailure('登记会话缺少可靠的稳定标识');
    }
    return {
      success: true,
      conversationRef: wanted
    };
  }

  async function ensureStoredPeerUid(conversationRef) {
    const wanted = sanitizedExpectedRef(conversationRef);
    if (!wanted) return targetFailure('登记会话缺少可靠的稳定标识');
    if (wanted.peerUid) return { success: true, conversationRef: wanted };
    const list = await fetchGeekFriendList();
    if (!list.ok || typeof BossPeerIdentity.resolvePeerByCanonicalId !== 'function') {
      return {
        success: false,
        errorCode: 'CONVERSATION_UNAVAILABLE',
        error: '无法补全 Boss 会话对端身份'
      };
    }
    const resolved = BossPeerIdentity.resolvePeerByCanonicalId({
      peerId: wanted.conversationId,
      friends: list.friends,
      origin: location.origin || 'https://www.zhipin.com'
    });
    if (!resolved.ok) {
      return {
        success: false,
        errorCode: 'TARGET_UNCERTAIN',
        targetUncertain: true,
        error: '无法补全 Boss 会话对端身份'
      };
    }
    return {
      success: true,
      conversationRef: {
        conversationId: wanted.conversationId,
        url: wanted.url,
        aliases: BossPeerIdentity.normalizeAliases(
          (wanted.aliases || []).concat(resolved.aliases || []),
          wanted.conversationId
        ),
        peerUid: resolved.peerUid
      }
    };
  }

  async function resolveStoredConversationMetadata(conversationRef) {
    const wanted = sanitizedExpectedRef(conversationRef);
    if (!wanted) return targetFailure('登记会话缺少可靠的稳定标识');
    const list = await fetchGeekFriendList();
    if (!list.ok || typeof BossPeerIdentity.resolvePeerByCanonicalId !== 'function') {
      return {
        success: false,
        errorCode: 'CONVERSATION_UNAVAILABLE',
        error: '无法读取 Boss 好友列表以修复登记身份'
      };
    }
    const resolved = BossPeerIdentity.resolvePeerByCanonicalId({
      peerId: wanted.conversationId,
      friends: list.friends,
      origin: location.origin || 'https://www.zhipin.com'
    });
    if (!resolved.ok) {
      return {
        success: false,
        errorCode: 'TARGET_UNCERTAIN',
        targetUncertain: true,
        error: '无法从 Boss 好友列表确认登记身份'
      };
    }
    return {
      success: true,
      conversationRef: {
        conversationId: wanted.conversationId,
        url: wanted.url,
        aliases: BossPeerIdentity.normalizeAliases(
          (wanted.aliases || []).concat(resolved.aliases || []),
          wanted.conversationId
        ),
        peerUid: resolved.peerUid
      },
      peerSource: resolved.peerSource,
      matchedName: resolved.matchedName || '',
      matchedCompany: resolved.matchedCompany || '',
      matchedPosition: resolved.matchedPosition || ''
    };
  }

  function expectedFromResolvedPeer(expected, resolved) {
    const source = expected && typeof expected === 'object' ? expected : {};
    return {
      id: source.id,
      company: resolved.matchedCompany || source.company || '',
      name: resolved.matchedPosition || source.name || source.position || '',
      hrName: resolved.matchedName || source.hrName || ''
    };
  }

  // 初次外发不能用“当前活动会话”的元数据覆盖原始目标；只有在已用
  // canonical conversationRef 管理的后续托管路径中，才允许修复陈旧展示字段。
  function expectedFromResolvedPeerPreserving(expected, resolved) {
    const source = expected && typeof expected === 'object' ? expected : {};
    return {
      id: source.id,
      company: source.company || resolved.matchedCompany || '',
      name: source.name || source.position || resolved.matchedPosition || '',
      hrName: source.hrName || resolved.matchedName || ''
    };
  }

  async function readActiveConversation(msg) {
    // 只读检查不点击列表、不切换会话、不写入任何页面状态，因此不要求独占后台标签；
    // `document.visibilityState` 是否可见与读取结果无关。独占与接管检测只属于发送路径。
    const preflight = managedPreflight();
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
    // canonical peerId 已在用户登记时通过好友列表建立并由 store 严格保存。
    // 周期只读直接使用该稳定引用；重复依赖易漂移的好友列表会让历史接口
    // 仍可用的已登记会话被整批误暂停。页面/身份激活仍只属于发送路径。
    const peer = await ensureStoredPeerUid(msg.conversationRef);
    if (!peer.success) return peer;
    const read = await readHistoryMessages(
      peer.conversationRef.conversationId,
      peer.conversationRef.peerUid
    );
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
      conversationRef: peer.conversationRef,
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
    const controlPane = scope && scope.controlPane;
    if (!controlPane) {
      return selectorFailure('未找到与目标消息容器同属会话的托管输入区');
    }
    try {
      inputs = Array.from(controlPane.querySelectorAll(inputSelector)).filter(isVisible);
      buttons = Array.from(controlPane.querySelectorAll(sendSelector)).filter(isVisible);
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
      left.pane === right.pane &&
      left.controlPane === right.controlPane;
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
    const allowVisible = msg && msg.allowVisible === true;
    const preflight = allowVisible ? managedPreflight() : managedBackgroundPreflight();
    if (preflight) return preflight;
    const metadata = await resolveStoredConversationMetadata(msg.conversationRef);
    const peer = metadata.success
      ? metadata
      : await ensureStoredPeerUid(msg.conversationRef);
    if (!peer.success) return peer;
    const expected = metadata.success
      ? expectedFromResolvedPeer(msg.expected, metadata)
      : msg.expected;
    const lockedScope = msg && msg.lockedScope;
    const active = lockedScope
      ? validateManagedTarget(expected, peer.conversationRef)
      : await activateManagedConversation(
        expected,
        peer.conversationRef,
        { allowVisible: allowVisible }
      );
    if (!active.success) return active;
    if (lockedScope && !sameOwnedScope(lockedScope, active.scope)) {
      return targetFailure('目标会话作用域在初次发送前发生变化');
    }
    if (lockedScope && !MessageSend.matchesExpectedConversationStrict(
      scopedConversationText(active.scope),
      expected
    )) {
      return targetFailure('目标会话身份在初次发送前发生变化');
    }

    const draft = typeof msg.draft === 'string' ? msg.draft.trim() : '';
    if (!draft || Array.from(draft).length > 300) {
      return { success: false, errorCode: 'DRAFT_INVALID', error: '托管回复草稿无效' };
    }
    const beforeRead = await readHistoryMessages(
      active.conversationRef.conversationId,
      active.conversationRef.peerUid
    );
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
      const ownership = allowVisible ? managedPreflight() : managedBackgroundPreflight();
      if (ownership) {
        preActionFailure = ownership;
        return null;
      }
      const latest = validateManagedTarget(msg.expected, peer.conversationRef);
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

    let postTarget = null;
    let read = null;
    let evidence = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      postTarget = validateManagedTarget(msg.expected, peer.conversationRef);
      if (!postTarget.success || !sameOwnedScope(active.scope, postTarget.scope)) {
        return unknownSendFailure();
      }
      read = await readHistoryMessages(
        postTarget.conversationRef.conversationId,
        postTarget.conversationRef.peerUid
      );
      if (!read.success) return unknownSendFailure();
      evidence = read.messages.filter((message) =>
        message.direction === 'outgoing' &&
        message.kind === 'text' &&
        message.text === draft &&
        !beforeOutgoing.has(message.fingerprint)
      );
      if (evidence.length === 1 && evidence[0].fingerprint) break;
      if (evidence.length > 1) return unknownSendFailure();
      if (attempt < 5) await sleep(400);
    }
    if (evidence.length !== 1 || !evidence[0].fingerprint) return unknownSendFailure();
    const finalTarget = validateManagedTarget(msg.expected, peer.conversationRef);
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

  async function verifyManagedSend(msg) {
    const preflight = managedPreflight();
    if (preflight) return preflight;
    const draft = typeof msg.draft === 'string' ? msg.draft.trim() : '';
    const createdAt = Number(msg.createdAt);
    if (!draft ||
      Array.from(draft).length > 300 ||
      !Number.isSafeInteger(createdAt) ||
      createdAt <= 0) {
      return unknownSendFailure();
    }
    const metadata = await resolveStoredConversationMetadata(msg.conversationRef);
    const peer = metadata.success
      ? metadata
      : await ensureStoredPeerUid(msg.conversationRef);
    if (!peer.success) return peer;
    const conversationRef = metadata.success
      ? metadata.conversationRef
      : peer.conversationRef;
    const read = await readHistoryMessages(
      conversationRef.conversationId,
      conversationRef.peerUid
    );
    if (!read.success) return unknownSendFailure();
    const candidates = read.messages.filter((message) =>
      message.direction === 'outgoing' &&
      message.kind === 'text' &&
      message.text === draft &&
      Number.isSafeInteger(message.at) &&
      message.at >= createdAt - 5000
    );
    if (candidates.length !== 1 || !candidates[0].fingerprint) {
      return unknownSendFailure();
    }
    const observedAt = Date.now();
    if (!Number.isFinite(observedAt) || observedAt <= 0) return unknownSendFailure();
    return {
      success: true,
      targetConversationId: conversationRef.conversationId,
      sentFingerprint: candidates[0].fingerprint,
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
      getActiveConversationRef(msg).then((r) => sendResponse(r)).catch(() => sendResponse({
        success: false,
        errorCode: 'MESSAGE_ORDER_UNCERTAIN',
        messageOrderUncertain: true,
        error: 'Boss 历史消息读取失败'
      }));
      return true;
    }
    if (msg.type === 'CAPTURE_CONTACTED_CONVERSATION') {
      captureContactedConversation(msg).then((r) => sendResponse(r)).catch(() => sendResponse({
        success: false,
        errorCode: 'TARGET_UNCERTAIN',
        targetUncertain: true,
        error: '已联系，但登记目标会话失败'
      }));
      return true;
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
      readActiveConversation(msg).then((r) => sendResponse(r)).catch(() => sendResponse({
        success: false,
        errorCode: 'MESSAGE_ORDER_UNCERTAIN',
        messageOrderUncertain: true,
        error: 'Boss 历史消息读取失败'
      }));
      return true;
    }
    if (msg.type === 'OPEN_MANAGED_CONVERSATION') {
      openManagedConversation(msg).then((r) => sendResponse(r)).catch(() => sendResponse({
        success: false,
        errorCode: 'TARGET_UNCERTAIN',
        targetUncertain: true,
        error: '无法确认已打开登记会话'
      }));
      return true;
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
    if (msg.type === 'VERIFY_MANAGED_SEND') {
      verifyManagedSend(msg).then(r => sendResponse(r)).catch(() => sendResponse({
        success: false,
        errorCode: 'SEND_RESULT_UNKNOWN',
        sendResultUnknown: true,
        error: '托管回复发送结果仍无法确认'
      }));
      return true;
    }
  });
})();
