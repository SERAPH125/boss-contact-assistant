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
  userList: BOSS_SELECTORS.chat.userList,
  conversationLink: BOSS_SELECTORS.chat.conversationLink,
  activeUser: BOSS_SELECTORS.chat.activeUser,
  messageList: BOSS_SELECTORS.chat.messageList,
  messageItem: BOSS_SELECTORS.chat.messageItem,
  incoming: BOSS_SELECTORS.chat.messageIncoming,
  outgoing: BOSS_SELECTORS.chat.messageOutgoing,
  text: BOSS_SELECTORS.chat.messageText,
  time: BOSS_SELECTORS.chat.messageTime,
  userName: BOSS_SELECTORS.chat.userName,
  userCompany: BOSS_SELECTORS.chat.userCompany,
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
    selectors: [S.activeUser, S.userList]
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
  if (Object.hasOwn(options, 'activeNameText')) {
    activeItem.append(new FakeElement({
      text: options.activeNameText,
      selectors: [S.userName]
    }));
  }
  if (Object.hasOwn(options, 'activeCompanyText')) {
    activeItem.append(new FakeElement({
      text: options.activeCompanyText,
      selectors: [S.userCompany]
    }));
  }

  const conversationPane = documentRoot.append(new FakeElement());
  const pane = options.controlsOutsideMessagePane
    ? conversationPane.append(new FakeElement({ className: 'message-content' }))
    : conversationPane;
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
  const input = conversationPane.append(new FakeElement({
    id: 'chat-input',
    className: 'chat-input',
    contenteditable: true,
    selectors: [S.input]
  }));
  const button = conversationPane.append(new FakeElement({
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
    conversationPane,
    container,
    input,
    button,
    listener: null,
    externalActions: 0,
    nextMessage: 1000,
    historyMessages: [],
    pendingConversationSwitch: null
  };
  const header = pane.querySelector(S.header);

  state.addMessage = function addMessage(config = {}, target = container) {
    const index = state.nextMessage++;
    const direction = config.direction || 'incoming';
    const historyDirection = config.historyDirection ||
      (direction === 'unknown' ? 'incoming' : direction);
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
    if (target === container && config.history !== false) {
      const historyEntry = {
        mid: Object.hasOwn(config, 'id') ? config.id : 'm' + index,
        type: Object.hasOwn(config, 'historyType')
          ? config.historyType
          : (direction === 'unknown' ? 99 : 3),
        received: Object.hasOwn(config, 'historyReceived')
          ? config.historyReceived
          : true,
        body: {
          type: Object.hasOwn(config, 'historyBodyType') ? config.historyBodyType : 1,
          text: config.text === undefined ? '消息 ' + index : config.text
        },
        from: {
          uid: Object.hasOwn(config, 'historyFromUid')
            ? config.historyFromUid
            : (historyDirection === 'incoming' ? 100 : 200),
          name: historyDirection === 'incoming' ? '示例HR' : '我'
        },
        to: {
          uid: Object.hasOwn(config, 'historyToUid')
            ? config.historyToUid
            : (historyDirection === 'incoming' ? 200 : 100),
          name: historyDirection === 'incoming' ? '我' : '示例HR'
        }
      };
      if (Object.hasOwn(config, 'historyTime')) historyEntry.time = config.historyTime;
      state.historyMessages.push(historyEntry);
    }
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

  state.switchConversation = function switchConversation(id, text) {
    activeItem.dataset.conversationId = id;
    activeLink.dataset.conversationId = id;
    activeLink.href = 'https://www.zhipin.com/web/geek/chat?conversationId=' + id;
    container.dataset.conversationId = id;
    if (typeof text === 'string') {
      activeItem.textContent = text;
      activeItem.innerText = text;
      activeLink.textContent = text;
      activeLink.innerText = text;
      header.textContent = text;
      header.innerText = text;
    }
  };

  state.addConversationCandidate = function addConversationCandidate(config = {}) {
    const candidate = activeList.append(new FakeElement({
      className: 'friend-content',
      text: config.text || '候选会话',
      selectors: [S.userList]
    }));
    candidate._onClick = () => {
      const next = {
        conversationId: config.conversationId || 'conv-extra',
        activeText: config.activeText || config.text || '候选会话'
      };
      if (Number.isSafeInteger(config.switchAfterSleeps) &&
          config.switchAfterSleeps > 0) {
        state.pendingConversationSwitch = Object.assign(
          { sleepsRemaining: config.switchAfterSleeps },
          next
        );
      } else {
        state.switchConversation(next.conversationId, next.activeText);
      }
    };
    return candidate;
  };

  const contextObject = {
    console,
    URL,
    URLSearchParams,
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
      if (state.pendingConversationSwitch) {
        state.pendingConversationSwitch.sleepsRemaining -= 1;
        if (state.pendingConversationSwitch.sleepsRemaining <= 0) {
          const pending = state.pendingConversationSwitch;
          state.pendingConversationSwitch = null;
          state.switchConversation(pending.conversationId, pending.activeText);
        }
      }
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
      if (href.indexOf('/wapi/zpchat/geek/historyMsg?') !== -1) {
        if (options.historyUnavailable) {
          return { ok: false, status: 500, async json() { return { code: 1 }; } };
        }
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              code: 0,
              zpData: {
                hasMore: false,
                messages: state.historyMessages.slice().reverse()
              }
            };
          }
        };
      }
      if (href.indexOf('getGeekFriendList.json') === -1) {
        return { ok: false, status: 404, async json() { return {}; } };
      }
      if (options.friendListError) {
        throw new Error('network');
      }
      if (options.friendListUnavailable) {
        return { ok: false, status: 500, async json() { return { code: 1 }; } };
      }
      const friends = (options.friends || [{
        encryptUid: options.peerId || 'conv1',
        uid: 100,
        name: '示例HR',
        brandName: '示例公司'
      }]).map((friend) => {
        const copy = { ...friend };
        if (!(Number.isSafeInteger(copy.uid) && copy.uid > 0) &&
            !(typeof copy.uid === 'string' && /^[1-9][0-9]{0,19}$/.test(copy.uid))) {
          if (copy.uid !== undefined && copy.conversationId === undefined) {
            copy.conversationId = copy.uid;
          }
          copy.uid = 100;
        }
        return copy;
      });
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
    url: 'https://www.zhipin.com/web/geek/chat?conversationId=conv1',
    peerUid: '100'
  };
  return state;
}

