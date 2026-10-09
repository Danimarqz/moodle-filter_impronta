/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
// One renewal in flight per player. Only Moodle's authenticated endpoints issue URLs.
window.ImprontaPlaybackRenew = function(cfg, request) {
  var pending = null;
  var pendingReplay = false;
  return function renew(options) {
    var replay = !!(options && options.newPlayback);
    if (pending) {
      if (replay && !pendingReplay) { return pending.then(function() { return renew(options); }); }
      return pending;
    }
    pendingReplay = replay;
    pending = Promise.resolve().then(function() { return request(cfg.playlistUrl, options || {}); }).then(function(fresh) {
      if (!fresh || !fresh.playlistUrl || !fresh.eventsUrl || !fresh.sessionUrl
          || !fresh.batchUrl || !fresh.realtimeUrl || (replay && fresh.samePlayback)) {
        throw new Error('invalid playback renewal');
      }
      cfg.playlistUrl = fresh.playlistUrl;
      cfg.eventsUrl = fresh.eventsUrl;
      cfg.sessionUrl = fresh.sessionUrl;
      cfg.batchUrl = fresh.batchUrl;
      cfg.realtimeUrl = fresh.realtimeUrl;
      if (typeof cfg.onPlaybackRenewed === 'function') {
        cfg.onPlaybackRenewed(fresh);
      }
      return fresh;
    }).then(function(value) { pending = null; return value; }, function(error) {
      pending = null;
      throw error;
    });
    return pending;
  };
};

// A mobile course can restore signed markup from disk. Each NEW player obtains
// its own intent on the first explicit Play, before installing that media URL.
// Unused players do not renew, and pause/resume never allocates another intent.
window.ImprontaPlaybackStart = function(player, cfg, renew, ready) {
  var originalPlay = player.play;
  var originalPause = player.pause;
  var pending = null;
  var prepared = false;
  var installed = false;
  var destroyed = false;
  var requested = false;
  var doc = window.document;
  var observer = null;
  var ancestors = [];
  var releaseSource = null;
  function cancel() { requested = false; }
  function visibility() { if (doc.visibilityState === 'hidden') { cancel(); } }
  function removals(records) {
    for (var i = 0; i < records.length; i++) {
      var nodes = records[i].removedNodes || [];
      for (var j = 0; j < nodes.length; j++) {
        if (ancestors.indexOf(nodes[j]) !== -1) { cancel(); return; }
      }
    }
  }
  function watch() {
    if (observer) { removals(observer.takeRecords()); }
    var element = typeof player.el === 'function' ? player.el() : null;
    ancestors = [];
    for (var node = element; node; node = node.parentNode) { ancestors.push(node); }
    if (!observer && doc && doc.documentElement && typeof window.MutationObserver === 'function') {
      observer = new window.MutationObserver(removals);
      observer.observe(doc.documentElement, {childList: true, subtree: true});
    }
  }
  function canStart() {
    if (observer) { removals(observer.takeRecords()); }
    var element = typeof player.el === 'function' ? player.el() : null;
    return !destroyed && requested && !(doc && doc.visibilityState === 'hidden')
      && !(element && element.isConnected === false);
  }
  function detach() {
    if (observer) { observer.disconnect(); observer = null; }
    if (doc) {
      doc.removeEventListener('visibilitychange', visibility);
      doc.removeEventListener('pause', cancel);
    }
    if (typeof window.removeEventListener === 'function') { window.removeEventListener('pagehide', cancel); }
  }
  if (doc) {
    doc.addEventListener('visibilitychange', visibility);
    doc.addEventListener('pause', cancel);
  }
  if (typeof window.addEventListener === 'function') { window.addEventListener('pagehide', cancel); }
  function loadSource() {
    return new Promise(function(resolve, reject) {
      var settled = false;
      var timer = null;
      function complete(error) {
        if (settled) { return; }
        settled = true;
        if (timer !== null) { window.clearTimeout(timer); }
        player.off('loadedmetadata', metadata);
        player.off('error', failed);
        releaseSource = null;
        if (error) { reject(error); } else { resolve(); }
      }
      function metadata() {
        installed = true;
        complete();
      }
      function failed() { complete(new Error('playback source unavailable')); }
      releaseSource = function() { complete(new Error('playback disposed')); };
      player.on('loadedmetadata', metadata);
      player.on('error', failed);
      if (typeof window.setTimeout === 'function') { timer = window.setTimeout(failed, 15000); }
      try {
        // Do not let Video.js enqueue play behind asynchronous source setup:
        // a subsequent pause cannot cancel that internal queued callback.
        if (typeof player.preload === 'function') { player.preload('metadata'); }
        player.src({src: cfg.playlistUrl, type: 'application/x-mpegURL'});
        if (!settled && typeof player.load === 'function') { player.load(); }
      } catch (error) { complete(error); }
    });
  }
  player.pause = function() {
    requested = false;
    return originalPause.apply(player, arguments);
  };
  player.play = function() {
    var args = arguments;
    if (destroyed) { return Promise.reject(new Error('playback disposed')); }
    if (pending) { watch(); requested = true; return pending; }
    if (installed) { return originalPlay.apply(player, args); }
    watch();
    requested = true;
    pending = Promise.resolve(ready).then(function() {
      if (destroyed) { throw new Error('playback disposed'); }
      if (!prepared) {
        return renew({newPlayback: true}).then(function() { prepared = true; });
      }
    }).then(function() {
      if (!canStart()) { return; }
      return loadSource().then(function() {
        var resume = canStart();
        detach();
        if (resume) { return originalPlay.apply(player, args); }
      });
    }).then(function(value) { pending = null; return value; }, function(error) {
      pending = null;
      throw error;
    });
    return pending;
  };
  player.on('dispose', function() {
    destroyed = true;
    cancel();
    detach();
    if (releaseSource) { releaseSource(); }
  });
};

