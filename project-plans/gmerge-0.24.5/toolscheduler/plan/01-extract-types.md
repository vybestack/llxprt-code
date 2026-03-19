# Phase 01: Extract Type Definitions

## Phase ID

`PLAN-20260302-TOOLSCHEDULER.P01`

## Prerequisites

- Required: Phase 00a (preflight verification) completed
- Verification: All dependencies and types verified to exist
- Expected files: coreToolScheduler.ts exists with type definitions

## Requirements Implemented (Expanded)

### TS-TYPE-001: Type Extraction with Backward Compatibility

**Full Requirement Text**:  
When a consumer imports a ToolCall state type, the system shall provide that type from `scheduler/types.ts` without requiring changes to existing import statements. The type definitions shall be centralized in a single module while maintaining backward compatibility with existing imports from `coreToolScheduler.ts`.

**Behavior (EARS Format)**:
- **GIVEN:** Existing code imports types like `ToolCall`, `ScheduledToolCall`, `ConfirmHandler` from `packages/core/src/core/coreToolScheduler.ts`
- **WHEN:** Type definitions are extracted to `packages/core/src/scheduler/types.ts` in Phase 01
- **THEN:** The types are successfully moved to the new location
- **AND:** Types remain exported from `coreToolScheduler.ts` (re-exports added in Phase 02)
- **AND:** New code can import directly from `scheduler/types.ts`
- **AND:** TypeScript compilation succeeds without errors
- **AND:** No breaking changes to existing code

**Why This Matters**: Centralizing type definitions enables reuse across multiple modules (scheduler, tool-executor, tests) while maintaining backward compatibility prevents breaking hundreds of existing import statements in the codebase. This is fundamental to safe refactoring.

**Test Evidence**: Type extraction verified by:
- TypeScript compilation success (no import errors)
- `grep` verification that types exist in both old and new locations (Phase 01 only)
- Module graph analysis shows no circular dependencies

---

### TS-TYPE-003: Circular Dependency Prevention

**Full Requirement Text**:  
The system shall prevent circular dependency errors when `scheduler/types.ts` is imported by any module. Type imports must use only leaf modules (direct source files) and never import from barrel exports (index.js files) to avoid circular dependency chains.

**Behavior (EARS Format)**:
- **GIVEN:** `scheduler/types.ts` needs to import types like `AnyDeclarativeTool`, `AnyToolInvocation`, `ToolCallRequestInfo`
- **WHEN:** The types module is created with imports
- **THEN:** All imports use leaf module paths (e.g., `from '../tools/tool.js'`, `from '../core/turn.js'`)
- **AND:** NO imports from barrel exports (e.g., `from '../index.js'`)
- **AND:** All imports use `import type { ... }` syntax (type-only imports)
- **AND:** Build succeeds without module resolution errors
- **AND:** `madge --circular` reports no cycles

**Why This Matters**: Circular dependencies cause build failures in ES modules and runtime initialization errors. The types module is imported by many other modules (scheduler, executor, tests), so it MUST be at the bottom of the dependency graph with no upward references. Importing from index.js creates cycles because index.js re-exports from modules that import types.

**Test Evidence**: Circular dependency prevention verified by:
- `grep "from.*index\.js"` returns no matches in types.ts
- `npx madge --circular` reports zero cycles
- TypeScript build succeeds
- `import type` syntax used for all imports (no runtime dependencies)

## Implementation Tasks

### Files to Create

#### 1. `packages/core/src/scheduler/types.ts`

Extract ALL ToolCall state types and handler types from coreToolScheduler.ts.

**MUST include: `@plan PLAN-20260302-TOOLSCHEDULER.P01`**

**What to Extract:**

