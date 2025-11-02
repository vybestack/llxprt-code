# Phase 06: SubagentCommand Stub Implementation

## Phase ID
`PLAN-20250117-SUBAGENTCONFIG.P06`

## Prerequisites
- Phase 05 completed
- Verification: `grep -r "@plan:PLAN-20250117-SUBAGENTCONFIG.P05" packages/core/src/config/subagentManager.ts`
- All SubagentManager tests passing
- Expected files from previous phase:
  - `packages/core/src/config/subagentManager.ts` (fully implemented)

## Implementation Tasks

### Update CommandContext Services

**File**: `packages/cli/src/ui/commands/types.ts`

Add SubagentManager and ProfileManager to the services object so the command and tests compile. Tag the new fields with plan/requirement markers using inline comments so traceability checks succeed:

```typescript
import { ProfileManager, SubagentManager } from '@vybestack/llxprt-code-core';

export interface CommandContext {
  services: {
    // existing fields...
    profileManager: ProfileManager; // @plan:PLAN-20250117-SUBAGENTCONFIG.P06 @requirement:REQ-002
    subagentManager?: SubagentManager; // @plan:PLAN-20250117-SUBAGENTCONFIG.P06 @requirement:REQ-002
  };
  // ...rest of interface
}
```

Also update any related helper types (for example `CommandServices`) to include the new fields so TypeScript stays consistent.

### File to Create

**File**: `packages/cli/src/ui/commands/subagentCommand.ts` (CREATE)

Create stub command structure with all subcommands:

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text } from 'ink';
import {
  SlashCommand,
  CommandContext,
  SlashCommandActionReturn,
  CommandKind,
} from './types.js';
import { Colors } from '../colors.js';

/**
 * /subagent save command - Manual mode only (auto mode in Phase 12)
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P06
 * @requirement:REQ-004, REQ-014
 * @pseudocode SubagentCommand.md lines [TO BE FILLED IN P08]
 */
const saveCommand: SlashCommand = {
  name: 'save',
  description: 'Save a subagent configuration',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    if (!context.services.subagentManager) { // @plan:PLAN-20250117-SUBAGENTCONFIG.P06 @requirement:REQ-004
      return {
        type: 'message',
        messageType: 'error',
        content: 'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
      };
    }

    // STUB: Return placeholder message
    return {
      type: 'message',
      messageType: 'info',
      content: 'Save command stub',
    };
  },
};

/**
 * /subagent list command
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P06
 * @requirement:REQ-005
 * @pseudocode SubagentCommand.md lines [TO BE FILLED IN P08]
 */
const listCommand: SlashCommand = {
  name: 'list',
  description: 'List all saved subagents',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    if (!context.services.subagentManager) { // @plan:PLAN-20250117-SUBAGENTCONFIG.P06 @requirement:REQ-005
      return {
        type: 'message',
        messageType: 'error',
        content: 'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
      };
    }

    // STUB: Return placeholder message
    return {
      type: 'message',
      messageType: 'info',
      content: 'List command stub',
    };
  },
};

/**
 * /subagent show command
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P06
 * @requirement:REQ-006
 * @pseudocode SubagentCommand.md lines [TO BE FILLED IN P08]
 */
const showCommand: SlashCommand = {
  name: 'show',
  description: 'Show detailed subagent configuration',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    if (!context.services.subagentManager) { // @plan:PLAN-20250117-SUBAGENTCONFIG.P06 @requirement:REQ-006
      return {
        type: 'message',
        messageType: 'error',
        content: 'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
      };
    }

    // STUB: Return placeholder message
    return {
      type: 'message',
      messageType: 'info',
      content: 'Show command stub',
    };
  },
};

/**
 * /subagent delete command
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P06
 * @requirement:REQ-007
 * @pseudocode SubagentCommand.md lines [TO BE FILLED IN P08]
 */
const deleteCommand: SlashCommand = {
  name: 'delete',
  description: 'Delete a subagent configuration',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    if (!context.services.subagentManager) { // @plan:PLAN-20250117-SUBAGENTCONFIG.P06 @requirement:REQ-007
      return {
        type: 'message',
        messageType: 'error',
        content: 'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
      };
    }

    // STUB: Return placeholder message
    return {
      type: 'message',
      messageType: 'info',
      content: 'Delete command stub',
    };
  },
};

