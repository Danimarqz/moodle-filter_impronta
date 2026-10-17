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
    if (cfg.diagnostics) { cfg.diagnostics.record('renew_start'); }
    var controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    var requestOptions = Object.assign({}, options || {});
    if (controller) { requestOptions.signal = controller.signal; }
    var timeoutId = null;
    var requestPromise = Promise.resolve().then(function() { return request(cfg.playlistUrl, requestOptions); });
    var boundedRequest = requestPromise;
    if (typeof window.setTimeout === 'function') {
      var deadline = new Promise(function(resolve, reject) {
        timeoutId = window.setTimeout(function() {
          if (controller) { controller.abort(); }
          reject(new Error('playback renewal timed out'));
        }, 15000);
      });
      boundedRequest = Promise.race([requestPromise, deadline]);
    }
    pending = boundedRequest.then(function(fresh) {
      var expiresAt = Number(fresh && fresh.expiresAt || 0);
      if (!(expiresAt > 0)) {
        var expiryMatch = /[?&]e=(\d+)/.exec(fresh && fresh.playlistUrl || '');
        expiresAt = expiryMatch ? Number(expiryMatch[1]) : 0;
      }
      if (!fresh || !fresh.playlistUrl || !fresh.eventsUrl || !fresh.sessionUrl
          || !fresh.batchUrl || !fresh.realtimeUrl || !(expiresAt > 0) || (replay && fresh.samePlayback)) {
        throw new Error('invalid playback renewal');
      }
      cfg.playlistUrl = fresh.playlistUrl;
      cfg.eventsUrl = fresh.eventsUrl;
      cfg.sessionUrl = fresh.sessionUrl;
      cfg.batchUrl = fresh.batchUrl;
      cfg.realtimeUrl = fresh.realtimeUrl;
      if (typeof fresh.diagnosticUrl === 'string') { cfg.diagnosticUrl = fresh.diagnosticUrl; }
      if (cfg.diagnostics) { cfg.diagnostics.record('renew_ok'); }
      if (typeof cfg.onPlaybackRenewed === 'function') {
        cfg.onPlaybackRenewed(fresh);
      }
      return fresh;
    }).then(function(value) {
      if (timeoutId !== null) { window.clearTimeout(timeoutId); }
      pending = null;
      return value;
    }, function(error) {
      if (timeoutId !== null) { window.clearTimeout(timeoutId); }
      pending = null;
      if (cfg.diagnostics) { cfg.diagnostics.record('renew_error'); }
      throw error;
    });
    return pending;
  };
};

