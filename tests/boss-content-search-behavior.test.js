const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(
  path.join(root, 'src/platform/boss/content-search.js'),
  'utf8'
);
const selectorsSource = fs.readFileSync(
  path.join(root, 'src/platform/boss/selectors.js'),
  'utf8'
);
const selectorsContext = { globalThis: {} };
vm.runInNewContext(selectorsSource, selectorsContext, {
  filename: 'boss-selectors.js'
});
const BOSS_SELECTORS = selectorsContext.globalThis.SELECTORS;
const JobDescription = require('../src/platform/job-description.js');

function createVisibleButton(text, onClick, options = {}) {
  return {
    textContent: text,
    offsetParent: {},
    tagName: 'BUTTON',
    clickCount: 0,
    click() {
      this.clickCount += 1;
      if (typeof onClick === 'function') onClick();
    },
    closest(selector) {
      if (options.inGreetingResult &&
          String(selector || '').indexOf('greet-boss-dialog') >= 0) {
        return { className: 'greet-boss-dialog', isConnected: true };
      }
      if (options.inDialog && /dialog/.test(selector)) return { role: 'dialog' };
      return null;
    }
  };
}

function createHarness(options = {}) {
  let runtimeHandler = null;
  let detailId = options.detailId || 'target-job';
  let detailName = options.detailName || '目标岗位';
  let detailHrName = Object.prototype.hasOwnProperty.call(options, 'detailHrName')
    ? options.detailHrName
    : '张女士';
  const detailHrNodes = Array.isArray(options.detailHrNodes)
    ? options.detailHrNodes.map((node) => ({
      selector: node.selector,
      textContent: node.text
    }))
    : [{
      selector: '.job-boss-info .name',
      get textContent() {
        return detailHrName;
      }
    }];
  let showContinue = options.showContinue === true;
  let showGreetingResult =
    showContinue ||
    options.showGreetingDialogWithoutAction === true;
  let fakeNow = 0;
  let intervalSequence = 0;
  const activeIntervals = new Set();

  const continueButton = createVisibleButton('继续沟通', () => {
    if (typeof options.onContinueClick === 'function') {
      options.onContinueClick({
        setDetailId(value) {
          detailId = value;
        }
      });
    }
  }, { inDialog: true });
  const continueTextNode = {
    textContent: '继续沟通',
    offsetParent: {},
    tagName: 'SPAN',
    closest(selector) {
      if (/a,\s*button/.test(selector)) return continueButton;
      if (/dialog/.test(selector)) return { role: 'dialog' };
      return null;
    }
  };
  const continueCloseButton = createVisibleButton('', () => {
    showContinue = false;
    showGreetingResult = false;
  }, { inDialog: true, inGreetingResult: true });
  const greetingResultDialog = {
    // 现网容器常无 offsetParent；保护逻辑必须按 isConnected / 内部可见节点判定。
    offsetParent: options.greetingDialogOffsetParentNull === true ? null : {},
    isConnected: true,
    textContent: options.showGreetingDialogWithoutAction
      ? '已向BOSS发送消息'
      : '已向BOSS发送消息继续沟通',
    querySelector(selector) {
      const sel = String(selector || '');
      if (/\.sure-btn|greet-boss-footer|greet-boss-container/.test(sel)) {
        return showContinue ? continueButton : null;
      }
      if (/\.icon-close/.test(sel)) {
        return options.continueDialogHasClose ? continueCloseButton : null;
      }
      if (/\ba\b|\bbutton\b/.test(sel)) {
        return showContinue ? continueButton : null;
      }
      return null;
    }
  };
  const contactButton = createVisibleButton('立即沟通', () => {
    showContinue = options.keepResidualContinueAfterContact === true
      ? true
      : options.showContinueAfterContact === true;
    showGreetingResult =
      showContinue ||
      options.showGreetingDialogAfterContactWithoutAction === true;
    if (typeof options.onContactClick === 'function') {
      options.onContactClick({
        setDetailId(value) {
          detailId = value;
        }
      });
    }
  });
  const foreignContactButton = createVisibleButton('立即沟通');

  const heading = {
    get textContent() {
      return detailName;
    }
  };
  function matchesSelectorGroup(requested, owned) {
    return String(requested || '')
      .split(',')
      .map((part) => part.trim())
      .includes(owned);
  }

  function hrNodesForSelector(selector) {
    return detailHrNodes.filter((node) =>
      matchesSelectorGroup(selector, node.selector)
    );
  }

  const detailCompanyAttrText = Object.prototype.hasOwnProperty.call(
    options,
    'detailCompanyAttr'
  )
    ? options.detailCompanyAttr
    : '';
  const detailCompanyAttrNode = detailCompanyAttrText
    ? { textContent: detailCompanyAttrText, innerText: detailCompanyAttrText }
    : null;

  const detailRoot = {
    offsetParent: {},
    querySelector(selector) {
      if (selector === '.job-detail-header .job-name') return heading;
      if (selector === '.job-detail-body .desc') return description;
      if (
        detailCompanyAttrNode &&
        (
          selector === '.job-boss-info .boss-info-attr, .boss-info-attr' ||
          selector === '.job-boss-info .boss-info-attr' ||
          selector === '.boss-info-attr'
        )
      ) {
        return detailCompanyAttrNode;
      }
      const matchingHrNodes = hrNodesForSelector(selector);
      if (matchingHrNodes.length) return matchingHrNodes[0];
      if (selector.includes('/job_detail/')) {
        return {
          get href() {
            return `https://www.zhipin.com/job_detail/${detailId}.html`;
          }
        };
      }
      if (selector === BOSS_SELECTORS.jobs.immediateChatBtn) {
        if (options.hideContactAction) return null;
        if (options.switchOnContactLookup) {
          detailId = options.switchOnContactLookup;
        }
        return contactButton;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.job-detail-body .job-label-list li') return [];
      const matchingHrNodes = hrNodesForSelector(selector);
      if (matchingHrNodes.length) return matchingHrNodes;
      if (selector === 'a, button, span') {
        return options.hideContactAction ? [] : [contactButton];
      }
      return [];
    },
    contains(element) {
      return element === contactButton;
    }
  };
  const description = {
    innerText: '目标职位描述',
    textContent: '目标职位描述'
  };
  const staleHeading = { textContent: '旧岗位' };
  const staleDescription = {
    innerText: '旧职位描述',
    textContent: '旧职位描述'
  };
  const staleDetailRoot = {
    offsetParent: null,
    querySelector(selector) {
      if (selector === '.job-detail-header .job-name') return staleHeading;
      if (selector === '.job-detail-body .desc') return staleDescription;
      if (selector.includes('/job_detail/')) {
        return { href: 'https://www.zhipin.com/job_detail/stale-job.html' };
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.job-detail-body .job-label-list li') return [];
      return [];
    },
    contains() {
      return false;
    }
  };

  const document = {
    body: { innerText: '' },
    querySelector(selector) {
      if (selector === '.job-detail-header .job-name') return heading;
      if (selector === '.job-detail-container') {
        return options.includeStaleDetail ? staleDetailRoot : detailRoot;
      }
      if (selector === '.job-detail-body .desc') return description;
      if (selector === BOSS_SELECTORS.jobs.immediateChatBtn) {
        if (options.foreignContactAction) return foreignContactButton;
        if (options.switchOnContactLookup) {
          detailId = options.switchOnContactLookup;
        }
        return options.hideContactAction ? null : contactButton;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.job-detail-container') {
        return options.includeStaleDetail
          ? [staleDetailRoot, detailRoot]
          : [detailRoot];
      }
      if (selector === '.job-detail-body .job-label-list li') return [];
      if (selector === BOSS_SELECTORS.jobs.jobCard) return [];
      if (selector === '.greet-boss-dialog') {
        return showGreetingResult ? [greetingResultDialog] : [];
      }
      if (selector === 'a, button, span, div[role="button"]') {
        return showContinue ? [continueButton] : [];
      }
      if (selector === '.boss-dialog .close, .dialog-wrap .close, [class*="dialog"] .icon-close, .close-btn') {
        return (showContinue || showGreetingResult) && options.continueDialogHasClose
          ? [continueCloseButton]
          : [];
      }
      if (selector === 'a, button, span, div') {
        return showContinue
          ? (options.nestedContinueText
            ? [continueButton, continueTextNode]
            : [continueButton])
          : [];
      }
      if (selector === 'a, button, span') {
        if (options.foreignContactAction) {
          return [foreignContactButton, contactButton];
        }
        if (options.hideContactAction) {
          return showContinue ? [continueButton] : [];
        }
        return showContinue ? [continueButton, contactButton] : [contactButton];
      }
      return [];
    }
  };

  const context = {
    console,
    URL,
    JobDescription,
    SELECTORS: BOSS_SELECTORS,
    Humanize: {
      async humanClick(element, clickOptions) {
        const stages = ['mouseover', 'mousedown', 'mouseup', 'click'];
        for (const stage of stages) {
          if (typeof options.onHumanClickBeforeDispatch === 'function') {
            options.onHumanClickBeforeDispatch(element, {
              stage,
              setDetailId(value) {
                detailId = value;
              },
              setDetailHrName(value) {
                detailHrName = value;
              },
              setShowContinue(value) {
                showContinue = value === true;
              }
            });
          }
          if (clickOptions &&
              typeof clickOptions.beforeDispatch === 'function' &&
              clickOptions.beforeDispatch(element, stage) !== true) {
            return false;
          }
          if (stage === 'click') {
            element.click();
            return true;
          }
        }
        return false;
      },
      activityOk() {
        return true;
      },
      async humanScrollStep() {},
      async humanDelay() {}
    },
    location: {
      href: 'https://www.zhipin.com/web/geek/jobs'
    },
    sessionStorage: {
      setItem(key, value) {
        if (typeof options.onSessionWrite === 'function') {
          options.onSessionWrite(key, value);
        }
      }
    },
    document,
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            runtimeHandler = listener;
          }
        }
      }
    },
    Date: class FakeDate extends Date {
      static now() {
        fakeNow += 1000;
        return fakeNow;
      }
    },
    setTimeout(callback) {
      queueMicrotask(callback);
      return 1;
    },
    clearTimeout() {},
    setInterval(callback) {
      const id = ++intervalSequence;
      activeIntervals.add(id);
      const tick = () => {
        if (!activeIntervals.has(id)) return;
        queueMicrotask(() => {
          if (!activeIntervals.has(id)) return;
          callback();
          if (activeIntervals.has(id)) tick();
        });
      };
      tick();
      return id;
    },
    clearInterval(id) {
      activeIntervals.delete(id);
    }
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'content-search.js' });

  async function dispatch(message) {
    assert.equal(typeof runtimeHandler, 'function');
    return new Promise((resolve) => {
      const keepAlive = runtimeHandler(message, {}, resolve);
      assert.equal(keepAlive, true);
    });
  }

  return {
    dispatch,
    contactButton,
    foreignContactButton,
    continueButton,
    continueCloseButton,
    setDetailId(value) {
      detailId = value;
    },
    setDetailName(value) {
      detailName = value;
    }
  };
}

