// 平台注册表（借鉴 JobsIn BaseScraper 思路：新增平台只注册，不改主状态机）
(function (g) {
  if (g.__JOB_CONTACT_REGISTRY__) return;
  g.__JOB_CONTACT_REGISTRY__ = true;

  var COMMON_DEFAULTS = {
    keyword: '',
    city: '',
    includeKeywords: '',
    excludeKeywords: '',
    count: '20',
    dailyLimit: '20',
    intervalMinSec: '10',
    intervalMaxSec: '25',
    batchSize: '5',
    batchRestMinSec: '45',
    batchRestMaxSec: '90',
    greetingTemplate: '您好，我对这个岗位很感兴趣，方便聊聊吗？',
    contactDay: '',
    contactCount: 0,
    processed: {}
  };

  g.PLATFORMS = {
    boss: {
      id: 'boss',
      name: 'Boss 直聘',
      short: 'Boss',
      host: 'zhipin.com',
      loginHint: '尚未检测到 Boss 登录态。请先在浏览器打开并登录 zhipin.com，再扫描。',
      actionWord: '立即沟通',
      ready: true,
      tabQuery: '*://*.zhipin.com/*',
      chatPathHint: '/web/geek/chat',
      selectorsFile: 'src/platform/boss/selectors.js',
      searchScript: 'src/platform/boss/content-search.js',
      chatScript: 'src/platform/boss/content-chat.js',
      defaults: Object.assign({}, COMMON_DEFAULTS, {
        filterInactive: true,
        activityMaxDays: '7'
      }),
      buildSearchUrl: function (cfg) {
        var city = cfg && cfg.resolvedCityCode
          ? {
              name: SearchFilters.firstCity(cfg.city),
              code: String(cfg.resolvedCityCode),
              found: true
            }
          : SearchFilters.resolveBossCity(cfg && cfg.city);
        if (!city.found) throw new Error('Boss 暂无法识别城市“' + city.name + '”');
        var code = city.code;
        var params = new URLSearchParams({ query: cfg.keyword || '', city: code });
        return 'https://www.zhipin.com/web/geek/jobs?' + params.toString();
      },
      resolveCityLabel: function (cfg) {
        var city = cfg && cfg.resolvedCityCode
          ? {
              name: SearchFilters.firstCity(cfg.city),
              code: String(cfg.resolvedCityCode),
              found: true
            }
          : SearchFilters.resolveBossCity(cfg && cfg.city);
        return { name: city.name, code: city.code, found: city.found };
      }
    },
    zhilian: {
      id: 'zhilian',
      name: '智联招聘',
      short: '智联',
      host: 'zhaopin.com',
      loginHint: '尚未检测到智联登录态。请先在浏览器打开并登录 zhaopin.com，再扫描。',
      actionWord: '立即沟通 / 立即投递',
      ready: true,
      tabQuery: '*://*.zhaopin.com/*',
      // 智联网页沟通常不可用，主路径为列表「立即投递」；进 IM 时再发招呼
      chatPathHint: '',
      contactMode: 'hybrid',
      selectorsFile: 'src/platform/zhilian/selectors.js',
      searchScript: 'src/platform/zhilian/content-search.js',
      chatScript: 'src/platform/zhilian/content-chat.js',
      defaults: Object.assign({}, COMMON_DEFAULTS, {
        experience: '',
        education: ''
      }),
      buildSearchUrl: function (cfg) {
        return SearchFilters.buildZhilianSearchUrl(cfg);
      },
      resolveCityLabel: function (cfg) {
        var city = cfg && cfg.resolvedCityCode
          ? {
              name: SearchFilters.firstCity(cfg.city),
              code: String(cfg.resolvedCityCode),
              found: true
            }
          : SearchFilters.resolveZhilianCity(cfg && cfg.city);
        return { name: city.name, code: city.code, found: city.found };
      }
    }
  };

  g.getPlatform = function (id) {
    return g.PLATFORMS[id] || g.PLATFORMS.boss;
  };

  g.defaultPlatformCfg = function (id) {
    var p = g.getPlatform(id);
    return JSON.parse(JSON.stringify(p.defaults));
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
