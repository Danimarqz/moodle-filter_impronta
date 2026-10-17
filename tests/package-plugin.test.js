const test = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = process.env.IMPRONTA_PLUGIN_ROOT || path.join(__dirname, '..');

test('deployment package contains English strings only without modifying the source tree', () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan013-package-'));
  const archive = path.join(outputDir, 'filter_impronta.zip');
  try {
    execFileSync('bash', [path.join(root, 'scripts/package-plugin.sh'), archive], {stdio: 'pipe'});
    const entries = execFileSync('unzip', ['-Z1', archive], {encoding: 'utf8'}).trim().split('\n');
    assert.ok(entries.includes('impronta/lang/en/filter_impronta.php'));
    assert.ok(entries.every(entry => !entry.startsWith('impronta/lang/es/')));
    assert.ok(entries.some(entry => entry === 'impronta/classes/external/renew.php'));
  } finally {
    fs.rmSync(outputDir, {recursive: true, force: true});
  }
});