test('read-only Boss scanning never confirms a residual continue-chat dialog', async () => {
  const harness = createHarness({ showContinue: true });

  const response = await harness.dispatch({
    type: 'SCRAPE',
    count: 1,
    filterInactive: false,
    includeDescription: false
  });

  assert.equal(response.success, false);
  assert.equal(harness.continueButton.clickCount, 0);
});

test('Boss contact revalidates the stable job id immediately before the primary click', async () => {
  const harness = createHarness({
    detailId: 'target-job',
    switchOnContactLookup: 'other-job'
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(response.success, false);
  assert.equal(response.targetUncertain, true);
  assert.equal(response.externalActionPossible, false);
  assert.equal(harness.contactButton.clickCount, 0);
});

test('Boss contact aborts when the SPA changes target during the human click delay', async () => {
  const harness = createHarness({
    detailId: 'target-job',
    onHumanClickBeforeDispatch(element, { setDetailId }) {
      if ((element.textContent || '').trim() === '立即沟通') {
        setDetailId('other-job');
      }
    }
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(response.success, false);
  assert.equal(harness.contactButton.clickCount, 0);
});

test('Boss contact aborts when the HR changes under the same job during the human click delay', async () => {
  const harness = createHarness({
    detailId: 'target-job',
    detailHrName: '张女士 刚刚活跃',
    onHumanClickBeforeDispatch(element, { setDetailHrName }) {
      if ((element.textContent || '').trim() === '立即沟通') {
        setDetailHrName('李女士');
      }
    }
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位',
      hrName: '张女士'
    }
  });

  assert.equal(response.success, false);
  assert.equal(harness.contactButton.clickCount, 0);
});

test('Boss contact requires the HR identity to be readable from the verified detail panel', async () => {
  const harness = createHarness({
    detailId: 'target-job',
    detailHrName: ''
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位',
      hrName: '张女士'
    }
  });

  assert.equal(response.success, false);
  assert.equal(response.targetUncertain, true);
  assert.equal(response.externalActionPossible, false);
  assert.equal(harness.contactButton.clickCount, 0);
});

test('Boss contact reads the live job-boss-info recruiter from the verified detail panel', async () => {
  let handoff = null;
  const harness = createHarness({
    detailId: 'target-job',
    showContinueAfterContact: true,
    detailHrNodes: [{
      selector: '.job-boss-info h2.name',
      text: '程女士 刚刚活跃'
    }],
    onSessionWrite(key, value) {
      if (key === '__job_contact_expected__') handoff = JSON.parse(value);
    }
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(harness.contactButton.clickCount, 1);
  assert.equal(handoff.hrName, '程女士');
});

test('Boss contact refuses conflicting recruiter identities in the same verified detail panel', async () => {
  let handoff = null;
  const harness = createHarness({
    detailId: 'target-job',
    detailHrNodes: [
      { selector: '.job-boss-info h2.name', text: '张女士' },
      { selector: '.job-boss-info .name', text: '李女士' }
    ],
    onSessionWrite(key, value) {
      if (key === '__job_contact_expected__') handoff = JSON.parse(value);
    }
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(response.success, false);
  assert.equal(response.targetUncertain, true);
  assert.equal(response.externalActionPossible, false);
  assert.equal(harness.contactButton.clickCount, 0);
  assert.equal(handoff, null);
});

test('Boss contact deduplicates equivalent recruiter nodes in the verified detail panel', async () => {
  let handoff = null;
  const harness = createHarness({
    detailId: 'target-job',
    showContinueAfterContact: true,
    detailHrNodes: [
      { selector: '.job-boss-info h2.name', text: '张女士 刚刚活跃' },
      { selector: '.job-boss-info .name', text: '张女士' }
    ],
    onSessionWrite(key, value) {
      if (key === '__job_contact_expected__') handoff = JSON.parse(value);
    }
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(harness.contactButton.clickCount, 1);
  assert.equal(handoff.hrName, '张女士');
});

test('Boss contact removes live recruiter activity suffix variants before handoff', async () => {
  const activitySuffixes = [
    '2月内活跃',
    '2周内活跃',
    '近半年活跃',
    '4月前活跃'
  ];
  for (const suffix of activitySuffixes) {
    let handoff = null;
    const harness = createHarness({
      detailId: 'target-job',
      showContinueAfterContact: true,
      detailHrNodes: [{
        selector: '.job-boss-info h2.name',
        text: '张女士 ' + suffix
      }],
      onSessionWrite(key, value) {
        if (key === '__job_contact_expected__') handoff = JSON.parse(value);
      }
    });

    const response = await harness.dispatch({
      type: 'GO_CHAT',
      job: {
        id: 'target-job',
        encryptJobId: 'target-job',
        name: '目标岗位'
      }
    });

    assert.equal(response.success, true, suffix + ': ' + JSON.stringify(response));
    assert.equal(harness.contactButton.clickCount, 1, suffix);
    assert.equal(handoff.hrName, '张女士', suffix);
  }
});

test('Boss contact does not dispatch click when an unknown continue dialog appears during human delay', async () => {
  const harness = createHarness({
    detailId: 'target-job',
    onHumanClickBeforeDispatch(element, { setShowContinue }) {
      if ((element.textContent || '').trim() === '立即沟通') {
        setShowContinue(true);
      }
    }
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(response.success, false);
  assert.equal(harness.contactButton.clickCount, 0);
  assert.equal(harness.continueButton.clickCount, 0);
});

test('Boss contact reports an unknown result when evidence changes after mousedown', async () => {
  const harness = createHarness({
    detailId: 'target-job',
    onHumanClickBeforeDispatch(element, { stage, setShowContinue }) {
      if ((element.textContent || '').trim() === '立即沟通' &&
          stage === 'mouseup') {
        setShowContinue(true);
      }
    }
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(response.success, false);
  assert.equal(response.sendResultUnknown, true);
  assert.equal(response.externalActionPossible, true);
  assert.equal(harness.contactButton.clickCount, 0);
  assert.equal(harness.continueButton.clickCount, 0);
});

test('Boss contact never treats a residual continue-chat dialog as its primary action', async () => {
  const harness = createHarness({
    detailId: 'target-job',
    showContinue: true,
    hideContactAction: true
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(response.success, false);
  assert.equal(response.targetUncertain, true);
  assert.equal(response.externalActionPossible, false);
  assert.equal(harness.continueButton.clickCount, 0);
});

test('Boss contact never confirms a continue-chat dialog that was already visible before contact', async () => {
  const harness = createHarness({
    detailId: 'target-job',
    showContinue: true,
    keepResidualContinueAfterContact: true
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(harness.contactButton.clickCount, 0);
  assert.equal(harness.continueButton.clickCount, 0);
  assert.equal(response.success, false);
  assert.equal(response.targetUncertain, true);
  assert.equal(response.externalActionPossible, false);
});

test('Boss contact never closes a residual greeting result dialog before ownership is proven', async () => {
  const harness = createHarness({
    detailId: 'target-job',
    showContinue: true,
    continueDialogHasClose: true
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(response.success, false);
  assert.equal(response.targetUncertain, true);
  assert.equal(response.externalActionPossible, false);
  assert.equal(harness.contactButton.clickCount, 0);
  assert.equal(harness.continueButton.clickCount, 0);
  assert.equal(harness.continueCloseButton.clickCount, 0);
});

test('Boss contact never closes or contacts behind a greeting result whose action is not mounted yet', async () => {
  const harness = createHarness({
    detailId: 'target-job',
    showGreetingDialogWithoutAction: true,
    continueDialogHasClose: true
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(response.success, false);
  assert.equal(response.targetUncertain, true);
  assert.equal(response.externalActionPossible, false);
  assert.equal(harness.contactButton.clickCount, 0);
  assert.equal(harness.continueButton.clickCount, 0);
  assert.equal(
    harness.continueCloseButton.clickCount,
    0,
    '已发送结果弹窗即使尚无可读动作，也不能由通用弹窗清理关闭'
  );
});

test('Boss contact protects greet-boss-dialog even when container offsetParent is null', async () => {
  const harness = createHarness({
    detailId: 'target-job',
    showGreetingDialogWithoutAction: true,
    continueDialogHasClose: true,
    greetingDialogOffsetParentNull: true
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(response.success, false);
  assert.equal(response.targetUncertain, true);
  assert.equal(harness.contactButton.clickCount, 0);
  assert.equal(
    harness.continueCloseButton.clickCount,
    0,
    '容器无 offsetParent 时也不能点掉成功回执的 ×'
  );
});

test('Boss contact confirms the new greeting result instead of closing it generically', async () => {
  const harness = createHarness({
    detailId: 'target-job',
    showContinueAfterContact: true,
    continueDialogHasClose: true
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.navigated, true);
  assert.equal(harness.contactButton.clickCount, 1);
  assert.equal(harness.continueButton.clickCount, 1);
  assert.equal(harness.continueCloseButton.clickCount, 0);
});

test('Boss contact treats nested continue text as one dialog action', async () => {
  const harness = createHarness({
    detailId: 'target-job',
    showContinueAfterContact: true,
    nestedContinueText: true
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(response.navigated, true);
  assert.equal(harness.continueButton.clickCount, 1);
});

test('Boss contact revalidates the stable job id before confirming continue-chat', async () => {
  const harness = createHarness({
    detailId: 'target-job',
    showContinueAfterContact: true,
    onContactClick({ setDetailId }) {
      setDetailId('other-job');
    }
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(harness.contactButton.clickCount, 1);
  assert.equal(harness.continueButton.clickCount, 0);
  assert.equal(response.success, false);
  assert.equal(response.targetUncertain, true);
  assert.equal(response.externalActionPossible, true);
});

test('Boss detail reads the visible target panel without mixing a hidden stale panel', async () => {
  const harness = createHarness({
    detailId: 'target-job',
    includeStaleDetail: true
  });

  const response = await harness.dispatch({
    type: 'OPEN_JD',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.match(response.jd, /目标职位描述/);
  assert.doesNotMatch(response.jd, /旧职位描述/);
});

test('Boss contact clicks only the action owned by the verified detail panel', async () => {
  const harness = createHarness({
    detailId: 'target-job',
    showContinueAfterContact: true,
    foreignContactAction: true
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(harness.contactButton.clickCount, 1);
  assert.equal(harness.foreignContactButton.clickCount, 0);
});

test('Boss contact carries the HR from the verified detail panel into chat handoff', async () => {
  let handoff = null;
  const harness = createHarness({
    detailId: 'target-job',
    showContinueAfterContact: true,
    detailHrName: '张女士 刚刚活跃',
    onSessionWrite(key, value) {
      if (key === '__job_contact_expected__') handoff = JSON.parse(value);
    }
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位',
      company: '目标公司',
      hrName: ''
    }
  });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(handoff.hrName, '张女士');
});

test('Boss contact reads company from boss-info-attr when the list card had no company', async () => {
  let handoff = null;
  const harness = createHarness({
    detailId: 'target-job',
    showContinueAfterContact: true,
    detailHrNodes: [{
      selector: '.job-boss-info h2.name',
      text: '吕程 本月活跃'
    }],
    detailCompanyAttr: '吉林省萌敬商贸 · 人事',
    onSessionWrite(key, value) {
      if (key === '__job_contact_expected__') handoff = JSON.parse(value);
    }
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '双休早10晚5跨境电商（欢迎小白）',
      company: '',
      hrName: ''
    }
  });

  assert.equal(response.success, true, JSON.stringify(response));
  assert.equal(handoff.hrName, '吕程');
  assert.equal(handoff.company, '吉林省萌敬商贸');
});

test('Boss contact never reports success without a result receipt or chat navigation', async () => {
  const harness = createHarness({
    detailId: 'target-job'
  });

  const response = await harness.dispatch({
    type: 'GO_CHAT',
    job: {
      id: 'target-job',
      encryptJobId: 'target-job',
      name: '目标岗位'
    }
  });

  assert.equal(harness.contactButton.clickCount, 1);
  assert.equal(response.success, false);
  assert.equal(response.sendResultUnknown, true);
  assert.equal(response.externalActionPossible, true);
  assert.match(response.error, /AI 托管未登记/);
});
