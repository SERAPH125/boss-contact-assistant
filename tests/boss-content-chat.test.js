const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const scripts = [
  'src/platform/boss/selectors.js',
  'src/message-send.js',
  'src/platform/boss/peer-identity.js',
  'src/platform/boss/conversation-reader.js',
  'src/platform/boss/content-chat.js'
];

const selectorsSource = fs.readFileSync(path.join(root, 'src/platform/boss/selectors.js'), 'utf8');
const selectorsContext = { globalThis: {} };
vm.runInNewContext(selectorsSource, selectorsContext);
const BOSS_SELECTORS = selectorsContext.globalThis.SELECTORS;

const S = {
  conversationLink: BOSS_SELECTORS.chat.conversationLink,
  activeUser: BOSS_SELECTORS.chat.activeUser,
  messageList: BOSS_SELECTORS.chat.messageList,
  messageItem: BOSS_SELECTORS.chat.messageItem,
  incoming: BOSS_SELECTORS.chat.messageIncoming,
  outgoing: BOSS_SELECTORS.chat.messageOutgoing,
  text: BOSS_SELECTORS.chat.messageText,
  time: BOSS_SELECTORS.chat.messageTime,
  header: BOSS_SELECTORS.chat.activeContext,
  input: BOSS_SELECTORS.chat.chatInput,
  button: BOSS_SELECTORS.chat.btnSend
};

class FakeEvent {
  constructor(type, options) {
    this.type = type;
    Object.assign(this, options || {});
  }
}

