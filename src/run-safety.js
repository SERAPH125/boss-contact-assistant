// 运行安全原语：固定配置、取消检查、平台隔离
(function (g, factory) {
  var api = factory();
  g.RunSafety = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  function runError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  function snapshotRunConfig(config) {
    return deepFreeze(JSON.parse(JSON.stringify(config || {})));
  }

  function checkpoint(state) {
    if (state && state.blocked) throw runError('RUN_BLOCKED', '运行已被安全停机');
    if (state && state.aborted) throw runError('RUN_CANCELLED', '运行已停止');
    return true;
  }

  function validateJobPlatform(job, platformId) {
    if (!job || !job.platform || job.platform !== platformId) {
      throw runError('PLATFORM_MISMATCH', '岗位平台与当前运行平台不一致');
    }
    return true;
  }

  function canSwitchPlatform(running, current, target) {
    return !running || current === target;
  }

  function canResetRun(running) {
    return !running;
  }

  function applyContactRecord(platformConfig, jobId, day) {
    var config = JSON.parse(JSON.stringify(platformConfig || {}));
    config.processed = config.processed || {};
    if (config.contactDay !== day) {
      config.contactDay = day;
      config.contactCount = 0;
    }
    if (config.processed[jobId]) {
      return { config: config, added: false };
    }
    config.processed[jobId] = 1;
    config.contactCount = (parseInt(config.contactCount, 10) || 0) + 1;
    return { config: config, added: true };
  }

  async function waitCancellable(durationMs, options) {
    var opts = options || {};
    var sleep = opts.sleep || function (ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    };
    var stepMs = Math.max(20, Number(opts.stepMs) || 250);
    var remaining = Math.max(0, Number(durationMs) || 0);
    var startedAt = Date.now();
    while (remaining > 0) {
      if (opts.isCancelled && opts.isCancelled()) {
        throw runError('RUN_CANCELLED', '运行已停止');
      }
      var step = Math.min(stepMs, remaining);
      await sleep(step);
      remaining -= step;
    }
    if (opts.isCancelled && opts.isCancelled()) {
      throw runError('RUN_CANCELLED', '运行已停止');
    }
    return Math.max(0, Date.now() - startedAt);
  }

  function isRunStop(error) {
    return !!(error && (error.code === 'RUN_CANCELLED' || error.code === 'RUN_BLOCKED'));
  }

  return {
    applyContactRecord: applyContactRecord,
    canResetRun: canResetRun,
    canSwitchPlatform: canSwitchPlatform,
    checkpoint: checkpoint,
    isRunStop: isRunStop,
    snapshotRunConfig: snapshotRunConfig,
    validateJobPlatform: validateJobPlatform,
    waitCancellable: waitCancellable
  };
});
