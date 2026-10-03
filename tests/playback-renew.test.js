/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(__dirname + '/../js/playback-renew.js', 'utf8');

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
  resolve({playlistUrl: '/new', eventsUrl: '/new-events', sessionUrl: '/new-session', batchUrl: '/new-batch', realtimeUrl: '/new-realtime'});
  await Promise.all([first, second]);
  assert.equal(cfg.playlistUrl, '/new');
  assert.equal(cfg.eventsUrl, '/new-events');
  assert.equal(cfg.sessionUrl, '/new-session');
  assert.equal(cfg.batchUrl, '/new-batch');
  assert.equal(cfg.realtimeUrl, '/new-realtime');
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
