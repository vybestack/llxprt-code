# Phase 00a: Preflight Verification

## Phase ID

`PLAN-20260302-A2A.P00a`

## Purpose

Verify ALL assumptions before writing any code. This phase prevents the most common planning failures: missing dependencies, wrong types, and impossible call patterns.

## Prerequisites

- None (this is the first phase)

## Required Verifications

### 1. Dependency Verification

```bash
# Verify existing dependencies
npm ls @google/genai         # Must show installed version
npm ls zod                   # Must show installed version
npm ls vitest                # Must show installed version

# Check if NEW dependencies exist (they shouldn't yet)
npm ls @google/genai-a2a-sdk || echo "Expected: not found (will add later)"
npm ls google-auth-library   || echo "Expected: not found (will add later)"
```

**Expected Result:**
- `@google/genai`: installed (existing)
- `zod`: installed (existing)
- `vitest`: installed (existing)
- `@google/genai-a2a-sdk`: NOT found (will be added in Phase 15)
- `google-auth-library`: NOT found (will be added in Phase 12)

### 2. Type/Interface Verification

```bash
# Verify AgentDefinition structure (current baseline)
grep -A 30 "interface AgentDefinition" packages/core/src/agents/types.ts

# Expected: Single interface with promptConfig, modelConfig, runConfig (all required)
# No 'kind' field, no discriminated union

# Verify AgentRegistry.registerAgent is synchronous
grep -A 5 "registerAgent" packages/core/src/agents/registry.ts | grep "async"
# Expected: No 'async' keyword (currently synchronous)

# Verify AgentExecutor.create signature
grep -A 10 "static async create" packages/core/src/agents/executor.ts

# Expected: Accepts AgentDefinition<TOutput> (not narrowed to LocalAgentDefinition yet)

# Verify SubagentInvocation constructor
grep -A 10 "constructor" packages/core/src/agents/invocation.ts

# Expected: Accepts AgentDefinition<TOutput> (not narrowed yet)
```

**Expected Result:**
- `AgentDefinition` is a single interface (no kind field)
- `registerAgent` is synchronous
- `AgentExecutor.create` accepts generic `AgentDefinition`
- `SubagentInvocation` constructor accepts generic `AgentDefinition`

### 3. Call Path Verification

```bash
# Find all callers of registerAgent (will need to be updated to async)
grep -rn "registerAgent(" packages/core/src/agents/ --include="*.ts"

# Expected: registry.ts (self), possibly tests

# Find all direct instantiations of SubagentInvocation
grep -rn "new SubagentInvocation" packages/ --include="*.ts"

# Expected: invocation.ts (self), possibly tests, task.ts

# Verify Config class exists with DI pattern
grep -A 5 "class Config" packages/core/src/config/config.ts | head -10

# Expected: Config class with constructor, methods for getting services
```

**Expected Result:**
- `registerAgent` called in `loadBuiltInAgents` (currently empty)
- `SubagentInvocation` instantiated in test files and potentially task.ts
- Config class exists with DI pattern

### 4. Test Infrastructure Verification

```bash
# Verify test files exist for agents
ls packages/core/src/agents/__tests__/ || ls packages/core/src/agents/*.test.ts

# Verify test patterns work
npm run test -- --grep "AgentExecutor" --run

# Verify Vitest is configured
cat vitest.config.ts | grep "test:"
```

**Expected Result:**
- Test files exist: `executor.test.ts`, `invocation.test.ts`
- Tests run successfully
- Vitest configured

### 5. Tool Invocation Pattern Verification

```bash
# Verify BaseToolInvocation exists
grep -A 20 "export abstract class BaseToolInvocation" packages/core/src/tools/tools.ts

# Expected: Abstract class with execute, getDescription, etc.

# Verify ToolResult interface
grep -A 10 "export interface ToolResult" packages/core/src/tools/tools.ts

# Expected: Interface with llmContent, returnDisplay, error fields
```

**Expected Result:**
- `BaseToolInvocation` exists with required abstract methods
- `ToolResult` interface matches expected structure

### 6. MessageBus and Confirmation System Verification

```bash
# Verify MessageBus exists
grep -A 10 "export class MessageBus" packages/core/src/confirmation-bus/message-bus.ts

# Verify confirmation types
grep "TOOL_CONFIRMATION" packages/core/src/confirmation-bus/types.ts

# Expected: MessageBus, TOOL_CONFIRMATION_REQUEST, TOOL_CONFIRMATION_RESPONSE types
```

**Expected Result:**
- MessageBus exists with publish/subscribe pattern
- Confirmation infrastructure in place

## Preflight Verification Checklist

Create verification results in this file:

### Dependencies Verified
- [ ] `@google/genai`: Installed (existing)
- [ ] `zod`: Installed (existing)
- [ ] `vitest`: Installed (existing)
- [ ] `@google/genai-a2a-sdk`: NOT installed (will add in P15)
- [ ] `google-auth-library`: NOT installed (will add in P12)

### Types Verified
- [ ] `AgentDefinition`: Single interface, no kind field
- [ ] `registerAgent`: Currently synchronous
- [ ] `AgentExecutor.create`: Accepts generic AgentDefinition
- [ ] `SubagentInvocation`: Accepts generic AgentDefinition

### Call Paths Verified
- [ ] `registerAgent` callers identified (loadBuiltInAgents, tests)
- [ ] `SubagentInvocation` instantiation sites identified
- [ ] Config class exists with DI pattern

### Test Infrastructure Verified
- [ ] Test files exist: executor.test.ts, invocation.test.ts
- [ ] Tests run successfully
- [ ] Vitest configured

### Tool Invocation Pattern Verified
- [ ] `BaseToolInvocation` abstract class exists
- [ ] `ToolResult` interface structure correct

### Confirmation System Verified
- [ ] `MessageBus` exists with publish/subscribe
- [ ] Confirmation types defined

## Blocking Issues Found

[List any issues that MUST be resolved before proceeding]

**If ANY checkbox is unchecked with a blocker, STOP and update the plan.**

## Verification Gate

- [ ] All dependencies verified (existing and missing as expected)
- [ ] All types match baseline expectations
- [ ] All call paths identified
- [ ] Test infrastructure ready
- [ ] Tool invocation pattern confirmed
- [ ] Confirmation system confirmed

**IF ANY VERIFICATION FAILS: Document the failure and determine if plan needs adjustment.**

## Success Criteria

- All verifications pass with expected results
- No unexpected blockers found
- Clear understanding of baseline codebase structure
- Ready to proceed to Phase 03 (Type System Evolution)

## Next Phase

After this phase completes successfully, proceed to:
- **Phase 03**: Type System Evolution - Stub
