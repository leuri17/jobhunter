#!/usr/bin/env bash
# Run cargo audit and gate on real risk, not noise.
#
# Every RUSTSEC id listed below is transitive through tauri 2.11.5 (the
# latest 2.x). Tauri 3.x has the gtk4-rs migration that resolves most of
# these. Until then, we ignore them at the cargo-audit level and rely
# on the gate below to catch any NEW advisory that lands in a dep we
# do control.
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

JSON=$(cargo audit --json \
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
  2>/dev/null) || true

echo "$JSON" | python3 -c "
import json, sys
data = json.loads(sys.stdin.read())
vulns = data.get('vulnerabilities', {}).get('list', [])
warnings = data.get('warnings', {})
unsound = warnings.get('unsound', [])
unmaintained = warnings.get('unmaintained', [])

if unmaintained:
    print(f'::notice::cargo-audit: {len(unmaintained)} unmaintained advisory(ies) (informational, not gated):', file=sys.stderr)
    for w in unmaintained:
        print(f'  - {w[\"advisory\"][\"id\"]}: {w[\"advisory\"][\"summary\"]}', file=sys.stderr)

if vulns or unsound:
    if vulns:
        print(f'::error::cargo-audit: {len(vulns)} vulnerability(ies):', file=sys.stderr)
        for v in vulns:
            print(f'  - {v[\"advisory\"][\"id\"]}: {v[\"advisory\"][\"summary\"]}', file=sys.stderr)
    if unsound:
        print(f'::error::cargo-audit: {len(unsound)} unsound advisory(ies):', file=sys.stderr)
        for u in unsound:
            print(f'  - {u[\"advisory\"][\"id\"]}: {u[\"advisory\"][\"summary\"]}', file=sys.stderr)
    sys.exit(1)

print('cargo-audit: 0 vulnerabilities, 0 unsound warnings.')
"
