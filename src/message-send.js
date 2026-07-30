// 单次发送与目标会话校验：content script / Node 测试共用
(function (g, factory) {
  var api = factory();
  g.MessageSend = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  function normalize(value) {
    return String(value || '').replace(/\s+/g, '').toLowerCase();
  }

  function pushUnique(list, token) {
    if (!token || token.length < 2) return;
    if (list.indexOf(token) === -1) list.push(token);
  }

  /** 岗位名常带括号补充；聊天页往往只显示括号前主标题 */
  function titleCore(token) {
    return token.split(/[（(【\[]/)[0] || token;
  }

  /** 列表页公司全称 vs 聊天页简称 */
  function companyCore(token) {
    return token
      .replace(/(股份有限公司|有限责任公司|有限公司|集团股份有限公司)$/g, '')
      .replace(/(集团|控股)$/g, '');
  }

  function identityCandidates(raw) {
    var token = normalize(raw);
    var out = [];
    pushUnique(out, token);
    pushUnique(out, titleCore(token));
    pushUnique(out, companyCore(token));
    pushUnique(out, companyCore(titleCore(token)));
    // 仅采纳较长片段，避免「运营」「销售」一类过短误匹配
    token.split(/[（）()【】\[\]·|/+\-_,，、]/).forEach(function (part) {
      if (part.length >= 4) pushUnique(out, part);
    });
    return out;
  }

  function matchesExpectedConversation(currentText, expected) {
    var current = normalize(currentText);
    if (!current) return false;
    var data = expected || {};
    var tokens = [];
    [data.hrName, data.company, data.name].forEach(function (raw) {
      identityCandidates(raw).forEach(function (token) {
        pushUnique(tokens, token);
      });
    });
    if (!tokens.length) return false;
    return tokens.some(function (token) {
      if (current.indexOf(token) >= 0) return true;
      // 仅当页面文案本身很短时做反向包含（例如只读到了公司简称）
      return current.length >= 2 && current.length <= 24 && token.indexOf(current) >= 0;
    });
  }

  /**
   * 初次外发必须提供至少两个独立身份字段，且所有已提供字段都要命中。
   * 尤其不能用“公司 + 岗位”掩盖 HR 不一致，否则同公司同岗位的另一位
   * 招聘者可能被误当成目标会话。
   */
  function matchesExpectedConversationStrict(currentText, expected) {
    var current = normalize(currentText);
    if (!current) return false;
    var data = expected || {};
    var fields = [
      data.hrName,
      data.company,
      data.name || data.position
    ].filter(function (value) {
      return identityCandidates(value).length > 0;
    });
    if (fields.length < 2) return false;
    return fields.every(function (value) {
      return identityCandidates(value).some(function (token) {
        if (current.indexOf(token) >= 0) return true;
        return current.length >= 2 &&
          current.length <= 24 &&
          token.indexOf(current) >= 0;
      });
    });
  }

  async function waitForEvidence(options, beforeCount) {
    var attempts = Math.max(1, Number(options.attempts) || 12);
    var wait = options.wait;
    for (var i = 0; i < attempts; i++) {
      await wait(300);
      var cleared = !String(options.readInput() || '').trim();
      var sent = Number(options.readSentCount() || 0) > beforeCount;
      if (cleared || sent) return true;
    }
    return false;
  }

  async function sendExactlyOnce(options) {
    if (!options || typeof options.pressEnter !== 'function') {
      return { ok: false, error: '发送参数不完整' };
    }
    var beforeCount = Number(options.readSentCount() || 0);
    options.pressEnter();
    if (await waitForEvidence(options, beforeCount)) {
      return { ok: true, via: 'enter' };
    }

    // Enter 已经是一次可能产生外部副作用的动作。证据迟到时点击发送按钮
    // 可能重复发送，因此结果必须收束为未知，交给上层只读核验或人工处理。
    return {
      ok: false,
      unknown: true,
      attempted: true,
      error: '发送结果未知（输入框未清空、未见新气泡），未执行第二次发送'
    };
  }

  return {
    matchesExpectedConversation: matchesExpectedConversation,
    matchesExpectedConversationStrict: matchesExpectedConversationStrict,
    identityCandidates: identityCandidates,
    sendExactlyOnce: sendExactlyOnce
  };
});
