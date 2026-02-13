# Phase 13: /key Commands Stub

## Phase ID

`PLAN-20260211-SECURESTORE.P13`

## Prerequisites

- Required: Phase 12a completed
- Verification: `ls .completed/P12a.md`
- Expected: ProviderKeyStorage implemented and tested

## Requirements Implemented (Expanded)

### R12.1: Subcommand Parsing

**Full Text**: When the user enters `/key` followed by arguments, the command handler shall split the arguments by whitespace and check the first token against the subcommand names: `save`, `load`, `show`, `list`, `delete`.
**Behavior (stub)**: Parsing logic structure exists, subcommand dispatch is skeletal.

## Implementation Tasks

### Files to Modify

- `packages/cli/src/ui/commands/keyCommand.ts` — UPDATE existing command
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P13`
  - ADD: Subcommand parsing structure
  - ADD: Handler function stubs for save, load, show, list, delete
  - KEEP: Existing legacy behavior (lines 19-50) as fallback path
  - Handler stubs throw NotYetImplemented or return with placeholder message
  - Maximum ~80 lines added

### Stub Structure

The existing keyCommand.ts has ~51 lines handling `/key <raw-key>`. Extend it with:

```typescript
// Subcommand dispatch structure (stub)
const SUBCOMMANDS = ['save', 'load', 'show', 'list', 'delete'] as const;

// In action handler:
// 1. Trim args
// 2. Split by whitespace
// 3. Check first token against SUBCOMMANDS
// 4. If match → dispatch to handler (stub)
// 5. If no match → existing legacy behavior
```

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-SECURESTORE.P13
 * @requirement R12.1
 */
```

## Verification Commands

```bash
# 1. File modified
grep -c "@plan.*SECURESTORE.P13" packages/cli/src/ui/commands/keyCommand.ts
# Expected: 2+

# 2. Subcommand names present
grep "save.*load.*show.*list.*delete\|SUBCOMMANDS" packages/cli/src/ui/commands/keyCommand.ts

# 3. TypeScript compiles
npm run typecheck

# 4. Legacy behavior preserved
grep -c "updateActiveProviderApiKey\|legacyKey\|setApiKey" packages/cli/src/ui/commands/keyCommand.ts
# Expected: 1+ (legacy path still exists)

# 5. No TODO comments
grep "TODO" packages/cli/src/ui/commands/keyCommand.ts
```

## Structural Verification Checklist

- [ ] keyCommand.ts modified (not replaced)
- [ ] Subcommand parsing structure present
- [ ] Legacy behavior preserved as fallback
- [ ] TypeScript compiles
- [ ] Plan markers present

## Semantic Verification Checklist (MANDATORY)

1. **Is the subcommand dispatch structure correct?**
   - [ ] `SUBCOMMANDS` array/constant contains `save`, `load`, `show`, `list`, `delete`
   - [ ] Argument string is trimmed before parsing (R12.6)
   - [ ] First token is matched case-sensitively against subcommand names (R12.5)
   - [ ] Matched token dispatches to corresponding handler function

2. **Do all handler stubs exist with correct signatures?**
   - [ ] `handleSave(args, context)` stub present
   - [ ] `handleLoad(args, context)` stub present
   - [ ] `handleShow(args, context)` stub present
   - [ ] `handleList(args, context)` stub present
   - [ ] `handleDelete(args, context)` stub present
   - [ ] Each accepts the expected arguments (remaining tokens, command context)

3. **Is the legacy fallback path preserved?**
   - [ ] When first token does not match a subcommand → existing `/key <raw-key>` behavior runs (R12.3)
   - [ ] When no arguments → existing status display runs (R12.4)
   - [ ] Legacy code lines NOT deleted or commented out

4. **Do handler stubs throw NotYetImplemented?**
   - [ ] Each handler stub throws or returns a "not yet implemented" indicator
   - [ ] Stubs do NOT contain placeholder logic that could be mistaken for real implementation
   - [ ] No `console.log("TODO")` patterns

5. **Is the autocomplete stub present?**
   - [ ] Autocomplete function exists or has a stub entry point
   - [ ] Returns empty array (no suggestions yet)

6. **Are TDD tests writable against this stub?**
   - [ ] Dispatch structure is testable (subcommand → handler mapping)
   - [ ] Legacy fallback path is testable
   - [ ] Handler stubs produce predictable outputs (errors/throws) that tests can assert on

## Failure Recovery

1. `git checkout -- packages/cli/src/ui/commands/keyCommand.ts`
2. Re-run Phase 13

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P13.md`
