// ===== 智联聊天页：发送招呼语（网页 IM 可用时）=====
(function () {
  if (window.__zhilianContactChat) return;
  window.__zhilianContactChat = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function detectBlock() {
    const body = (document.body && document.body.innerText) || '';
    const hints = ['验证码', '滑动验证', '人机验证', '今日沟通已达上限', '操作过于频繁'];
    for (let i = 0; i < hints.length; i++) {
      if (body.indexOf(hints[i]) >= 0) return { blocked: true, reason: '检测到：' + hints[i] };
    }
    return null;
  }

  function detectLoginIssue() {
    const href = location.href || '';
    if (/passport\.zhaopin|\/login/i.test(href)) {
      return { needLogin: true, error: '聊天页跳到登录，请重新登录智联' };
    }
    return null;
  }

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

  const INPUT_SELS = [
    SELECTORS.chat.chatInput,
    '[contenteditable="true"]',
    'textarea[placeholder*="输入"]',
    'textarea',
    'div.chat-input'
  ];
  const SEND_SELS = [SELECTORS.chat.btnSend, 'button[class*="send"]', '.btn-send'];

  function dumpInputs() {
    const out = [];
    document.querySelectorAll('[contenteditable="true"], textarea, div[id*="input"], div[class*="input"]').forEach((el, i) => {
      if (i < 8) {
        out.push(el.tagName + '#' + (el.id || '') + '.' + (typeof el.className === 'string' ? el.className.slice(0, 40) : ''));
      }
    });
    return out.join(' | ') || '无可编辑元素';
  }

  function inputText(el) {
    return (el.isContentEditable || el.getAttribute('contenteditable') === 'true')
      ? (el.textContent || '')
      : (el.value || '');
  }

  function pressEnter(el) {
    const opt = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent('keydown', opt));
    el.dispatchEvent(new KeyboardEvent('keypress', opt));
    el.dispatchEvent(new KeyboardEvent('keyup', opt));
  }

  function activeConversationText() {
    const selectors = (SELECTORS.chat.activeContext || '').split(',').map((s) => s.trim()).filter(Boolean);
    const parts = [];
    const activeUser = SELECTORS.chat.activeUser && document.querySelector(SELECTORS.chat.activeUser);
    if (activeUser && activeUser.offsetParent !== null) {
      parts.push((activeUser.innerText || activeUser.textContent || '').trim());
    }
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        if (el && el.offsetParent !== null) parts.push((el.innerText || el.textContent || '').trim());
      });
    });
    return parts.filter(Boolean).join(' | ').slice(0, 1200);
  }

  async function sendText(greeting, expected) {
    const input = await waitVisible(INPUT_SELS, 8000);
    if (!input) return { ok: false, selectorUnavailable: true, err: '未找到输入框｜页面候选：' + dumpInputs() };
    if (!MessageSend.matchesExpectedConversation(activeConversationText(), expected || {})) {
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
        if (!btn || btn.disabled) return false;
        btn.click();
        return true;
      },
      wait: sleep,
      attempts: 12
    });
    return sent.ok ? { ok: true, via: sent.via } : { ok: false, err: sent.error };
  }

  async function sendActive(image, greeting, expected) {
    const login = detectLoginIssue();
    if (login) return login;
    const blocked = detectBlock();
    if (blocked) return blocked;
    if (typeof Humanize !== 'undefined') await Humanize.humanDelay(400, 1100);
    const tr = await sendText(greeting || '', expected);
    if (!tr.ok) {
      return {
        success: false,
        error: tr.err,
        targetUncertain: !!tr.targetUncertain,
        selectorUnavailable: !!tr.selectorUnavailable
      };
    }
    return { success: true, imageOk: false };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ ok: true, page: 'chat', platform: 'zhilian' });
      return;
    }
    if (msg.type === 'SEND_ACTIVE' || msg.type === 'SEND') {
      sendActive(msg.image, msg.greeting, msg.expected).then((r) => sendResponse(r)).catch((e) => sendResponse({ success: false, error: e.message }));
      return true;
    }
  });
})();
