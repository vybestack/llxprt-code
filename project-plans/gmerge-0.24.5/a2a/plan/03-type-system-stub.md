# Phase 03: Type System Evolution - Stub

## Phase ID

`PLAN-20260302-A2A.P03`

## Prerequisites

- Required: Phase 00a (Preflight Verification) completed
- Verification: All preflight checks passed in `00a-preflight-verification.md`
- Expected files: `packages/core/src/agents/types.ts` exists with current single-interface `AgentDefinition`

## Requirements Implemented

### REQ A2A-REG-001: Discriminated Union Types

**Full EARS Text**: The system shall support registering both local and remote agent definitions via a discriminated union type.

**Behavior Specification**:
- GIVEN: An AgentDefinition with `kind: 'local'`
- WHEN: The system validates the definition
- THEN: It shall require promptConfig, modelConfig, and runConfig fields
- AND: TypeScript shall enforce these fields at compile time

- GIVEN: An AgentDefinition with `kind: 'remote'`
- WHEN: The system validates the definition
- THEN: It shall require agentCardUrl field only
- AND: Shall not require promptConfig, modelConfig, or runConfig
- AND: TypeScript shall prevent accessing these fields without type narrowing

**Why This Matters**: Local and remote agents have fundamentally different execution models. Local agents execute via LLM API calls (need prompt/model config), while remote agents delegate to external services (only need URL). Compile-time type safety prevents runtime errors from accessing invalid fields on the wrong agent type.

## Implementation Tasks

### File to Modify

**`packages/core/src/agents/types.ts`** — Add discriminated union types

**Current state** (line 54): Single `interface AgentDefinition<TOutput>` with all fields required
**Target state**: Discriminated union with `BaseAgentDefinition`, `LocalAgentDefinition<TOutput>`, `RemoteAgentDefinition`, and union type `AgentDefinition<TOutput>`

### Stub Implementation Details

For stub phase, create the TYPE STRUCTURE only. Methods that consume these types will be updated in later phases (P18-P26).

**Changes:**
1. Create `BaseAgentDefinition` interface with common fields (name, displayName, description, inputConfig)
2. Create `LocalAgentDefinition<TOutput>` interface extending base with kind: 'local' + all existing execution config fields
3. Create `RemoteAgentDefinition` interface extending base with kind: 'remote' + agentCardUrl
4. Replace existing `interface AgentDefinition<TOutput>` with discriminated union: `export type AgentDefinition<TOutput> = LocalAgentDefinition<TOutput> | RemoteAgentDefinition`
5. Add `@plan` and `@requirement` markers to all new types

**Implementation:**
```typescript
/**
 * Base interface for all agent definitions.
 * @plan PLAN-20260302-A2A.P03
 * @requirement A2A-REG-001
 */
interface BaseAgentDefinition {
  name: string;
  displayName?: string;
  description?: string;  // Optional - can be populated from agent card for remote agents
  inputConfig: InputConfig;
}

/**
 * Local agent definition (existing behavior).
 * Requires all local execution configuration.
 * @plan PLAN-20260302-A2A.P03
 * @requirement A2A-REG-001
 */
export interface LocalAgentDefinition<TOutput extends z.ZodTypeAny = z.ZodUnknown> 
  extends BaseAgentDefinition {
  kind: 'local';
  promptConfig: PromptConfig;
  modelConfig: ModelConfig;
  runConfig: RunConfig;
  toolConfig?: ToolConfig;
  outputConfig?: OutputConfig<TOutput>;
  processOutput?: (output: z.infer<TOutput>) => string;
}

/**
 * Remote agent definition.
 * Only requires agent card URL; remote agent manages prompt/model/tools.
 * @plan PLAN-20260302-A2A.P03
 * @requirement A2A-REG-001
 */
export interface RemoteAgentDefinition extends BaseAgentDefinition {
  kind: 'remote';
  agentCardUrl: string;
}

/**
 * Discriminated union of agent types.
 * @plan PLAN-20260302-A2A.P03
 * @requirement A2A-REG-001
 */
export type AgentDefinition<TOutput extends z.ZodTypeAny = z.ZodUnknown> =
  | LocalAgentDefinition<TOutput>
  | RemoteAgentDefinition;
```

