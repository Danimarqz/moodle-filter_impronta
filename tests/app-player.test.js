/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(__dirname + '/../js/app-player.js', 'utf8');

function harness(firstResponse, withV2 = false, subsequentResponse, options = {}) {
  let now = 0;
  let nextTimer = 1;
  let player;
  const timers = new Map();
  const requests = [];
  const documentListeners = {};
  const windowListeners = {};
  const v2Calls = [];
  const element = {
    attrs: {
      'data-impronta-playlist': '/playlist.m3u8',
      'data-impronta-poster': '/poster.jpg',
      'data-impronta-session': '/session',
      'data-impronta-watermark': 'student',
      'data-impronta-events': '/events',
      'data-impronta-subject': 'student',
      'data-impronta-path': 'lesson.m3u8'
    },
    getAttribute(name) { return this.attrs[name] || null; },
    setAttribute(name, value) { this.attrs[name] = value; },
    appendChild() {},
    textContent: ''
  };
  const document = {
    visibilityState: 'visible',
    head: {appendChild(node) { if (node.onload) node.onload(); }},
    body: {observe() {}},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return element.attrs['data-impronta-ready'] ? [] : [element]; },
    createElement(tag) {
      if (tag === 'script') {
        return {
          dataset: {},
          addEventListener(type, handler) { this['on' + type] = handler; }
        };
      }
      return {setAttribute() {}, appendChild() {}, style: {}, textContent: ''};
    },
    addEventListener(type, handler) { documentListeners[type] = handler; },
    removeEventListener(type, handler) {
      if (documentListeners[type] === handler) delete documentListeners[type];
    }
  };
  if (options.playlist) element.attrs['data-impronta-playlist'] = options.playlist;
  if (withV2) {
    element.attrs['data-impronta-batch'] = '/batch';
    element.attrs['data-impronta-realtime'] = '/realtime';
  }
  let videojsOptions;
  const renewals = [];
  const sources = [];
  const context = {
    window: {
      improntaApp: {wwwroot: '', componente: 'impronta', videojscss: '/video.css', videojs: '/video.js'},
      addEventListener(type, handler) { windowListeners[type] = handler; },
      removeEventListener(type, handler) {
        if (windowListeners[type] === handler) delete windowListeners[type];
      }
    },
    document,
    MutationObserver: function() { this.observe = function() {}; },
    setTimeout(handler, delay) {
      const id = nextTimer++;
      timers.set(id, {handler, delay, due: now + delay, repeat: false});
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval(handler, delay) {
      const id = nextTimer++;
      timers.set(id, {handler, delay, due: now + delay, repeat: true});
      return id;
    },
    clearInterval(id) { timers.delete(id); },
    fetch(url, requestOptions) {
      requests.push({url, options: requestOptions});
      if (options.transport) return options.transport(url, requestOptions);
      if (url === '/session' && requests.filter((r) => r.url === '/session').length === 1) {
        return firstResponse;
      }
      if (url === '/session' && subsequentResponse) return subsequentResponse;
      return Promise.resolve({ok: true, json: () => Promise.resolve({heartbeatSeconds: 60})});
    },
    videojs(video, options) { videojsOptions = options; return player; },
    ImprontaWatermark: {attach() { return {}; }},
    ImprontaWatermarkFit: {attach() {}},
    console
  };
  context.window.window = context.window;
  context.ImprontaAnalyticsV2 = () => {
    v2Calls.push('batch');
    return {setSession(id) { v2Calls.push('batch:' + id); },
      flush(reason) { v2Calls.push('flush:' + reason); }};
  };
  context.ImprontaRealtimeV2 = () => {
    v2Calls.push('wss');
    return {setSession(id) { v2Calls.push('wss:' + id); }, setCredentials() {}};
  };
  context.window.ImprontaWatermarkFit = context.ImprontaWatermarkFit;
  if (options.renew) {
    context.window.improntaApp.renewjs = '/renew.js';
    context.window.improntaApp.renew = (url, opts) => {
      renewals.push({url, options: opts});
      return options.renew(url, opts);
    };
    vm.runInNewContext(fs.readFileSync(__dirname + '/../js/playback-renew.js', 'utf8'), context);
  }
  if (options.realV2) {
    for (const name of ['fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']) {
      context.window[name] = context[name];
    }
    context.window.document = document;
    context.window.WebSocket = function() { this.readyState = 0; this.close = function() {}; };
    for (const name of ['analytics-v2', 'realtime-v2']) {
      vm.runInNewContext(fs.readFileSync(__dirname + '/../js/' + name + '.js', 'utf8'), context);
    }
    context.ImprontaAnalyticsV2 = context.window.ImprontaAnalyticsV2;
    context.ImprontaRealtimeV2 = context.window.ImprontaRealtimeV2;
  }
  player = {
    handlers: {},
    playing: false,
    position: 0,
    on(type, handler) { (this.handlers[type] ||= []).push(handler); },
    off(type, handler) { this.handlers[type] = (this.handlers[type] || []).filter(x => x !== handler); },
    one(type, handler) { this.on(type, handler); },
    emit(type) {
      if (type === 'play') this.playing = true;
      if (type === 'pause' || type === 'ended') this.playing = false;
      for (const handler of this.handlers[type] || []) handler();
    },
    paused() { return !this.playing; },
    play() { this.emit('play'); return Promise.resolve(); },
    src(source) { sources.push(source); this.emit('loadedmetadata'); },
    currentTime() { return this.position; },
    el() { return {querySelector() { return null; }}; },
    pause() { this.playing = false; },
    dispose() { this.emit('dispose'); }
  };
  vm.runInNewContext(source, context, {filename: 'app-player.js'});

  async function advance(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      const due = [...timers.entries()].find(([, timer]) => timer.due <= target);
      if (!due) break;
      now = due[1].due;
      if (due[1].repeat) due[1].due += due[1].delay;
      else timers.delete(due[0]);
      due[1].handler();
      await settle();
    }
    now = target;
    await settle();
  }
  async function settle() {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  }
  return {player, requests, renewals, sources, v2Calls, windowListeners, documentListeners, videojsOptions: () => videojsOptions, advance, settle};
}

