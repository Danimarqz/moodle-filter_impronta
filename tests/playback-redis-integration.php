<?php
/** Real Moodle/Redis regression; only synthetic entries are changed. */
define('CLI_SCRIPT', true);
require getenv('MOODLE_CONFIG') ?: '/var/www/html/config.php';
use filter_impronta\impronta_api as api;
use filter_impronta\playback_store;

$CFG->filter_impronta_playback_redis = $CFG->filter_impronta_playback_redis ?? [
    'server' => 'impronta-session-redis', 'port' => 6379,
];
$options = $CFG->filter_impronta_playback_redis;
$redis = new Redis();
$redis->connect($options['server'], (int) $options['port']);
if (!empty($options['password'])) {
    $redis->auth($options['password']);
}
$redis->select((int) ($options['database'] ?? 0));
$cache = cache::make_from_params(cache_store::MODE_APPLICATION, 'filter_impronta', 'sessions');
$userid = (int) (get_admin()->id);
$path = 'diagnostic/redis-' . bin2hex(random_bytes(12));
$p = 'test-playback';
$key = sha1(api::subject($userid) . '|' . $path . '|' . $p);
$prefix = 'filter_impronta:playback:' . sha1($CFG->wwwroot) . ':';
$cleanup = [$key];
$assert = function ($condition, $message) {
    if (!$condition) {
        throw new RuntimeException('FAIL: ' . $message);
    }
    echo 'PASS: ' . $message . PHP_EOL;
};
try {
    api::remember_session($path, $userid, 'test-session-1', $p);
    $cache->delete($key);
    $assert(api::recall_session($path, $userid, $p) === 'test-session-1', 'heartbeat survives general-cache deletion');
    $assert($redis->ttl($prefix . $key) > 0 && $redis->ttl($prefix . $key) <= 21600, 'session has real six-hour TTL');
    $redis->expire($prefix . $key, 3);
    api::recall_session($path, $userid, $p);
    $assert($redis->ttl($prefix . $key) <= 3, 'reads do not extend Redis lifetime');
    $assert(api::recall_session($path, $userid, 'another-player') === '', 'another player cannot use this session');
    $assert(api::recall_session($path, $userid + 100000, $p) === '', 'another user cannot use this session');
    $assert(api::recall_session($path . '-other', $userid, $p) === '', 'another video cannot use this session');

    api::remember_session($path, $userid, 'test-session-1', $p);
    $batch = 'diagnostic-batch';
    $batchkey = 'batch-' . sha1(api::subject($userid) . '|' . $path . '|' . $p . '|' . $batch);
    $cleanup[] = $batchkey;
    $assert(api::resolve_batch_session($path, $userid, $batch, 'test-session-1', $p) === 'test-session-1', 'batch starts with an authorized session');
    api::remember_session($path, $userid, 'test-session-2', $p);
    $cache->delete($batchkey);
    $assert(api::resolve_batch_session($path, $userid, $batch, 'test-session-2', $p) === 'test-session-1', 'retried batch retains original session after renewal and cache deletion');
    $assert(api::resolve_batch_session($path, $userid, 'forged-batch', 'forged-session', $p) === '', 'forged batch session is rejected');
    $assert(api::session_known($path, $userid, 'test-session-1', $p), 'previous renewal identity remains known');

    // Snapshot a physical MUC key, then delete cache before its first read.
    $legacylogical = sha1('synthetic-legacy-' . $path);
    $cleanup[] = $legacylogical;
    $physicalprefix = '';
    foreach ((array) $cache as $name => $value) {
        if (str_ends_with($name, "\0definition")) {
            $physicalprefix = $value->generate_single_key_prefix();
        }
    }
    $CFG->filter_impronta_playback_redis['legacykeyprefix'] = $physicalprefix;
    $CFG->filter_impronta_playback_redis['legacyuntil'] = time() + 21600;
    $physical = sha1($physicalprefix . '-' . $legacylogical);
    $cleanup[] = 'legacy:' . $physical;
    $legacy = ['id' => 'test-legacy-session', 'at' => time() - 1200];
    $cache->set($legacylogical, $legacy);
    $assert(playback_store::make()->import_legacy($physical, $legacy), 'old active entry is migrated before purge');
    $cache->delete($legacylogical);
    $assert(playback_store::make()->get($legacylogical) === $legacy, 'migrated entry survives deletion before first use');
    $assert($redis->ttl($prefix . $legacylogical) <= 20400, 'migration preserves remaining lifetime');
    $redis->set($prefix . $legacylogical, json_encode(['id' => 'expired', 'at' => time() - 21601]), ['ex' => 10]);
    $assert(playback_store::make()->get($legacylogical) === false, 'expired timestamp is rejected even if Redis key exists');
    $assert(!playback_store::make()->import_legacy($physical, ['id' => 'expired', 'at' => time() - 21601]), 'expired legacy entry is not imported');

    // Deliberate OOM is allowed only on the explicitly isolated test service.
    if (in_array('--pressure', $argv, true)) {
        if ($options['server'] !== 'impronta-session-redis') {
            throw new RuntimeException('Pressure test requires the isolated Redis');
        }
        $assert($redis->config('GET', 'maxmemory-policy')['maxmemory-policy'] === 'noeviction', 'playback Redis uses noeviction');
        $previous = $redis->config('GET', 'maxmemory')['maxmemory'];
        $pressurekey = $prefix . 'diagnostic-pressure';
        try {
            $redis->config('SET', 'maxmemory', $redis->info('memory')['used_memory'] + 65536);
            $rejected = false;
            try { $redis->set($pressurekey, str_repeat('x', 1024 * 1024)); } catch (RedisException $e) { $rejected = str_contains($e->getMessage(), 'OOM'); }
            try { $redis->set($pressurekey, str_repeat('x', 1024 * 1024)); } catch (RedisException $e) { $rejected = $rejected || str_contains($e->getMessage(), 'OOM'); }
            $assert($rejected && api::recall_session($path, $userid, $p) === 'test-session-2', 'memory pressure rejects writes and preserves current playback');
        } finally {
            $redis->config('SET', 'maxmemory', $previous);
            $redis->del($pressurekey);
        }
    }
} finally {
    foreach ($cleanup as $entry) {
        $redis->del($prefix . $entry);
        $cache->delete($entry);
    }
}
