<?php
namespace {
    define('MOODLE_INTERNAL', true);
    $debugusers = '1989, 1327' . "\n42; 7 19890 invalid *";
    $CFG = (object) ['wwwroot' => 'https://synthetic.example'];
    $USER = (object) ['id' => 7];
    function get_config($plugin, $name) {
        global $debugusers;
        return ['debugusers' => $debugusers, 'secretkey' => 'SYNTHETIC-test-only', 'bindip' => 0,
            'requirecourse' => 1][$name] ?? false;
    }
    class context_user { public static function instance($userid) { return (object) ['id' => $userid]; } }
    class cache_store { const MODE_APPLICATION = 1; }
    class cache {
        public static array $values = [];
        public static function make_from_params(...$args) { return new self(); }
        public function get($key) { return self::$values[$key] ?? false; }
        public function set($key, $value) { self::$values[$key] = $value; return true; }
    }
    function check($ok, $message) { if (!$ok) { throw new \Exception($message); } echo "OK $message\n"; }
}
namespace core\lock {
    class lock_config {
        public static function get_lock_factory($name) { return new self(); }
        public function get_lock($name, $wait) { return new self(); }
        public function release() {}
    }
}
namespace filter_impronta {
    class request { public static function ip(): string { return '192.0.2.1'; } }
    class access {
        public static bool $allowed = true;
        public static function can_view_course($courseid, $userid): bool { return self::$allowed; }
    }
    class impronta_api { public static function recall_session(...$args): string { return 'server-session'; } }
}
namespace filter_impronta\event {
    class playback_diagnostic {
        public static array $events = [];
        public static function create($event) { self::$events[] = $event; return new self(); }
        public function trigger() {}
    }
}
namespace {
    require __DIR__ . '/../classes/config.php';
    require __DIR__ . '/../classes/token.php';
    require __DIR__ . '/../classes/diagnostics.php';
    use filter_impronta\diagnostics as D;
    use filter_impronta\token;
    use filter_impronta\event\playback_diagnostic as E;
    check(D::enabled(1989) && D::enabled(42) && D::enabled(7), 'IDs accept comma whitespace and semicolon');
    check(!D::enabled(198) && !D::enabled(0) && !D::enabled(-1), 'IDs require exact positive matches');
    $row = ['at' => 100000, 'event' => 'sample', 'position' => 10, 'duration' => 600, 'rate' => 2,
        'paused' => false, 'seeking' => false, 'hidden' => false, 'readyState' => 3, 'networkState' => 2,
        'errorCode' => 0, 'buffered' => [[0, 12], [30, 90]], 'token' => 'SECRET'];
    $payload = ['version' => 1, 'reason' => 'waiting', 'history' => [$row], 'requests' => [],
        'userId' => 1989, 'sessionId' => 'FORGED-session', 'token' => 'SECRET'];
    $clean = D::clean($payload);
    check(strpos(json_encode($clean), 'SECRET') === false && strpos(json_encode($clean), 'FORGED') === false,
        'payload whitelist removes secrets and client identity');
    foreach (['event' => 'https://secret.example', 'rate' => '2', 'position' => INF, 'paused' => 'false',
            'buffered' => [[10, 5]]] as $field => $value) {
        $bad = $payload; $bad['history'][0][$field] = $value;
        try { D::clean($bad); throw new \Exception('accepted invalid ' . $field); }
        catch (\InvalidArgumentException $e) { echo "OK rejected invalid $field\n"; }
    }
    $params = ['f' => 'synthetic/class', 'u' => 7, 'c' => 11, 'e' => time() + 600, 'g' => '', 'p' => token::playback_id(), 'm' => ''];
    $params['t'] = token::generate($params['f'], $params['e'], 11, '192.0.2.1', 7, true, '', $params['p']);
    foreach (['u' => 1989, 'p' => 'different-player', 'f' => 'other/class'] as $field => $value) {
        $forged = $params; $forged[$field] = $value;
        check(D::accept($forged, $payload) === 403, 'signed binding rejects modified ' . $field);
    }
    \filter_impronta\access::$allowed = false;
    check(D::accept($params, $payload) === 403, 'enrolment is rechecked');
    \filter_impronta\access::$allowed = true;
    $debugusers = '1989';
    check(D::accept($params, $payload) === 403, 'removing an ID rejects an already signed URL');
    $debugusers = '7';
    check(D::accept($params, $payload) === 204, 'selected authorized report is recorded');
    $event = E::$events[0];
    check($event['userid'] === 7 && $event['relateduserid'] === 7 &&
        $event['other']['sessionId'] === 'server-session', 'event identity is assigned by server');
    for ($i = 0; $i < 5; $i++) { check(D::accept($params, $payload) === 204, 'within report limit'); }
    check(D::accept($params, $payload) === 429 && count(E::$events) === 6, 'per-user limit caps persistent reports');
    $debugusers = '';
    check(!D::enabled(7) && D::url($params['f'], $params['t'], $params['e'], 11, 7) === '', 'empty setting disables everyone');
}