class FakeElement {
  constructor(options = {}) {
    this.tagName = (options.tagName || 'DIV').toUpperCase();
    this.id = options.id || '';
    this.className = options.className || '';
    this.dataset = { ...(options.dataset || {}) };
    this.attributes = { ...(options.attributes || {}) };
    this.textContent = options.text || '';
    this.innerText = options.text || '';
    this.href = options.href || '';
    this.children = [];
    this.parentElement = null;
    this.offsetParent = options.visible === false ? null : {};
    this.isContentEditable = !!options.contenteditable;
    this.disabled = false;
    this.value = '';
    this._selectors = new Set(options.selectors || []);
    this._onDispatch = null;
    this._onClick = null;
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name)
    };
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  matches(selector) {
    if (this._selectors.has(selector)) return true;
    const parts = String(selector || '').split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) return parts.some((part) => this.matches(part));
    for (const owned of this._selectors) {
      if (owned === selector) return true;
      const ownedParts = String(owned).split(',').map((part) => part.trim());
      if (ownedParts.indexOf(selector) !== -1) return true;
    }
    if (selector === 'li.active') {
      return this.tagName === 'LI' && this.className.split(/\s+/).includes('active');
    }
    return false;
  }

  contains(other) {
    let current = other;
    while (current) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      node.children.forEach((child) => {
        if (child.matches(selector)) found.push(child);
        visit(child);
      });
    };
    visit(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getAttribute(name) {
    if (name === 'contenteditable') return this.isContentEditable ? 'true' : null;
    if (name === 'data-time' && Object.hasOwn(this.dataset, 'time')) return this.dataset.time;
    if (name === 'datetime' && Object.hasOwn(this.attributes, 'datetime')) return this.attributes.datetime;
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  focus() {
    if (this._onFocus) this._onFocus();
  }

  dispatchEvent(event) {
    if (this._onDispatch) this._onDispatch(event);
    return true;
  }

  click() {
    if (this._onClick) this._onClick();
  }
}

function createHarness(options = {}) {
  const documentRoot = new FakeElement();
  const body = { innerText: options.bodyText || '' };
  const activeList = documentRoot.append(new FakeElement());
  const activeItem = activeList.append(new FakeElement({
    tagName: 'li',
    className: 'active',
    text: options.activeText === undefined ? '示例公司 示例岗位' : options.activeText,
    dataset: Object.hasOwn(options, 'activeDataset')
      ? options.activeDataset
      : { conversationId: 'conv1' },
    selectors: [S.activeUser]
  }));
  const activeLink = activeItem.append(new FakeElement({
    tagName: 'a',
    text: options.activeText === undefined ? '示例公司 示例岗位' : options.activeText,
    href: Object.hasOwn(options, 'activeHref')
      ? options.activeHref
      : 'https://www.zhipin.com/web/geek/chat?conversationId=conv1',
    dataset: Object.hasOwn(options, 'activeLinkDataset')
      ? options.activeLinkDataset
      : { conversationId: 'conv1' },
    selectors: [S.conversationLink]
  }));

  const pane = documentRoot.append(new FakeElement());
  pane.append(new FakeElement({
    text: options.headerText === undefined ? '示例公司 示例岗位' : options.headerText,
    selectors: [S.header, '.chat-info']
  }));
  const container = pane.append(new FakeElement({
    id: 'message-pane-1',
    dataset: Object.hasOwn(options, 'containerDataset')
      ? options.containerDataset
      : (options.ownership === 'none' ? {} : { conversationId: 'conv1' }),
    selectors: [S.messageList]
  }));
  const input = pane.append(new FakeElement({
    id: 'chat-input',
    className: 'chat-input',
    contenteditable: true,
    selectors: [S.input]
  }));
  const button = pane.append(new FakeElement({
    tagName: 'button',
    className: 'btn-send',
    selectors: [S.button]
  }));

  if (options.ownership === 'aria-controls') {
    container.dataset = {};
    activeItem.setAttribute('aria-controls', container.id);
  } else if (options.ownership === 'aria-labelledby') {
    container.dataset = {};
    activeItem.id = 'active-conversation-1';
    container.setAttribute('aria-labelledby', activeItem.id);
  }

  const state = {
    documentRoot,
    body,
    activeItem,
    activeLink,
    pane,
    container,
    input,
    button,
    listener: null,
    externalActions: 0,
    nextMessage: 1000
  };

  state.addMessage = function addMessage(config = {}, target = container) {
    const index = state.nextMessage++;
    const direction = config.direction || 'incoming';
    const directionSelectors = direction === 'incoming'
      ? [S.incoming]
      : (direction === 'outgoing' ? [S.outgoing] : []);
    const item = target.append(new FakeElement({
      dataset: {
        messageId: Object.hasOwn(config, 'id') ? config.id : 'm' + index
      },
      selectors: [S.messageItem].concat(directionSelectors)
    }));
    item.append(new FakeElement({
      text: config.text === undefined ? '消息 ' + index : config.text,
      selectors: [S.text]
    }));
    item.append(new FakeElement({
      dataset: {
        time: String(config.at === undefined ? 1700000000000 + index : config.at)
      },
      selectors: [S.time]
    }));
    return item;
  };

  const initialMessages = options.messages || [
    { id: 'initial-incoming', direction: 'incoming', text: '还在看机会吗' }
  ];
  initialMessages.forEach((message) => state.addMessage(message));

  state.addContainer = function addContainer(config = {}) {
    const extraPane = documentRoot.append(new FakeElement());
    const extra = extraPane.append(new FakeElement({
      id: config.id || 'message-pane-extra',
      visible: config.visible,
      dataset: { conversationId: config.conversationId || 'conv-extra' },
      selectors: [S.messageList]
    }));
    (config.messages || []).forEach((message) => state.addMessage(message, extra));
    return extra;
  };

  state.addActiveLink = function addActiveLink(config = {}) {
    const item = activeList.append(new FakeElement({
      tagName: 'li',
      className: 'active',
      text: config.text || '另一个会话',
      dataset: { conversationId: config.conversationId || 'conv-extra' },
      selectors: [S.activeUser]
    }));
    return item.append(new FakeElement({
      tagName: 'a',
      text: config.text || '另一个会话',
      href: 'https://www.zhipin.com/web/geek/chat?conversationId=' +
        (config.conversationId || 'conv-extra'),
      dataset: { conversationId: config.conversationId || 'conv-extra' },
      selectors: [S.conversationLink]
    }));
  };

  state.switchConversation = function switchConversation(id) {
    activeItem.dataset.conversationId = id;
    activeLink.dataset.conversationId = id;
    activeLink.href = 'https://www.zhipin.com/web/geek/chat?conversationId=' + id;
    container.dataset.conversationId = id;
  };

  const contextObject = {
    console,
    URL,
    Date,
    Promise,
    Array,
    Set,
    Uint8Array,
    Object,
    Number,
    String,
    JSON,
    Math,
    RegExp,
    Error,
    Event: FakeEvent,
    InputEvent: FakeEvent,
    KeyboardEvent: FakeEvent,
    HTMLInputElement: function HTMLInputElement() {},
    HTMLTextAreaElement: function HTMLTextAreaElement() {},
    File: function File() {},
    DataTransfer: function DataTransfer() {
      this.items = { add() {} };
      this.files = [];
    },
    atob() { return ''; },
    getComputedStyle(element) {
      return { position: element.offsetParent === null ? 'static' : 'relative' };
    },
    setTimeout(callback) {
      Promise.resolve().then(callback);
      return 1;
    },
    clearTimeout() {},
    location: {
      href: options.locationHref || 'https://www.zhipin.com/web/geek/chat'
    },
    performance: {
      getEntriesByType(type) {
        if (type !== 'resource') return [];
        return Array.isArray(options.historyResources) ? options.historyResources : [];
      }
    },
    sessionStorage: {
      getItem() { return null; }
    },
    document: {
      body,
      visibilityState: options.visibilityState || 'hidden',
      querySelectorAll(selector) {
        return documentRoot.querySelectorAll(selector);
      },
      querySelector(selector) {
        return documentRoot.querySelector(selector);
      }
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            state.listener = listener;
          }
        }
      }
    },
    async fetch(url) {
      const href = String(url || '');
      if (href.indexOf('getGeekFriendList.json') === -1) {
        return { ok: false, status: 404, async json() { return {}; } };
      }
      if (options.friendListError) {
        throw new Error('network');
      }
      if (options.friendListUnavailable) {
        return { ok: false, status: 500, async json() { return { code: 1 }; } };
      }
      const friends = options.friends || [{
        encryptUid: options.peerId || 'conv1',
        name: '示例HR',
        brandName: '示例公司'
      }];
      return {
        ok: true,
        status: 200,
        async json() {
          return { code: 0, zpData: { result: friends } };
        }
      };
    }
  };
  contextObject.window = contextObject;
  contextObject.self = contextObject;
  state.setVisibility = function setVisibility(value) {
    contextObject.document.visibilityState = value;
  };
  const context = vm.createContext(contextObject);
  scripts.forEach((relativePath) => {
    vm.runInContext(
      fs.readFileSync(path.join(root, relativePath), 'utf8'),
      context,
      { filename: relativePath }
    );
  });

  state.dispatch = function dispatch(message) {
    return new Promise((resolve, reject) => {
      let responded = false;
      const timeout = setTimeout(() => {
        if (!responded) reject(new Error('content response timeout'));
      }, 1000);
      state.listener(message, {}, (response) => {
        responded = true;
        clearTimeout(timeout);
        resolve(response);
      });
    });
  };
  state.expected = { company: '示例公司', name: '示例岗位' };
  state.ref = {
    conversationId: 'conv1',
    url: 'https://www.zhipin.com/web/geek/chat?conversationId=conv1'
  };
  return state;
}

