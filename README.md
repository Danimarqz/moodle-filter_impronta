# Impronta filter for Moodle

Impronta protects Moodle video playback with short-lived signed links,
learner-specific watermarks and playback analytics. The plugin is a connector:
the Impronta SaaS backend and media storage are not included in this package.

- **Documentation**: https://impronta.video/docs/moodle
- **Bug tracker and feature requests**: https://github.com/Danimarqz/moodle-filter_impronta/issues
- **Source code**: https://github.com/Danimarqz/moodle-filter_impronta

## Requirements

- Moodle 4.5 (LTS), 5.1 or 5.2.
- A Moodle administrator account with permission to configure filters.
- An active Impronta subscription and tenant credentials.
- Outbound HTTPS access from Moodle to `https://app.impronta.video`.

## Installation

1. Download the plugin ZIP and install it from **Site administration >
   Plugins > Install plugins**, selecting **Filter** as the plugin type.
2. Complete Moodle's upgrade step.
3. Open **Site administration > Plugins > Filters > Impronta** and enable the
   filter where it should process course content.
4. Enter the tenant API key and generate a long random local signing secret.
5. Save the settings, then use **Register this Moodle site**. Registration
   associates the Moodle origin with the tenant so shared embeds can be
   restricted to this site.

The plugin ZIP contains prebuilt browser assets. Installation does not require
shell access, Node.js or PHP Composer.

## Subscription and credentials

Impronta is a paid external service. Start at https://impronta.video/precios
and use the contact/support process provided there to obtain a tenant and API
key before installing the plugin. Treat the API key as a server secret. The
local signing secret is generated and stored by the Moodle administrator; it is
not an Impronta credential and must never be shared with learners.

The integration keeps the tenant API key server-side and gives the browser
only signed, time-limited playback URLs. If the Impronta console supports key
rotation, rotate the API key there and update Moodle if exposure is suspected.
Rotate the local signing secret only during planned maintenance because
existing Moodle-generated links will stop validating.

## Configuration

- **Watermark template**: Moodle user fields between braces, for example
  `{fullname} - {idnumber}`. Custom fields use `{profile_field_dni}`.
- **Watermark colour**: colour of the learner-specific overlay.
- **Require course enrolment**: keep enabled unless videos are intentionally
  available outside a course context.
- **Bind tokens to IP**: optional browser-token binding. Leave disabled when
  learners commonly change networks; mobile app tokens are not IP-bound.
- **Internal token TTL**: keep the default unless Impronta support gives a
  reason to change it. It must outlive the media signature used for recovery.
- **In-app player (user ids)**: leave empty for all app users, or provide a
  comma-separated list to restrict the in-app player while testing a mobile
  rollout.

## How playback works

The filter recognises Impronta video references and asks the backend for a
signed playlist. Moodle validates enrolment and the local token before proxy
requests reach Impronta. Heartbeats and analytics are relayed server to server so
the tenant API key stays out of the browser. The plugin declares the personal
data sent to the external service through Moodle's Privacy API.

Analytics use two pipelines during the current rollout:

- **Legacy (deployed in production).** The player keeps a queue and POSTs it to
  `events.php`, which relays server to server. Six 15-second heartbeats are
  folded into one 90-second interval POST; `pause`, `ended`, hidden tab,
  `pagehide`, `dispose` and `tamper` force an immediate send with their reason.
  The last accepted event of a batch carries `playbackId`, `sessionId` and
  `flushReason`, which is how the backend correlates a flush with a playback.
- **V2 (batched pipeline, under validation).** Deltas accumulate locally and
  flush to `batch.php` per reason, with a stable batch identifier so a retry
  after a lost acknowledgement is deduplicated instead of double-counted. V2
  writes to a separate storage prefix so the Legacy aggregates stay comparable.

`WSS` presence diagnostics belong to V2. They never write the analytics store,
and connection problems never affect playback.

V2 is served by the Impronta backend. Both routes behind it are live in
production: posting to `/analytics/batch` and `/player/realtime` without
credentials returns `401`, not `404`, while an unknown route returns `404`.

## Uninstallation

Disable the filter first, remove Impronta video references from courses, then
uninstall it from **Site administration > Plugins > Plugins overview**. The
plugin does not own the media stored by Impronta. Follow your organisation's
retention and deletion process for data already sent to the SaaS service.

## Troubleshooting

- **Service denied**: check the API key, tenant status and that the Moodle
  origin was registered after saving both credentials.
- **Links expire immediately**: verify the server clock and keep token TTL
  above the media-signature lifetime.
- **Learner cannot play a course video**: confirm enrolment and the
  **Require course enrolment** setting.
- **Watermark is blank or wrong**: check the template field names and the
  learner's profile values; empty fields render as empty text.
- **Mobile playback fails**: keep the mobile user allow-list restricted to the
  single test user's Moodle ID, confirm the app can reach the site, then widen
  it deliberately. Do not clear the list during a live diagnosis: empty means
  every Moodle app user.

## Privacy and security

The plugin can send a pseudonymous learner subject, IP address, video/context
identifiers, playback session identifiers and analytics to Impronta. Depending
on the configured watermark template, the transmitted watermark can directly
include the learner's name, email, username, ID number, location,
institution, department, phone numbers or custom profile fields. See Moodle's
Privacy API report for the complete field list and purposes. Never publish API
keys, local signing secrets or Moodle configuration exports.

## License

The plugin is licensed under the GNU GPL v3 or later; see `LICENSE`. The
bundled Video.js files retain their Apache License 2.0 notices; see
`thirdpartylibs.xml` and
`vendor/video.js/readme_moodle.txt`.
