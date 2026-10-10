<?php
// This file is part of Moodle - https://moodle.org/
// Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE.
namespace filter_impronta;

defined('MOODLE_INTERNAL') || die();

/**
 * Temporary playback identities in a dedicated, non-evicting Redis instance.
 *
 * Configure $CFG->filter_impronta_playback_redis in config.php. Without this
 * configuration, existing installations retain their original MUC storage.
 * A configured Redis failure is never hidden by falling back to general cache.
 *
 * @package filter_impronta
 */
final class playback_store {
    private $redis;
    private $cache;
    private $options;
    private $prefix;
    private $ttl;

    private function __construct(int $ttl) {
        global $CFG;
        $this->ttl = $ttl;
        $this->options = $CFG->filter_impronta_playback_redis ?? [];
        if (!$this->options) {
            $this->cache = \cache::make_from_params(\cache_store::MODE_APPLICATION, 'filter_impronta', 'sessions');
            return;
        }
        $this->redis = new \Redis();
        $this->redis->connect($this->options['server'], (int) ($this->options['port'] ?? 6379), 2.0);
        $this->redis->setOption(\Redis::OPT_READ_TIMEOUT, 2.0);
        if (!empty($this->options['password'])) {
            $this->redis->auth($this->options['password']);
        }
        $this->redis->select((int) ($this->options['database'] ?? 0));
        $this->prefix = 'filter_impronta:playback:' . sha1($CFG->wwwroot) . ':';
    }

    /** Creates a store with the existing playback retention, normally six hours. */
    public static function make(int $ttl = 21600): self {
        return new self($ttl);
    }

    /** Gets an unexpired value without refreshing its expiry. */
    public function get(string $key) {
        if (!$this->redis) {
            return $this->cache->get($key);
        }
        $value = $this->decode($this->redis->get($this->prefix . $key));
        if ($value !== false) {
            return $value;
        }
        // Migration is bounded in time, and preserves the original timestamp.
        if (time() > (int) ($this->options['legacyuntil'] ?? 0)) {
            return false;
        }
        $legacykey = '';
        if (!empty($this->options['legacykeyprefix'])) {
            $legacykey = $this->prefix . 'legacy:' . sha1($this->options['legacykeyprefix'] . '-' . $key);
            $value = $this->decode($this->redis->get($legacykey));
        }
        if ($value === false) {
            $cache = \cache::make_from_params(\cache_store::MODE_APPLICATION, 'filter_impronta', 'sessions');
            $value = $cache->get($key);
        }
        if (!is_array($value) || $this->remaining($value) <= 0) {
            return false;
        }
        // Do not overwrite a newer session installed by a concurrent request.
        $ttl = $this->remaining($value);
        if ($ttl <= 0) {
            return false;
        }
        $this->redis->set($this->prefix . $key, json_encode($value, JSON_THROW_ON_ERROR), ['nx', 'ex' => $ttl]);
        $value = $this->decode($this->redis->get($this->prefix . $key));
        if ($value !== false && $legacykey !== '') {
            $this->redis->del($legacykey);
        }
        return $value;
    }

    /** Stores each entry with a real Redis TTL, atomically with its value. */
    public function set(string $key, array $value): bool {
        if (!$this->redis) {
            return $this->cache->set($key, $value);
        }
        $ttl = $this->remaining($value);
        if ($ttl <= 0) {
            return false;
        }
        if (!$this->redis->set($this->prefix . $key, json_encode($value, JSON_THROW_ON_ERROR), ['ex' => $ttl])) {
            throw new \RuntimeException('Playback Redis did not store the session');
        }
        return true;
    }

    /** Seeds an old physical MUC key before a deployment can purge its hash. */
    public function import_legacy(string $physicalkey, array $value): bool {
        if (!$this->redis) {
            throw new \RuntimeException('Dedicated playback Redis must be configured before migration');
        }
        $ttl = $this->remaining($value);
        if ($ttl <= 0 || preg_match('/^[a-f0-9]{40}$/D', $physicalkey) !== 1) {
            return false;
        }
        return $this->redis->set($this->prefix . 'legacy:' . $physicalkey,
            json_encode($value, JSON_THROW_ON_ERROR), ['ex' => $ttl]);
    }

    private function decode($encoded) {
        if (!is_string($encoded)) {
            return false;
        }
        $value = json_decode($encoded, true);
        return is_array($value) && $this->remaining($value) > 0 ? $value : false;
    }

    private function remaining(array $value): int {
        return (int) ($value['at'] ?? 0) + $this->ttl - time();
    }
}
