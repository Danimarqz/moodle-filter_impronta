const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(enabled = true, transport) {
  let now = 100000, next = 0;
  const timers = new Map(), handlers = {}, requests = [], xhrListeners = new Set();
  const player = {
    position: 10, isPaused: false, isSeeking: false,
    on(event, fn) { (handlers[event] ||= []).push(fn); },
    emit(event) { (handlers[event] || []).forEach(fn => fn()); },
    currentTime() { return this.position; }, duration() { return 600; },
    paused() { return this.isPaused; }, seeking() { return this.isSeeking; },
    playbackRate() { return 2; }, readyState() { return 3; }, networkState() { return 2; },
    buffered() { return {length: 2, start: i => [0, 30][i], end: i => [12, 90][i]}; },
    error() { return {code: 3, message: 'Bearer SECRET https://example/Signature=SECRET'}; },
    tech() { return {vhs: {xhr: {
      onResponse(fn) { xhrListeners.add(fn); }, offResponse(fn) { xhrListeners.delete(fn); }
    }}}; }
  };
  const listeners = {};
  const context = {
    Date: {now: () => now}, document: {visibilityState: 'visible'},
    setInterval(fn, ms) { const id = ++next; timers.set(id, {fn, ms, due: now + ms, repeat: true}); return id; },
    setTimeout(fn, ms) { const id = ++next; timers.set(id, {fn, ms, due: now + ms}); return id; },
    clearInterval(id) { timers.delete(id); }, clearTimeout(id) { timers.delete(id); },
    addEventListener(event, fn) { listeners[event] = fn; },
    removeEventListener(event) { delete listeners[event]; },
    fetch(url, options) { requests.push({url, body: JSON.parse(options.body)}); return transport ? transport() : Promise.resolve({status: 204}); },
    console
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(__dirname + '/../js/playback-diagnostics.js', 'utf8'), context);
  const cfg = {diagnosticUrl: enabled ? '/diagnostic-signed' : '', sessionId: 'ignored-client-session'};
  const diagnostic = context.ImprontaPlaybackDiagnostics(player, cfg);
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const due = [...timers.entries()].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!due) break;
      const [id, t] = due; now = t.due;
      if (t.repeat) t.due += t.ms; else timers.delete(id);
      t.fn();
    }
    now = end;
  }
  return {player, cfg, diagnostic, requests, timers, xhrListeners, advance};
}

test('unselected players install no monitoring or requests', () => {
  const h = harness(false); h.advance(60000); h.player.emit('error');
  assert.equal(h.timers.size, 0); assert.equal(h.requests.length, 0); assert.equal(h.xhrListeners.size, 0);
});
test('a frozen playing video reports after three seconds with full buffered ranges', () => {
  const h = harness(); h.advance(3000);
  assert.equal(h.requests.length, 1);
  const report = h.requests[0].body;
  assert.equal(report.reason, 'waiting');
  assert.equal(report.history.at(-1).position, 10);
  assert.deepEqual(report.history.at(-1).buffered, [[0, 12], [30, 90]]);
  assert.equal(report.history.at(-1).rate, 2);
  assert.equal(report.history.at(-1).errorCode, 3);
  assert.equal(report.history.at(-1).contiguousAhead, 2);
  assert.doesNotMatch(JSON.stringify(report), /SECRET|Bearer|Signature|sessionId/);
});
test('pauses and seeks do not count as a frozen playing video', () => {
  const h = harness(); h.player.isPaused = true; h.advance(10000);
  h.player.isPaused = false; h.player.isSeeking = true; h.advance(10000);
  assert.equal(h.requests.length, 0);
});
test('VHS responses retain only safe request metrics and hooks are removed on dispose', () => {
  const h = harness();
  for (const fn of h.xhrListeners) fn({uri: 'https://cdn.example/s/SECRET/42?Signature=SECRET', status: 403, roundTripTime: 123, bytesReceived: 0}, null, {statusCode: 403});
  h.player.emit('error');
  assert.equal(h.requests[0].body.requests[0].route, 'segment');
  assert.equal(h.requests[0].body.requests[0].segment, 42);
  assert.equal(h.requests[0].body.requests[0].status, 403);
  assert.equal(h.requests[0].body.requests[0].failed, true);
  assert.doesNotMatch(JSON.stringify(h.requests), /SECRET|Signature/);
  h.player.emit('dispose'); assert.equal(h.xhrListeners.size, 0); assert.equal(h.timers.size, 0);
});
test('diagnostic failures never escape into playback and buffers stay bounded', () => {
  const h = harness(); h.cfg.diagnosticUrl = '/new-signed-endpoint';
  for (let i = 0; i < 100; i++) { h.player.position++; h.player.emit('timeupdate'); h.player.emit('error'); }
  assert.ok(h.requests.length <= 6);
  assert.ok(h.requests.every(r => r.url === '/new-signed-endpoint' && r.body.history.length <= 40));
});
test('both thrown and rejected diagnostic transports leave the video playing', async () => {
  for (const transport of [() => { throw new Error('Synthetic transport'); }, () => Promise.reject(new Error('Synthetic transport'))]) {
    const h = harness(true, transport);
    assert.doesNotThrow(() => h.advance(3500));
    await Promise.resolve(); await Promise.resolve();
    assert.equal(h.player.isPaused, false);
    assert.equal(h.player.position, 10);
    h.player.emit('dispose');
  }
});
test('server deselection stops further uploads in an already-open player', async () => {
  const h = harness(true, () => Promise.resolve({status: 403}));
  h.advance(3000); await new Promise(resolve => setImmediate(resolve));
  h.player.emit('error'); h.advance(15000);
  assert.equal(h.requests.length, 1);
  h.player.emit('dispose');
});