/**
 * /subagent edit command
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P06
 * @requirement:REQ-008
 * @pseudocode SubagentCommand.md lines [TO BE FILLED IN P10]
 */
const editCommand: SlashCommand = {
  name: 'edit',
  description: 'Edit subagent configuration in system editor',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    if (!context.services.subagentManager) { // @plan:PLAN-20250117-SUBAGENTCONFIG.P06 @requirement:REQ-008
      return {
        type: 'message',
        messageType: 'error',
        content: 'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
      };
    }

    // STUB: Return placeholder message
    return {
      type: 'message',
      messageType: 'info',
      content: 'Edit command stub',
    };
  },
};

/**
 * /subagent parent command
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P06
 * @requirement:REQ-011
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
  // Completion will be added in Phase 09
  completion: undefined,
};
```

### Required Code Markers

Every subcommand MUST include:
```typescript
/**
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P06
 * @requirement:REQ-XXX
 * @pseudocode SubagentCommand.md lines [TO BE FILLED IN P08/P10]
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250117-SUBAGENTCONFIG.P06" packages/cli/src/ui/commands/subagentCommand.ts | wc -l
# Expected: 6+ occurrences

# Check all subcommands exist
grep -q "const saveCommand" packages/cli/src/ui/commands/subagentCommand.ts || exit 1
grep -q "const listCommand" packages/cli/src/ui/commands/subagentCommand.ts || exit 1
grep -q "const showCommand" packages/cli/src/ui/commands/subagentCommand.ts || exit 1
grep -q "const deleteCommand" packages/cli/src/ui/commands/subagentCommand.ts || exit 1
grep -q "const editCommand" packages/cli/src/ui/commands/subagentCommand.ts || exit 1

# Check parent command exports
grep -q "export const subagentCommand" packages/cli/src/ui/commands/subagentCommand.ts || exit 1

# CommandContext services expose new managers
rg -q "profileManager" packages/cli/src/ui/commands/types.ts || exit 1
rg -q "subagentManager\?" packages/cli/src/ui/commands/types.ts || exit 1

# TypeScript compiles
npm run typecheck
# Expected: No errors

# Check stubs return correct structure
grep -q "return {" packages/cli/src/ui/commands/subagentCommand.ts || exit 1
grep -q "type: 'message'" packages/cli/src/ui/commands/subagentCommand.ts || exit 1
```

### Manual Verification Checklist

- [ ] subagentCommand.ts created
- [ ] All 5 subcommands defined (save, list, show, delete, edit)
- [ ] Parent command exports subCommands array
- [ ] All commands return service-unavailable error when SubagentManager missing
- [ ] All commands are stubs returning placeholder messages
- [ ] No implementation logic yet
- [ ] All @plan:markers present
- [ ] All @requirement:markers present
- [ ] TypeScript compiles without errors
- [ ] No TODO or NotYetImplemented patterns

## Success Criteria

- Command file created with full structure
- Service-unavailable guard present when SubagentManager missing
- All subcommands stubbed
- Parent command with subCommands array
- TypeScript compiles
- All markers present
- Maximum 150 lines
- No tests yet (that's Phase 07)

## Failure Recovery

If TypeScript compilation fails:

1. Check imports from './types.js'
2. Verify SlashCommand interface usage
3. Check CommandContext parameter types
4. Ensure return type is SlashCommandActionReturn

## Phase Completion Marker

Create: `project-plans/subagentconfig/.completed/P06.md`

Contents:
```markdown
# Phase 06: SubagentCommand Stub Complete

**Completed**: [TIMESTAMP]

## Files Created
- packages/cli/src/ui/commands/subagentCommand.ts ([LINE_COUNT] lines)

## Commands Created
- saveCommand (stub)
- listCommand (stub)
- showCommand (stub)
- deleteCommand (stub)
- editCommand (stub)
- subagentCommand (parent, exports all subcommands)

## Verification
```
$ npm run typecheck
[OK] No errors

$ grep -c "@plan:PLAN-20250117-SUBAGENTCONFIG.P06" packages/cli/src/ui/commands/subagentCommand.ts
6+

$ grep -c "const.*Command.*SlashCommand" packages/cli/src/ui/commands/subagentCommand.ts
5
```

## Next Phase
Ready for Phase 07: SubagentCommand TDD (Basic Commands)
```

---

**CRITICAL**: This phase creates structure only. No logic implementation. Stubs return simple placeholder messages. Implementation happens in Phase 08, tests in Phase 07.