test('history direction follows peer from/to uid when received is true for both sides', async () => {
  const h = createHarness({
    messages: [
      { id: 'outgoing-same-received', direction: 'outgoing', text: '我方回复' },
      { id: 'incoming-same-received', direction: 'incoming', text: 'HR 回复' }
    ]
  });

  const read = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: h.expected,
    conversationRef: h.ref,
    lastFingerprint: ''
  });

  assert.equal(read.success, true);
  assert.deepEqual(
    Array.from(read.messages, (message) => [message.text, message.direction]),
    [['HR 回复', 'incoming']]
  );
  assert.equal(read.baselineIncomingFingerprint, 'id:incoming-same-received');
});

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

  assert.equal(result.success, true, JSON.stringify(result));
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

test('READ leaves an unrelated active conversation unchanged', async () => {
  const h = createHarness({
    activeText: '其他公司 其他岗位 其他HR',
    headerText: '其他公司 其他岗位 其他HR',
    activeDataset: { conversationId: 'conv-other' },
    activeLinkDataset: { conversationId: 'conv-other' },
    containerDataset: { conversationId: 'conv-other' }
  });
  h.addConversationCandidate({
    conversationId: 'conv1',
    text: '示例HR 示例公司 示例岗位'
  });

  const result = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: h.expected,
    conversationRef: h.ref,
    lastFingerprint: 'id:initial-incoming'
  });

  assert.equal(result.success, true);
  assert.equal(result.conversationRef.conversationId, 'conv1');
  assert.deepEqual(Array.from(result.messages), []);
  assert.equal(h.activeItem.dataset.conversationId, 'conv-other');
});

