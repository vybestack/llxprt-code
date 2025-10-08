# Phase 15: System Integration

## Phase ID
`PLAN-20250117-SUBAGENTCONFIG.P15`

## Prerequisites
- Phase 14 completed
- All commands fully implemented
- All tests passing
- Expected files:
  - `packages/core/src/config/subagentManager.ts` (complete)
  - `packages/cli/src/ui/commands/subagentCommand.ts` (complete)

## Implementation Tasks

### 1. Register Command in BuiltinCommandLoader

**File**: `packages/cli/src/services/BuiltinCommandLoader.ts`

Add import and registration:

```typescript
// Add import at top of file
import { subagentCommand } from '../ui/commands/subagentCommand.js';

// In registerBuiltinCommands() method, add to commands array:
/**
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P15
 * @requirement:REQ-010
 */
commands.push(subagentCommand);
```

### 2. Initialize SubagentManager in Services

**File**: `packages/cli/src/services/BuiltinCommandLoader.ts`

Find where ProfileManager is initialized and add SubagentManager:

```typescript
/**
 * Initialize SubagentManager for command context
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P15
 * @requirement:REQ-010
 */
import { SubagentManager } from '@vybestack/llxprt-code-core';
import * as path from 'path';
import * as os from 'os';

// In the initialization section (where ProfileManager is created):
const llxprtDir = path.join(os.homedir(), '.llxprt');
const subagentsDir = path.join(llxprtDir, 'subagents');
const subagentManager = new SubagentManager(subagentsDir, profileManager);

// Add to context.services object (ensure services is instantiated first)
context.services.subagentManager = subagentManager; // @plan:PLAN-20250117-SUBAGENTCONFIG.P15 @requirement:REQ-010
```

### 3. Verify CommandContext Type

**File**: `packages/cli/src/ui/commands/types.ts`

The services interface should already include `profileManager` and optional `subagentManager` from Phase 06. Confirm the fields remain present and add integration-specific plan markers only if additional adjustments are required (for example, wiring runtime defaults or refining helper types).

If updates are needed, ensure inline comments retain existing `@plan:PLAN-20250117-SUBAGENTCONFIG.P06` markers or add new ones for P15 changes without removing earlier traceability.

### 3a. Update Mock Command Context Helper

**Files**:
- `packages/cli/src/test-utils/mockCommandContext.ts`
- `packages/cli/src/test-utils/mockCommandContext.test.ts`

Add support for the optional `subagentManager` service:
- Provide a sensible default stub (e.g., `{ subagentExists: vi.fn(), ... }`) when callers do not inject one.
- Expose overrides so tests (Phase 07/13) can supply fully initialized managers.
- Update existing tests to cover the new default behavior.

### 4. Export SubagentManager from Core Package

**File**: `packages/core/src/config/index.ts` (or equivalent export file)

Ensure SubagentManager is exported:

```typescript
/**
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P15
 * @requirement:REQ-010
 */
export { SubagentManager } from './subagentManager.js';
export type { SubagentConfig } from './types.js';
```

## Verification Commands

```bash
# Check command registered
grep -q "subagentCommand" packages/cli/src/services/BuiltinCommandLoader.ts || exit 1

# Check SubagentManager imported
grep -q "import.*SubagentManager" packages/cli/src/services/BuiltinCommandLoader.ts || exit 1

# CommandContext exposes optional subagentManager
grep -q "subagentManager\?:" packages/cli/src/ui/commands/types.ts || exit 1

# Mock command context helper supports the new service
grep -q "subagentManager" packages/cli/src/test-utils/mockCommandContext.ts || exit 1

# Check plan markers in BuiltinCommandLoader
grep -c "@plan:PLAN-20250117-SUBAGENTCONFIG.P15" packages/cli/src/services/BuiltinCommandLoader.ts
# Expected: 2+

# TypeScript compiles
npm run typecheck
# Expected: No errors

# All tests still pass
npm test
# Expected: All pass

# Build succeeds
npm run build
# Expected: No errors
```

## Manual Testing

After integration, test manually:

```bash
# Start the CLI
npm run dev

# Test commands:
/subagent list
# Expected: Shows message about no subagents

/subagent save testagent defaultprofile manual "You are a test agent"
# Expected: Success message

/subagent list
# Expected: Shows testagent

/subagent show testagent
# Expected: Shows full config

/subagent save aiagent defaultprofile auto "expert code reviewer"
# Expected: Generates prompt using LLM and saves

/subagent delete testagent
# Expected: Prompts for confirmation, then deletes

# Test autocomplete:
/subagent <TAB>
# Expected: Shows subcommands

/subagent show <TAB>
# Expected: Shows existing subagent names
```

## Success Criteria

- Command registered in BuiltinCommandLoader
- SubagentManager initialized and added to services
- CommandContext types and mock helpers expose `subagentManager`
- TypeScript compiles
- All tests pass
- Build succeeds
- Manual testing confirms all commands work
- Autocomplete functions

## Phase Completion Marker

```markdown
# Phase 15: System Integration Complete

**Completed**: [TIMESTAMP]

## Integration Points
- Command registered in BuiltinCommandLoader
- SubagentManager initialized in services
- Types updated (if needed)
- Exports added

## Verification
```
$ npm run typecheck
[OK] No errors

$ npm run build
[OK] Success

$ npm test
[OK] All tests passing

$ # Manual testing
/subagent list
[OK] Works

/subagent save test defaultprofile manual "prompt"
[OK] Works

/subagent save test2 defaultprofile auto "description"
[OK] Works (LLM integration)
```

## Next Phase
Ready for Phase 16: Final Verification
```

---

**CRITICAL**: Manual testing is essential. Ensure command is actually registered and accessible in the CLI.
