Estado de preparación: versión `2026092200` desplegada y verificada el
2026-09-22.

Historial del incidente anterior:
- El día 20 se desplegaron las dos cosas: el plugin y los Lambdas (impronta-player/impronta-watermark, 16:29 UTC). Culpamos al plugin; el culpable era el backend. Los errores de los alumnos y el fallo de la app eran el mismo bug de CORS.
- El rollback borró código que sí hacía falta: renew.php, la renovación de token en js/player-extras.js y la idempotencia de los latidos de 41d8f96. De ahí los 25×404 de renew.php desde las 10:58 — clientes con el JS cacheado pidiendo un endpoint que ya no existe.
- Y producción corre ahora código del día 15 etiquetado 2026092101, que no corresponde a ningún commit.

Las condiciones previas al avance quedan resueltas:

- [x] Versionar por encima de `2026092101`: producción corre `2026092200`.
- [x] Corregir la expectativa obsoleta de `[s3:]` en `tools/smoke-filter.php`.
- [x] Desplegar en OpositaTCAE, reiniciar PHP-FPM y purgar cachés.

# Preparacion para Moodle Marketplace

No publicar hasta completar los bloqueantes y observar durante una semana la
version desplegada en produccion.

> **Aviso (2026-10-07).** El Plugins Directory se ha movido a **Moodle
> Marketplace** y la checklist de `moodledev.io/general/community/
> plugincontribution/checklist` es oficialmente "legacy guidance". Los puntos de
> abajo siguen siendo validos en su mayoria, pero los requisitos vigentes estan
> en las *Moodle Marketplace Plugin Submission Guidelines*. Verificar antes de
> enviar.
>
> **CORREGIDO el mismo dia.** El bloqueante de abajo era **falso salvo en un
> punto**: las rutas **SI estan desplegadas en produccion aunque no se hayan
> pusheado al repo**. Comprobado en vivo contra `app.impronta.video/api`:
>
> | Peticion | Respuesta | Lectura |
> | --- | --- | --- |
> | `POST /analytics/batch` | **401** `invalid or missing Authorization header` | La ruta EXISTE y solo pide credenciales |
> | `POST /player/realtime` | **401** `missing or malformed Authorization header` | La ruta EXISTE |
> | `POST /player/playlist` (control, existe) | 401 | mismo patron |
> | `POST /no-existe-xyz` (control, no existe) | **404** | asi se ve una ruta ausente |
>
> El 401 frente al 404 es la prueba: API Gateway devuelve 404 cuando no hay ruta
> declarada, y 401 cuando la ruta existe y el autorizador rechaza. Las funciones
> `analytics` y `realtime` estan desplegadas fuera del repo.
>
> **Lo unico que sigue sin verificar es el endpoint WSS propiamente dicho.**
> `POST /player/realtime` devuelve el token de socket, pero el handshake
> WebSocket no lo he podido probar sin credenciales de tenant: no hay hostnames
> `ws.`/`wss.` en DNS, y la URL del socket solo la devuelve el backend en la
> respuesta autenticada. No se ha comprobado que un socket conecte de verdad.
>
> Conclusion: **V2 no hay que retirarlo por falta de backend.** Queda como
> experimento a validar en produccion con observacion.

> **Aviso original, con el error de fondo.** El desarrollo de la Fase 2 ocurre en
> una rama local que nunca se pusheo (la rama `development` no existe en
> `origin`), pero **si se despliego**. Confundir "no esta en el repo" con "no
> esta en produccion" fue el error: revisorar el codigo fuente no basta para
> saber que hay desplegado, porque SAM y el repo pueden divergir.

## Bloqueantes

- [x] Implementar `classes/privacy/provider.php` con la Privacy API de Moodle.
  Declarar todos los datos enviados a Impronta y su finalidad: identificador de
  usuario, nombre, DNI, IP, curso/clase, sesiones, progreso y eventos de
  reproduccion, que Impronta puede usar para generar alertas, además de los
  datos de marca de agua.
- [x] Anadir las cadenas inglesas de privacidad correspondientes en
  `lang/en/filter_impronta.php`.
