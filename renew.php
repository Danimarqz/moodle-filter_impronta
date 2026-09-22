<?php
// phpcs:ignoreFile -- Moodle's legacy endpoint header is kept verbatim for compatibility.
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
 * Browser-session playback renewal; never accepts a mobile bearer in a URL.
 *
 * @package filter_impronta
 * @copyright  2026 DaniMarqz
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
require_once(__DIR__ . '/../../config.php');

require_login();
require_sesskey();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
try {
    $url = required_param('url', PARAM_RAW);
    echo json_encode(\filter_impronta\renewal::issue($url, (int) $USER->id, false));
} catch (\Throwable $e) {
    http_response_code(403);
    echo json_encode(['error' => 'renewal denied']);
}
