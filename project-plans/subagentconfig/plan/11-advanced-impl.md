# Phase 11: Advanced Features Implementation (Edit & Autocomplete)

## Phase ID
`PLAN-20250117-SUBAGENTCONFIG.P11`

## Prerequisites
- Phase 10 completed
- Tests for edit and autocomplete failing naturally
- Expected files:
  - `packages/cli/src/ui/commands/test/subagentCommand.test.ts` (with advanced tests)

## Implementation Tasks

### File to Modify

**File**: `packages/cli/src/ui/commands/subagentCommand.ts`

Implement edit command and multi-level autocomplete.

### 1. Edit Command Implementation

**Pattern:** Follow `packages/cli/src/ui/components/shared/text-buffer.ts` approach

```typescript
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * /subagent edit command
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P11
 * @requirement:REQ-008
 * @pseudocode SubagentCommand.md lines 166-210
 * 
 * Pattern: Uses spawnSync approach from text-buffer.ts
 */
const editCommand: SlashCommand = {
  name: 'edit',
  description: 'Edit subagent configuration in system editor',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    const name = args.trim();
    
    if (!name) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /subagent edit <name>',
      };
    }
    
    const { services } = context;
    const subagentManager = services.subagentManager; // @plan:PLAN-20250117-SUBAGENTCONFIG.P11 @requirement:REQ-008
    if (!subagentManager) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
      };
    }
    
    // Check if subagent exists
    const exists = await subagentManager.subagentExists(name);
    
    if (!exists) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Error: Subagent '${name}' not found.`,
      };
    }
    
    // Load current config
    const config = await subagentManager.loadSubagent(name);
    
    // Create temp file (like text-buffer.ts does)
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-edit-'));
    const filePath = path.join(tmpDir, `${name}.json`);
    
    try {
      // Write current config to temp file
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
      
      // Determine editor (like text-buffer.ts)
      const editor = process.env.VISUAL || process.env.EDITOR || 'vi';
      
      // Launch editor with spawnSync (BLOCKS until editor closes)
      const { status, error } = spawnSync(editor, [filePath], {
        stdio: 'inherit',
      });
      
      if (error) {
        throw error;
      }
      
      if (typeof status === 'number' && status !== 0) {
        throw new Error(`Editor exited with status ${status}`);
      }
      
      // Read edited content
      const editedContent = fs.readFileSync(filePath, 'utf8');
      
      // Parse and validate JSON
      let editedConfig: SubagentConfig;
      try {
        editedConfig = JSON.parse(editedContent);
      } catch (error) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Error: Invalid JSON after edit. Changes not saved.',
        };
      }
      
      // Validate required fields
      if (!editedConfig.name || !editedConfig.profile || !editedConfig.systemPrompt) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Error: Required fields missing. Changes not saved.',
        };
      }
      
      // Validate profile exists
      const profileValid = await subagentManager.validateProfileReference(editedConfig.profile);
      if (!profileValid) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Error: Profile '${editedConfig.profile}' not found. Changes not saved.`,
        };
      }
      
      // Save the edited config (updates updatedAt timestamp)
      await subagentManager.saveSubagent(
        editedConfig.name,
        editedConfig.profile,
        editedConfig.systemPrompt
      );
      
      return {
        type: 'message',
        messageType: 'info',
        content: React.createElement(
          Text,
          null,
          `Subagent `,
          React.createElement(Text, { color: Colors.AccentPurple }, name),
          ` updated successfully.`
        ),
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: error instanceof Error ? error.message : 'Failed to edit subagent',
      };
    } finally {
      // Cleanup temp file and directory (like text-buffer.ts)
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ignore */
      }
      try {
        fs.rmdirSync(tmpDir);
      } catch {
        /* ignore */
      }
    }
  },
};
```

### 2. Autocomplete Implementation

**PREREQUISITE**: Phase 01 MUST have resolved autocomplete system to support fullLine parameter.

Check `project-plans/subagentconfig/analysis/findings.md` for Phase 01 results.

**Implementation** (assuming Phase 01 success):

