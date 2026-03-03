# Phase 03a: Verify Type System Evolution - Stub

## Phase ID

`PLAN-20260302-A2A.P03a`

## Prerequisites

- Required: Phase 03 completed
- Verification: Discriminated union types exist in `packages/core/src/agents/types.ts`

## Purpose

Verify that Phase 03 correctly implemented the discriminated union type system for AgentDefinition. This verification phase checks both structural correctness (files, markers) and semantic correctness (types work as designed).

## Verification Commands

### Structural Verification

```bash
# Check plan markers exist
grep -c "@plan:PLAN-20260302-A2A.P03" packages/core/src/agents/types.ts
# Expected: 4 (BaseAgentDefinition, LocalAgentDefinition, RemoteAgentDefinition, union type)

# Check requirements covered
grep -c "@requirement:A2A-REG-001" packages/core/src/agents/types.ts
# Expected: 4

# Verify all type exports
grep "export.*AgentDefinition" packages/core/src/agents/types.ts
# Expected: LocalAgentDefinition, RemoteAgentDefinition, and union type AgentDefinition

# Verify union type structure
grep -A 2 "export type AgentDefinition" packages/core/src/agents/types.ts | grep -E "LocalAgentDefinition|RemoteAgentDefinition"
# Expected: Shows both LocalAgentDefinition<TOutput> and RemoteAgentDefinition in union

# Check for TODO/FIXME/STUB markers
grep -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/agents/types.ts
# Expected: No matches (or only in comments explaining design, not implementation tasks)

# TypeScript compiles (types.ts itself)
npx tsc --noEmit packages/core/src/agents/types.ts
# Expected: SUCCESS
```

### Semantic Verification

**Answer ALL questions before proceeding:**

#### 1. Does the code DO what the requirement says?

- [ ] **I READ the actual types.ts file** (line 54 onwards for BaseAgentDefinition, LocalAgentDefinition, RemoteAgentDefinition, union type)
- [ ] **BaseAgentDefinition exists** with fields: name, displayName?, description?, inputConfig
- [ ] **LocalAgentDefinition<TOutput> exists** with: kind: 'local', extends BaseAgentDefinition, has promptConfig/modelConfig/runConfig (mandatory), toolConfig?/outputConfig?/processOutput? (optional)
- [ ] **RemoteAgentDefinition exists** with: kind: 'remote', extends BaseAgentDefinition, has agentCardUrl (mandatory)
- [ ] **AgentDefinition<TOutput> is a discriminated union**: `export type AgentDefinition<TOutput extends z.ZodTypeAny = z.ZodUnknown> = LocalAgentDefinition<TOutput> | RemoteAgentDefinition`
- [ ] **All other types unchanged**: PromptConfig, ToolConfig, InputConfig, OutputConfig, ModelConfig, RunConfig remain as they were

**How I verified:**
```
Read lines 54-100 of types.ts. Confirmed:
- BaseAgentDefinition is an interface with name, displayName?, description?, inputConfig
- LocalAgentDefinition<TOutput> extends BaseAgentDefinition, adds kind: 'local' + all execution config
- RemoteAgentDefinition extends BaseAgentDefinition, adds kind: 'remote' + agentCardUrl
- Union type defined as: type AgentDefinition<TOutput> = LocalAgentDefinition<TOutput> | RemoteAgentDefinition
```

#### 2. Is this REAL implementation, not placeholder?

- [ ] **No TODO/HACK/STUB** comments in implementation (only in design docs)
- [ ] **Types compile** (ran `npx tsc --noEmit types.ts` successfully)
- [ ] **No empty returns** or fake implementations (types are fully defined)

**How I verified:**
```
grep -E "(TODO|FIXME)" types.ts returned no matches in type definitions
npx tsc --noEmit types.ts succeeded
All type definitions are complete with proper fields and extends clauses
```

#### 3. Would consuming code FAIL without type narrowing?

- [ ] **Breaking change confirmed**: Tried accessing `definition.promptConfig` on generic `AgentDefinition` → TypeScript error (expected)
- [ ] **Type narrowing works**: After `if (definition.kind === 'local')`, accessing `definition.promptConfig` succeeds
- [ ] **Executor/invocation will break**: Confirmed that `executor.ts` and `invocation.ts` currently have type errors (expected, fixed in P30-31)

