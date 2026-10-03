/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(__dirname + '/../js/analytics-v2.js', 'utf8');

function harness(fetchImpl) {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const requests = [];
  const windowListeners = {};
  const player = {
    handlers: {},
    playing: false,
    position: 0,
    buffered: 0,
    on(type, handler) { (this.handlers[type] ||= []).push(handler); },
    emit(type) {
      if (type === 'play' || type === 'playing') this.playing = true;
      if (type === 'pause' || type === 'ended') this.playing = false;
      for (const handler of this.handlers[type] || []) handler();
    },
    paused() { return !this.playing; },
    currentTime() { return this.position; },
    bufferedEnd() { return this.buffered; },
  };
  const context = {
    window: {},
    fetch(url, options) {
      requests.push({url, options});
      return fetchImpl ? fetchImpl(url, options) : Promise.resolve({ok: true});
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
    Date,
    console,
    addEventListener(type, handler) { windowListeners[type] = handler; },
    removeEventListener(type, handler) {
      if (windowListeners[type] === handler) delete windowListeners[type];
    },
  };
  context.Date.now = () => now;
  context.window = context;
  vm.runInNewContext(source, context, {filename: 'analytics-v2.js'});
  const accumulator = context.ImprontaAnalyticsV2(player, {
    enabled: true,
    batchUrl: '/batch',
    sessionId: 'session-1',
    videoId: 'lesson-1',
    checkpointInterval: 300000,
  });

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

  return {player, accumulator, requests, windowListeners, advance, settle};
}

function bodyOf(request) {
  return JSON.parse(request.options.body);
}

test('flushes an incremental pause batch and clears it only after acknowledgement', async () => {
  const h = harness();
  h.player.emit('play');
  h.player.position = 1;
  h.player.emit('timeupdate');
  h.player.position = 2;
  h.player.emit('timeupdate');
  h.player.emit('pause');
  await h.settle();

  assert.equal(h.requests.length, 1);
  const batch = bodyOf(h.requests[0]);
  assert.equal(batch.reason, 'pause');
  assert.equal(batch.sessionId, 'session-1');
  assert.equal(batch.sequence, 1);
  assert.equal(batch.watchedDelta, 2);
  assert.equal(batch.pauseDelta, 1);

  h.player.emit('play');
  h.player.position = 3;
  h.player.emit('timeupdate');
  h.player.emit('pause');
  await h.settle();
  assert.equal(h.requests.length, 2);
  assert.equal(bodyOf(h.requests[1]).sequence, 2);
  assert.equal(bodyOf(h.requests[1]).watchedDelta, 1);
});

test('retries the same batch identity after a failed transport', async () => {
  let attempts = 0;
  const h = harness(() => {
    attempts += 1;
    return Promise.resolve({ok: attempts > 1});
  });
  h.player.emit('play');
  h.player.position = 1;
  h.player.emit('timeupdate');
  h.player.emit('pause');
  await h.settle();
  h.player.emit('play');
  h.player.position = 2;
  h.player.emit('timeupdate');
  h.player.emit('pause');
  await h.settle();

  assert.equal(h.requests.length, 2);
  assert.equal(bodyOf(h.requests[0]).batchId, bodyOf(h.requests[1]).batchId);
  assert.equal(bodyOf(h.requests[0]).sequence, bodyOf(h.requests[1]).sequence);
});

test('checkpoint sends only when there is pending state', async () => {
  const h = harness();
  await h.advance(300000);
  assert.equal(h.requests.length, 0);
  h.player.emit('play');
  h.player.position = 1;
  h.player.emit('timeupdate');
  await h.advance(300000);
  assert.equal(h.requests.length, 1);
  assert.equal(bodyOf(h.requests[0]).reason, 'checkpoint');
});

test('pagehide uses sendBeacon and does not touch Legacy endpoints', async () => {
  const h = harness();
  const beacons = [];
  h.windowListeners.pagehide = h.windowListeners.pagehide;
  // The module receives the boundary through the global object in production;
  // this assertion is completed by the implementation's injectable beacon.
  h.player.position = 1;
  h.player.emit('play');
  h.player.emit('timeupdate');
  h.accumulator.setBeacon((url, body) => { beacons.push({url, body}); return true; });
  h.windowListeners.pagehide();
  await h.settle();
  assert.equal(beacons.length, 1);
  assert.equal(beacons[0].url, '/batch');
  assert.equal(bodyOf({options: {body: beacons[0].body}}).reason, 'pagehide');
  assert.equal(h.requests.length, 0);
});

test('falls back to keepalive fetch when Beacon rejects the batch', async () => {
  const h = harness();
  h.player.emit('play');
  h.player.position = 1;
  h.player.emit('timeupdate');
  h.accumulator.setBeacon(() => false);
  h.windowListeners.pagehide();
  await h.settle();

  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].options.keepalive, true);
  assert.equal(bodyOf(h.requests[0]).reason, 'pagehide');
});

test('does not count a seek jump as watched time', async () => {
  const h = harness();
  h.player.emit('play');
  h.player.position = 1;
  h.player.emit('timeupdate');
  h.player.emit('seeking');
  h.player.position = 1.8;
  h.player.emit('seeked');
  h.player.emit('pause');
  await h.settle();

  const batch = bodyOf(h.requests[0]);
  assert.equal(batch.watchedDelta, 1);
  assert.equal(batch.seekDelta, 1);
});

test('keeps old signed endpoint and video identity across a video change', async () => {
  const h = harness();
  h.player.emit('play');
  h.player.position = 1;
  h.player.emit('timeupdate');
  h.player.emit('pause');
  h.accumulator.changeVideo('lesson-2', {batchUrl: '/batch-2', sessionId: 'session-2'});
  h.player.emit('play');
  h.player.position = 1;
  h.player.emit('timeupdate');
  h.player.emit('pause');
  await h.settle();

  await h.settle();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].url, '/batch');
  assert.equal(bodyOf(h.requests[0]).videoId, 'lesson-1');
  assert.equal(h.requests[1].url, '/batch-2');
  assert.equal(bodyOf(h.requests[1]).videoId, 'lesson-2');
});

test('persists ended after a pause batch already in flight', async () => {
  let resolveFetch;
  const h = harness(() => new Promise((resolve) => { resolveFetch = resolve; }));
  h.player.emit('play');
  h.player.position = 1;
  h.player.emit('timeupdate');
  h.player.emit('pause');
  h.player.emit('ended');
  await h.settle();
  assert.equal(h.requests.length, 1);

  resolveFetch({ok: true});
  await h.settle();
  assert.equal(h.requests.length, 2);
  assert.equal(bodyOf(h.requests[1]).reason, 'ended');
});

test('beacons both the in-flight batch and deltas created before pagehide', async () => {
  let resolveFetch;
  const h = harness(() => new Promise((resolve) => { resolveFetch = resolve; }));
  const beacons = [];
  h.player.emit('play');
  h.player.position = 1;
  h.player.emit('timeupdate');
  h.player.emit('pause');
  h.player.emit('play');
  h.player.position = 2;
  h.player.emit('timeupdate');
  h.accumulator.setBeacon((url, body) => { beacons.push({url, body}); return true; });
  h.windowListeners.pagehide();
  await h.settle();

  assert.equal(beacons.length, 2);
  assert.notEqual(bodyOf({options: {body: beacons[0].body}}).batchId,
    bodyOf({options: {body: beacons[1].body}}).batchId);
  resolveFetch({ok: true});
});
