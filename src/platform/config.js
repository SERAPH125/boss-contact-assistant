// 配置读写：activePlatform + byPlatform；兼容旧版扁平字段一次性迁移
(function (g) {
  if (g.__JOB_CONTACT_CONFIG__) return;
  g.__JOB_CONTACT_CONFIG__ = true;

  var LEGACY_KEYS = [
    'keyword', 'city', 'count', 'includeKeywords', 'excludeKeywords',
    'dailyLimit', 'intervalMinSec', 'intervalMaxSec', 'greetingTemplate',
    'contactDay', 'contactCount', 'filterInactive', 'activityMaxDays',
    'batchSize', 'batchRestMinSec', 'batchRestMaxSec', 'processed'
  ];

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  g.PlatformConfig = {
    todayStr: todayStr,

    ensureMigrated: function () {
      return chrome.storage.local.get(null).then(function (all) {
        if (all.configVersion >= 2 && all.byPlatform && all.activePlatform) {
          return all;
        }
        var byPlatform = all.byPlatform || {};
        if (!byPlatform.boss) {
          byPlatform.boss = g.defaultPlatformCfg('boss');
          LEGACY_KEYS.forEach(function (k) {
            if (all[k] !== undefined) byPlatform.boss[k] = all[k];
          });
        }
        if (!byPlatform.zhilian) byPlatform.zhilian = g.defaultPlatformCfg('zhilian');
        if (!byPlatform.liepin) byPlatform.liepin = g.defaultPlatformCfg('liepin');

        var patch = {
          configVersion: 2,
          activePlatform: all.activePlatform || 'boss',
          byPlatform: byPlatform,
          provider: all.provider || 'deepseek',
          apiKey: all.apiKey || all.dsKey || '',
          dsKey: all.apiKey || all.dsKey || '',
          baseUrl: all.baseUrl || '',
          resumeText: all.resumeText || '',
          resumeImage: all.resumeImage || '',
          hrFaq: Array.isArray(all.hrFaq) ? all.hrFaq : [],
          riskAccepted: !!all.riskAccepted,
          apiConfigVersion: Number.isSafeInteger(all.apiConfigVersion) &&
            all.apiConfigVersion >= 0 ? all.apiConfigVersion : 0,
          apiLastTestVersion: Number.isSafeInteger(all.apiLastTestVersion) &&
            all.apiLastTestVersion >= 0 ? all.apiLastTestVersion : 0
        };
        return chrome.storage.local.set(patch).then(function () {
          return Object.assign({}, all, patch);
        });
      });
    },

    /** 合并全局 API + 指定平台配置，运行中不得跟随 activePlatform 漂移 */
    loadFlatFor: function (platformId) {
      return g.PlatformConfig.ensureMigrated().then(function (all) {
        var pid = platformId || all.activePlatform || 'boss';
        var plat = (all.byPlatform && all.byPlatform[pid]) || g.defaultPlatformCfg(pid);
        var flat = Object.assign({}, plat, {
          activePlatform: pid,
          provider: all.provider || 'deepseek',
          apiKey: all.apiKey || all.dsKey || '',
          dsKey: all.apiKey || all.dsKey || '',
          baseUrl: all.baseUrl || '',
          resumeText: all.resumeText || '',
          resumeImage: all.resumeImage || '',
          hrFaq: Array.isArray(all.hrFaq) ? all.hrFaq : [],
          riskAccepted: !!all.riskAccepted,
          apiConfigVersion: Number.isSafeInteger(all.apiConfigVersion) &&
            all.apiConfigVersion >= 0 ? all.apiConfigVersion : 0,
          apiLastTestVersion: Number.isSafeInteger(all.apiLastTestVersion) &&
            all.apiLastTestVersion >= 0 ? all.apiLastTestVersion : 0
        });
        return flat;
      });
    },

    /** 合并全局 API + 当前平台配置，供启动新流程使用 */
    loadFlat: function () {
      return g.PlatformConfig.loadFlatFor();
    },

    saveApi: function (api) {
      return chrome.storage.local.get([
        'provider',
        'apiKey',
        'dsKey',
        'baseUrl',
        'apiConfigVersion'
      ]).then(function (current) {
        var currentKey = current.apiKey || current.dsKey || '';
        var credentialsChanged =
          (current.provider || 'deepseek') !== api.provider ||
          currentKey !== api.apiKey ||
          (current.baseUrl || '') !== api.baseUrl;
        var patch = {
          provider: api.provider,
          apiKey: api.apiKey,
          dsKey: api.apiKey,
          baseUrl: api.baseUrl,
          resumeText: api.resumeText
        };
        if (credentialsChanged) {
          var currentVersion = Number.isSafeInteger(current.apiConfigVersion) &&
            current.apiConfigVersion >= 0 ? current.apiConfigVersion : 0;
          patch.apiConfigVersion = currentVersion + 1;
          patch.apiLastTestOk = false;
          patch.apiLastTestAt = 0;
          patch.apiLastTestVersion = currentVersion;
        }
        return chrome.storage.local.set(patch).then(function () {
          return { identityChanged: credentialsChanged };
        });
      });
    },

    savePlatformFields: function (platformId, fields) {
      return g.PlatformConfig.ensureMigrated().then(function (all) {
        var by = all.byPlatform || {};
        var cur = Object.assign({}, by[platformId] || g.defaultPlatformCfg(platformId), fields);
        by[platformId] = cur;
        return chrome.storage.local.set({ byPlatform: by, activePlatform: platformId });
      });
    },

    setActivePlatform: function (platformId) {
      return chrome.storage.local.set({ activePlatform: platformId });
    },

    bumpDailyUsage: function (platformId) {
      return g.PlatformConfig.ensureMigrated().then(function (all) {
        var by = all.byPlatform || {};
        var cur = Object.assign({}, by[platformId] || g.defaultPlatformCfg(platformId));
        var day = todayStr();
        if (cur.contactDay !== day) {
          cur.contactDay = day;
          cur.contactCount = 0;
        }
        cur.contactCount = (parseInt(cur.contactCount, 10) || 0) + 1;
        by[platformId] = cur;
        return chrome.storage.local.set({ byPlatform: by }).then(function () {
          return {
            count: cur.contactCount,
            limit: Math.min(50, parseInt(cur.dailyLimit, 10) || 20)
          };
        });
      });
    },

    /** 一次 storage 写入同时提交去重与日计数，避免建联成功后只写入一半 */
    recordContact: function (platformId, jobId) {
      return g.PlatformConfig.ensureMigrated().then(function (all) {
        var by = all.byPlatform || {};
        var current = by[platformId] || g.defaultPlatformCfg(platformId);
        var result = g.RunSafety.applyContactRecord(current, jobId, todayStr());
        by[platformId] = result.config;
        return chrome.storage.local.set({ byPlatform: by }).then(function () {
          return {
            added: result.added,
            count: parseInt(result.config.contactCount, 10) || 0,
            limit: Math.min(50, parseInt(result.config.dailyLimit, 10) || 20),
            processed: result.config.processed
          };
        });
      });
    },

    setProcessed: function (platformId, processed) {
      return g.PlatformConfig.ensureMigrated().then(function (all) {
        var by = all.byPlatform || {};
        var cur = Object.assign({}, by[platformId] || g.defaultPlatformCfg(platformId));
        cur.processed = processed || {};
        by[platformId] = cur;
        return chrome.storage.local.set({ byPlatform: by });
      });
    },

    getUsage: function (platCfg) {
      var day = todayStr();
      if (platCfg.contactDay !== day) return { day: day, count: 0 };
      return { day: day, count: parseInt(platCfg.contactCount, 10) || 0 };
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
