/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const root = process.env.IMPRONTA_PLUGIN_ROOT || __dirname + '/..';
const source = fs.readFileSync(root + '/js/player-extras.js', 'utf8');

function harness(sessionFetch, withV2 = false, extraConfig = {}, realRealtime = false) {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const requests = [];
  const listeners = {};
  const windowListeners = {};
  const v2Calls = [];
  const element = {parentNode: {insertBefore() {}}};
  const player = {
    handlers: {},
    playing: false,
    position: 0,
    source: null,
    on(type, handler) {
      (this.handlers[type] ||= []).push(handler);
    },
    off(type, handler) {
      this.handlers[type] = (this.handlers[type] || []).filter((item) => item !== handler);
    },
    one(type, handler) {
      const once = () => {
        this.handlers[type] = (this.handlers[type] || []).filter((item) => item !== once);
        handler();
      };
      this.on(type, once);
    },
    emit(type) {
      if (type === 'play') this.playing = true;
      if (type === 'pause' || type === 'ended') this.playing = false;
      for (const handler of this.handlers[type] || []) handler();
    },
    ready(handler) { handler(); },
    paused() { return !this.playing; },
    play() { this.emit('play'); return Promise.resolve(); },
    currentTime() { return this.position; },
    pause() { this.playing = false; },
    src(value) { if (value && value.src) this.source = value.src; },
  };
  const context = {
    window: {},
    document: {
      readyState: 'complete',
      visibilityState: 'visible',
      getElementById() { return element; },
      addEventListener(type, handler) { listeners[type] = handler; },
      removeEventListener(type, handler) {
        if (listeners[type] === handler) delete listeners[type];
      },
      createElement() { return {setAttribute() {}, style: {}, textContent: ''}; },
    },
    videojs: {getPlayer() { return player; }},
    fetch(url, options) {
      requests.push({url, options});
      if (url === '/session' && sessionFetch) return sessionFetch(requests.length, options);
      return Promise.resolve({ok: true, json: () => Promise.resolve({heartbeatSeconds: 75})});
    },
    setTimeout(handler, delay) {
      const id = nextId++;
      timers.set(id, {handler, delay, due: now + delay, repeat: false});
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval(handler, delay) {
      const id = nextId++;
      timers.set(id, {handler, delay, due: now + delay, repeat: true});
      return id;
    },
    clearInterval(id) { timers.delete(id); },
    Date: {now: () => now},
    FormData,
    AbortController,
    console,
    addEventListener(type, handler) { windowListeners[type] = handler; },
    removeEventListener(type, handler) {
      if (windowListeners[type] === handler) delete windowListeners[type];
    },
  };
  context.window = context;
  context.ImprontaAnalyticsV2 = (video, cfg) => {
    v2Calls.push('batch');
    context.testConfig = cfg;
    return {setSession(id) { v2Calls.push('batch:' + id); },
      flush(reason) { v2Calls.push('flush:' + reason); }};
  };
  if (realRealtime) {
    vm.runInNewContext(fs.readFileSync(root + '/js/realtime-v2.js', 'utf8'), context, {filename: 'realtime-v2.js'});
  } else {
    context.ImprontaRealtimeV2 = (video, cfg) => {
      v2Calls.push('wss');
      return {setSession(id) { v2Calls.push('wss:' + id); }, setCredentials() {}};
    };
  }
  vm.runInNewContext(fs.readFileSync(root + '/js/playback-renew.js', 'utf8'), context, {filename: 'playback-renew.js'});
  vm.runInNewContext(source, context, {filename: 'player-extras.js'});
  const playerConfig = {
    targetId: 'video',
    eventsUrl: '/events',
    sessionUrl: '/session',
    subject: 'student',
    videoPath: 'lesson.m3u8',
    heartbeatSeconds: 15,
    ...extraConfig,
    ...(withV2 ? {batchUrl: '/batch', realtimeUrl: '/realtime'} : {}),
  };
  context.testConfig = playerConfig;
  context.ImprontaPlayerExtras(playerConfig);

  async function advance(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      let next = null;
      for (const [id, timer] of timers) {
        if (timer.due <= target && (!next || timer.due < next.timer.due)) next = {id, timer};
      }
      if (!next) break;
      now = next.timer.due;
      if (next.timer.repeat) next.timer.due += next.timer.delay;
      else timers.delete(next.id);
      next.timer.handler();
      await settle();
    }
    now = target;
    await settle();
  }

  async function settle() {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  }

  return {player, requests, v2Calls, listeners, windowListeners, document: context.document, advance, settle,
    config: context.testConfig, context};
}

