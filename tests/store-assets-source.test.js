const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const test = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const scenesUrl = pathToFileURL(
  path.join(root, 'docs/store-assets/source/scenes.mjs')
).href;

const expectedScenes = {
  'job-screening': {
    width: 1280,
    height: 800,
    output: '01-job-screening.png'
  },
  'contact-confirmation': {
    width: 1280,
    height: 800,
    output: '02-contact-confirmation.png'
  },
  'ai-trusteeship': {
    width: 1280,
    height: 800,
    output: '03-ai-trusteeship.png'
  },
  'human-confirmation': {
    width: 1280,
    height: 800,
    output: '04-human-confirmation.png'
  },
  'execution-log': {
    width: 1280,
    height: 800,
    output: '05-execution-log.png'
  },
  'promo-small': {
    width: 440,
    height: 280,
    output: 'promo-small-440x280.png'
  },
  'promo-marquee': {
    width: 1400,
    height: 560,
    output: 'promo-marquee-1400x560.png'
  }
};

test('store asset scenes render the seven upload contracts with synthetic data', async () => {
  const { STORE_ASSET_SCENES, renderScene } = await import(scenesUrl);

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(STORE_ASSET_SCENES).map(([id, scene]) => [
        id,
        {
          width: scene.width,
          height: scene.height,
          output: scene.output
        }
      ])
    ),
    expectedScenes
  );

  for (const sceneId of Object.keys(expectedScenes)) {
    const rendered = renderScene(sceneId);
    assert.match(rendered, /data-synthetic="true"/);
    assert.match(rendered, /求职联系助手/);
    assert.doesNotMatch(
      rendered,
      /徐海霞|智驭信息|吴小龙|2ce53e5a7f33b646|API Key|Webhook/i
    );
    assert.doesNotMatch(rendered, /规避风控|保证安全|保证拿到 offer/i);
  }
});

test('store asset renderer rejects unknown scenes', async () => {
  const { renderScene } = await import(scenesUrl);

  assert.throws(
    () => renderScene('missing-scene'),
    /未知商店素材场景：missing-scene/
  );
});

test('store asset validator fails clearly when an output is missing', () => {
  const emptyAssetsDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'store-assets-empty-')
  );
  const validator = path.join(root, 'scripts/validate-store-assets.mjs');

  try {
    const result = spawnSync(
      process.execPath,
      [validator, '--assets-dir', emptyAssetsDir],
      { encoding: 'utf8' }
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /缺少商店素材：01-job-screening\.png/);
  } finally {
    fs.rmSync(emptyAssetsDir, { recursive: true, force: true });
  }
});
