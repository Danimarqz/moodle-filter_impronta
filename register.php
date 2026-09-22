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
 * Registers the current Moodle origin with Impronta.
 * @copyright  2026 DaniMarqz
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once(__DIR__ . '/../../config.php');

use filter_impronta\config;
use filter_impronta\impronta_api;

require_login();
require_capability('moodle/site:config', context_system::instance());
require_sesskey();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    redirect(new moodle_url('/admin/settings.php', ['section' => 'filtersettingimpronta']));
}

$ok = impronta_api::register_site();
$url = new moodle_url('/admin/settings.php', ['section' => 'filtersettingimpronta']);
if ($ok) {
    // El registro trae y guarda el dominio del media (ajuste oculto mediabase):
    // enseñarlo aquí ahorra ir a la base de datos para comprobar que llegó.
    $msg = get_string('registersuccess', 'filter_impronta');
    $mediabase = (string) config::get('mediabase', '');
    if ($mediabase !== '') {
        $msg .= '<br>' . get_string('registermediabase', 'filter_impronta', s($mediabase));
    }
    redirect($url, $msg, null, \core\output\notification::NOTIFY_SUCCESS);
} else {
    redirect(
        $url,
        get_string('registerfailure', 'filter_impronta'),
        5,
        \core\output\notification::NOTIFY_ERROR
    );
}
