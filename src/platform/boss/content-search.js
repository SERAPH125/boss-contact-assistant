// ===== 搜索页 content script：扫描岗位 + 发起沟通（立即沟通→继续沟通）=====
(function () {
  if (window.__bossContactSearch) return;
  window.__bossContactSearch = true;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /** 避免对 javascript: 链接调用原生 click() 触发 CSP 报错 */
  async function safeClick(el, options) {
    if (!el) return false;
    options = options || {};
    const beforeDispatch = typeof options.beforeDispatch === 'function'
      ? options.beforeDispatch
      : null;
    const dispatchAllowed = (stage) => {
      if (!beforeDispatch) return true;
      try {
        return beforeDispatch(el, stage) === true;
      } catch (e) {
        return false;
      }
    };
    if (typeof Humanize !== 'undefined' && typeof Humanize.humanClick === 'function') {
      return Humanize.humanClick(el, {
        beforeDispatch(_element, stage) {
          return dispatchAllowed(stage);
        }
      });
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
        if (!dispatchAllowed('click')) return false;
        const opts = { bubbles: true, cancelable: true, view: window };
        const ev = new MouseEvent('click', opts);
        ev.preventDefault();
        el.dispatchEvent(ev);
        return true;
      }
      if (!dispatchAllowed('click')) return false;
      el.click();
      return true;
    } catch (e) {
      return false;
    }
  }

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

  function fatalReadError(code, message) {
    const error = new Error(message || code);
    error.code = code;
    return error;
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
   * 只关闭无外部副作用的信息提示；验证码/上限类不点，交给 detectBlock。
   * “立即沟通 / 继续沟通 / 确认 / 同意 / 继续”等动作按钮只能由写路径显式处理。
   */
  async function dismissCommonDialogs() {
    const blocked = detectBlock();
    if (blocked) return { blocked: blocked, clicked: [] };

    const preferExact = ['我知道了', '知道了'];
    const avoid = ['取消', '关闭', '拒绝', '暂不', '下次再说', '放弃'];
    const clicked = [];

    for (let round = 0; round < 3; round++) {
      // BOSS 首次建联的成功回执使用 `.greet-boss-dialog`。该弹窗可能
      // 先挂载容器与关闭图标，再异步挂载「继续沟通」按钮；因此不能
      // 依赖按钮文案来识别，更不能在按钮尚未出现时把它当普通蒙层关闭。
      if (visibleGreetingResultDialogs().length > 0) {
        break;
      }
      // 任何带写操作的业务弹窗都必须交给对应事务处理。尤其不能把
      // 「已向 BOSS 发送消息」结果弹窗的 × 当作普通广告关闭，否则会
      // 丢失「继续沟通」导航以及后续 AI 托管所需的会话标识。
      if (visibleDialogActions([
        '立即沟通',
        '继续沟通',
        '确认',
        '同意',
        '继续'
      ]).length > 0) {
        break;
      }
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
          if (!el || el.offsetParent === null) continue;
          // 现网 `.greet-boss-dialog` 容器本身常无 offsetParent，但其
          // `.icon-close` 仍可见；绝不能当成广告关掉成功回执。
          try {
            if (typeof el.closest === 'function' && el.closest('.greet-boss-dialog')) {
              continue;
            }
          } catch (e) {}
          hit = { el: el, tx: 'close' };
          break;
        }
      }
      if (!hit) break;
      try {
        await safeClick(hit.el);
        clicked.push(hit.tx);
      } catch (e) {}
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
    let securityId = '';
    let lid = '';
    try {
      const parsedLink = new URL(link, location.href);
      securityId = parsedLink.searchParams.get('securityId') || '';
      lid = parsedLink.searchParams.get('lid') || '';
    } catch (e) {}
    const tags = Array.from(card.querySelectorAll(SELECTORS.jobs.tagList)).map(t => t.textContent.trim()).filter(Boolean);
    // 现网职位卡：.boss-name 是公司名（见 browser-harness BOSS job card）；招聘者姓名只在详情面板。
    let company = '';
    const compEl = card.querySelector(
      '.company-name a, .company-name, .boss-info .company-name, .company-info a'
    );
    if (compEl) company = compEl.textContent.trim();
    if (!company) {
      const brandEl = card.querySelector(
        'a.boss-info .boss-name, .boss-info .boss-name, span.boss-name'
      );
      if (brandEl) company = brandEl.textContent.trim();
    }
    // 列表卡通常不暴露 HR；禁止把公司名误写入 hrName。
    const hrName = '';
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
      encryptJobId: (m && m[1]) || '',
      securityId: securityId,
      lid: lid,
      name: nameEl ? nameEl.textContent.trim() : '未知岗位',
      salary: salEl ? salEl.textContent.trim() : '',
      tags: tags,
      company: company,
      hrName: hrName,
      link: link,
      activeText: activeText
    };
  }

  async function enrichDescriptions(jobs) {
    return JobDescription.enrichJobsWithReader(jobs, {
      maxChars: 6000,
      source: 'boss-search-panel',
      readDescription: readBossSearchPanel,
      shouldRethrow(error) {
        return !!error &&
          (error.code === 'BLOCKED' || error.code === 'LOGIN_REQUIRED');
      }
    });
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
      const discovered = [];
      for (const c of cards) {
        const j = parseCard(c);
        if (!j.id || seen[j.id]) continue;
        seen[j.id] = 1;
        if (filterInactive && maxDays > 0 && typeof Humanize !== 'undefined' && !Humanize.activityOk(j.activeText, maxDays)) {
          skippedInactive.push(j.name);
          continue;
        }
        discovered.push(j);
        if (jobs.length + discovered.length >= count) break;
      }
      let added = discovered.length;
      if (added > 0) {
        const ready = opts.includeDescription
          ? await enrichDescriptions(discovered)
          : discovered;
        jobs.push(...ready);
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
    const output = jobs.slice(0, count);
    return {
      success: true,
      jobs: output,
      skippedInactive: skippedInactive.length,
      descriptionLoaded: output.filter((job) => job.descriptionStatus === 'loaded').length,
      descriptionFailed: output.filter((job) => job.descriptionStatus === 'failed').length
    };
  }

  function findCardByJob(job) {
    const cards = getCards();
    for (const c of cards) { const j = parseCard(c); if (job.id && j.id === job.id) return c; }
    if (job && job.id) return null;
    for (const c of cards) { const j = parseCard(c); if (j.name === job.name && (!job.company || j.company === job.company)) return c; }
    return null;
  }

  async function locateCardByJob(job) {
    let card = findCardByJob(job);
    if (card) return card;
    const container = document.querySelector(
      '.job-list-container, .job-list-box, [class*="job-list"]'
    );
    try {
      if (container) container.scrollTop = 0;
      window.scrollTo(0, 0);
    } catch (e) {}
    await sleep(350);
    for (let step = 0; step < 30; step++) {
      const login = detectLoginIssue();
      if (login) throw fatalReadError('LOGIN_REQUIRED', login.error);
      const blocked = detectBlock();
      if (blocked) throw fatalReadError('BLOCKED', blocked.reason);
      card = findCardByJob(job);
      if (card) return card;
      if (typeof Humanize !== 'undefined' &&
        typeof Humanize.humanScrollStep === 'function') {
        await Humanize.humanScrollStep(container);
      } else if (container) {
        container.scrollTop += Math.max(320, container.clientHeight * 0.75);
        await sleep(400);
      } else {
        window.scrollBy(0, 700);
        await sleep(400);
      }
    }
    return null;
  }

  function normalizedHeading(raw) {
    return String(raw || '').replace(/\s+/g, '').trim();
  }

  function normalizedBossName(raw) {
    return String(raw || '')
      .replace(
        /\s*(?:在线|刚刚活跃|今日活跃|今天活跃|昨日活跃|本周活跃|本月活跃|本年活跃|近两周活跃|近半年活跃|两周内活跃|半年内活跃|半年前活跃|月内活跃|近期活跃|(?:\d+|[一二三四五六七八九十两]+)(?:分钟|小时|日|天|周|个?月|年)(?:内|前)?活跃).*$/u,
        ''
      )
      .trim();
  }

  function normalizedIdentityValue(raw) {
    return String(raw || '')
      .toLowerCase()
      .replace(/[\s·•|｜,，。:：;；()（）【】\[\]'"“”‘’_\-—]/g, '');
  }

  function detailText(element) {
    return String(element && (element.innerText || element.textContent) || '').trim();
  }

  function detailRecruiterName(detailRoot) {
    if (!detailRoot) return '';
    const selector = SELECTORS.jobs.detailRecruiter ||
      '.job-boss-info h2.name, .job-boss-info .name, ' +
      '.boss-info h2.name, .job-boss-info .boss-name';
    let nodes = [];
    if (typeof detailRoot.querySelectorAll === 'function') {
      nodes = Array.from(detailRoot.querySelectorAll(selector));
    }
    if (!nodes.length && typeof detailRoot.querySelector === 'function') {
      const fallback = detailRoot.querySelector(selector);
      if (fallback) nodes = [fallback];
    }
    const unique = new Map();
    for (const node of nodes) {
      const name = normalizedBossName(detailText(node));
      const key = normalizedIdentityValue(name);
      if (key && !unique.has(key)) unique.set(key, name);
    }
    return unique.size === 1 ? Array.from(unique.values())[0] : '';
  }

  function detailCompanyName(detailRoot) {
    if (!detailRoot) return '';
    // 现网详情：公司在「吉林省萌敬商贸 · 人事」，不是 .company-name。
    const attr = detailRoot.querySelector(
      '.job-boss-info .boss-info-attr, .boss-info-attr'
    );
    if (attr) {
      const raw = detailText(attr);
      const company = raw.split(/\s*[·|｜]\s*/)[0].trim();
      if (company && !/查看更多|立即沟通|继续沟通/.test(company)) {
        return company.slice(0, 80);
      }
    }
    const companyEl = detailRoot.querySelector(
      SELECTORS.jobs.company ||
      '.company-name, .boss-info .company-name'
    );
    const text = detailText(companyEl);
    if (text && !/查看更多|立即沟通|继续沟通/.test(text)) {
      return text.slice(0, 80);
    }
    return '';
  }

  function detailFromRoot(detailRoot) {
    if (!detailRoot) {
      return {
        name: '',
        company: '',
        hrName: '',
        encryptJobId: '',
        description: '',
        detailRoot: null
      };
    }
    const heading = detailRoot.querySelector('.job-detail-header .job-name');
    const identityLink = detailRoot && (
      detailRoot.querySelector('.more-job-btn[href*="/job_detail/"]') ||
      detailRoot.querySelector('a[href*="/job_detail/"]')
    );
    return {
      name: normalizedHeading(heading && heading.textContent),
      company: detailCompanyName(detailRoot),
      hrName: detailRecruiterName(detailRoot),
      encryptJobId: JobDescription.extractBossJobId(
        identityLink && identityLink.href
      ),
      description: JobDescription.extractFromDocument(
        'boss-search',
        detailRoot,
        6000
      ),
      detailRoot: detailRoot
    };
  }

  function currentBossDetail(expected) {
    let roots = [];
    if (typeof document.querySelectorAll === 'function') {
      roots = Array.from(document.querySelectorAll('.job-detail-container'));
    }
    if (!roots.length) {
      const fallback = document.querySelector('.job-detail-container');
      if (fallback) roots = [fallback];
    }
    const visibleRoots = roots.filter((root) => {
      if (!root) return false;
      if (root.offsetParent !== null) return true;
      return typeof root.getClientRects === 'function' &&
        root.getClientRects().length > 0;
    });
    const candidates = (visibleRoots.length ? visibleRoots : roots)
      .map(detailFromRoot);
    const expectedId = String(
      expected && (expected.encryptJobId || expected.id) || ''
    ).trim();
    if (expectedId) {
      const exact = candidates.filter((detail) =>
        detail.encryptJobId === expectedId
      );
      if (exact.length === 1) return exact[0];
      if (exact.length > 1) return detailFromRoot(null);
    }
    return candidates[0] || detailFromRoot(null);
  }

  async function waitForBossDetail(job, previous, timeout) {
    const startedAt = Date.now();
    const limit = Math.max(1200, Number(timeout) || 6000);
    while (Date.now() - startedAt < limit) {
      const blocked = detectBlock();
      if (blocked) throw fatalReadError('BLOCKED', blocked.reason);
      const login = detectLoginIssue();
      if (login) throw fatalReadError('LOGIN_REQUIRED', login.error);
      const current = currentBossDetail(job);
      if (JobDescription.bossDetailMatches(job, current, previous)) {
        return current.description;
      }
      await sleep(120);
    }
    throw new Error('职位详情面板加载超时');
  }

  async function activateBossJob(job) {
    const current = currentBossDetail(job);
    if (JobDescription.bossDetailMatches(job, current, null)) {
      return current.description;
    }
    const card = await locateCardByJob(job);
    if (!card) throw new Error('岗位卡片已离开当前列表');
    const previous = currentBossDetail();
    const clickTarget = card.querySelector('.job-info') || card;
    const clicked = await safeClick(clickTarget);
    if (!clicked) throw new Error('岗位详情无法打开');
    return waitForBossDetail(job, previous, 6000);
  }

  async function readBossSearchPanel(job) {
    return activateBossJob(job);
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

  function isDialogAction(element) {
    if (!element || typeof element.closest !== 'function') return false;
    try {
      return !!element.closest(
        '[role="dialog"], .boss-dialog, .dialog-wrap, [class*="dialog"]'
      );
    } catch (e) {
      return false;
    }
  }

  function waitForDialogText(texts, timeout) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const els = document.querySelectorAll('a, button, span, div');
        for (const el of els) {
          const tx = (el.textContent || '').trim();
          if (texts.indexOf(tx) >= 0 &&
            el.offsetParent !== null &&
            isDialogAction(el)) {
            clearInterval(iv);
            resolve(el);
            return;
          }
        }
        if (Date.now() - t0 > timeout) {
          clearInterval(iv);
          resolve(null);
        }
      }, 200);
    });
  }

  function canonicalDialogAction(element, texts) {
    if (!element) return null;
    let action = element;
    const tag = String(element.tagName || '').toLowerCase();
    const role = typeof element.getAttribute === 'function'
      ? String(element.getAttribute('role') || '').toLowerCase()
      : '';
    if (tag !== 'a' && tag !== 'button' && role !== 'button') {
      try {
        const owner = typeof element.closest === 'function'
          ? element.closest('a, button, [role="button"]')
          : null;
        if (owner) action = owner;
      } catch (e) {}
    }
    const actionText = (action.textContent || '').trim();
    if (texts.indexOf(actionText) < 0 ||
        action.offsetParent === null ||
        !isDialogAction(action)) {
      return null;
    }
    return action;
  }

  function visibleDialogActions(texts) {
    const matches = [];
    const seen = new Set();
    const els = document.querySelectorAll('a, button, span, div');
    for (const el of els) {
      const tx = (el.textContent || '').trim();
      if (texts.indexOf(tx) < 0 || el.offsetParent === null) continue;
      const action = canonicalDialogAction(el, texts);
      if (!action || seen.has(action)) continue;
      seen.add(action);
      matches.push(action);
    }
    return matches;
  }

  function visibleGreetingResultDialogs() {
    // 2026-07-30 ego 实号：`.greet-boss-dialog` 挂载后容器 offsetParent 可为
    // null，但内部 `.sure-btn` / 文案仍可见。因此只要节点已连接 DOM 即保护，
    // 不能依赖容器自身的 isVisibleAction。
    const dialogs = document.querySelectorAll('.greet-boss-dialog');
    return Array.from(dialogs).filter((dialog) => {
      if (!dialog || dialog.isConnected === false) return false;
      if (isVisibleAction(dialog)) return true;
      try {
        const inner = dialog.querySelector(
          '.sure-btn, .greet-boss-footer, .greet-boss-container, .icon-close, a, button'
        );
        if (inner && isVisibleAction(inner)) return true;
      } catch (e) {}
      return true;
    });
  }

  function waitForNewDialogText(texts, existing, timeout) {
    return new Promise((resolve) => {
      const baseline = existing instanceof Set ? existing : new Set();
      const t0 = Date.now();
      const iv = setInterval(() => {
        const fresh = visibleDialogActions(texts)
          .filter((element) => !baseline.has(element));
        if (fresh.length === 1) {
          clearInterval(iv);
          resolve({ element: fresh[0], ambiguous: false });
          return;
        }
        if (fresh.length > 1) {
          clearInterval(iv);
          resolve({ element: null, ambiguous: true });
          return;
        }
        if (Date.now() - t0 > timeout) {
          clearInterval(iv);
          resolve({ element: null, ambiguous: false });
        }
      }, 200);
    });
  }

  function targetUncertainResult(message, externalActionPossible) {
    return {
      success: false,
      targetUncertain: true,
      externalActionPossible: externalActionPossible === true,
      error: message
    };
  }

  function isCurrentBossTarget(job) {
    return JobDescription.bossDetailMatches(
      job,
      currentBossDetail(job),
      null
    );
  }

  function isVisibleAction(element) {
    if (!element) return false;
    if (element.offsetParent !== null) return true;
    return typeof element.getClientRects === 'function' &&
      element.getClientRects().length > 0;
  }

  function findDetailAction(detailRoot) {
    if (!detailRoot) return null;
    let button = detailRoot.querySelector(SELECTORS.jobs.immediateChatBtn);
    if (isVisibleAction(button)) return button;
    const candidates = detailRoot.querySelectorAll('a, button, span');
    for (const element of candidates) {
      if (!isVisibleAction(element)) continue;
      if ((element.textContent || '').trim() === '立即沟通') return element;
    }
    return null;
  }

  async function waitForDetailAction(job, timeout) {
    const startedAt = Date.now();
    const limit = Math.max(1200, Number(timeout) || 5000);
    while (Date.now() - startedAt < limit) {
      const current = currentBossDetail(job);
      if (JobDescription.bossDetailMatches(job, current, null)) {
        const button = findDetailAction(current.detailRoot);
        if (button) {
          return {
            button: button,
            detail: current,
            detailRoot: current.detailRoot
          };
        }
      }
      await sleep(120);
    }
    return null;
  }

  function detailOwnsAction(detailRoot, action) {
    return !!detailRoot && !!action &&
      typeof detailRoot.contains === 'function' &&
      detailRoot.contains(action);
  }

  function sameLockedDetailIdentity(locked, latest) {
    if (!locked || !latest) return false;
    const fields = ['name', 'company', 'hrName'];
    for (const field of fields) {
      const expected = normalizedIdentityValue(locked[field]);
      if (!expected) continue;
      if (normalizedIdentityValue(latest[field]) !== expected) return false;
    }
    return true;
  }

  async function openJD(job) {
    const login = detectLoginIssue();
    if (login) return login;
    const dlg0 = await dismissCommonDialogs();
    if (dlg0.blocked) return dlg0.blocked;
    const blocked = detectBlock();
    if (blocked) return blocked;
    try {
      const description = await activateBossJob(job);
      return { success: true, jd: description.slice(0, 1800) };
    } catch (error) {
      if (error && error.code === 'LOGIN_REQUIRED') {
        return { success: false, needLogin: true, error: error.message };
      }
      if (error && error.code === 'BLOCKED') {
        return {
          success: false,
          blocked: true,
          code: 'RUN_BLOCKED',
          reason: error.message,
          error: error.message
        };
      }
      return {
        success: false,
        selectorUnavailable: true,
        error: String(error && error.message || '职位描述读取失败')
      };
    }
  }

  async function goChat(job) {
    const login = detectLoginIssue();
    if (login) return login;
    // 先冻结已有业务弹窗，再做任何通用清理。若已有「继续沟通」，
    // 无法证明它属于本次岗位，既不能确认，也不能点 × 关闭。
    const continueDialogsBeforeContact = new Set(
      visibleDialogActions(['继续沟通'])
    );
    const greetingResultsBeforeContact = new Set(
      visibleGreetingResultDialogs()
    );
    if (greetingResultsBeforeContact.size > 0) {
      return targetUncertainResult(
        '联系前页面已有来源不明的“已向BOSS发送消息”结果弹窗，请先人工处理后重试',
        false
      );
    }
    if (continueDialogsBeforeContact.size > 0) {
      return targetUncertainResult(
        '联系前页面已有来源不明的继续沟通弹窗，请先人工处理后重试',
        false
      );
    }
    const dlg0 = await dismissCommonDialogs();
    if (dlg0.blocked) return dlg0.blocked;
    const blocked0 = detectBlock();
    if (blocked0) return blocked0;
    try {
      await activateBossJob(job);
    } catch (error) {
      if (error && error.code === 'LOGIN_REQUIRED') {
        return { success: false, needLogin: true, error: error.message };
      }
      if (error && error.code === 'BLOCKED') {
        return {
          success: false,
          blocked: true,
          code: 'RUN_BLOCKED',
          reason: error.message,
          error: error.message
        };
      }
      return {
        success: false,
        targetUncertain: true,
        externalActionPossible: false,
        error: '无法在联系前确认目标岗位：' +
          String(error && error.message || '岗位详情不可用')
      };
    }
    if (!isCurrentBossTarget(job)) {
      return targetUncertainResult(
        '当前详情与目标岗位不一致，已停止联系',
        false
      );
    }
    const action = await waitForDetailAction(job, 5000);
    if (!action) {
      const login2 = detectLoginIssue();
      if (login2) return login2;
      return {
        success: false,
        selectorUnavailable: true,
        error: '目标职位详情内未找到立即沟通按钮（可能未登录或页面结构已变）'
      };
    }
    // 等待期间 DOM 可能被 SPA 替换；真正写入前同时重证岗位、面板和按钮归属。
    const finalDetail = currentBossDetail(job);
    if (!JobDescription.bossDetailMatches(job, finalDetail, null) ||
        finalDetail.detailRoot !== action.detailRoot ||
        !detailOwnsAction(finalDetail.detailRoot, action.button)) {
      return targetUncertainResult(
        '联系按钮出现前目标岗位或详情面板已切换，已停止联系',
        false
      );
    }
    const lockedDetail = {
      name: finalDetail.name || '',
      company: finalDetail.company || '',
      hrName: finalDetail.hrName || '',
      encryptJobId: finalDetail.encryptJobId || ''
    };
    const handoffHrName = lockedDetail.hrName;
    if (!handoffHrName) {
      return targetUncertainResult(
        '目标职位详情缺少可核验的 HR 身份，已停止联系',
        false
      );
    }
    try {
      sessionStorage.setItem('__job_contact_expected__', JSON.stringify({
        id: job.id || '',
        name: job.name || finalDetail.name || '',
        company: job.company || finalDetail.company || '',
        hrName: handoffHrName,
        at: Date.now()
      }));
    } catch (e) {}
    let primaryTargetStillSafe = true;
    let primaryExternalActionPossible = false;
    const primaryClicked = await safeClick(action.button, {
      beforeDispatch(_element, stage) {
        const latest = currentBossDetail(job);
        primaryExternalActionPossible =
          stage === 'mouseup' ||
          stage === 'click' ||
          stage === 'click-fallback';
        primaryTargetStillSafe =
          JobDescription.bossDetailMatches(job, latest, null) &&
          sameLockedDetailIdentity(lockedDetail, latest) &&
          latest.detailRoot === action.detailRoot &&
          detailOwnsAction(latest.detailRoot, action.button) &&
          isVisibleAction(action.button) &&
          findDetailAction(latest.detailRoot) === action.button &&
          visibleDialogActions(['继续沟通']).length === 0;
        return primaryTargetStillSafe;
      }
    });
    if (!primaryClicked) {
      if (!primaryTargetStillSafe) {
        if (primaryExternalActionPossible) {
          return {
            success: false,
            sendResultUnknown: true,
            externalActionPossible: true,
            error: '拟人点击已开始后目标或弹窗状态变化，请人工核对，系统不会重试'
          };
        }
        return targetUncertainResult(
          '拟人点击等待期间目标岗位、HR、联系按钮或弹窗状态已切换，已停止联系',
          false
        );
      }
      return {
        success: false,
        selectorUnavailable: true,
        error: '立即沟通按钮无法安全点击'
      };
    }
    await sleep(1500);
    // 不在首次联系后运行通用弹窗清理。BOSS 的成功回执正是一个带
    // `.icon-close` 的 `.greet-boss-dialog`，必须先读取并确认其
    // 「继续沟通」动作，才能进入聊天页并登记 AI 托管。
    const blocked1 = detectBlock();
    if (blocked1) return blocked1;
    const goResult = await waitForNewDialogText(
      ['继续沟通'],
      continueDialogsBeforeContact,
      5000
    );
    if (goResult.ambiguous) {
      return {
        success: false,
        sendResultUnknown: true,
        externalActionPossible: true,
        error: '首次点击后出现多个继续沟通弹窗，未确认任何弹窗，请人工核对'
      };
    }
    const go = goResult.element;
    if (go) {
      // 首次点击已经发生，因此目标变化时结果不可回滚，但绝不能确认下一步。
      if (!isCurrentBossTarget(job)) {
        return targetUncertainResult(
          '确认继续沟通前目标岗位已切换，请人工核对首次点击结果',
          true
        );
      }
      // 继续沟通会触发整页跳转；必须立刻返回，禁止再 sleep，否则通道进 bfcache 报错
      let continueTargetStillSafe = true;
      const confirmed = await safeClick(go, {
        beforeDispatch() {
          const fresh = visibleDialogActions(['继续沟通'])
            .filter((element) => !continueDialogsBeforeContact.has(element));
          const latest = currentBossDetail(job);
          continueTargetStillSafe =
            JobDescription.bossDetailMatches(job, latest, null) &&
            sameLockedDetailIdentity(lockedDetail, latest) &&
            fresh.length === 1 &&
            fresh[0] === go &&
            isVisibleAction(go) &&
            isDialogAction(go);
          return continueTargetStillSafe;
        }
      });
      if (!confirmed) {
        return {
          success: false,
          sendResultUnknown: true,
          contactConfirmed: true,
          externalActionPossible: true,
          error: continueTargetStillSafe
            ? '联系已成功，但继续沟通按钮无法安全点击，AI 托管尚未登记'
            : '联系已成功，但目标岗位或继续沟通弹窗已切换，AI 托管尚未登记'
        };
      }
      return {
        success: true,
        navigated: true,
        contactConfirmed: true
      };
    }
    if (/\/web\/geek\/chat(?:[/?#]|$)/i.test(location.href || '')) {
      return {
        success: true,
        navigated: true,
        contactConfirmed: true
      };
    }
    // 首次点击可能已产生外部副作用，但既没有成功回执，也没有聊天页
    // 证据。不能伪报成功，更不能自动重试而造成重复联系。
    return {
      success: false,
      sendResultUnknown: true,
      externalActionPossible: true,
      error: '首次联系动作已执行，但未取得发送成功回执或聊天页证据；AI 托管未登记，系统不会自动重试'
    };
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
        activityMaxDays: msg.activityMaxDays,
        includeDescription: msg.includeDescription === true
      }).then((r) => {
        if (r.needLogin) sendResponse({ success: false, needLogin: true, error: r.error });
        else if (r.blocked) sendResponse({ success: false, blocked: true, reason: r.reason, error: r.reason });
        else if (r.success === false) sendResponse(r);
        else if (r.jobs) sendResponse({
          success: true,
          jobs: r.jobs,
          skippedInactive: r.skippedInactive || 0,
          descriptionLoaded: r.descriptionLoaded || 0,
          descriptionFailed: r.descriptionFailed || 0
        });
        else sendResponse({ success: false, error: '未知扫描结果' });
      }).catch((error) => {
        if (error && error.code === 'LOGIN_REQUIRED') {
          sendResponse({
            success: false,
            needLogin: true,
            error: error.message
          });
          return;
        }
        if (error && error.code === 'BLOCKED') {
          sendResponse({
            success: false,
            blocked: true,
            code: 'RUN_BLOCKED',
            reason: error.message,
            error: error.message
          });
          return;
        }
        sendResponse({
          success: false,
          error: String(error && error.message || '扫描失败')
        });
      });
      return true;
    }
    if (msg.type === 'OPEN_JD') {
      openJD(msg.job).then(r => {
        try { sendResponse(r); } catch (e) {}
      }).catch(e => {
        try { sendResponse({ success: false, error: e.message }); } catch (e2) {}
      });
      return true;
    }
    if (msg.type === 'GO_CHAT' || msg.type === 'INITIATE' || msg.type === 'CREATE_CONV') {
      // 跳转前尽量先回包；若仍因 bfcache 失败，由 background 容错
      goChat(msg.job).then(r => {
        try { sendResponse(r); } catch (e) {}
      }).catch(e => {
        try { sendResponse({ success: false, error: e.message }); } catch (e2) {}
      });
      return true;
    }
  });
})();
