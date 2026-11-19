import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = process.env.GAME_URL ?? 'http://127.0.0.1:3104/stickfigure/';
const relay = process.argv.includes('--force-relay');
const requireDirect = process.argv.includes('--require-direct');
const soloOnly = process.argv.includes('--solo-only');
assert.ok(!(relay && requireDirect), 'Choose one transport requirement');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--disable-accelerated-2d-canvas', '--disable-renderer-backgrounding'],
});
const cdp = await browser.newBrowserCDPSession();
const { gpu } = await cdp.send('SystemInfo.getInfo');
assert.match(JSON.stringify(gpu.devices), /SwiftShader/i);
assert.match(gpu.featureStatus['2d_canvas'], /software|disabled/i);
console.log('PASS Chromium SwiftShader and software 2D canvas', gpu.featureStatus['2d_canvas']);
let stage = 'boot';
const clients = [];

async function open(url = root, { offline = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await context.newPage();
  page.setDefaultTimeout(18000);
  const history = [];
  if (offline) await page.route('**/api/multiplayer-room/', route => route.abort());
  page.on('response', async response => {
    if (!response.url().includes('/api/multiplayer-room/') || !response.ok()) return;
    try {
      const payload = await response.json();
      for (const event of payload.events ?? []) history.push(event);
    } catch { }
  });
  await page.addInitScript(forceRelay => {
    if (forceRelay) {
      window.RTCPeerConnection = undefined;
      window.webkitRTCPeerConnection = undefined;
      return;
    }
    const NativePeer = window.RTCPeerConnection;
    const direct = window.directPackets = [];
    const rtc = window.rtcDiagnostics = [];
    function track(channel) {
      channel.addEventListener('message', async ({ data }) => {
        try {
          const text = typeof data === 'string' ? data : data instanceof Blob
            ? await data.text() : new TextDecoder().decode(data);
          direct.push(JSON.parse(text));
        } catch { }
      });
    }
    window.RTCPeerConnection = class extends NativePeer {
      constructor(config) {
        super(config);
        const status = {};
        rtc.push(status);
        const capture = () => Object.assign(status, {
          ice: this.iceConnectionState, connection: this.connectionState,
          signaling: this.signalingState, gather: this.iceGatheringState,
        });
        for (const event of ['connectionstatechange', 'iceconnectionstatechange', 'signalingstatechange', 'icegatheringstatechange']) this.addEventListener(event, capture);
        this.addEventListener('datachannel', event => { status.channel = true; track(event.channel); });
      }
      createDataChannel(...args) {
        const channel = super.createDataChannel(...args);
        track(channel);
        return channel;
      }
    };
  }, relay);
  assert.equal((await page.goto(url, { waitUntil: 'domcontentloaded' })).status(), 200);
  const client = { page, context, history };
  clients.push(client);
  return client;
}
const button = (page, name) => page.getByRole('button', { name });
const roomButton = page => button(page, /^pvp-[a-z0-9]{9}$/);
const name = 'Cloud Guest';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const directPackets = client => relay ? [] : client.page.evaluate(() => window.directPackets);
async function packets(client) {
  const direct = await directPackets(client);
  if (requireDirect) return direct;
  const received = [...client.history, ...direct];
  return received.sort((a, b) => (a.data?.timestamp ?? 0) - (b.data?.timestamp ?? 0));
}
async function until(check, label, limit = 18000) {
  const expires = Date.now() + limit;
  while (Date.now() < expires) {
    const result = await check();
    if (result) return result;
    await delay(90);
  }
  throw new Error(label);
}

async function exercise(sender, receiver, key) {
  const sync = events => events.filter(event => event.name === 'playerSync');
  const before = await until(async () => sync(await packets(receiver)).at(-1), 'No incoming gameplay packet');
  await sender.page.bringToFront();
  await sender.page.keyboard.down(key);
  try {
    await until(async () => sync(await packets(receiver)).some(
      event => event.data.timestamp > before.data.timestamp && Math.abs(event.data.x - before.data.x) > 12
    ), 'Remote position did not change');
  } finally {
    await sender.page.keyboard.up(key);
  }
  const now = Date.now();
  await sender.page.keyboard.down('c');
  try {
    await until(async () => sync(await packets(receiver)).some(
      event => event.data.timestamp > now && Boolean(event.data.inputs?.kickLow)
    ), 'Remote attack input did not arrive');
  } finally {
    await sender.page.keyboard.up('c');
  }
}

async function playSoloBot(offline) {
  const { page, context } = await open(root, { offline });
  try {
    await page.getByPlaceholder('Enter your name').fill('Cloud Solo');
    await page.getByText('Empty Slot', { exact: true }).first().click();
    await page.getByText('Bot 2', { exact: true }).waitFor();
    if (offline) {
      await button(page, 'Start Game').click();
    } else {
      await button(page, 'Select Map').click();
      await button(page, /suburbia/i).click();
      await button(page, /start game/i).click();
      await button(page, /^✓?\s*ready$/i).click();
      await button(page, /start game/i).click();
    }
    await page.locator('.main-menu-screen').waitFor({ state: 'hidden' });
    await page.bringToFront();
    await page.getByRole('img', { name: 'Fight', exact: true }).waitFor({ state: 'hidden' });
    const readUi = () => page.evaluate(() => document.querySelector('canvas')?._ui);
    const initial = await until(async () => {
      const ui = await readUi();
      return ui?.opponent?.name === 'Bot 2' && ui;
    }, 'Configured Bot 2 did not spawn');
    let advanced;
    // Vary distance so the duelist leaves its preferred firing position.
    for (const direction of ['ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowLeft']) {
      await page.keyboard.down(direction);
      try {
        await page.waitForTimeout(1400);
      } finally {
        await page.keyboard.up(direction);
      }
      advanced = await readUi();
      if (advanced?.opponent && Math.abs(advanced.opponent.x - initial.opponent.x) > 3) break;
    }
    assert.ok(advanced?.opponent && Math.abs(advanced.opponent.x - initial.opponent.x) > 3,
      'Bot 2 did not change position as the player moved: ' + JSON.stringify({ initial: initial.opponent, last: advanced?.opponent }));
    assert.ok(advanced.maxHp > 0);
    console.log('PASS solo Bot 2 spawned and moved', { offline, botDistance: Math.round(Math.abs(advanced.opponent.x - initial.opponent.x)) });
  } finally {
    await context.close();
  }
}

try {
  if (!soloOnly) {
    stage = 'host and copied invite';
    const host = await open();
    await host.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await host.page.getByText('Hosting Lobby', { exact: true }).waitFor();
    const code = await roomButton(host.page).innerText();
    await button(host.page, 'Copy invite link').click();
    const invite = new URL(await host.page.evaluate(() => navigator.clipboard.readText()));
    assert.equal(invite.searchParams.get('room'), code);
    invite.searchParams.set('name', name);

    stage = 'guest join and explicit leave/rejoin';
    const guest = await open(invite.href);
    await guest.page.getByText('In Lobby', { exact: true }).waitFor();
    assert.equal(await roomButton(guest.page).innerText(), code);
    const guestOnHost = host.page.getByText(name, { exact: true }).first();
    await guestOnHost.waitFor();
    await button(guest.page, 'Leave Lobby').click();
    await guestOnHost.waitFor({ state: 'hidden' });
    await guest.page.getByPlaceholder('Enter your name').fill(name);
    await button(guest.page, 'Join Lobby').click();
    const input = guest.page.getByPlaceholder('Lobby code');
    await input.fill(code);
    await input.locator('xpath=ancestor::form[1]').locator('button[type=submit]').click();
    await guestOnHost.waitFor();
    assert.equal(await roomButton(guest.page).innerText(), code);
    console.log('PASS host, copy invite, guest join, explicit leave and same-room rejoin');

    stage = 'map and ready handshake';
    await button(host.page, 'Select Map').click();
    await button(host.page, /suburbia/i).click();
    await button(host.page, /start game/i).click();
    await guest.page.getByText('Suburbia', { exact: true }).waitFor();
    await button(guest.page, /^✓?\s*ready$/i).click();
    await button(host.page, /^✓?\s*ready$/i).click();
    await button(host.page, /start game/i).click();
    await Promise.all([host, guest].map(client => client.page.waitForFunction(() =>
      document.querySelector('canvas')?._ui?.maxHp > 0 && !document.querySelector('.main-menu-screen'))));
    console.log('PASS shared Suburbia selection, both ready states and both active matches');

    stage = 'reciprocal gameplay transport';
    await exercise(host, guest, 'ArrowRight');
    await exercise(guest, host, 'ArrowLeft');
    const peerPackets = (await Promise.all([host, guest].map(directPackets))).flat()
      .filter(event => event.name === 'playerSync').length;
    const relayPackets = [host, guest].flatMap(client => client.history)
      .filter(event => event.name === 'playerSync').length;
    assert.ok(peerPackets > 0 || relayPackets > 0);
    console.log('PASS reciprocal movement and combat input', { peerPackets, relayPackets });
    if (!relay && !peerPackets) console.log('WebRTC did not connect. Gameplay used the same-origin Hub relay.');
    stage = 'host closes active room';
    await host.page.goto('about:blank');
    await guest.page.getByPlaceholder('Enter your name').waitFor({ timeout: 25000 });
    console.log('PASS guest recovered to the menu after host departure');
    await host.context.close();
    await guest.context.close();

  }

  stage = 'solo bot with room service available';
  await playSoloBot(false);
  stage = 'solo bot without room service';
  await playSoloBot(true);
} catch (error) {
  console.error(stage, error);
  for (const client of clients) {
    const count = {};
    for (const event of client.history) {
      const label = event.name === 'rtcSignal' ? event.name + ':' + (event.data.type || 'candidate') : event.name;
      count[label] = (count[label] || 0) + 1;
    }
    console.error(JSON.stringify({ relayEvents: count, rtc: await client.page.evaluate(() => window.rtcDiagnostics).catch(() => null) }));
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
