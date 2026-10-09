/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(__dirname + '/../js/realtime-v2.js', 'utf8');

function playbackHarness(overrides = {}, fetchImpl) {
  const sent = [];
  const sockets = [];
  const intervals = new Map();
  const timeouts = new Map();
  let nextTimer = 1;
  const player = {
    playing: true,
    completed: false,
    handlers: {},
    on(type, handler) { (this.handlers[type] ||= []).push(handler); },
    emit(type) { for (const handler of this.handlers[type] || []) handler(); },
    paused() { return !this.playing; },
    ended() { return this.completed; },
    currentTime() { return 20; },
    bufferedEnd() { return 80; },
  };
  const context = {
    window: {},
    fetch: fetchImpl,
    WebSocket: function Socket() {
      sockets.push(this);
      this.readyState = 0;
      this.send = (body) => sent.push(JSON.parse(body));
      this.close = () => { this.readyState = 3; if (this.onclose) this.onclose(); };
    },
    setInterval(handler) { const id = nextTimer++; intervals.set(id, handler); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(handler) { const id = nextTimer++; timeouts.set(id, handler); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    console,
  };
  context.window = context;
  vm.runInNewContext(source, context);
  const client = context.ImprontaRealtimeV2(player, {
    enabled: true, realtimeUrl: '/realtime', realtimeSocketUrl: 'wss://example/ws',
    realtimeToken: 'signed', realtimeExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    sessionId: 's1', videoId: 'v1', ...overrides,
  });
  async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
  async function open() {
    player.emit('play');
    await settle();
    sockets[0].readyState = 1;
    sockets[0].onopen();
  }
  return {player, client, sent, sockets, intervals, timeouts, settle, open};
}

test('starts before the Legacy heartbeat using cached bootstrap credentials from Moodle', async () => {
  let requests = 0;
  const h = playbackHarness({sessionId:'',realtimeToken:'',onRealtimeSession(id) { assert.equal(id,'p1-cached'); }},() => {
    requests++;
    return Promise.resolve({ok:true,json:() => Promise.resolve({sessionId:'p1-cached',url:'wss://example/ws',token:'signed',expiresAt:9999999999,intervalSeconds:60,authorizedPlayback:true,manifestExpiresAt:9999999999})});
  });
  await h.open();
  assert.equal(requests,1);
  assert.equal(h.sent.length,1);
  assert.equal(h.sent[0].sessionId,'p1-cached');
  h.player.emit('seeked');
  assert.equal(h.sent.length,2);
});

test('a bootstrap race observes reconnect backoff instead of refetching on every timeupdate', async () => {
  let requests = 0;
  const h = playbackHarness({sessionId:'',realtimeToken:''},() => { requests++; return Promise.resolve({ok:false}); });
  h.player.emit('play'); await h.settle();
  assert.equal(requests,1);
  assert.equal(h.timeouts.size,1);
  for (let i=0;i<100;i++) h.player.emit('timeupdate');
  await h.settle();
  assert.equal(requests,1);
  h.client.stop();
  assert.equal(h.timeouts.size,0);
});

test('sends no WSS payload while paused and reports resume immediately on the same connection', async () => {
  const h = playbackHarness();
  await h.open();
  assert.equal(h.sent.length, 1);
  h.player.playing = false;
  h.player.emit('pause');
  for (let i = 0; i < 30; i++) for (const tick of h.intervals.values()) tick();
  assert.equal(h.sent.length, 1, 'pause must not emit periodic playing=false messages');
  h.player.playing = true;
  h.player.emit('play');
  assert.equal(h.sent.length, 2, 'resume sends immediately without waiting twelve seconds');
  assert.equal(h.sockets.length, 1, 'a short pause reuses the connection');
  assert.ok(h.sent.every((body) => body.playing === true));
});

test('a connection opening after pause sends no heartbeat', async () => {
  const h = playbackHarness();
  h.player.emit('play');
  await h.settle();
  h.player.playing = false;
  h.player.emit('pause');
  h.sockets[0].readyState = 1;
  h.sockets[0].onopen();
  assert.equal(h.sent.length, 0);
});

test('pause between play and credential continuation does not create a socket or wedge resume', async () => {
  const h = playbackHarness();
  h.player.emit('play');
  h.player.playing = false;
  h.player.emit('pause');
  await h.settle();
  assert.equal(h.sockets.length, 0, 'connect must revalidate playback after the async boundary');
  h.player.playing = true;
  h.player.emit('play');
  await h.settle();
  assert.equal(h.sockets.length, 1, 'a cancelled open must release its connecting flag');
});

test('does not reconnect during pause after idle close; reconnects when play resumes', async () => {
  const h = playbackHarness();
  await h.open();
  h.player.playing = false;
  h.player.emit('pause');
  h.sockets[0].close();
  assert.equal(h.timeouts.size, 0, 'paused sockets must not start a reconnect loop');
  h.player.emit('timeupdate');
  await h.settle();
  assert.equal(h.sockets.length, 1);
  h.player.playing = true;
  h.player.emit('play');
  await h.settle();
  assert.equal(h.sockets.length, 2);
});

test('opens WSS with heartbeat credentials without an HTTP token request', async () => {
  const requests = [];
  const sent = [];
  const listeners = {};
  const player = {
    position: 14,
    playing: true,
    handlers: {},
    on(type, fn) { (this.handlers[type] ||= []).push(fn); },
    emit(type) { for (const fn of this.handlers[type] || []) fn(); },
    paused() { return !this.playing; },
    currentTime() { return this.position; },
    bufferedEnd() { return 31; },
  };
  function Socket(url) {
    this.url = url;
    this.readyState = 0;
    context.setTimeout(() => { this.readyState = 1; this.onopen(); }, 0);
    this.send = (body) => sent.push(JSON.parse(body));
    this.close = () => { this.readyState = 3; if (this.onclose) this.onclose(); };
  }
  const context = {
    window: {},
    WebSocket: Socket,
    fetch(url) { requests.push(url); return Promise.reject(new Error('must not fetch')); },
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout(fn) { listeners.timeout = fn; Promise.resolve().then(fn); return 2; },
    clearTimeout() {},
    addEventListener() {},
    Date,
    console,
  };
  context.window = context;
  vm.runInNewContext(source, context);
  const client = context.ImprontaRealtimeV2(player, {
    enabled: true,
    realtimeUrl: '/realtime',
    realtimeSocketUrl: 'wss://example/ws',
    realtimeToken: 'signed',
    realtimeExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    sessionId: 's1',
    videoId: 'v1'
  });
  player.emit('play');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, []);
  assert.equal(client.state(), 'connected');
  assert.equal(sent[0].sessionId, 's1');
  assert.equal(sent[0].bufferedEnd, 31);
});

test('closes WSS at ended and does not keep the heartbeat interval alive', async () => {
  let closeCount = 0;
  const player = {
    handlers: {},
    on(type, fn) { (this.handlers[type] ||= []).push(fn); },
    emit(type) { for (const fn of this.handlers[type] || []) fn(); },
    paused() { return false; },
    currentTime() { return 72; },
    bufferedEnd() { return 72; },
  };
  const context = {
    window: {},
    WebSocket: function Socket() {
      this.readyState = 0;
      this.send = () => {};
      this.close = () => { closeCount += 1; this.readyState = 3; if (this.onclose) this.onclose(); };
      Promise.resolve().then(() => { this.readyState = 1; this.onopen(); });
    },
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout() { return 2; },
    clearTimeout() {},
    console,
  };
  context.window = context;
  vm.runInNewContext(source, context);
  const client = context.ImprontaRealtimeV2(player, {
    enabled: true,
    realtimeUrl: '/realtime',
    realtimeSocketUrl: 'wss://example/ws',
    realtimeToken: 'signed',
    realtimeExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    sessionId: 's1',
    videoId: 'v1'
  });
  player.emit('play');
  await new Promise((resolve) => setImmediate(resolve));
  player.emit('ended');
  assert.equal(closeCount, 1);
  assert.equal(client.state(), 'disconnected');
});

test('Legacy replay after ended opens WSS again without changing its billing session', async () => {
  const h = playbackHarness({authorizedPlayback: false});
  await h.open();
  h.player.playing = false;
  h.player.completed = true;
  h.player.emit('ended');
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timeouts.size, 0);
  h.player.emit('timeupdate');
  await h.settle();
  assert.equal(h.sockets.length, 1, 'ended alone must not reconnect');

  h.player.playing = true;
  h.player.completed = false;
  h.player.emit('play');
  await h.settle();
  assert.equal(h.sockets.length, 2, 'explicit Legacy replay must reopen WSS');
  h.sockets[1].readyState = 1;
  h.sockets[1].onopen();
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].sessionId, 's1', 'presence must not mutate Legacy accounting identity');
  assert.equal(h.sent[1].playing, true);
});

