// 拟人化工具（借鉴 BossAssistant / boss_batch_push / boss-autogreet 的降风险思路）
// 红线：不破解验证码、不伪造指纹、遇阻即停
(function (g) {
  if (g.__BOSS_CONTACT_HUMANIZE__) return;
  g.__BOSS_CONTACT_HUMANIZE__ = true;

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function randFloat(a, b) {
    return a + Math.random() * (b - a);
  }

  function randInt(a, b) {
    return Math.floor(randFloat(a, b + 1));
  }

  /** 三角分布延迟，比纯均匀更接近真人节奏 */
  function triangular(min, max) {
    var mid = (min + max) / 2;
    var u = Math.random();
    if (u < 0.5) return min + Math.sqrt(u * (max - min) * (mid - min));
    return max - Math.sqrt((1 - u) * (max - min) * (max - mid));
  }

  async function humanDelay(minMs, maxMs) {
    var lo = Math.max(0, Number(minMs) || 0);
    var hi = Math.max(lo, Number(maxMs) || lo);
    var ms = Math.round(triangular(lo, hi));
    // 额外 0–12% 抖动
    ms = Math.round(ms * (1 + randFloat(0, 0.12)));
    await sleep(ms);
    return ms;
  }

  /**
   * 解析 Boss 活跃文案 → 估算「几天内」
   * 参考 boss_batch_push / BossAssistant 的活跃过滤
   */
  function parseActivityDays(text) {
    var t = (text || '').replace(/\s+/g, '');
    if (!t) return 999;
    if (/在线|刚刚|此刻|正在/.test(t)) return 0;
    if (/今日|今天|日内/.test(t) && !/\d/.test(t)) return 1;
    if (/今日活跃|今天活跃/.test(t)) return 1;
    var m = t.match(/(\d+)\s*日/);
    if (m) return parseInt(m[1], 10);
    if (/本周|一周内|近一周|7日内/.test(t)) return 7;
    if (/两周|近两周|14日/.test(t)) return 14;
    if (/本月|月内|30日/.test(t)) return 30;
    if (/近期活跃/.test(t)) return 7;
    if (/不活跃|很少活跃|未活跃/.test(t)) return 999;
    return 14; // 未知偏保守：当作两周
  }

  function activityOk(text, maxDays) {
    var limit = parseInt(maxDays, 10);
    if (!limit || limit <= 0) return true; // 0 = 不限
    return parseActivityDays(text) <= limit;
  }

  /** 拟人滚动一段距离（扫描翻页用） */
  async function humanScrollStep(container) {
    var el = container || document.scrollingElement || document.documentElement;
    var delta = randInt(380, 820);
    if (el && el !== document.documentElement && el !== document.body) {
      el.scrollTop += delta;
    } else {
      window.scrollBy(0, delta);
    }
    await humanDelay(450, 1100);
  }

  function resolveAnchor(el) {
    if (!el) return null;
    var anchor = null;
    try {
      if (typeof el.closest === 'function') anchor = el.closest('a[href]');
    } catch (e) {}
    if (!anchor && String(el.tagName || '').toLowerCase() === 'a') anchor = el;
    return anchor;
  }

  function hasJavascriptUrlDefaultAction(el) {
    var anchor = resolveAnchor(el);
    if (!anchor || typeof anchor.getAttribute !== 'function') return false;
    var href = anchor.getAttribute('href') || '';
    return /^\s*javascript\s*:/i.test(href);
  }

  /**
   * 点击前短暂停 + 悬停事件，降低「瞬时机械点击」特征
   * （扩展无法完美模拟真实鼠标轨迹，但可加前置抖动）
   *
   * Boss 弹窗关闭链常见 href="javascript:void(0)"：原生 click()/未取消的
   * javascript: 导航会被页面 CSP 拦截并打控制台错误。对这类链接：
   * 1) 点击期间临时去掉 href，避免触发 javascript: URL
   * 2) 捕获阶段 preventDefault 双保险
   * 3) 绝不回退到会跑 javascript: 的 el.click()
   */
  async function humanClick(el) {
    if (!el) return false;
    var anchor = resolveAnchor(el);
    var href = anchor && typeof anchor.getAttribute === 'function'
      ? (anchor.getAttribute('href') || '')
      : '';
    var blocksJavascriptUrl = /^\s*javascript\s*:/i.test(href);
    var guard = null;
    var hrefRemoved = false;

    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (e) {
      try { el.scrollIntoView({ block: 'center' }); } catch (e2) {}
    }
    await humanDelay(180, 520);

    if (blocksJavascriptUrl && anchor) {
      guard = function (event) {
        try { event.preventDefault(); } catch (e3) {}
      };
      try {
        el.addEventListener('click', guard, true);
        if (anchor !== el) anchor.addEventListener('click', guard, true);
      } catch (e4) {}
      try {
        anchor.removeAttribute('href');
        hrefRemoved = true;
      } catch (e5) {
        hrefRemoved = false;
      }
    }

    try {
      var rect = el.getBoundingClientRect();
      var x = rect.left + rect.width * randFloat(0.3, 0.7);
      var y = rect.top + rect.height * randFloat(0.3, 0.7);
      var opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
      el.dispatchEvent(new MouseEvent('mouseover', opts));
      el.dispatchEvent(new MouseEvent('mouseenter', opts));
      await humanDelay(60, 180);
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      await humanDelay(40, 120);
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      var clickEvent = new MouseEvent('click', opts);
      if (blocksJavascriptUrl) {
        try { clickEvent.preventDefault(); } catch (e6) {}
      }
      el.dispatchEvent(clickEvent);
    } catch (e) {
      // javascript: 链接禁止回退原生 click()，否则必触 CSP
      if (blocksJavascriptUrl) return false;
      try { el.click(); } catch (e2) { return false; }
    } finally {
      if (guard) {
        try { el.removeEventListener('click', guard, true); } catch (e7) {}
        if (anchor && anchor !== el) {
          try { anchor.removeEventListener('click', guard, true); } catch (e8) {}
        }
      }
      if (hrefRemoved && anchor && href) {
        try { anchor.setAttribute('href', href); } catch (e9) {}
      }
    }
    return true;
  }

  g.Humanize = {
    sleep: sleep,
    randFloat: randFloat,
    randInt: randInt,
    humanDelay: humanDelay,
    parseActivityDays: parseActivityDays,
    activityOk: activityOk,
    hasJavascriptUrlDefaultAction: hasJavascriptUrlDefaultAction,
    humanScrollStep: humanScrollStep,
    humanClick: humanClick
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
