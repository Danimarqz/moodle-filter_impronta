# Impronta for Moodle

Impronta protects Moodle video playback. This plugin is the Moodle-side
connector: it signs playback requests, resolves the learner watermark and
relays analytics. The Impronta service itself (media storage, CDN, transcoding,
the tenant console) is a separate paid product and is not part of this package.

- **Get an Impronta tenant**: https://impronta.video/precios
- **Plugin source code**: https://github.com/Danimarqz/moodle-filter_impronta
- **Bug tracker**: https://github.com/Danimarqz/moodle-filter_impronta/issues

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [How playback works](#how-playback-works)
- [Privacy and data](#privacy-and-data)
- [Troubleshooting](#troubleshooting)
- [Uninstallation](#uninstallation)

## Requirements

| Requirement | Detail |
| --- | --- |
| Moodle | 4.5 (LTS), 5.1 or 5.2 |
| PHP | As required by the Moodle branch above |
| Impronta tenant | Active subscription plus an API key |
| Network | Outbound HTTPS from the Moodle server to `https://app.impronta.video` |
| Shell access | **Not required** — the ZIP ships prebuilt browser assets |

The plugin needs no Composer, Node.js or build step. Install it from the
administration UI like any other contributed plugin.

## Installation

1. Download the release ZIP from the Marketplace (or from the repository's
   releases page).
2. **Site administration > Plugins > Install plugins**, choosing **Filter** as
   the plugin type, and upload the ZIP.
3. Complete the upgrade step Moodle offers.
4. Open **Site administration > Plugins > Filters > Impronta** and enable the
   filter for the contexts where it should process content.
5. Enter the tenant **API key** and generate a long random **local signing
   secret**, then save.
6. Use **Register this Moodle site** to associate the Moodle origin with the
   tenant. Shared embeds can then be restricted to this site.

If step 6 fails, the API key is wrong, the tenant is inactive, or the server
cannot reach `app.impronta.video`.

## Configuration

| Setting | Notes |
| --- | --- |
| **Impronta API key** | From the Impronta root console, tenant detail. Treat as a server secret; it can be rotated there. |
| **Local signing secret** | Generated and stored by you. It signs internal links between the filter and the playlist/embed endpoints and never leaves your server. |
| **Watermark template** | Moodle user fields in braces, e.g. `{fullname} - {idnumber}`. Custom profile fields use `{profile_field_dni}`. |
| **Watermark colour** | Colour of the per-learner overlay. |
| **Require course enrolment** | Leave enabled unless videos are deliberately available outside a course. |
| **Bind tokens to IP** | Optional. Leave disabled if learners change networks often; Moodle App tokens are never IP-bound. |
| **Internal token TTL** | Keep the default unless Impronta support asks otherwise. It must outlive the media signature used for recovery. |
| **In-app player (user ids)** | Empty means all app users. A comma-separated list restricts the in-app player, useful during a pilot. |

### Rotating credentials

- **API key**: rotate it in the Impronta console and paste the new value here.
  Existing playback breaks until you do.
- **Local signing secret**: rotating it invalidates every Moodle-generated link
  in flight. Do it during planned maintenance only.

## How playback works

1. The filter recognises Impronta video references in course content and
   replaces them with a player that points at a signed `playlist.php` URL.
2. `playlist.php` validates the local token and the learner's enrolment, then
   asks the Impronta backend for a short-lived signed playlist.
3. Segment requests are proxied so the tenant API key stays on the Moodle
   server. The key is never sent to the browser: it also mints CDN signatures
   for the whole catalog, so leaking it would break the access model entirely.
4. The player overlays the learner-specific watermark and reports playback.

### Analytics

Analytics run over two pipelines during the current rollout.

**Legacy, deployed in production.** The player queues events and POSTs them to
`events.php`, which relays them server to server. Six 15-second heartbeats are
folded into one 90-second interval POST; `pause`, `ended`, a hidden tab,
`pagehide`, `dispose` and `tamper` force an immediate send with their reason.
The last accepted event of a batch carries the playback and session identifier
plus the flush reason, which is how a flush is correlated with a playback. This
pipeline records the numbers your dashboard shows today.

**V2, batched, under validation.** Deltas accumulate locally — watched seconds,
maximum and current position, seek count, pause count, buffering time, tamper
count — and flush one batch per reason: `pause`, `ended`, `video_change`,
`checkpoint` (five minutes) and `pagehide` via `sendBeacon`. Each batch carries a
stable identifier, so a retry after a lost acknowledgement is deduplicated
instead of double-counted. A failed batch stays in the outbox and is retried;
playback never pauses because analytics failed. V2 writes to a separate storage
prefix so the Legacy aggregates stay comparable.

WSS is used for presence diagnostics only and never writes the analytics store.
It starts once the playback session identifier is known and stops on `ended` and
on dispose. Connection problems never affect playback.

> **Before relying on V2**, confirm with Impronta support that your tenant has
> the batched analytics route and the WebSocket endpoint enabled. Until the
> backend exposes them, V2 requests fail and only the Legacy pipeline records
> playback.

### The watermark

The watermark is a text overlay rendered per learner, so a recording of the
screen identifies who recorded it. The plugin also counts tamper attempts
(removing the overlay, hiding the player) and reports them with the analytics
batch. The label comes from Moodle user fields, so a template referencing an
empty field renders empty text.

## Privacy and data

The plugin sends data to an external service. What is sent is declared through
Moodle's Privacy API and is visible in
**Site administration > Privacy and policies > Data registry**, under the
external location `impronta`.

Pseudonymous subject, IP address, video and context identifiers, playback
session identifiers and analytics events. Depending on your watermark template,
the transmitted watermark label can include the learner's name, e-mail,
username, ID number, location, institution, department, phone numbers or custom
profile fields.

The plugin stores no personal data inside Moodle: `get_contexts_for_userid()`
and the export/delete methods are intentionally empty because there is nothing
to export or erase locally. Data already delivered to Impronta is governed by
your agreement with Impronta; follow your organisation's retention process for
it.

Never publish API keys, local signing secrets or configuration exports.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| **Service denied** | API key valid, tenant active, and the origin registered *after* saving both credentials. |
| **Links expire immediately** | Server clock is accurate, and the internal token TTL is above the media-signature lifetime. |
| **A learner cannot play a course video** | Their enrolment, and the **Require course enrolment** setting. |
| **Watermark blank or wrong** | Template field names and the learner's profile values. Empty fields render as empty text. |
| **Analytics missing** | Outbound HTTPS from the Moodle server to `app.impronta.video`; then the Impronta backend logs. |
| **Mobile playback fails** | Keep the app allow-list to a single test user's Moodle ID, confirm the app reaches the site, then widen it deliberately. An empty list means *every* app user. |

## Uninstallation

1. Disable the filter.
2. Remove Impronta video references from course content.
3. **Site administration > Plugins > Plugins overview > Uninstall**.

The plugin does not own the media stored by Impronta. Removing the plugin stops
new playback events but does not delete data already sent to the service; handle
that under your own retention policy.

## License

GNU GPL v3 or later — see `LICENSE`.

The bundled Video.js distribution keeps its own Apache License 2.0 notices; see
`thirdpartylibs.xml` and `vendor/video.js/readme_moodle.txt`.