```typescript
/**
 * Multi-level autocomplete
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P11
 * @requirement:REQ-009
 * @pseudocode SubagentCommand.md lines 211-280
 * 
 * REQUIRES: Phase 01 completion system enhancement
 */
completion: async (
  context: CommandContext,
  partialArg: string,
  fullLine: string
): Promise<string[]> => {
  const subagentManager = context.services.subagentManager; // @plan:PLAN-20250117-SUBAGENTCONFIG.P11 @requirement:REQ-009
  if (!subagentManager) {
    return [];
  }

  // Parse fullLine to determine position
  const args = (fullLine ?? '').trim().split(/\s+/);
  const position = args.length - 1;
  
  // Level 1: Subcommand completion
  if (position === 1) {
    const subcommands = ['save', 'list', 'show', 'delete', 'edit'];
    return subcommands.filter(cmd => cmd.startsWith(partialArg));
  }
  
  const subcommand = args[1];

  // Level 2: Agent name completion for show/delete/edit
  if (position === 2 && ['show', 'delete', 'edit'].includes(subcommand)) {
    const subagents = await subagentManager.listSubagents();
    return subagents.filter(name => name.startsWith(partialArg));
  }
  
  // Level 3: Profile name completion for save
  if (position === 3 && subcommand === 'save') {
    const profiles = await context.services.profileManager.listProfiles();
    return profiles.filter(name => name.startsWith(partialArg));
  }
  
  // Level 4: Mode completion for save
  if (position === 4 && subcommand === 'save') {
    const modes = ['auto', 'manual'];
    return modes.filter(mode => mode.startsWith(partialArg));
  }
  
  // Beyond mode argument: no completion
  return [];
}
```

### 3. Update slashCommandProcessor Hook

**File**: `packages/cli/src/ui/hooks/slashCommandProcessor.ts`

Implement the logic required for the TDD hook test added in Phase 10:
- When invoking a command's `completion`, pass the `fullLine` string alongside `partialArg`.
- Ensure existing commands that only use the two-argument signature continue to work (third parameter is optional).
- Update any helper functions that construct the completion arguments so TypeScript understands the new call signature.
- Add `@plan:PLAN-20250117-SUBAGENTCONFIG.P11` markers on the updated lines for traceability.

Also update any directly affected command files (e.g., commands relying on the previous two-parameter signature) if they need to accept the optional third argument, even if they ignore it.

**If Phase 01 Failed:**

If Phase 01 could not resolve autocomplete system, this phase should NOT be reached.
Plan should be PAUSED at Phase 01 with documented blocker.

### 3. Import Requirements

**File**: `packages/cli/src/ui/commands/subagentCommand.ts`

Add required imports for edit command:

```typescript
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
```

**Note**: SubagentManager does NOT need to expose getSubagentPath. Edit command constructs temp file path independently, following text-buffer.ts pattern.

## Verification Commands

```bash
# Update plan markers to P11
grep -c "@plan:PLAN-20250117-SUBAGENTCONFIG.P11" packages/cli/src/ui/commands/subagentCommand.ts
# Expected: 2+

# slashCommandProcessor updated with plan marker for this phase
grep -q "@plan:PLAN-20250117-SUBAGENTCONFIG.P11" packages/cli/src/ui/hooks/slashCommandProcessor.ts || exit 1

# Advanced command tests should now pass
npm test -- subagentCommand.test.ts --grep "edit|completion"
# Expected: All pass

# slashCommandProcessor hook tests should pass
npm test -- slashCommandProcessor.test.ts --runInBand
# Expected: All pass

# Full test suite (targeted)
npm test -- subagentCommand.test.ts
# Expected: All pass

# TypeScript compiles
npm run typecheck
# Expected: No errors
```

## Success Criteria

- Edit command implemented using text-buffer.ts pattern (spawnSync)
- Autocomplete implemented with full multi-level support
- slashCommandProcessor passes fullLine argument and hook tests pass
- All tests pass
- TypeScript compiles
- spawnSync properly mocked in tests
- Temp file cleanup works correctly

## Phase Completion Marker

```markdown
# Phase 11: Advanced Features Implementation Complete

**Completed**: [TIMESTAMP]

## Implemented
- editCommand (using text-buffer.ts spawnSync pattern)
- completion (full multi-level support with fullLine)

## Pattern References
- Edit: packages/cli/src/ui/components/shared/text-buffer.ts
- Completion: Based on Phase 01 enhancement

## Test Results
All tests passing including:
- spawnSync mocking
- Temp file cleanup
- Multi-level completion at all positions

## Next Phase
Ready for Phase 12: Auto Mode Stub
```

---

**CRITICAL**: This phase can only be reached if Phase 01 successfully resolved autocomplete system. If Phase 01 blocked, plan should be paused there.
