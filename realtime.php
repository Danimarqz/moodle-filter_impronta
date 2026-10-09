<?php
// This file is part of Moodle - https://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <https://www.gnu.org/licenses/>.
/* Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE. */
/**
 * Server-side relay for a short-lived WSS token.
 *
 * The tenant API key never leaves the Moodle server: the browser asks here for
 * a scoped, expiring socket token and connects to Impronta with that alone.
 *
 * @package filter_impronta
 * @copyright 2026 DaniMarqz
 * @license http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

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

/**
 * Ends the request with a bare status code.
 *
 * @param int $status HTTP status to return.
 */
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
if (
    token::authorize(
        $path,
        $signedtoken,
        (int) $expires,
        (int) $courseid,
        (int) $userid,
        $unused,
        $authorizationgroupid,
        $playbackid,
        $mode
    ) !== null
) {
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
$lease = impronta_api::playback_lease($path, $effectiveuserid, $playbackid);
if (($lease['sessionId'] ?? '') !== $sessionid) {
    $lease = [];
}
$response = $lease['realtime'] ?? null;
if (!is_array($response) || (int) ($response['expiresAt'] ?? 0) <= time() + 60) {
    $response = impronta_api::realtime(
        $path, $effectiveuserid, $sessionid, $authorizationgroupid,
        (string) ($lease['mediaProof'] ?? '')
    );
}
if ($response === null || empty($response['url']) || empty($response['token'])) {
    impronta_realtime_fail(502);
}
$response['sessionId'] = $sessionid;
impronta_api::remember_playback_lease($path, $effectiveuserid, $playbackid, ['sessionId' => $sessionid, 'realtime' => $response]);
$response['manifestExpiresAt'] = (int) ($lease['manifestExpiresAt'] ?? 0);
$response['authorizedPlayback'] = !empty($lease['mediaProof']);
unset($response['mediaProof']);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo json_encode($response);
