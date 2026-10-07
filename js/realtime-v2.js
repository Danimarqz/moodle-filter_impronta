/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
// Experimental WSS presence channel. It is intentionally fire-and-forget:
// connection failures never pause the player or disable Legacy analytics.
(function(root) {
  'use strict';

  var backoff = [1000, 2000, 5000, 10000, 30000];

  function metric(player, method) {
    try { return Math.max(0, Number(player[method]() || 0)); } catch (e) { return 0; }
  }

  function ImprontaRealtimeV2(player, cfg) {
    cfg = cfg || {};
    var socket = null;
    var heartbeatTimer = null;
    var reconnectTimer = null;
    var reconnectAttempt = 0;
    var active = false;
    var destroyed = false;
    var connecting = false;
    var generation = 0;
    var sessionKey = String(cfg.sessionId || '');
    var state = 'disconnected';
    var onState = typeof cfg.onRealtimeState === 'function' ? cfg.onRealtimeState : function() {};

    function setState(next) {
      state = next;
      try { onState(next); } catch (e) {}
    }

    function clearHeartbeat() {
      if (heartbeatTimer) { root.clearInterval(heartbeatTimer); heartbeatTimer = null; }
    }

    function clearReconnect() {
      if (reconnectTimer) { root.clearTimeout(reconnectTimer); reconnectTimer = null; }
    }

    function clearTokenRefresh() {
      // Las credenciales se renuevan dentro del heartbeat Legacy. V2 no hace
      // una segunda petición HTTP solo para renovar el token WSS.
    }

    function setCredentials(credentials) {
      if (!credentials || !credentials.url || !credentials.token) { return false; }
      cfg.realtimeSocketUrl = String(credentials.url);
      cfg.realtimeToken = String(credentials.token);
      cfg.realtimeExpiresAt = Number(credentials.expiresAt || 0);
      clearTokenRefresh();
      return true;
    }

    function isPlaying() {
      try { return !player.paused(); } catch (e) { return false; }
    }

    function sendHeartbeat() {
      // Pause is already persisted by Analytics V2. Keep a short-lived idle
      // socket reusable, but never pay for playing=false heartbeat messages.
      if (!socket || socket.readyState !== 1 || !cfg.sessionId || !isPlaying()) { return; }
      var payload = {
        action: 'heartbeat',
        token: cfg.realtimeToken,
        sessionId: String(cfg.sessionId),
        videoId: String(cfg.videoId || cfg.videoPath || cfg.path || ''),
        position: metric(player, 'currentTime'),
        bufferedEnd: metric(player, 'bufferedEnd'),
        playing: true,
        timestamp: Math.floor(Date.now() / 1000)
      };
      try { socket.send(JSON.stringify(payload)); } catch (e) {}
    }

    function connect(credentials, openGeneration) {
      if (openGeneration !== generation || !active || destroyed) { return; }
      // open() crosses promise boundaries. Playback can pause before those
      // continuations run; do not dial and release the flag for the next play.
      if (!isPlaying()) {
        connecting = false;
        setState('disconnected');
        return;
      }
      if (!credentials || !credentials.url || !credentials.token || typeof root.WebSocket !== 'function') {
        throw new Error('realtime credentials');
      }
      setCredentials(credentials);
      var separator = credentials.url.indexOf('?') === -1 ? '?' : '&';
      var candidate = new root.WebSocket(credentials.url + separator + 'token=' + encodeURIComponent(credentials.token));
      socket = candidate;
      candidate.onopen = function() {
        if (openGeneration !== generation || socket !== candidate) {
          try { candidate.close(); } catch (e) {}
          return;
        }
        connecting = false;
        reconnectAttempt = 0;
        setState('connected');
        sendHeartbeat();
        clearHeartbeat();
        heartbeatTimer = root.setInterval(sendHeartbeat, 12000);
      };
      candidate.onclose = function() {
        if (openGeneration !== generation || socket !== candidate) { return; }
        connecting = false;
        socket = null;
        clearHeartbeat();
        if (active && !destroyed) { scheduleReconnect(); }
        else { setState('disconnected'); }
      };
      candidate.onerror = function() {};
    }

    function open() {
      if (!active || destroyed || connecting || !isPlaying() || !cfg.sessionId ||
          !cfg.realtimeSocketUrl || !cfg.realtimeToken ||
          cfg.realtimeExpiresAt <= Math.floor(Date.now() / 1000) + 60) {
        return;
      }
      connecting = true;
      var openGeneration = generation;
      clearReconnect();
      setState(reconnectAttempt ? 'reconnecting' : 'disconnected');
      Promise.resolve().then(function() {
        return {url: cfg.realtimeSocketUrl, token: cfg.realtimeToken, expiresAt: cfg.realtimeExpiresAt};
      }).then(function(credentials) {
        if (credentials.sessionId && String(credentials.sessionId) !== String(cfg.sessionId || '')) {
          setSession(String(credentials.sessionId), credentials);
          return;
        }
        connect(credentials, openGeneration);
      }).catch(function() {
        if (openGeneration !== generation) { return; }
        connecting = false;
        scheduleReconnect();
      });
    }

    function scheduleReconnect() {
      if (!active || destroyed || reconnectTimer || !isPlaying()) {
        if (!socket && !destroyed) { setState('disconnected'); }
        return;
      }
      setState('reconnecting');
      var delay = backoff[Math.min(reconnectAttempt, backoff.length - 1)];
      reconnectAttempt += 1;
      reconnectTimer = root.setTimeout(function() {
        reconnectTimer = null;
        open();
      }, delay);
    }

    function start() {
      if (destroyed) { return; }
      active = true;
      if (socket && socket.readyState === 1) { sendHeartbeat(); }
      if (!socket && !reconnectTimer) { open(); }
    }

    function stop() {
      generation += 1;
      active = false;
      connecting = false;
      clearReconnect();
      clearHeartbeat();
      clearTokenRefresh();
      if (socket) {
        try { socket.close(); } catch (e) {}
        socket = null;
      }
      setState('disconnected');
    }

    function setSession(sessionId, credentials) {
      sessionId = String(sessionId || '');
      if (!sessionId || sessionId === sessionKey) { return; }
      var wasActive = active;
      stop();
      cfg.sessionId = sessionId;
      sessionKey = sessionId;
      cfg.realtimeSocketUrl = '';
      cfg.realtimeToken = '';
      cfg.realtimeExpiresAt = 0;
      if (credentials) { setCredentials(credentials); }
      reconnectAttempt = 0;
      if (wasActive) { start(); }
    }

    function setContext(nextConfig) {
      nextConfig = nextConfig || {};
      var wasActive = active;
      var nextUrl = Object.prototype.hasOwnProperty.call(nextConfig, 'realtimeUrl')
        ? String(nextConfig.realtimeUrl || '') : cfg.realtimeUrl;
      var nextSession = Object.prototype.hasOwnProperty.call(nextConfig, 'sessionId')
        ? String(nextConfig.sessionId || '') : String(cfg.sessionId || '');
      if (nextUrl === cfg.realtimeUrl && nextSession === sessionKey) { return; }
      stop();
      active = wasActive;
      cfg.realtimeUrl = nextUrl;
      cfg.sessionId = nextSession;
      sessionKey = nextSession;
      cfg.realtimeSocketUrl = '';
      cfg.realtimeToken = '';
      cfg.realtimeExpiresAt = 0;
      reconnectAttempt = 0;
      if (wasActive && nextSession) { start(); }
    }

    if (cfg.enabled !== false && cfg.realtimeUrl) {
      player.on('play', start);
      // The server session id arrives on the first Legacy heartbeat. This
      // hook starts WSS as soon as that id becomes available without changing
      // the Legacy cadence.
      player.on('timeupdate', function() {
        // A scheduled reconnect owns the backoff window. Do not let the
        // player's frequent timeupdate events cancel it and open eagerly.
        if (active && !socket && !reconnectTimer && !connecting && cfg.sessionId) { open(); }
      });
      // Once the video has ended there is no active playback state to report.
      // Closing here also invalidates the reconnect generation, so a socket
      // that drops at the end cannot start another connection.
      player.on('ended', stop);
      player.on('dispose', function() { destroyed = true; stop(); });
    }

    return {
      start: start,
      stop: stop,
      setSession: setSession,
      setCredentials: setCredentials,
      setContext: setContext,
      state: function() { return state; }
    };
  }

  root.ImprontaRealtimeV2 = ImprontaRealtimeV2;
})(window);
