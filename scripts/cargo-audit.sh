#!/usr/bin/env bash
# Run cargo audit with the current set of accepted advisories.
#
# Every RUSTSEC id listed below is transitive through tauri 2.11.5 (the
# latest 2.x). Tauri 3.x has the gtk4-rs migration that resolves most of
# these. Until then, we ignore them at the cargo-audit level and rely on
# the `--deny warnings` gate below to catch any NEW advisory that lands
# in a dep we do control.
#
# When tauri 3.x ships, drop every id whose crate is no longer present in
# the dep graph (cargo tree -i RUSTSEC-2024-XXXX will tell you what pulls
# it in). Keep this list to the minimum.

set -euo pipefail

cd "$(dirname "$0")/../desktop/tauri"

exec cargo audit \
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
  --deny warnings
