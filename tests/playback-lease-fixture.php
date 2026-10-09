<?php
namespace {
    const DAYSECS = 86400;
    define('MOODLE_INTERNAL', true);
    class cache_store { const MODE_APPLICATION = 1; }
    class cache {
        public static array $data = [];
        public static function make_from_params(...$args) { return new self(); }
        public function get($key) { return self::$data[$key] ?? false; }
        public function set($key, $value) { self::$data[$key] = $value; return true; }
    }
    class moodle_exception extends \Exception { public function __construct($message, ...$args) { parent::__construct($message); } }
    function get_config($plugin, $name) {
        return ['secretkey' => 'SYNTHETIC-local-secret', 'bindip' => '1', 'requirecourse' => '1', 'tokenttl' => '600'][$name] ?? false;
    }
    $CFG = (object) ['wwwroot' => 'https://synthetic.example'];
}
namespace filter_impronta {
    class request { public static function ip(): string { return '192.0.2.1'; } }
    class access {
        public static bool $allowed = true;
        public static function can_view_course($course, $user): bool { return self::$allowed; }
    }
}
namespace {
    $root = __DIR__ . '/../classes/';
    require $root . 'config.php';
    require $root . 'token.php';
    require $root . 'impronta_api.php';
    require $root . 'renewal.php';
    $path = 'synthetic/class'; $userid = 7; $courseid = 11;
    $p = \filter_impronta\token::playback_id();
    $expires = time()+600;
    $token = \filter_impronta\token::generate($path, $expires, $courseid, '192.0.2.1', $userid, true, '', $p);
    $url = \filter_impronta\token::endpoint_url('playlist.php', $path, $token, $expires, $courseid, $userid, ['a'=>1], '', $p);
    $authorized = ['sessionId'=>'p1-synthetic-session', 'authorized'=>['fragment_token'=>'SYNTHETIC-signed-proof', 'expires_at'=>time()+600], 'realtime'=>['url'=>'wss://synthetic.example', 'token'=>'SYNTHETIC-wss', 'expiresAt'=>time()+600]];
    \filter_impronta\impronta_api::remember_playback_lease($path, $userid, $p, $authorized);
    $control = \filter_impronta\renewal::issue($url, $userid, true);
    parse_str(parse_url($control['playlistUrl'], PHP_URL_QUERY), $controlParams);
    echo 'control samePlayback=' . json_encode($control['samePlayback']) . ' sameP=' . json_encode($controlParams['p']===$p) . "\n";
    foreach (['f'=>'other/class', 'u'=>8, 'c'=>12, 'p'=>$p.'changed', 'a'=>0] as $field=>$value) {
        parse_str(parse_url($url, PHP_URL_QUERY), $params);
        $params[$field] = $value;
        $tampered = 'https://synthetic.example/playlist.php?' . http_build_query($params);
        try {
            \filter_impronta\renewal::issue($tampered, $userid, (bool)$params['a']);
            echo "binding $field ACCEPTED\n";
        } catch (\moodle_exception $e) { echo "binding $field REJECTED\n"; }
    }
    $stale = ['sessionId'=>'p1-synthetic-session', 'realtime'=>['url'=>'wss://synthetic.example', 'token'=>'SYNTHETIC-legacy-wss', 'expiresAt'=>time()+600]];
    \filter_impronta\impronta_api::remember_playback_lease($path, $userid, $p, $stale);
    $lease = \filter_impronta\impronta_api::playback_lease($path, $userid, $p);
    $renewed = \filter_impronta\renewal::issue($url, $userid, true, false);
    parse_str(parse_url($renewed['playlistUrl'], PHP_URL_QUERY), $newParams);
    echo 'stale sameSession=' . json_encode($lease['sessionId']===$authorized['sessionId']) . ' proof=' . json_encode($lease['mediaProof']) . ' samePlayback=' . json_encode($renewed['samePlayback']) . ' changedP=' . json_encode($newParams['p']!==$p) . "\n";
    \filter_impronta\impronta_api::remember_playback_lease($path, $userid, $p, $authorized);
    foreach (cache::$data as $key=>$value) { if (str_starts_with($key, 'lease_')) { cache::$data[$key]['at'] = time() - 8*DAYSECS; } }
    $aged = \filter_impronta\renewal::issue($url, $userid, true, false);
    parse_str(parse_url($aged['playlistUrl'], PHP_URL_QUERY), $agedParams);
    echo 'expiredCache samePlayback=' . json_encode($aged['samePlayback']) . ' changedP=' . json_encode($agedParams['p']!==$p) . "\n";
    $replay = \filter_impronta\renewal::issue($url, $userid, true, true);
    parse_str(parse_url($replay['playlistUrl'], PHP_URL_QUERY), $replayParams);
    echo 'replay samePlayback=' . json_encode($replay['samePlayback']) . ' changedP=' . json_encode($replayParams['p']!==$p) . "\n";
    exit(($lease['mediaProof'] === '' || $newParams['p'] !== $p || $agedParams['p'] !== $p || $replayParams['p'] === $p) ? 1 : 0);
}
