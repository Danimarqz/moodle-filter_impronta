<?php
// This file is part of Moodle - https://moodle.org/
/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
/**
 * Relay for the experimental V2 analytics batches.
 *
 * V2 is deliberately kept on its own backend route and storage prefix. The
 * Legacy /events and /player/heartbeat paths remain active and unchanged.
 *
 * @package filter_impronta
 */

// phpcs:ignore moodle.Files.RequireLogin.Missing -- Signed token authorizes the endpoint.
require_once(__DIR__ . '/../../config.php');

use filter_impronta\config;
use filter_impronta\impronta_api;
use filter_impronta\request;
use filter_impronta\token;

request::send_cors_headers(true);

$rawf = optional_param('f', null, PARAM_RAW_TRIMMED);
$signedtoken = optional_param('t', null, PARAM_ALPHANUMEXT);
$expires = optional_param('e', null, PARAM_INT);
$courseid = optional_param('c', 0, PARAM_INT);
$userid = optional_param('u', 0, PARAM_INT);
$authorizationgroupid = optional_param('g', '', PARAM_ALPHANUMEXT);
$playbackid = optional_param('p', '', PARAM_ALPHANUMEXT);
$mode = optional_param('m', '', PARAM_ALPHA);

function impronta_batch_fail(int $status): void {
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    exit;
}

$path = trim(preg_replace('#/+#', '/', str_replace('\\', '/', (string) $rawf)), '/');
if ($path === '' || strpos($path, '..') !== false || empty($signedtoken) || empty($expires)) {
    impronta_batch_fail(400);
}

$unused = false;
if (token::authorize(
    $path,
    $signedtoken,
    (int) $expires,
    (int) $courseid,
    (int) $userid,
    $unused,
    $authorizationgroupid,
    $playbackid,
    $mode
) !== null) {
    impronta_batch_fail(403);
}

$effectiveuserid = (int) $userid;
if ($effectiveuserid <= 0 && isloggedin() && !isguestuser()) {
    global $USER;
    $effectiveuserid = (int) $USER->id;
}
if (!config::experimental_player_v2($effectiveuserid)) {
    impronta_batch_fail(403);
}

$payload = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($payload)) {
    impronta_batch_fail(400);
}

$batchid = isset($payload['batchId']) && is_string($payload['batchId']) ? $payload['batchId'] : '';
if (preg_match('/^[A-Za-z0-9._:-]{1,128}$/', $batchid) !== 1) {
    impronta_batch_fail(400);
}

// Keep the session identity that was captured when this batch was frozen.
// A playlist renewal may replace Moodle's current session before a retry of
// an older batch arrives; replacing it here would move the same batchId to a
// different DynamoDB key and defeat idempotency. The signed endpoint still
// binds the request to this tenant/user/video; the opaque session is only the
// analytics partition key.
$sessionid = isset($payload['sessionId']) && is_string($payload['sessionId'])
    ? trim($payload['sessionId']) : '';
$sessionid = impronta_api::resolve_batch_session($path, $effectiveuserid, $batchid, $sessionid, $playbackid);
if (preg_match('/^[A-Za-z0-9._:-]{1,128}$/', $sessionid) !== 1) {
    impronta_batch_fail(409);
}
if (!impronta_api::session_known($path, $effectiveuserid, $sessionid, $playbackid)) {
    impronta_batch_fail(409);
}

$reasons = ['pause', 'ended', 'video_change', 'checkpoint', 'pagehide'];
$reason = isset($payload['reason']) && is_string($payload['reason']) ? $payload['reason'] : '';
$sequence = isset($payload['sequence']) && is_numeric($payload['sequence']) ? (int) $payload['sequence'] : 0;
$videoid = isset($payload['videoId']) && is_string($payload['videoId']) ? trim($payload['videoId']) : '';
if (!in_array($reason, $reasons, true)
        || preg_match('/^[A-Za-z0-9._:-]{1,128}$/', $batchid) !== 1
        || $sequence < 1
        || $videoid !== $path) {
    impronta_batch_fail(400);
}

$number = static function ($value, float $default = 0.0): float {
    return is_numeric($value) && is_finite((float) $value) ? (float) $value : $default;
};
$watched = max(0.0, min(3600.0, $number($payload['watchedDelta'] ?? 0)));
$maxposition = max(0.0, min(86400.0, $number($payload['maxPosition'] ?? 0)));
$currentposition = max(0.0, min(86400.0, $number($payload['currentPosition'] ?? 0)));
$bufferedend = max(0.0, min(86400.0, $number($payload['bufferedEnd'] ?? 0)));
$seek = max(0, min(1000, (int) ($payload['seekDelta'] ?? 0)));
$pause = max(0, min(1000, (int) ($payload['pauseDelta'] ?? 0)));
$buffering = max(0.0, min(3600.0, $number($payload['bufferingDelta'] ?? 0)));
$tamper = max(0, min(1000, (int) ($payload['tamperEvents'] ?? 0)));

$batch = [
    'subject' => impronta_api::subject($effectiveuserid),
    'sessionId' => $sessionid,
    'videoId' => $path,
    'batchId' => $batchid,
    'sequence' => $sequence,
    'reason' => $reason,
    'watchedDelta' => $watched,
    'maxPosition' => $maxposition,
    'currentPosition' => $currentposition,
    'bufferedEnd' => $bufferedend,
    'seekDelta' => $seek,
    'pauseDelta' => $pause,
    'bufferingDelta' => $buffering,
    'tamperEvents' => $tamper,
    'startedAt' => isset($payload['startedAt']) && is_string($payload['startedAt']) ? $payload['startedAt'] : '',
    'sentAt' => isset($payload['sentAt']) && is_string($payload['sentAt']) ? $payload['sentAt'] : '',
];

if (!impronta_api::analytics_batch($batch)) {
    impronta_batch_fail(502);
}

http_response_code(202);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo json_encode(['status' => 'accepted', 'sequence' => $sequence, 'sessionId' => $sessionid]);
