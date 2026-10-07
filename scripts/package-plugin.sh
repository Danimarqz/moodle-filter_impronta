#!/usr/bin/env bash
#
# Build the ZIP that gets uploaded to the Moodle Marketplace.
#
# The Moodle validator requires a single top-level folder named exactly like the
# plugin, laid out so it can be unzipped straight into <moodleroot>/filter/. The
# archive must contain only what an administrator needs to install and run the
# plugin: no .git metadata, no CI config, no test-only tooling, no internal
# documentation (MARKETPLACE.md carries production incident notes and must never
# ship).
#
# Usage:
#   scripts/package-plugin.sh              # writes build/filter_impronta.zip
#   scripts/package-plugin.sh /tmp/out.zip # custom destination

set -euo pipefail

PLUGIN_NAME="impronta"            # the folder inside the ZIP (filter/impronta)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-${REPO_ROOT}/build/filter_impronta.zip}"

# Everything here is packaged. The list is explicit on purpose: a new top-level
# file is a deliberate decision, not something that silently ships.
FILES=(
    LICENSE
    README.md
    version.php
    settings.php
    thirdpartylibs.xml
    batch.php
    embed.php
    events.php
    heartbeat.php
    playlist.php
    quien.php
    realtime.php
    register.php
    renew.php
    scorm.php
    watermark.js
)
DIRS=(
    classes
    db
    js
    lang
    vendor
)

cd "${REPO_ROOT}"

for f in "${FILES[@]}"; do
    [ -f "${f}" ] || { echo "missing packaged file: ${f}" >&2; exit 1; }
done
for d in "${DIRS[@]}"; do
    [ -d "${d}" ] || { echo "missing packaged directory: ${d}" >&2; exit 1; }
done

# lang/ must ship English only: Moodle distributes every other language through
# AMOS once the plugin is approved.
if [ -d lang ] && [ "$(ls -1 lang)" != "en" ]; then
    echo "lang/ must contain only 'en' (found: $(ls -1 lang | tr '\n' ' '))" >&2
    exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT

DEST="${STAGE}/${PLUGIN_NAME}"
mkdir -p "${DEST}"

for f in "${FILES[@]}"; do
    cp -p "${f}" "${DEST}/${f}"
done
for d in "${DIRS[@]}"; do
    cp -Rp "${d}" "${DEST}/${d}"
done

# Defensive: strip anything that must never leave this repository even if it
# appears nested inside a packaged directory.
find "${DEST}" \
    \( -name '.git' -o -name '.github' -o -name 'node_modules' \
       -o -name '*.zip' -o -name '.DS_Store' -o -name '*.log' \) \
    -prune -exec rm -rf {} +

mkdir -p "$(dirname "${OUT}")"
rm -f "${OUT}"

# -X drops extra file attributes so two builds of the same tree produce the
# same archive layout.
( cd "${STAGE}" && zip -rqX "${OUT}" "${PLUGIN_NAME}" )

echo "Built ${OUT}"
echo "Contents:"
unzip -l "${OUT}" | tail -n +4 | head -n -2 | awk '{print "  " $4}' | head -20
echo "  ..."
echo "Total entries: $(unzip -l "${OUT}" | tail -1 | awk '{print $2}')"
