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
// Tests de la plantilla del watermark: qué campos se sustituyen, cuáles se
// rechazan y qué colores se aceptan. Lo que se fija aquí es sobre todo el
// límite de confianza: la plantilla la escribe un administrador, pero los
// valores salen del perfil de cada alumno y acaban en un <script>, y el
// color acaba dentro de un bloque <style>.

namespace filter_impronta;


/**
 * Covers watermark and token behavior.
 *
 * @covers \filter_impronta\watermark
 * @covers \filter_impronta\token

 * @copyright  2026 DaniMarqz
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class watermark_test extends \advanced_testcase {
    /**
     * Tests the documented brace-based template.
     */
    public function test_label_con_llaves(): void {
        $this->resetAfterTest();
        set_config('watermarktemplate', '{firstname} - {idnumber}', 'filter_impronta');

        $user = $this->getDataGenerator()->create_user([
            'firstname' => 'Juan',
            'lastname' => 'Pérez',
            'idnumber' => '12345678A',
        ]);

        $this->assertSame('Juan - 12345678A', watermark::label($user));
    }

    /**
     * Las instalaciones anteriores a las llaves guardaron "name - dni" en el
     * ajuste. Si dejaran de sustituirse, el watermark de esos sitios pasaría
     * a ser el texto literal "name - dni" sin que nadie se entere.
     */
    public function test_label_formato_antiguo_sin_llaves(): void {
        $this->resetAfterTest();
        set_config('watermarktemplate', 'name - dni', 'filter_impronta');

        $user = $this->getDataGenerator()->create_user([
            'firstname' => 'Ana',
            'lastname' => 'Gómez',
            'idnumber' => 'X1234567L',
        ]);

        $this->assertSame(fullname($user) . ' - X1234567L', watermark::label($user));
    }

    /**
     * Tests that an allowed empty field becomes empty.
     */
    public function test_campo_vacio_se_sustituye_por_nada(): void {
        $this->resetAfterTest();
        set_config('watermarktemplate', '{firstname}{idnumber}', 'filter_impronta');

        $user = $this->getDataGenerator()->create_user(['firstname' => 'Lucía', 'idnumber' => '']);

        $this->assertSame('Lucía', watermark::label($user));
    }

    /**
     * Tests that an unknown token remains visible.
     */
    public function test_token_desconocido_se_deja_literal(): void {
        $this->resetAfterTest();
        set_config('watermarktemplate', '{firstname} {noexiste}', 'filter_impronta');

        $user = $this->getDataGenerator()->create_user(['firstname' => 'Marta']);

        $this->assertSame('Marta {noexiste}', watermark::label($user));
    }

    /**
     * Lo importante de la lista blanca: $USER lleva también el hash de la
     * contraseña y el sesskey, y el watermark se pinta en el navegador del
     * alumno. Un token fuera de la lista no debe resolverse jamás.
     */
    public function test_campos_sensibles_no_se_resuelven(): void {
        $this->resetAfterTest();
        $user = $this->getDataGenerator()->create_user();
        $user->password = 'hash-que-no-debe-salir';
        $user->sesskey = 'sesskey-que-no-debe-salir';
        $user->secret = 'secreto-que-no-debe-salir';

        foreach (['password', 'sesskey', 'secret', 'id'] as $token) {
            $this->assertNull(
                watermark::field($user, $token),
                "El token '$token' no debería resolverse"
            );
        }
    }

    public function test_campos_permitidos_y_de_perfil_se_resuelven(): void {
        $this->resetAfterTest();
        $user = $this->getDataGenerator()->create_user(['firstname' => 'Eva', 'city' => 'Bilbao']);
        $user->profile_field_dni = 'B98765432';

        $this->assertSame('Eva', watermark::field($user, 'firstname'));
        $this->assertSame('Bilbao', watermark::field($user, 'city'));
        $this->assertSame('B98765432', watermark::field($user, 'profile_field_dni'));
        // Alias heredados.
        $this->assertSame(fullname($user), watermark::field($user, 'name'));
    }

    /**
     * El token atado a usuario es lo que sustituye a la cookie de sesión en
     * el camino de la app, así que su integridad es lo único que separa a un
     * alumno de reproducir como otro.
     */
    public function test_token_atado_a_usuario(): void {
        $this->resetAfterTest();
        set_config('secretkey', 'un-secreto-de-pruebas', 'filter_impronta');
        set_config('bindip', 0, 'filter_impronta');

        $path = 'Materia/Clase';
        $expires = time() + 3600;
        $ip = '203.0.113.7';

        $token = token::generate($path, $expires, 5, $ip, 42);

        // Sirve para el usuario que se firmó...
        $this->assertTrue(token::validate($path, $token, $expires, 5, $ip, 42));
        // ...y para nadie más: cambiar la u de la URL invalida el HMAC.
        $this->assertFalse(token::validate($path, $token, $expires, 5, $ip, 43));
        // Ni permite quitar la atadura para colarse como anónimo.
        $this->assertFalse(token::validate($path, $token, $expires, 5, $ip, 0));
        // Ni reutilizarlo en otra clase o en otro curso.
        $this->assertFalse(token::validate('Materia/Otra', $token, $expires, 5, $ip, 42));
        $this->assertFalse(token::validate($path, $token, $expires, 6, $ip, 42));
        // Caducado, no.
        $this->assertFalse(token::validate($path, $token, time() - 1, 5, $ip, 42));
    }

    /**
     * La marca de app es lo que exime a la app de tener sesión de navegador en
     * playlist.php. O sea que si un token normal pudiera hacerse pasar por uno
     * de la app, cualquier URL de playlist volvería a valer copiada y sin sesión
     * durante todo su TTL — y sin que nada falle ni se note.
     */
    public function test_marca_de_app_no_se_puede_falsificar(): void {
        $this->resetAfterTest();
        set_config('secretkey', 'un-secreto-de-pruebas', 'filter_impronta');
        set_config('bindip', 0, 'filter_impronta');

        $path = 'Materia/Clase';
        $expires = time() + 3600;
        $ip = '203.0.113.7';

        $normal = token::generate($path, $expires, 5, $ip, 42, false);
        $deapp = token::generate($path, $expires, 5, $ip, 42, true);

        // La marca tiene que cambiar la firma, o no marca nada.
        $this->assertNotSame($normal, $deapp);
        // Cada uno vale contra su variante...
        $this->assertTrue(token::validate($path, $normal, $expires, 5, $ip, 42, false));
        $this->assertTrue(token::validate($path, $deapp, $expires, 5, $ip, 42, true));
        // ...y NO cruzados: esto es lo que impide ascender un token normal a "de
        // la app" y saltarse la exigencia de sesión.
        $this->assertFalse(token::validate($path, $normal, $expires, 5, $ip, 42, true));
        $this->assertFalse(token::validate($path, $deapp, $expires, 5, $ip, 42, false));
    }

    /**
     * Tests browser IP binding without breaking mobile network changes.
     */
    public function test_bindip_only_applies_to_browser_tokens(): void {
        $this->resetAfterTest();
        set_config('secretkey', 'un-secreto-de-pruebas', 'filter_impronta');
        set_config('bindip', 1, 'filter_impronta');

        $path = 'Materia/Clase';
        $expires = time() + 3600;
        $wifi = '203.0.113.7';
        $mobile = '198.51.100.9';
        $browser = token::generate($path, $expires, 5, $wifi, 42, false);
        $app = token::generate($path, $expires, 5, $wifi, 42, true);

        $this->assertFalse(token::validate($path, $browser, $expires, 5, $mobile, 42, false));
        $this->assertTrue(token::validate($path, $app, $expires, 5, $mobile, 42, true));
        $this->assertTrue(token::signed_context($path, $app, $expires, 5, $mobile, 42, true));
        $this->assertFalse(token::validate($path, $browser, $expires, 5, $mobile, 42, true));
    }

    /**
     * Los tokens ya emitidos viven horas: si el despliegue los invalidara,
     * cortaría la reproducción a quien esté viendo una clase en ese momento.
     */
    public function test_token_sin_usuario_sigue_validando(): void {
        $this->resetAfterTest();
        set_config('secretkey', 'un-secreto-de-pruebas', 'filter_impronta');
        set_config('bindip', 0, 'filter_impronta');

        $expires = time() + 3600;
        $viejo = token::generate('Materia/Clase', $expires, 5, '203.0.113.7');

        $this->assertTrue(token::validate('Materia/Clase', $viejo, $expires, 5, '203.0.113.7'));
    }

    /**
     * Tests that SCORM grants bind group and playback to the HMAC.
     */
    public function test_token_scorm_atado_a_grupo_y_reproduccion(): void {
        $this->resetAfterTest();
        set_config('secretkey', 'un-secreto-de-pruebas', 'filter_impronta');
        set_config('bindip', 0, 'filter_impronta');

        $expires = time() + 3600;
        $token = token::generate(
            'Materia/Clase',
            $expires,
            0,
            '203.0.113.7',
            42,
            false,
            'grupo-abc',
            'playback-123',
            'scorm'
        );

        $this->assertTrue(token::validate(
            'Materia/Clase',
            $token,
            $expires,
            0,
            '203.0.113.7',
            42,
            false,
            'grupo-abc',
            'playback-123',
            'scorm'
        ));
        $this->assertFalse(token::validate(
            'Materia/Clase',
            $token,
            $expires,
            0,
            '203.0.113.7',
            42,
            false,
            'otro-grupo',
            'playback-123',
            'scorm'
        ));
        $this->assertFalse(token::validate(
            'Materia/Clase',
            $token,
            $expires,
            0,
            '203.0.113.7',
            42,
            false,
            'grupo-abc',
            'otro-playback',
            'scorm'
        ));
        // A SCORM token is not a normal/app token variant.
        $this->assertFalse(token::validate('Materia/Clase', $token, $expires, 0, '203.0.113.7', 42));
    }

    /**
     * Tests that endpoint URLs keep the signed Moodle user.
     */
    public function test_endpoint_scorm_incluye_usuario_y_grant(): void {
        $url = token::endpoint_url(
            'playlist.php',
            'Materia/Clase',
            'token',
            time() + 60,
            0,
            42,
            [],
            'grupo-abc',
            'playback-123',
            'scorm'
        );

        $this->assertStringContainsString('u=42', $url);
        $this->assertStringContainsString('g=grupo-abc', $url);
        $this->assertStringContainsString('p=playback-123', $url);
        $this->assertStringContainsString('m=scorm', $url);
    }

    /**
     * El color se interpola en un <style>: un valor libre podría cerrar la
     * regla e inyectar CSS. Solo hexadecimal; lo demás cae al blanco.
     */
    public function test_color_solo_acepta_hexadecimal(): void {
        $this->resetAfterTest();

        $validos = ['#fff', '#ffffff', '#FF0000', '#12345678'];
        foreach ($validos as $color) {
            set_config('watermarkcolor', $color, 'filter_impronta');
            $this->assertSame($color, watermark::color());
        }

        $invalidos = [
            'red',
            'rgb(255,0,0)',
            '#fff; } body { display: none',
            '</style><script>alert(1)</script>',
            '',
        ];
        foreach ($invalidos as $color) {
            set_config('watermarkcolor', $color, 'filter_impronta');
            $this->assertSame('#ffffff', watermark::color());
        }
    }
}
