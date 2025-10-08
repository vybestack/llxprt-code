# Phase 09: Advanced Features Stub (Edit & Autocomplete)

## Phase ID
`PLAN-20250117-SUBAGENTCONFIG.P09`

## Prerequisites
- Phase 08 completed
- All basic command tests passing
- Expected files:
  - `packages/cli/src/ui/commands/subagentCommand.ts` (basic commands implemented)

## Implementation Tasks

### Files to Modify

**File**: `packages/cli/src/ui/commands/subagentCommand.ts`

Add stub implementations for:
1. Edit command functionality
2. Multi-level autocomplete

### 1. Edit Command Stub Enhancement

Keep editCommand as stub but ensure structure is correct for Phase 10:

```typescript
/**
 * /subagent edit command
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P09
 * @requirement:REQ-008
 * @pseudocode SubagentCommand.md lines [TO BE FILLED IN P11]
 */
const editCommand: SlashCommand = {
  name: 'edit',
  description: 'Edit subagent configuration in system editor',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    // STUB: To be implemented in Phase 11
    return {
      type: 'message',
      messageType: 'info',
      content: 'Edit command will be implemented in Phase 11',
    };
  },
};
```

### 2. Autocomplete Stub

Add completion function to parent command:

```typescript
/**
 * /subagent parent command with autocomplete
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P09
 * @requirement:REQ-009, REQ-011
 * @pseudocode SubagentCommand.md lines [TO BE FILLED IN P11]
 */
export const subagentCommand: SlashCommand = {
  name: 'subagent',
  description: 'Manage subagent configurations.',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    saveCommand,
    listCommand,
    showCommand,
    deleteCommand,
    editCommand,
  ],
  /**
   * Multi-level autocomplete
   * STUB: Returns empty array, implementation in Phase 11
   */
  completion: async (
    context: CommandContext,
    partialArg: string
  ): Promise<string[]> => {
    if (!context.services.subagentManager) { // @plan:PLAN-20250117-SUBAGENTCONFIG.P09 @requirement:REQ-009
      return [];
    }

    // STUB: Return empty array
    return [];
  },
};
```

## Verification Commands

```bash
# Check plan markers updated to P09
grep -c "@plan:PLAN-20250117-SUBAGENTCONFIG.P09" packages/cli/src/ui/commands/subagentCommand.ts
# Expected: 2+

# Check completion function exists
grep -q "completion: async" packages/cli/src/ui/commands/subagentCommand.ts || exit 1

# TypeScript compiles
npm run typecheck
# Expected: No errors

# Basic tests still pass
npm test -- subagentCommand.test.ts --grep "basic"
# Expected: All pass
```

## Success Criteria

- Edit command structure updated
- Completion function added (stub)
- TypeScript compiles
- Basic tests still pass
- Ready for Phase 10 (TDD for advanced features)

## Phase Completion Marker

```markdown
# Phase 09: Advanced Features Stub Complete

**Completed**: [TIMESTAMP]

## Changes Made
- Edit command structure verified
- Completion function stub added
- Plan markers updated to P09

## Next Phase
Ready for Phase 10: Advanced Features TDD
```

---

**Note**: This is a small phase just ensuring structure is ready for TDD and implementation of edit and autocomplete.