test('READ uses the registered stable peer without activating a visible conversation', async () => {
  const h = createHarness({
    activeText: '其他公司 其他岗位 其他HR',
    headerText: '其他公司 其他岗位 其他HR',
    activeDataset: { conversationId: 'conv-other' },
    activeLinkDataset: { conversationId: 'conv-other' },
    containerDataset: { conversationId: 'conv-other' },
    friends: [{
      encryptUid: 'conv1',
      name: '示例HR',
      brandName: '示例公司',
      jobName: '示例岗位'
    }]
  });

  const result = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: { company: '示例公司', hrName: '示例HR', name: '示例岗位' },
    conversationRef: h.ref,
    lastFingerprint: 'id:initial-incoming'
  });

  assert.equal(result.success, true);
  assert.equal(result.conversationRef.conversationId, 'conv1');
  assert.deepEqual(Array.from(result.messages), []);
  assert.equal(h.activeItem.dataset.conversationId, 'conv-other');
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
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.conversationRef.conversationId, 'peer~~uid1');
  assert.equal(
    result.conversationRef.url,
    'https://www.zhipin.com/web/geek/chat?uid=peer~~uid1'
  );
  assert.deepEqual(Array.from(result.conversationRef.aliases || []), ['conv1', '100']);
  assert.equal(result.conversationRef.peerUid, '100');
  assert.equal(result.peerSource, 'encryptUid');
  assert.equal(result.baselineIncomingFingerprint, 'id:initial-incoming');
  assert.ok(result.company || result.position || result.hrName);
});

test('SEND_ACTIVE returns canonical friend-list identity for auto registration', async () => {
  const h = createHarness({
    activeText: '审核卡片公司 跨境电商运营',
    headerText: '审核卡片公司 跨境电商运营',
    peerId: 'peer~~canonical-1',
    friends: [{
      encryptUid: 'peer~~canonical-1',
      uid: 100,
      conversationId: 'conv1',
      name: '罗榜伟',
      brandName: '杭州双一科技有限公司',
      jobName: '跨境电商运营'
    }]
  });
  h.input._selectors.add('div#chat-input');
  h.input._onDispatch = (event) => {
    if (event.type === 'keydown' && event.key === 'Enter') {
      h.input.textContent = '';
      h.addMessage({
        id: 'sent-greeting',
        direction: 'outgoing',
        text: '您好，我对岗位很感兴趣'
      });
    }
  };

  const result = await h.dispatch({
    type: 'SEND_ACTIVE',
    image: '',
    greeting: '您好，我对岗位很感兴趣',
    expected: {
      company: '审核卡片公司',
      name: '跨境电商运营',
      hrName: ''
    }
  });

  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.conversationRef.conversationId, 'peer~~canonical-1');
  assert.equal(result.conversationRef.peerUid, '100');
  assert.equal(result.company, '杭州双一科技有限公司');
  assert.equal(result.position, '跨境电商运营');
  assert.equal(result.hrName, '罗榜伟');
});

test('OPEN repairs stale identity from canonical friend data before locating the conversation', async () => {
  const h = createHarness({
    activeText: '其他公司 其他岗位',
    headerText: '其他公司 其他岗位',
    activeDataset: { conversationId: 'conv-other' },
    activeLinkDataset: { conversationId: 'conv-other' },
    containerDataset: { conversationId: 'conv-other' },
    friends: [{
      encryptUid: 'peer~~canonical-2',
      uid: 10002,
      conversationId: 'conv-target',
      name: '罗榜伟',
      brandName: '杭州双一科技有限公司',
      jobName: '跨境电商运营'
    }]
  });
  h.addConversationCandidate({
    conversationId: 'conv-target',
    text: '罗榜伟 杭州双一科技有限公司 跨境电商运营'
  });

  const result = await h.dispatch({
    type: 'OPEN_MANAGED_CONVERSATION',
    expected: {
      company: '未知公司',
      name: '未知岗位',
      hrName: '错误联系人'
    },
    conversationRef: {
      conversationId: 'peer~~canonical-2',
      url: 'https://www.zhipin.com/web/geek/chat?uid=peer~~canonical-2',
      aliases: ['conv-target']
    }
  });

  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.conversationRef.conversationId, 'peer~~canonical-2');
  assert.equal(result.conversationRef.peerUid, '10002');
  assert.equal(result.company, '杭州双一科技有限公司');
  assert.equal(result.position, '跨境电商运营');
  assert.equal(result.hrName, '罗榜伟');
  assert.equal(h.activeItem.dataset.conversationId, 'conv-target');
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
    URLSearchParams,
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
      const href = String(url || '');
      if (href.indexOf('/wapi/zpchat/geek/historyMsg?') !== -1) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              code: 0,
              zpData: {
                hasMore: false,
                messages: [{
                  mid: 337069469603329,
                  type: 3,
                  received: false,
                  body: { type: 1, text: '您好，我对这个岗位很感兴趣' },
                  from: { uid: 200, name: '我' },
                  to: { uid: 100 }
                }]
              }
            };
          }
        };
      }
      if (href.indexOf('getGeekFriendList.json') === -1) {
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
                uid: 100,
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
  assert.equal(result.position, '跨境电商运营');
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
        historyType: 7,
        historyBodyType: 42,
        historyReceived: true,
        text: '无法确认方向的历史节点',
        at: null
      }
    ]
  });
  const result = await h.dispatch({ type: 'CAPTURE_ACTIVE_CONVERSATION' });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'MESSAGE_ORDER_UNCERTAIN');
  assert.match(result.error, /type=7, body\.type=42, received=true/);
  assert.doesNotMatch(result.error, /无法确认方向的历史节点/);
});

