const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = __dirname + '/..';
function fixture() {
  const handlers = {};
  let paused = true, position = 90, source = '/old-signed-p', playCalls = 0;
  const player = {
    on(name, fn) { (handlers[name] ||= []).push(fn); },
    one(name, fn) { const wrapper = () => { handlers[name] = handlers[name].filter(x => x !== wrapper); fn(); }; this.on(name, wrapper); },
    emit(name) { for (const fn of [...(handlers[name] || [])]) fn(); },
    currentTime(value) { if (value !== undefined) position = value; return position; },
    paused() { return paused; },
    pause() { paused = true; this.emit('pause'); },
    play() { paused = false; playCalls++; this.emit('play'); return Promise.resolve(); },
    src(value) { source = value.src; },
    get source() { return source; },
    get playCalls() { return playCalls; }
  };
  let now = Date.now();
  const context = {window: {setInterval() { return 1; }, clearInterval() {}}, Promise, Error, Date: {now: () => now}};
  vm.runInNewContext(fs.readFileSync(root + '/js/playback-renew.js', 'utf8'), context);
  const cfg = {authorizedPlayback: true, fragmentLeaseExpiresAt: Math.floor(Date.now()/1000)+600, playlistUrl: source};
  return {context, player, cfg, advance: (ms) => { now += ms; }};
}
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
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
