const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {execFileSync, spawnSync} = require('node:child_process');
const root = join(__dirname, '..');

// The upgrade step is pure PHP. A JavaScript-only CI runner has no php binary;
// skip instead of failing so the JS suite stays meaningful there. The PHP job
// (and any developer machine with php) runs it for real.
const hasPhp = spawnSync('php', ['-v'], {encoding: 'utf8'}).status === 0;

test('server render and authenticated relays no longer restrict V2 by learner id', () => {
  for (const name of ['classes/config.php', 'classes/player.php', 'settings.php', 'batch.php', 'realtime.php']) {
    const source = readFileSync(join(root, name), 'utf8');
    assert.doesNotMatch(source, /experimentalusers|experimental_player_v2|experimentalPlayerV2/);
  }
  for (const name of ['batch.php', 'realtime.php']) {
    assert.match(readFileSync(join(root, name), 'utf8'), /token::authorize\(/);
  }
});

test('upgrade removes the obsolete setting and is repeatable', {skip: !hasPhp}, () => {
  const upgrade = join(root, 'db/upgrade.php');
  const result = execFileSync('php', ['-r', `
    $removed = []; $saved = [];
    function unset_config($key, $plugin) { global $removed; $removed[] = [$key, $plugin]; }
    function upgrade_plugin_savepoint($ok, $version, $type, $plugin) {
      global $saved; $saved[] = $version;
    }
    require ${JSON.stringify(upgrade)};
    xmldb_filter_impronta_upgrade(2026100303);
    xmldb_filter_impronta_upgrade(2026100304);
    echo json_encode([$removed, $saved]);
  `], {encoding: 'utf8'});
  assert.deepEqual(JSON.parse(result), [[['experimentalusers', 'filter_impronta']], [2026100304]]);
});
