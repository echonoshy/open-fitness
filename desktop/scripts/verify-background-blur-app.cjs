// Packaged-app checks with recorded video, isolated storage and disabled services.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const desktop = path.resolve(__dirname, '..');
const out = process.argv[3] ? path.resolve(process.argv[3]) : path.join(desktop, 'output/background-blur-app');
const executablePath = process.argv[2] || path.join(desktop, 'release/mac-arm64/open-fitness.app/Contents/MacOS/open-fitness');
async function getPlaywright() {
  try { return require('playwright'); } catch {}
  for (const name of await fs.readdir(path.join(os.homedir(), '.npm/_npx'))) {
    try { return require(path.join(os.homedir(), '.npm/_npx', name, 'node_modules/playwright')); } catch {}
  }
  throw Error('Playwright installation not found');
}
(async () => {
  await fs.mkdir(out, { recursive: true });
  const profile = await fs.mkdtemp(path.join(out, 'profile-'));
  await fs.writeFile(path.join(profile, 'data.json'), JSON.stringify({ settings: { voice: false, onboardingSeen: true }, records: [] }));
  const config = JSON.parse(await fs.readFile(path.join(desktop, 'config/services.defaults.json'), 'utf8'));
  for (const s of Object.values(config)) if (s && typeof s === 'object' && 'baseUrl' in s) s.baseUrl = 'http://127.0.0.1:1/v1';
  const configPath = path.join(profile, 'test-services.json');
  await fs.writeFile(configPath, JSON.stringify(config));
  const { _electron } = await getPlaywright();
  const results = [];
  async function launch() {
    const app = await _electron.launch({ executablePath, env: { ...process.env, COACH_SERVICES_CONFIG: configPath }, args: [
      '--user-data-dir=' + profile, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      '--use-file-for-fake-video-capture=' + path.join(desktop, 'output/playwright/framing-20261027/pushup.y4m'),
    ] });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.locator('.exercise-trigger').waitFor();
    await page.evaluate(() => {
      window.__blurWorkers = 0; window.__blurInits = [];
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          super(url, options);
          if (!String(url).includes('pose-worker')) return;
          window.__blurWorkers++;
          this.addEventListener('message', e => {
            if (e.data.type === 'pose' && window.__failBlurOnce) {
              window.__failBlurOnce = false;
              e.data.effectError = 'controlled compositor failure';
            }
          });
          const send = this.postMessage.bind(this);
          this.postMessage = (data, ...rest) => {
            if (data.type === 'init') window.__blurInits.push({ enabled: data.backgroundBlur });
            return send(data, ...rest);
          };
        }
      };
    });
    return { app, page, errors };
  }
  async function start(page) {
    await page.getByRole('button', { name: /^切换动作，当前/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /^俯卧撑 / }).click();
    await page.getByRole('button', { name: '开始训练', exact: true }).first().click();
    await page.waitForFunction(() => document.querySelector('.training-stage').classList.contains('camera-live'), null, { timeout: 30000 });
  }
  const count = page => page.locator('.rep-ring strong').innerText().then(Number);
  // Inject ASR text at the actual App turn ref in the compiled package. This
  // exercises voice routing/dispatch/React/UI without using a physical mic.
  // Fail closed if the runtime shape changes; do not add a production test API.
  async function voice(page, text) {
    await page.evaluate(async text => {
      const el = document.querySelector('.training-stage');
      let fiber = el[Object.keys(el).find(key => key.startsWith('__reactFiber$'))];
      const candidates = new Set();
      for (; fiber; fiber = fiber.return) {
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const fn = hook.memoizedState?.current;
          if (typeof fn === 'function' && fn.constructor.name === 'AsyncFunction' && fn.length === 1) candidates.add(fn);
        }
      }
      if (candidates.size !== 1) throw Error('Cannot identify the unique App voice turn ref');
      await [...candidates][0](text);
    }, text);
  }
  {
    const { app, page, errors } = await launch();
    try {
      await fs.writeFile(path.join(out, 'initial.yml'), await page.locator('body').ariaSnapshot());
      await start(page);
      await page.waitForFunction(() => !document.querySelector('.camera-background-effect').hidden, null, { timeout: 15000 });
      await page.waitForFunction(() => Number(document.querySelector('.rep-ring strong').textContent) >= 1, null, { timeout: 20000 });
      await page.getByRole('button', { name: '取景设置', exact: true }).click();
      const toggle = page.getByRole('switch', { name: '背景虚化', exact: true });
      assert.equal(await toggle.getAttribute('aria-checked'), 'true');
      await page.getByRole('button', { name: '固定当前画面', exact: true }).click();
      const locked = await page.locator('.camera-image').getAttribute('style');
      const before = await count(page);
      await toggle.click();
      await page.waitForFunction(() => document.querySelector('.camera-background-effect').hidden);
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      await toggle.click();
      await page.waitForFunction(() => !document.querySelector('.camera-background-effect').hidden);
      assert.equal(await page.locator('.camera-image').getAttribute('style'), locked);
      await page.waitForFunction(n => Number(document.querySelector('.rep-ring strong').textContent) > n, before, { timeout: 20000 });
      assert.equal(await page.evaluate(() => window.__blurWorkers), 1);
      results.push({ check: 'default-on-toggle-preserves-worker-counting-and-manual-frame', before, after: await count(page), locked });
      if (process.argv.includes('--voice')) {
        const voiceBefore = await count(page);
        await voice(page, '关闭背景虚化');
        await page.waitForFunction(() => document.querySelector('.camera-background-effect').hidden);
        assert.equal(await toggle.getAttribute('aria-checked'), 'false');
        assert.equal(JSON.parse(await fs.readFile(path.join(profile, 'data.json'), 'utf8')).settings.backgroundBlur, false);
        await toggle.click();
        await page.waitForFunction(() => !document.querySelector('.camera-background-effect').hidden);
        await voice(page, '恢复清晰背景');
        await page.waitForFunction(() => document.querySelector('.camera-background-effect').hidden);
        assert.equal(await toggle.getAttribute('aria-checked'), 'false');
        await voice(page, '打开背景虚化');
        await page.waitForFunction(() => !document.querySelector('.camera-background-effect').hidden);
        assert.equal(await toggle.getAttribute('aria-checked'), 'true');
        assert.equal(await page.locator('.camera-image').getAttribute('style'), locked);
        assert.equal(await page.evaluate(() => window.__blurWorkers), 1);
        await page.waitForFunction(n => Number(document.querySelector('.rep-ring strong').textContent) > n, voiceBefore, { timeout: 20000 });
        results.push({ check: 'compiled-app-voice-transcripts-toggle-effect-and-ui-with-manual-interleave', before: voiceBefore, after: await count(page), workers: 1, locked });
        await page.screenshot({ path: path.join(out, 'voice-blur-on.png') });
      }
      const failBefore = await count(page);
      await page.evaluate(() => window.__failBlurOnce = true);
      await page.getByText('背景虚化暂不可用', { exact: false }).waitFor();
      assert.equal(await page.locator('.camera-background-effect').evaluate(el => el.hidden), true);
      assert.equal(await page.locator('.camera-image video').evaluate(el => el.srcObject.active), true);
      await page.waitForFunction(n => Number(document.querySelector('.rep-ring strong').textContent) > n, failBefore, { timeout: 20000 });
      await toggle.click(); await toggle.click();
      await page.waitForFunction(() => !document.querySelector('.camera-background-effect').hidden);
      results.push({ check: 'effect-failure-keeps-camera-and-counting-recoverable', before: failBefore, after: await count(page) });
      const geometry = await page.evaluate(() => {
        const v = document.querySelector('.camera-image video'), c = document.querySelector('.camera-background-effect');
        return { video: [v.videoWidth, v.videoHeight], effect: [c.width, c.height], sourceTransform: getComputedStyle(v).transform, effectTransform: getComputedStyle(c).transform };
      });
      assert.deepEqual(geometry.video, geometry.effect); assert.equal(geometry.sourceTransform, geometry.effectTransform);
      results.push({ check: 'shared-source-dimensions-and-transform', ...geometry });
      await page.screenshot({ path: path.join(out, 'background-blur-on.png') });
      await toggle.click();
      await page.waitForFunction(() => document.querySelector('.camera-background-effect').hidden);
      const saved = JSON.parse(await fs.readFile(path.join(profile, 'data.json'), 'utf8'));
      assert.equal(saved.settings.backgroundBlur, false);
      await page.screenshot({ path: path.join(out, 'background-blur-off.png') });
      assert.deepEqual(errors, []);
    } finally { await app.close(); }
  }
  {
    const { app, page, errors } = await launch();
    try {
      await start(page);
      await page.waitForFunction(() => window.__blurInits.length === 1);
      assert.equal(await page.evaluate(() => window.__blurInits[0].enabled), false);
      await page.getByRole('button', { name: '取景设置', exact: true }).click();
      const toggle = page.getByRole('switch', { name: '背景虚化', exact: true });
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      assert.equal(await page.locator('.camera-background-effect').evaluate(el => el.hidden), true);
      await toggle.click();
      await page.waitForFunction(() => !document.querySelector('.camera-background-effect').hidden);
      results.push({ check: 'saved-setting-survives-relaunch-and-can-enable-without-restart', workers: await page.evaluate(() => window.__blurWorkers) });
      assert.deepEqual(errors, []);
    } finally { await app.close(); }
  }
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ executablePath, profile, source: 'recorded push-up video through Chromium fake camera; real Full worker', results }, null, 2));
  console.log('PASS', JSON.stringify(results));
})().catch(async e => { await fs.mkdir(out, { recursive: true }); await fs.writeFile(path.join(out, 'failure.txt'), e.stack || String(e)); console.error(e); process.exitCode = 1; });
