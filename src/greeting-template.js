// 联系首条招呼：只渲染用户模板，不调用 LLM。
(function (g, factory) {
  var api = factory();
  g.GreetingTemplate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  var DEFAULT_GREETING = '您好，我对这个岗位很感兴趣，方便聊聊吗？';

  function renderGreetingTemplate(template, job) {
    var base = typeof template === 'string' && template.trim()
      ? template.trim()
      : DEFAULT_GREETING;
    var source = job && typeof job === 'object' ? job : {};
    var jobName = typeof source.name === 'string' ? source.name : '';
    var company = typeof source.company === 'string' ? source.company : '';
    return base
      .split('{jobName}').join(jobName)
      .split('{company}').join(company)
      .trim();
  }

  return {
    DEFAULT_GREETING: DEFAULT_GREETING,
    renderGreetingTemplate: renderGreetingTemplate
  };
});
