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

  function fromSuccessfulContact(job, result) {
    var sourceJob = job && typeof job === 'object' ? job : {};
    var sourceResult = result && typeof result === 'object' ? result : {};
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
      initialIncomingFingerprint:
        typeof sourceResult.baselineIncomingFingerprint === 'string'
          ? sourceResult.baselineIncomingFingerprint
          : ''
    };
  }

  return {
    fromSuccessfulContact: fromSuccessfulContact
  };
});