### Required Code Markers

Every type definition MUST include:
```typescript
/**
 * @plan PLAN-20260302-A2A.P03
 * @requirement A2A-REG-001
 */
```

### Breaking Change Notice

**CRITICAL**: This IS a breaking change. The existing `interface AgentDefinition` (single unified interface) will be replaced by a discriminated union type. 

**What breaks:**
- All code that directly accesses `definition.promptConfig`, `definition.modelConfig`, or `definition.runConfig` on a generic `AgentDefinition` will break
- TypeScript will require type narrowing via `if (definition.kind === 'local')` before accessing these fields
- Affected files: `executor.ts`, `invocation.ts`, `registry.ts`, and any tests

**Migration Strategy** (implemented in later phases):
1. Phase 03-05: Add types (compilation will break in executor/invocation)
2. Phase 18-20: Update AgentRegistry to handle both kinds with type narrowing
3. Phase 24-26: Add factory method for dispatch with type narrowing
4. Phase 30-32: Fix all call sites throughout codebase with type guards

**Expected behavior after P03**: TypeScript compilation errors in `executor.ts` (line ~90 where `AgentExecutor.create` accesses `definition.promptConfig`) and `invocation.ts` (line ~40 where `SubagentInvocation` accesses `definition`). This is INTENTIONAL and will be fixed in P30-31.

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 03 of 27 for A2A Remote Agent support.

PREREQUISITE CHECK:
Verify Phase 00a (Preflight Verification) completed by checking that:
- `project-plans/gmerge-0.24.5/a2a/plan/00a-preflight-verification.md` exists
- All verification checkboxes are checked
- No blocking issues documented

YOUR TASK:
Modify `packages/core/src/agents/types.ts` to add discriminated union types for AgentDefinition.

CURRENT STATE:
- Line 54: `export interface AgentDefinition<TOutput extends z.ZodTypeAny = z.ZodUnknown>` (single interface)
- All fields (name, description, promptConfig, modelConfig, runConfig, etc.) are in one interface

TARGET STATE:
- Replace single interface with discriminated union
- Create BaseAgentDefinition, LocalAgentDefinition<TOutput>, RemoteAgentDefinition
- Union type: `AgentDefinition<TOutput> = LocalAgentDefinition<TOutput> | RemoteAgentDefinition`

SPECIFIC CHANGES:
1. Keep all existing type definitions BEFORE AgentDefinition (OutputObject, AgentInputs, SubagentActivityEvent, etc.)
2. Create BaseAgentDefinition interface with common fields
3. Create LocalAgentDefinition<TOutput> with kind: 'local' + all existing config fields from current AgentDefinition
4. Create RemoteAgentDefinition with kind: 'remote' + agentCardUrl
5. Replace existing `export interface AgentDefinition` with `export type AgentDefinition` (discriminated union)
6. Keep all existing interfaces AFTER AgentDefinition (PromptConfig, ToolConfig, InputConfig, OutputConfig, ModelConfig, RunConfig)

STUB RULES:
- This is a stub phase, so only create TYPE definitions
- Do NOT modify any implementation files (executor.ts, invocation.ts, registry.ts)
- Do NOT add validation logic
- Types should compile but WILL break consuming code (expected and acceptable)

DELIVERABLES:
- Modified types.ts with discriminated union
- All new types have @plan PLAN-20260302-A2A.P03 and @requirement A2A-REG-001 markers
- File compiles (even if consumers like executor.ts break)
- No TODO comments

