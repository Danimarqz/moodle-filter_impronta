/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(__dirname + '/../js/realtime-v2.js', 'utf8');

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

test('does not throw or create transport when disabled', () => {
  const player = {on() { throw new Error('must not attach'); }};
  const context = {window: {}, console};
  context.window = context;
  vm.runInNewContext(source, context);
  const client = context.ImprontaRealtimeV2(player, {enabled: false, realtimeUrl: '/realtime'});
  assert.equal(client.state(), 'disconnected');
});
