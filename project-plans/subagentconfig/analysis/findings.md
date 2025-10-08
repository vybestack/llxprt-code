# Subagent Configuration Management - Analysis Findings

**Plan ID**: PLAN-20250117-SUBAGENTCONFIG.P01  
**Analysis Date**: 2025-01-17  
**Status**: INVESTIGATION COMPLETE

---

## CRITICAL FINDING: Autocomplete System Capabilities

### Current Completion Function Signature
```typescript
completion?: (
  context: CommandContext,
  partialArg: string,
) => Promise<string[]>;
```

### Multi-Level Completion: ACHIEVABLE [OK]

**Analysis Results:**
- **Current Limitation**: The completion function only receives `partialArg` (the current argument being typed)
- **Position-Based Parsing Available**: The system parses commands by `rawParts` and determines argument position
- **Argument Context Available**: `useSlashCompletion.tsx` already has logic for position-based completion:
  ```typescript
  const argString = rawParts.slice(depth).join(' ');
  const completionResult = leafCommand!.completion!(commandContext, argString);
  ```

**Required Enhancement Strategy:**
Since `fullLine` is not available to completion functions, we need to implement **intelligent argument parsing** within each completion function to determine position and provide context-aware suggestions.

**Implementation Approach (for Phases 09-11):**
1. **Parse command arguments**: Split `partialArg` to determine current argument position
2. **Provide position-aware completion**: Return different suggestions based on argument index
3. **Handle quoted arguments**: Properly parse quoted strings and spaces

**Multi-level completion: ACHIEVABLE** with argument parsing enhancement in completion functions.

---

## Editor Launch Pattern

### Recommended Pattern: text-buffer.ts spawnSync Approach

**Key Implementation Details:**
```typescript
const openInExternalEditor = useCallback(
  async (opts: { editor?: string } = {}): Promise<void> => {
    const editor =
      opts.editor ??
      process.env['VISUAL'] ??
      process.env['EDITOR'] ??
      (process.platform === 'win32' ? 'notepad' : 'vi');
    
    const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'gemini-edit-'));
    const filePath = pathMod.join(tmpDir, 'buffer.txt');
    fs.writeFileSync(filePath, text, 'utf8');

    try {
      setRawMode?.(false);
      const { status, error } = spawnSync(editor, [filePath], {
        stdio: 'inherit',
      });
      if (error) throw error;
      if (typeof status === 'number' && status !== 0)
        throw new Error(`External editor exited with status ${status}`);

      let newText = fs.readFileSync(filePath, 'utf8');
      newText = newText.replace(/\r\n?/g, '\n');
      // Process newText
    } finally {
      if (wasRaw) setRawMode?.(true);
      try {
        fs.unlinkSync(filePath);
      } catch { /* ignore */ }
      try {
        fs.rmdirSync(tmpDir);
      } catch { /* ignore */ }
    }
  }
);
```

**Key Points:**
- Use `spawnSync` (blocking, not async `spawn`)
- Environment variables: `process.env.VISUAL || process.env.EDITOR || 'vi'`
- Temp file creation with cleanup
- Platform detection (Windows fallback to 'notepad')
- Raw mode handling for terminal

**Test Mocking Pattern:**
```typescript
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));
```

---

## Services Initialization Pattern

### Current CommandContext Structure
```typescript
interface CommandContext {
  services: {
    config: Config | null;
    settings: LoadedSettings;
    git: GitService | undefined;
    logger: Logger;
  };
  // ... other properties
}
```

### Required Touch Points for SubagentManager Integration

**Files to Modify:**
1. **BuiltinCommandLoader.ts**: Import and add `subagentCommand` to command list
2. **types.ts**: Add `subagentManager?: SubagentManager` to services interface
3. **slashCommandProcessor.ts**: Initialize SubagentManager in services object
4. **Test files**: Add SubagentManager to mock services

**Initialization Pattern (based on existing commands):**
```typescript
// In BuiltinCommandLoader.ts
import { subagentCommand } from '../ui/commands/subagentCommand.js';

// In loadCommands method
const allDefinitions: Array<SlashCommand | null> = [
  // ... existing commands
  subagentCommand,
];
```

**Services Enhancement (in slashCommandProcessor.ts):**
```typescript
// Import SubagentManager and ProfileManager
import { SubagentManager } from '@vybestack/llxprt-code-core';
import { ProfileManager } from '@vybestack/llxprt-code-core';
import * as path from 'path';
import * as os from 'os';

// Add SubagentManager to services object
const profileManager = new ProfileManager();
const subagentManager = new SubagentManager(
  path.join(os.homedir(), '.llxprt', 'subagents'),
  profileManager
);

services: {
  config,
  settings,
  git: gitService,
  logger,
  subagentManager, // Add this
},
```

**Dependencies:**
- SubagentManager needs ProfileManager reference for validation
- ProfileManager is instantiated directly in commands (not in services)

---

## GeminiClient Usage Pattern for Auto Mode

### Recommended Pattern: getChat().sendMessage()

**Analysis of Existing Usage:**
```typescript
const { text: summary } = await this.getChat().sendMessage(
  {
    message: {
      text: 'Your prompt here',
    },
    config: {
      systemInstruction: { text: 'System instruction here' },
      maxOutputTokens: 1000,
    },
  },
  prompt_id,
);
```

**Auto Mode Implementation Pattern:**
```typescript
// In subagentCommand.ts action function
const contentGenConfig = context.services.config?.getContentGeneratorConfig();
const providerManager = contentGenConfig?.providerManager;
const client = providerManager?.getActiveProvider()?.client;

if (!client) {
  return {
    type: 'message',
    messageType: 'error',
    content: 'No active client available for auto mode'
  };
}

const autoModePrompt = `Generate a detailed system prompt for a subagent with the following purpose:

