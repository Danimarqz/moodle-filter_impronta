<?php
// Run inside the isolated Moodle installation, with the candidate plugin path
// as argv[1]. It uses Moodle's own external API response validator.
define('CLI_SCRIPT', true);
$plugin = $argv[1] ?? '';
$expectreject = ($argv[2] ?? '') === '--expect-reject';
$config = getenv('MOODLE_CONFIG') ?: '/var/www/html/config.php';
if ($plugin === '' || !is_file($plugin . '/classes/external/renew.php') || !is_file($config)) {
    fwrite(STDERR, "Usage: MOODLE_CONFIG=/path/config.php php renewal-contract-moodle.php /plugin\n");
    exit(2);
}
require($config);
require_once($plugin . '/classes/external/renew.php');

// The mobile renewal endpoint is exposed only as a read-only function in the
// official Moodle App service; it must not inherit the web cookie/sesskey path.
$functions = [];
require($plugin . '/db/services.php');
$mobile = $functions['filter_impronta_renew'] ?? [];
if (($mobile['classname'] ?? '') !== '\\filter_impronta\\external\\renew'
        || ($mobile['methodname'] ?? '') !== 'execute'
        || ($mobile['type'] ?? '') !== 'read'
        || empty($mobile['ajax'])
        || ($mobile['services'] ?? []) !== [MOODLE_OFFICIAL_MOBILE_SERVICE]) {
    fwrite(STDERR, "Moodle App renewal service boundary changed unexpectedly\n");
    exit(1);
}

// Run the actual external function as Moodle's guest identity. This must fail
// before renewal::issue() can inspect or mint any signed playback URL.
$originaluser = $USER;
$USER = $DB->get_record('user', ['id' => $CFG->siteguest], '*', MUST_EXIST);
try {
    \filter_impronta\external\renew::execute('https://moodle.invalid/filter/impronta/playlist.php?e=1900000000');
    fwrite(STDERR, "Moodle App renewal unexpectedly accepted guest identity\n");
    exit(1);
} catch (\moodle_exception $error) {
    if ($error->errorcode !== 'requireloginerror') {
        throw $error;
    }
    echo "Moodle App guest renewal rejected before issuing credentials\n";
} finally {
    $USER = $originaluser;
}

// Exercise Moodle's real CSRF primitive for a missing key and ensure the web
// endpoint keeps login + sesskey checks ahead of issuing any renewed URL.
$emptykeyaccepted = false;
try {
    $emptykeyaccepted = confirm_sesskey('');
} catch (\moodle_exception $error) {
    // CLI has no request parameter; Moodle rejects the absent sesskey here.
}
if ($emptykeyaccepted) {
    fwrite(STDERR, "Moodle accepted an empty web sesskey\n");
    exit(1);
}
$websource = file_get_contents($plugin . '/renew.php');
$logincheck = strpos($websource, 'require_login();');
$csrfcheck = strpos($websource, 'require_sesskey();');
$issuecall = strpos($websource, 'renewal::issue(');
if ($logincheck === false || $csrfcheck === false || $issuecall === false
        || !($logincheck < $csrfcheck && $csrfcheck < $issuecall)) {
    fwrite(STDERR, "Web renewal must authenticate, require sesskey, then issue URLs\n");
    exit(1);
}
echo "Moodle web empty-sesskey denial and endpoint gate order: OK\n";

// Execute the actual native-app bootstrap generator. It must use Moodle App's
// authenticated site.read route without borrowing browser cookies/sesskey.
require_once($plugin . '/classes/output/mobile.php');
$mobilebootstrap = \filter_impronta\output\mobile::mobile_init([])['javascript'] ?? '';
if (strpos($mobilebootstrap, "site.read('filter_impronta_renew'") === false
        || strpos($mobilebootstrap, 'newplayback:') === false
        || stripos($mobilebootstrap, 'sesskey') !== false
        || stripos($mobilebootstrap, 'credentials:') !== false) {
    fwrite(STDERR, "Moodle App renewal bootstrap lost its authenticated service boundary\n");
    exit(1);
}
echo "Moodle App bootstrap uses authenticated site.read without web credentials: OK\n";

$sample = [
    'playlistUrl' => 'https://moodle.invalid/filter/impronta/playlist.php?e=1900000000',
    'diagnosticUrl' => 'https://moodle.invalid/filter/impronta/diagnostic.php?e=1900000000',
    'eventsUrl' => 'https://moodle.invalid/filter/impronta/events.php?e=1900000000',
    'sessionUrl' => 'https://moodle.invalid/filter/impronta/heartbeat.php?e=1900000000',
    'batchUrl' => 'https://moodle.invalid/filter/impronta/batch.php?e=1900000000',
    'realtimeUrl' => 'https://moodle.invalid/filter/impronta/realtime.php?e=1900000000',
    'expiresAt' => 1900000000,
    'samePlayback' => true,
];
try {
    $clean = \external_api::clean_returnvalue(\filter_impronta\external\renew::execute_returns(), $sample);
} catch (\Throwable $error) {
    if ($expectreject && strpos($error->getMessage(), 'diagnosticUrl') !== false) {
        echo "Moodle rejected undeclared diagnosticUrl as expected\n";
        exit(0);
    }
    throw $error;
}
if ($expectreject) {
    if (!array_key_exists('diagnosticUrl', $clean)) {
        echo "Moodle omitted undeclared diagnosticUrl as expected\n";
        exit(0);
    }
    fwrite(STDERR, "Moodle unexpectedly preserved undeclared diagnosticUrl\n");
    exit(1);
}
if ($clean !== $sample) {
    fwrite(STDERR, "Moodle external renewal response did not preserve its declared fields\n");
    exit(1);
}
echo "Moodle external renewal response schema: OK\n";
