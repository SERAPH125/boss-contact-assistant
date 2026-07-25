// ===== 搜索页 content script：扫描岗位 + 发起沟通（立即沟通→继续沟通）=====
(function () {
  if (window.__bossContactSearch) return;
  window.__bossContactSearch = true;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function pageText() {
    return (document.body && document.body.innerText) || '';
  }

  function detectBlock() {
    const body = pageText();
    const hints = [
      '验证码', '滑动验证', '人机验证', '请完成验证',
      '今日沟通已达上限', '沟通次数已达上限', '操作过于频繁', '账号存在异常'
    ];
    for (let i = 0; i < hints.length; i++) {
      if (body.indexOf(hints[i]) >= 0) return { blocked: true, reason: '检测到：' + hints[i] };
    }
    return null;
  }

  /** 检测未登录 / 登录失效 */
  function detectLoginIssue() {
    const href = location.href || '';
    if (/\/web\/user\/|\/login|passport\.zhipin\.com/i.test(href)) {
      return { needLogin: true, error: '当前在登录页，请先登录 Boss 直聘求职者账号' };
    }
    const body = pageText();
    const loginHints = ['扫码登录', '短信登录', '密码登录', '请登录后查看', '登录后才能', '登录BOSS直聘'];
    for (let i = 0; i < loginHints.length; i++) {
      if (body.indexOf(loginHints[i]) >= 0) {
        // 已登录页顶栏也可能出现「登录」字样以外的导航；再结合卡片/头像判断
        const hasCards = document.querySelectorAll(SELECTORS.jobs.jobCard).length > 0;
        const hasGeekNav = !!document.querySelector('.nav-figure, .user-nav, .header-login-btn.is-login, [class*="user-avatar"], .label-text-top');
        if (!hasCards && !hasGeekNav) {
          return { needLogin: true, error: '页面提示需要登录：' + loginHints[i] };
        }
      }
    }
    // 明显未登录按钮（可见「登录/注册」且无职位卡片）
    const loginBtn = Array.from(document.querySelectorAll('a, button')).find((el) => {
      const tx = (el.textContent || '').trim();
      return (tx === '登录' || tx === '登录/注册' || tx === '立即登录') && el.offsetParent !== null;
    });
    const cards = document.querySelectorAll(SELECTORS.jobs.jobCard);
    if (loginBtn && cards.length === 0) {
      return { needLogin: true, error: '未检测到登录态，请先在浏览器登录 Boss 直聘' };
    }
    return null;
  }

  /**
   * 处理常见平台弹窗（可点的确认类）；验证码/上限类不点，交给 detectBlock。
   * 返回处理过的按钮文案列表。
   */
  async function dismissCommonDialogs() {
    const blocked = detectBlock();
    if (blocked) return { blocked: blocked, clicked: [] };

    const preferExact = [
      '继续沟通', '确定', '我知道了', '知道了', '确认', '好的', '同意', '继续'
    ];
    const avoid = ['取消', '关闭', '拒绝', '暂不', '下次再说', '放弃'];
    const clicked = [];

    for (let round = 0; round < 3; round++) {
      let hit = null;
      const els = document.querySelectorAll('a, button, span, div[role="button"]');
      for (const el of els) {
        if (!el || el.offsetParent === null) continue;
        const tx = (el.textContent || '').trim();
        if (!tx || tx.length > 12) continue;
        if (avoid.indexOf(tx) >= 0) continue;
        if (preferExact.indexOf(tx) >= 0) { hit = { el: el, tx: tx }; break; }
      }
      // 关闭广告/蒙层上的 ×（仅小图标类）
      if (!hit) {
        const closes = document.querySelectorAll('.boss-dialog .close, .dialog-wrap .close, [class*="dialog"] .icon-close, .close-btn');
        for (const el of closes) {
          if (el && el.offsetParent !== null) { hit = { el: el, tx: 'close' }; break; }
        }
      }
      if (!hit) break;
      try { hit.el.click(); clicked.push(hit.tx); } catch (e) {}
      await sleep(500);
      const b2 = detectBlock();
      if (b2) return { blocked: b2, clicked: clicked };
    }
    return { blocked: null, clicked: clicked };
  }

  function getCards() { return Array.from(document.querySelectorAll(SELECTORS.jobs.jobCard)); }

  function parseCard(card) {
    const nameEl = card.querySelector(SELECTORS.jobs.jobName);
    const salEl = card.querySelector(SELECTORS.jobs.jobSalary);
    const linkEl = card.querySelector('a[href*="/job_detail/"]') || card.querySelector('a[ka][href]') || card.querySelector('a');
    const link = linkEl ? linkEl.href : '';
    const m = link.match(/job_detail\/([^.?]+)\.html/);
    const id = (m && m[1]) || ((nameEl ? nameEl.textContent.trim() : '') + '|' + (salEl ? salEl.textContent.trim() : ''));
    const tags = Array.from(card.querySelectorAll(SELECTORS.jobs.tagList)).map(t => t.textContent.trim()).filter(Boolean);
    let company = '';
    const compEl = card.querySelector('.company-name a, .company-name, [class*="company-name"], .boss-info .company-name, .company-info a, [class*="company"] a');
    if (compEl) company = compEl.textContent.trim();
    let activeText = '';
    const activeEl = card.querySelector(SELECTORS.jobs.bossActive);
    if (activeEl) activeText = (activeEl.textContent || '').trim();
    if (!activeText) {
      const blob = (card.innerText || '').replace(/\s+/g, ' ');
      const m = blob.match(/(在线|刚刚活跃|今日活跃|今天活跃|\d+日内活跃|本周活跃|近两周活跃|两周内活跃|月内活跃|近期活跃)/);
      if (m) activeText = m[1];
    }
    return {
      id: id,
      name: nameEl ? nameEl.textContent.trim() : '未知岗位',
      salary: salEl ? salEl.textContent.trim() : '',
      tags: tags,
      company: company,
      link: link,
      activeText: activeText
    };
  }

  async function scrape(count, opts) {
    opts = opts || {};
    await dismissCommonDialogs();
    const login = detectLoginIssue();
    if (login) return login;

    const blocked = detectBlock();
    if (blocked) return blocked;

    const filterInactive = opts.filterInactive !== false;
    const activityMaxDays = parseInt(opts.activityMaxDays, 10);
    const maxDays = (!activityMaxDays || activityMaxDays <= 0) ? 0 : activityMaxDays;

    const seen = {};
    const jobs = [];
    const skippedInactive = [];
    let stall = 0;
    for (let loop = 0; loop < 40 && jobs.length < count && stall < 4; loop++) {
      const cards = getCards();
      let added = 0;
      for (const c of cards) {
        const j = parseCard(c);
        if (!j.id || seen[j.id]) continue;
        seen[j.id] = 1;
        if (filterInactive && maxDays > 0 && typeof Humanize !== 'undefined' && !Humanize.activityOk(j.activeText, maxDays)) {
          skippedInactive.push(j.name);
          continue;
        }
        jobs.push(j);
        added++;
        if (jobs.length >= count) break;
      }
      if (added === 0) stall++; else stall = 0;
      if (jobs.length >= count) break;
      if (typeof Humanize !== 'undefined') {
        const container = document.querySelector('.job-list-container, .job-list-box, [class*="job-list"]');
        await Humanize.humanScrollStep(container);
        // 偶尔滚到底触发懒加载
        if (loop % 3 === 2) {
          window.scrollTo(0, document.body.scrollHeight);
          if (container) container.scrollTop = container.scrollHeight;
          await Humanize.humanDelay(700, 1400);
        }
      } else {
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(1200);
      }
      const midLogin = detectLoginIssue();
      if (midLogin && jobs.length === 0) return midLogin;
    }

    if (!jobs.length) {
      const login2 = detectLoginIssue();
      if (login2) return login2;
      return {
        success: false,
        error: skippedInactive.length
          ? ('未扫到活跃岗位（已过滤不活跃 ' + skippedInactive.length + ' 个）。可放宽「活跃天数」后重试')
          : '未扫到岗位卡片。请确认已登录且在职位列表页，或刷新后重试'
      };
    }
    return {
      success: true,
      jobs: jobs.slice(0, count),
      skippedInactive: skippedInactive.length
    };
  }

  function findCardByJob(job) {
    const cards = getCards();
    for (const c of cards) { const j = parseCard(c); if (job.id && j.id === job.id) return c; }
    for (const c of cards) { const j = parseCard(c); if (j.name === job.name && (!job.company || j.company === job.company)) return c; }
    return null;
  }

  function waitFor(sel, timeout) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) { clearInterval(iv); resolve(el); }
        else if (Date.now() - t0 > timeout) { clearInterval(iv); resolve(null); }
      }, 200);
    });
  }

  function waitForText(texts, timeout) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const els = document.querySelectorAll('a, button, span, div');
        for (const el of els) {
          const tx = (el.textContent || '').trim();
          if (texts.indexOf(tx) >= 0 && el.offsetParent !== null) { clearInterval(iv); resolve(el); return; }
        }
        if (Date.now() - t0 > timeout) { clearInterval(iv); resolve(null); }
      }, 200);
    });
  }

  async function openJD(job) {
    const login = detectLoginIssue();
    if (login) return login;
    const dlg0 = await dismissCommonDialogs();
    if (dlg0.blocked) return dlg0.blocked;
    const blocked = detectBlock();
    if (blocked) return blocked;
    const card = findCardByJob(job);
    if (!card) return { success: false, error: '未找到岗位卡片' };
    card.scrollIntoView({ block: 'center' });
    await sleep(400);
    if (typeof Humanize !== 'undefined') await Humanize.humanClick(card);
    else card.click();
    await sleep(1600);
    await dismissCommonDialogs();
    let jd = '';
    const det = document.querySelector('.job-detail-box, [class*="job-detail"], .detail-content, .job-detail');
    if (det) jd = (det.innerText || '').trim();
    if (!jd) {
      const secs = document.querySelectorAll('.job-sec-text, [class*="job-sec"], [class*="job-desc"]');
      jd = Array.from(secs).map(s => (s.innerText || '').trim()).filter(Boolean).join('\n');
    }
    return { success: true, jd: jd.slice(0, 1800) };
  }

  async function goChat(job) {
    const login = detectLoginIssue();
    if (login) return login;
    const dlg0 = await dismissCommonDialogs();
    if (dlg0.blocked) return dlg0.blocked;
    const blocked0 = detectBlock();
    if (blocked0) return blocked0;
    let btn = await waitFor(SELECTORS.jobs.immediateChatBtn, 5000);
    if (!btn) {
      const all = document.querySelectorAll('a, button, span');
      for (const el of all) {
        const tx = (el.textContent || '').trim();
        if (tx === '立即沟通' || tx === '继续沟通') { btn = el; break; }
      }
    }
    if (!btn) {
      const card = findCardByJob(job);
      if (card) {
        if (typeof Humanize !== 'undefined') await Humanize.humanClick(card);
        else card.click();
        await sleep(1200);
        btn = await waitFor(SELECTORS.jobs.immediateChatBtn, 4000);
      }
    }
    if (!btn) {
      const login2 = detectLoginIssue();
      if (login2) return login2;
      return { success: false, error: '未找到立即沟通按钮（可能未登录或页面结构已变）' };
    }
    if (typeof Humanize !== 'undefined') await Humanize.humanClick(btn);
    else btn.click();
    await sleep(1500);
    const dlg1 = await dismissCommonDialogs();
    if (dlg1.blocked) return dlg1.blocked;
    const blocked1 = detectBlock();
    if (blocked1) return blocked1;
    const go = await waitForText(['继续沟通'], 2500);
    if (go) {
      if (typeof Humanize !== 'undefined') await Humanize.humanClick(go);
      else go.click();
      await sleep(800);
      return { success: true, navigated: true };
    }
    return { success: true, navigated: false, dialogs: dlg1.clicked };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') {
      sendResponse({ ok: true, page: 'search' });
      return;
    }
    if (msg.type === 'CHECK_LOGIN') {
      const login = detectLoginIssue();
      sendResponse(login || { ok: true });
      return;
    }
    if (msg.type === 'SCRAPE') {
      scrape(msg.count || 20, {
        filterInactive: msg.filterInactive,
        activityMaxDays: msg.activityMaxDays
      }).then((r) => {
        if (r.needLogin) sendResponse({ success: false, needLogin: true, error: r.error });
        else if (r.blocked) sendResponse({ success: false, blocked: true, reason: r.reason, error: r.reason });
        else if (r.success === false) sendResponse(r);
        else if (r.jobs) sendResponse({ success: true, jobs: r.jobs, skippedInactive: r.skippedInactive || 0 });
        else sendResponse({ success: false, error: '未知扫描结果' });
      }).catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (msg.type === 'OPEN_JD') {
      openJD(msg.job).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (msg.type === 'GO_CHAT' || msg.type === 'INITIATE' || msg.type === 'CREATE_CONV') {
      goChat(msg.job).then(r => sendResponse(r)).catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
  });
})();
