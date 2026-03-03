# Phase 30: Caller Migration - Breaking Changes

## Phase ID

`PLAN-20260302-A2A.P30`

## Prerequisites

- Required: Phase 29a (TOML Implementation Verification) completed
- Verification: All previous phases (00a-29a) completed
- Expected state: All new A2A components implemented and tested
- Breaking changes ready: AgentDefinition discriminated union, async registerAgent

## Requirements Implemented

### REQ A2A-REG-002: Async Migration (Caller Updates)

**Full EARS Text**: All callers of registerAgent() shall await the Promise.

**Behavior Specification**:
- GIVEN: registerAgent() is now async (changed in P18-P20)
- WHEN: Code calls registerAgent() or loadBuiltInAgents()
- THEN: All call sites must use `await` keyword
- AND: All containing functions must be async

**Why This Matters**: Phase 18-20 made registerAgent() async (breaking change). This phase fixes ALL callers affected by that change. Failure to await will cause:
- Type errors (Promise<void> assigned to void)
- Runtime issues (registration may not complete before use)
- Test failures (agents not registered when expected)

### REQ A2A-EXEC-011: Type Narrowing Migration

**Full EARS Text**: AgentExecutor and SubagentInvocation shall accept only LocalAgentDefinition (not the union type).

**Behavior Specification**:
- GIVEN: AgentDefinition is now a discriminated union (LocalAgentDefinition | RemoteAgentDefinition)
- WHEN: Code accesses local-only fields (promptConfig, modelConfig, runConfig)
- THEN: Code must narrow the type to LocalAgentDefinition first
- AND: Type guards or dispatch logic must be used

**Why This Matters**: Direct property access on AgentDefinition<TOutput> no longer compiles because remote agents don't have promptConfig/modelConfig/runConfig. Code must use type narrowing.

## Implementation Tasks

### Files to Modify

Based on grep analysis, the following files need updates:

#### 1. **`packages/core/src/agents/executor.ts`** — Type narrowing for local-only fields

**Current issues** (lines 86-87, 158-159):
- Line 86: `if (definition.toolConfig)` — needs narrowing
- Line 158-159: `this.definition.promptConfig.query` — needs narrowing

**Solution**: Change `AgentExecutor.create()` signature to accept only `LocalAgentDefinition`:

```typescript
/**
 * @plan PLAN-20260302-A2A.P30
 * @requirement A2A-EXEC-011
 */
static async create<TOutput extends z.ZodTypeAny>(
  definition: LocalAgentDefinition<TOutput>,  // CHANGED: was AgentDefinition<TOutput>
  runtimeContext: Config,
  onActivity?: ActivityCallback,
): Promise<AgentExecutor<TOutput>> {
  // Now definition.toolConfig, definition.promptConfig are guaranteed to exist
  // No type narrowing needed inside this method
}
```

**Update instance field and constructor**:
```typescript
readonly definition: LocalAgentDefinition<TOutput>;  // CHANGED: was AgentDefinition<TOutput>

private constructor(
  definition: LocalAgentDefinition<TOutput>,  // CHANGED
  toolRegistry: ToolRegistry,
  runtimeContext: Config,
  onActivity?: ActivityCallback,
) {
  // ...
}
```

**Rationale**: AgentExecutor is only used for LOCAL agents. Remote agents use RemoteAgentInvocation. By accepting only LocalAgentDefinition, all property access becomes type-safe.

#### 2. **`packages/core/src/agents/invocation.ts`** — Type narrowing for SubagentInvocation

**Current issue** (line 43):
- `private readonly definition: AgentDefinition<TOutput>` — too broad

**Solution**: Change SubagentInvocation constructor to accept only `LocalAgentDefinition`:

```typescript
/**
 * @plan PLAN-20260302-A2A.P30
 * @requirement A2A-EXEC-011
 */
constructor(
  params: AgentInputs,
  private readonly definition: LocalAgentDefinition<TOutput>,  // CHANGED: was AgentDefinition<TOutput>
  private readonly config: Config,
  messageBus?: MessageBus,
) {
  super(params, messageBus);
}
```

**Update import**:
```typescript
import type {
  LocalAgentDefinition,  // ADD
  AgentInputs,
  SubagentActivityEvent,
} from './types.js';
```

**Rationale**: SubagentInvocation is the local agent invocation wrapper. It should only accept LocalAgentDefinition. The dispatch point (AgentRegistry.createInvocation) already narrows the type before calling this constructor.

#### 3. **`packages/core/src/agents/codebase-investigator.ts`** — Use LocalAgentDefinition type

**Current issue** (line 44):
- `export const CodebaseInvestigatorAgent: AgentDefinition<...>` — should be LocalAgentDefinition

