#!/usr/bin/env bash
# Run cargo audit and gate on real risk, not noise.
#
# Every RUSTSEC id listed below is transitive through tauri 2.11.5 (the
# latest 2.x). Tauri 3.x has the gtk4-rs migration that resolves most of
# these. Until then, we ignore them at the cargo-audit level and rely
# on the gate below to catch any NEW advisory that lands in a dep we
# do control.
#
# The three RUSTSEC-2026-037x ids are the same class, one step removed:
# zvariant/zbus_names/zvariant_derive were absorbed into zbus 6
# (2026-10-16, patched = [] — no version of the old crates is clean),
# and every in-tree consumer still pins zbus 5 (keyring 4.2's
# secret-service store, tauri-plugin-notification 2.7,
# tauri-plugin-single-instance 2.5.4). Remove these three when any of
# those ships a zbus-6-based release.
#
# Gate semantics:
#   - vulnerabilities  -> BLOCK (exit 1)
#   - unsound          -> BLOCK (exit 1)
#   - unmaintained     -> SURFACE (printed to stderr, exit 0)
#   - yanked          -> not enforced; tauri build fails on yanked
#                        indirect deps on its own
#
# When tauri 3.x ships, prune the ignore list: drop every id whose
# crate is no longer in the dep graph (cargo tree -i RUSTSEC-XXXX
# tells you what pulls each in). Keep this list to the minimum.

set -euo pipefail

cd "$(dirname "$0")/../desktop/tauri"

if ! JSON=$(cargo audit --json \
  --ignore RUSTSEC-2024-0413 \
  --ignore RUSTSEC-2024-0416 \
  --ignore RUSTSEC-2024-0412 \
  --ignore RUSTSEC-2024-0418 \
  --ignore RUSTSEC-2024-0411 \
  --ignore RUSTSEC-2024-0417 \
  --ignore RUSTSEC-2024-0414 \
  --ignore RUSTSEC-2024-0415 \
  --ignore RUSTSEC-2024-0420 \
  --ignore RUSTSEC-2024-0419 \
  --ignore RUSTSEC-2024-0370 \
  --ignore RUSTSEC-2025-0081 \
  --ignore RUSTSEC-2025-0075 \
  --ignore RUSTSEC-2025-0080 \
  --ignore RUSTSEC-2025-0100 \
  --ignore RUSTSEC-2025-0098 \
  --ignore RUSTSEC-2024-0429 \
  --ignore RUSTSEC-2026-0370 \
  --ignore RUSTSEC-2026-0371 \
  --ignore RUSTSEC-2026-0372 \
  2>/dev/null); then
  # cargo-audit exits non-zero both when it finds a gated advisory and when
  # it cannot run at all (bad flag, unreadable lockfile, network failure).
  # The previous `|| true` discarded that status, so an audit that never ran
  # produced empty JSON and surfaced as a confusing JSONDecodeError. Fail loudly
  # instead; the gate below still decides on findings from a successful run.
  echo "::error::cargo-audit: cargo audit failed to run (exit non-zero, no parseable JSON)" >&2
  exit 1
fi

echo "$JSON" | python3 -c "
import json, sys

raw = sys.stdin.read()
if not raw.strip():
    print('::error::cargo-audit: cargo audit produced no JSON output (see stderr above)', file=sys.stderr)
    sys.exit(1)

try:
    data = json.loads(raw)
except json.JSONDecodeError as e:
    print(f'::error::cargo-audit: could not parse cargo audit JSON: {e}', file=sys.stderr)
    sys.exit(1)

vulns = data.get('vulnerabilities', {}).get('list', [])
warnings = data.get('warnings', {})
unsound = warnings.get('unsound', [])
unmaintained = warnings.get('unmaintained', [])

# cargo-audit names the human-readable field 'title'. There is no 'summary'
# key in its JSON schema; indexing it raised KeyError and aborted the gate.
def describe(entry):
    advisory = entry.get('advisory', {})
    return f\"{advisory.get('id', '?')}: {advisory.get('title', '(no title)')}\"

if unmaintained:
    print(f'::notice::cargo-audit: {len(unmaintained)} unmaintained advisory(ies) (informational, not gated):', file=sys.stderr)
    for w in unmaintained:
        print(f'  - {describe(w)}', file=sys.stderr)

if vulns or unsound:
    if vulns:
        print(f'::error::cargo-audit: {len(vulns)} vulnerability(ies):', file=sys.stderr)
        for v in vulns:
            print(f'  - {describe(v)}', file=sys.stderr)
    if unsound:
        print(f'::error::cargo-audit: {len(unsound)} unsound advisory(ies):', file=sys.stderr)
        for u in unsound:
            print(f'  - {describe(u)}', file=sys.stderr)
    sys.exit(1)

print('cargo-audit: 0 vulnerabilities, 0 unsound warnings.')
"
