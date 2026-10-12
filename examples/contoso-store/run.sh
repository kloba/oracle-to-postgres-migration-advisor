#!/usr/bin/env bash
# Reproduces the Contoso Store assessment end to end: source scan, calibration against the lab's own
# conversion run, ground-truth recall, and the PDF report.
#
#   examples/contoso-store/run.sh                       clones the lab into ./.cache
#   O2P_LAB=/path/to/lab examples/contoso-store/run.sh  uses a checkout you already have
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
cache="${O2P_CACHE:-$root/.cache}"
lab="${O2P_LAB:-$cache/oracle-to-postgres-migration-lab}"
out="$here/output"
mkdir -p "$out" "$cache"

if [ ! -d "$lab/src/oracle" ]; then
  git clone --depth 1 https://github.com/kloba/oracle-to-postgres-migration-lab.git "$lab"
fi

# The lab builds 792 of its 1,185 objects with a seeded generator. Same seed, same objects.
python3 "$lab/tools/generate-objects.py" --out "$cache/lab-generated" --quiet

node "$root/tools/assess/oracle-assess.mjs" "$lab/src/oracle" "$cache/lab-generated/oracle" \
  --name "Contoso Store" --schema CONTOSO --out "$out/assessment.json" --summary

node "$root/tools/calibrate/join-conversion.mjs" "$out/assessment.json" \
  "$lab/docs/conversion-report/object_mapping_summary.csv" --out "$out/calibration.json" > /dev/null
node "$root/tools/calibrate/hard-case-recall.mjs" "$out/assessment.json" \
  "$lab/docs/design.md" --out "$out/recall.json" > /dev/null

node "$root/tools/report/build-report.mjs" --assessment "$out/assessment.json" \
  --profile "$here/profile.json" --calibration "$out/calibration.json" --recall "$out/recall.json" \
  --title "Contoso Store" --out "$out/contoso-store-assessment.pdf"