test('CAPTURE ignores the directionless Boss competitor analysis system card', async () => {
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
        text: '你与该职位竞争者PK情况 共10人投递 查看详细分析',
        historyType: 4,
        at: null
      }
    ]
  });
  const result = await h.dispatch({ type: 'CAPTURE_ACTIVE_CONVERSATION' });
  assert.equal(result.success, true);
  assert.equal(result.baselineIncomingFingerprint, '');
});

test('CAPTURE uses history message direction and ignores Boss system messages', async () => {
  const h = createHarness({
    messages: [
      {
        id: '337069469603329',
        direction: 'unknown',
        historyType: 3,
        historyReceived: true,
        text: '方便发一份简历吗'
      },
      {
        id: '337069469603330',
        direction: 'unknown',
        historyType: 4,
        text: '对方已同意，您的附件简历已发送给对方'
      }
    ]
  });

  const result = await h.dispatch({ type: 'CAPTURE_ACTIVE_CONVERSATION' });

  assert.equal(result.success, true);
  assert.equal(result.baselineIncomingFingerprint, 'id:337069469603329');
});

test('CAPTURE accepts the live Boss type-1 plain-text envelope', async () => {
  const h = createHarness({
    messages: [{
      id: '337069469603333',
      direction: 'unknown',
      historyType: 1,
      historyBodyType: 1,
      historyReceived: true,
      text: '方便发一份简历吗'
    }]
  });

  const result = await h.dispatch({ type: 'CAPTURE_ACTIVE_CONVERSATION' });

  assert.equal(result.success, true);
  assert.equal(result.baselineIncomingFingerprint, 'id:337069469603333');
});

test('CAPTURE prefers structured friend identity over composite DOM text', async () => {
  const h = createHarness({
    activeText: '韩女士 杭州益身礼 数据运营招聘专员',
    activeNameText: '韩女士杭州益身礼数据运营招聘专员',
    activeCompanyText: '韩女士杭州益身礼数据运营招聘专员',
    friends: [{
      encryptUid: 'conv1',
      name: '韩女士',
      brandName: '杭州益身礼',
      jobName: '数据运营招聘专员'
    }]
  });

  const result = await h.dispatch({ type: 'CAPTURE_ACTIVE_CONVERSATION' });

  assert.equal(result.success, true);
  assert.deepEqual(
    { company: result.company, position: result.position, hrName: result.hrName },
    { company: '杭州益身礼', position: '数据运营招聘专员', hrName: '韩女士' }
  );
});

