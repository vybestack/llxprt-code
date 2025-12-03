# Phase 07a: Stream Integration TDD Verification

## Phase ID

`PLAN-20251202-THINKING-UI.P07a`

## Prerequisites

- Required: Phase 07 completed
- Verification: `ls packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx`

---

## Structural Verification

### File Existence

```bash
test -f packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx && echo "PASS" || echo "FAIL"
```

### Plan Markers (Colon Syntax)

```bash
grep "@plan:PLAN-20251202-THINKING-UI.P07" packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx && echo "PASS" || echo "FAIL"
```

### Requirement Coverage

```bash
# REQ-THINK-UI-001 tests (type recognition)
grep -c "@requirement:REQ-THINK-UI-001" packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx
# Expected: 2+

# REQ-THINK-UI-003 tests (settings control)
grep -c "@requirement:REQ-THINK-UI-003" packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx
# Expected: 2+
```

---

## Anti-Fraud Verification

### Reverse Testing Detection

```bash
# Check for reverse testing (tests expecting NotYetImplemented)
grep -E "expect.*NotYetImplemented|toThrow.*NotYetImplemented" packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx
# Expected: No matches
```

### Structure-Only Testing

```bash
# Check for structure-only tests
grep -E "toBeDefined\(\)|toBeUndefined\(\)" packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx
# Expected: Minimal - tests should verify actual behavior
```

---

## Test Count Verification

```bash
# Count tests
grep -c "it\('" packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx
# Expected: 5+
```

---

## Holistic Functionality Assessment

### What tests were written?

[List the test cases and what behavior they validate]

### Do tests validate BEHAVIOR, not just structure?

- [ ] Tests verify ThinkingBlocks are accumulated from Thought events
- [ ] Tests verify blocks are included in HistoryItemGemini
- [ ] Tests verify settings control inclusion
- [ ] Tests verify ThinkingBlock structure

### Test Categories

1. **Thought Event Capture (REQ-THINK-UI-001)**:
   - [ ] Single thought event captured
   - [ ] Multiple thought events accumulated
   - [ ] ThinkingBlock structure correct

2. **Settings Control (REQ-THINK-UI-003)**:
   - [ ] Blocks included when setting is true
   - [ ] Blocks excluded when setting is false
   - [ ] Default behavior tested

3. **Edge Cases**:
   - [ ] Thought-only responses (no content)
   - [ ] Empty thought values
   - [ ] Mixed thought and content events

### Will these tests FAIL with current implementation?

```bash
# Run tests - they SHOULD fail
npm test -- packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx --run 2>&1 | tail -20
# Expected: Tests fail because useGeminiStream doesn't accumulate thinkingBlocks yet
```

### Verdict

[PASS/FAIL with explanation - tests validate behavior and will fail until implementation]

---

## Verification Checklist

- [ ] Test file exists
- [ ] Contains @plan:PLAN-20251202-THINKING-UI.P07 marker (colon syntax)
- [ ] Contains @requirement:REQ-THINK-UI-001 markers
- [ ] Contains @requirement:REQ-THINK-UI-003 markers
- [ ] 5+ tests written
- [ ] NO reverse testing
- [ ] Tests verify actual behavior
- [ ] Tests cover Thought event capture
- [ ] Tests cover settings control
- [ ] Tests FAIL with current implementation (TDD)
- [ ] Holistic assessment completed

---

## Phase Completion Criteria

All checkboxes must be checked to proceed to Phase 08.

If ANY fail:
1. Return to Phase 07
2. Fix the tests
3. Re-run verification