test('GET owns the only visible message container and ignores a hidden decoy', async () => {
  const h = createHarness();
  h.addContainer({
    visible: false,
    messages: [{ id: 'hidden-incoming', text: '隐藏诱饵' }]
  });

  const result = await h.dispatch({
    type: 'GET_ACTIVE_CONVERSATION_REF',
    expected: h.expected
  });

  assert.equal(result.success, true);
  assert.equal(result.baselineIncomingFingerprint, 'id:initial-incoming');
});

test('GET rejects multiple visible links, containers, and missing ownership', async () => {
  const secondContainer = createHarness();
  secondContainer.addContainer({ visible: true });
  assert.equal((await secondContainer.dispatch({
    type: 'GET_ACTIVE_CONVERSATION_REF',
    expected: secondContainer.expected
  })).errorCode, 'TARGET_UNCERTAIN');

  const secondLink = createHarness();
  secondLink.addActiveLink();
  assert.equal((await secondLink.dispatch({
    type: 'GET_ACTIVE_CONVERSATION_REF',
    expected: secondLink.expected
  })).errorCode, 'TARGET_UNCERTAIN');

  const unowned = createHarness({ ownership: 'none' });
  assert.equal((await unowned.dispatch({
    type: 'GET_ACTIVE_CONVERSATION_REF',
    expected: unowned.expected
  })).errorCode, 'TARGET_UNCERTAIN');
});

test('GET accepts explicit ARIA ownership and scopes identity to that pane', async () => {
  const ariaOwned = createHarness({ ownership: 'aria-controls' });
  assert.equal((await ariaOwned.dispatch({
    type: 'GET_ACTIVE_CONVERSATION_REF',
    expected: ariaOwned.expected
  })).success, true);

  const leakedIdentity = createHarness({
    activeText: '其他公司',
    headerText: '其他公司'
  });
  leakedIdentity.documentRoot.append(new FakeElement({
    text: '示例公司 示例岗位',
    selectors: [S.header, '.chat-info']
  }));
  assert.equal((await leakedIdentity.dispatch({
    type: 'GET_ACTIVE_CONVERSATION_REF',
    expected: leakedIdentity.expected
  })).errorCode, 'TARGET_UNCERTAIN');
});