- [x] Crear `README.md` en ingles con instalacion, configuracion, requisitos,
  funcionamiento, desinstalacion y resolucion de problemas.
- [x] Explicar claramente que el plugin necesita una suscripcion a Impronta,
  que credenciales requiere y como puede obtenerlas un administrador.
- [x] Elegir y documentar la licencia del plugin; anadir el fichero de licencia
  y el boilerplate/copyright requerido a los fuentes propios.
- [x] Documentar Video.js y sus componentes en `thirdpartylibs.xml`, incluyendo
  version, licencia, origen y ruta.
- [x] Anadir el `readme_moodle.txt` exigido dentro de la libreria de terceros,
  con URL de descarga y proceso usado para producir los archivos distribuidos.
- [x] Sacar `deploy.sh` del repositorio y del ZIP publicos: contiene la IP y
  detalles operativos del Moodle de Tais.
- [x] Confirmar que ningun fichero distribuido contiene hosts, credenciales,
  secretos, identificadores o instrucciones internas de clientes.

## Compatibilidad y calidad

- [x] Probar una instalacion limpia desde el ZIP, sin acceso a shell ni pasos de
  build, en Moodle 4.5 LTS y en las versiones 5.x mantenidas. Verificado en
  Moodle 4.5.14, 5.0.10 y 5.1.7 con PostgreSQL; el smoke incluye el handler de
  Moodle App y sus assets.
- [x] Probar la actualizacion desde la version actualmente desplegada. En
  Moodle 5.0 se instaló una copia equivalente a `2026091500` y se actualizó a
  `2026092200` con `admin/cli/upgrade.php`.
- [x] Ejecutar las pruebas con debugging de desarrollador completo y corregir
  todos los warnings, notices y deprecated.
  Smoke Moodle con `SMOKE_DEBUG=1`: sin warnings, notices ni deprecated.
- [x] Ejecutar Moodle Code Checker y revisar estilo, namespaces, nombres
  frankenstyle, textos hardcoded y boilerplate.
- [x] Revisar los endpoints publicos y web services: validacion de parametros,
  autenticacion, capacidades, sesskey cuando corresponda y respuestas de error.
  `playlist.php`, `embed.php`, `events.php` y `heartbeat.php` validan HMAC,
  matrícula y parámetros; `renew.php` exige sesión y sesskey; `scorm.php`
  exige sesión no invitada; registro/quien exigen capacidad y sesskey; el
  servicio móvil valida el usuario autenticado.
- [x] Verificar funcionamiento con MySQL/MariaDB y PostgreSQL, o documentar por
  que una base concreta no aplica. Smoke completado en PostgreSQL 16 y MariaDB
  10.11 con Moodle 5.0.10.
- [x] Confirmar que el plugin funciona en navegador, Moodle App y webviews
  soportados. Verificado con el curso 157, sección 6, en navegador y en el
  contenedor de Moodle App; el reproductor, watermark y renovación cargan.
- [x] Mantener verdes las pruebas PHP y JavaScript existentes.
  **Reverificado el 2026-10-07** en Moodle **4.5.15** (LTS) con PostgreSQL 17.11
  y PHP 8.2.34, instalando el plugin desde el arbol de trabajo:
  `OK (16 tests, 57 assertions)` con `--fail-on-warning --fail-on-risky`.
  JavaScript: `node --test tests/*.test.js` -> 46 tests, 45 pasan, 1 se salta
  (el que ejecuta `upgrade.php` requiere PHP en el runner). phpcs con el
  estandar Moodle sobre los 32 ficheros PHP: 0 errores.
  Reproductor: `moodle-check/README.md` documenta el procedimiento exacto.
- [x] Hacer una instalacion de prueba con el mismo ZIP exacto que se enviara al
  Marketplace.

## Paquete publico

- [x] No hacer publico el repositorio privado actual tal cual. Crear el
  repositorio publico desde un arbol saneado o reescribir y auditar todo su
  historial: la IP de Tais aparece en commits anteriores aunque se borre del
  estado actual.
- [x] Eliminar del codigo publico nombres de clientes, IP, rutas de servidor,
  runbooks de produccion, referencias a incidentes y cualquier detalle que no
  sea necesario para instalar o mantener el plugin.
