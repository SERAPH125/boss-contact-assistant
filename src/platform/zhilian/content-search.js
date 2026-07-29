// ===== 智联搜索页：扫描 + 单岗投递（禁止误点批量）=====
(function () {
  if (window.__zhilianContactSearch) return;
  window.__zhilianContactSearch = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const BATCH_DIALOG_RE = /一并投递|批量投递|一键投递|同时投递|推荐职位|相似职位|以下职位|为您推荐|选中.*职位|共\s*\d+\s*个/;

  function pageText() {
    return (document.body && document.body.innerText) || '';
  }

  function detectBlock() {
    const body = pageText();
    const hints = [
      '验证码', '滑动验证', '人机验证', '请完成验证',
      '今日投递已达上限', '投递次数已达上限', '沟通次数已达上限',
      '操作过于频繁', '账号存在异常', '请稍后再试'
    ];
    for (let i = 0; i < hints.length; i++) {
      if (body.indexOf(hints[i]) >= 0) return { blocked: true, reason: '检测到：' + hints[i] };
    }
    return null;
  }

  function detectLoginIssue() {
    const href = location.href || '';
    if (/passport\.zhaopin|\/login|i\.zhaopin\.com\/login/i.test(href)) {
      return { needLogin: true, error: '当前在登录页，请先登录智联求职者账号' };
    }
    const cards = document.querySelectorAll(SELECTORS.jobs.jobCard);
    const unloginCards = document.querySelectorAll('.joblist-box__item-unlogin');
    if (cards.length > 0 && unloginCards.length === cards.length) {
      return { needLogin: true, error: '未检测到智联登录态（列表为未登录样式）。请先登录 zhaopin.com 再扫描' };
    }
    const loginBtn = Array.from(document.querySelectorAll('a, button')).find((el) => {
      const tx = (el.textContent || '').trim();
      return (tx === '登录/注册' || tx === '登录') && el.offsetParent !== null;
    });
    const hasUser = !!document.querySelector(
      '.zp-header__user, [class*="user-avatar"], [class*="header-user"], a[href*="i.zhaopin.com"], a[href*="/resume"]'
    );
    if (loginBtn && !hasUser && cards.length === 0) {
      return { needLogin: true, error: '未检测到登录态，请先在浏览器登录智联招聘' };
    }
    return null;
  }

  function isInsideJobCard(el) {
    return !!(el && el.closest && el.closest(SELECTORS.jobs.jobCard));
  }

  function dialogRoots() {
    return Array.from(document.querySelectorAll(
      '[role="dialog"], .dialog, .modal, .ant-modal, .a-modal, [class*="dialog"], [class*="modal"], [class*="popup"], [class*="Popup"], [class*="Drawer"]'
    )).filter((el) => el && el.offsetParent !== null);
  }

  function visibleText(el) {
    return ((el && el.innerText) || '').replace(/\s+/g, ' ').trim();
  }

  function btnLabel(el) {
    return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  function findBtnIn(root, labels) {
    const els = (root || document).querySelectorAll('a, button, span, div[role="button"]');
    for (const el of els) {
      if (!el || el.offsetParent === null) continue;
      if (root !== document && isInsideJobCard(el)) continue;
      const tx = btnLabel(el);
      if (labels.indexOf(tx) >= 0) return el;
    }
    return null;
  }

  /** 关闭/取消「一并投递」类弹窗；普通提示只点知道了。绝不点确定投递。 */
  async function dismissOrCancelDialogs() {
    const blocked = detectBlock();
    if (blocked) return { blocked: blocked, clicked: [], cancelledBatch: false };

    const clicked = [];
    let cancelledBatch = false;

    for (let round = 0; round < 4; round++) {
      const roots = dialogRoots();
      let hit = null;
      let isBatch = false;

      for (const root of roots) {
        const t = visibleText(root);
        if (!t || t.length < 2) continue;
        if (BATCH_DIALOG_RE.test(t)) {
          isBatch = true;
          hit = findBtnIn(root, ['取消', '关闭', '否', '不了', '暂不', '仅投递当前', '只投递当前', '跳过'])
            || root.querySelector('.close, .icon-close, [class*="close"], .a-modal-close');
          if (hit) break;
        }
      }

      if (!hit) {
        for (const root of roots) {
          const t = visibleText(root);
          if (BATCH_DIALOG_RE.test(t)) continue;
          // 仅关闭纯提示，不点「确定/确认投递」
          hit = findBtnIn(root, ['我知道了', '知道了']);
          if (hit) break;
          const closer = root.querySelector('.close, .icon-close, [class*="close"], .a-modal-close');
          if (closer && closer.offsetParent !== null) { hit = closer; break; }
        }
      }

      if (!hit) break;
      try { hit.click(); clicked.push(btnLabel(hit) || 'close'); } catch (e) {}
      if (isBatch) cancelledBatch = true;
      await sleep(450);
      const b2 = detectBlock();
      if (b2) return { blocked: b2, clicked: clicked, cancelledBatch: cancelledBatch };
    }
    return { blocked: null, clicked: clicked, cancelledBatch: cancelledBatch };
  }

  function getCards() {
    return Array.from(document.querySelectorAll(SELECTORS.jobs.jobCard));
  }

  function cardIsApplied(card) {
    if (!card) return false;
    const tx = visibleText(card);
    if (!/已投递/.test(tx)) return false;
    // 按钮态更准
    const btns = card.querySelectorAll('button, a, span');
    for (const el of btns) {
      const t = btnLabel(el);
      if (t === '已投递' || t.indexOf('已投递') === 0) return true;
    }
    return /已投递/.test(tx);
  }

  function appliedSnapshot() {
    const ids = [];
    getCards().forEach((c) => {
      if (!cardIsApplied(c)) return;
      const j = parseCard(c);
      if (j.id) ids.push(j.id);
    });
    return ids;
  }

  function parseCard(card) {
    const nameEl = card.querySelector(SELECTORS.jobs.jobName);
    const salEl = card.querySelector(SELECTORS.jobs.jobSalary);
    const linkEl = nameEl && nameEl.tagName === 'A' ? nameEl : card.querySelector('a[href*="jobdetail"], a[href*="/job/"]');
    const link = linkEl ? linkEl.href : '';
    const m = link.match(/jobdetail\/([^/?#.]+)/i) || link.match(/\/(CC[^/?#.]+)/i);
    const id = (m && m[1]) || ((nameEl ? nameEl.textContent.trim() : '') + '|' + (salEl ? salEl.textContent.trim() : ''));
    const tags = Array.from(card.querySelectorAll(SELECTORS.jobs.tagList))
      .map((t) => (t.textContent || '').trim())
      .filter(Boolean);
    let company = '';
    const compEl = card.querySelector(SELECTORS.jobs.company);
    if (compEl) company = (compEl.textContent || '').trim();
    let activeText = '';
    const staff = card.querySelector(SELECTORS.jobs.staff);
    const blob = ((staff && staff.innerText) || card.innerText || '').replace(/\s+/g, ' ');
    const am = blob.match(/(在线|刚刚活跃|今日活跃|今天活跃|昨日活跃|\d+日内活跃|本周活跃|近两周活跃|两周内活跃|月内活跃|近期活跃|高回复率)/);
    if (am) activeText = am[1];
    const others = Array.from(card.querySelectorAll(SELECTORS.jobs.location))
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean);
    return {
      id: id,
      name: nameEl ? nameEl.textContent.trim() : '未知岗位',
      salary: salEl ? salEl.textContent.trim().replace(/\s+/g, '') : '',
      tags: tags,
      company: company,
      link: link,
      activeText: activeText,
      location: others[0] || '',
      experience: others[1] || '',
      education: others[2] || '',
      extras: others.slice(3)
    };
  }

  async function enrichDescriptions(jobs) {
    return JobDescription.enrichJobs('zhilian', jobs, {
      concurrency: 3,
      maxChars: 6000,
      fetchHtml: async (link) => {
        const response = await fetch(link, {
          credentials: 'include',
          cache: 'no-store'
        });
        if (!response.ok) throw new Error('职位详情 HTTP ' + response.status);
        return response.text();
      }
    });
  }

  async function scrape(count, filters) {
    await dismissOrCancelDialogs();
    const login = detectLoginIssue();
    if (login) return login;

    const blocked = detectBlock();
    if (blocked) return blocked;

    const seen = {};
    const jobs = [];
    const skippedFilters = { city: 0, experience: 0, education: 0 };
    let scannedCount = 0;
    let stall = 0;
    for (let loop = 0; loop < 40 && jobs.length < count && stall < 4; loop++) {
      const cards = getCards();
      let discovered = 0;
      for (const c of cards) {
        const j = parseCard(c);
        if (!j.id || seen[j.id]) continue;
        seen[j.id] = 1;
        discovered++;
        scannedCount++;
        const filterResult = SearchFilters.matchZhilianJob(j, filters || {});
        if (!filterResult.match) {
          if (skippedFilters[filterResult.reason] !== undefined) {
            skippedFilters[filterResult.reason]++;
          }
          continue;
        }
        jobs.push(j);
        if (jobs.length >= count) break;
      }
      if (discovered === 0) stall++; else stall = 0;
      if (jobs.length >= count) break;
      if (typeof Humanize !== 'undefined') {
        const container = document.querySelector(SELECTORS.jobs.listRoot);
        await Humanize.humanScrollStep(container);
        if (loop % 3 === 2) {
          window.scrollTo(0, document.body.scrollHeight);
          await Humanize.humanDelay(700, 1400);
        }
      } else {
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(1200);
      }
      const midLogin = detectLoginIssue();
      if (midLogin && jobs.length === 0) return midLogin;
    }

    if (!jobs.length && scannedCount === 0) {
      const login2 = detectLoginIssue();
      if (login2) return login2;
      return { success: false, error: '未扫到岗位卡片。请确认已登录且在智联职位列表页（sou），或刷新后重试' };
    }
    let output = jobs.slice(0, count);
    if (filters && filters.includeDescription) {
      output = await enrichDescriptions(output);
    }
    return {
      success: true,
      jobs: output,
      skippedFilters: skippedFilters,
      scannedCount: scannedCount,
      descriptionLoaded: output.filter((job) => job.descriptionStatus === 'loaded').length,
      descriptionFailed: output.filter((job) => job.descriptionStatus === 'failed').length
    };
  }

  function findCardByJob(job) {
    const cards = getCards();
    for (const c of cards) {
      const j = parseCard(c);
      if (job.id && j.id === job.id) return c;
    }
    for (const c of cards) {
      const j = parseCard(c);
      if (j.name === job.name && (!job.company || j.company === job.company)) return c;
    }
    return null;
  }

  /**
   * 目标卡片上唯一可点的联系按钮。
   * 登录后主按钮常是「立即沟通」（点完变已投递）；未登录/部分账号是「立即投递」。
   * 只返回卡片内元素，绝不回落全页。
   */
  function findContactBtn(card) {
    if (!card) return null;
    const prefer = [
      '立即投递', '投递简历', '申请职位',
      '立即沟通', '聊一聊', '在线聊'
    ];
    const candidates = Array.from(card.querySelectorAll(
      'button.collect-and-apply__btn, .collect-and-apply__btn, .c-chat-job__title, button, a'
    ));
    for (const label of prefer) {
      for (const el of candidates) {
        if (!el || el.offsetParent === null) continue;
        if (!card.contains(el)) continue;
        const tx = btnLabel(el);
        if (tx === '已投递' || tx.indexOf('已投递') >= 0) continue;
        // 标题 span 可能带隐藏二维码文案，用 includes
        if (tx === label || tx.indexOf(label) === 0) return el;
      }
    }
    return null;
  }

  async function safeClick(el) {
    if (!el) return false;
    // 原生 click，避免坐标点到邻近卡片
    try {
      el.scrollIntoView({ block: 'center' });
    } catch (e) {}
    await sleep(280);
    try {
      el.click();
      return true;
    } catch (e) {
      if (typeof Humanize !== 'undefined') return Humanize.humanClick(el);
      return false;
    }
  }

  async function openJD(job) {
    const login = detectLoginIssue();
    if (login) return login;
    await dismissOrCancelDialogs();
    const blocked = detectBlock();
    if (blocked) return blocked;

    if (job && job.descriptionStatus === 'loaded' && job.description) {
      return { success: true, jd: job.description.slice(0, 1800) };
    }
    const enriched = await enrichDescriptions([job]);
    const detail = enriched[0];
    if (!detail || detail.descriptionStatus !== 'loaded') {
      return {
        success: false,
        error: (detail && detail.descriptionError) || '职位描述读取失败'
      };
    }
    return { success: true, jd: detail.description.slice(0, 1800) };
  }

  function newAppliedIds(beforeIds, afterIds) {
    const set = {};
    beforeIds.forEach((id) => { set[id] = 1; });
    return afterIds.filter((id) => !set[id]);
  }

  async function goChat(job) {
    const login = detectLoginIssue();
    if (login) return login;
    // 先取消可能残留的批量弹窗，绝不自动点「确定」
    const pre = await dismissOrCancelDialogs();
    if (pre.blocked) return pre.blocked;
    const blocked0 = detectBlock();
    if (blocked0) return blocked0;

    const card = findCardByJob(job);
    if (!card) {
      return {
        success: false,
        staleReview: true,
        error: '未找到岗位卡片，请回到智联列表页后重试'
      };
    }
    if (cardIsApplied(card)) {
      return { success: true, skipChat: true, applied: true, mode: 'already' };
    }

    const btn = findContactBtn(card);
    if (!btn) {
      return {
        success: false,
        selectorUnavailable: true,
        error: '目标卡片上未找到「立即投递/立即沟通」按钮'
      };
    }
    if (!card.contains(btn)) {
      return {
        success: false,
        targetUncertain: true,
        externalActionPossible: false,
        error: '联系按钮不在目标卡片内，已中止（防误投）'
      };
    }

    const beforeIds = appliedSnapshot();
    card.scrollIntoView({ block: 'center' });
    await sleep(350);
    await safeClick(btn);
    await sleep(1000);

    // 出现「一并投递」→ 取消；普通提示 → 知道了。绝不点确定批量投递
    const dlg = await dismissOrCancelDialogs();
    if (dlg.blocked) return dlg.blocked;
    await sleep(700);
    // 再扫一次，防止晚出来的批量弹窗
    const dlg2 = await dismissOrCancelDialogs();
    if (dlg2.blocked) return dlg2.blocked;

    const failHints = ['请选择简历', '请先完善', '未设置默认简历', '请上传简历'];
    const body = pageText();
    for (let i = 0; i < failHints.length; i++) {
      if (body.indexOf(failHints[i]) >= 0) {
        return { success: false, error: '投递受阻：' + failHints[i] + '（请在智联设置默认简历后重试）' };
      }
    }

    // 若点沟通后进入网页聊
    const href = location.href || '';
    if (/im\.|\/message|\/chat|xiaoxi/i.test(href)) {
      return { success: true, navigated: true };
    }
    const input = document.querySelector(SELECTORS.chat.chatInput);
    if (input && input.offsetParent !== null && !cardIsApplied(card)) {
      return { success: true, navigated: false, inPageChat: true };
    }

    const afterIds = appliedSnapshot();
    const neu = newAppliedIds(beforeIds, afterIds);
    const targetId = (parseCard(card).id || job.id || '');

    if (neu.length > 1) {
      // 仍发生多投：立即再取消弹窗，并报错停机
      await dismissOrCancelDialogs();
      return {
        success: false,
        blocked: true,
        reason: '一次操作导致 ' + neu.length + ' 个岗位变为已投递（疑似智联「一并投递」）。已尝试取消弹窗，请到智联核对并手动处理。',
        error: '防误投：检测到一次联系投了 ' + neu.length + ' 岗'
      };
    }

    if (neu.length === 1 && targetId && neu[0] !== targetId) {
      await dismissOrCancelDialogs();
      return {
        success: false,
        blocked: true,
        targetUncertain: true,
        externalActionPossible: true,
        code: 'TARGET_UNCERTAIN',
        reason: '投递落在非目标岗位上，已停机。请刷新列表后重试。',
        error: '防误投：投递目标不匹配'
      };
    }

    const ok = cardIsApplied(card) || (neu.length === 1 && neu[0] === targetId);
    if (!ok) {
      // 沟通可能只开了聊天未改按钮；若取消了批量且目标未变，视为需人工
      if (dlg.cancelledBatch || dlg2.cancelledBatch) {
        return {
          success: false,
          sendResultUnknown: true,
          error: '已取消智联「一并/推荐投递」弹窗；目标岗未确认投递成功，请手动点一次该岗后重试'
        };
      }
      return {
        success: false,
        sendResultUnknown: true,
        error: '未确认投递成功（目标卡片未变为已投递）'
      };
    }

    return {
      success: true,
      skipChat: true,
      applied: true,
      mode: 'single',
      appliedCount: neu.length || 1,
      cancelledBatch: !!(dlg.cancelledBatch || dlg2.cancelledBatch)
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ ok: true, page: 'search', platform: 'zhilian' });
      return;
    }
    if (msg.type === 'CHECK_LOGIN') {
      const login = detectLoginIssue();
      sendResponse(login || { ok: true });
      return;
    }
    if (msg.type === 'SCRAPE') {
      scrape(msg.count || 20, {
        city: msg.city || '',
        experience: msg.experience || '',
        education: msg.education || '',
        includeDescription: msg.includeDescription === true
      }).then((r) => {
        if (r.needLogin) sendResponse({ success: false, needLogin: true, error: r.error });
        else if (r.blocked) sendResponse({ success: false, blocked: true, reason: r.reason, error: r.reason });
        else if (r.success === false) sendResponse(r);
        else if (r.jobs) sendResponse({
          success: true,
          jobs: r.jobs,
          skippedFilters: r.skippedFilters,
          scannedCount: r.scannedCount,
          descriptionLoaded: r.descriptionLoaded || 0,
          descriptionFailed: r.descriptionFailed || 0
        });
        else sendResponse({ success: false, error: '未知扫描结果' });
      }).catch((e) => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (msg.type === 'OPEN_JD') {
      openJD(msg.job).then((r) => {
        try { sendResponse(r); } catch (e) {}
      }).catch((e) => {
        try { sendResponse({ success: false, error: e.message }); } catch (e2) {}
      });
      return true;
    }
    if (msg.type === 'GO_CHAT' || msg.type === 'INITIATE' || msg.type === 'CREATE_CONV') {
      goChat(msg.job).then((r) => {
        try { sendResponse(r); } catch (e) {}
      }).catch((e) => {
        try { sendResponse({ success: false, error: e.message }); } catch (e2) {}
      });
      return true;
    }
  });
})();
