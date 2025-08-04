# 🗂️ Autonomous Development Plan - Model Parameters and Profiles

This plan defines the test-driven development process for implementing model parameters and profiles feature using autonomous agents.

---

## Core Principles

1. **TDD is MANDATORY** - Every line of production code must be written in response to a failing test
2. **Agent Isolation** - Each phase executed by fresh agent instance with clean context
3. **Test-First Approach** - Stub with NYI → Write tests → Implement to pass tests
4. **Behavioral Testing** - Test behavior and requirements, not implementation details
5. **Continuous Verification** - Build, lint, and test after each phase
6. **NO ANY TYPE** - Use `unknown` with type guards. The `any` type is forbidden. Period.

---

## Plan Structure

```
product-plans/modelparams/
  overview.md                    ← Feature overview (existing)
  PRD.md                        ← Product requirements (existing)
  PLAN.md                       ← This file
  plan/
    00-specification.md         ← Technical specification
    01-iprovider-stub.md       ← IProvider interface extension stub
    01a-iprovider-verification.md
    02-iprovider-tests.md      ← IProvider behavior tests
    02a-iprovider-tests-verification.md
    03-openai-stub.md          ← OpenAI provider stub
    03a-openai-stub-verification.md
    04-openai-tests.md         ← OpenAI provider tests
    04a-openai-tests-verification.md
    05-openai-impl.md          ← OpenAI provider implementation
    05a-openai-impl-verification.md
    06-commands-stub.md        ← CLI commands stub
    06a-commands-stub-verification.md
    07-commands-tests.md       ← CLI commands tests
    07a-commands-tests-verification.md
    08-commands-impl.md        ← CLI commands implementation
    08a-commands-impl-verification.md
    09-profile-stub.md         ← Profile save/load stub
    09a-profile-stub-verification.md
    10-profile-tests.md        ← Profile save/load tests
    10a-profile-tests-verification.md
    11-profile-impl.md         ← Profile save/load implementation
    11a-profile-impl-verification.md
    12-integration-tests.md    ← End-to-end integration tests
    12a-integration-verification.md
```

---

## Phase 0: Technical Specification

**Purpose**: Define exact technical requirements, interfaces, and test scenarios based on PRD.

**Content Requirements**:

- Exact TypeScript interfaces with JSDoc
- Data flow diagrams
- Error handling specifications
- Test scenarios with input/output examples
- File paths and module organization

---

## Implementation Phases

### Phase 1-2: IProvider Interface Extension

**Goal**: Extend IProvider interface with optional model parameter methods

**Stub Requirements**:

```typescript
// In IProvider.ts
setModelParams?(params: Record<string, any>): void {
  throw new Error('NotYetImplemented');
}
getModelParams?(): Record<string, any> | undefined {
  throw new Error('NotYetImplemented');
}
```

**Test Requirements**:

- Test provider accepts model params
- Test params are retrievable
- Test params are merged (not replaced)
- Test undefined behavior for providers without support

### Phase 3-5: OpenAI Provider Implementation

**Goal**: Implement model parameter support in OpenAIProvider

**Test Scenarios**:

- Setting standard params (temperature, max_tokens, etc.)
- Params passed to chat completions API
- No params = API defaults
- Invalid params handled by API
- Responses API remains no-op

### Phase 6-8: CLI Commands

**Goal**: Implement `/set modelparam` and `/set` commands

**Test Requirements**:

- Parse command correctly
- Call provider methods when supported
- Show warning for unsupported providers
- Handle ephemeral settings separately
- Validate command syntax

### Phase 9-11: Profile Management

**Goal**: Implement `/save` and `/load` commands with file persistence

**Test Scenarios**:

- Save current state to JSON file
- Load profile and apply all settings
- Handle missing files gracefully
- Override behavior (load then change)
- CLI --load flag functionality

### Phase 12: Integration Testing

**Goal**: Verify end-to-end functionality

**Test Requirements**:

