/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const root = process.env.IMPRONTA_PLUGIN_ROOT || __dirname + '/..';
const source = fs.readFileSync(root + '/js/playback-renew.js', 'utf8');

test('renews once and switches playlist, events and heartbeat together', async () => {
  const context = {window: {}, Promise, Error};
  vm.runInNewContext(source, context);
  const cfg = {playlistUrl: '/old', eventsUrl: '/old-events', sessionUrl: '/old-session'};
  let calls = 0;
  let resolve;
  const renew = context.window.ImprontaPlaybackRenew(cfg, (url) => {
    assert.equal(url, '/old');
    calls++;
    return new Promise((done) => { resolve = done; });
  });
  const first = renew();
  const second = renew();
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve({playlistUrl: '/new', eventsUrl: '/new-events', sessionUrl: '/new-session', batchUrl: '/new-batch', realtimeUrl: '/new-realtime', diagnosticUrl: '/new-diagnostic', expiresAt: 1900000000});
  await Promise.all([first, second]);
  assert.equal(cfg.playlistUrl, '/new');
  assert.equal(cfg.eventsUrl, '/new-events');
  assert.equal(cfg.sessionUrl, '/new-session');
  assert.equal(cfg.batchUrl, '/new-batch');
  assert.equal(cfg.realtimeUrl, '/new-realtime');
  assert.equal(cfg.diagnosticUrl, '/new-diagnostic');
  assert.equal(cfg.fragmentLeaseExpiresAt, undefined,
    'renewal expiresAt authenticates Moodle URLs and is not the HLS capability deadline');
});

test('invalid renewal leaves the old lease unchanged', async () => {
  const context = {window: {}, Promise, Error};
  vm.runInNewContext(source, context);
  const cfg = {playlistUrl: '/old', eventsUrl: '/old-events', sessionUrl: '/old-session', batchUrl: '/old-batch', realtimeUrl: '/old-realtime'};
  const renew = context.window.ImprontaPlaybackRenew(cfg, () => Promise.resolve({playlistUrl: '/partial'}));
  await assert.rejects(renew(), /invalid playback renewal/);
  assert.equal(cfg.playlistUrl, '/old');
  assert.equal(cfg.batchUrl, '/old-batch');
});

test('a transport deadline aborts a stalled renewal and releases the single-flight slot', async () => {
  let expireRequest;
  const cleared = [];
  const context = {
    window: {
      AbortController,
      setTimeout(callback, delay) { expireRequest = {callback, delay}; return 41; },
      clearTimeout(id) { cleared.push(id); },
    },
    Promise, Error, AbortController,
  };
  vm.runInNewContext(source, context);
  const cfg = {playlistUrl: '/old', eventsUrl: '/old-events', sessionUrl: '/old-session',
    batchUrl: '/old-batch', realtimeUrl: '/old-realtime'};
  const requests = [];
  const renew = context.window.ImprontaPlaybackRenew(cfg, (url, options) => {
    requests.push({url, options});
    if (requests.length === 1) { return new Promise(() => {}); }
    return Promise.resolve({playlistUrl: '/new', eventsUrl: '/new-events', sessionUrl: '/new-session',
      batchUrl: '/new-batch', realtimeUrl: '/new-realtime', expiresAt: 1900000000});
  });

  const stalled = renew();
  await Promise.resolve();
  assert.equal(typeof expireRequest?.callback, 'function', 'a request deadline is armed');
  assert.equal(expireRequest.delay, 15000, 'transport has a bounded 15-second wait');
  expireRequest.callback();
  await assert.rejects(stalled, /timed out/i);
  assert.equal(requests[0].options.signal.aborted, true, 'deadline aborts the transport request');

  const retried = await renew();
  assert.equal(requests.length, 2, 'timeout releases the one-in-flight renewal slot');
  assert.equal(retried.playlistUrl, '/new');
  assert.ok(cleared.includes(41), 'settlement clears the deadline timer');
});