test('GET builds the baseline from history API when DOM system nodes have no direction', async () => {
  const h = createHarness({
    messages: [
      {
        id: '337069469603331',
        direction: 'incoming',
        historyType: 3,
        text: '还在看机会吗'
      },
      {
        id: '337069469603332',
        direction: 'unknown',
        historyType: 4,
        text: '您的消息已被心仪 Boss 优先查看'
      }
    ]
  });

  const result = await h.dispatch({
    type: 'GET_ACTIVE_CONVERSATION_REF',
    expected: h.expected
  });

  assert.equal(result.success, true);
  assert.equal(result.baselineIncomingFingerprint, 'id:337069469603331');
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

test('CAPTURE uses the newest Boss history id after the user switches conversations', async () => {
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
  assert.equal(result.success, true);
  assert.equal(result.conversationRef.conversationId, 'current-peer');
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

test('CAPTURE ignores a stale page uid after the visible Boss conversation switches', async () => {
  const h = createHarness({
    activeText: '谭辉 江西盐选科技有限公司 人事',
    headerText: '谭辉 江西盐选科技有限公司 跨境电商运营助理（五险）',
    activeDataset: {},
    activeLinkDataset: {},
    activeHref: '',
    containerDataset: {},
    locationHref: 'https://www.zhipin.com/web/geek/chat?uid=stale-peer',
    historyResources: [{
      name: 'https://www.zhipin.com/wapi/zpchat/geek/historyMsg?bossId=current-peer'
    }],
    friends: [
      {
        encryptUid: 'stale-peer',
        name: '徐海霞',
        brandName: '智驭信息'
      },
      {
        encryptUid: 'current-peer',
        name: '谭辉',
        brandName: '江西盐选科技有限公司'
      }
    ]
  });

  const result = await h.dispatch({ type: 'CAPTURE_ACTIVE_CONVERSATION' });

  assert.equal(result.success, true);
  assert.equal(result.conversationRef.conversationId, 'current-peer');
  assert.equal(result.company, '江西盐选科技有限公司');
  assert.equal(result.hrName, '谭辉');
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
  const h = createHarness({
    friends: [{
      encryptUid: 'peer~~stable',
      uid: 'conv1',
      name: '示例HR',
      brandName: '示例公司',
      jobName: '示例岗位'
    }]
  });
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

test('READ uses the registered stable peer when the friend list is temporarily unavailable', async () => {
  const h = createHarness({ friendListUnavailable: true });

  const result = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: h.expected,
    conversationRef: h.ref,
    lastFingerprint: 'id:initial-incoming'
  });

  assert.equal(result.success, true);
  assert.equal(result.conversationRef.conversationId, h.ref.conversationId);
  assert.deepEqual(Array.from(result.messages), []);
});

test('READ uses history API direction instead of directionless DOM messages', async () => {
  const h = createHarness({
    messages: [{
      id: '337069469603340',
      direction: 'unknown',
      historyType: 3,
      historyReceived: true,
      text: '第一条来信'
    }]
  });
  h.addMessage({
    id: '337069469603341',
    direction: 'unknown',
    historyType: 3,
    historyReceived: true,
    text: '第二条来信'
  });

  const result = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: h.expected,
    conversationRef: h.ref,
    lastFingerprint: 'id:337069469603340'
  });

  assert.equal(result.success, true);
  assert.deepEqual(Array.from(result.messages, (item) => item.text), ['第二条来信']);
  assert.equal(result.baselineIncomingFingerprint, 'id:337069469603341');
});

test('READ keeps an unknown history body type as a non-text message instead of failing the batch', async () => {
  const h = createHarness({
    messages: [{ id: '337069469603360', direction: 'incoming', text: '第一条来信' }]
  });
  h.addMessage({
    id: '337069469603361',
    direction: 'unknown',
    historyType: 9,
    historyBodyType: 42,
    historyReceived: true,
    text: '无法解析的正文'
  });

  const result = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: h.expected,
    conversationRef: h.ref,
    lastFingerprint: 'id:337069469603360'
  });

  assert.equal(result.success, true);
  assert.deepEqual(
    Array.from(result.messages, (item) => ({ kind: item.kind, text: item.text })),
    [{ kind: 'attachment', text: '' }]
  );
  assert.equal(result.baselineIncomingFingerprint, 'id:337069469603361');
});

test('READ fails closed when from/to cannot establish the message direction', async () => {
  const h = createHarness({
    messages: [{ id: '337069469603370', direction: 'incoming', text: '第一条来信' }]
  });
  h.addMessage({
    id: '337069469603371',
    direction: 'unknown',
    historyType: 5,
    historyReceived: null,
    historyFromUid: 300,
    historyToUid: 400,
    text: '没有方向的系统提示'
  });
  h.addMessage({
    id: '337069469603372',
    direction: 'unknown',
    historyType: 3,
    historyReceived: true,
    text: '第二条来信'
  });

  const result = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: h.expected,
    conversationRef: h.ref,
    lastFingerprint: 'id:337069469603370'
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, 'MESSAGE_ORDER_UNCERTAIN');
});

test('READ keeps an empty text body as a non-text message instead of dropping the batch', async () => {
  const h = createHarness({
    messages: [{ id: '337069469603375', direction: 'incoming', text: '第一条来信' }]
  });
  h.addMessage({
    id: '337069469603376',
    direction: 'unknown',
    historyType: 1,
    historyBodyType: 1,
    historyReceived: true,
    text: '   '
  });

  const result = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: h.expected,
    conversationRef: h.ref,
    lastFingerprint: 'id:337069469603375'
  });

  assert.equal(result.success, true);
  assert.deepEqual(
    Array.from(result.messages, (item) => ({ kind: item.kind, text: item.text })),
    [{ kind: 'attachment', text: '' }]
  );
});

