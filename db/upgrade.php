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
 * Upgrade steps for the Impronta filter.
 *
 * @package   filter_impronta

 * @copyright  2026 DaniMarqz
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * Execute filter_impronta upgrades from the given version.
 *
 * @param int $oldversion the version we are upgrading from
 * @return bool
 */
function xmldb_filter_impronta_upgrade($oldversion) {
    if ($oldversion < 2026080502) {
        // Plan TTL corto, fase 0.2 — invariante de tokenttl.
        //
        // La recuperación ante 403 recarga playlist.php con el token
        // ORIGINAL del render: para que se complete, el token debe sobrevivir
        // a la firma de CloudFront de Impronta (TTL = duración de la clase + 30
        // min, techo de 6 h = 21600 s). El default del ajuste subió de 1800 a
        // 25200 (7 h) en settings.php, pero cambiar el default no toca el
        // valor ya guardado en la tabla config: aquí se sube en los sitios
        // instalados. Solo si está estrictamente por debajo del techo de la
        // firma — una configuración manual de 22000 ya cumple la invariante y
        // se respeta.
        $current = get_config('filter_impronta', 'tokenttl');
        if ($current !== false && (int) $current > 0 && (int) $current < 21600) {
            set_config('tokenttl', 25200, 'filter_impronta');
        }

        upgrade_plugin_savepoint(true, 2026080502, 'filter', 'impronta');
    }

    return true;
}