// The Moodle `e` parameter (and renewal `expiresAt`) authenticate Moodle URLs;
// neither is the short-lived fragment capability. Only an authenticated
// heartbeat may seed this deadline from the server-side lease cached when the
// current playlist was fetched.
window.ImprontaAcceptFragmentLease = function(cfg, response) {
  if (!cfg || !response || response.authorizedPlayback !== true
      || !Object.prototype.hasOwnProperty.call(response, 'fragmentLeaseExpiresAt')) { return false; }
  var expiresAt = Number(response.fragmentLeaseExpiresAt);
  if (!isFinite(expiresAt) || expiresAt <= 0) { return false; }
  cfg.fragmentLeaseExpiresAt = expiresAt;
  cfg.authorizedPlayback = true;
  return true;
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
  var replayRetryTimer = null;
  var retryAfter = 0;
  var loadTimer = null;
  var cycle = 0;
  var loading = false;
  var retryNeeded = false;
  var ignoredPauseEvents = 0;
  var internalPause = false;
  var wantsPlayback = !player.paused();
  var position = 0;
  var playbackRate = 1;
  var sourceListeners = null;
  var doc = window.document;

  if (!isFinite(Number(cfg.authorizedSourceGeneration))) { cfg.authorizedSourceGeneration = 0; }
  if (typeof cfg.authorizedSourceReady !== 'boolean') { cfg.authorizedSourceReady = true; }

  if (!Number(cfg.fragmentLeaseExpiresAt || 0)) {
    cfg.fragmentLeaseExpiresAt = 0;
  }

  function clearLoadTimer() {
    if (loadTimer !== null) { window.clearTimeout(loadTimer); loadTimer = null; }
  }

  function clearReplayRetry() {
    if (replayRetryTimer !== null) { window.clearTimeout(replayRetryTimer); replayRetryTimer = null; }
  }

  function scheduleReplayRetry() {
    if (replayRetryTimer !== null || !ended || !wantsPlayback || destroyed
        || typeof window.setTimeout !== 'function') { return; }
    replayRetryTimer = window.setTimeout(function() {
      replayRetryTimer = null;
      if (ended && wantsPlayback && !destroyed) { reload(true, 'replay'); }
    }, Math.max(0, retryAfter - Date.now()));
  }

  function removeSourceListeners() {
    if (!sourceListeners) { return; }
    player.off('loadedmetadata', sourceListeners.metadata);
    player.off('error', sourceListeners.error);
    sourceListeners = null;
  }

  function release(error) {
    if (!loading) { return; }
    cycle += 1;
    loading = false;
    pending = false;
    retryAfter = Date.now() + 30000;
    retryNeeded = true;
    clearLoadTimer();
    removeSourceListeners();
    if (error && typeof cfg.onRenewalError === 'function') { cfg.onRenewalError(error); }
    if (ended && wantsPlayback) { scheduleReplayRetry(); }
  }

  function failLoad() { release(new Error('playback source unavailable')); }

  function pauseForSourceReplacement() {
    if (player.paused()) { return; }
    ignoredPauseEvents += 1;
    internalPause = true;
    try { player.pause(); } catch (error) { ignoredPauseEvents -= 1; }
    finally { internalPause = false; }
  }

  function reload(replay, reason) {
    if (destroyed || !cfg.authorizedPlayback || typeof renew !== 'function') { return; }
    if (pending) {
      if (!replay) { return; }
      // A Play after ended is a new logical session, even if an ordinary
      // renewal is already in flight. Cancel its source installation and queue
      // the identity-changing request behind the transport single-flight.
      wantsPlayback = true;
      ended = true;
      pauseForSourceReplacement();
      cycle += 1;
      pending = false;
      if (loading) {
        loading = false;
        clearLoadTimer();
        removeSourceListeners();
      }
      reload(true, reason || 'replay');
      return;
    }
    if (Date.now() < retryAfter) {
      if (replay) {
        wantsPlayback = true;
        ended = true;
        pauseForSourceReplacement();
        scheduleReplayRetry();
      }
      return;
    }
    if (cfg.diagnostics) {
      cfg.diagnostics.record(replay ? 'recovery_replay' : 'recovery_' + (reason || 'expiry'));
      cfg.diagnostics.report('recovery');
    }
    pending = true;
    retryNeeded = false;
    var currentCycle = ++cycle;
    var resume = false;
    if (replay) {
      wantsPlayback = true;
      clearReplayRetry();
      pauseForSourceReplacement();
    }
    Promise.resolve().then(function() { return renew({newPlayback: replay}); }).then(function(fresh) {
      if (destroyed || currentCycle !== cycle) { return; }
      if (!fresh || !fresh.playlistUrl) { throw new Error('invalid playback renewal'); }
      position = replay ? 0 : Number(player.currentTime() || 0);
      playbackRate = typeof player.playbackRate === 'function' ? Number(player.playbackRate() || 1) : 1;
      resume = replay || wantsPlayback;
      loading = true;
      pauseForSourceReplacement();
      cfg.authorizedSourceGeneration += 1;
      cfg.authorizedSourceReady = false;
      if (typeof cfg.beforeAuthorizedReload === 'function') { cfg.beforeAuthorizedReload(); }
      if (typeof window.setTimeout === 'function') { loadTimer = window.setTimeout(failLoad, 15000); }
      function onMetadata() {
        if (currentCycle !== cycle || !loading) { return; }
        clearLoadTimer();
        loading = false;
        pending = false;
        retryAfter = 0;
        retryNeeded = false;
        // The new manifest has now been fetched and its server-side lease
        // cached. Await its heartbeat deadline instead of carrying the old
        // capability expiry across source generations.
        cfg.fragmentLeaseExpiresAt = 0;
        cfg.authorizedSourceReady = true;
        removeSourceListeners();
        if (destroyed) { return; }
        if (replay) { ended = false; }
        player.currentTime(position);
        if (typeof player.playbackRate === 'function') { player.playbackRate(playbackRate); }
        if (resume && wantsPlayback && !ended) {
          var played = player.play();
          if (played && typeof played.catch === 'function') { played.catch(function() {}); }
        }
      }
      function onError() {
        failLoad();
      }
      sourceListeners = {metadata: onMetadata, error: onError};
      player.on('loadedmetadata', onMetadata);
      player.on('error', onError);
      try {
        player.src({src: fresh.playlistUrl, type: 'application/x-mpegURL'});
      } catch (error) {
        failLoad();
      }
    }).catch(function() {
      pending = false;
      retryAfter = Date.now() + 30000;
      retryNeeded = true;
      if (ended && wantsPlayback) { scheduleReplayRetry(); }
    });
  }

  function check() {
    if (destroyed || pending || player.paused() || ended || !cfg.authorizedPlayback) { return; }
    if (retryNeeded) {
      if (Date.now() >= retryAfter) { reload(false, 'error'); }
      return;
    }
    var deadline = Number(cfg.fragmentLeaseExpiresAt || 0);
    if (deadline > 0 && deadline * 1000 <= Date.now() + 90000) { reload(false, 'expiry'); }
  }

  player.on('ended', function() { ended = true; wantsPlayback = false; });
  player.on('play', function() {
    wantsPlayback = true;
    if (ended && cfg.authorizedPlayback) { reload(true, 'replay'); } else { check(); }
  });
  player.on('pause', function() {
    if (ignoredPauseEvents > 0) { ignoredPauseEvents -= 1; return; }
    wantsPlayback = false;
    clearReplayRetry();
  });
  if (typeof player.pause === 'function') {
    var originalPause = player.pause;
    player.pause = function() {
      if (!internalPause) { wantsPlayback = false; clearReplayRetry(); }
      return originalPause.apply(player, arguments);
    };
  }
  player.on('timeupdate', check);
  player.on('error', function() {
    if (loading) { failLoad(); }
    else if (cfg.authorizedPlayback) { reload(false, 'error'); }
  });
  function onVisibilityChange() {
    if (!doc) { return; }
    if (doc.visibilityState === 'hidden') {
      wantsPlayback = false;
      clearReplayRetry();
      cycle += 1;
      pending = false;
      loading = false;
      clearLoadTimer();
      removeSourceListeners();
    } else {
      check();
    }
  }
  function onPageHide() {
    wantsPlayback = false;
    clearReplayRetry();
    cycle += 1;
    pending = false;
    loading = false;
    clearLoadTimer();
    removeSourceListeners();
  }
  if (doc && typeof doc.addEventListener === 'function') { doc.addEventListener('visibilitychange', onVisibilityChange); }
  if (typeof window.addEventListener === 'function') { window.addEventListener('pagehide', onPageHide); }
  if (typeof window.setInterval === 'function') { timer = window.setInterval(check, 30000); }
  player.on('dispose', function() {
    destroyed = true;
    wantsPlayback = false;
    clearReplayRetry();
    cycle += 1;
    loading = false;
    pending = false;
    clearLoadTimer();
    removeSourceListeners();
    if (doc && typeof doc.removeEventListener === 'function') { doc.removeEventListener('visibilitychange', onVisibilityChange); }
    if (typeof window.removeEventListener === 'function') { window.removeEventListener('pagehide', onPageHide); }
    if (timer !== null) { window.clearInterval(timer); }
  });
  return {
    renew: function(reason) { reload(false, reason || 'error'); },
    refresh: check
  };
};
