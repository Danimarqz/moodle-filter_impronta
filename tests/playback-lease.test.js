const test = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync,spawnSync} = require('node:child_process');
const {join} = require('node:path');
const hasPhp = spawnSync('php',['-v']).status === 0;
test('PHP preserves a pinned lease across stale responses and cache loss, but replay signs another intent', {skip:!hasPhp},() => {
  const out = execFileSync('php',[join(__dirname,'playback-lease-fixture.php')],{encoding:'utf8'});
  assert.match(out,/control samePlayback=true sameP=true/);
  assert.match(out,/proof="SYNTHETIC-signed-proof" samePlayback=true changedP=false/);
  assert.match(out,/expiredCache samePlayback=true changedP=false/);
  assert.match(out,/replay samePlayback=false changedP=true/);
  assert.doesNotMatch(out,/ACCEPTED/);
});