- Full workflow: configure → save → load → use
- Multiple profiles work correctly
- CLI and interactive mode compatibility
- Provider switching with profiles

---

## Agent Task Templates

### Stub Phase Template

```
Read the specification for [component] in plan/00-specification.md.
Create stub implementation with:
1. All methods throw new Error('NotYetImplemented')
2. Correct TypeScript interfaces from spec
3. Proper imports and exports
4. Must compile with npm run typecheck

Output files to correct locations per spec.
Run npm run lint and npm run typecheck to verify.
```

### Test Phase Template

```
Based on specification and PRD requirements, write comprehensive BEHAVIORAL tests for [component].

MANDATORY:
- Test actual behavior, not mocks
- Each test must verify a requirement from PRD
- Include test data from specification examples
- Test error cases with specific scenarios
- Use describe/it with clear descriptions

FORBIDDEN:
- Mock verification (toHaveBeenCalled)
- Testing implementation details
- Tests that pass with stubs

Create 10-15 behavioral tests.
Run npm test to verify all fail with NotYetImplemented.
```

### Implementation Phase Template

```
Implement [component] to make ALL tests pass.

Requirements:
1. Do NOT modify any tests
2. Follow specification exactly
3. Use TypeScript strict mode
4. Handle all test scenarios
5. Run npm run lint && npm run typecheck && npm test

All tests must pass before completion.
```

### Verification Phase Template

```
Verify the [component] implementation:

1. All tests pass: npm test [test-file]
2. No lint errors: npm run lint
3. TypeScript compiles: npm run typecheck
4. Coverage adequate: npm test -- --coverage [test-file]
5. No TODO/console.log in code
6. Requirements from PRD are met

Report any issues found.
```

---

## Execution Protocol

### Sequential Execution

Each phase must complete before the next begins:

```bash
# Phase 1-2: IProvider
Agent: Execute plan/01-iprovider-stub.md
Agent: Execute plan/01a-iprovider-verification.md
Agent: Execute plan/02-iprovider-tests.md
Agent: Execute plan/02a-iprovider-tests-verification.md

# Phase 3-5: OpenAI Provider (only after IProvider complete)
Agent: Execute plan/03-openai-stub.md
# ... continue pattern
```

### Success Criteria

- Zero test modifications between test and implementation phases
- 100% of behavioral tests pass
- No TypeScript errors
- No lint warnings
- All PRD requirements have corresponding tests

---

## Common Pitfalls to Avoid

1. **Writing implementation before tests** - Always RED → GREEN → REFACTOR
2. **Testing mocks instead of behavior** - Verify actual outputs, not mock calls
3. **Modifying tests to make them pass** - Tests are the specification
4. **Incomplete coverage** - Every requirement needs a test
5. **Skipping verification** - Always verify build/lint/test

---

## Behavioral Test Examples

### Good Behavioral Test

```typescript
it('should pass temperature parameter to OpenAI API', async () => {
  const provider = new OpenAIProvider('test-key');
  provider.setModelParams({ temperature: 0.7 });

  // Mock the OpenAI client to capture the API call
  const capturedParams = await captureApiCall(() =>
    provider.generateChatCompletion(messages, tools),
  );

  expect(capturedParams.temperature).toBe(0.7);
});
```

### Bad Mock Test

```typescript
// DON'T DO THIS
it('should call OpenAI with params', () => {
  mockOpenAI.chat.completions.create.mockResolvedValue(response);
  provider.generateChatCompletion(messages);
  expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
    expect.objectContaining({ temperature: 0.7 }),
  );
});
```

---

## Notes for Coordinator

1. **Provide complete context** - Each agent needs PRD, specification, and relevant code
2. **Enforce phase order** - Don't start implementation before tests exist
3. **Verify continuously** - Run verification after each phase
4. **Trust agent output** - Agents are specialized for their tasks
5. **Handle failures** - If verification fails, diagnose and retry

Remember: The goal is working software that meets requirements, not perfect architecture.