```typescript
/**
 * @plan PLAN-20260302-TOOLSCHEDULER.P01
 * @requirement TS-TYPE-001
 * 
 * CoreToolScheduler type definitions.
 * These types define the state machine for tool execution.
 */

import type { AnyDeclarativeTool } from '../tools/tool.js'; // CORRECT: leaf module
import type { AnyToolInvocation } from '../tools/tools.js'; // CORRECT: leaf module
import type { ToolCallRequestInfo, ToolCallResponseInfo } from '../core/turn.js'; // CORRECT: leaf module
import type { ToolConfirmationOutcome } from '../tools/tool-confirmation-types.js'; // CORRECT: leaf module
import type { AnsiOutput } from '../utils/terminalSerializer.js'; // CORRECT: leaf module

// DO NOT import from '../index.js' - this creates circular dependencies

// ToolCall State Types (copy EXACTLY from coreToolScheduler.ts)
export type ValidatingToolCall = {
  status: 'validating';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

export type ScheduledToolCall = {
  status: 'scheduled';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

export type ExecutingToolCall = {
  status: 'executing';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  pid?: number; // For shell tools
  liveOutput?: string | AnsiOutput;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

export type SuccessfulToolCall = {
  status: 'success';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  response: ToolCallResponseInfo;
  durationMs?: number;
  outcome?: ToolConfirmationOutcome;
};

export type ErroredToolCall = {
  status: 'error';
  request: ToolCallRequestInfo;
  response: ToolCallResponseInfo;
  tool?: AnyDeclarativeTool;
  durationMs?: number;
  outcome?: ToolConfirmationOutcome;
};

export type CancelledToolCall = {
  status: 'cancelled';
  request: ToolCallRequestInfo;
  response: ToolCallResponseInfo;
  tool?: AnyDeclarativeTool;
  durationMs?: number;
  outcome?: ToolConfirmationOutcome;
};

export type WaitingToolCall = {
  status: 'awaiting_approval';
  request: ToolCallRequestInfo;
  tool: AnyDeclarativeTool;
  invocation: AnyToolInvocation;
  shouldConfirmExecute?: boolean;
  confirmationDetails?: ToolCallConfirmationDetails;
  outcome?: ToolConfirmationOutcome;
  startTime?: number;
};

// Union Types
export type ToolCall =
  | ValidatingToolCall
  | ScheduledToolCall
  | ExecutingToolCall
  | SuccessfulToolCall
  | ErroredToolCall
  | CancelledToolCall
  | WaitingToolCall;

export type CompletedToolCall = SuccessfulToolCall | CancelledToolCall | ErroredToolCall;

export type Status = ToolCall['status'];

// Handler Types
export type ConfirmHandler = (
  toolCall: WaitingToolCall
) => Promise<ToolConfirmationOutcome>;

export type OutputUpdateHandler = (
  callId: string,
  output: string | AnsiOutput
) => void;

export type AllToolCallsCompleteHandler = (
  completedToolCalls: CompletedToolCall[]
) => Promise<void>;

export type ToolCallsUpdateHandler = (toolCalls: ToolCall[]) => void;

// Internal Types (also extract these)
export interface QueuedRequest {
  request: ToolCallRequestInfo | ToolCallRequestInfo[];
  signal: AbortSignal;
  resolve: () => void;
  reject: (reason?: Error) => void;
}

export interface PolicyContext {
  // Extract the PolicyContext interface if it exists inline in coreToolScheduler
  // If it's imported from policy/types.ts, do NOT re-export it
}
```