test('READ requires an explicit string baseline', async () => {
  const h = createHarness();
  const omitted = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: h.expected,
    conversationRef: h.ref
  });
  const nonString = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: h.expected,
    conversationRef: h.ref,
    lastFingerprint: null
  });

  assert.equal(omitted.errorCode, 'BASELINE_REQUIRED');
  assert.equal(nonString.errorCode, 'BASELINE_REQUIRED');
});

test('GET returns an empty incoming sentinel that READ accepts unchanged', async () => {
  const h = createHarness({
    messages: [{ id: 'only-outgoing', direction: 'outgoing', text: '我方消息' }]
  });

  const getResult = await h.dispatch({
    type: 'GET_ACTIVE_CONVERSATION_REF',
    expected: h.expected
  });
  const readResult = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: h.expected,
    conversationRef: getResult.conversationRef,
    lastFingerprint: getResult.baselineIncomingFingerprint
  });

  assert.equal(getResult.success, true);
  assert.equal(getResult.baselineIncomingFingerprint, '');
  assert.equal(readResult.success, true);
  assert.deepEqual(Array.from(readResult.messages), []);
  assert.equal(readResult.baselineIncomingFingerprint, '');
});

test('CAPTURE registers the owned active conversation without expected identity', async () => {
  const h = createHarness({
    activeText: '示例公司 示例岗位',
    headerText: '其他无关标题',
    peerId: 'peer~~uid1',
    friends: [{ encryptUid: 'peer~~uid1', uid: 'conv1', name: '示例HR' }]
  });
  const result = await h.dispatch({ type: 'CAPTURE_ACTIVE_CONVERSATION' });
  assert.equal(result.success, true);
  assert.equal(result.conversationRef.conversationId, 'peer~~uid1');
  assert.equal(
    result.conversationRef.url,
    'https://www.zhipin.com/web/geek/chat?uid=peer~~uid1'
  );
  assert.deepEqual(Array.from(result.conversationRef.aliases || []), ['conv1']);
  assert.equal(result.peerSource, 'encryptUid');
  assert.equal(result.baselineIncomingFingerprint, 'id:initial-incoming');
  assert.ok(result.company || result.position || result.hrName);
});

