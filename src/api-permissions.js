// 自定义 OpenAI 兼容端点的按源授权
(function (g, factory) {
  var api = factory();
  g.ApiPermissions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  function permissionPatternForBaseUrl(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    var url;
    try {
      url = new URL(raw);
    } catch (e) {
      throw new Error('Base URL 格式无效');
    }
    if (url.username || url.password) {
      throw new Error('Base URL 不得包含用户名或密码');
    }
    var protocol = url.protocol.toLowerCase();
    var hostname = url.hostname.toLowerCase();
    if (protocol === 'https:') return 'https://' + hostname + '/*';
    var local = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    if (protocol === 'http:' && local) return 'http://' + hostname + '/*';
    throw new Error('自定义 Base URL 必须使用 HTTPS；本机 localhost 可使用 HTTP');
  }

  async function ensure(chromeApi, value) {
    var pattern;
    try {
      pattern = permissionPatternForBaseUrl(value);
    } catch (e) {
      return { ok: false, error: e.message };
    }
    if (!pattern) return { ok: true, pattern: '' };
    try {
      // 直接从用户点击处理器调用，保留 Chrome 所需的 user gesture。
      var granted = await chromeApi.permissions.request({ origins: [pattern] });
      if (!granted) return { ok: false, error: '未获得自定义 API 域名访问授权：' + pattern };
      return { ok: true, pattern: pattern };
    } catch (e) {
      return { ok: false, error: '请求 API 域名授权失败：' + e.message };
    }
  }

  return {
    ensure: ensure,
    permissionPatternForBaseUrl: permissionPatternForBaseUrl
  };
});
