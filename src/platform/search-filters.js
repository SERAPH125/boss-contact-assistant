// 招聘平台搜索参数与结果二次校验（后台、侧边栏、内容脚本共用）
(function (g, factory) {
  var api = factory();
  g.SearchFilters = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  var CITY_CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  var CITY_CATALOG_ENDPOINTS = Object.freeze({
    boss: 'https://www.zhipin.com/wapi/zpgeek/common/data/city/site.json',
    zhilian: 'https://fe-api.zhaopin.com/c/i/search/base/data'
  });

  // Runtime catalog is authoritative. This fallback keeps already-supported
  // cities usable while the official catalog is temporarily unavailable.
  var BOSS_CITY_CODES = Object.freeze({
    '全国': '100010000',
    '北京': '101010100',
    '上海': '101020100',
    '广州': '101280100',
    '深圳': '101280600',
    '杭州': '101210100',
    '金华': '101210900',
    '成都': '101270100',
    '武汉': '101200100',
    '西安': '101110100',
    '南京': '101190100',
    '苏州': '101190400',
    '天津': '101030100',
    '重庆': '101040100',
    '长沙': '101250100',
    '郑州': '101180100',
    '沈阳': '101070100',
    '青岛': '101120200',
    '合肥': '101220100',
    '厦门': '101230200',
    '福州': '101230100',
    '济南': '101120100',
    '宁波': '101210400',
    '东莞': '101281600',
    '无锡': '101190200',
    '昆明': '101290100',
    '哈尔滨': '101050100',
    '长春': '101060100',
    '大连': '101070200',
    '石家庄': '101090100'
  });

  // 智联现行搜索路由要求数字城市 ID（例如杭州 /sou/jl653）。
  // 这些常用城市 ID 与现网页面交叉核验；未知城市必须失败关闭。
  var ZHILIAN_CITY_CODES = Object.freeze({
    '全国': '489',
    '北京': '530',
    '天津': '531',
    '上海': '538',
    '重庆': '551',
    '南京': '635',
    '杭州': '653',
    '金华': '659',
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

  function addCityCode(target, rawName, rawCode) {
    var name = firstCity(rawName);
    var code = rawCode === undefined || rawCode === null ? '' : String(rawCode);
    if (!name || !code) return;
    if (target[name] && target[name] !== code) {
      delete target[name];
      return;
    }
    target[name] = code;
  }

  function parseBossCityCatalog(payload) {
    var out = {};
    var data = payload && payload.zpData;
    if (!data) return out;

    (data.otherCitySites || []).forEach(function (city) {
      addCityCode(out, city && city.name, city && city.code);
    });
    (data.siteGroup || []).forEach(function (group) {
      (group && group.cityList || []).forEach(function (city) {
        addCityCode(out, city && city.name, city && city.code);
      });
    });
    (data.siteList || []).forEach(function (group) {
      (group && group.subLevelModelList || []).forEach(function (city) {
        addCityCode(out, city && city.name, city && city.code);
      });
    });
    return out;
  }

  function parseZhilianCityCatalog(payload) {
    var out = {};
    var groups = payload && payload.data && payload.data.allCity;
    (groups || []).forEach(function (group) {
      addCityCode(out, group && group.name, group && group.code);
      (group && group.sublist || []).forEach(function (city) {
        addCityCode(out, city && city.name, city && city.code);
      });
    });
    return out;
  }

  function clean(raw) {
    return String(raw || '').replace(/\s+/g, '').trim();
  }

  function resolveCityFromCodes(raw, codes) {
    var name = firstCity(raw);
    if (!name) return { name: '', code: '', found: true };
    var code = codes && codes[name] || '';
    return { name: name, code: code, found: !!code };
  }

  function resolveBossCity(raw, extraCodes) {
    var codes = Object.assign({}, BOSS_CITY_CODES, extraCodes || {});
    var result = resolveCityFromCodes(raw, codes);
    if (!result.name) result.code = BOSS_CITY_CODES['全国'];
    return result;
  }

  function resolveZhilianCity(raw) {
    var result = resolveCityFromCodes(raw, ZHILIAN_CITY_CODES);
    if (!result.name) result.code = ZHILIAN_CITY_CODES['全国'];
    return result;
  }

  function createCityCatalogResolver(options) {
    options = options || {};
    var now = options.now || function () { return Date.now(); };
    var fetchJson = options.fetchJson;
    var readCache = options.readCache || function () { return Promise.resolve(null); };
    var writeCache = options.writeCache || function () { return Promise.resolve(); };
    var ttlMs = Number(options.ttlMs) || CITY_CATALOG_TTL_MS;
    var memory = {};

    function fallbackCodes(platform) {
      return platform === 'boss' ? BOSS_CITY_CODES : ZHILIAN_CITY_CODES;
    }

    function parse(platform, payload) {
      return platform === 'boss'
        ? parseBossCityCatalog(payload)
        : parseZhilianCityCatalog(payload);
    }

    function cacheUsable(entry) {
      return !!(entry && entry.codes && Object.keys(entry.codes).length &&
        now() - Number(entry.savedAt || 0) < ttlMs);
    }

    async function cachedEntry(platform) {
      if (cacheUsable(memory[platform])) return memory[platform];
      var stored = await readCache();
      var entry = stored && stored[platform];
      if (entry && entry.codes && Object.keys(entry.codes).length) {
        memory[platform] = entry;
        if (cacheUsable(entry)) return entry;
      }
      return entry || null;
    }

    async function refresh(platform, prior) {
      if (typeof fetchJson !== 'function') return prior;
      try {
        var payload = await fetchJson(CITY_CATALOG_ENDPOINTS[platform]);
        var parsed = parse(platform, payload);
        if (!Object.keys(parsed).length) throw new Error('empty city catalog');
        var entry = {
          savedAt: now(),
          codes: Object.assign({}, fallbackCodes(platform), parsed)
        };
        memory[platform] = entry;
        var stored = await readCache() || {};
        stored[platform] = entry;
        await writeCache(stored);
        return entry;
      } catch (error) {
        return prior;
      }
    }

    async function resolve(platform, raw) {
      var name = firstCity(raw);
      if (!name) {
        var nationwide = platform === 'boss'
          ? BOSS_CITY_CODES['全国']
          : ZHILIAN_CITY_CODES['全国'];
        return { name: '', code: nationwide, found: true, source: 'fallback' };
      }

      var fallback = resolveCityFromCodes(name, fallbackCodes(platform));
      if (fallback.found) {
        return {
          name: fallback.name,
          code: fallback.code,
          found: true,
          source: 'fallback'
        };
      }

      var cached = await cachedEntry(platform);
      if (cacheUsable(cached) && cached.codes[name]) {
        return { name: name, code: String(cached.codes[name]), found: true, source: 'cache' };
      }

      var refreshed = await refresh(platform, cached);
      if (refreshed && refreshed.codes && refreshed.codes[name]) {
        return { name: name, code: String(refreshed.codes[name]), found: true, source: 'remote' };
      }
      return { name: name, code: '', found: false, source: 'unresolved' };
    }

    return { resolve: resolve };
  }

  function buildZhilianSearchUrl(cfg) {
    var city = cfg && cfg.resolvedCityCode
      ? { name: firstCity(cfg.city), code: String(cfg.resolvedCityCode), found: true }
      : resolveZhilianCity(cfg && cfg.city);
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
    CITY_CATALOG_ENDPOINTS: CITY_CATALOG_ENDPOINTS,
    BOSS_CITY_CODES: BOSS_CITY_CODES,
    ZHILIAN_CITY_CODES: ZHILIAN_CITY_CODES,
    firstCity: firstCity,
    parseBossCityCatalog: parseBossCityCatalog,
    parseZhilianCityCatalog: parseZhilianCityCatalog,
    resolveBossCity: resolveBossCity,
    resolveZhilianCity: resolveZhilianCity,
    createCityCatalogResolver: createCityCatalogResolver,
    buildZhilianSearchUrl: buildZhilianSearchUrl,
    matchZhilianJob: matchZhilianJob
  };
});