**How I verified:**
```
Checked that AgentDefinition is a union type (not a single interface)
TypeScript requires narrowing before accessing kind-specific fields
executor.ts line ~90 will fail to compile (accesses definition.promptConfig without narrowing)
invocation.ts line ~40 will fail to compile (constructor signature needs LocalAgentDefinition)
This is EXPECTED and documented in P03 Breaking Changes section
```

#### 4. Is the feature REACHABLE by implementation code?

- [ ] **Types are exported**: All new types (BaseAgentDefinition, LocalAgentDefinition, RemoteAgentDefinition, AgentDefinition) are exported
- [ ] **No internal-only definitions**: Types are in public API surface
- [ ] **Generic parameter preserved**: LocalAgentDefinition<TOutput> and AgentDefinition<TOutput> maintain the generic parameter for output schema

**How I verified:**
```
grep "export.*AgentDefinition" types.ts shows all types exported
Generic parameter TOutput is preserved in LocalAgentDefinition and union type
No private or internal-only type definitions
```

#### 5. What's MISSING?

**Acceptable for stub phase:**
- [ ] Validation logic (scheduled for P05)
- [ ] Type narrowing in consuming code (scheduled for P30-31)
- [ ] Factory method for dispatch (scheduled for P24-26)

**Blockers (should NOT be present):**
- [ ] None identified

**How I verified:**
```
This is a stub phase, so missing validation/integration is expected
No blockers found that would prevent P04 from proceeding
```

### Expected Behavior After P03

**What WORKS:**
- [ ] Types compile in isolation
- [ ] Discriminated union enforces kind field
- [ ] Type narrowing via `if (definition.kind === 'local')` works in new code

**What BREAKS (expected):**
- [ ] `executor.ts` fails to compile (line ~90 accessing definition.promptConfig without narrowing)
- [ ] `invocation.ts` fails to compile (line ~40 constructor expects narrowed type)
- [ ] This is INTENTIONAL and documented

**Verification:**
```bash
# Attempt full typecheck (will fail)
npm run typecheck 2>&1 | grep -E "executor\.ts|invocation\.ts"
# Expected: Type errors in these files (acceptable until P30-31)
```

## Success Criteria

- [ ] All structural checks PASS
- [ ] All semantic verification questions answered YES
- [ ] 4 @plan markers and 4 @requirement markers found
- [ ] Types export correctly
- [ ] Union type structure correct
- [ ] No unintended TODO/STUB comments
- [ ] Breaking changes in executor/invocation confirmed and expected
- [ ] Ready to proceed to P04 (TDD phase)

## Failure Recovery

If verification fails:

1. **Structural failures** (missing markers, wrong structure):
   - Return to P03
   - Fix type definitions
   - Re-run verification

2. **Semantic failures** (wrong fields, union not working):
   - Return to P03
   - Correct type structure based on design.md §5.1
   - Re-run verification

3. **Unexpected blockers**:
   - Document in verification report
   - Escalate to plan reviewer

## Verification Report Template

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P03a-report.md`

```markdown
# Phase 03 Verification Report

**Verified by:** [subagent/human name]
**Date:** [YYYY-MM-DD HH:MM]

## Structural Checks
- [x] Plan markers: 4/4 found
- [x] Requirement markers: 4/4 found
- [x] Types exported: LocalAgentDefinition, RemoteAgentDefinition, AgentDefinition
- [x] Union type structure correct
- [x] No TODO/STUB comments

## Semantic Checks
- [x] BaseAgentDefinition: name, displayName?, description?, inputConfig
- [x] LocalAgentDefinition<TOutput>: kind: 'local', extends base, has execution config
- [x] RemoteAgentDefinition: kind: 'remote', extends base, has agentCardUrl
- [x] Union type: AgentDefinition<TOutput> = Local<TOutput> | Remote
- [x] Breaking changes confirmed in executor.ts and invocation.ts (expected)

## Issues Found
- None (or list any issues)

## Verification Result
[OK] PASS - Ready for P04

**Verification commands executed:**
```
[paste actual command outputs here]
```
```

## Next Phase

After successful verification:
- **Proceed to Phase 04**: Type System Evolution - TDD
- Phase 04 will create behavioral tests for the type system