test('same-session retoken keeps the financial batch ID after an ambiguous acknowledgement', async () => {
  let rejectFirst;
  const h = harness(() => new Promise((resolve,reject) => { rejectFirst = reject; }),true);
  h.config.playlistUrl = '/old-manifest';
  h.config.sessionId = 'same-session';
  h.player.emit('play');
  for (let i=1;i<=6;i++) { h.player.position = i; h.player.emit('timeupdate'); }
  h.player.emit('pause'); await h.settle();
  const original = JSON.parse(h.requests.find(r => r.url === '/session').options.body);
  vm.runInNewContext(fs.readFileSync(root + '/js/playback-renew.js','utf8'),h.context);
  await h.context.ImprontaPlaybackRenew(h.config,() => Promise.resolve({samePlayback:true,
    playlistUrl:'/renewed-manifest',eventsUrl:'/renewed-events',sessionUrl:'/renewed-session',batchUrl:'/renewed-batch',realtimeUrl:'/renewed-realtime',expiresAt:1900000000}))();
  rejectFirst(new Error('lost ACK after commit')); await h.settle();
  h.player.emit('play'); await h.advance(120000);
  const retry = JSON.parse(h.requests.find(r => r.url === '/renewed-session').options.body);
  assert.equal(retry.batchId,original.batchId);
  assert.equal(retry.watchedSeconds,original.watchedSeconds);
});

