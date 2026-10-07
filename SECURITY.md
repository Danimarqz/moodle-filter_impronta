# Security and reporting

## Reporting a vulnerability

Report suspected vulnerabilities privately through GitHub's security advisory
form on this repository:

  https://github.com/Danimarqz/moodle-filter_impronta/security/advisories/new

Please do not open a public issue for a security problem. Include the affected
version (`version.php` release string), a description, and a reproduction if you
have one. We aim to acknowledge within five working days.

There is no bug bounty.

## What the plugin protects

**The tenant API key never reaches a browser or a device.** That key mints CDN
signatures for the tenant's whole catalog, so a leak would let any learner pull
any video. Every request that needs the key is relayed server-side through the
plugin's own endpoints. The browser receives only signed, time-limited URLs
scoped to one video.

**Short-lived signed URLs.** Playback URLs are signed by Moodle with the local
signing secret, which never leaves the Moodle server. A leaked URL grants access
to one video for the remainder of its TTL, not to the catalog.

**Enrolment is re-checked server-side on every relay request**, not just when
the player is rendered. Revoking a learner's access takes effect at the next
request rather than when a signed URL finally expires.

**Per-learner watermark.** The overlay identifies who is watching, which makes a
screen recording attributable. Tamper attempts — removing or hiding the overlay —
are counted and reported with the analytics batch.

**Input handling.** Endpoints read parameters through Moodle's `required_param()`
and `optional_param()` with explicit types, never from superglobals directly.
The plugin defines no database tables, so there is no SQL surface. Actions that
change state check a session key (`require_sesskey()`) and an admin capability.

## Known limitations

**Signed URLs cannot be revoked once issued.** This is a property of the CDN
signature, not of the plugin. It is why signatures are short-lived and why the
relay re-checks enrolment on each request rather than trusting a long-lived
signature.

**Screen recording by an authorised learner is detectable but not preventable.**
The watermark makes the recording attributable. It cannot stop a determined
learner from recording their own screen.

**The plugin does not own or control the media store.** Retention, deletion and
access to already-delivered analytics are governed by the customer's agreement
with Impronta.

**The plugin is not a DRM system.** It raises the cost of casual sharing. It does
not defeat a determined attacker with elevated privileges, and it does not claim
to.

**A leaked API key exposes the tenant's catalog** until rotated. Rotation is
immediate from the Impronta console; existing playback breaks until the new key
is saved in Moodle.

## Credential rotation

- **Tenant API key** (Impronta console, tenant detail): rotate if exposure is
  suspected. Update it in the plugin settings immediately afterwards.
- **Local signing secret** (Moodle plugin settings): rotating it invalidates
  every Moodle-generated link currently in flight and logs out no one. Do it
  during planned maintenance and expect in-progress playbacks to need a reload.

## Scope

In scope: the plugin source in this repository, its browser assets, and the
signed-relay endpoints it exposes under `/filter/impronta/`.

Out of scope: the Impronta service itself, the CDN, the Moodle core, and any
third-party library bundled here (Video.js — report those upstream, though we
will still ship an update).