// Native HLS cannot swap a bearer header: reload the signed manifest before its
// capability expires, restoring position and preserving the server session.
// After ended, a replay requests a NEW signed intent instead. Legacy-only
// players do not enter this lifecycle and keep their original behavior.
window.ImprontaAuthorizedLifecycle = function(player, cfg, renew) {
  var ended = false;
  var pending = false;
  var destroyed = false;
  var timer = null;
  var retryAfter = 0;
  var loadTimer = null;
  var cycle = 0;
  var loading = false;
  function clearLoadTimer() {
    if (loadTimer !== null) { window.clearTimeout(loadTimer); loadTimer = null; }
  }
  function failLoad() {
    if (!loading) { return; }
    cycle += 1;
    loading = false;
    pending = false;
    retryAfter = Date.now() + 30000;
    clearLoadTimer();
  }
  function reload(replay) {
    if (destroyed || !cfg.authorizedPlayback || typeof renew !== 'function') { return; }
    if (pending || Date.now() < retryAfter) {
      if (replay) { try { player.pause(); } catch (e) {} }
      return;
    }
    pending = true;
    var currentCycle = ++cycle;
    var position = replay ? 0 : Number(player.currentTime() || 0);
    var resume = !player.paused();
    try { player.pause(); } catch (e) {}
    if (typeof cfg.beforeAuthorizedReload === 'function') { cfg.beforeAuthorizedReload(); }
    Promise.resolve().then(function() { return renew({newPlayback: replay}); }).then(function(fresh) {
      if (destroyed || currentCycle !== cycle) { return; }
      cfg.fragmentLeaseExpiresAt = 0;
      loading = true;
      if (typeof window.setTimeout === 'function') { loadTimer = window.setTimeout(failLoad, 15000); }
      player.one('loadedmetadata', function() {
        if (currentCycle !== cycle || !loading) { return; }
        clearLoadTimer();
        loading = false;
        pending = false;
        if (destroyed) { return; }
        ended = false;
        player.currentTime(position);
        if (resume) {
          var played = player.play();
          if (played && typeof played.catch === 'function') { played.catch(function() {}); }
        }
      });
      player.src({src: fresh.playlistUrl, type: 'application/x-mpegURL'});
    }).catch(function() {
      pending = false;
      retryAfter = Date.now() + 30000;
      if (!destroyed && resume && !replay) {
        // Failed auxiliary renewal does not impose an extra playback stop;
        // existing media/auth error recovery remains responsible for expiry.
        var played = player.play();
        if (played && typeof played.catch === 'function') { played.catch(function() {}); }
      }
    });
  }
  function check() {
    if (destroyed || pending || player.paused() || ended || !cfg.authorizedPlayback) { return; }
    var deadline = Number(cfg.fragmentLeaseExpiresAt || 0);
    if (deadline > 0 && deadline * 1000 <= Date.now() + 90000) { reload(false); }
  }
  player.on('ended', function() { ended = true; });
  player.on('play', function() { if (ended && cfg.authorizedPlayback) { reload(true); } else { check(); } });
  player.on('timeupdate', check);
  player.on('error', failLoad);
  if (typeof window.setInterval === 'function') { timer = window.setInterval(check, 30000); }
  player.on('dispose', function() { destroyed = true; cycle += 1; clearLoadTimer(); if (timer !== null) { window.clearInterval(timer); } });
};