test('all video learners initialize V2 without an experimental flag or extra credential request', async () => {
  const h = harness(() => Promise.resolve({ok: true, json: () => Promise.resolve({sessionId: 's1',
    realtime: {url: 'wss://app.impronta.video/wss', token: 'test', expiresAt: 9999999999}})}), true);
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

function watch(player, seconds) {
  for (let position = 1; position <= seconds; position += 1) {
    player.position = position;
    player.emit('timeupdate');
  }
}

test('Legacy heartbeat acknowledgements do not force V2 checkpoints', async () => {
  const h = harness(() => Promise.resolve({ok: true, json: () => Promise.resolve({sessionId: 's1', heartbeatSeconds: 60})}), true);
  h.player.emit('play');
  await h.advance(180000);
  assert.ok(h.v2Calls.filter((call) => call === 'batch:s1').length >= 2);
  assert.deepEqual(h.v2Calls.filter((call) => call.startsWith('flush:')), []);
});

test('web first playback crosses the backend fragment TTL via the existing heartbeat callsite', async () => {
  const h = harness(() => Promise.resolve({ok: true, json: () => Promise.resolve({sessionId: 's1',
    authorizedPlayback: true, fragmentLeaseExpiresAt: 900,
    realtime: {url: 'wss://test.invalid', token: 'wss', expiresAt: 21600,
      manifestExpiresAt: 9999999999}})}), true, {
    authorizedPlayback: true,
    playlistUrl: '/filter/impronta/playlist.php?f=class&e=21600',
    fragmentLeaseExpiresAt: 0,
  });
  let renewals = 0;
  const renew = h.context.window.ImprontaPlaybackRenew(h.config, () => {
    renewals++;
    return Promise.resolve({playlistUrl:'/fresh', eventsUrl:'/fresh-events', sessionUrl:'/fresh-session',
      batchUrl:'/fresh-batch', realtimeUrl:'/fresh-realtime', diagnosticUrl:'/fresh-diagnostic',
      expiresAt: 43200, samePlayback: true});
  });
  h.context.window.ImprontaAuthorizedLifecycle(h.player, h.config, renew);
  h.player.emit('play');
  await h.advance(30000);
  assert.equal(h.config.fragmentLeaseExpiresAt, 900,
    'existing Moodle heartbeat callsite propagates authorized.expires_at, not nested WSS or URL e');
  await h.advance(780000);
  h.player.emit('timeupdate');
  await h.settle();
  assert.equal(renewals, 1, 'first 15-minute fragment lease is renewed before expiry');
});

test('heartbeat for a reincarnated session URL cannot restore the previous source lease', async () => {
  let finishHeartbeat;
  const h = harness(() => new Promise(resolve => { finishHeartbeat = resolve; }), false, {
    authorizedPlayback: true,
    playlistUrl: '/old-manifest',
    fragmentLeaseExpiresAt: 900,
    realtimeUrl: '/realtime',
    enabled: false,
  }, true);
  let renewals = 0;
  let finishRenewal;
  const renew = h.context.ImprontaPlaybackRenew(h.config, () => {
    renewals++;
    return new Promise(resolve => { finishRenewal = resolve; });
  });
  const fresh = {
    playlistUrl: '/fresh-manifest', eventsUrl: '/fresh-events', sessionUrl: '/session',
    batchUrl: '/fresh-batch', realtimeUrl: '/fresh-realtime', expiresAt: 21600,
    samePlayback: true,
  };
  h.context.ImprontaAuthorizedLifecycle(h.player, h.config, renew);
  h.player.emit('play');
  await h.advance(30000);
  assert.equal(typeof finishHeartbeat, 'function', 'the original-session heartbeat is in flight');

  h.config.fragmentLeaseExpiresAt = 1;
  h.player.emit('timeupdate');
  await h.settle();
  assert.equal(renewals, 1, 'the real playback callsite starts renewal on the expired capability');
  finishRenewal(fresh);
  await renew(); // Join the same in-flight request to know when the source swap is installed.
  await h.settle();
  assert.ok(h.player.handlers.loadedmetadata?.length, 'the renewed source waits for metadata');
  h.player.emit('loadedmetadata');
  await h.settle();
  assert.equal(h.config.fragmentLeaseExpiresAt, 0, 'new metadata invalidates the previous capability deadline');

  finishHeartbeat({ok: true, json: () => Promise.resolve({
    sessionId: 'same-session', authorizedPlayback: true, fragmentLeaseExpiresAt: 50,
  })});
  await h.settle();
  assert.equal(h.config.fragmentLeaseExpiresAt, 0,
    'same session URL is not sufficient to adopt a heartbeat from the previous source generation');
});

test('web player renewal forwards AbortSignal and bounds a stalled authenticated fetch', async () => {
  const h = harness(null, false, {
    authorizedPlayback: true,
    renewUrl: '/renew.php',
    sesskey: 'synthetic-sesskey',
    realtimeUrl: '/realtime',
    enabled: false,
  }, true);
  const renewRequests = [];
  h.context.fetch = (url, options) => {
    if (url === '/renew.php') {
      renewRequests.push(options);
      if (renewRequests.length === 1) { return new Promise(() => {}); }
      return Promise.resolve({ok: true, json: () => Promise.resolve({
        playlistUrl: '/retried-playlist', eventsUrl: '/retried-events',
        sessionUrl: '/retried-session', batchUrl: '/retried-batch',
        realtimeUrl: '/retried-realtime', expiresAt: 21600,
      })});
    }
    return Promise.resolve({ok: true, json: () => Promise.resolve({heartbeatSeconds: 60})});
  };

  h.player.emit('play');
  h.player.emit('error');
  await h.settle();
  assert.equal(renewRequests.length, 1, 'the real player error path reaches Moodle renewal');
  assert.ok(renewRequests[0].signal, 'the authenticated POST receives an abort signal');
  await h.advance(16000);
  assert.equal(renewRequests[0].signal.aborted, true, 'the deadline aborts the unresolved web request');
  await h.advance(30001);
  h.player.emit('timeupdate');
  await h.settle();
  assert.equal(renewRequests.length, 2, 'timed-out renewal releases the player lifecycle for a later retry');
});

function renewalResponse(samePlayback) {
  return {ok: true, json: () => Promise.resolve({playlistUrl: '/new-manifest',
    eventsUrl: '/new-events', sessionUrl: '/new-session', batchUrl: '/new-batch',
    realtimeUrl: '/new-realtime', expiresAt: 21600, samePlayback})};
}

async function waitForSource(h) {
  for (let i = 0; i < 20 && !h.player.source; i += 1) await h.settle();
}

async function settleRenewal(h) {
  for (let i = 0; i < 12; i += 1) await h.settle();
}

test('Play after ended queues a new playback identity behind an in-flight renewal', async () => {
  let finishFirst;
  const h = harness(null, false, {authorizedPlayback: true, renewUrl: '/renew.php',
    playlistUrl: '/old-manifest', sesskey: 'synthetic'});
  h.player.source = '/old-manifest';
  const renewRequests = [];
  h.context.fetch = (url, options) => {
    if (url !== '/renew.php') return Promise.resolve({ok: true, json: () => Promise.resolve({})});
    renewRequests.push(options);
    if (renewRequests.length === 1) return new Promise(resolve => { finishFirst = resolve; });
    return Promise.resolve(renewalResponse(false));
  };

  h.player.emit('play');
  h.player.emit('error');
  await settleRenewal(h);
  assert.equal(renewRequests.length, 1, 'an ordinary recovery is pending');
  h.player.emit('ended');
  h.player.play();
  await settleRenewal(h);

  assert.equal(h.player.paused(), true, 'replay must stop the old source immediately');
  assert.equal(h.player.source, '/old-manifest', 'old source remains installed until a fresh intent is authorized');
  finishFirst(renewalResponse(true));
  await settleRenewal(h);

  assert.equal(renewRequests.length, 2, 'the queued replay starts after the ordinary renewal settles');
  assert.equal(renewRequests[1].body.get('newplayback'), '1', 'the queued request creates a new logical playback identity');
  assert.equal(h.player.paused(), true, 'the old source never resumes while the new intent loads');
  assert.equal(h.player.source, '/new-manifest');
  h.player.emit('loadedmetadata');
  await h.settle();
  assert.equal(h.player.paused(), false, 'the explicitly requested replay starts after new metadata');
});

test('Play after ended during renewal backoff waits once and requests a new identity', async () => {
  const h = harness(null, false, {authorizedPlayback: true, renewUrl: '/renew.php',
    playlistUrl: '/old-manifest', sesskey: 'synthetic'});
  const renewRequests = [];
  h.context.fetch = (url, options) => {
    if (url !== '/renew.php') return Promise.resolve({ok: true, json: () => Promise.resolve({})});
    renewRequests.push(options);
    return renewRequests.length === 1
      ? Promise.resolve({ok: false, status: 503})
      : Promise.resolve(renewalResponse(false));
  };

  h.player.emit('play');
  h.player.emit('error');
  await settleRenewal(h);
  h.player.emit('ended');
  h.player.play();
  await settleRenewal(h);
  assert.equal(h.player.paused(), true, 'ended replay cannot continue on the old identity during backoff');
  assert.equal(renewRequests.length, 1);

  await h.advance(29999);
  assert.equal(renewRequests.length, 1, 'backoff prevents an early retry');
  await h.advance(1);
  assert.equal(renewRequests.length, 2, 'one retry starts when backoff expires');
  assert.equal(renewRequests[1].body.get('newplayback'), '1');
  assert.equal(h.player.paused(), true);
  h.player.emit('loadedmetadata');
  await h.settle();
  assert.equal(h.player.paused(), false);
});

test('media error while explicitly paused renews the source without autoplay', async () => {
  const h = harness(null, false, {authorizedPlayback: true, renewUrl: '/renew.php',
    playlistUrl: '/old-manifest', sesskey: 'synthetic'});
  const renewRequests = [];
  h.context.fetch = (url, options) => {
    if (url !== '/renew.php') return Promise.resolve({ok: true, json: () => Promise.resolve({})});
    renewRequests.push(options);
    return Promise.resolve(renewalResponse(true));
  };

  h.player.emit('play');
  h.player.emit('pause');
  h.player.emit('error');
  await settleRenewal(h);
  assert.equal(renewRequests.length, 1, 'the failed source is renewed');
  await waitForSource(h);
  h.player.emit('loadedmetadata');
  await h.settle();
  assert.equal(h.player.paused(), true, 'media recovery preserves the explicit Pause');
});

test('media error before the first Play renews source without starting playback', async () => {
  const h = harness(null, false, {authorizedPlayback: true, renewUrl: '/renew.php',
    playlistUrl: '/old-manifest', sesskey: 'synthetic'});
  const renewRequests = [];
  h.context.fetch = (url, options) => {
    if (url !== '/renew.php') return Promise.resolve({ok: true, json: () => Promise.resolve({})});
    renewRequests.push(options);
    return Promise.resolve(renewalResponse(true));
  };

  h.player.emit('error');
  await settleRenewal(h);
  assert.equal(renewRequests.length, 1, 'the broken initial source is renewed');
  await waitForSource(h);
  h.player.emit('loadedmetadata');
  await h.settle();
  assert.equal(h.player.paused(), true, 'preload recovery does not start a player never explicitly played');
});

test('media error during active playback still resumes after source recovery', async () => {
  const h = harness(null, false, {authorizedPlayback: true, renewUrl: '/renew.php',
    playlistUrl: '/old-manifest', sesskey: 'synthetic'});
  h.context.fetch = (url) => url === '/renew.php'
    ? Promise.resolve(renewalResponse(true))
    : Promise.resolve({ok: true, json: () => Promise.resolve({})});

  h.player.emit('play');
  h.player.emit('error');
  await settleRenewal(h);
  await waitForSource(h);
  h.player.emit('loadedmetadata');
  await h.settle();
  assert.equal(h.player.paused(), false, 'an active playback intent is recovered after a media error');
});

function bodyOf(request) {
  return JSON.parse(request.options.body);
}

function assertLote(body, watchedSeconds) {
  assert.equal(body.watchedSeconds, watchedSeconds);
  assert.equal(typeof body.batchId, 'string');
  assert.ok(body.batchId.length > 0, 'el lote lleva batchId');
}

test('sends the first session heartbeat 30 seconds after play', async () => {
  const h = harness();
  assert.equal(h.requests.filter((request) => request.url === '/session').length, 0);
  h.player.emit('play');
  await h.advance(29999);
  assert.equal(h.requests.filter((request) => request.url === '/session').length, 0);
  await h.advance(1);
  const sessionRequests = h.requests.filter((request) => request.url === '/session');
  assert.equal(sessionRequests.length, 1);
  assert.equal(sessionRequests[0].options.keepalive, true);
});

test('batches 15-second analytics heartbeats for three minutes', async () => {
  const h = harness();
  h.player.emit('play');
  await h.advance(179999);
  assert.equal(h.requests.filter((request) => request.url === '/events').length, 0);

  await h.advance(1);
  const eventRequests = h.requests.filter((request) => request.url === '/events');
  assert.equal(eventRequests.length, 1);
  assert.equal(eventRequests[0].options.keepalive, true);
  const batch = JSON.parse(eventRequests[0].options.body);
  assert.equal(batch.flushReason, 'interval');
  assert.equal(batch.events.filter((event) => event.type === 'heartbeat').length, 12);
  assert.equal(batch.events[0].type, 'play');
});

test('flushes the pending analytics batch when the player is disposed', async () => {
  const h = harness();
  h.player.emit('play');
  await h.advance(30000);
  h.player.emit('dispose');

  const eventRequests = h.requests.filter((request) => request.url === '/events');
  assert.equal(eventRequests.length, 1);
  assert.deepEqual(
    JSON.parse(eventRequests[0].options.body).events.map((event) => event.type),
    ['play', 'heartbeat', 'heartbeat'],
  );
  assert.equal(JSON.parse(eventRequests[0].options.body).flushReason, 'dispose');
  assert.equal(h.windowListeners.pagehide, undefined);
});

test('flushes the pending analytics batch on pagehide', async () => {
  const h = harness();
  h.player.emit('play');
  await h.advance(30000);
  h.windowListeners.pagehide();

  const eventRequests = h.requests.filter((request) => request.url === '/events');
  assert.equal(eventRequests.length, 1);
  assert.deepEqual(
    JSON.parse(eventRequests[0].options.body).events.map((event) => event.type),
    ['play', 'heartbeat', 'heartbeat'],
  );
  assert.equal(JSON.parse(eventRequests[0].options.body).flushReason, 'pagehide');
  h.windowListeners.pagehide();
  assert.equal(h.requests.filter((request) => request.url === '/events').length, 1);
});

test('labels pause and complete analytics flushes', async () => {
  const h = harness();
  h.player.emit('play');
  await h.advance(15000);
  h.player.emit('pause');
  h.player.emit('play');
  h.player.emit('ended');

  const reasons = h.requests
    .filter((request) => request.url === '/events')
    .map((request) => JSON.parse(request.options.body).flushReason);
  assert.deepEqual(reasons, ['pause', 'complete']);
});

test('uses the server heartbeat interval and falls back to 120 seconds', async () => {
  const h = harness(() => Promise.resolve({ok: true, json: () => Promise.resolve({heartbeatSeconds: 75})}));
  h.player.emit('play');
  await h.advance(30000);
  await h.advance(74999);
  assert.equal(h.requests.filter((request) => request.url === '/session').length, 1);
  await h.advance(1);
  assert.equal(h.requests.filter((request) => request.url === '/session').length, 2);

  const fallback = harness(() => Promise.resolve({ok: true, json: () => Promise.resolve({})}));
  fallback.player.emit('play');
  await fallback.advance(30000);
  await fallback.advance(119999);
  assert.equal(fallback.requests.filter((request) => request.url === '/session').length, 1);
  await fallback.advance(1);
  assert.equal(fallback.requests.filter((request) => request.url === '/session').length, 2);
});

test('flushes watched seconds on pause and retains them after a failed request', async () => {
  let calls = 0;
  const h = harness(() => {
    calls += 1;
    if (calls === 1) return Promise.reject(new Error('offline'));
    return Promise.resolve({ok: true, json: () => Promise.resolve({heartbeatSeconds: 60})});
  });
  h.player.emit('play');
  watch(h.player, 10);
  h.player.emit('pause');
  await h.settle();
  let sessionRequests = h.requests.filter((request) => request.url === '/session');
  assert.equal(sessionRequests.length, 1);
  assertLote(bodyOf(sessionRequests[0]), 10);

  h.player.emit('play');
  await h.advance(120000);
  sessionRequests = h.requests.filter((request) => request.url === '/session');
  assert.equal(sessionRequests.length, 3);
  // Tras un fallo, el reintento reenvía el MISMO lote: mismos segundos y mismo
  // batchId, para que el backend lo deduplique.
  assertLote(bodyOf(sessionRequests[1]), 10);
  assert.equal(bodyOf(sessionRequests[1]).batchId, bodyOf(sessionRequests[0]).batchId);
});

test('abre un lote nuevo, con batchId distinto, tras confirmar el anterior', async () => {
  const h = harness();
  h.player.emit('play');
  await h.advance(30000);
  watch(h.player, 5);
  h.player.emit('pause');
  await h.settle();
  h.player.emit('play');
  await h.advance(120000);
  const sessionRequests = h.requests.filter((request) => request.url === '/session');
  assert.equal(sessionRequests.length, 3);
  assertLote(bodyOf(sessionRequests[1]), 5);
  assert.notEqual(bodyOf(sessionRequests[1]).batchId, bodyOf(sessionRequests[0]).batchId);
});

test('does not overlap a heartbeat and flushes seconds added while it is pending', async () => {
  let resolveFirst;
  const h = harness(() => new Promise((resolve) => { resolveFirst = resolve; }));
  h.player.emit('play');
  await h.advance(30000);
  watch(h.player, 8);
  h.player.emit('pause');
  await h.settle();
  assert.equal(h.requests.filter((request) => request.url === '/session').length, 1);
  resolveFirst({ok: true, json: () => Promise.resolve({heartbeatSeconds: 60})});
  await h.advance(0);
  const sessionRequests = h.requests.filter((request) => request.url === '/session');
  assert.equal(sessionRequests.length, 2);
  assertLote(bodyOf(sessionRequests[1]), 8);
  assert.notEqual(bodyOf(sessionRequests[1]).batchId, bodyOf(sessionRequests[0]).batchId);
});

test('flushes seconds added before dispose after the in-flight heartbeat completes', async () => {
  const resolvers = [];
  const h = harness(() => new Promise((resolve) => { resolvers.push(resolve); }));
  h.player.emit('play');
  await h.advance(30000);
  watch(h.player, 6);
  h.player.emit('dispose');
  await h.settle();
  assert.equal(h.requests.filter((request) => request.url === '/session').length, 1);

  resolvers.shift()({ok: true, json: () => Promise.resolve({heartbeatSeconds: 60})});
  await h.settle();
  let sessionRequests = h.requests.filter((request) => request.url === '/session');
  assert.equal(sessionRequests.length, 2);
  assertLote(bodyOf(sessionRequests[1]), 6);

  resolvers.shift()({ok: true, json: () => Promise.resolve({heartbeatSeconds: 60})});
  await h.settle();
  h.player.emit('pause');
  await h.advance(120000);
  sessionRequests = h.requests.filter((request) => request.url === '/session');
  assert.equal(sessionRequests.length, 2);
});

test('does not flush analytics on hidden and removes the visibility listener on dispose', async () => {
  const h = harness();
  h.player.emit('play');
  watch(h.player, 5);
  h.document.visibilityState = 'hidden';
  h.listeners.visibilitychange();
  await h.settle();
  const eventRequests = h.requests.filter((request) => request.url === '/events');
  assert.equal(eventRequests.length, 0);
  assert.equal(h.requests.filter((request) => request.url === '/session').length, 1);
  h.player.emit('dispose');
  assert.equal(h.listeners.visibilitychange, undefined);
});