test('CAPTURE supports modern chat-record DOM without geek/chat anchors', async () => {
  const peerId = 'peer~~modern1';
  const documentRoot = new FakeElement();
  const body = { innerText: '' };
  const friend = documentRoot.append(new FakeElement({
    className: 'friend-content active',
    text: '杭州云禾致远商贸 江女士 跨境电商运营',
    selectors: [S.conversationLink, S.activeUser]
  }));
  const pane = documentRoot.append(new FakeElement());
  pane.append(new FakeElement({
    text: '杭州云禾致远商贸',
    selectors: ['.chat-info']
  }));
  pane.append(new FakeElement({
    className: 'position-name',
    text: '跨境电商运营 9-14K 杭州',
    selectors: ['.position-name']
  }));
  const container = pane.append(new FakeElement({
    className: 'chat-record',
    selectors: [S.messageList]
  }));
  const outgoing = container.append(new FakeElement({
    className: 'message-item item-myself',
    selectors: [S.messageItem, S.outgoing]
  }));
  outgoing.append(new FakeElement({
    text: '您好，我对这个岗位很感兴趣',
    selectors: [S.text]
  }));
  outgoing.append(new FakeElement({
    text: '已读',
    selectors: [S.time]
  }));
  const contextObject = {
    console,
    URL,
    Date,
    Promise,
    Array,
    Set,
    Uint8Array,
    Object,
    Number,
    String,
    JSON,
    Math,
    RegExp,
    Error,
    Event: FakeEvent,
    InputEvent: FakeEvent,
    KeyboardEvent: FakeEvent,
    HTMLInputElement: function HTMLInputElement() {},
    HTMLTextAreaElement: function HTMLTextAreaElement() {},
    File: function File() {},
    DataTransfer: function DataTransfer() {
      this.items = { add() {} };
      this.files = [];
    },
    atob() { return ''; },
    getComputedStyle(element) {
      return { position: element.offsetParent === null ? 'static' : 'relative' };
    },
    setTimeout(callback) {
      Promise.resolve().then(callback);
      return 1;
    },
    clearTimeout() {},
    location: { href: 'https://www.zhipin.com/web/geek/chat' },
    performance: {
      getEntriesByType(type) {
        if (type !== 'resource') return [];
        return [{
          name: 'https://www.zhipin.com/wapi/zpchat/geek/historyMsg?bossId=' +
            encodeURIComponent(peerId) + '&page=1'
        }];
      }
    },
    sessionStorage: { getItem() { return null; } },
    document: {
      body,
      visibilityState: 'visible',
      querySelectorAll(selector) { return documentRoot.querySelectorAll(selector); },
      querySelector(selector) { return documentRoot.querySelector(selector); }
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) { contextObject._listener = listener; }
        }
      }
    },
    async fetch(url) {
      if (String(url || '').indexOf('getGeekFriendList.json') === -1) {
        return { ok: false, status: 404, async json() { return {}; } };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: 0,
            zpData: {
              result: [{
                encryptUid: peerId,
                name: '江女士',
                brandName: '杭州云禾致远商贸',
                jobName: '跨境电商运营'
              }]
            }
          };
        }
      };
    },
    _listener: null
  };
  contextObject.window = contextObject;
  contextObject.self = contextObject;
  const context = vm.createContext(contextObject);
  scripts.forEach((relativePath) => {
    vm.runInContext(
      fs.readFileSync(path.join(root, relativePath), 'utf8'),
      context,
      { filename: relativePath }
    );
  });
  void friend;
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), 1000);
    contextObject._listener({ type: 'CAPTURE_ACTIVE_CONVERSATION' }, {}, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
  });
  assert.equal(
    result.success,
    true,
    'CAPTURE modern DOM failed: ' + JSON.stringify(result)
  );
  assert.equal(result.conversationRef.conversationId, peerId);
  assert.equal(result.baselineIncomingFingerprint, '');
  assert.equal(result.position, '跨境电商运营 9-14K 杭州');
  assert.match(result.company + result.hrName, /云禾|江女士/);
});

test('CAPTURE rejects an existing incoming message without a reliable cursor', async () => {
  const h = createHarness({
    messages: [{
      id: '',
      direction: 'incoming',
      text: '三天前的历史消息',
      at: null
    }]
  });
  const result = await h.dispatch({ type: 'CAPTURE_ACTIVE_CONVERSATION' });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'MESSAGE_ORDER_UNCERTAIN');
});

test('CAPTURE rejects an unclassified history node beside a valid outgoing message', async () => {
  const h = createHarness({
    messages: [
      {
        id: 'known-outgoing',
        direction: 'outgoing',
        text: '历史回复'
      },
      {
        id: '',
        direction: 'unknown',
        text: '无法确认方向的历史节点',
        at: null
      }
    ]
  });
  const result = await h.dispatch({ type: 'CAPTURE_ACTIVE_CONVERSATION' });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'MESSAGE_ORDER_UNCERTAIN');
});

test('CAPTURE ignores a foreign resource that mimics the Boss history path', async () => {
  const h = createHarness({
    activeDataset: {},
    activeLinkDataset: {},
    activeHref: '',
    containerDataset: {},
    historyResources: [
      {
        name: 'https://www.zhipin.com/wapi/zpchat/geek/historyMsg?bossId=current-peer'
      },
      {
        name: 'https://cdn.example.invalid/wapi/zpchat/geek/historyMsg?bossId=stale-peer'
      }
    ],
    friends: [
      { encryptUid: 'current-peer', name: '示例HR', brandName: '示例公司' },
      { encryptUid: 'stale-peer', name: '其他HR', brandName: '其他公司' }
    ]
  });
  const result = await h.dispatch({ type: 'CAPTURE_ACTIVE_CONVERSATION' });
  assert.equal(result.success, true);
  assert.equal(result.conversationRef.conversationId, 'current-peer');
});

test('CAPTURE rejects ambiguous Boss history ids without independent ownership', async () => {
  const h = createHarness({
    activeDataset: {},
    activeLinkDataset: {},
    activeHref: '',
    containerDataset: {},
    historyResources: [
      {
        name: 'https://www.zhipin.com/wapi/zpchat/geek/historyMsg?bossId=older-peer'
      },
      {
        name: 'https://www.zhipin.com/wapi/zpchat/geek/historyMsg?bossId=current-peer'
      }
    ],
    friends: [
      { encryptUid: 'older-peer', name: '旧HR', brandName: '旧公司' },
      { encryptUid: 'current-peer', name: '示例HR', brandName: '示例公司' }
    ]
  });
  const result = await h.dispatch({ type: 'CAPTURE_ACTIVE_CONVERSATION' });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'TARGET_UNCERTAIN');
});