${description}

Requirements:
- Create a comprehensive system prompt that defines the subagent's role, capabilities, and behavior
- Be specific and actionable
- Use clear, professional language
- Output ONLY the system prompt text, no explanations or metadata`;

const response = await client.getChat().sendMessage(
  {
    message: { text: autoModePrompt },
    config: {
      systemInstruction: { 
        text: 'You are an expert at creating system prompts for AI assistants.' 
      },
      maxOutputTokens: 2000,
    },
  },
  `subagent-generate-${Date.now()}`,
);

const generatedPrompt = response.text;
```

**Error Handling Pattern:**
- Check for active client availability
- Handle provider switching scenarios
- Wrap in try-catch for LLM generation failures
- Validate non-empty response

---

## File Validation Patterns

### ProfileManager Validation Approach

**Key Validation Steps:**
```typescript
// From ProfileManager.loadProfile()
try {
  const content = await fs.readFile(filePath, 'utf8');
  const profile = JSON.parse(content) as Profile;

  // Validate required fields
  if (
    !profile.version ||
    !profile.provider ||
    !profile.model ||
    !profile.modelParams ||
    !profile.ephemeralSettings
  ) {
    throw new Error('missing required fields');
  }

  // Check version
  if (profile.version !== 1) {
    throw new Error('unsupported profile version');
  }

  return profile;
} catch (error) {
  if (error instanceof Error && error.message.includes('ENOENT')) {
    throw new Error(`Profile '${profileName}' not found`);
  }
  if (error instanceof SyntaxError) {
    throw new Error(`Profile '${profileName}' is corrupted`);
  }
  // ... other error handling
}
```

**SubagentConfig Validation Pattern:**
```typescript
interface SubagentConfig {
  name: string;
  profile: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
}

// Validation steps:
1. File existence check
2. JSON parsing with SyntaxError handling  
3. Required field validation
4. Profile reference validation via ProfileManager
5. Filename sanitization (path traversal prevention)
6. Timestamp format validation
```

**Security Considerations:**
- Path traversal prevention in filename validation
- JSON parsing error handling
- Profile reference validation to prevent invalid references

---

## Command Examples with Multi-Level Completion

### Current Multi-Argument Commands Analysis

**profileCommand Example:**
```typescript
// /profile load <name>
completion: async (_context: CommandContext, partialArg: string) => {
  const profileManager = new ProfileManager();
  const profiles = await profileManager.listProfiles();
  
  if (partialArg) {
    const unquoted = partialArg.startsWith('"') 
      ? partialArg.slice(1) 
      : partialArg;
    return profiles.filter((profile) => profile.startsWith(unquoted));
  }
  return profiles;
}
```

**setCommand Multi-Level Example:**
```typescript
// /set emojifilter <mode>
completion: async (_context: CommandContext, partialArg: string) => {
  const parts = partialArg.split(/\s+/);
  
  if (parts.length === 2 && parts[0] === 'emojifilter') {
    const modes = ['allowed', 'auto', 'warn', 'error'];
    if (parts[1]) {
      return modes.filter((mode) => mode.startsWith(parts[1]));
    }
    return modes;
  }
  // ... other completions
}
```

**SubagentCommand Required Pattern:**
```typescript
// /subagent save <name> <profile> auto|manual "<prompt>"
completion: async (context: CommandContext, partialArg: string) => {
  const parts = partialArg.split(/\s+/);
  
  if (parts.length === 1) {
    // Complete subagent names
    return existingSubagents.filter(name => name.startsWith(parts[0]));
  } else if (parts.length === 2) {
    // Complete profile names
    const profileManager = new ProfileManager();
    const profiles = await profileManager.listProfiles();
    return profiles.filter(profile => profile.startsWith(parts[1]));
  } else if (parts.length === 3) {
    // Complete modes
    const modes = ['auto', 'manual'];
    return modes.filter(mode => mode.startsWith(parts[2]));
  }
  return [];
}
```

---

## Summary of Findings

### [OK] ACHIEVABLE Requirements
1. **Multi-level completion**: CONFIRMED ACHIEVABLE with argument parsing enhancement
2. **Editor launch**: REUSABLE pattern from text-buffer.ts
3. **Services integration**: CLEAR pattern from existing commands
4. **LLM integration**: ESTABLISHED pattern using getChat().sendMessage()
5. **File validation**: ROBUST pattern from ProfileManager

###  Implementation Requirements

**No Production Code Changes in Phase 01** [OK]
- All enhancements documented for later phases
- Clear implementation paths identified
- No blockers discovered

**Enhancement Requirements for Phases 09-11:**
- Argument parsing logic in completion functions
- Position-aware suggestion filtering
- Quoted argument handling

**Dependencies:**
- ProfileManager for validation (existing)
- GeminiClient for auto mode (existing)
- CommandContext enhancement (minimal)

###  Ready for Phase 02: Pseudocode Generation

All investigation areas complete with clear implementation paths. Multi-level completion confirmed achievable with documented enhancement strategy.

---

## Blockers

**NONE** - All investigation areas resolved with clear implementation paths.

---

## Next Steps

1. **Proceed to Phase 02**: Generate pseudocode for all components
2. **Phase 09-11**: Implement argument parsing enhancement for multi-level completion
3. **Phase 12-14**: Implement auto mode using documented GeminiClient pattern
4. **Phase 15**: Integrate SubagentManager into services using documented pattern

---

**Analysis Complete - Ready for Phase 02** [OK]