- [x] Ejecutar un escaner de secretos sobre el arbol y sobre todo el historial
  que vaya a publicarse; dejar el mismo escaneo en CI para cada commit y release.
  Gitleaks sobre 55 commits y el árbol actual: 0 fugas; CI añadido en
  `.github/workflows/secret-scan.yml`.
- [x] Confirmar que nunca se han versionado API keys, secretos HMAC, cookies,
  tokens de Moodle, claves CloudFront, credenciales SSH o ficheros de entorno.
- [ ] Revisar que el backend trate el plugin y su protocolo como completamente
  publicos: ninguna autorizacion puede depender de ocultar una URL, nombre de
  parametro, formato de token o algoritmo.
- [x] Verificar que cada API key solo autoriza a su tenant, puede rotarse y no
  permite operaciones root ni acceso a recursos de otro tenant. Revisado en
  `core.VerifyAPIToken` y `cmd/root`: lectura fresca del tenant, comparación en
  tiempo constante, rotación por tenant y rutas root separadas; `go test ./...`
  pasa completo.
- [ ] Verificar rate limits, WAF, alertas y revocacion para los endpoints que el
  repositorio publico enumera (`/moodle/*`, `/player/*` y `/events`).
- [ ] Revisar el formato canonico firmado por el HMAC y sus parametros
  opcionales; documentar compatibilidad y evitar concatenaciones ambiguas antes
  de congelar el protocolo publico.
- [x] Publicar un documento de seguridad con canal de reporte, datos que protege
  el plugin, limites conocidos y procedimiento de rotacion de credenciales.
- [ ] Usar un repositorio publico con nombre convencional, por ejemplo
  `moodle-filter_impronta`.
- [ ] Habilitar un tracker publico para errores y solicitudes.
- [ ] Publicar documentacion accesible y enlazarla desde el Marketplace.
- [x] Preparar descripcion corta y descripcion completa en ingles.
- [ ] Preparar capturas del reproductor, configuracion y funcionamiento en la
  Moodle App.
- [ ] Preparar credenciales demo limitadas para que el equipo de revision pueda
  probar reproduccion, renovacion, analitica y marca de agua.
- [x] Documentar que el backend SaaS no se incluye en el plugin y que datos se
  procesan fuera del Moodle del cliente.
- [x] Decidir que traducciones se incluyen en el ZIP y cuales se gestionaran a
  traves de AMOS/Marketplace. El ZIP incluye ingles y espanol; las traducciones
  adicionales se gestionaran mediante AMOS/Marketplace.
- [x] Crear un proceso de empaquetado reproducible que genere solo el directorio
  `impronta/` e incluya exclusivamente los ficheros publicables.
- [x] Excluir del ZIP scripts de despliegue, metadatos Git, pruebas no necesarias
  y cualquier artefacto interno.

## Release inicial

- [ ] Observar durante una semana la version `2026092200` desplegada: errores
  PHP, renovacion de tokens, reintentos de heartbeat, reproduccion y analitica.
- [ ] Confirmar que no aparecen duplicados de facturacion ni perdida de segundos
  tras los reintentos idempotentes.
- [ ] Revisar los costes y errores del backend despues de la semana de trafico.
- [x] Resolver los bloqueantes previos y repetir el smoke test completo.
- [ ] Elegir version y nombre de release publica (`1.0.0` si se considera
  estable), actualizar `version.php` y redactar las notas de lanzamiento.
- [ ] Crear tag Git y ZIP desde ese mismo tag.
- [ ] Enviar el ZIP a Moodle Marketplace y conservar las violaciones devueltas
  por los prechecks como tareas de este documento.

## Enlaces oficiales

- Privacy API: https://moodledev.io/docs/4.5/apis/subsystems/privacy
- Plugin contribution checklist:
  https://moodledev.io/general/community/plugincontribution/checklist
- Third-party libraries:
  https://moodledev.io/general/community/plugincontribution/thirdpartylibraries
- Moodle Marketplace API:
  https://moodledev.io/general/community/plugincontribution/moodlemarketplaceapi