test('CAPTURE rejects malformed matching history resources instead of using an older id', async () => {
  const h = createHarness({
    activeDataset: {},
    activeLinkDataset: {},
    activeHref: '',
    containerDataset: {},
    historyResources: [
      {
        name: 'https://www.zhipin.com/wapi/zpchat/geek/historyMsg?bossId=older-peer'
      },
      {
        name: 'https://www.zhipin.com/wapi/zpchat/geek/historyMsg' +
          '?bossId=current-peer&bossId=other-peer'
      }
    ],
    friends: [
      { encryptUid: 'older-peer', name: '旧HR', brandName: '旧公司' },
      { encryptUid: 'current-peer', name: '示例HR', brandName: '示例公司' }
    ]
  });
  const result = await h.dispatch({ type: 'CAPTURE_ACTIVE_CONVERSATION' });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'TARGET_UNCERTAIN');
});

test('CAPTURE prefers the page uid over an older history resource', async () => {
  const h = createHarness({
    activeDataset: {},
    activeLinkDataset: {},
    activeHref: '',
    containerDataset: {},
    locationHref: 'https://www.zhipin.com/web/geek/chat?uid=current-peer',
    historyResources: [{
      name: 'https://www.zhipin.com/wapi/zpchat/geek/historyMsg?bossId=older-peer'
    }],
    friends: [
      { encryptUid: 'older-peer', name: '旧HR', brandName: '旧公司' },
      { encryptUid: 'current-peer', name: '示例HR', brandName: '示例公司' }
    ]
  });
  const result = await h.dispatch({ type: 'CAPTURE_ACTIVE_CONVERSATION' });
  assert.equal(result.success, true);
  assert.equal(result.conversationRef.conversationId, 'current-peer');
});

test('CAPTURE rejects when the active conversation has no identity text', async () => {
  const h = createHarness({ activeText: '', headerText: '' });
  const result = await h.dispatch({ type: 'CAPTURE_ACTIVE_CONVERSATION' });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'TARGET_UNCERTAIN');
});

test('CAPTURE fails closed when friend list cannot resolve encryptUid', async () => {
  const missing = createHarness({
    friends: [{ encryptUid: 'other-peer', name: '别人' }]
  });
  assert.equal((await missing.dispatch({ type: 'CAPTURE_ACTIVE_CONVERSATION' })).errorCode, 'PEER_ID_UNRESOLVED');

  const unavailable = createHarness({ friendListUnavailable: true });
  assert.equal(
    (await unavailable.dispatch({ type: 'CAPTURE_ACTIVE_CONVERSATION' })).errorCode,
    'PEER_LIST_UNAVAILABLE'
  );
});

test('PROBE_PEER_IDENTITY reports whether DOM id matches encryptUid', async () => {
  const h = createHarness({
    friends: [{ encryptUid: 'conv1', name: '示例HR' }]
  });
  const result = await h.dispatch({ type: 'PROBE_PEER_IDENTITY' });
  assert.equal(result.success, true);
  assert.equal(result.peerId, 'conv1');
  assert.equal(result.sameAsDom, true);
});

test('READ accepts DOM conversationId when it is an alias of the managed peerId', async () => {
  const h = createHarness();
  const result = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: h.expected,
    conversationRef: {
      conversationId: 'peer~~stable',
      url: 'https://www.zhipin.com/web/geek/chat?uid=peer~~stable',
      aliases: ['conv1']
    },
    lastFingerprint: 'id:initial-incoming'
  });
  assert.equal(result.success, true);
  assert.equal(result.conversationRef.conversationId, 'peer~~stable');
  assert.equal(result.conversationRef.url, 'https://www.zhipin.com/web/geek/chat?uid=peer~~stable');
});

test('READ rejects an outgoing fingerprint as an incoming baseline', async () => {
  const h = createHarness({
    messages: [
      { id: 'old-incoming', direction: 'incoming', text: '候选人消息' },
      { id: 'old-outgoing', direction: 'outgoing', text: '我方消息' }
    ]
  });

  const result = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: h.expected,
    conversationRef: h.ref,
    lastFingerprint: 'id:old-outgoing'
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'BASELINE_NOT_FOUND');
  assert.equal(result.messages, undefined);
});

