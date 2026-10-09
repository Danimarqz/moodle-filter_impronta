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
 * Mobile playback renewal external function.
 * @package filter_impronta
 * @copyright 2026 DaniMarqz
 * @license http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
namespace filter_impronta\external;

defined('MOODLE_INTERNAL') || die();
require_once($CFG->libdir . '/externallib.php');

/**
 * Renews a signed playback lease.
 */
class renew extends \external_api {
    /**
     * Describes the external function parameters.
     * @return \external_function_parameters
     */
    public static function execute_parameters(): \external_function_parameters {
        return new \external_function_parameters([
            'url' => new \external_value(PARAM_RAW, 'Previously signed playlist URL'),
            'newplayback' => new \external_value(PARAM_BOOL, 'New logical replay after ended', VALUE_DEFAULT, false),
        ]);
    }

    /**
     * Renews the requested playback lease.
     * @param string $url Previously signed playlist URL.
     * @return array Fresh playback URLs.
     */
    public static function execute(string $url, bool $newplayback = false): array {
        global $USER;
        $params = self::validate_parameters(self::execute_parameters(), ['url' => $url, 'newplayback' => $newplayback]);
        if (!isloggedin() || isguestuser()) {
            throw new \moodle_exception('requireloginerror', 'error');
        }
        return \filter_impronta\renewal::issue($params['url'], (int) $USER->id, true, $params['newplayback']);
    }

    /**
     * Describes the external function return value.
     * @return \external_single_structure
     */
    public static function execute_returns(): \external_single_structure {
        return new \external_single_structure([
            'playlistUrl' => new \external_value(PARAM_URL, 'Fresh playlist URL'),
            'eventsUrl' => new \external_value(PARAM_URL, 'Fresh analytics URL'),
            'sessionUrl' => new \external_value(PARAM_URL, 'Fresh heartbeat URL'),
            'batchUrl' => new \external_value(PARAM_URL, 'Fresh batch URL'),
            'realtimeUrl' => new \external_value(PARAM_URL, 'Fresh realtime URL'),
            'expiresAt' => new \external_value(PARAM_INT, 'Unix expiry'),
            'samePlayback' => new \external_value(PARAM_BOOL, 'Whether this preserves the logical playback'),
        ]);
    }
}
