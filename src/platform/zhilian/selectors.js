// 智联招聘选择器（可重复注入）
(function (g) {
  if (g.__ZHILIAN_CONTACT_SELECTORS__) return;
  g.__ZHILIAN_CONTACT_SELECTORS__ = true;

  g.SELECTORS = {
    jobs: {
      jobCard: '.joblist-box__item',
      jobName: 'a.jobinfo__name, .jobinfo__name',
      jobSalary: '.jobinfo__salary',
      tagList: '.jobinfo__tag .joblist-box__item-tag, .joblist-box__item-tag',
      company: 'a.companyinfo__name, .companyinfo__name',
      location: '.jobinfo__other-info-item',
      staff: '.companyinfo__staff',
      chatBtn: '.c-chat-job, .c-chat-job__title',
      applyBtn: 'button.collect-and-apply__btn, .collect-and-apply__btn',
      listRoot: '.positionlist__list, .joblist-box'
    },
    chat: {
      userList: '.chat-list li, .session-list li, [class*="session"] li, [class*="chat-list"] li',
      activeUser: '.chat-list li.active, .session-list li.active, [class*="session"] li[class*="active"], [class*="chat-list"] li[class*="active"]',
      chatInput: '[contenteditable="true"], textarea[placeholder*="输入"], textarea.chat-input, .chat-input textarea, #chat-input',
      btnSend: 'button[class*="send"], .btn-send, button.a-send',
      messageSent: '[class*="myself"], [class*="mine"], .msg-mine',
      activeContext: '.chat-header, .chat-top, .conversation-title, .session-title, [class*="chat-header"]'
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
