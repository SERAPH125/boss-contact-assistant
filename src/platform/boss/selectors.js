// BOSS 直聘选择器（可重复注入，避免 const 重复声明报错）
(function (g) {
  if (g.__BOSS_CONTACT_SELECTORS__) return;
  g.__BOSS_CONTACT_SELECTORS__ = true;

  g.SELECTORS = {
    jobs: {
      jobCard: 'li.job-card-box',
      jobName: '.job-name',
      jobSalary: '.job-salary',
      tagList: '.tag-list li',
      company: '.company-name, .boss-info .company-name, [class*="company-name"]',
      bossName: '.boss-name, .boss-info .name, [class*="boss-name"]',
      immediateChatBtn: 'a.op-btn-chat',
      bossActive: '.boss-online-tag, .boss-active-time, .company-tag, [class*="boss-online"], [class*="active-time"], .info-public'
    },
    chat: {
      // 新版会话列表多为 .friend-content，旧版为 li
      userList: '.user-list-content li, .user-list-content .friend-content, .friend-content',
      activeUser: [
        '.user-list-content li.active',
        '.user-list-content li.selected',
        '.user-list-content li[class*="active"]',
        '.user-list-content li[class*="selected"]',
        '.user-list-content .friend-content.active',
        '.user-list-content .friend-content.selected',
        '.user-list-content .friend-content[class*="active"]',
        '.user-list-content .friend-content[class*="selected"]',
        '.friend-content.active',
        '.friend-content.selected'
      ].join(', '),
      userName: '.geek-name, .name-text, [class*="name"]',
      userCompany: '.title-box .name-box, [class*="company"]',
      chatInput: 'div#chat-input.chat-input',
      btnSend: 'button.btn-send',
      imageUpload: '.btn-sendimg input[type=file]',
      messageSent: '.item-myself',
      activeContext: [
        '.chat-info',
        '.chat-header',
        '.chat-top',
        '.conversation-title',
        '[class*="chat-header"]',
        '.base-info',
        '[class*="base-info"]',
        '.position-name',
        '[class*="position-name"]'
      ].join(', '),
      conversationLink: [
        '.user-list-content li.active a[href*="/web/geek/chat"]',
        '.user-list-content .friend-content.active a[href*="/web/geek/chat"]',
        '.friend-content.active a[href*="/web/geek/chat"]'
      ].join(', '),
      messageList: '.chat-message-list',
      messageItem: '.chat-message-list .item',
      messageIncoming: '.chat-message-list .item-friend',
      messageOutgoing: '.chat-message-list .item-myself',
      messageText: '.message-content .text, .message-text',
      messageTime: 'time, [data-time]'
    }
  };

  g.CITY_MAP = {
    '全国': '100010000', '北京': '101010100', '上海': '101020100', '广州': '101280100', '深圳': '101280600',
    '杭州': '101210100', '成都': '101270100', '武汉': '101200100', '西安': '101110100', '南京': '101190100',
    '苏州': '101190400', '天津': '101030100', '重庆': '101040100', '长沙': '101250100', '郑州': '101180100',
    '沈阳': '101070100', '青岛': '101120200', '合肥': '101220100', '厦门': '101230200', '福州': '101230100',
    '济南': '101120100', '宁波': '101210400', '东莞': '101281600', '无锡': '101190200', '昆明': '101290100',
    '哈尔滨': '101050100', '长春': '101060100', '大连': '101070200', '石家庄': '101090100'
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
