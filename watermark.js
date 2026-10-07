/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
(function(global, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    factory(exports);
  } else if (typeof define === 'function' && define.amd) {
    define(['exports'], factory);
  } else {
    global.ImprontaWatermark = {};
    factory(global.ImprontaWatermark);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function(exports) {
  'use strict';

  exports.attach = function(player, options) {
    if (!player || !player.el_) {
      throw new Error('ImprontaWatermark.attach: first argument must be a Video.js player instance.');
    }
    if (!options || !options.label) {
      throw new Error('ImprontaWatermark.attach: options.label is required.');
    }

    var enforced = {
      display: 'block',
      visibility: 'visible',
      position: 'absolute',
      'pointer-events': 'none',
      'z-index': '2147483647',
      filter: 'none',
      transform: 'none',
      clip: 'auto',
      'clip-path': 'none'
    };
    var label = options.label;
    var tamperLimit = options.tamperLimit || 3;
    var onTamper = options.onTamper || function() {};
    var opacity = options.fixedOpacity || 0.25;
    var root = player.el_;
    var tamperCount = 0;
    var hiddenStreak = 0;
    var observer = null;
    var styleTimer = null;
    var destroyed = false;
    var insetRight = 24;
    var insetBottom = 24;

    var mark = document.createElement('div');
    mark.className = 'impronta-watermark';
    mark.classList.add('impronta-watermark-fixed');
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = label;
    mark.style.cssText = 'position:absolute;right:24px;bottom:24px;z-index:2147483647;'
      + 'pointer-events:none;color:#fff;font-size:11px;font-family:sans-serif;'
      + 'opacity:' + opacity + ';text-shadow:0 0 2px #000;white-space:nowrap;user-select:none;';

    function discardOwnMutations() {
      if (observer) { observer.takeRecords(); }
    }

    function mount() {
      if (!root.contains(mark)) { root.appendChild(mark); }
      discardOwnMutations();
    }

    // watermark-fit.js pasa las barras negras + 24px al rotar o entrar en
    // fullscreen. Sin argumentos, la base son 24px del reproductor.
    function reposition(right, bottom) {
      if (typeof right === 'number' && isFinite(right)) { insetRight = Math.max(0, right); }
      if (typeof bottom === 'number' && isFinite(bottom)) { insetBottom = Math.max(0, bottom); }
      mark.style.setProperty('left', 'auto', 'important');
      mark.style.setProperty('right', insetRight + 'px', 'important');
      mark.style.setProperty('top', 'auto', 'important');
      mark.style.setProperty('bottom', insetBottom + 'px', 'important');
      discardOwnMutations();
    }

    function enforceStyles() {
      Object.entries(enforced).forEach(function(entry) {
        mark.style.setProperty(entry[0], entry[1], 'important');
      });
      reposition();
      mark.style.setProperty('opacity', String(opacity), 'important');
      discardOwnMutations();
    }

    function isHidden() {
      var opacity = 1;
      for (var node = mark; node && node.nodeType === 1; node = node.parentElement) {
        var style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') { return true; }
        var nodeOpacity = Number(style.opacity);
        if (isFinite(nodeOpacity)) { opacity *= nodeOpacity; }
      }
      if (opacity < 0.05) { return true; }

      // offsetParent puede ser null durante un resize/reflow aunque el texto
      // siga visible (por ejemplo, al abrir DevTools acopladas). Usa el tamaño
      // final del nodo, comprobado por el temporizador estable de abajo.
      var rect = mark.getBoundingClientRect();
      return rect.width === 0 || rect.height === 0;
    }

    function isPlaying() {
      try {
        return typeof player.paused === 'function' && player.paused() === false;
      } catch (e) {
        return false;
      }
    }

    function registerTamper() {
      if (destroyed) { return; }
      tamperCount += 1;
      mount();
      enforceStyles();
      var position = 0;
      try { position = player.currentTime ? player.currentTime() : 0; } catch (e) {}
      // El evento representa superar el umbral, no cada mutación que observa
      // el DOM. Emitirlo una sola vez evita inflar la señal si el reproductor
      // vuelve a tocar el mismo nodo tras pausar.
      if (tamperCount === tamperLimit + 1) {
        onTamper(tamperCount, position);
        try { player.pause(); } catch (e) {}
      }
    }

    function destroy() {
      if (destroyed) { return; }
      destroyed = true;
      if (observer) { observer.disconnect(); observer = null; }
      if (styleTimer !== null) { clearInterval(styleTimer); styleTimer = null; }
      if (mark.parentNode) { mark.parentNode.removeChild(mark); }
      try { player.off('dispose', destroy); } catch (e) {}
    }

    observer = new MutationObserver(function(mutations) {
      if (destroyed) { return; }
      var removed = false;
      mutations.forEach(function(mutation) {
        mutation.removedNodes.forEach(function(node) {
          if (node === mark) { removed = true; }
        });
      });
      // Video.js puede mover la marca durante su montaje o al reordenar
      // componentes. MutationObserver entrega el lote después de que termine
      // el JavaScript síncrono, así que si la marca vuelve a estar dentro del
      // reproductor esa retirada fue solo una reubicación, no una manipulación.
      var detached = removed && !root.contains(mark);
      mount();
      enforceStyles();
      // La retirada del nodo es inequívoca. Los cambios de visibilidad se
      // confirman con dos lecturas estables en styleTimer: resize, fullscreen
      // y cambios de layout de Video.js pueden ocultarlo solo durante un frame.
      if (detached && isPlaying()) { registerTamper(); }
    });
    observer.observe(root, {
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden'],
      subtree: true
    });

    mount();
    reposition();
    enforceStyles();
    styleTimer = setInterval(function() {
      if (destroyed) { return; }
      if (document.hidden || !isPlaying()) {
        hiddenStreak = 0;
      } else if (isHidden()) {
        mount();
        enforceStyles();
        hiddenStreak += 1;
        if (hiddenStreak >= 2) {
          hiddenStreak = 0;
          registerTamper();
        }
      } else {
        hiddenStreak = 0;
      }
    }, 2000);
    player.on('dispose', destroy);

    return {destroy: destroy, reposition: reposition};
  };
});
