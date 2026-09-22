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
 * Impronta filter for Moodle.
 *
 * Replaces [imp:Materia/Clase] and the legacy [s3:Materia/Clase] tags (plus
 * their impaudio/s3audio variants) with a video player with per-user
 * watermark, course-based access control, and analytics.
 *
 * Options after a pipe:
 *   [imp:Fisica/Tema 3|subs=es,en]
 *   [impaudio:Fisica/Tema 3]
 *
 * [s3:] se conserva como alias para que el contenido histórico pase por el
 * backend de Impronta sin mantener el proxy CloudFront antiguo.
 *
 * The course is read from the filter's render context and signed into the
 * access token — the browser cannot change it.
 *
 * @package   filter_impronta

 * @copyright  2026 DaniMarqz
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace filter_impronta;


/**
 * Replaces Impronta markers with protected players.
 */
class text_filter extends \moodle_text_filter {
    /**
     * Filters rendered Moodle text.
     * @param string $text Text to filter.
     * @param array $options Filter options.
     * @return string Filtered text.
     */
    public function filter($text, array $options = []) {
        // Descarte rápido: esto corre sobre CADA texto que Moodle renderiza en
        // el sitio, así que la ruta que no encuentra nada tiene que ser barata.

        if (strpos($text, '[imp') === false && strpos($text, '[s3') === false) {
            return $text;
        }

        // El prefijo no captura para que 'audio' siga siendo $1.
        static $pattern = '/\[(?:imp|s3)(audio)?:([^\]]+)\]/';

        $courseid = access::courseid_from_context($this->context);

        return preg_replace_callback($pattern, function ($matches) use ($courseid) {
            $isaudio = $matches[1] === 'audio';
            $raw = trim(strip_tags($matches[2]));
            if ($raw === '') {
                return '';
            }

            $parts = explode('|', $raw);
            $filename = trim(array_shift($parts));
            if ($filename === '') {
                return '';
            }

            $subtitles = [];
            foreach ($parts as $part) {
                $part = trim($part);
                if ($part === '' || strpos($part, '=') === false) {
                    continue;
                }
                [$optkey, $optvalue] = array_map('trim', explode('=', $part, 2));
                if (strcasecmp($optkey, 'subs') !== 0) {
                    continue;
                }
                foreach (explode(',', $optvalue) as $lang) {
                    $lang = strtolower(trim($lang));
                    if (preg_match('/^[a-z0-9\-]{2,5}$/', $lang)) {
                        $subtitles[] = $lang;
                    }
                }
            }

            return player::render($filename, [
                'audio' => $isaudio,
                'subtitles' => $subtitles,
                'courseid' => $courseid,
            ]);
        }, $text);
    }
}
