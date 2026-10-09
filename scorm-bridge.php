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
 * Puente entre un paquete SCORM y el reproductor.
 *
 * # Que problema resuelve
 *
 * Un SCO sabe, por la API de SCORM, el identificador y el nombre del alumno. Son
 * dos campos, y son afirmaciones del navegador: el paquete lo tiene el alumno,
 * asi que puede editarlo, llamar a este endpoint a mano o repetir una peticion
 * vieja. Y el reproductor, que vive en otro origen, no puede leer la API de
 * SCORM del LMS ni queriendo.
 *
 * Lo que SI es fiable es esto: la cookie de sesion que el navegador manda aqui,
 * en el origen del propio Moodle. Con ella y con `$USER`, este fichero sabe quien
 * es el alumno de verdad, y a partir de ahi aplica la plantilla de watermark que
 * haya configurada en la administracion -incluido `{profile_field_dni}`, que
 * SCORM no expone de ninguna manera- y devuelve al SCO lo que necesita para
 * pintar el video.
 *
 * # Que NO hace
 *
 * No crea la sesion de reproduccion ni firma nada: de eso se encarga scorm.php
 * cuando el reproductor se carga de verdad. Si este endpoint la creara, cada
 * recarga del curso abriria una sesion que nadie late y el recuento de sesiones
 * simultaneas -que es lo que detecta cuentas compartidas- contaria fantasmas.
 *
 * # Sobre `declaredId` y `declaredName`
 *
 * Llegan del SCO y se aceptan sin creerlos: se devuelven en la respuesta para
 * que la pantalla de diagnostico del curso pueda compararlos con lo que dice
 * Moodle. Un desajuste es informativo (un SCO reempaquetado a mano, o un
 * `student_id` que el LMS no inicializa), no una autorizacion. La etiqueta que
 * acaba en el video sale SIEMPRE de `$USER`, nunca de estos parametros.
 *
 * # Control de acceso
 *
 * El mismo que scorm.php: sesion de Moodle no invitada. El identificador de
 * grupo es una llave publica y revocable, no lleva identidad, y se valida su
 * forma antes de devolver nada. Un alumno autenticado puede pedir la URL del
 * reproductor de un grupo que conozca, igual que puede abrir el iframe: lo que
 * frena el acceso al video no es esta respuesta, es que cada segmento pide una
 * sesion viva y que revocar el grupo corta en el siguiente.
 *
 * @package filter_impronta
 * @copyright  2026 DaniMarqz
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

// phpcs:ignore moodle.Files.RequireLogin.Missing -- require_login() se llama unas lineas mas abajo, antes de leer nada util.
require_once(__DIR__ . '/../../config.php');

use filter_impronta\config;
use filter_impronta\request;
use filter_impronta\watermark;

/**
 * Termina la peticion con un error en JSON.
 *
 * @param int $status Codigo HTTP.
 * @param string $error Codigo corto para el cliente.
 */
function impronta_scorm_bridge_fail(int $status, string $error): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['error' => $error]);
    exit;
}

// El SCO vive en el origen del propio Moodle (los paquetes de mod/scorm se sirven
// desde pluginfile.php), asi que en el caso normal esto no manda ninguna
// cabecera: es mismo origen y la cookie viaja sola. Se llama igual por si el
// paquete se sirve desde otro sitio del mismo dominio.
request::send_cors_headers();

// Esto no es un endpoint de lectura publica: la sesion es lo unico que autoriza.
require_login();

if (isguestuser()) {
    impronta_scorm_bridge_fail(403, 'guest');
}

$rawf = optional_param('f', '', PARAM_RAW_TRIMMED);
$group = optional_param('g', '', PARAM_ALPHANUMEXT);
$declaredid = optional_param('declaredId', '', PARAM_TEXT);
$declaredname = optional_param('declaredName', '', PARAM_TEXT);

// Se normaliza igual que playlist.php y scorm.php: la ruta acaba dentro de una
// policy firmada y en la clave del catalogo, asi que se limpia donde se usa.
$path = trim(preg_replace('#/+#', '/', str_replace('\\', '/', (string) $rawf)), '/');
if ($path === '' || strpos($path, '..') !== false) {
    impronta_scorm_bridge_fail(400, 'missingfilename');
}
if ($group === '' || !preg_match('/^[A-Za-z0-9_-]{4,128}$/', $group)) {
    impronta_scorm_bridge_fail(400, 'scormgroupinvalid');
}

// La etiqueta sale del usuario de la sesion, nunca de lo que diga el SCO. Es la
// misma llamada que hace el reproductor de encima del video, asi que lo que el
// alumno ve aqui y lo que se quema en el segmento no pueden divergir.
$label = watermark::label($USER);

$playerurl = new moodle_url('/filter/impronta/scorm.php', [
    'f' => $path,
    'g' => $group,
]);

// La plantilla puede no usar ningun campo del alumno -un texto fijo para toda la
// promocion, por ejemplo-. En ese caso la etiqueta es valida igual y el aviso va
// aparte, para que un administrador que esperaba un nombre se entere.
$personalizada = strpos((string) config::get('watermarktemplate', ''), '{') !== false;

header('Content-Type: application/json; charset=utf-8');
// no-store y no una cache corta: esta respuesta lleva el nombre del alumno. Un
// proxy que la guarde se lo sirve al siguiente que pase.
header('Cache-Control: no-store');

echo json_encode([
    'playerUrl' => $playerurl->out(false),
    'watermarkLabel' => (string) $label,
    // Sin plantilla personalizada no hay dato personal en la etiqueta, pero el
    // curso lo enseña en el diagnostico para que se vea por que.
    'personalizada' => $personalizada,
    'resolvedFor' => [
        'fullname' => fullname($USER),
        'username' => (string) $USER->username,
    ],
    // Eco de lo que afirma el SCO, para el diagnostico. No autoriza nada.
    'declared' => [
        'id' => $declaredid,
        'name' => $declaredname,
        'coincide' => $declaredname === '' ? null : ($declaredname === fullname($USER)),
    ],
]);