**CRITICAL Circular Dependency Rules:**
1. Import ONLY from leaf modules (tool.js, tools.js, turn.js, tool-confirmation-types.js)
2. Use `import type { ... }` syntax (type-only imports)
3. NEVER import from `../index.js` or any barrel export
4. If a type is already exported from another module, import it (don't duplicate)

### Files to Modify

#### 1. `packages/core/src/core/coreToolScheduler.ts`

**DO NOT DELETE THE TYPE DEFINITIONS YET** (that happens in Phase 02 after re-exports are added).

For now, just add a comment marker at the top of the type definition section:

```typescript
// NOTE: These types are being migrated to packages/core/src/scheduler/types.ts
// @plan PLAN-20260302-TOOLSCHEDULER.P01
// They will be removed in Phase 02 after re-exports are added for backward compatibility.

export type ValidatingToolCall = {
  // ... existing definition ...
};
```

### Required Code Markers

Every type export in scheduler/types.ts MUST include:

```typescript
/**
 * @plan PLAN-20260302-TOOLSCHEDULER.P01
 * @requirement TS-TYPE-001
 */
```

## Subagent Prompt

**READ FIRST (Context Recovery):**

Before implementing this phase, read these files in order:
1. `project-plans/gmerge-0.24.5/toolscheduler/design.md` — Technical design (section 2.1, 4.1, 7.1)
2. `project-plans/gmerge-0.24.5/toolscheduler/requirements.md` — Requirements TS-TYPE-001, TS-TYPE-003
3. `packages/core/src/core/coreToolScheduler.ts` lines 1-500 — Type definitions and imports to extract
4. `project-plans/gmerge-0.24.5/toolscheduler/plan/00a-preflight-verification.md` — Preflight results (if completed)
5. This phase file (current file) — Implementation instructions

**Context:** This phase extracts all ToolCall state types and handler types from the 2,139-line coreToolScheduler.ts into a new dedicated types module. This is the first step in breaking up the monolith. The types are pure data definitions with no logic, making them safe to extract first.

```typescript
You are implementing Phase 01 of the CoreToolScheduler refactoring.

CONTEXT: You are extracting type definitions from a 2,139-line monolith to a new module.

TASK: Create packages/core/src/scheduler/types.ts

WHAT TO DO:
1. Create directory: packages/core/src/scheduler/
2. Create file: packages/core/src/scheduler/types.ts
3. Copy ALL type definitions from coreToolScheduler.ts:
   - ValidatingToolCall, ScheduledToolCall, ExecutingToolCall
   - SuccessfulToolCall, ErroredToolCall, CancelledToolCall, WaitingToolCall
   - ToolCall (union type)
   - CompletedToolCall (union type)
   - Status (discriminant type)
   - ConfirmHandler, OutputUpdateHandler, AllToolCallsCompleteHandler, ToolCallsUpdateHandler
   - QueuedRequest interface
   - PolicyContext interface (if defined inline)

4. Add file header comment with @plan marker
5. Import types from LEAF MODULES ONLY:
   - from '../tools/tool.js' (NOT from index.js)
   - from '../tools/tools.js'
   - from '../core/turn.js'
   - from '../tools/tool-confirmation-types.js'
   - from '../utils/terminalSerializer.js'
6. Use "import type { ... }" syntax for all imports

CRITICAL RULES:
- DO NOT import from '../index.js' (creates circular dependency)
- DO NOT modify coreToolScheduler.ts yet (that's Phase 02)
- DO NOT change any type definitions (copy exactly)
- DO include @plan and @requirement markers in JSDoc comments

EXPECTED OUTPUT:
- New file: packages/core/src/scheduler/types.ts (~130 lines)
- No modifications to existing files yet
- File compiles with TypeScript strict mode

FORBIDDEN:
- Importing from index.js or barrel exports
- Modifying type definitions
- Adding new types not in coreToolScheduler
- Removing types from coreToolScheduler (that's Phase 02)
```

## Verification Commands

### Automated Checks

```bash
# Check file was created
test -f packages/core/src/scheduler/types.ts || exit 1
echo "[OK] scheduler/types.ts created"

# Check plan markers exist
grep -r "@plan PLAN-20260302-TOOLSCHEDULER.P01" packages/core/src/scheduler/types.ts
echo "[OK] Plan markers present"

# Check no imports from index.js (circular dependency)
grep "from.*index\.js" packages/core/src/scheduler/types.ts && {
  echo " FAIL: Found import from index.js (circular dependency)"
  exit 1
} || echo "[OK] No circular dependencies"

# Check uses type-only imports
grep "^import type" packages/core/src/scheduler/types.ts | wc -l
echo "[OK] Type-only imports used"

# Check TypeScript compiles
npm run typecheck || exit 1
echo "[OK] TypeScript compilation succeeds"

# Count extracted types
grep "^export type" packages/core/src/scheduler/types.ts | wc -l
echo "Expected: ~13 type exports"

# Verify types still exist in coreToolScheduler (not removed yet)
grep "^export type ValidatingToolCall" packages/core/src/core/coreToolScheduler.ts || {
  echo " FAIL: Types were removed from coreToolScheduler.ts (shouldn't happen until Phase 02)"
  exit 1
}
echo "[OK] Types still in coreToolScheduler.ts (correct for Phase 01)"
```

### Manual Verification Checklist

- [ ] scheduler/types.ts file created
- [ ] Directory packages/core/src/scheduler/ created
- [ ] All ToolCall state types extracted
- [ ] All handler types extracted
- [ ] QueuedRequest interface extracted
- [ ] No imports from index.js or barrel exports
- [ ] All imports use "import type" syntax
- [ ] Plan markers (@plan PLAN-20260302-TOOLSCHEDULER.P01) present
- [ ] Requirement markers (@requirement TS-TYPE-001) present
- [ ] TypeScript compilation succeeds
- [ ] Types NOT removed from coreToolScheduler.ts yet

## Structural Verification Checklist

- [ ] File exists: `packages/core/src/scheduler/types.ts`
- [ ] Directory exists: `packages/core/src/scheduler/`
- [ ] All 9 ToolCall state types exported: ValidatingToolCall, ScheduledToolCall, ExecutingToolCall, SuccessfulToolCall, ErroredToolCall, CancelledToolCall, WaitingToolCall, ToolCall (union), CompletedToolCall (union)
- [ ] All 4 handler types exported: ConfirmHandler, OutputUpdateHandler, AllToolCallsCompleteHandler, ToolCallsUpdateHandler
- [ ] Status type exported (discriminant union)
- [ ] QueuedRequest interface exported
- [ ] File header includes JSDoc with @plan marker
- [ ] All imports use `import type { ... }` syntax (verified by grep)
- [ ] No imports from `index.js` or barrel exports (verified by grep)
- [ ] TypeScript compilation succeeds (`npm run typecheck` passes)
- [ ] Types still present in coreToolScheduler.ts (backward compatibility preserved)
- [ ] File size approximately 130 lines

## Semantic Verification Checklist

- [ ] Type definitions are exact copies from coreToolScheduler.ts (no modifications)
- [ ] Discriminated union works correctly (ToolCall type has proper status discriminant)
- [ ] All imported types resolve correctly (no "cannot find module" errors)
- [ ] Handler function signatures are complete (not using `any` types)
- [ ] Type-only imports prevent runtime circular dependencies
- [ ] Imports are from leaf modules only (tool.js, tools.js, turn.js - not re-exporting modules)
- [ ] No circular dependency warnings from TypeScript compiler
- [ ] Types can be successfully imported by other modules (verified by test import)
- [ ] Union types maintain structural compatibility with original definitions
- [ ] No breaking changes to existing code using these types

## Success Criteria

This phase passes when:

1. scheduler/types.ts created with all type definitions
2. No circular dependencies (no imports from index.js)
3. TypeScript compilation succeeds
4. All types copied exactly (no changes)
5. Plan markers present in scheduler/types.ts
6. Types still exist in coreToolScheduler.ts (backward compatibility preserved)

## Failure Recovery

If this phase fails:

1. Delete packages/core/src/scheduler/ directory
2. Re-run Phase 01 with corrected instructions
3. Verify no changes were made to coreToolScheduler.ts

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/toolscheduler/.completed/P01.md`

Contents:
```markdown
Phase: P01
Completed: [TIMESTAMP]
Files Created:
  - packages/core/src/scheduler/types.ts (~130 lines)
Files Modified: None
Verification: TypeScript compilation passed, no circular dependencies
```
