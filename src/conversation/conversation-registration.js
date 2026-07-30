// 联系成功后的托管登记：聊天页规范身份优先，审核卡片字段仅作缺失回退。
(function (g, factory) {
  var api = factory();
  g.ConversationRegistration = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  function text(primary, fallback) {
    if (typeof primary === 'string' && primary.trim()) return primary.trim();
    return typeof fallback === 'string' ? fallback.trim() : '';
  }

  function checkReadiness(result) {
    var source = result && typeof result === 'object' ? result : {};
    var ref = source.conversationRef &&
      typeof source.conversationRef === 'object'
      ? source.conversationRef
      : {};
    var ready = typeof ref.conversationId === 'string' &&
      ref.conversationId.trim() !== '' &&
      typeof ref.url === 'string' &&
      ref.url.trim() !== '' &&
      typeof source.baselineIncomingFingerprint === 'string';
    if (ready) return { ok: true };
    return {
      ok: false,
      code: 'TRUSTEESHIP_METADATA_UNAVAILABLE',
      error: '联系成功，但无法取得可靠会话标识，AI 托管未开启'
    };
  }

  function fromSuccessfulContact(job, result, options) {
    var sourceJob = job && typeof job === 'object' ? job : {};
    var sourceResult = result && typeof result === 'object' ? result : {};
    var config = options && typeof options === 'object' ? options : {};
    var conversationRef = sourceResult.conversationRef &&
      typeof sourceResult.conversationRef === 'object'
      ? sourceResult.conversationRef
      : {};
    return {
      platform: 'boss',
      conversationId: conversationRef.conversationId,
      url: conversationRef.url,
      jobId: sourceJob.id,
      company: text(sourceResult.company, sourceJob.company),
      position: text(sourceResult.position, sourceJob.name),
      hrName: text(sourceResult.hrName, sourceJob.hrName),
      aliases: Array.isArray(conversationRef.aliases)
        ? conversationRef.aliases.slice(0, 8)
        : [],
      peerUid: typeof conversationRef.peerUid === 'string'
        ? conversationRef.peerUid
        : '',
      peerSource: 'encryptUid',
      enabled: config.enableTrusteeship === true,
      initialIncomingFingerprint:
        typeof sourceResult.baselineIncomingFingerprint === 'string'
          ? sourceResult.baselineIncomingFingerprint
          : ''
    };
  }

  return {
    checkReadiness: checkReadiness,
    fromSuccessfulContact: fromSuccessfulContact
  };
});
