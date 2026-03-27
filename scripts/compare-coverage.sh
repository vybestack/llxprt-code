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
    if (total === 0) { console.error('No matching coverage entries found for ' + '${metric}'); process.exit(1); }
    console.log(((covered / total) * 100).toFixed(2));
  "
}

overall_pass=true

for metric in lines branches; do
  baseline_val=$(extract "${BASELINE}" "${metric}")
  current_val=$(extract "${CURRENT}" "${metric}")
  drop=$(node -e "console.log((${baseline_val} - ${current_val}).toFixed(2))")
  if (( $(echo "${drop} > ${TOLERANCE}" | bc -l) )); then
    echo "FAIL: ${metric} coverage dropped by ${drop}pp (${baseline_val}% -> ${current_val}%)"
    overall_pass=false
  else
    delta=$(node -e "console.log((${current_val} - ${baseline_val}).toFixed(2))")
    sign=""
    if (( $(echo "${delta} > 0" | bc -l) )); then sign="+"; fi
    echo "OK: ${metric} coverage ${current_val}% (baseline: ${baseline_val}%, delta: ${sign}${delta}pp)"
  fi
done

if [[ "${overall_pass}" = "false" ]]; then
  exit 1
fi