test('READ falls back to the history timestamp when a message carries no usable mid', async () => {
  const h = createHarness({
    messages: [{ id: '337069469603380', direction: 'incoming', text: '第一条来信' }]
  });
  h.addMessage({
    id: '',
    direction: 'unknown',
    historyType: 3,
    historyReceived: true,
    historyTime: 1770000000123,
    text: '没有 mid 的来信'
  });

  const result = await h.dispatch({
    type: 'READ_ACTIVE_CONVERSATION',
    expected: h.expected,
    conversationRef: h.ref,
    lastFingerprint: 'id:337069469603380'
  });

  assert.equal(result.success, true);
  assert.deepEqual(Array.from(result.messages, (item) => item.text), ['没有 mid 的来信']);
  assert.match(result.baselineIncomingFingerprint, /^hash:/);
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

test('managed send rejects a user-visible tab while the passive read still works there', async () => {
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

  assert.equal(read.success, true);
  assert.deepEqual(
    { success: sent.success, errorCode: sent.errorCode },
    { success: false, errorCode: 'TARGET_UNCERTAIN' }
  );
  assert.equal(h.externalActions, 0);
});

test('OPEN activates the uniquely matching registered conversation without sending a message', async () => {
  const h = createHarness({
    visibilityState: 'visible',
    activeText: '其他公司 其他岗位 其他HR',
    headerText: '其他公司 其他岗位 其他HR',
    activeDataset: { conversationId: 'conv-other' },
    activeLinkDataset: { conversationId: 'conv-other' },
    containerDataset: { conversationId: 'conv-other' }
  });
  h.addConversationCandidate({
    conversationId: 'conv1',
    text: '示例HR 示例公司 示例岗位'
  });
  h.input._onDispatch = () => { h.externalActions++; };
  h.button._onClick = () => { h.externalActions++; };

  const result = await new Promise((resolve) => {
    const keepsChannelOpen = h.listener({
      type: 'OPEN_MANAGED_CONVERSATION',
      expected: h.expected,
      conversationRef: h.ref
    }, {}, resolve);
    if (keepsChannelOpen !== true) resolve(null);
  });

  assert.equal(result && result.success, true);
  assert.equal(result.conversationRef.conversationId, 'conv1');
  assert.equal(h.activeItem.dataset.conversationId, 'conv1');
  assert.equal(h.externalActions, 0);
});

test('OPEN waits for a slow Boss SPA conversation switch before confirming the target', async () => {
  const h = createHarness({
    visibilityState: 'visible',
    activeText: '其他公司 其他岗位 其他HR',
    headerText: '其他公司 其他岗位 其他HR',
    activeDataset: { conversationId: 'conv-other' },
    activeLinkDataset: { conversationId: 'conv-other' },
    containerDataset: { conversationId: 'conv-other' }
  });
  h.addConversationCandidate({
    conversationId: 'conv1',
    text: '示例HR 示例公司 示例岗位',
    switchAfterSleeps: 40
  });

  const result = await h.dispatch({
    type: 'OPEN_MANAGED_CONVERSATION',
    expected: h.expected,
    conversationRef: h.ref
  });

  assert.equal(result.success, true);
  assert.equal(result.conversationRef.conversationId, 'conv1');
  assert.equal(h.activeItem.dataset.conversationId, 'conv1');
});

test('OPEN accepts the uniquely matching managed peer when the Boss page uid is stale', async () => {
  const h = createHarness({
    visibilityState: 'visible',
    activeText: '示例HR 示例公司 示例岗位',
    headerText: '示例HR 示例公司 示例岗位',
    activeDataset: {},
    activeLinkDataset: {},
    activeHref: '',
    containerDataset: {},
    locationHref: 'https://www.zhipin.com/web/geek/chat?uid=stale-peer',
    historyResources: [{
      name: 'https://www.zhipin.com/wapi/zpchat/geek/historyMsg?bossId=conv1'
    }]
  });

  const result = await h.dispatch({
    type: 'OPEN_MANAGED_CONVERSATION',
    expected: h.expected,
    conversationRef: h.ref
  });

  assert.equal(result.success, true);
  assert.equal(result.conversationRef.conversationId, 'conv1');
});

test('SEND activates the uniquely matching registered conversation before entering the send protocol', async () => {
  const h = createHarness({
    activeText: '其他公司 其他岗位 其他HR',
    headerText: '其他公司 其他岗位 其他HR',
    activeDataset: { conversationId: 'conv-other' },
    activeLinkDataset: { conversationId: 'conv-other' },
    containerDataset: { conversationId: 'conv-other' },
    messages: [{ id: 'old-outgoing', direction: 'outgoing', text: '旧消息' }]
  });
  h.addConversationCandidate({
    conversationId: 'conv1',
    text: '示例HR 示例公司 示例岗位'
  });
  h.input._onDispatch = (event) => {
    if (event.type !== 'keydown' || event.key !== 'Enter') return;
    h.externalActions++;
    h.addMessage({
      id: 'sent-after-activation',
      direction: 'outgoing',
      text: '确认收到'
    });
    h.input.textContent = '';
  };

  const result = await h.dispatch({
    type: 'SEND_MANAGED_REPLY',
    expected: h.expected,
    conversationRef: h.ref,
    draft: '确认收到'
  });

  assert.equal(result.success, true);
  assert.equal(result.targetConversationId, 'conv1');
  assert.equal(result.sentFingerprint, 'id:sent-after-activation');
  assert.equal(h.externalActions, 1);
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

  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.sentFingerprint, 'id:sent-evidence');
  assert.equal(result.targetConversationId, 'conv1');
  assert.equal(Number.isFinite(result.observedAt) && result.observedAt > 0, true);
  assert.equal(h.externalActions, 1);
});

test('SEND finds controls in the nearest shared conversation ancestor', async () => {
  const h = createHarness({
    controlsOutsideMessagePane: true,
    messages: [{ id: 'old-outgoing', direction: 'outgoing', text: '旧消息' }]
  });
  h.input._onDispatch = (event) => {
    if (event.type !== 'keydown' || event.key !== 'Enter') return;
    h.externalActions++;
    h.addMessage({
      id: 'sent-from-shared-ancestor',
      direction: 'outgoing',
      text: '好的，谢谢'
    });
    h.input.textContent = '';
  };

  const result = await h.dispatch({
    type: 'SEND_MANAGED_REPLY',
    expected: h.expected,
    conversationRef: h.ref,
    draft: '好的，谢谢'
  });

  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.sentFingerprint, 'id:sent-from-shared-ancestor');
  assert.equal(h.externalActions, 1);
});

