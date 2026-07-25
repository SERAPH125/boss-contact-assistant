// 招聘平台搜索参数与结果二次校验（后台、侧边栏、内容脚本共用）
(function (g, factory) {
  var api = factory();
  g.SearchFilters = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  // 智联现行搜索路由要求数字城市 ID（例如杭州 /sou/jl653）。
  // 这些常用城市 ID 与公开实现及智联现网页面交叉核验；未知城市必须失败关闭。
  var ZHILIAN_CITY_CODES = Object.freeze({
    '全国': '489',
    '北京': '530',
    '天津': '531',
    '上海': '538',
    '重庆': '551',
    '南京': '635',
    '杭州': '653',
    '厦门': '682',
    '武汉': '736',
    '广州': '763',
    '深圳': '765',
    '成都': '801',
    '西安': '854'
  });

  function firstCity(raw) {
    return String(raw || '')
      .trim()
      .split(/[\/、,，\s]+/)[0]
      .replace(/[市省]$/, '');
  }

  function clean(raw) {
    return String(raw || '').replace(/\s+/g, '').trim();
  }

  function resolveZhilianCity(raw) {
    var name = firstCity(raw);
    if (!name) return { name: '', code: '489', found: true };
    var code = ZHILIAN_CITY_CODES[name] || '';
    return { name: name, code: code, found: !!code };
  }

  function buildZhilianSearchUrl(cfg) {
    var city = resolveZhilianCity(cfg && cfg.city);
    if (!city.found) throw new Error('智联暂不支持城市“' + city.name + '”，请改用已支持的常用城市');
    var params = new URLSearchParams({
      jl: city.code,
      kw: (cfg && cfg.keyword) || ''
    });
    return 'https://www.zhaopin.com/sou/?' + params.toString();
  }

  function matchZhilianJob(job, cfg) {
    var requestedCity = firstCity(cfg && cfg.city);
    var location = clean(job && job.location).replace(/[市省]/, '');
    if (requestedCity && requestedCity !== '全国') {
      var cityPrefix = requestedCity + '·';
      if (location !== requestedCity && location.indexOf(cityPrefix) !== 0) {
        return { match: false, reason: 'city' };
      }
    }

    var requestedExperience = clean(cfg && cfg.experience);
    if (requestedExperience && clean(job && job.experience) !== requestedExperience) {
      return { match: false, reason: 'experience' };
    }

    var requestedEducation = clean(cfg && cfg.education);
    if (requestedEducation && clean(job && job.education) !== requestedEducation) {
      return { match: false, reason: 'education' };
    }

    return { match: true, reason: '' };
  }

  return {
    ZHILIAN_CITY_CODES: ZHILIAN_CITY_CODES,
    firstCity: firstCity,
    resolveZhilianCity: resolveZhilianCity,
    buildZhilianSearchUrl: buildZhilianSearchUrl,
    matchZhilianJob: matchZhilianJob
  };
});
