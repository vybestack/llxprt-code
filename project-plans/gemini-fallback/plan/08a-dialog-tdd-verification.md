# Plan: Gemini OAuth Fallback

Plan ID: PLAN-20250822-GEMINIFALLBACK
Generated: 2025-08-22
Total Phases: 16
Requirements: REQ-002, REQ-006

# Phase 08a: OAuth Code Dialog TDD Verification

## Phase ID

`PLAN-20250822-GEMINIFALLBACK.P08A`

## Prerequisites

- Required: Phase 08 completed
- Verification: `grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P08" .`

## Verification Commands

```bash
# Check plan markers exist
PLAN_MARKERS=$(grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P08" . | wc -l)
if [ "$PLAN_MARKERS" -lt 7 ]; then
  echo "FAIL: Expected 7+ plan markers, found $PLAN_MARKERS"
  exit 1
fi

# Check requirements covered
REQ_MARKERS=$(grep -r "@requirement:REQ-002\|@requirement:REQ-006" packages/cli/src/ui/components/OAuthCodeDialog.test.tsx | wc -l)
if [ "$REQ_MARKERS" -lt 5 ]; then
  echo "FAIL: Expected 5+ requirement markers, found $REQ_MARKERS"
  exit 1
fi

# Verify behavioral assertions
BEHAVIORAL_ASSERTIONS=$(grep -r "toBe\|toEqual\|toMatch\|toContain" packages/cli/src/ui/components/OAuthCodeDialog.test.tsx | wc -l)
if [ "$BEHAVIORAL_ASSERTIONS" -lt 10 ]; then
  echo "FAIL: Expected 10+ behavioral assertions, found $BEHAVIORAL_ASSERTIONS"
  exit 1
fi

# Check for structure-only testing (should only be tests with specific value assertions)
STRUCTURE_ONLY=$(grep -r "toHaveProperty\|toBeDefined\|toBeUndefined" packages/cli/src/ui/components/OAuthCodeDialog.test.tsx | grep -v "with specific value" | wc -l)
if [ "$STRUCTURE_ONLY" -gt 0 ]; then
  echo "FAIL: Found structure-only tests without specific value assertions"
  exit 1
fi

# Check for reverse testing patterns
REVERSE_TESTS=$(grep -r "toThrow('NotYetImplemented')\|expect.*not\.toThrow()" packages/cli/src/ui/components/OAuthCodeDialog.test.tsx | wc -l)
if [ "$REVERSE_TESTS" -gt 0 ]; then
  echo "FAIL: Found reverse testing patterns"
  exit 1
fi

# Check for mock theater
MOCK_THEATER=$(grep -r "toHaveBeenCalled\|toHaveBeenCalledWith" packages/cli/src/ui/components/OAuthCodeDialog.test.tsx | wc -l)
if [ "$MOCK_THEATER" -gt 0 ]; then
  echo "FAIL: Found mock theater patterns"
  exit 1
fi

echo "dialog-tdd-verification completed successfully"
```

## Success Criteria

- All verification commands pass
- Tests are behavioral and follow TDD principles
- All required markers are present
- No reverse testing patterns
- No mock theater