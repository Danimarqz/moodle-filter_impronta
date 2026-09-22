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
 * Mobile app integration for the Impronta player.
 * @package filter_impronta
 * @copyright 2026 DaniMarqz
 * @license http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
// Soporte para la app de Moodle: registra el reproductor in-app.
//
// La única pieza que importa de este fichero es 'init': su JavaScript lo
// ejecuta la app nada más recuperar el plugin, y es el arranque del
// reproductor in-app (ver \filter_impronta\output\mobile::mobile_init, que
// carga js/app-player.js).
//
// Ese JavaScript NO registra ningún handler de CoreFilterDelegate, a
// propósito: el motivo está explicado en js/app-player.js y costó un día de
// app caída en producción. El filtro PHP sigue corriendo server-side antes de
// mandar el HTML a la app (ver \filter_impronta\player::render), así que lo que
// llega al dispositivo ya es un marcador con la URL de la playlist, el
// watermark resuelto y el token firmado. El reproductor solo tiene que
// montarse encima.

defined('MOODLE_INTERNAL') || die();

$addons = [
    'filter_impronta' => [
        'handlers' => [
            'improntaplayer' => [
                'delegate' => 'CoreFilterDelegate',
                'method' => 'mobile_init',
                'init' => 'mobile_init',
            ],
        ],
        'lang' => [
            ['openvideo', 'filter_impronta'],
            ['openvideoinfo', 'filter_impronta'],
        ],
    ],
];
