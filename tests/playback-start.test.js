/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(__dirname + '/../js/playback-renew.js', 'utf8');
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function fixture(renew, options = {}) {
  const handlers = {}, sources = [], calls = [];
  const listeners = {};
  const windowListeners = {};
  const element = {isConnected: true};
  const document = {visibilityState: 'visible', documentElement: {},
    addEventListener(n, f) { listeners[n] = f; },
    removeEventListener(n, f) { if (listeners[n] === f) delete listeners[n]; }};
  let playing = false;
  const player = {
    on(n, f) { (handlers[n] ||= []).push(f); },
    off(n, f) { handlers[n] = (handlers[n] || []).filter(x => x !== f); },
    emit(n) { for (const f of handlers[n] || []) f(); },
    play() { calls.push('play'); playing = true; return Promise.resolve(); },
    pause() { playing = false; },
    paused() { return !playing; },
    el() { return element; },
    src(value) { sources.push(value.src); if (!options.delayedMetadata) this.emit('loadedmetadata'); },
    load() {}
  };
  const removed = [];
  let observerCallback;
  const context = {window: {document,
    addEventListener(n, f) { windowListeners[n] = f; },
    removeEventListener(n, f) { if (windowListeners[n] === f) delete windowListeners[n]; },
    MutationObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe() {}
      takeRecords() { return removed.splice(0); }
      disconnect() {}
    }, setTimeout, clearTimeout}, Promise, Error};
  vm.runInNewContext(source, context);
  const cfg = {playlistUrl: '/cached-old'};
  context.window.ImprontaPlaybackStart(player, cfg, async opts => {
    calls.push('renew');
    await renew(opts);
    cfg.playlistUrl = '/fresh';
  }, options.ready);
  return {player, calls, sources, element, document, listeners, windowListeners,
    removal() { removed.push({removedNodes: [element]}); observerCallback?.(removed.splice(0)); }};
}

test('denied startup never loads cached media; another explicit Play can retry', async () => {
  let attempts = 0;
  const h = fixture(async opts => {
    assert.equal(opts.newPlayback, true);
    if (++attempts === 1) throw new Error('synthetic denied');
  });
  await assert.rejects(h.player.play(), /synthetic denied/);
  assert.deepEqual(h.sources, []);
  assert.equal(h.player.paused(), true);
  await h.player.play();
  assert.deepEqual(h.sources, ['/fresh']);
  assert.equal(attempts, 2);
});

test('Play, Pause, Play during startup shares one intent and honors the last explicit Play', async () => {
  let resolve;
  const h = fixture(() => new Promise(done => { resolve = done; }));
  const first = h.player.play();
  await drain();
  h.player.pause();
  const second = h.player.play();
  assert.equal(first, second);
  resolve();
  await second;
  assert.equal(h.calls.filter(x => x === 'renew').length, 1);
  assert.equal(h.player.paused(), false);
});

test('a late startup response after leaving the view never loads media', async () => {
  let resolve;
  const h = fixture(() => new Promise(done => { resolve = done; }));
  const started = h.player.play();
  await drain();
  h.element.isConnected = false;
  resolve();
  await started;
  assert.deepEqual(h.sources, []);
  assert.equal(h.player.paused(), true);
});

test('background during startup cancels autoplay even if foreground returns before the response', async () => {
  let resolve;
  const h = fixture(() => new Promise(done => { resolve = done; }));
  const started = h.player.play();
  await drain();
  h.document.visibilityState = 'hidden';
  h.listeners.visibilitychange?.();
  h.document.visibilityState = 'visible';
  h.listeners.visibilitychange?.();
  resolve();
  await started;
  assert.deepEqual(h.sources, []);
  assert.equal(h.player.paused(), true);
  await h.player.play();
  assert.deepEqual(h.sources, ['/fresh']);
  assert.equal(h.calls.filter(x => x === 'renew').length, 1);
});

test('Pause cancels late startup, while the next Play reuses its prepared intent', async () => {
  let resolve;
  const h = fixture(() => new Promise(done => { resolve = done; }));
  const started = h.player.play();
  await drain();
  h.player.pause();
  resolve();
  await started;
  assert.deepEqual(h.sources, []);
  await h.player.play();
  assert.deepEqual(h.sources, ['/fresh']);
  assert.equal(h.calls.filter(x => x === 'renew').length, 1);
});

test('dispose during renewal blocks late playback and future Play', async () => {
  let resolve;
  const h = fixture(() => new Promise(done => { resolve = done; }));
  const started = h.player.play();
  await drain();
  h.player.emit('dispose');
  resolve();
  await started;
  await assert.rejects(h.player.play(), /disposed/);
  assert.deepEqual(h.sources, []);
  assert.equal(Object.keys(h.listeners).length, 0);
});

test('watermark readiness gates renewal and a rejected readiness never installs media', async () => {
  let reject;
  const ready = new Promise((_, fail) => { reject = fail; });
  const h = fixture(async () => {}, {ready});
  const started = h.player.play();
  await drain();
  assert.deepEqual(h.calls, []);
  reject(new Error('watermark unavailable'));
  await assert.rejects(started, /watermark unavailable/);
  assert.deepEqual(h.sources, []);
});

test('Pause while a fresh source is preparing does not enqueue a late media Play', async () => {
  const h = fixture(async () => {}, {delayedMetadata: true});
  const started = h.player.play();
  await drain();
  assert.deepEqual(h.sources, ['/fresh']);
  h.player.pause();
  h.player.emit('loadedmetadata');
  await started;
  assert.equal(h.calls.filter(x => x === 'play').length, 0);
  assert.equal(h.player.paused(), true);
  await h.player.play();
  assert.equal(h.calls.filter(x => x === 'renew').length, 1);
  assert.equal(h.player.paused(), false);
});

test('pagehide on window cancels a pending renewal', async () => {
  let resolve;
  const h = fixture(() => new Promise(done => { resolve = done; }));
  const started = h.player.play();
  await drain();
  h.windowListeners.pagehide?.();
  resolve();
  await started;
  assert.deepEqual(h.sources, []);
  assert.equal(h.player.paused(), true);
});

test('removal and reattachment before renewal responds requires another explicit Play', async () => {
  let resolve;
  const h = fixture(() => new Promise(done => { resolve = done; }));
  const started = h.player.play();
  await drain();
  h.element.isConnected = false;
  h.removal();
  h.element.isConnected = true;
  resolve();
  await started;
  assert.deepEqual(h.sources, []);
  assert.equal(h.player.paused(), true);
  await h.player.play();
  assert.deepEqual(h.sources, ['/fresh']);
  assert.equal(h.calls.filter(x => x === 'renew').length, 1);
});

test('a failed fresh source can retry without allocating another intent', async () => {
  const h = fixture(async () => {}, {delayedMetadata: true});
  const first = h.player.play();
  await drain();
  h.player.emit('error');
  await assert.rejects(first, /source unavailable/);
  const retry = h.player.play();
  await drain();
  h.player.emit('loadedmetadata');
  await retry;
  assert.equal(h.calls.filter(x => x === 'renew').length, 1);
  assert.deepEqual(h.sources, ['/fresh', '/fresh']);
  assert.equal(h.player.paused(), false);
});

test('pagehide between metadata and its promise continuation still cancels Play', async () => {
  const h = fixture(async () => {}, {delayedMetadata: true});
  const started = h.player.play();
  await drain();
  h.player.emit('loadedmetadata');
  h.windowListeners.pagehide?.();
  await started;
  assert.equal(h.player.paused(), true);
  assert.equal(h.calls.filter(x => x === 'play').length, 0);
});
