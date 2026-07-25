// 兼容旧路径：请改用 src/platform/boss/selectors.js
(function () {
  if (typeof importScripts === 'function') {
    try { importScripts('/src/platform/boss/selectors.js'); } catch (e) {}
  }
})();
