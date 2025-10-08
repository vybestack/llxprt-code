# Phase 14: Auto Mode Implementation

## Phase ID
`PLAN-20250117-SUBAGENTCONFIG.P14`

## Prerequisites
- Phase 13 completed
- Auto mode tests failing naturally
- Expected files:
  - `packages/cli/src/ui/commands/test/subagentCommand.test.ts` (with auto mode tests)

## Implementation Tasks

### File to Modify

**File**: `packages/cli/src/ui/commands/subagentCommand.ts`

Replace auto mode stub with LLM integration.

### Auto Mode Implementation

```typescript
/**
 * /subagent save command - Auto and Manual modes
 * 
 * @plan:PLAN-20250117-SUBAGENTCONFIG.P14
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
    const subagentManager = services.subagentManager; // @plan:PLAN-20250117-SUBAGENTCONFIG.P14 @requirement:REQ-003
    if (!subagentManager) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'SubagentManager service is unavailable. Please run integration (Phase 15) before using /subagent.',
      };
    }
    const configService = services.config; // @plan:PLAN-20250117-SUBAGENTCONFIG.P14 @requirement:REQ-003
    if (!configService) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Configuration service unavailable. Set up the CLI before using auto mode.',
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
      // Auto mode: generate using LLM
      try {
        const client = configService.getGeminiClient();
        
        if (!client || !client.hasChatInitialized()) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Error: Chat not initialized. Try manual mode or check your connection.',
          };
        }
        
        const chat = client.getChat();
        
        // Construct prompt
        const autoModePrompt = `Generate a detailed system prompt for a subagent with the following purpose:

${input}

Requirements:
- Create a comprehensive system prompt that defines the subagent's role, capabilities, and behavior
- Be specific and actionable
- Use clear, professional language
- Output ONLY the system prompt text, no explanations or metadata`;
        
        // Call LLM
        const response = await chat.sendMessage({ message: autoModePrompt });
        systemPrompt = response.text();
        
        if (!systemPrompt || systemPrompt.trim() === '') {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Error: Model returned empty response. Try manual mode or rephrase your description.',
          };
        }
      } catch (error) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Error: Failed to generate system prompt. Try manual mode or check your connection.',
        };
      }
    }
    
    // Validate profile and save
    try {
      await subagentManager.saveSubagent(name, profile, systemPrompt);
      
      const message = exists ? 'updated' : 'created';
      const modeText = mode === 'auto' ? ' using AI-generated prompt' : '';
      
      return {
        type: 'message',
        messageType: 'info',
        content: React.createElement(
          Text,
          null,
          `Subagent `,
          React.createElement(Text, { color: Colors.AccentPurple }, name),
          ` ${message} successfully${modeText} with profile `,
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
# Update plan markers to P14
grep -c "@plan:PLAN-20250117-SUBAGENTCONFIG.P14" packages/cli/src/ui/commands/subagentCommand.ts
# Expected: 1+

# ALL tests must pass (including auto mode)
npm test -- subagentCommand.test.ts
# Expected: All pass

# TypeScript compiles
npm run typecheck
# Expected: No errors

# Check LLM integration present
grep -q "getGeminiClient" packages/cli/src/ui/commands/subagentCommand.ts || exit 1
grep -q "sendMessage" packages/cli/src/ui/commands/subagentCommand.ts || exit 1
```

## Success Criteria

- Auto mode fully implemented with LLM integration
- All tests pass (manual and auto mode)
- Missing SubagentManager/config services handled gracefully
- Error handling complete
- TypeScript compiles
- User-friendly error messages

## Phase Completion Marker

```markdown
# Phase 14: Auto Mode Implementation Complete

**Completed**: [TIMESTAMP]

## Implemented
- Auto mode with GeminiClient integration
- LLM prompt generation
- Error handling for network, empty response, uninitialized chat

## Test Results
All tests passing (manual and auto mode)

## Next Phase
Ready for Phase 15: System Integration
```

---

**CRITICAL**: All tests must pass. Auto mode is now fully functional. Next phase integrates everything into the command system.