test('SEND rejects ambiguous controls in the shared conversation ancestor', async () => {
  const h = createHarness({
    controlsOutsideMessagePane: true,
    messages: [{ id: 'old-outgoing', direction: 'outgoing', text: '旧消息' }]
  });
  const extraInput = h.conversationPane.append(new FakeElement({
    id: 'chat-input-extra',
    className: 'chat-input',
    contenteditable: true,
    selectors: [S.input]
  }));
  const extraButton = h.conversationPane.append(new FakeElement({
    tagName: 'button',
    className: 'btn-send',
    selectors: [S.button]
  }));
  h.input._onDispatch = () => { h.externalActions++; };
  h.button._onClick = () => { h.externalActions++; };
  extraInput._onDispatch = () => { h.externalActions++; };
  extraButton._onClick = () => { h.externalActions++; };

  const result = await h.dispatch({
    type: 'SEND_MANAGED_REPLY',
    expected: h.expected,
    conversationRef: h.ref,
    draft: '好的，谢谢'
  });

  assert.equal(result.errorCode, 'TARGET_UNCERTAIN');
  assert.equal(h.externalActions, 0);
});

test('SEND verifies evidence through history API despite directionless DOM system messages', async () => {
  const h = createHarness({
    messages: [
      { id: '337069469603350', direction: 'outgoing', text: '旧消息' },
      {
        id: '337069469603351',
        direction: 'unknown',
        historyType: 4,
        text: '对方已同意，您的附件简历已发送给对方'
      }
    ]
  });
  h.input._onDispatch = (event) => {
    if (event.type !== 'keydown' || event.key !== 'Enter') return;
    h.externalActions++;
    h.addMessage({
      id: '337069469603352',
      direction: 'outgoing',
      text: '确认收到'
    });
    h.input.textContent = '';
  };

  const result = await h.dispatch({
    type: 'SEND_MANAGED_REPLY',
    expected: h.expected,
    conversationRef: h.ref,
    draft: '确认收到'
  });

  assert.equal(result.success, true);
  assert.equal(result.sentFingerprint, 'id:337069469603352');
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