test('authorized replay remains silent until a new playback context is installed', async () => {
  const h = playbackHarness({authorizedPlayback: true});
  await h.open();
  h.player.playing = false;
  h.player.completed = true;
  h.player.emit('ended');
  h.player.playing = true;
  h.player.completed = false;
  h.player.emit('play');
  for (let i = 0; i < 50; i++) h.player.emit('timeupdate');
  await h.settle();
  assert.equal(h.sockets.length, 1, 'old authorized session must stay closed');
  assert.equal(h.sent.length, 1);

  h.client.setContext({sessionId: 's2', realtimeUrl: '/realtime/new'});
  h.client.setCredentials({url: 'wss://example/ws', token: 'new-signed', expiresAt: 9999999999, authorizedPlayback: true});
  h.player.emit('play');
  await h.settle();
  assert.equal(h.sockets.length, 2);
  h.sockets[1].readyState = 1;
  h.sockets[1].onopen();
  assert.equal(h.sent[1].sessionId, 's2');
});

test('disposed Legacy player cannot reopen WSS after ended or a late play', async () => {
  const h = playbackHarness({authorizedPlayback: false});
  await h.open();
  h.player.emit('ended');
  h.player.emit('dispose');
  h.player.emit('play');
  await h.settle();
  assert.equal(h.sockets.length, 1);
  assert.equal(h.sent.length, 1);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.timeouts.size, 0);
});

test('does not throw or create transport when disabled', () => {
  const player = {on() { throw new Error('must not attach'); }};
  const context = {window: {}, console};
  context.window = context;
  vm.runInNewContext(source, context);
  const client = context.ImprontaRealtimeV2(player, {enabled: false, realtimeUrl: '/realtime'});
  assert.equal(client.state(), 'disconnected');
});
