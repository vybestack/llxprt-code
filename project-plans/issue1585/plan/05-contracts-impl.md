# Phase 05: Contract Implementation

## Phase ID

`PLAN-20260608-ISSUE1585.P05`

## Purpose

Implement tool contract interfaces and package-local utilities needed by later move phases. All implementations are self-contained in packages/tools with zero core/cli/providers imports.

## Prerequisites

- Required: P04a completed (tests verified as behavioral).
- Artifacts: interface stubs and failing tests from P04.

## Requirements Implemented

### REQ-API-001, REQ-INTERFACE-OWNERSHIP, REQ-TEMPORARY-INTERFACES

**Full requirement blocks**: See `plan/requirements-appendix.md` → REQ-INTERFACE-OWNERSHIP, REQ-TEMPORARY-INTERFACES

**Behavior specification**:
- GIVEN: Behavioral tests are verified as contract tests
- WHEN: Contract interfaces and package-local utilities are implemented
- THEN: All contract tests pass; zero forbidden imports; ToolContext is narrow, not a service bag

**Why it matters**: Contract implementation with core leaks violates the dependency direction before any code moves, making later phases impossible.

## Implementation Tasks

### Step 1: Implement Interfaces

For each interface in `packages/tools/src/interfaces/`, add JSDoc method descriptions and any package-local type definitions. Interfaces remain TypeScript interfaces (no implementation code in interface files).

### Step 2: Implement Package-Local Utilities

Move or recreate these pure-utility modules in packages/tools (no core dependencies):

- `packages/tools/src/formatters/doubleEscapeUtils.ts` — copy self-contained portions; replace DebugLogger usage with package-local logger or no-op
- `packages/tools/src/formatters/toolNameUtils.ts` — pure utility, no core deps after removing DEFAULT_AGENT_ID reference
- `packages/tools/src/formatters/toolIdNormalization.ts` — replace debugLogger with package-local or no-op
- `packages/tools/src/formatters/IToolFormatter.ts` — interface definition only
- `packages/tools/src/formatters/ToolFormatter.ts` — implementation, no core deps
- `packages/tools/src/formatters/ToolIdStrategy.ts` — interface + implementation, no core deps
- `packages/tools/src/formatters/index.ts` — barrel

- `packages/tools/src/utils/tool-confirmation-types.ts` — pure types
- `packages/tools/src/utils/tool-error.ts` — ToolErrorType enum
- `packages/tools/src/utils/tool-names.ts` — tool name constants
- `packages/tools/src/types/tool-context.ts` — ToolContext interface
- `packages/tools/src/utils/mediaUtils.ts` — replace MediaBlock import with package-local type
- `packages/tools/src/utils/tool-key-storage-types.ts` — ToolKeyRegistryEntry, maskKeyForDisplay, isValidToolKeyName, getToolKeyEntry, getSupportedToolNames

### Step 3: Update index.ts

Export all interfaces and utilities from `packages/tools/src/index.ts`.

### Files To Create Or Modify

- Create: all formatters and utils files listed above
- Modify: `packages/tools/src/index.ts`
- Create: `project-plans/issue1585/.completed/P05.md`

## Verification Commands

```bash
# Typecheck
npm run typecheck --workspace @vybestack/llxprt-code-tools
# Run contract tests (should now pass)
npm run test --workspace @vybestack/llxprt-code-tools
# Forbidden import scan
rg -n "@vybestack/llxprt-code-core\|packages/core/src\|@vybestack/llxprt-code-providers\|packages/providers/src\|packages/cli/src" packages/tools/src -g "*.ts"
# Expected: zero matches
```

## Semantic Verification Checklist

- [ ] All interface stubs have proper method signatures.
- [ ] Package-local utilities have zero core imports.
- [ ] Contract tests pass.
- [ ] ToolContext is narrow, not a service bag.

## Success Criteria

- Typecheck and tests pass in tools package.
- Zero forbidden imports.
- Contract tests pass.

## Failure Recovery

Return to P05 to fix implementations that accidentally import core.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P05.md` with files created, test results, and forbidden import scan.