test('READ pages more than twenty incoming messages without skipping the remainder', async () => {
  const messages = Array.from({ length: 25 }, (_, index) => ({
    id: 'page-' + index,
    direction: 'incoming',
    text: '分页消息 ' + index,
    at: 1700000000000 + index
  }));
  const h = createHarness({ messages });

  const first = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: h.expected,
    conversationRef: h.ref,
    lastFingerprint: ''
  });
  const second = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: h.expected,
    conversationRef: h.ref,
    lastFingerprint: first.baselineIncomingFingerprint
  });

  assert.deepEqual(Array.from(first.messages, (item) => item.id), messages.slice(0, 20).map((item) => item.id));
  assert.equal(first.baselineIncomingFingerprint, 'id:page-19');
  assert.deepEqual(Array.from(second.messages, (item) => item.id), messages.slice(20).map((item) => item.id));
  assert.equal(second.baselineIncomingFingerprint, 'id:page-24');
});

test('managed operations wrap login and block failures with stable error codes', async () => {
  const login = createHarness({
    locationHref: 'https://www.zhipin.com/web/user/login'
  });
  assert.equal((await login.dispatch({
    type: 'GET_ACTIVE_CONVERSATION_REF',
    expected: login.expected
  })).errorCode, 'LOGIN_REQUIRED');

  const blocked = createHarness({ bodyText: '请完成验证码' });
  assert.equal((await blocked.dispatch({
    type: 'GET_ACTIVE_CONVERSATION_REF',
    expected: blocked.expected
  })).errorCode, 'BOSS_BLOCKED');
});

test('managed read and send reject a user-visible tab at the content-script boundary', async () => {
  const h = createHarness({ visibilityState: 'visible' });
  h.input._onDispatch = () => { h.externalActions++; };
  h.button._onClick = () => { h.externalActions++; };

  const read = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: h.expected,
    conversationRef: h.ref,
    lastFingerprint: ''
  });
  const sent = await h.dispatch({
    type: 'SEND_MANAGED_REPLY',
    expected: h.expected,
    conversationRef: h.ref,
    draft: '好的',
    intentId: 'intent-1'
  });

  assert.deepEqual(
    { success: read.success, errorCode: read.errorCode },
    { success: false, errorCode: 'TARGET_UNCERTAIN' }
  );
  assert.deepEqual(
    { success: sent.success, errorCode: sent.errorCode },
    { success: false, errorCode: 'TARGET_UNCERTAIN' }
  );
  assert.equal(h.externalActions, 0);
});

test('SEND refuses Enter when the temporary tab becomes visible after draft fill', async () => {
  const h = createHarness({
    messages: [{ id: 'old-outgoing', direction: 'outgoing', text: '旧消息' }]
  });
  h.input._onDispatch = (event) => {
    if (event.type === 'input') h.setVisibility('visible');
    if (event.type === 'keydown' && event.key === 'Enter') h.externalActions++;
  };
  h.button._onClick = () => { h.externalActions++; };

  const result = await h.dispatch({
    type: 'SEND_MANAGED_REPLY',
    expected: h.expected,
    conversationRef: h.ref,
    draft: '确认收到'
  });

  assert.equal(result.errorCode, 'TARGET_UNCERTAIN');
  assert.equal(h.externalActions, 0);
});

test('SEND never clicks fallback after visibility changes following an attempted Enter', async () => {
  const h = createHarness({
    messages: [{ id: 'old-outgoing', direction: 'outgoing', text: '旧消息' }]
  });
  let buttonClicks = 0;
  h.input._onDispatch = (event) => {
    if (event.type !== 'keydown' || event.key !== 'Enter') return;
    h.externalActions++;
    h.setVisibility('visible');
  };
  h.button._onClick = () => {
    buttonClicks++;
    h.externalActions++;
  };

  const result = await h.dispatch({
    type: 'SEND_MANAGED_REPLY',
    expected: h.expected,
    conversationRef: h.ref,
    draft: '确认收到'
  });

  assert.equal(result.errorCode, 'SEND_RESULT_UNKNOWN');
  assert.equal(h.externalActions, 1);
  assert.equal(buttonClicks, 0);
});

