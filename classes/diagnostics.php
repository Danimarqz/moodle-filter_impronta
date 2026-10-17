<?php
// Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE.
namespace filter_impronta;

/** Bounded, explicitly selected playback observations stored by Moodle's logstore. */
class diagnostics {
    public const MAX_BYTES = 24576;
    private const EVENTS = ['sample', 'play', 'pause', 'seeking', 'seeked', 'playing', 'waiting', 'stalled',
        'error', 'ratechange', 'loadedmetadata', 'visibility', 'recovery_expiry', 'recovery_replay', 'recovery_error',
        'recovery_stall', 'renew_start', 'renew_ok', 'renew_error', 'heartbeat_ok', 'heartbeat_error'];
    private const REASONS = ['waiting', 'error', 'recovery', 'recovered', 'followup', 'pagehide'];

    /** Empty means disabled for everyone. No automatic expiry. */
    public static function enabled(int $userid): bool {
        if ($userid <= 0) {
            return false;
        }
        $ids = preg_split('/[\s,;]+/', trim((string) config::get('debugusers', '')), -1, PREG_SPLIT_NO_EMPTY);
        return in_array((string) $userid, $ids, true);
    }

    /** Build a signed diagnostic relay URL only for selected users. */
    public static function url(string $path, string $signedtoken, int $expires, int $courseid,
            int $userid, string $group = '', string $playbackid = '', string $mode = ''): string {
        global $USER;
        $effectiveuserid = $userid > 0 ? $userid : (int) ($USER->id ?? 0);
        if (!self::enabled($effectiveuserid)) {
            return '';
        }
        return token::endpoint_url('diagnostic.php', $path, $signedtoken, $expires, $courseid,
            $userid, [], $group, $playbackid, $mode);
    }

    /** Numeric-only observations and fixed enums; no URLs, headers, names, or error messages. */
    public static function clean(array $payload): array {
        if (($payload['version'] ?? null) !== 1 || !in_array($payload['reason'] ?? null, self::REASONS, true) ||
                !isset($payload['history']) || !is_array($payload['history']) || count($payload['history']) > 40 ||
                !isset($payload['requests']) || !is_array($payload['requests']) || count($payload['requests']) > 12) {
            throw new \InvalidArgumentException('invalid diagnostic');
        }
        $out = ['version' => 1, 'reason' => $payload['reason'], 'history' => [], 'requests' => []];
        foreach ($payload['history'] as $row) {
            if (!is_array($row) || !in_array($row['event'] ?? null, self::EVENTS, true)) {
                throw new \InvalidArgumentException('invalid observation');
            }
            $clean = ['event' => $row['event']];
            foreach (['at' => 4102444800000, 'position' => 86400, 'duration' => 86400, 'rate' => 16,
                    'readyState' => 4, 'networkState' => 3, 'errorCode' => 5] as $key => $max) {
                $clean[$key] = self::number($row[$key] ?? null, 0, $max);
            }
            foreach (['paused', 'seeking', 'hidden'] as $key) {
                if (!isset($row[$key]) || !is_bool($row[$key])) {
                    throw new \InvalidArgumentException('invalid flag');
                }
                $clean[$key] = $row[$key];
            }
            foreach (['bufferedRangeCount' => 1000, 'contiguousAhead' => 86400,
                    'frames' => 1000000000, 'droppedFrames' => 1000000000] as $key => $max) {
                $clean[$key] = self::number($row[$key] ?? 0, 0, $max);
            }
            if (!isset($row['buffered']) || !is_array($row['buffered']) || count($row['buffered']) > 6) {
                throw new \InvalidArgumentException('invalid buffer');
            }
            $clean['buffered'] = [];
            foreach ($row['buffered'] as $range) {
                if (!is_array($range) || count($range) !== 2 || !array_key_exists(0, $range) || !array_key_exists(1, $range)) {
                    throw new \InvalidArgumentException('invalid range');
                }
                $start = self::number($range[0], 0, 86400);
                $end = self::number($range[1], $start, 86400);
                $clean['buffered'][] = [$start, $end];
            }
            $out['history'][] = $clean;
        }
        foreach ($payload['requests'] as $row) {
            if (!is_array($row) || !in_array($row['route'] ?? null,
                    ['segment', 'watermark', 'media', 'manifest', 'other'], true) || !is_bool($row['failed'] ?? null)) {
                throw new \InvalidArgumentException('invalid request');
            }
            $clean = ['route' => $row['route'], 'failed' => $row['failed']];
            foreach (['at' => [0, 4102444800000], 'segment' => [-1, 1000000], 'status' => [0, 599],
                    'elapsedMs' => [-1, 600000], 'bytes' => [-1, 1000000000]] as $key => $range) {
                $clean[$key] = self::number($row[$key] ?? null, $range[0], $range[1]);
            }
            $out['requests'][] = $clean;
        }
        return $out;
    }

    private static function number($value, float $min, float $max): float {
        if ((!is_int($value) && !is_float($value)) || !is_finite((float) $value) || $value < $min || $value > $max) {
            throw new \InvalidArgumentException('invalid number');
        }
        return $value;
    }

    /** Authenticate exactly like media, then check selection again on every POST. */
    public static function accept(array $params, array $payload): int {
        global $USER;
        $path = trim(preg_replace('#/+#', '/', str_replace('\\', '/', $params['f'])), '/');
        $userid = (int) $params['u'];
        $unused = false;
        if ($path === '' || strpos($path, '..') !== false || token::authorize($path, $params['t'], (int) $params['e'],
                (int) $params['c'], $userid, $unused, $params['g'], $params['p'], $params['m']) !== null) {
            return 403;
        }
        $userid = $userid > 0 ? $userid : (int) ($USER->id ?? 0);
        if (!self::enabled($userid)) {
            return 403;
        }
        $clean = self::clean($payload);
        $factory = \core\lock\lock_config::get_lock_factory('filter_impronta_diagnostics');
        $lock = $factory->get_lock('user-' . $userid, 0);
        if (!$lock) {
            return 429;
        }
        try {
            $cache = \cache::make_from_params(\cache_store::MODE_APPLICATION, 'filter_impronta', 'debugrate',
                ['simplekeys' => true, 'simpledata' => true, 'ttl' => 60]);
            $minute = (int) floor(time() / 60);
            $key = 'u' . $userid;
            $limit = $cache->get($key);
            $count = is_array($limit) && ($limit['minute'] ?? -1) === $minute ? (int) $limit['count'] : 0;
            if ($count >= 6 || !$cache->set($key, ['minute' => $minute, 'count' => $count + 1])) {
                return 429;
            }
            \filter_impronta\event\playback_diagnostic::create([
                'context' => \context_user::instance($userid), 'userid' => $userid, 'relateduserid' => $userid,
                'other' => ['videoPath' => $path, 'playbackId' => $params['p'],
                    'client' => in_array(parse_url($_SERVER['HTTP_ORIGIN'] ?? '', PHP_URL_HOST),
                        ['localhost', '127.0.0.1'], true) ? 'app' : 'web',
                    'sessionId' => impronta_api::recall_session($path, $userid, $params['p']), 'report' => $clean],
            ])->trigger();
            return 204;
        } finally {
            $lock->release();
        }
    }
}
