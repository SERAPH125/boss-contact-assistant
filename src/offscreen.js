// 仅在用户主动发起的有界任务期间存在；任务终止后由 Service Worker 关闭。
function heartbeat() {
  try { localStorage.setItem('jobContactHeartbeat', String(Date.now())); } catch (e) {}
  chrome.runtime.sendMessage({ type: 'KEEPALIVE', source: 'offscreen' }).catch(() => {});
}

heartbeat();
setInterval(heartbeat, 20000);
