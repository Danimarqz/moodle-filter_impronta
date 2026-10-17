<?php
require_once(__DIR__ . '/../../tools/plan013-fpm-capacity.php');

$sample = json_encode([
    'pool' => 'www',
    'process manager' => 'dynamic',
    'listen queue' => 2,
    'max listen queue' => 4,
    'listen queue len' => 35,
    'idle processes' => 0,
    'active processes' => 35,
    'total processes' => 35,
    'max active processes' => 35,
    'max children reached' => 1,
    'slow requests' => 0,
    'processes' => [[
        'pid' => 321,
        'request URI' => '/renew.php?url=SECRET_URL&sesskey=SECRET_SESSKEY',
        'script' => '/srv/moodle/renew.php',
    ]],
    'token' => 'SECRET_TOKEN',
]);
$report = impronta_plan013_fpm_capacity_parse($sample);
if ($report['metrics']['activeProcesses'] !== 35 || $report['metrics']['listenQueue'] !== 2 || $report['metrics']['maxChildrenReached'] !== 1) {
    fwrite(STDERR, "FPM aggregate parsing failed\n");
    exit(1);
}
$output = json_encode($report);
foreach (['SECRET_URL', 'SECRET_SESSKEY', 'SECRET_TOKEN', '/renew.php', '321'] as $private) {
    if (strpos($output, $private) !== false) {
        fwrite(STDERR, "FPM report leaked private field: {$private}\n");
        exit(1);
    }
}
if (strpos($output, 'review_capacity') === false || strpos($output, 'increase') !== false) {
    fwrite(STDERR, "FPM report did not preserve the no-blind-scaling policy\n");
    exit(1);
}
try {
    impronta_plan013_fpm_capacity_parse('{invalid');
    fwrite(STDERR, "Invalid FPM input was accepted\n");
    exit(1);
} catch (InvalidArgumentException $error) {
    // Expected: malformed or incomplete snapshots are never partially trusted.
}
echo "FPM capacity parser/redaction: OK\n";
