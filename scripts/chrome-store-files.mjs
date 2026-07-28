import path from 'node:path';
import { lstat } from 'node:fs/promises';

export const CHROME_STORE_FILES = Object.freeze([
  'manifest.json',
  'LICENSE',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'src/api-permissions.js',
  'src/background.js',
  'src/delivery-guard.js',
  'src/greeting-template.js',
  'src/humanize.js',
  'src/message-send.js',
  'src/offscreen.html',
  'src/offscreen.js',
  'src/run-safety.js',
  'src/run-store.js',
  'src/sidepanel.css',
  'src/sidepanel.html',
  'src/sidepanel.js',
  'src/conversation/conversation-registration.js',
  'src/conversation/conversation-store.js',
  'src/conversation/feishu-notifier.js',
  'src/conversation/monitor-engine.js',
  'src/conversation/reply-ai.js',
  'src/conversation/trusteeship-live-drill.js',
  'src/conversation/trusteeship-policy.js',
  'src/conversation/trusteeship-runtime.js',
  'src/platform/config.js',
  'src/platform/registry.js',
  'src/platform/search-filters.js',
  'src/platform/boss/content-chat.js',
  'src/platform/boss/content-search.js',
  'src/platform/boss/conversation-reader.js',
  'src/platform/boss/peer-identity.js',
  'src/platform/boss/selectors.js',
  'src/platform/zhilian/content-chat.js',
  'src/platform/zhilian/content-search.js',
  'src/platform/zhilian/selectors.js'
]);

export async function validateReleaseFile(root, relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    path.posix.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath.split('/').includes('..')
  ) {
    throw new Error(`invalid release path: ${String(relativePath)}`);
  }
  const absolutePath = path.join(root, ...relativePath.split('/'));
  const stat = await lstat(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`release entry must be a regular file: ${relativePath}`);
  }
}