test('SEND revalidates before Enter and performs no action after a conversation switch', async () => {
  const h = createHarness({
    messages: [{ id: 'old-outgoing', direction: 'outgoing', text: '旧消息' }]
  });
  h.input._onDispatch = (event) => {
    if (event.type === 'input') h.switchConversation('conv2');
    if (event.type === 'keydown' && event.key === 'Enter') h.externalActions++;
  };
  h.button._onClick = () => { h.externalActions++; };

  const result = await h.dispatch({
    type: 'SEND_MANAGED_REPLY',
    expected: h.expected,
    conversationRef: h.ref,
    draft: '确认收到'
  });

  assert.equal(result.errorCode, 'TARGET_UNCERTAIN');
  assert.equal(h.externalActions, 0);
});

test('SEND requires a new scoped outgoing bubble matching the draft', async () => {
  const h = createHarness({
    messages: [{ id: 'old-outgoing', direction: 'outgoing', text: '旧消息' }]
  });
  h.input._onDispatch = (event) => {
    if (event.type !== 'keydown' || event.key !== 'Enter') return;
    h.externalActions++;
    h.addMessage({
      id: 'sent-evidence',
      direction: 'outgoing',
      text: '确认收到',
      at: 1700000999999
    });
    h.input.textContent = '';
  };
  h.button._onClick = () => { h.externalActions++; };

  const result = await h.dispatch({
    type: 'SEND_MANAGED_REPLY',
    expected: h.expected,
    conversationRef: h.ref,
    draft: '确认收到'
  });

  assert.equal(result.success, true);
  assert.equal(result.sentFingerprint, 'id:sent-evidence');
  assert.equal(result.targetConversationId, 'conv1');
  assert.equal(Number.isFinite(result.observedAt) && result.observedAt > 0, true);
  assert.equal(h.externalActions, 1);
});

test('SEND returns unknown when evidence is missing or the target changes after action', async () => {
  const missing = createHarness({
    messages: [{ id: 'old-outgoing', direction: 'outgoing', text: '旧消息' }]
  });
  missing.input._onDispatch = (event) => {
    if (event.type === 'keydown' && event.key === 'Enter') missing.externalActions++;
  };
  missing.button._onClick = () => { missing.externalActions++; };
  assert.equal((await missing.dispatch({
    type: 'SEND_MANAGED_REPLY',
    expected: missing.expected,
    conversationRef: missing.ref,
    draft: '确认收到'
  })).errorCode, 'SEND_RESULT_UNKNOWN');

  const switched = createHarness({
    messages: [{ id: 'old-outgoing', direction: 'outgoing', text: '旧消息' }]
  });
  switched.input._onDispatch = (event) => {
    if (event.type !== 'keydown' || event.key !== 'Enter') return;
    switched.externalActions++;
    switched.addMessage({
      id: 'sent-before-switch',
      direction: 'outgoing',
      text: '确认收到'
    });
    switched.input.textContent = '';
    switched.switchConversation('conv2');
  };
  switched.button._onClick = () => { switched.externalActions++; };
  assert.equal((await switched.dispatch({
    type: 'SEND_MANAGED_REPLY',
    expected: switched.expected,
    conversationRef: switched.ref,
    draft: '确认收到'
  })).errorCode, 'SEND_RESULT_UNKNOWN');
});

test('SEND does not click replacement controls after Enter has no evidence', async () => {
  const h = createHarness({
    messages: [{ id: 'old-outgoing', direction: 'outgoing', text: '旧消息' }]
  });
  let replacementClicks = 0;
  h.input._onDispatch = (event) => {
    if (event.type !== 'keydown' || event.key !== 'Enter') return;
    h.externalActions++;
    h.input.offsetParent = null;
    h.button.offsetParent = null;
    const replacementInput = h.pane.append(new FakeElement({
      id: 'chat-input-replacement',
      className: 'chat-input',
      contenteditable: true,
      text: '确认收到',
      selectors: [S.input]
    }));
    const replacementButton = h.pane.append(new FakeElement({
      tagName: 'button',
      className: 'btn-send',
      selectors: [S.button]
    }));
    replacementButton._onClick = () => { replacementClicks++; };
    h.replacementInput = replacementInput;
    h.replacementButton = replacementButton;
  };
  h.button._onClick = () => { h.externalActions++; };

  const result = await h.dispatch({
    type: 'SEND_MANAGED_REPLY',
    expected: h.expected,
    conversationRef: h.ref,
    draft: '确认收到'
  });

  assert.equal(result.errorCode, 'SEND_RESULT_UNKNOWN');
  assert.equal(h.externalActions, 1);
  assert.equal(replacementClicks, 0);
});
