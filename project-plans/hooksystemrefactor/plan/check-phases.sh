#!/usr/bin/env bash
# shellcheck disable=SC2250,SC2292
for P in P03 P04 P05 P06 P07 P08 P09 P10 P11 P12 P13 P14 P15; do
  COUNT=$(grep -rl "PLAN-20250218-HOOKSYSTEM\.${P}" packages/core/src/hooks/ --include="*.ts" 2>/dev/null | wc -l | tr -d ' ')
  echo "${P}: ${COUNT} files"
done

echo ""
echo "--- TODO/FIXME/HACK check (production only) ---"
grep -rn "TODO\|FIXME\|HACK\|STUB\|XXX" packages/core/src/hooks/ --include="*.ts" | grep -v "\.test\.ts" | grep -v "\.md" || echo "(none)"

echo ""
echo "--- DELTA-HRUN coverage ---"
for req in DELTA-HRUN-001 DELTA-HRUN-002 DELTA-HRUN-003 DELTA-HRUN-004; do
  COUNT=$(grep -rl "${req}" packages/core/src/hooks/ --include="*.ts" 2>/dev/null | wc -l | tr -d ' ')
  echo "${req}: ${COUNT} files"
done

echo ""
echo "--- DELTA-HTEL coverage ---"
for req in DELTA-HTEL-001 DELTA-HTEL-002 DELTA-HTEL-003; do
  COUNT=$(grep -rl "${req}" packages/core/src/hooks/ --include="*.ts" 2>/dev/null | wc -l | tr -d ' ')
  echo "${req}: ${COUNT} files"
done
