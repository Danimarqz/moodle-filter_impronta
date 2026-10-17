const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = process.env.IMPRONTA_PLUGIN_ROOT || __dirname + '/..';
function fixture() {
  const handlers = {};
  let paused = true, position = 90, source = '/old-signed-p', playCalls = 0, rate = 1;
  const player = {
    on(name, fn) { (handlers[name] ||= []).push(fn); },
    one(name, fn) { const wrapper = () => { handlers[name] = handlers[name].filter(x => x !== wrapper); fn(); }; this.on(name, wrapper); },
    off(name, fn) { handlers[name] = (handlers[name] || []).filter(x => x !== fn); },
    emit(name) { for (const fn of [...(handlers[name] || [])]) fn(); },
    currentTime(value) { if (value !== undefined) position = value; return position; },
    paused() { return paused; },
    pause() { paused = true; this.emit('pause'); },
    play() { paused = false; playCalls++; this.emit('play'); return Promise.resolve(); },
    setPaused(value) { paused = value; },
    src(value) { source = value.src; rate = 1; },
    playbackRate(value) { if (value !== undefined) rate = value; return rate; },
    get source() { return source; },
    get playCalls() { return playCalls; },
    get rate() { return rate; }
  };
  let now = Date.now();
  const context = {window: {setInterval() { return 1; }, clearInterval() {}}, Promise, Error, Date: {now: () => now}};
  vm.runInNewContext(fs.readFileSync(root + '/js/playback-renew.js', 'utf8'), context);
  const cfg = {authorizedPlayback: true, fragmentLeaseExpiresAt: Math.floor(Date.now()/1000)+600, playlistUrl: source};
  return {context, player, cfg, advance: (ms) => { now += ms; }};
}
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function freshLease() {
  return {playlistUrl: '/fresh-signed-p', eventsUrl: '/fresh-events', sessionUrl: '/fresh-session',
    batchUrl: '/fresh-batch', realtimeUrl: '/fresh-realtime', expiresAt: Math.floor(Date.now()/1000) + 600,
    samePlayback: true};
}
test('rejected replay must not resume the old signed playback or forget ended', async () => {
  const {context, player, cfg, advance} = fixture();
  const calls = [];
  context.window.ImprontaAuthorizedLifecycle(player, cfg, options => { calls.push(options); return Promise.reject(new Error('synthetic 503')); });
  player.emit('ended');
  player.play();
  await drain();
  advance(30001); player.pause(); player.play(); await drain();
  console.log(JSON.stringify({renewOptions: calls, source: player.source, paused: player.paused(), playCalls: player.playCalls}));
  assert.equal(player.paused(), true, 'must not replay the old logical session');
  assert.equal(calls.length, 2, 'subsequent replay must still request a new signed intent');
});
test('metadata failure must release the renewal lifecycle for a later attempt', async () => {
  const {context, player, cfg, advance} = fixture();
  cfg.fragmentLeaseExpiresAt = Math.floor(Date.now()/1000)+50;
  let calls = 0;
  context.window.ImprontaAuthorizedLifecycle(player, cfg, () => { calls++; return Promise.resolve({playlistUrl: '/renewed-p'}); });
  player.play(); await drain();
  player.emit('error'); advance(30001);
  cfg.fragmentLeaseExpiresAt = Math.floor(Date.now()/1000)+50;
  player.play(); player.emit('timeupdate'); await drain();
  console.log(JSON.stringify({renewCalls: calls, source: player.source, deadline: cfg.fragmentLeaseExpiresAt}));
  assert.equal(calls, 2, 'failed source load must not hold pending forever');
});
test('failed proactive renewal must not recurse immediately through play', async () => {
  const {context, player, cfg, advance} = fixture();
  cfg.fragmentLeaseExpiresAt = Math.floor(Date.now()/1000)+50;
  let calls = 0;
  context.window.ImprontaAuthorizedLifecycle(player, cfg, () => {
    calls++;
    return calls <= 4 ? Promise.reject(new Error('synthetic 503')) : Promise.resolve({playlistUrl:'/finally'});
  });
  player.play();
  for (let i=0; i<100; i++) await Promise.resolve();
  console.log(JSON.stringify({renewCallsBeforeAnyTimer: calls}));
  assert.equal(calls, 1, 'an auxiliary 503 needs backoff, not immediate recursive retries');
});

test('proactive lease renewal leaves healthy playback running and restores position and rate after source metadata', async () => {
  const {context, player, cfg} = fixture();
  cfg.fragmentLeaseExpiresAt = Math.floor(Date.now()/1000) + 50;
  player.playbackRate(1.5);
  player.play();
  let finish;
  const renew = context.window.ImprontaPlaybackRenew(cfg, () => new Promise(resolve => { finish = resolve; }));
  context.window.ImprontaAuthorizedLifecycle(player, cfg, renew);
  player.emit('timeupdate');
  await drain();
  assert.equal(player.paused(), false, 'healthy playback must continue while credentials are in flight');
  assert.equal(player.rate, 1.5);
  player.currentTime(97);
  player.playbackRate(2);
  finish(freshLease());
  await drain();
  assert.equal(player.paused(), true, 'the bounded source replacement waits for metadata');
  assert.equal(player.source, '/fresh-signed-p');
  player.currentTime(0);
  player.emit('loadedmetadata');
  await drain();
  assert.equal(player.currentTime(), 97, 'the latest seek before source replacement must be restored');
  assert.equal(player.rate, 2, 'the latest explicit playback rate must be restored');
  assert.equal(player.paused(), false);
});

