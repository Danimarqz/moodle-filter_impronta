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
namespace filter_impronta;


/**
 * Issues a new, short-lived playback lease to the authenticated owner of an old one.
 * @copyright  2026 DaniMarqz
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class renewal {
    /**
     * Issues a renewed playback lease.
     * @param string $url Previous signed URL.
     * @param int $currentuserid Current Moodle user ID.
     * @param bool $app Whether the request comes from the app.
     * @return array Renewed playback URLs.
     */
    public static function issue(string $url, int $currentuserid, bool $app): array {
        $query = parse_url($url, PHP_URL_QUERY);
        if (!is_string($query)) {
            throw new \moodle_exception('tokeninvalid', 'filter_impronta');
        }
        parse_str($query, $params);
        $path = trim(preg_replace('#/+#', '/', str_replace('\\', '/', (string) ($params['f'] ?? ''))), '/');
        $courseid = (int) ($params['c'] ?? 0);
        $userid = (int) ($params['u'] ?? 0);
        $expires = (int) ($params['e'] ?? 0);
        $playbackid = (string) ($params['p'] ?? '');
        $mode = (string) ($params['m'] ?? '');
        $group = (string) ($params['g'] ?? '');
        $oldtoken = (string) ($params['t'] ?? '');
        if (
            $path === '' || strpos($path, '..') !== false || $userid !== $currentuserid
                || $mode === 'scorm' || !token::signed_context(
                    $path,
                    $oldtoken,
                    $expires,
                    $courseid,
                    request::ip(),
                    $userid,
                    $app,
                    $group,
                    $playbackid,
                    $mode
                )
                || ($courseid > 0 && !access::can_view_course($courseid, $userid))
                || ($courseid <= 0 && config::require_course())
        ) {
            throw new \moodle_exception('tokeninvalid', 'filter_impronta');
        }
        $newexpires = time() + config::token_ttl();
        $newplaybackid = 'r' . bin2hex(random_bytes(8));
        $newtoken = token::generate(
            $path,
            $newexpires,
            $courseid,
            request::ip(),
            $userid,
            $app,
            '',
            $newplaybackid
        );
        return [
            'playlistUrl' => token::endpoint_url(
                'playlist.php',
                $path,
                $newtoken,
                $newexpires,
                $courseid,
                $userid,
                !empty($params['a']) ? ['a' => 1] : [],
                '',
                $newplaybackid
            ),
            'eventsUrl' => token::endpoint_url(
                'events.php',
                $path,
                $newtoken,
                $newexpires,
                $courseid,
                $userid,
                [],
                '',
                $newplaybackid
            ),
            'sessionUrl' => token::endpoint_url(
                'heartbeat.php',
                $path,
                $newtoken,
                $newexpires,
                $courseid,
                $userid,
                [],
                '',
                $newplaybackid
            ),
            'expiresAt' => $newexpires,
        ];
    }
}
