# Plan: Gemini OAuth Fallback

Plan ID: PLAN-20250822-GEMINIFALLBACK
Generated: 2025-08-22
Total Phases: 16
Requirements: REQ-004

# Phase 15a: Integration Implementation Verification

## Phase ID

`PLAN-20250822-GEMINIFALLBACK.P15A`

## Prerequisites

- Required: Phase 15 completed
- Verification: `grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P15" .`

## Verification Commands

```bash
# Check plan markers exist
PLAN_MARKERS=$(grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P15" . | wc -l)
if [ "$PLAN_MARKERS" -lt 3 ]; then
  echo "FAIL: Expected 3+ plan markers, found $PLAN_MARKERS"
  exit 1
fi

# Check requirements covered
REQ_MARKERS=$(grep -r "@requirement:REQ-004" . | wc -l)
if [ "$REQ_MARKERS" -lt 2 ]; then
  echo "FAIL: Expected 2+ requirement markers, found $REQ_MARKERS"
  exit 1
fi

# All tests pass
npm test -- packages/core/src/code_assist/oauth2.test.ts packages/cli/src/ui/App.test.tsx
if [ $? -ne 0 ]; then
  echo "FAIL: Integration tests failed"
  exit 1
fi

# No test modifications
git diff test/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified" && exit 1

# Verify pseudocode was followed
# Checking implementation against lines 5-26 in analysis/pseudocode/oauth-flow.md

# No debug code
grep -r "console\.\|TODO\|FIXME\|XXX" packages/core/src/code_assist/oauth2.ts packages/cli/src/ui/App.tsx && echo "FAIL: Debug code found" && exit 1

# No duplicate files
find packages/core/src/code_assist packages/cli/src/ui -name "*V2*" -o -name "*Copy*" && echo "FAIL: Duplicate versions found" && exit 1

# Run mutation testing
npx stryker run --mutate "packages/core/src/code_assist/oauth2.ts,packages/cli/src/ui/App.tsx"
MUTATION_SCORE=$(jq -r '.metrics.mutationScore' .stryker-tmp/reports/mutation-report.json)
if (( $(echo "$MUTATION_SCORE < 80" | bc -l) )); then
  echo "FAIL: Mutation score only $MUTATION_SCORE% (minimum 80%)"
  exit 1
fi

echo "integration-implementation-verification completed successfully"
```

## Success Criteria

- All verification commands pass
- Implementation follows pseudocode exactly
- No test modifications during implementation
- No debug code or TODO comments
- No duplicate versions created
- Mutation testing score >= 80%