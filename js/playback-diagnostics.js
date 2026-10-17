/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
// Opt-in observation only. Never change a source, seek, pause, or retry media.
window.ImprontaPlaybackDiagnostics = function(player, cfg) {
  'use strict';
  var noop = {enabled: false, record: function() {}, report: function() {}};
  if (!cfg.diagnosticUrl) { return noop; }
  var history = [], requests = [], sent = [], xhr = null;
  var disposed = false, disabled = false, stalled = false;
  var lastPosition = 0, lastProgress = Date.now(), followup = null;
  function value(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
  function number(n, fallback) { n = Number(n); return isFinite(n) ? Math.round(n * 1000) / 1000 : fallback; }
  function snapshot(event) {
    var ranges = value(function() { return player.buffered(); }, null), buffered = [];
    var position = number(value(function() { return player.currentTime(); }, 0), 0), ahead = 0;
    if (ranges) {
      for (var r = 0; r < Math.min(ranges.length, 1000); r++) {
        if (ranges.start(r) <= position && position <= ranges.end(r)) { ahead = ranges.end(r) - position; break; }
      }
      for (var i = Math.max(0, ranges.length - 6); i < ranges.length; i++) {
        buffered.push([number(ranges.start(i), 0), number(ranges.end(i), 0)]);
      }
    }
    var quality = value(function() { return player.tech(true).el().getVideoPlaybackQuality(); }, {}) || {};
    return {
      at: Date.now(), event: event,
      position: position,
      duration: number(value(function() { return player.duration(); }, 0), 0),
      rate: number(value(function() { return player.playbackRate(); }, 1), 1),
      paused: !!value(function() { return player.paused(); }, true),
      seeking: !!value(function() { return player.seeking(); }, false),
      readyState: number(value(function() { return player.readyState(); }, 0), 0),
      networkState: number(value(function() { return player.networkState(); }, 0), 0),
      hidden: document.visibilityState === 'hidden', buffered: buffered,
      bufferedRangeCount: ranges ? ranges.length : 0, contiguousAhead: number(ahead, 0),
      frames: number(quality.totalVideoFrames, 0), droppedFrames: number(quality.droppedVideoFrames, 0),
      errorCode: number(value(function() { return (player.error() || {}).code; }, 0), 0)
    };
  }
  function record(event) {
    if (disposed || disabled) { return; }
    try {
      var state = snapshot(event);
      history.push(state);
      history = history.filter(function(s) { return s.at >= Date.now() - 20000; }).slice(-40);
    } catch (e) {}
  }
  function report(reason) {
    if (disposed || disabled || !cfg.diagnosticUrl) { return; }
    try {
      sent = sent.filter(function(t) { return t > Date.now() - 60000; });
      if (sent.length >= 6) { return; }
      sent.push(Date.now());
      var payload = {version: 1, reason: reason, history: history.slice(-40), requests: requests.slice(-12)};
      var body = JSON.stringify(payload);
      while (body.length > 24000 && payload.history.length > 1) { payload.history.shift(); body = JSON.stringify(payload); }
      Promise.resolve(window.fetch(cfg.diagnosticUrl, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: body, keepalive: true
      })).then(function(response) {
        // Removing an ID in settings takes effect even in an already-open tab.
        if (response && (response.status === 403 || response.status === 404)) { disabled = true; }
      }).catch(function() {});
      if (reason !== 'followup' && followup === null) {
        followup = window.setTimeout(function() { followup = null; record('sample'); report('followup'); }, 10000);
      }
    } catch (e) {}
  }
  function response(request, error, result) {
    try {
      var uri = String(request && (request.uri || request.url) || '');
      var segment = /\/s\/[^/?]+\/(\d+)(?:[?#]|$)/.exec(uri);
      var route = segment ? 'segment' : /\/w\//.test(uri) ? 'watermark' :
        /\/media\//.test(uri) ? 'media' : /(?:\.m3u8|playlist\.php)(?:[?#]|$)/.test(uri) ? 'manifest' : 'other';
      var status = number(request && request.status || result && result.statusCode, 0);
      // VHS calls its response hooks before filling roundTripTime/bytesReceived.
      var elapsed = request && request.roundTripTime;
      if (elapsed == null && request && request.requestTime) { elapsed = Date.now() - request.requestTime; }
      var bytes = request && request.bytesReceived;
      if (bytes == null && request && request.response) { bytes = request.response.byteLength || request.response.length; }
      requests.push({at: Date.now(), route: route, segment: segment ? Number(segment[1]) : -1,
        status: status, elapsedMs: number(elapsed == null ? -1 : elapsed, -1),
        bytes: number(bytes == null ? -1 : bytes, -1), failed: !!error || status >= 400});
      requests = requests.slice(-12);
    } catch (e) {}
  }
  function attachRequests() {
    var next = value(function() { return player.tech(true).vhs.xhr; }, null);
    if (xhr === next) { return; }
    if (xhr && typeof xhr.offResponse === 'function') { xhr.offResponse(response); }
    xhr = next;
    if (xhr && typeof xhr.onResponse === 'function') { xhr.onResponse(response); }
  }
  function observe(event) {
    player.on(event, function() {
      try {
        record(event);
        if (event === 'play' || event === 'seeked' || event === 'playing') {
          lastProgress = Date.now(); lastPosition = number(player.currentTime(), 0);
        }
        if (event === 'error') { report('error'); }
        if (event === 'playing' && stalled) { stalled = false; report('recovered'); }
        if (event === 'loadedmetadata') { attachRequests(); }
      } catch (e) {}
    });
  }
  ['play', 'pause', 'seeking', 'seeked', 'playing', 'waiting', 'stalled', 'error', 'ratechange', 'loadedmetadata'].forEach(observe);
  player.on('xhr-hooks-ready', function() { try { attachRequests(); } catch (e) {} });
  var timer = window.setInterval(function() {
    if (disposed || disabled) { return; }
    try {
      attachRequests(); record('sample');
      var position = number(player.currentTime(), 0);
      if (player.paused() || player.seeking() || document.visibilityState === 'hidden' || position !== lastPosition) {
        lastProgress = Date.now(); lastPosition = position; stalled = false; return;
      }
      if (!stalled && Date.now() - lastProgress >= 3000) { stalled = true; report('waiting'); }
    } catch (e) {}
  }, 1000);
  function pagehide() { record('visibility'); if (stalled) { report('pagehide'); } }
  window.addEventListener('pagehide', pagehide);
  player.on('dispose', function() {
    disposed = true; window.clearInterval(timer);
    if (followup !== null) { window.clearTimeout(followup); }
    window.removeEventListener('pagehide', pagehide);
    if (xhr && typeof xhr.offResponse === 'function') { try { xhr.offResponse(response); } catch (e) {} }
  });
  lastPosition = number(value(function() { return player.currentTime(); }, 0), 0);
  record('sample');
  try { attachRequests(); } catch (e) {}
  return {enabled: true, record: record, report: report};
};
