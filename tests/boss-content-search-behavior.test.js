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
  let showContinue = options.showContinue === true;
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
  const contactButton = createVisibleButton('立即沟通', () => {
    showContinue = options.keepResidualContinueAfterContact === true
      ? true
      : options.showContinueAfterContact === true;
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
  const detailRoot = {
    offsetParent: {},
    querySelector(selector) {
      if (selector === '.job-detail-header .job-name') return heading;
      if (selector === '.job-detail-body .desc') return description;
      if (selector === '.boss-name') {
        return { textContent: detailHrName };
      }
      if (selector.includes('/job_detail/')) {
        return {
          get href() {
            return `https://www.zhipin.com/job_detail/${detailId}.html`;
          }
        };
      }
      if (selector === '#contact-action') {
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
      if (selector === '#contact-action') {
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
      if (selector === '.job-card') return [];
      if (selector === 'a, button, span, div[role="button"]') {
        return showContinue ? [continueButton] : [];
      }
      if (selector === 'a, button, span, div') {
        return showContinue ? [continueButton] : [];
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
    SELECTORS: {
      jobs: {
        jobCard: '.job-card',
        jobName: '.job-name',
        jobSalary: '.job-salary',
        tagList: '.tag',
        bossName: '.boss-name',
        bossActive: '.boss-active',
        immediateChatBtn: '#contact-action'
      }
    },
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
  assert.equal(response.selectorUnavailable, true);
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
