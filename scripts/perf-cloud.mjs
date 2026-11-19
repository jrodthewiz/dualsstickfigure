import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root = process.env.GAME_URL ?? 'http://127.0.0.1:3106/stickfigure/';
const seconds = Number(process.env.SAMPLE_SECONDS || 6);
const captureDirectory = process.env.CAPTURE_DIR;
if (captureDirectory) await mkdir(captureDirectory, { recursive: true });
const viewport = { width: Number(process.env.VIEWPORT_WIDTH || 1280), height: Number(process.env.VIEWPORT_HEIGHT || 720) };
const swiftShader = process.argv.includes('--swiftshader');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  args: ['--no-sandbox', ...(swiftShader ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--disable-gpu']),
    '--disable-accelerated-2d-canvas', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
});
const { gpu } = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
if (swiftShader) assert.match(JSON.stringify(gpu.devices), /SwiftShader/i);
assert.match(gpu.featureStatus['2d_canvas'], /software|disabled/i);
console.log(JSON.stringify({ chromium: browser.version(), renderer: gpu.featureStatus['2d_canvas'], compositing: gpu.featureStatus.gpu_compositing, swiftShader, viewport, seconds }));
const errors = [];
const timings = [];
const button = (page, name) => page.getByRole('button', { name });

async function open(url = root) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: Number(process.env.DPR || 1) });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  page.on('pageerror', error => errors.push(error.message));
  assert.equal((await page.goto(url, { waitUntil: 'domcontentloaded' })).status(), 200);
  return { context, page };
}

async function launch(host, map, guest) {
  await button(host, 'Select Map').click();
  await button(host, new RegExp('^' + map, 'i')).click();
  await button(host, /start game/i).click();
  if (guest) {
    await guest.getByText(map, { exact: true }).waitFor();
    await button(guest, /^✓?\s*ready$/i).click();
  }
  await button(host, /^✓?\s*ready$/i).click();
  await button(host, /start game/i).click();
  for (const page of [host, guest].filter(Boolean)) {
    await page.locator('.main-menu-screen').waitFor({ state: 'hidden' });
    await page.getByRole('img', { name: 'Fight', exact: true }).waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('canvas')?._ui?.maxHp > 0);
  }
}

function summary(samples) {
  const values = [...samples].sort((a, b) => a - b);
  const pick = p => Number(values[Math.floor((values.length - 1) * p)]?.toFixed(2));
  return { p50: pick(.5), p95: pick(.95), p99: pick(.99), max: pick(1) };
}

async function measure(page, scenario, direction = 'ArrowRight') {
  const combat = scenario !== 'idle';
  if (scenario === 'projectiles') {
    await page.keyboard.press('2');
    await page.keyboard.press('8');
  } else if (combat) {
    await page.keyboard.press('1');
  }
  if (combat) {
    await page.keyboard.down(direction);
    await page.keyboard.down('z');
  }
  let driving = combat;
  const drive = (async () => {
    let current = direction;
    while (driving) {
      await page.waitForTimeout(850);
      if (!driving) break;
      const hp = await page.evaluate(() => document.querySelector('canvas')?._ui?.hp);
      if (hp === 0) await page.keyboard.press('r');
      await page.keyboard.up(current);
      current = current === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
      await page.keyboard.down(current);
      await page.keyboard.press('Space');
    }
  })();
  try {
    const result = await page.evaluate(duration => new Promise(resolve => {
      const intervals = [], render = [], update = [], tiers = new Set();
      let start, previous, lastFrame, active = 0, deepestY = -Infinity;
      const frame = now => {
        const telemetry = window.__platformerFrameTelemetry;
        if (start === undefined) start = now;
        if (previous !== undefined) intervals.push(now - previous);
        previous = now;
        const ui = document.querySelector('canvas')?._ui;
        if (ui?.hp > 0) active++;
        if (Number.isFinite(ui?.position?.y)) deepestY = Math.max(deepestY, ui.position.y);
        if (telemetry && telemetry.frame !== lastFrame) {
          render.push(telemetry.renderMs);
          update.push(telemetry.updateMs);
          if (telemetry.quality !== undefined) tiers.add(telemetry.quality);
          lastFrame = telemetry.frame;
        }
        if (now - start < duration) requestAnimationFrame(frame);
        else resolve({ intervals, render, update, elapsed: now - start, visible: !document.hidden, tiers: [...tiers], active, deepestY });
      };
      requestAnimationFrame(frame);
    }), seconds * 1000);
    assert.ok(result.visible);
    assert.ok(result.render.length > 4, 'Game rendering did not advance');
    const metrics = {
      activePercent: Math.min(100, Math.round(result.active * 100 / result.intervals.length)),
      deepestY: Math.round(result.deepestY),
      fps: Number((result.intervals.length * 1000 / result.elapsed).toFixed(1)),
      frameMs: summary(result.intervals), renderMs: summary(result.render), updateMs: summary(result.update),
      qualityTiers: result.tiers, missed: result.intervals.filter(ms => ms > 20).length, over50Ms: result.intervals.filter(ms => ms > 50).length,
    };
    timings.push(metrics);
    return metrics;
  } finally {
    driving = false;
    await drive;
    if (combat) {
      await page.keyboard.up('z');
      await page.keyboard.up('ArrowLeft');
      await page.keyboard.up('ArrowRight');
    }
  }
}

