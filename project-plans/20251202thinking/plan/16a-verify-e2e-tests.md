# Phase 16a: Verify End-to-End Tests

## Phase ID

`PLAN-20251202-THINKING.P16a`

## Prerequisites

- Required: Phase 16 completed
- Verification: `cat project-plans/20251202thinking/.completed/P16.md`

## Verification Tasks

### 1. E2E Test File Exists

```bash
ls -la packages/core/src/providers/openai/__tests__/OpenAIProvider.e2e.test.ts
```

**Expected**: File exists

### 2. All Test Scenarios Implemented

```bash
grep -E "it\(|test\(" packages/core/src/providers/openai/__tests__/OpenAIProvider.e2e.test.ts | wc -l
```

**Expected**: At least 9 test cases (Scenarios 1-6 plus 3 Scenario 7 tests)

### 3. Scenario Titles Match Plan

```bash
grep -E "it\(|test\(" packages/core/src/providers/openai/__tests__/OpenAIProvider.e2e.test.ts
```

**Expected**: Contains tests for:
- Streaming with reasoning_content
- Non-streaming with reasoning_content
- Round-trip with includeInContext=true
- Round-trip with includeInContext=false
- Graceful handling of non-reasoning model
- Effective token count with stripped reasoning
- Reasoning preserved across tool call boundary
- Reasoning excluded but tool calls preserved
- Multi-turn with reasoning after tool response

### 4. All E2E Tests Pass

```bash
npm test -- --run packages/core/src/providers/openai/__tests__/OpenAIProvider.e2e.test.ts
```

**Expected**: All tests pass

### 5. Full OpenAI Test Suite Passes

```bash
npm test -- --run packages/core/src/providers/openai/
```

**Expected**: All tests pass (E2E + unit + reasoning tests)

### 6. Full Test Suite Passes

```bash
npm run test:ci
```

**Expected**: All tests pass

### 7. TypeScript Compiles

```bash
npm run typecheck
```

**Expected**: No errors

### 8. Lint Passes

```bash
npm run lint
```

**Expected**: No errors or warnings

### 9. Plan Markers Present

```bash
grep "@plan.*THINKING.P16" packages/core/src/providers/openai/__tests__/OpenAIProvider.e2e.test.ts
```

**Expected**: Plan marker present in test file

### 10. Requirement Markers Present

```bash
grep "@requirement" packages/core/src/providers/openai/__tests__/OpenAIProvider.e2e.test.ts
```

**Expected**: Requirement references present

## Semantic Verification

### Behavioral Verification Questions

1. **Does the test actually verify the behavior?**
   - [ ] Streaming test verifies ThinkingBlock comes BEFORE TextBlock
   - [ ] Non-streaming test verifies ThinkingBlock has correct sourceField
   - [ ] Round-trip tests verify reasoning_content presence/absence in built messages
   - [ ] Tool call tests verify reasoning survives tool call boundary

2. **Would the test catch a broken implementation?**
   - [ ] Tests would fail if reasoning_content not parsed
   - [ ] Tests would fail if buildMessagesWithReasoning ignores settings
   - [ ] Tests would fail if tool calls lose reasoning_content

3. **Does the test cover edge cases?**
   - [ ] Empty reasoning_content handled
   - [ ] Missing reasoning_content handled (non-reasoning model)
   - [ ] Multiple ThinkingBlocks in one response
   - [ ] Strip policy 'allButLast' with tool calls

### Integration Check

- [ ] Tests use proper mocking for OpenAI API
- [ ] Tests don't rely on external services
- [ ] Tests are deterministic (no flaky tests)
- [ ] Tests complete in reasonable time (<30s total)

### Flow Verification

- [ ] Parse → Store → Filter → Build → Send flow tested
- [ ] Settings affect behavior at correct stages
- [ ] History transformation preserves non-thinking blocks

## Success Criteria

- All 9+ E2E test scenarios pass
- Complete reasoning flow verified end-to-end
- Non-reasoning models continue to work
- Tool call + reasoning fix (Kimi K2) validated
- Ready for real API testing

## Final Checklist

Before marking complete:

- [ ] All verification commands passed
- [ ] Semantic verification questions answered YES
- [ ] No TODO/FIXME/STUB markers in test file
- [ ] Tests are readable and maintainable
- [ ] Mock data matches real API response format

## Holistic Functionality Assessment (MANDATORY)

Before marking this phase complete, the verifier MUST write a detailed assessment.

### Assessment Template

When creating the completion marker file (`project-plans/20251202thinking/.completed/P16a.md`), include:

```markdown
## Holistic Functionality Assessment

### What was implemented?
[Describe in your own words what the E2E tests actually verify. For example: "Created comprehensive end-to-end test suite that validates the complete reasoning flow from API response parsing through message building and back to API request format. Tests cover both streaming and non-streaming modes, settings variations, and tool call interactions."]

### Does it satisfy the requirements?
For each E2E scenario (1-7), explain WHAT the test verifies and HOW:

- **Scenario 1 (Streaming with reasoning)**: [Cite test name, explain what it asserts - e.g., "Test 'should parse reasoning_content in streaming mode' at line X asserts ThinkingBlock appears before TextBlock"]
- **Scenario 2 (Non-streaming with reasoning)**: [Cite test and assertions]
- **Scenario 3 (Round-trip includeInContext=true)**: [Explain how test verifies reasoning_content in built messages]
- **Scenario 4 (Round-trip includeInContext=false)**: [Explain how test verifies NO reasoning_content]
- **Scenario 5 (Non-reasoning model)**: [Explain graceful degradation test]
- **Scenario 6 (Token count with stripped reasoning)**: [Explain token estimation test]
- **Scenario 7a-c (Tool call boundary tests)**: [Explain how each test verifies reasoning preservation with tools]

### What is the data flow?
Trace one complete E2E test execution:

**Example: Scenario 3 (Round-trip with includeInContext=true):**
1. Test sets up: Mock API response with reasoning_content (line X)
2. First call: generateChat parses response into IContent with ThinkingBlock (verified at line Y)
3. Test extracts: History now contains ThinkingBlock (assertion at line Z)
4. Second call: generateChat with same history, includeInContext=true (line A)
5. Message building: convertToOpenAIMessages adds reasoning_content field (verified via spy/assertion at line B)
6. Assertion: Built message contains reasoning_content matching original (line C)

### What could go wrong?
[Identify what the tests DON'T cover or edge cases that could slip through:
- Do tests verify order of blocks (thinking before text)?
- Do tests verify sourceField metadata is preserved?
- Do tests cover empty reasoning_content?
- Do tests verify mutation safety (original history unchanged)?
- Do tests cover multiple ThinkingBlocks in one response?
- Do tests verify error handling for malformed reasoning_content?
- Are mocks realistic (match actual API response structure)?]

### Verdict
[PASS/FAIL with explanation. If PASS, explain why you're confident the E2E tests provide adequate coverage of the reasoning feature. If FAIL, explain what critical scenarios are missing or what tests are not actually testing the right behavior.]
```

### Verification Gate

**DO NOT create the completion marker until you can answer all assessment questions with specific evidence from the test code.**

The verifier must demonstrate they:
1. Actually read the test file (not just counted test cases)
2. Understand what each test scenario is asserting (not just that it passes)
3. Verified tests actually exercise the production code paths (not just mocks)
4. Identified gaps in test coverage or scenarios that could fail in production

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P16a.md`
