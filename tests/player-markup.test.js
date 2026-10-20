/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');

const php = readFileSync(join(__dirname, '..', 'classes', 'player.php'), 'utf8');
const mobile = readFileSync(join(__dirname, '..', 'classes', 'output', 'mobile.php'), 'utf8');

test('el marcador App transmite las tasas configuradas del mismo render', () => {
  const render = php.slice(php.indexOf('public static function render'));
  const markerCall = render.slice(render.indexOf('return self::app_marker('), render.indexOf(');', render.indexOf('return self::app_marker(')));
  const marker = php.slice(php.indexOf('private static function app_marker('));
  assert.match(markerCall, /\$playbackrates/);
  assert.match(marker, /'playback-rates'\s*=>\s*json_encode\(\$playbackrates/);
  assert.match(php, /\$setupconfig\['playbackRates'\]\s*=\s*\$playbackrates/);
  assert.match(php, /public static function default_playback_rates\(\): array\s*\{\s*return \[0\.5, 0\.75, 1, 1\.25, 1\.5, 2\];/);
  assert.match(php, /'playbackrates'\s*=>\s*self::default_playback_rates\(\)/);
  assert.match(mobile, /'playbackRates'\s*=>\s*player::default_playback_rates\(\)/);
});

// video.js solo pasa la fuente por los source handlers (VHS/MSE) cuando alguien
// llama a src(). Con el markup en solitario el <video> se queda en la pila HLS
// nativa del navegador, que no puede con el 302 al /w/ del watermark: la sesion
// la mantienen viva los latidos de player-extras.js y el navegador no los
// dispara. Reproducido con el video.min.js desplegado (8.16.1) en Chrome 152:
// markup con <source> => tech.vhs undefined y peticiones de tipo "media"; el
// mismo markup mas player.src() => VHS montado y peticiones "xhr".
test('el reproductor de escritorio entrega la fuente a video.js, no al navegador', () => {
  const init = php.slice(php.indexOf("document.addEventListener('DOMContentLoaded'"));
  assert.match(init.slice(0, 2000), /videojs\(document\.getElementById\('\{\$escapedid\}'\)\)/);
  assert.match(init.slice(0, 2000), /player\.src\(\{src: \{\$playlistjson\}, type: 'application\/x-mpegURL'\}\)/);
  // La URL se mete como JSON escapado: el nombre de la clase va en la query y
  // un "</script>" a pelo cerraria el bloque.
  assert.match(php, /JSON_HEX_TAG \| JSON_HEX_AMP \| JSON_HEX_QUOT \| JSON_HEX_APOS/);
  // Y no puede cambiarle la fuente al player de otro elemento con el mismo id.
  assert.match(init.slice(0, 2000), /querySelectorAll\('\[id="\{\$escapedid\}"\]'\)\.length > 1/);
});

// Desde adb754b el playbackid va firmado dentro del token tambien en modo
// normal, y authorize lo reconstruye con lo que llega por URL. tracks_html se
// estaba haciendo la query a mano y solo anadia p en scorm, asi que el <track>
// de subtitulos pedía playlist.php sin p contra un token que sí lo llevaba:
// 403 seguro. endpoint_url es el unico sitio que tiene esa regla.
test('la pista de subtitulos usa el constructor canonico de URLs firmadas', () => {
  const fn = php.slice(php.indexOf('private static function tracks_html'));
  const body = fn.slice(0, fn.indexOf('return $trackshtml;'));
  assert.match(body, /token::endpoint_url\(\s*'playlist\.php'/);
  assert.doesNotMatch(body, /\$trackparams/);
  assert.doesNotMatch(body, /if \(\$mode === 'scorm'\)/);
});
