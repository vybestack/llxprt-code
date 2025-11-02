# Phase 08: SubagentCommand Basic Implementation

## Phase ID
`PLAN-20250117-SUBAGENTCONFIG.P08`

## Prerequisites
- Phase 07 completed
- All basic command tests failing naturally due to stub implementation
- Expected files from previous phase:
  - `packages/cli/src/ui/commands/subagentCommand.ts` (stub with service checks)
  - `packages/cli/src/ui/commands/test/subagentCommand.test.ts` (behavioral tests for basic commands)

## Implementation Tasks

The goal of this phase is to implement the core logic for the four basic `/subagent` subcommands (`save`, `list`, `show`, `delete`) as defined in the detailed pseudocode from Phase 02.

All logic must be implemented by referencing the corresponding sections of `project-plans/subagentconfig/analysis/pseudocode/SubagentCommand.md` line-by-line.

### File to Modify

**File**: `packages/cli/src/ui/commands/subagentCommand.ts`

Replace the placeholder "stub" action in each command with the correct implementation logic.

**Remember**: 
- All code edited in this file requires `@plan:PLAN-20250117-SUBAGENTCONFIG.P08` markers.
- Each command implements specific requirement(s) and needs `@requirement:REQ-XXX` markers.
- Error handling must be graceful and user-friendly. No `any` types.
- Interaction with services happens through `context.services.subagentManager`. Assume it's available as the tests will provide it.
- Follow the detailed pseudocode logic, especially for argument parsing and overwrite confirmation.

### 1. saveCommand Implementation

**Pseudocode Reference**: `SubagentCommand.md`, lines 1-134.

**Key Logic to Implement**:
- Parse arguments using the defined regex to extract `name`, `profile`, `mode` ('manual'), and `input` (system prompt).
- Implement `handleManualMode` (lines 61-66) and `saveSubagent` (lines 67-93) helper functions, which are pseudofunctions for the logic flow.
- Check for existing subagent and prompt for overwrite confirmation using `context.overwriteConfirmed` if needed (lines 110-127).
- Call `context.services.subagentManager.saveSubagent(...)` to perform the save operation.
- Return appropriate success or error messages. The message should indicate if the agent was "created" or "updated".

`saveCommand` implements `@requirement:REQ-004`, `@requirement:REQ-014`.

### 2. listCommand Implementation

**Pseudocode Reference**: `SubagentCommand.md`, lines 135-182.

**Key Logic to Implement**:
- Call `context.services.subagentManager.listSubagents()`.
- If the list is empty, return an informational message: "No subagents found. Use '/subagent save' to create one."
- If the list has items, for each item, call `context.services.subagentManager.loadSubagent(name)`.
- Format the output with the name, profile, and creation date.
- Sort the list by `createdAt` timestamp (oldest first).

`listCommand` implements `@requirement:REQ-005`.

### 3. showCommand Implementation

**Pseudocode Reference**: `SubagentCommand.md`, lines 183-234.

**Key Logic to Implement**:
- Validate that a `name` argument is provided.
- Call `context.services.subagentManager.loadSubagent(name)`.
- Format the full configuration into a user-friendly message including `name`, `profile`, `createdAt`, `updatedAt`, and `systemPrompt`.
- The `systemPrompt` should be clearly separated (e.g., with a line of dashes) for easy reading.
- Handle the `SubagentConfig` type correctly (imported from core).

`showCommand` implements `@requirement:REQ-006`.

### 4. deleteCommand Implementation

**Pseudocode Reference**: `SubagentCommand.md`, lines 235-291.

**Key Logic to Implement**:
- Validate that a `name` argument is provided.
- Call `context.services.subagentManager.subagentExists(name)` to check.
- If it doesn't exist, return a user-friendly error.
- If it exists and `context.overwriteConfirmed` is false, return a `confirm_action` (lines 265-274) with a warning prompt.
- If confirmed, call `context.services.subagentManager.deleteSubagent(name)`.
- Return a success message on deletion.

`deleteCommand` implements `@requirement:REQ-007`.

## Required Code Markers

Every modified command action and any helper functions it uses MUST include:

```typescript
/**
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P08
 * @requirement:REQ-XXX
 * @pseudocode SubagentCommand.md lines X-Y
 */
 ```

## Verification Commands

```bash
# Check plan markers updated to P08
grep -r "@plan:PLAN-20250117-SUBAGENTCONFIG.P08" packages/cli/src/ui/commands/subagentCommand.ts | wc -l
# Expected: 8+ occurrences (at least one per command action)

# Check requirement markers for basic commands
grep -r "@requirement:REQ-004" packages/cli/src/ui/commands/subagentCommand.ts | wc -l
# Expected: 2+ (saveCommand)

grep -r "@requirement:REQ-005" packages/cli/src/ui/commands/subagentCommand.ts | wc -l
# Expected: 1+ (listCommand)

grep -r "@requirement:REQ-006" packages/cli/src/ui/commands/subagentCommand.ts | wc -l
# Expected: 1+ (showCommand)

grep -r "@requirement:REQ-007" packages/cli/src/ui/commands/subagentCommand.ts | wc -l
# Expected: 1+ (deleteCommand)

# All basic command tests should now PASS
npm test -- --grep "subagentCommand - basic"
# Expected: All 13 tests pass (from Phase 07)

# TypeScript should still compile without errors
npm run typecheck
# Expected: No errors

# Verify no stub messages remain
grep -r "stub" packages/cli/src/ui/commands/subagentCommand.ts
# Expected: No matches for action logic
```

## Success Criteria

- saveCommand implemented for manual mode with argument parsing and overwrite protection
- listCommand implemented to show subagents with details and sort by creation date
- showCommand implemented to display full configuration
- deleteCommand implemented with existence check and overwrite confirmation
- All tests from Phase 07 now pass
- TypeScript compiles with strict mode
- Error messages are user-friendly
- All `@plan:` and `@requirement:` markers are present

## Failure Recovery

If tests fail:

1. Identify which specific test is failing
2. Compare implementation logic to the corresponding pseudocode section
3. Check if the SubagentManager is being called correctly via `context.services`
4. Verify error handling matches the strategy outlined in the pseudocode
5. Ensure the correct `SlashCommandActionReturn` type is being used

## Phase Completion Marker

Create: `project-plans/subagentconfig/.completed/P08.md`

```markdown
# Phase 08: SubagentCommand Basic Implementation Complete

**Completed**: [TIMESTAMP]

## Commands Implemented
- saveCommand (manual mode only)
- listCommand
- showCommand
- deleteCommand

## Test Results
All basic command tests passing

## Next Phase
Ready for Phase 09: Advanced Features Stub (edit, autocomplete)
```