test('cached app markup starts a new intent only on Play, before loading media or telemetry', async () => {
  const h = harness(Promise.resolve({ok: true, json: () => Promise.resolve({})}), true, undefined, {
    renew: async () => ({playlistUrl: '/fresh/playlist.m3u8', eventsUrl: '/fresh/events',
      sessionUrl: '/fresh/session', batchUrl: '/fresh/batch', realtimeUrl: '/fresh/realtime', samePlayback: false})
  });
  await h.settle();
  assert.equal(h.renewals.length, 0, 'mounting unused videos must not allocate sessions');
  assert.ok(!h.videojsOptions().sources?.length, 'cached media must not be installed before the new intent');
  await h.player.play();
  await h.settle();
  assert.equal(h.renewals.length, 1);
  assert.equal(h.renewals[0].options.newPlayback, true);
  assert.equal(h.sources[0].src, '/fresh/playlist.m3u8');
  h.player.emit('pause');
  await h.player.play();
  await h.settle();
  assert.equal(h.renewals.length, 1, 'pause/resume must preserve this instance identity');
});

test('foreground does not renew expired cached markup of an unused player', async () => {
  const h = harness(undefined, true, undefined, {playlist: '/playlist.m3u8?e=1',
    renew: async () => ({playlistUrl: '/fresh/playlist.m3u8', eventsUrl: '/fresh/events',
      sessionUrl: '/fresh/session', batchUrl: '/fresh/batch', realtimeUrl: '/fresh/realtime', samePlayback: true})});
  await h.settle();
  h.documentListeners.visibilitychange();
  await h.settle();
  assert.equal(h.renewals.length, 0);
  assert.deepEqual(h.sources, []);
  assert.equal(h.player.paused(), true);
});