try {
  for (const map of process.env.MAP ? [process.env.MAP] : ['Metropolis', 'Suburbia', 'Rooftops']) {
    const host = await open();
    try {
      await host.page.getByText('Hosting Lobby', { exact: true }).waitFor();
      for (let i = 0; i < 3; i++) await host.page.getByText('Empty Slot', { exact: true }).first().click();
      await launch(host.page, map);
      await host.page.waitForFunction(() => document.querySelector('canvas')?._ui?.opponent?.name === 'Bot 2');
      console.log(JSON.stringify({ map, scenario: 'three AI opponents + melee traversal', ...await measure(host.page, 'melee') }));
      if (captureDirectory) await host.page.screenshot({ path: join(captureDirectory, map.toLowerCase() + '.png') });
      if (await host.page.evaluate(() => document.querySelector('canvas')?._ui?.hp > 0)) {
        await host.page.keyboard.press('p');
      }
      await host.page.keyboard.press('r');
      await host.page.waitForFunction(() => document.querySelector('canvas')?._ui?.hp > 0);
      await host.page.waitForFunction(() => document.querySelector('canvas')?._ui?.opponent?.name === 'Bot 2');
      console.log(JSON.stringify({ map, scenario: 'restart + three AI opponents + projectiles', ...await measure(host.page, 'projectiles', 'ArrowLeft') }));
    } finally {
      await host.context.close();
    }
    if (process.argv.includes('--solo-only')) continue;
    const two = await open();
    let guest;
    try {
      const code = await button(two.page, /^pvp-[a-z0-9]{9}$/).innerText();
      const invite = new URL(root);
      invite.searchParams.set('room', code);
      invite.searchParams.set('name', 'Perf Guest');
      guest = await open(invite.href);
      await guest.page.getByText('In Lobby', { exact: true }).waitFor();
      await two.page.getByText('Perf Guest', { exact: true }).first().waitFor();
      await launch(two.page, map, guest.page);
      const [hostPerf, guestPerf] = await Promise.all([measure(two.page, 'projectiles'), measure(guest.page, 'melee', 'ArrowLeft')]);
      console.log(JSON.stringify({ map, scenario: 'two live clients', host: hostPerf, guest: guestPerf }));
    } finally {
      await guest?.context.close();
      await two.context.close();
    }
  }
  assert.deepEqual(errors, []);
  assert.ok(timings.every(result => result.activePercent >= 85), 'A sample spent too much time out of combat');
  if (process.argv.includes('--require-60')) {
    assert.ok(timings.length > 0 && timings.every(result => result.fps >= 59.5 && result.frameMs.p95 <= 20),
      'At least one workload missed the 60 Hz frame budget');
  }
} finally {
  await browser.close();
}
