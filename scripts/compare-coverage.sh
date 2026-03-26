#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/compare-coverage.sh <baseline.json> <current.json>
# Both files are vitest coverage-summary.json format.
# Exit 0 if within tolerance, exit 1 if regression detected.

BASELINE="${1:?Usage: compare-coverage.sh <baseline.json> <current.json>}"
CURRENT="${2:?Usage: compare-coverage.sh <baseline.json> <current.json>}"
TOLERANCE=1  # percentage points

extract() {
  local file="$1" metric="$2"
  if [[ ! -f "${file}" ]]; then echo "ERROR: Coverage file not found: ${file}" >&2; exit 1; fi
  node --input-type=module -e "
    import { readFileSync } from 'node:fs';
    const data = JSON.parse(readFileSync('${file}', 'utf-8'));
    const TARGET_BASENAMES = ['subagent.ts','subagentTypes.ts','subagentRuntimeSetup.ts','subagentToolProcessing.ts','subagentExecution.ts'];
    const files = Object.keys(data).filter(f => TARGET_BASENAMES.some(t => f.endsWith('/core/' + t)));
    let covered = 0, total = 0;
    for (const f of files) {
      covered += data[f]['${metric}'].covered;
      total += data[f]['${metric}'].total;
    }
    console.log(total === 0 ? 100 : ((covered / total) * 100).toFixed(2));
  "
}

overall_pass=true

for metric in lines branches; do
  baseline_val=$(extract "${BASELINE}" "${metric}")
  current_val=$(extract "${CURRENT}" "${metric}")
  diff=$(node -e "console.log((${baseline_val} - ${current_val}).toFixed(2))")
  if (( $(echo "${diff} > ${TOLERANCE}" | bc -l) )); then
    echo "FAIL: ${metric} coverage dropped by ${diff}pp (${baseline_val}% -> ${current_val}%)"
    overall_pass=false
  else
    echo "OK: ${metric} coverage ${current_val}% (baseline: ${baseline_val}%, delta: -${diff}pp)"
  fi
done

if [[ "${overall_pass}" = "false" ]]; then
  exit 1
fi
