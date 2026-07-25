const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.resolve(__dirname, '../src/humanize.js'),
  'utf8'
);

class FakeMouseEvent {
  constructor(type, options) {
    this.type = type;
    this.cancelable = !!(options && options.cancelable);
    this.defaultPrevented = false;
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
}

function loadHumanize() {
  const context = {
    MouseEvent: FakeMouseEvent,
    console,
    document: {},
    window: {},
    setTimeout(callback) {
      callback();
      return 1;
    }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.Humanize;
}

function clickableFixture(href, targetIsChild) {
  const events = [];
  const listeners = [];
  let listenerRuns = 0;
  let javascriptNavigationAttempts = 0;
  let currentHref = href;
  const anchor = {
    tagName: 'A',
    getAttribute(name) {
      if (name !== 'href') return null;
      return currentHref;
    },
    setAttribute(name, value) {
      if (name === 'href') currentHref = value;
    },
    removeAttribute(name) {
      if (name === 'href') currentHref = null;
    },
    addEventListener(type, fn, options) {
      listeners.push({ target: 'anchor', type, fn, options });
    },
    removeEventListener(type, fn, options) {
      for (let i = listeners.length - 1; i >= 0; i--) {
        const item = listeners[i];
        if (item.target === 'anchor' && item.type === type && item.fn === fn) {
          listeners.splice(i, 1);
        }
      }
    }
  };
  anchor.closest = () => anchor;

  const target = {
    closest() {
      return targetIsChild ? anchor : target;
    },
    getAttribute(name) {
      return targetIsChild ? null : anchor.getAttribute(name);
    },
    setAttribute(name, value) {
      if (!targetIsChild) anchor.setAttribute(name, value);
    },
    removeAttribute(name) {
      if (!targetIsChild) anchor.removeAttribute(name);
    },
    addEventListener(type, fn, options) {
      listeners.push({ target: 'el', type, fn, options });
    },
    removeEventListener(type, fn, options) {
      for (let i = listeners.length - 1; i >= 0; i--) {
        const item = listeners[i];
        if (item.target === 'el' && item.type === type && item.fn === fn) {
          listeners.splice(i, 1);
        }
      }
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 100, height: 40 };
    },
    scrollIntoView() {},
    dispatchEvent(event) {
      listeners
        .filter((item) => item.type === event.type)
        .forEach((item) => item.fn(event));
      events.push(event);
      if (event.type === 'click') {
        listenerRuns++;
        const activeHref = anchor.getAttribute('href') || '';
        if (/^\s*javascript\s*:/i.test(activeHref) && !event.defaultPrevented) {
          javascriptNavigationAttempts++;
        }
      }
      return !event.defaultPrevented;
    }
  };
  if (!targetIsChild) {
    target.tagName = 'A';
    target.getAttribute = (name) => anchor.getAttribute(name);
    target.setAttribute = (name, value) => anchor.setAttribute(name, value);
    target.removeAttribute = (name) => anchor.removeAttribute(name);
  }

  return {
    events,
    target,
    anchor,
    get listenerRuns() { return listenerRuns; },
    get javascriptNavigationAttempts() { return javascriptNavigationAttempts; },
    get href() { return currentHref; }
  };
}

test('cancels a javascript URL default action while still dispatching click listeners', async () => {
  const fixture = clickableFixture('javascript:void(0)', true);

  const clicked = await loadHumanize().humanClick(fixture.target);
  const clickEvent = fixture.events.find((event) => event.type === 'click');

  assert.equal(clicked, true);
  assert.equal(fixture.listenerRuns, 1);
  assert.equal(clickEvent.defaultPrevented, true);
  assert.equal(fixture.javascriptNavigationAttempts, 0);
  assert.equal(fixture.href, 'javascript:void(0)');
});

test('temporarily removes javascript href during click so CSP cannot run the URL', async () => {
  const fixture = clickableFixture('javascript:void(0)', false);
  let hrefWhileClicking = 'unset';
  const originalDispatch = fixture.target.dispatchEvent.bind(fixture.target);
  fixture.target.dispatchEvent = (event) => {
    if (event.type === 'click') hrefWhileClicking = fixture.anchor.getAttribute('href');
    return originalDispatch(event);
  };

  await loadHumanize().humanClick(fixture.target);

  assert.equal(hrefWhileClicking, null);
  assert.equal(fixture.href, 'javascript:void(0)');
  assert.equal(fixture.javascriptNavigationAttempts, 0);
});

test('does not cancel an ordinary HTTPS link default action', async () => {
  const fixture = clickableFixture('https://www.zhipin.com/job_detail/example.html', false);

  await loadHumanize().humanClick(fixture.target);
  const clickEvent = fixture.events.find((event) => event.type === 'click');

  assert.equal(clickEvent.defaultPrevented, false);
  assert.equal(fixture.href, 'https://www.zhipin.com/job_detail/example.html');
});
