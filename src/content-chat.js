// ===== 聊天页 content script：打开会话 + 先发图片 + 再发招呼语 =====
(function () {
  if (window.__bossContactChat) return;
  window.__bossContactChat = true;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
      try { hit.click(); } catch (e) {}
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
    if (!items.length) return { ok: false, err: '会话列表为空' };
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
    if (!target) target = items[0]; // 兜底：最新一条（刚建联的通常在顶部）
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

  async function sendText(greeting) {
    const input = await waitVisible(INPUT_SELS, 8000);
    if (!input) return { ok: false, err: '未找到输入框｜页面候选：' + dumpInputs() };
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

    const before = document.querySelectorAll(SELECTORS.chat.messageSent).length;
    // 以回车为主发送
    pressEnter(input);
    // 兜底：若有发送按钮也点一下
    const btn = findVisible(SEND_SELS);
    if (btn && !btn.classList.contains('disabled') && !btn.disabled) btn.click();

    // 验证：输入框被清空 或 新增自己消息气泡 => 成功
    for (let i = 0; i < 12; i++) {
      await sleep(300);
      const cleared = !inputText(input).trim();
      const after = document.querySelectorAll(SELECTORS.chat.messageSent).length;
      if (cleared || after > before) return { ok: true };
    }
    return { ok: false, err: '发送未确认（输入框未清空、未见新气泡）' };
  }

  async function doSend(msg) {
    const oc = await openConversation(msg.company, msg.hrName, msg.position);
    if (!oc.ok) return { success: false, error: oc.err };
    const imgOk = await sendImage(msg.image);
    await sleep(800);
    const tr = await sendText(msg.greeting);
    if (!tr.ok) return { success: false, error: tr.err };
    return { success: true, imageOk: imgOk };
  }

  // 发给当前已打开的会话（点继续沟通后跳进来的就是目标岗位，无需匹配）
  async function sendActive(image, greeting) {
    const login = detectLoginIssue();
    if (login) return login;
    const dlg = await dismissCommonDialogs();
    if (dlg) return dlg;
    const blocked = detectBlock();
    if (blocked) return blocked;
    let input = await waitVisible(INPUT_SELS, 6000);
    if (!input) {
      const items = document.querySelectorAll(SELECTORS.chat.userList);
      if (items[0]) { items[0].click(); await sleep(1500); }
      input = await waitVisible(INPUT_SELS, 6000);
    }
    if (!input) return { success: false, error: '未找到输入框｜' + dumpInputs() };
    if (typeof Humanize !== 'undefined') await Humanize.humanDelay(400, 1100);
    const imgOk = await sendImage(image);
    await sleep(800);
    if (typeof Humanize !== 'undefined') await Humanize.humanDelay(300, 900);
    const tr = await sendText(greeting);
    if (!tr.ok) return { success: false, error: tr.err };
    return { success: true, imageOk: imgOk };
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
      sendActive(msg.image, msg.greeting).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
  });
})();