test('explicit pause during a pending proactive renewal is not undone by late metadata', async () => {
  const {context, player, cfg} = fixture();
  cfg.fragmentLeaseExpiresAt = Math.floor(Date.now()/1000) + 50;
  player.play();
  let finish;
  const renew = context.window.ImprontaPlaybackRenew(cfg, () => new Promise(resolve => { finish = resolve; }));
  context.window.ImprontaAuthorizedLifecycle(player, cfg, renew);
  player.emit('timeupdate');
  await drain();
  player.pause();
  finish(freshLease());
  await drain();
  player.emit('loadedmetadata');
  await drain();
  assert.equal(player.paused(), true, 'a late renewal must not override the learner\'s pause');
});

test('natural ended during renewal stays ended and the next Play obtains a new playback intent', async () => {
  const {context, player, cfg} = fixture();
  cfg.fragmentLeaseExpiresAt = Math.floor(Date.now()/1000) + 50;
  player.play();
  const initialPlayCalls = player.playCalls;
  let finish;
  const calls = [];
  const renew = context.window.ImprontaPlaybackRenew(cfg, (url, options) => {
    calls.push(options);
    if (calls.length === 1) { return new Promise(resolve => { finish = resolve; }); }
    return Promise.resolve({...freshLease(), samePlayback: false});
  });
  context.window.ImprontaAuthorizedLifecycle(player, cfg, renew);
  player.emit('timeupdate');
  await drain();
  player.currentTime(12);
  player.setPaused(true);
  player.emit('ended');
  finish(freshLease());
  await drain();
  player.emit('loadedmetadata');
  await drain();

  assert.equal(player.paused(), true, 'natural end during the request must never autoplay on new metadata');
  assert.equal(player.playCalls, initialPlayCalls, 'new metadata does not add an implicit play call');
  player.play();
  await drain();
  assert.equal(calls.length, 2, 'the next explicit Play requests a new signed playback');
  assert.equal(calls[1].newPlayback, true);
});

test('public Pause during a paused source replacement cancels the later autoplay without an event', async () => {
  const {context, player, cfg} = fixture();
  cfg.fragmentLeaseExpiresAt = Math.floor(Date.now()/1000) + 50;
  player.play();
  const initialPlayCalls = player.playCalls;
  const originalPause = player.pause;
  player.pause = function() {
    if (this.paused()) { return; }
    return originalPause.call(this);
  };
  let finish;
  const renew = context.window.ImprontaPlaybackRenew(cfg, () => new Promise(resolve => { finish = resolve; }));
  context.window.ImprontaAuthorizedLifecycle(player, cfg, renew);
  player.emit('timeupdate');
  await drain();
  finish(freshLease());
  await drain();
  assert.equal(player.paused(), true, 'source replacement has paused the player');
  player.pause(); // Video.js emits no second pause event when already paused.
  player.emit('loadedmetadata');
  await drain();

  assert.equal(player.paused(), true, 'the public Pause call wins even when Video.js emits no event');
  assert.equal(player.playCalls, initialPlayCalls, 'metadata must not autoplay after explicit Pause');
});

test('asynchronous Video.js pause event caused by source replacement is not mistaken for learner intent', async () => {
  const {context, player, cfg} = fixture();
  cfg.fragmentLeaseExpiresAt = Math.floor(Date.now()/1000) + 50;
  player.play();
  player.pause = function() {
    this.setPaused(true);
    queueMicrotask(() => this.emit('pause'));
  };
  let finish;
  const renew = context.window.ImprontaPlaybackRenew(cfg, () => new Promise(resolve => { finish = resolve; }));
  context.window.ImprontaAuthorizedLifecycle(player, cfg, renew);
  player.emit('timeupdate');
  await drain();
  finish(freshLease());
  await drain();
  player.emit('loadedmetadata');
  await drain();
  assert.equal(player.paused(), false, 'replacement pause must not cancel the playback intent');
});

test('first web lease uses the heartbeat capability expiry, not the six-hour Moodle HMAC expiry', async () => {
  const {context, player, cfg, advance} = fixture();
  const issuedAt = Math.floor(Date.now() / 1000);
  cfg.playlistUrl = '/filter/impronta/playlist.php?f=class&e=' + (issuedAt + 21600);
  cfg.fragmentLeaseExpiresAt = 0;
  let calls = 0;
  const renew = () => { calls++; return Promise.resolve({playlistUrl: '/renewed'}); };
  context.window.ImprontaAcceptFragmentLease(cfg, {
    authorizedPlayback: true, fragmentLeaseExpiresAt: issuedAt + 900
  });
  player.play();
  context.window.ImprontaAuthorizedLifecycle(player, cfg, renew);
  assert.equal(cfg.fragmentLeaseExpiresAt, issuedAt + 900, 'heartbeat propagates authorized.expires_at');
  player.emit('timeupdate');
  await drain();
  assert.equal(calls, 0, 'the first lease is not renewed at startup');
  advance(810000);
  player.emit('timeupdate');
  await drain();
  assert.equal(calls, 1, 'the first 15-minute lease renews proactively before it expires');
});
