const test = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
test('server validates signed identity, enrolment, selection, payload and report rate', () => {
  const result = execFileSync('php', [__dirname + '/diagnostics-fixture.php'], {encoding: 'utf8'});
  assert.match(result, /OK selected authorized report is recorded/);
  assert.match(result, /OK removing an ID rejects an already signed URL/);
  assert.match(result, /OK per-user limit caps persistent reports/);
});
