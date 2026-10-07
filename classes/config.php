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
 * Ajustes del plugin (filter_impronta/...).
 *
 * @package   filter_impronta

 * @copyright  2026 DaniMarqz
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace filter_impronta;


/**
 * Lectura de la configuración de administración de Moodle.
 */
class config {
    /**
     * Lee un ajuste del plugin.
     *
     * @param string $name
     * @param mixed $default
     * @return mixed
     */
    public static function get(string $name, $default = null) {
        $value = get_config('filter_impronta', $name);
        return ($value === false) ? $default : $value;
    }

    /**
     * Lee un ajuste obligatorio; revienta si falta.
     *
     * @param string $name
     * @return string
     * @throws \coding_exception
     */
    public static function required(string $name): string {
        $value = self::get($name);
        if ($value === null || $value === '') {
            throw new \coding_exception('Missing required Impronta configuration: filter_impronta/' . $name);
        }
        return (string) $value;
    }

    /**
     * Si los tokens internos se atan a la IP de quien los pide.
     *
     * @return bool
     */
    public static function bind_ip(): bool {
        $raw = self::get('bindip', '0');
        return filter_var((string) $raw, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) !== false;
    }

    /**
     * Si un vídeo sin contexto de curso puede reproducirse igualmente.
     *
     * @return bool
     */
    public static function require_course(): bool {
        $raw = self::get('requirecourse', '1');
        return filter_var((string) $raw, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) !== false;
    }

    /**
     * Duración de los tokens del plugin, en segundos.
     *
     * Default de 7 h (25200 s): debe sobrevivir a la firma de Impronta (TTL =
     * duración de la clase + 30 min, techo de 6 h), porque la recuperación
     * ante 403 recarga playlist.php con el token ORIGINAL del render. Un
     * único sitio con este cálculo: si el player y las renditions del master
     * usaran TTLs distintos, la recuperación fallaría a mitad de clase y solo
     * en las clases con varias calidades.
     *
     * @return int
     */
    public static function token_ttl(): int {
        return max(60, (int) self::get('tokenttl', 25200));
    }
}
