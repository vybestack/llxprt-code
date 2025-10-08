# Phase 12: Auto Mode Stub

## Phase ID
`PLAN-20250117-SUBAGENTCONFIG.P12`

## Prerequisites
- Phase 11 completed
- All basic and advanced features working
- Expected files:
  - `packages/cli/src/ui/commands/subagentCommand.ts` (manual mode, edit, autocomplete working)

## Implementation Tasks

### File to Modify

**File**: `packages/cli/src/ui/commands/subagentCommand.ts`

Update saveCommand to handle both auto and manual modes, but stub the auto mode implementation.

### Updated saveCommand

```typescript
/**
 * /subagent save command - Auto and Manual modes
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P12
 * @requirement:REQ-003, REQ-004, REQ-014
 * @pseudocode SubagentCommand.md lines 1-90
 */
const saveCommand: SlashCommand = {
  name: 'save',
  description: 'Save a subagent configuration (auto or manual mode)',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    // Parse arguments: <name> <profile> <mode> "<input>"
    const match = args.match(/^(\S+)\s+(\S+)\s+(auto|manual)\s+"(.+)"$/);
    
    if (!match) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /subagent save <name> <profile> auto|manual "<text>"',
      };
    }
    
    const [, name, profile, mode, input] = match;
    const { services, overwriteConfirmed, invocation } = context;
    const subagentManager = services.subagentManager; // @plan:PLAN-20250117-SUBAGENTCONFIG.P12 @requirement:REQ-003
    if (!subagentManager) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
      };
    }
    
    // Check if exists for overwrite confirmation
    const exists = await subagentManager.subagentExists(name);
    
    if (exists && !overwriteConfirmed) {
      return {
        type: 'confirm_action',
        content: `A subagent with the name '${name}' already exists. Do you want to overwrite it?`,
        confirmAction: {
          originalInvocation: invocation?.raw || '',
        },
      };
    }
    
    let systemPrompt: string;
    
    if (mode === 'manual') {
      // Manual mode: use input directly
      systemPrompt = input;
    } else {
      // Auto mode: STUB - generate using LLM
      // To be implemented in Phase 13
      return {
        type: 'message',
        messageType: 'info',
        content: 'Auto mode will be implemented in Phase 13',
      };
    }
    
    // Validate profile and save
    try {
      await subagentManager.saveSubagent(name, profile, systemPrompt);
      
      const message = exists ? 'updated' : 'created';
      return {
        type: 'message',
        messageType: 'info',
        content: React.createElement(
          Text,
          null,
          `Subagent `,
          React.createElement(Text, { color: Colors.AccentPurple }, name),
          ` ${message} successfully with profile `,
          React.createElement(Text, { color: Colors.AccentCyan }, profile),
          `.`
        ),
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: error instanceof Error ? error.message : 'Failed to save subagent',
      };
    }
  },
};
```

## Verification Commands

```bash
# Update plan markers to P12
grep -c "@plan:PLAN-20250117-SUBAGENTCONFIG.P12" packages/cli/src/ui/commands/subagentCommand.ts
# Expected: 1+

# Manual mode tests still pass
npm test -- subagentCommand.test.ts --grep "manual"
# Expected: All pass

# TypeScript compiles
npm run typecheck
# Expected: No errors

# Check auto mode parsing present
grep -q "mode === 'auto'" packages/cli/src/ui/commands/subagentCommand.ts || exit 1
```

## Success Criteria

- saveCommand handles both auto and manual mode parsing
- Manual mode still works (tests pass)
- Missing SubagentManager service returns helpful error
- Auto mode returns stub message
- TypeScript compiles
- Ready for Phase 13 (auto mode TDD and implementation)

## Phase Completion Marker

```markdown
# Phase 12: Auto Mode Stub Complete

**Completed**: [TIMESTAMP]

## Changes Made
- saveCommand updated to parse auto and manual modes
- Manual mode still works
- Auto mode stubbed for Phase 13

## Next Phase
Ready for Phase 13: Auto Mode TDD
```

---

**Note**: This phase just adds parsing logic for auto mode. LLM integration happens in Phase 13.
