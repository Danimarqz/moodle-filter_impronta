<?php
// This file is part of Moodle - https://moodle.org/
/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
/** Server-side relay for a short-lived WSS token. @package filter_impronta */

// phpcs:ignore moodle.Files.RequireLogin.Missing -- Signed token authorizes the endpoint.
require_once(__DIR__ . '/../../config.php');

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

function impronta_realtime_fail(int $status): void {
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    exit;
}

$path = trim(preg_replace('#/+#', '/', str_replace('\\', '/', (string) $rawf)), '/');
if ($path === '' || strpos($path, '..') !== false || empty($signedtoken) || empty($expires)) {
    impronta_realtime_fail(400);
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
    impronta_realtime_fail(403);
}

$effectiveuserid = (int) $userid;
if ($effectiveuserid <= 0 && isloggedin() && !isguestuser()) {
    global $USER;
    $effectiveuserid = (int) $USER->id;
}
$sessionid = impronta_api::recall_session($path, $effectiveuserid, $playbackid);
if ($sessionid === '') {
    impronta_realtime_fail(409);
}
$response = impronta_api::realtime($path, $effectiveuserid, $sessionid, $authorizationgroupid);
if ($response === null || empty($response['url']) || empty($response['token'])) {
    impronta_realtime_fail(502);
}
$response['sessionId'] = $sessionid;
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo json_encode($response);
