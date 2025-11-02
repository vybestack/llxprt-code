# Phase 03: Schema Stub

## Phase ID
`PLAN-20251013-AUTOCOMPLETE.P03`

## Prerequisites
- P02a completed

## Implementation Tasks

### Files to Modify / Create
- `packages/cli/src/ui/commands/schema/types.ts`
  - Create new file exporting the TypeScript definitions for `LiteralArgument`, `ValueArgument`, `CommandArgumentSchema`, matching pseudocode **ArgumentSchema.md lines 1-6**.
  - Include comment:
    ```typescript
    /**
     * @plan:PLAN-20250214-AUTOCOMPLETE.P03
     * @requirement:REQ-001
     * @pseudocode ArgumentSchema.md lines 1-6
     * - Line 1: LiteralArgument structure (value, description, next)
     * - Line 2: ValueArgument structure (name, description, options, completer, hint, next)
     * - Line 3: Option structure definition
     * - Line 4: CompleterFn signature
     * - Line 5: HintFn signature
     * - Line 6: Union CommandArgumentSchema type
     */
    ```
  - Implement types only (no runtime logic).
- `packages/cli/src/ui/commands/schema/index.ts`
  - Export the types and a placeholder `createCompletionHandler` throwing `new Error('NotImplemented: P04')` for now.
  - Comment referencing pseudocode **lines 71-90** (acknowledging pending implementation).
- `packages/cli/src/ui/hooks/useSlashCompletion.tsx`
  - Add import for upcoming handler and TODO reference without using it yet.
  - Comment referencing pseudocode **lines 71-90** noting integration pending later phases.

### Behavioral Constraints
- No production behavior change; tests must remain green.
- Ensure `NotImplemented` error is explicit so P04 tests detect missing implementation.

## Verification Commands

```bash
npm run typecheck -- --filter cli
rg "@plan:PLAN-20250214-AUTOCOMPLETE.P03" packages/cli/src/ui
```

## Manual Verification Checklist
- [ ] Types defined exactly as pseudocode lines 1-6
- [ ] Placeholder handler exported but unused
- [ ] No runtime behavior change

## Success Criteria
- Schema types available for TDD phases with plan markers recorded.

## Failure Recovery
- Revert changes and reapply carefully if typecheck fails.

## Phase Completion Marker
- Create `project-plans/autocomplete/.completed/P03.md` capturing verification outputs.
