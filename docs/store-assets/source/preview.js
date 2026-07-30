import { STORE_ASSET_SCENES, renderScene } from './scenes.mjs';

const params = new URLSearchParams(window.location.search);
const sceneId = params.get('scene') || 'job-screening';
const scene = STORE_ASSET_SCENES[sceneId];

if (!scene) {
  throw new Error(`未知商店素材场景：${sceneId}`);
}

document.documentElement.style.setProperty('--canvas-width', `${scene.width}px`);
document.documentElement.style.setProperty('--canvas-height', `${scene.height}px`);
document.body.dataset.scene = sceneId;
document.getElementById('asset-root').innerHTML = renderScene(sceneId);

window.__STORE_ASSET_READY__ = {
  sceneId,
  width: scene.width,
  height: scene.height,
  synthetic: true
};