**Solution**: Change type annotation:

```typescript
/**
 * A Proof-of-Concept subagent specialized in analyzing codebase structure,
 * dependencies, and technologies.
 * @plan PLAN-20260302-A2A.P30
 */
export const CodebaseInvestigatorAgent: LocalAgentDefinition<  // CHANGED: was AgentDefinition
  typeof CodebaseInvestigationReportSchema
> = {
  kind: 'local',  // ADD: discriminated union requires kind field
  name: 'codebase_investigator',
  // ... rest unchanged
};
```

**Update import**:
```typescript
import type { LocalAgentDefinition } from './types.js';  // CHANGED: was AgentDefinition
```

#### 4. **`packages/core/src/agents/registry.ts`** — Already async, verify await usage

**Status**: Already fixed in P18-P20 (initialize awaits loadBuiltInAgents).

**Verification only**: Confirm line 31 has `await this.loadBuiltInAgents();`

### Summary of File Changes

| File | Lines Changed | Change Type | Reason |
|------|---------------|-------------|--------|
| executor.ts | ~5 | Type narrowing | Accept LocalAgentDefinition in create() and constructor |
| invocation.ts | ~2 | Type narrowing | Accept LocalAgentDefinition in constructor |
| codebase-investigator.ts | ~3 | Type annotation | Mark as LocalAgentDefinition, add kind field |
| registry.ts | 0 | Verification | Already async from P18-P20 |

**Total changes**: ~10 lines across 3 files (minimal impact)

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 30 of 33 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 29a completed:
- File `project-plans/gmerge-0.24.5/a2a/plan/.verified/P29a-report.md` exists
- All previous phases (00a-29a) completed

YOUR TASK:
Update callers affected by breaking changes (discriminated union types, async registerAgent).

BREAKING CHANGES TO FIX:
1. AgentDefinition is now LocalAgentDefinition | RemoteAgentDefinition (P05)
2. registerAgent() is now async (P18-P20)
3. AgentExecutor/SubagentInvocation should accept ONLY LocalAgentDefinition

SPECIFIC FILE CHANGES:

### 1. packages/core/src/agents/executor.ts

**Change 1**: Update create() signature (~line 78):
```typescript
static async create<TOutput extends z.ZodTypeAny>(
  definition: LocalAgentDefinition<TOutput>,  // CHANGED from AgentDefinition
  runtimeContext: Config,
  onActivity?: ActivityCallback,
): Promise<AgentExecutor<TOutput>> {
```

**Change 2**: Update instance field (~line 59):
```typescript
readonly definition: LocalAgentDefinition<TOutput>;  // CHANGED
```

**Change 3**: Update private constructor (~line 127):
```typescript
private constructor(
  definition: LocalAgentDefinition<TOutput>,  // CHANGED
  toolRegistry: ToolRegistry,
  runtimeContext: Config,
  onActivity?: ActivityCallback,
) {
```

**Change 4**: Update import (~line 36):
```typescript
import type {
  LocalAgentDefinition,  // ADD
  AgentDefinition,       // KEEP (still used in some places)
  AgentInputs,
  OutputObject,
  SubagentActivityEvent,
} from './types.js';
```

**Add marker**: Add `@plan PLAN-20260302-A2A.P30` and `@requirement A2A-EXEC-011` to create() JSDoc.

### 2. packages/core/src/agents/invocation.ts

**Change 1**: Update constructor parameter (~line 43):
```typescript
constructor(
  params: AgentInputs,
  private readonly definition: LocalAgentDefinition<TOutput>,  // CHANGED from AgentDefinition
  private readonly config: Config,
  messageBus?: MessageBus,
) {
```

**Change 2**: Update import (~line 12):
```typescript
import type {
  LocalAgentDefinition,  // ADD
  AgentInputs,
  SubagentActivityEvent,
} from './types.js';
```

**Add marker**: Add `@plan PLAN-20260302-A2A.P30` to constructor JSDoc.

### 3. packages/core/src/agents/codebase-investigator.ts

**Change 1**: Update type annotation (~line 44):
```typescript
export const CodebaseInvestigatorAgent: LocalAgentDefinition<  // CHANGED from AgentDefinition
  typeof CodebaseInvestigationReportSchema
> = {
  kind: 'local',  // ADD this field (discriminated union requirement)
  name: 'codebase_investigator',
  // ... rest unchanged
};
```

**Change 2**: Update import (~line 6):
```typescript
import type { LocalAgentDefinition } from './types.js';  // CHANGED from AgentDefinition
```

**Add marker**: Add `@plan PLAN-20260302-A2A.P30` to export JSDoc.

### 4. packages/core/src/agents/registry.ts (verification only)