DO NOT:
- Modify registry.ts, executor.ts, or invocation.ts (those are later phases P18-P31)
- Add validation functions (that's P05)
- Create new files (only modify types.ts)
- Fix the breaking changes in consuming code (that's P30-31)
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers exist
grep -c "@plan:PLAN-20260302-A2A.P03" packages/core/src/agents/types.ts
# Expected: 4 occurrences (BaseAgentDefinition, LocalAgentDefinition, RemoteAgentDefinition, union type)

# Check requirements covered
grep -c "@requirement:A2A-REG-001" packages/core/src/agents/types.ts
# Expected: 4 occurrences

# TypeScript compiles (file itself)
npx tsc --noEmit packages/core/src/agents/types.ts
# Expected: SUCCESS (the types.ts file itself should compile)

# Types are exported
grep "^export.*AgentDefinition" packages/core/src/agents/types.ts
# Expected: LocalAgentDefinition, RemoteAgentDefinition, and union type exported

# Verify discriminated union structure
grep -A 2 "export type AgentDefinition" packages/core/src/agents/types.ts
# Expected: Shows union type with | LocalAgentDefinition<TOutput> | RemoteAgentDefinition
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME/HACK markers
grep -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/agents/types.ts
# Expected: No matches (only type definitions, no implementation)
```

### Semantic Verification Checklist

**Does the code DO what the requirement says?**
- [ ] I read the full types.ts file (not just checked file exists)
- [ ] BaseAgentDefinition has: name, displayName?, description?, inputConfig
- [ ] LocalAgentDefinition has: kind: 'local', extends BaseAgentDefinition, has promptConfig/modelConfig/runConfig/toolConfig?/outputConfig?/processOutput?
- [ ] RemoteAgentDefinition has: kind: 'remote', extends BaseAgentDefinition, has agentCardUrl
- [ ] AgentDefinition is `export type` (not interface) and is union of LocalAgentDefinition<TOutput> | RemoteAgentDefinition
- [ ] All other types (PromptConfig, ToolConfig, InputConfig, OutputConfig, ModelConfig, RunConfig) remain unchanged

**Is this REAL implementation, not placeholder?**
- [ ] No TODO/HACK/STUB comments
- [ ] Types compile successfully (types.ts itself)
- [ ] Union type exports correctly with both variants
- [ ] Generic parameter TOutput preserved in LocalAgentDefinition and union type

**Breaking changes expected?**
- [ ] Executor.ts will fail to compile (line ~90 accessing definition.promptConfig without narrowing)
- [ ] Invocation.ts will fail to compile (line ~40 accepting generic AgentDefinition)
- [ ] This is intentional — proceed to P04 anyway
- [ ] Breakage will be fixed in P30-31

**What's MISSING (acceptable for stub phase)?**
- Validation logic (P05)
- Type narrowing in consumers (P30-31)
- Factory dispatch method (P24-26)

## Success Criteria

- All verification commands return expected results
- types.ts compiles successfully in isolation
- Union type enforces field access at compile time via discriminant
- All type definitions have @plan + @requirement markers
- No TODO comments in code
- BaseAgentDefinition, LocalAgentDefinition, RemoteAgentDefinition, and union type all exist and exported
- Breaking changes in consuming code documented and expected

## Failure Recovery

If this phase fails:

1. Rollback commands:
   ```bash
   git checkout -- packages/core/src/agents/types.ts
   ```
2. Files to revert: types.ts only
3. Cannot proceed to Phase 04 until types are correctly structured

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.completed/P03.md`

Contents:
```markdown
Phase: P03
Completed: [YYYY-MM-DD HH:MM timestamp]
Files Modified: packages/core/src/agents/types.ts (+60 lines -12 lines)
Types Added: 
  - BaseAgentDefinition (interface)
  - LocalAgentDefinition<TOutput> (interface)
  - RemoteAgentDefinition (interface)
  - AgentDefinition<TOutput> (discriminated union type)
Verification: [paste grep output showing 4 @plan markers, 4 @requirement markers]

Breaking Changes Introduced:
- AgentDefinition changed from single interface to discriminated union
- Code accessing promptConfig/modelConfig/runConfig on generic AgentDefinition now breaks
- Type narrowing required via `if (definition.kind === 'local')`
- Breakage in executor.ts line ~90, invocation.ts line ~40
- Fix scheduled for P30-31

Next Phase: P03a (Verification of P03)
```