test('two instances restored from identical markup submit sequence 1 under different server sessions', async () => {
  // The transport models the existing conditional receipt key, not the player:
  // an already accepted (session, sequence) cannot accept a different batchId.
  const receipts = new Map([['cached-session:1', 'previously-accepted']]);
  const accepted = [];
  const fresh = name => ({playlistUrl: '/' + name + '/playlist.m3u8', eventsUrl: '/' + name + '/events',
    sessionUrl: '/' + name + '/session', batchUrl: '/' + name + '/batch', realtimeUrl: '/' + name + '/realtime', samePlayback: false});
  for (const name of ['first', 'second']) {
    const h = harness(undefined, true, undefined, {realV2: true, renew: async () => fresh(name),
      transport: async (url, opts) => {
        if (url.endsWith('/realtime')) {
          const sessionId = url === '/realtime' ? 'cached-session' : name + '-session';
          return {ok: true, json: async () => ({sessionId, url: 'wss://test.invalid/wss', token: 'synthetic', expiresAt: 9999999999})};
        }
        if (url.endsWith('/batch')) {
          const batch = JSON.parse(opts.body);
          const key = batch.sessionId + ':' + batch.sequence;
          if (receipts.has(key) && receipts.get(key) !== batch.batchId) return {ok: false, status: 409};
          receipts.set(key, batch.batchId);
          accepted.push({url, session: batch.sessionId, sequence: batch.sequence});
        }
        return {ok: true, json: async () => ({})};
      }});
    await h.settle();
    await h.player.play();
    await h.settle();
    h.player.position = 1;
    h.player.emit('timeupdate');
    h.player.emit('pause');
    await h.settle();
    h.player.dispose();
  }
  assert.deepEqual(accepted, [
    {url: '/first/batch', session: 'first-session', sequence: 1},
    {url: '/second/batch', session: 'second-session', sequence: 1}
  ]);
  assert.equal(receipts.get('cached-session:1'), 'previously-accepted');
});

test('app video learners initialize WSS and batches without pilot attributes', async () => {
  const h = harness(Promise.resolve({ok: true, json: () => Promise.resolve({sessionId: 's1',
    realtime: {url: 'wss://app.impronta.video/wss', token: 'test', expiresAt: 9999999999}})}), true);
  await h.settle();
  assert.deepEqual(h.v2Calls, ['batch', 'wss']);
  h.player.emit('play');
  await h.advance(30000);
  const sessions = h.requests.filter((request) => request.url === '/session');
  assert.equal(sessions.length, 1);
  assert.equal(JSON.parse(sessions[0].options.body).realtime, true);
  assert.ok(h.v2Calls.includes('wss:s1'));
  assert.ok(h.v2Calls.includes('batch:s1'));
  assert.equal(h.requests.filter((request) => request.url === '/realtime').length, 0);
});

test('app Legacy heartbeat acknowledgements do not force V2 checkpoints', async () => {
  const response = () => Promise.resolve({ok: true, json: () => Promise.resolve({sessionId: 's1', heartbeatSeconds: 60})});
  const h = harness(response(), true, response());
  await h.settle();
  h.player.emit('play');
  await h.advance(180000);
  assert.ok(h.v2Calls.filter((call) => call === 'batch:s1').length >= 2);
  assert.deepEqual(h.v2Calls.filter((call) => call.startsWith('flush:')), []);
});

test('flushes seconds added while a heartbeat is in flight', async () => {
  let resolveFirst;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  const h = harness(first);

  await h.settle();
  assert.equal(h.videojsOptions().poster, '/poster.jpg');
  h.player.emit('play');
  await h.advance(30000);
  for (let position = 1; position <= 8; position += 1) {
    h.player.position = position;
    h.player.emit('timeupdate');
  }
  h.player.emit('pause');
  assert.equal(h.requests.filter((request) => request.url === '/session').length, 1);

  resolveFirst({ok: true, json: () => Promise.resolve({heartbeatSeconds: 60})});
  await h.settle();
  const sessions = h.requests.filter((request) => request.url === '/session');
  assert.equal(sessions.length, 2);
  assert.deepEqual(JSON.parse(sessions[1].options.body), {watchedSeconds: 8});
});

test('batches analytics for three minutes and flushes terminal events', async () => {
  const h = harness(Promise.resolve({ok: true, json: () => Promise.resolve({heartbeatSeconds: 60})}));
  await h.settle();
  h.player.emit('play');
  await h.advance(179999);
  assert.equal(h.requests.filter((request) => request.url === '/events').length, 0);
  await h.advance(1);

  let events = h.requests.filter((request) => request.url === '/events');
  assert.equal(events.length, 1);
  assert.equal(JSON.parse(events[0].options.body).flushReason, 'interval');
  assert.equal(JSON.parse(events[0].options.body).events.filter((event) => event.type === 'heartbeat').length, 6);

  h.player.emit('pause');
  h.player.emit('play');
  h.windowListeners.pagehide();
  events = h.requests.filter((request) => request.url === '/events');
  assert.deepEqual(events.slice(1).map((request) => JSON.parse(request.options.body).flushReason), ['pause', 'pagehide']);
});
