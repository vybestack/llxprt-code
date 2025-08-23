# Plan: Gemini OAuth Fallback

Plan ID: PLAN-20250822-GEMINIFALLBACK
Generated: 2025-08-22
Total Phases: 16
Requirements: REQ-001

# Phase 05a: Clipboard Functionality TDD Verification

## Phase ID

`PLAN-20250822-GEMINIFALLBACK.P05A`

## Prerequisites

- Required: Phase 05 completed
- Verification: `grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P05" .`

## Verification Commands

```bash
# Check plan markers exist
PLAN_MARKERS=$(grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P05" . | wc -l)
if [ "$PLAN_MARKERS" -lt 7 ]; then
  echo "FAIL: Expected 7+ plan markers, found $PLAN_MARKERS"
  exit 1
fi

# Check requirements covered
REQ_MARKERS=$(grep -r "@requirement:REQ-001" packages/core/src/services/ClipboardService.test.ts | wc -l)
if [ "$REQ_MARKERS" -lt 3 ]; then
  echo "FAIL: Expected 3+ requirement markers, found $REQ_MARKERS"
  exit 1
fi

# Verify behavioral assertions
BEHAVIORAL_ASSERTIONS=$(grep -r "toBe\|toEqual\|toMatch\|toContain" packages/core/src/services/ClipboardService.test.ts | wc -l)
if [ "$BEHAVIORAL_ASSERTIONS" -lt 10 ]; then
  echo "FAIL: Expected 10+ behavioral assertions, found $BEHAVIORAL_ASSERTIONS"
  exit 1
fi

# Check for structure-only testing (should only be tests with specific value assertions)
STRUCTURE_ONLY=$(grep -r "toHaveProperty\|toBeDefined\|toBeUndefined" packages/core/src/services/ClipboardService.test.ts | grep -v "with specific value" | wc -l)
if [ "$STRUCTURE_ONLY" -gt 0 ]; then
  echo "FAIL: Found structure-only tests without specific value assertions"
  exit 1
fi

# Check for reverse testing patterns
REVERSE_TESTS=$(grep -r "toThrow('NotYetImplemented')\|expect.*not\.toThrow()" packages/core/src/services/ClipboardService.test.ts | wc -l)
if [ "$REVERSE_TESTS" -gt 0 ]; then
  echo "FAIL: Found reverse testing patterns"
  exit 1
fi

# Check for mock theater
MOCK_THEATER=$(grep -r "toHaveBeenCalled\|toHaveBeenCalledWith" packages/core/src/services/ClipboardService.test.ts | wc -l)
if [ "$MOCK_THEATER" -gt 0 ]; then
  echo "FAIL: Found mock theater patterns"
  exit 1
fi

echo "clipboard-tdd-verification completed successfully"
```

## Success Criteria

- All verification commands pass
- Tests are behavioral and follow TDD principles
- All required markers are present
- No reverse testing patterns
- No mock theater