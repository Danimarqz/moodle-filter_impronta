<?php
// Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE.
// phpcs:ignore moodle.Files.RequireLogin.Missing -- Signed media context and live enrolment authorize this endpoint.
require_once(__DIR__ . '/../../config.php');

\filter_impronta\request::send_cors_headers(true);
header('Cache-Control: no-store');
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    http_response_code(405);
    exit;
}
$params = [
    'f' => optional_param('f', '', PARAM_RAW_TRIMMED), 't' => optional_param('t', '', PARAM_ALPHANUMEXT),
    'e' => optional_param('e', 0, PARAM_INT), 'c' => optional_param('c', 0, PARAM_INT),
    'u' => optional_param('u', 0, PARAM_INT), 'g' => optional_param('g', '', PARAM_ALPHANUMEXT),
    'p' => optional_param('p', '', PARAM_ALPHANUMEXT), 'm' => optional_param('m', '', PARAM_ALPHA),
];
$body = file_get_contents('php://input', false, null, 0, \filter_impronta\diagnostics::MAX_BYTES + 1);
if ($body === false || strlen($body) > \filter_impronta\diagnostics::MAX_BYTES) {
    http_response_code(413);
    exit;
}
try {
    $payload = json_decode($body, true, 16, JSON_THROW_ON_ERROR);
    if (!is_array($payload)) {
        throw new \InvalidArgumentException('invalid diagnostic');
    }
    http_response_code(\filter_impronta\diagnostics::accept($params, $payload));
} catch (\JsonException | \InvalidArgumentException $e) {
    http_response_code(400);
} catch (\Throwable $e) {
    // Operational diagnostics never control playback or expose raw exceptions.
    http_response_code(503);
}
