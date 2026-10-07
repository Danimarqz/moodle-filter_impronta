/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
// Experimental analytics pipeline. It is deliberately independent from the
// Legacy queue in player-extras.js and app-player.js: a failure here must never
// affect playback or the existing events/session requests.
(function(root) {
  'use strict';

  function id() {
    try {
      if (root.crypto && typeof root.crypto.randomUUID === 'function') {
        return root.crypto.randomUUID();
      }
    } catch (e) {}
    return 'b' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 10);
  }

  function finite(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  function bufferedEnd(player) {
    try {
      if (typeof player.bufferedEnd === 'function') {
        return Math.max(0, finite(player.bufferedEnd(), 0));
      }
      var ranges = typeof player.buffered === 'function' ? player.buffered() : null;
      if (ranges && ranges.length) { return Math.max(0, finite(ranges.end(ranges.length - 1), 0)); }
    } catch (e) {}
    return 0;
  }

  function ImprontaAnalyticsV2(player, cfg) {
    cfg = cfg || {};
    if (!player || cfg.enabled === false || !cfg.batchUrl) {
      return {setBeacon: function() {}, flush: function() {}};
    }

    var watched = 0;
    var maxPosition = 0;
    var currentPosition = 0;
    var lastPosition = 0;
    var seeking = false;
    var skipWatchDelta = false;
    var seekDelta = 0;
    var pauseDelta = 0;
    var buffering = 0;
    var tamperEvents = 0;
    var bufferingStarted = 0;
    var sequence = 1;
    var outbox = [];
    var sending = false;
    var destroyed = false;
    var closing = false;
    var checkpointTimer = null;
    var lastFlushAt = null;
    var beacon = root.navigator && typeof root.navigator.sendBeacon === 'function'
      ? function(url, body) { return root.navigator.sendBeacon(url, body); }
      : null;
    var checkpointInterval = Math.max(1000, Number(cfg.checkpointInterval) || 300000);

    function now() { return Date.now(); }

    function updatePosition() {
      var position = 0;
      try { position = Math.max(0, finite(player.currentTime(), 0)); } catch (e) {}
      var delta = position - lastPosition;
      if (!seeking && !skipWatchDelta && delta > 0 && delta < 2) { watched += delta; }
      if (!seeking) { skipWatchDelta = false; }
      currentPosition = position;
      maxPosition = Math.max(maxPosition, position);
      lastPosition = position;
    }

    function stopBuffering() {
      if (bufferingStarted > 0) {
        buffering += Math.max(0, (now() - bufferingStarted) / 1000);
        bufferingStarted = 0;
      }
    }

    function hasPendingState() {
      return watched > 0 || seekDelta > 0 || pauseDelta > 0 || buffering > 0 || tamperEvents > 0;
    }

    function snapshot(reason) {
      var sentAt = new Date(now()).toISOString();
      var batch = {
        sessionId: String(cfg.sessionId || ''),
        videoId: String(cfg.videoId || cfg.videoPath || cfg.path || ''),
        // Capture the signed relay URL together with the batch. A later video
        // change must never send an old video's payload through a new URL.
        batchUrl: String(cfg.batchUrl || ''),
        batchId: id(),
        sequence: sequence,
        reason: reason,
        watchedDelta: Math.round(watched * 100) / 100,
        maxPosition: Math.round(maxPosition * 100) / 100,
        currentPosition: Math.round(currentPosition * 100) / 100,
        bufferedEnd: Math.round(bufferedEnd(player) * 100) / 100,
        seekDelta: seekDelta,
        pauseDelta: pauseDelta,
        bufferingDelta: Math.round(buffering * 100) / 100,
        tamperEvents: tamperEvents,
        startedAt: sentAt,
        sentAt: sentAt
      };
      sequence += 1;
      return batch;
    }

    function resetDeltas() {
      watched = 0;
      seekDelta = 0;
      pauseDelta = 0;
      buffering = 0;
      tamperEvents = 0;
    }

    function removeBatch(batch) {
      for (var i = 0; i < outbox.length; i += 1) {
        if (outbox[i].batchId === batch.batchId) {
          outbox.splice(i, 1);
          return;
        }
      }
    }

    function acknowledge(batch) {
      removeBatch(batch);
      lastFlushAt = batch.sentAt;
    }

    function requestOptions(batch) {
      var payload = {};
      Object.keys(batch).forEach(function(key) {
        // batchUrl is transport metadata used by the client for retries. The
        // destination URL already carries the signed context; duplicating it
        // in the JSON body wastes bytes and exposes no additional analytics.
        if (key !== 'batchUrl') { payload[key] = batch[key]; }
      });
      return {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
        keepalive: true
      };
    }

    function requestBody(batch) {
      return requestOptions(batch).body;
    }

    function sendFetchDirect(batch) {
      if (!batch || !batch.batchUrl || !batch.sessionId) { return; }
      Promise.resolve().then(function() {
        return root.fetch(batch.batchUrl, requestOptions(batch));
      }).then(function(response) {
        if (response && response.ok && typeof response.json === 'function') {
          return response.json().then(function(body) {
            if (body && body.sessionId) { batch.sessionId = String(body.sessionId); }
          }).catch(function() {});
        }
      }).catch(function() {});
    }

    function sendNext() {
      if (sending || !outbox.length || !outbox[0].batchUrl || !outbox[0].sessionId) { return; }
      var batch = outbox[0];
      var acknowledged = false;
      sending = true;
      Promise.resolve().then(function() {
        return root.fetch(batch.batchUrl, requestOptions(batch));
      }).then(function(response) {
        if (!response || !response.ok) { throw new Error('analytics batch failed'); }
        acknowledge(batch);
        acknowledged = true;
        if (typeof response.json === 'function') {
          return response.json().then(function(body) {
            if (body && body.sessionId) { batch.sessionId = String(body.sessionId); }
          }).catch(function() {});
        }
      }).catch(function() {
        // Keep the exact batch object and identity for the next flush. New
        // playback deltas are already a separate batch in the outbox.
      }).then(function() {
        sending = false;
        if (acknowledged) { sendNext(); }
      });
    }

    function beaconOutbox() {
      // A pagehide must not depend on the continuation of a fetch that may be
      // killed with the document. Beacon every frozen batch independently.
      var remaining = outbox.slice();
      for (var i = 0; i < remaining.length; i += 1) {
        var batch = remaining[i];
        if (!batch.sessionId) { continue; }
        var accepted = false;
        try {
          accepted = typeof beacon === 'function' && beacon(batch.batchUrl, requestBody(batch));
        } catch (e) {}
        if (accepted) {
          acknowledge(batch);
        } else {
          // sendBeacon can reject because of quota, CSP, or an unsupported
          // WebView. Use an independent keepalive request immediately; do not
          // wait for the in-flight normal fetch to settle.
          sendFetchDirect(batch);
        }
      }
    }

    function flush(reason, useBeacon) {
      if (destroyed && reason !== 'pagehide' && reason !== 'dispose') { return; }
      stopBuffering();
      var shouldCreate = hasPendingState() || reason === 'ended';
      if (shouldCreate && cfg.batchUrl) {
        outbox.push(snapshot(reason || 'checkpoint'));
        resetDeltas();
      }
      if (useBeacon) {
        beaconOutbox();
      } else {
        sendNext();
      }
    }

    function scheduleCheckpoint() {
      checkpointTimer = root.setInterval(function() {
        if (hasPendingState() || outbox.length) { flush('checkpoint', false); }
      }, checkpointInterval);
    }

    function sourceVideoId() {
      try {
        var source = typeof player.currentSource === 'function' ? player.currentSource() : null;
        var src = source && source.src ? String(source.src) : '';
        var match = /[?&]f=([^&]+)/.exec(src);
        return match ? decodeURIComponent(match[1]) : '';
      } catch (e) { return ''; }
    }

    player.on('timeupdate', updatePosition);
    player.on('seeking', function() { seeking = true; skipWatchDelta = true; });
    player.on('seeked', function() {
      seekDelta += 1;
      seeking = false;
      skipWatchDelta = true;
      updatePosition();
    });
    player.on('pause', function() { pauseDelta += 1; flush('pause', false); });
    player.on('waiting', function() {
      if (!bufferingStarted) { bufferingStarted = now(); }
    });
    player.on('stalled', function() {
      if (!bufferingStarted) { bufferingStarted = now(); }
    });
    player.on('playing', stopBuffering);
    player.on('ended', function() { stopBuffering(); flush('ended', false); });
    root.addEventListener('pagehide', function() {
      closing = true;
      flush('pagehide', true);
    });
    player.on('dispose', function() {
      closing = true;
      flush('pagehide', true);
      destroyed = true;
      if (checkpointTimer) { root.clearInterval(checkpointTimer); }
    });
    scheduleCheckpoint();

    var api = {
      flush: flush,
      setBeacon: function(fn) { beacon = fn; },
      setContext: function(nextConfig) {
        nextConfig = nextConfig || {};
        if (Object.prototype.hasOwnProperty.call(nextConfig, 'batchUrl')) {
          cfg.batchUrl = nextConfig.batchUrl || '';
        }
        if (Object.prototype.hasOwnProperty.call(nextConfig, 'sessionId')) {
          cfg.sessionId = String(nextConfig.sessionId || '');
          for (var i = 0; i < outbox.length; i += 1) {
            if (!outbox[i].sessionId) { outbox[i].sessionId = cfg.sessionId; }
          }
          if (closing) { beaconOutbox(); }
          else { sendNext(); }
        }
      },
      setSession: function(sessionId) {
        sessionId = String(sessionId || '');
        if (!sessionId) { return; }
        cfg.sessionId = sessionId;
        for (var i = 0; i < outbox.length; i += 1) {
          if (!outbox[i].sessionId) { outbox[i].sessionId = sessionId; }
        }
        // A late first Legacy acknowledgement can arrive after pagehide.
        // Drain only frozen batches and retain the closing transport; do not
        // create a checkpoint or depend on a normal fetch continuation.
        if (closing) { beaconOutbox(); }
        else { sendNext(); }
      },
      changeVideo: function(videoId, nextConfig) {
        // The old batch remains tied to its old signed URL. A caller changing
        // source must provide the new signed relay context; without it V2 is
        // disabled for the new source rather than mixing videos or producing
        // batches the relay will reject.
        flush('video_change', false);
        nextConfig = nextConfig || {};
        cfg.videoId = videoId;
        activeVideoId = String(videoId || '');
        if (Object.prototype.hasOwnProperty.call(nextConfig, 'batchUrl')) {
          cfg.batchUrl = nextConfig.batchUrl || '';
        } else {
          cfg.batchUrl = '';
        }
        if (Object.prototype.hasOwnProperty.call(nextConfig, 'sessionId')) {
          cfg.sessionId = nextConfig.sessionId || '';
        }
        lastPosition = 0;
        currentPosition = 0;
        maxPosition = 0;
        resetDeltas();
      },
      recordTamper: function() { tamperEvents += 1; },
      state: function() {
        return {
          pendingWatchedSeconds: watched,
          maxPosition: maxPosition,
          currentPosition: currentPosition,
          bufferedEnd: bufferedEnd(player),
          pendingSeekCount: seekDelta,
          pendingPauseCount: pauseDelta,
          pendingBufferingSeconds: buffering,
          tamperEvents: tamperEvents,
          batchSequence: sequence,
          lastFlushAt: lastFlushAt,
          outboxLength: outbox.length
        };
      }
    };
    player.improntaAnalyticsV2 = api;
    var activeVideoId = sourceVideoId() || String(cfg.videoId || cfg.videoPath || cfg.path || '');
    player.on('loadstart', function() {
      var nextVideoId = sourceVideoId();
      if (nextVideoId && activeVideoId && nextVideoId !== activeVideoId) {
        api.changeVideo(nextVideoId);
      }
      if (nextVideoId) { activeVideoId = nextVideoId; }
    });
    player.on('impronta:videochange', function(event) {
      try {
        var nextVideoId = event && event.videoId ? event.videoId : cfg.videoId || cfg.videoPath || cfg.path;
        activeVideoId = String(nextVideoId || '');
        api.changeVideo(nextVideoId,
          event && event.batchUrl ? {batchUrl: event.batchUrl, sessionId: event.sessionId} : undefined);
      } catch (e) {}
    });
    return api;
  }

  root.ImprontaAnalyticsV2 = ImprontaAnalyticsV2;
})(window);