**Check**: Line 31 should have `await this.loadBuiltInAgents();` (already fixed in P18-P20).

IMPLEMENTATION REQUIREMENTS:
- All signature changes use LocalAgentDefinition (not AgentDefinition union)
- codebase-investigator.ts adds `kind: 'local'` field
- All imports updated
- @plan markers added
- TypeScript compiles successfully

DELIVERABLES:
- 3 files modified (~10 lines total)
- TypeScript compiles with no errors
- All existing tests still pass (type narrowing doesn't change behavior)

DO NOT:
- Change test files (that's P31)
- Modify any agent definitions other than codebase-investigator.ts
- Change runtime behavior (only type annotations)
```

## Verification Commands

### Automated Checks

```bash
# Check LocalAgentDefinition import in executor.ts
grep "LocalAgentDefinition" packages/core/src/agents/executor.ts
# Expected: Import statement + 3 usages (create param, field, constructor)

# Check LocalAgentDefinition in invocation.ts
grep "LocalAgentDefinition" packages/core/src/agents/invocation.ts
# Expected: Import statement + 1 usage (constructor param)

# Check codebase-investigator.ts has kind field
grep "kind: 'local'" packages/core/src/agents/codebase-investigator.ts
# Expected: Found

# Check codebase-investigator.ts uses LocalAgentDefinition type
grep "LocalAgentDefinition" packages/core/src/agents/codebase-investigator.ts
# Expected: Type annotation on CodebaseInvestigatorAgent

# TypeScript compiles
npm run typecheck
# Expected: 0 errors

# Run existing tests (should still pass)
npm test -- packages/core/src/agents/__tests__/
# Expected: All tests PASS (behavior unchanged, only types narrowed)

# Check plan markers
grep -c "@plan:PLAN-20260302-A2A.P30" packages/core/src/agents/executor.ts packages/core/src/agents/invocation.ts packages/core/src/agents/codebase-investigator.ts
# Expected: 3+ (one per modified file)
```

### Deferred Implementation Detection

```bash
# Ensure no type casts added (should use proper narrowing)
grep -E "as (Local|Remote)AgentDefinition" packages/core/src/agents/executor.ts packages/core/src/agents/invocation.ts
# Expected: No matches (type system should infer, no casts needed)
```

### Semantic Verification Checklist

**Does the code DO what the requirement says?**
- [ ] AgentExecutor.create() accepts only LocalAgentDefinition
- [ ] SubagentInvocation constructor accepts only LocalAgentDefinition
- [ ] codebase-investigator.ts has `kind: 'local'` field
- [ ] All local-only property access compiles without errors
- [ ] TypeScript type checking passes

**Is the migration complete?**
- [ ] All direct AgentDefinition property access has been narrowed or signature changed
- [ ] No type casts used (proper type narrowing via signatures)
- [ ] Tests still pass (behavior unchanged)

**What's NOT migrated (acceptable for P30)?**
- Test files (P31 will update test fixtures)
- Remote agent test scenarios (P31)

## Success Criteria

- All verification commands pass
- TypeScript compiles with 0 errors
- All existing tests pass (no behavior change)
- 3 files modified with LocalAgentDefinition type narrowing
- codebase-investigator.ts has `kind: 'local'` field
- No type casts added (signatures provide safety)

## Failure Recovery

If this phase fails:

1. Type errors in executor.ts → verify all usages changed to LocalAgentDefinition
2. Type errors in invocation.ts → verify constructor parameter changed
3. Missing kind field → add to codebase-investigator.ts
4. Tests fail → check if behavior accidentally changed (should be type-only)

Rollback:
```bash
git checkout -- packages/core/src/agents/executor.ts packages/core/src/agents/invocation.ts packages/core/src/agents/codebase-investigator.ts
```

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P30.md`

Contents:
```markdown
Phase: P30
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Modified:
  - packages/core/src/agents/executor.ts (~5 lines)
  - packages/core/src/agents/invocation.ts (~2 lines)
  - packages/core/src/agents/codebase-investigator.ts (~3 lines)

Type Narrowing Changes:
  - AgentExecutor.create(): AgentDefinition → LocalAgentDefinition
  - AgentExecutor.definition field: AgentDefinition → LocalAgentDefinition
  - AgentExecutor constructor: AgentDefinition → LocalAgentDefinition
  - SubagentInvocation.definition: AgentDefinition → LocalAgentDefinition
  - CodebaseInvestigatorAgent: AgentDefinition → LocalAgentDefinition + kind field

Verification: [paste typecheck and test output]

Breaking Changes Fixed:
- Discriminated union type narrowing complete
- All local-only property access now type-safe

Next Phase: P30a (Verification of P30)
```
