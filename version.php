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
 * Version information for the Impronta filter.
 * @package filter_impronta
 * @copyright 2026 DaniMarqz
 * @license http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
defined('MOODLE_INTERNAL') || die();

// Subir esto NO es burocracia: player::asset_url() lo usa como ?v= de
// watermark.js y del resto de assets. Con el bundle del watermark cambiado y la
// versión igual, el webview de la app sigue sirviendo el JS viejo de su caché.
$plugin->version   = 2026092200;   // YYYYMMDDXX.
$plugin->requires  = 2022041900;   // Moodle 4.0+.
$plugin->component = 'filter_impronta';
$plugin->maturity  = MATURITY_STABLE;
$plugin->release   = '0.2';
$plugin->settings = true;
