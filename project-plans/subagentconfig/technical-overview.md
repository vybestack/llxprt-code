# Subagent Configuration Management - Technical Overview

**Plan ID**: PLAN-20250117-SUBAGENTCONFIG  
**Generated**: 2025-01-17

---

## Architecture Overview

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    User Input Layer                          │
│  /subagent save <name> <profile> auto|manual "<input>"      │
│  /subagent list | show | delete | edit                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              subagentCommand.ts                              │
│  ┌─────────────┬──────────────┬─────────────┬─────────────┐ │
│  │ saveCommand │ listCommand  │ showCommand │ deleteCommand│ │
│  │ editCommand │              │             │             │ │
│  └─────────────┴──────────────┴─────────────┴─────────────┘ │
│              │                                               │
│              │ Uses CommandContext.services                  │
└──────────────┼───────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│              SubagentManager                                 │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ saveSubagent(name, profile, systemPrompt)            │   │
│  │ loadSubagent(name): SubagentConfig                   │   │
│  │ listSubagents(): string[]                            │   │
│  │ deleteSubagent(name): boolean                        │   │
│  │ subagentExists(name): boolean                        │   │
│  │ validateProfileReference(profile): boolean           │   │
│  └──────────────────────────────────────────────────────┘   │
│              │                                               │
│              │ Validates against ProfileManager              │
└──────────────┼───────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│         File System (Storage Layer)                          │
│  ~/.llxprt/subagents/                                        │
│    ├── default.json                                          │
│    ├── joethecoder.json                                      │
│    └── <name>.json                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## File Structure Analysis

### Existing Files to Reference

#### 1. Command Pattern: `packages/cli/src/ui/commands/profileCommand.ts`

**Key Patterns to Follow:**
- Nested subcommand structure with parent command
- Each subcommand as separate SlashCommand object
- Completion function for autocomplete
- Use of ProfileManager for business logic
- MessageActionReturn for user feedback
- Confirmation prompts for destructive operations

**Structure:**
```typescript
const saveCommand: SlashCommand = { ... };
const loadCommand: SlashCommand = { ... };
const deleteCommand: SlashCommand = { ... };

export const profileCommand: SlashCommand = {
  name: 'profile',
  description: '...',
  kind: CommandKind.BUILT_IN,
  subCommands: [saveCommand, loadCommand, deleteCommand, ...]
};
```

#### 2. Manager Pattern: `packages/core/src/config/profileManager.ts`

**Key Patterns to Follow:**
- Constructor takes baseDir parameter
- Private helper methods for path construction
- Async file I/O with fs/promises
- Directory creation if not exists
- JSON parse/stringify for storage
- Error handling with try-catch
- Validation methods

**Structure:**
```typescript
export class ProfileManager {
  private readonly baseDir: string;
  
  constructor(baseDir: string) { ... }
  
  private getProfilePath(name: string): string { ... }
  
  async saveProfile(name: string, profile: Profile): Promise<void> { ... }
  async loadProfile(name: string): Promise<Profile> { ... }
  async listProfiles(): Promise<string[]> { ... }
  async deleteProfile(name: string): Promise<boolean> { ... }
}
```

#### 3. Command Registration: `packages/cli/src/services/BuiltinCommandLoader.ts`

**Integration Points:**
- Import command from commands directory
- Push to commands array
- Ensure required services available in context

#### 4. Types: `packages/cli/src/ui/commands/types.ts`

**Command Type Definitions:**
```typescript
export interface SlashCommand {
  name: string;
  description: string;
  altNames?: string[];
  kind: CommandKind;
  action?: (context: CommandContext, args: string) => Promise<SlashCommandActionReturn | void>;
  subCommands?: SlashCommand[];
  completion?: (context: CommandContext, partialArg: string) => Promise<string[]>;
}
```

---

## New Files to Create

### 1. `packages/core/src/config/types.ts` (UPDATE)

**Add:**
```typescript
/**
 * Subagent configuration stored in ~/.llxprt/subagents/<name>.json
 * @plan:PLAN-20250117-SUBAGENTCONFIG
 * @requirement:REQ-001, REQ-012
 */
export interface SubagentConfig {
  name: string;
  profile: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
}
```

### 2. `packages/core/src/config/subagentManager.ts` (CREATE)

**Purpose:** Business logic for CRUD operations on subagent configs

**Dependencies:**
- `fs/promises` for file I/O
- `path` for path construction
- `ProfileManager` for validation
- `SubagentConfig` interface

**Key Methods:** See REQ-002 in specification.md

**Pattern:** Follow ProfileManager exactly

### 3. `packages/cli/src/ui/commands/subagentCommand.ts` (CREATE)

**Purpose:** Slash command implementation

**Dependencies:**
- `CommandContext`, `SlashCommand`, `MessageActionReturn` types
- `SubagentManager` from core
- `ProfileManager` from core
- `GeminiClient` for auto mode
- `Colors` for styled output

**Subcommands:**
- `saveCommand` - Handles both auto and manual modes
- `listCommand` - Shows all subagents
- `showCommand` - Displays full config
- `deleteCommand` - Removes with confirmation
- `editCommand` - Launches system editor

**Pattern:** Follow profileCommand and chatCommand

---

## Data Flow Analysis

### Save Flow (Auto Mode)

```
User Input: /subagent save myagent myprofile auto "expert debugger"
    │
    ▼
saveCommand.action(context, args)
    │
    ├─ Parse args: name="myagent", profile="myprofile", mode="auto", input="expert debugger"
    │
    ├─ Validate profile exists
    │   └─ SubagentManager.validateProfileReference("myprofile")
    │       └─ ProfileManager.listProfiles() contains "myprofile"?
    │
    ├─ Generate system prompt via LLM
    │   └─ config.getGeminiClient().getChat().sendMessage(prompt)
    │       └─ Returns: "You are an expert debugger specializing in..."
    │
    ├─ Save subagent
    │   └─ SubagentManager.saveSubagent("myagent", "myprofile", generatedPrompt)
    │       └─ Write to ~/.llxprt/subagents/myagent.json
    │
    └─ Return success message
```

### Save Flow (Manual Mode)

```
User Input: /subagent save myagent myprofile manual "You are a code reviewer"
    │
    ▼
saveCommand.action(context, args)
    │
    ├─ Parse args: name="myagent", profile="myprofile", mode="manual", input="You are a code reviewer"
    │
    ├─ Validate profile exists
    │
    ├─ Save subagent (no LLM call)
    │   └─ SubagentManager.saveSubagent("myagent", "myprofile", "You are a code reviewer")
    │
    └─ Return success message
```

### List Flow

```
User Input: /subagent list
    │
    ▼
listCommand.action(context, args)
    │
    ├─ Get all subagent names
    │   └─ SubagentManager.listSubagents()
    │       └─ fs.readdir(~/.llxprt/subagents/)
    │       └─ Filter *.json files
    │       └─ Return ["default", "joethecoder", "myagent"]
    │
    ├─ Load each config for details
    │   └─ SubagentManager.loadSubagent(name)
    │       └─ Read and parse JSON
    │
    ├─ Format output
    │   └─ Sort by createdAt
    │   └─ Align columns
    │   └─ Apply colors
    │
    └─ Return formatted message
```

### Autocomplete Flow

```
User Types: /subagent save myagent <TAB>
    │
    ▼
completion(context, partialArg="", fullLine="/subagent save myagent ")
    │
    ├─ Parse fullLine to determine position
    │   └─ args = ["subagent", "save", "myagent", ""]
    │   └─ position = 3 (0-indexed)
    │
    ├─ Position 3 for "save" = profile name
    │   └─ ProfileManager.listProfiles()
    │   └─ Filter by partialArg (empty, so return all)
    │
    └─ Return ["cerebrasqwen3", "myprofile", "gpt4o", ...]
```

---

## Integration Points

### 1. Command Context Services

The `CommandContext` provides access to services:

```typescript
interface CommandContext {
  services: {
    config: Config;
    logger: HistoryService;
    profileManager: ProfileManager;
    subagentManager: SubagentManager;  // NEW - needs to be added
  };
  overwriteConfirmed?: boolean;
  invocation?: { raw: string };
}
```

**Required Changes:**
- Add `subagentManager` to services in `BuiltinCommandLoader.ts`
- Initialize SubagentManager with correct baseDir (`~/.llxprt/subagents/`)
- Pass ProfileManager reference to SubagentManager for validation

### 2. GeminiClient for Auto Mode

**Access Pattern:**
```typescript
const client = context.services.config.getGeminiClient();
if (!client?.hasChatInitialized()) {
  // Initialize chat if needed
  await client.startChat();
}
const chat = client.getChat();
const response = await chat.sendMessage({ message: prompt });
const systemPrompt = response.text();
```

**Error Handling:**
- Check if client exists
- Handle chat not initialized
- Handle sendMessage failures
- Handle empty responses

### 3. Profile Validation

**Pattern:**
```typescript
async validateProfileReference(profileName: string): Promise<boolean> {
  const profiles = await this.profileManager.listProfiles();
  return profiles.includes(profileName);
}
```

**Usage in SaveCommand:**
```typescript
const isValid = await subagentManager.validateProfileReference(profile);
if (!isValid) {
  return {
    type: 'message',
    messageType: 'error',
    content: `Error: Profile '${profile}' not found. Use /profile list to see available profiles.`
  };
}
```

---

## Autocomplete Implementation Details

### Challenge: Multi-Level Completion

The existing completion system in `slashCommandProcessor.ts` may only pass `partialArg` (the current incomplete token). For multi-level completion, we need access to the full command line to determine position.

**Investigation Needed:**
1. Check `slashCommandProcessor.ts` completion invocation
2. Determine if `fullLine` or full args array is available
3. If not, may need to enhance completion system

**Completion Function Signature:**
```typescript
completion?: (
  context: CommandContext,
  partialArg: string,
  fullLine?: string  // May need to add this parameter
) => Promise<string[]>;
```

### Position Detection

```typescript
completion: async (context, partialArg, fullLine) => {
  // Parse the full command line to determine cursor position
  const args = fullLine.trim().split(/\s+/);
  const position = args.length - 1;
  
  // args[0] = "/subagent"
  // args[1] = subcommand (save, list, show, etc.)
  // args[2] = first argument
  // args[3] = second argument
  // args[4] = third argument
  
  // Level 1: Subcommand completion
  if (position === 1) {
    return ['save', 'list', 'show', 'delete', 'edit']
      .filter(cmd => cmd.startsWith(partialArg));
  }
  
  const subcommand = args[1];
  
  // Level 2: Agent name for show/delete/edit
  if (position === 2 && ['show', 'delete', 'edit'].includes(subcommand)) {
    const subagents = await context.services.subagentManager.listSubagents();
    return subagents.filter(name => name.startsWith(partialArg));
  }
  
  // Level 3: Profile name for save
  if (position === 3 && subcommand === 'save') {
    const profiles = await context.services.profileManager.listProfiles();
    return profiles.filter(name => name.startsWith(partialArg));
  }
  
  // Level 4: Mode for save
  if (position === 4 && subcommand === 'save') {
    return ['auto', 'manual'].filter(mode => mode.startsWith(partialArg));
  }
  
  return [];
}
```

---

## Testing Strategy

### Unit Tests (Phase 04, 07)

**SubagentManager Tests:**
- `SubagentManager.saveSubagent()` creates new file
- `SubagentManager.saveSubagent()` updates existing file
- `SubagentManager.loadSubagent()` reads and parses JSON
- `SubagentManager.listSubagents()` returns all names
- `SubagentManager.deleteSubagent()` removes file
- `SubagentManager.subagentExists()` checks file existence
- `SubagentManager.validateProfileReference()` validates against ProfileManager
- Directory creation if not exists
- Error handling for invalid JSON
- Error handling for file system errors

**Test Location:**
- `packages/core/src/config/test/subagentManager.test.ts`

**Test Pattern:**
```typescript
describe('SubagentManager @plan:PLAN-20250117-SUBAGENTCONFIG.P04 @requirement:REQ-002', () => {
  let subagentManager: SubagentManager;
  let profileManager: ProfileManager;
  let tempDir: string;
  
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subagent-test-'));
    profileManager = new ProfileManager(path.join(tempDir, 'profiles'));
    subagentManager = new SubagentManager(
      path.join(tempDir, 'subagents'),
      profileManager
    );
    
    // Create a test profile
    await profileManager.saveProfile('testprofile', { ... });
  });
  
  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true });
  });
  
  it('should save new subagent', async () => {
    await subagentManager.saveSubagent('testagent', 'testprofile', 'You are a test agent');
    const exists = await subagentManager.subagentExists('testagent');
    expect(exists).toBe(true);
  });
  
  // ... more tests
});
```

### Integration Tests (Phase 10, 13)

**Command Tests:**
- `/subagent save auto` generates prompt and saves
- `/subagent save manual` saves directly
- `/subagent list` displays all subagents
- `/subagent show` displays full config
- `/subagent delete` removes subagent with confirmation
- `/subagent edit` launches editor
- Autocomplete at all levels
- Error cases (invalid profile, missing subagent, etc.)
- Overwrite confirmation

**Test Location:**
- `packages/cli/src/ui/commands/test/subagentCommand.test.ts`

**Mock Strategy:**
- Mock `config.getGeminiClient()` for auto mode tests
- Use real file system with temp directories
- Mock editor launch for edit command tests

### End-to-End Tests (Phase 16)

**Full Workflow Tests:**
1. Create profile → Create subagent with auto mode → List → Show → Edit → Delete
2. Create subagent with manual mode → Overwrite with auto mode
3. Autocomplete through full save command
4. Error recovery (invalid profile, network failure, etc.)

---

## Error Handling Strategy

### Validation Errors (User-Correctable)

**Return immediately with helpful message:**
```typescript
return {
  type: 'message',
  messageType: 'error',
  content: 'Error: Profile "xyz" not found. Use /profile list to see available profiles.'
};
```

### File System Errors (System Issues)

**Log and return generic message:**
```typescript
try {
  await fs.writeFile(filePath, data);
} catch (error) {
  this.logger.error('Failed to save subagent:', error);
  throw new Error('Cannot save subagent. Check permissions and disk space.');
}
```

### LLM Errors (Network/API Issues)

**Provide fallback suggestion:**
```typescript
try {
  const response = await chat.sendMessage({ message: prompt });
  systemPrompt = response.text();
} catch (error) {
  return {
    type: 'message',
    messageType: 'error',
    content: 'Error: Failed to generate system prompt. Try manual mode or check your connection.'
  };
}
```

---

## Success Message Formatting

### Use React Components for Styling

```typescript
import React from 'react';
import { Text } from 'ink';
import { Colors } from '../colors.js';

return {
  type: 'message',
  messageType: 'info',
  content: React.createElement(
    Text,
    null,
    'Subagent ',
    React.createElement(Text, { color: Colors.AccentPurple }, agentName),
    ' created successfully with profile ',
    React.createElement(Text, { color: Colors.AccentCyan }, profileName),
    '.'
  )
};
```

### Pattern Reference

See `chatCommand.ts` saveCommand for confirmation prompt styling.

---

## Implementation Phases Overview

The implementation will follow strict TDD cycle:

1. **Phase 03**: SubagentManager Stub (empty methods, correct types)
2. **Phase 04**: SubagentManager TDD (behavioral tests)
3. **Phase 05**: SubagentManager Implementation (following pseudocode)
4. **Phase 06**: SubagentCommand Stub (subcommands with dummy returns)
5. **Phase 07**: SubagentCommand TDD (command interaction tests)
6. **Phase 08**: SubagentCommand Implementation (basic save/list/show/delete)
7. **Phase 09**: Advanced Features Stub (edit, autocomplete stubs)
8. **Phase 10**: Advanced Features TDD (edit and autocomplete tests)
9. **Phase 11**: Advanced Features Implementation (edit and autocomplete)
10. **Phase 12**: Integration Stub (command registration)
11. **Phase 13**: Integration TDD (end-to-end tests)
12. **Phase 14**: Integration Implementation (wire everything together)
13. **Phase 15**: Verification (all tests pass, markers present)
14. **Phase 16**: Documentation and Cleanup

Each phase will include explicit @plan:and @requirement:markers for traceability.

---

## Code Quality Requirements

### TypeScript Strict Mode
- All code must compile with `strict: true`
- No `any` types without explicit justification
- Proper error typing (not `catch (error: any)`)

### Documentation
- JSDoc comments on all public methods
- Include @plan:and @requirement:markers
- Example usage in comments

### Testability
- Pure functions where possible
- Dependency injection (ProfileManager passed to SubagentManager)
- No hard-coded paths (use constructor parameters)

### Code Style
- Follow existing codebase conventions
- Use async/await (not callbacks)
- Descriptive variable names
- Early returns for error cases

---

## Dependencies

### Existing Dependencies (No New Packages)
- `fs/promises` - File I/O
- `path` - Path construction
- `os` - Temp directory in tests
- `ink` - UI components
- `react` - Component rendering

### Internal Dependencies
- `@vybestack/llxprt-code-core` - Config, types, managers
- Command types and interfaces
- GeminiClient for LLM calls
- ProfileManager for validation

### No External Dependencies Required
All functionality can be implemented with existing packages.

---

## Rollback Strategy

### Phase Failure Recovery

If any phase fails verification:

1. **Check markers**: `grep -r "@plan:PLAN-20250117-SUBAGENTCONFIG.P##" .`
2. **Revert changes**: `git checkout -- <files-from-phase>`
3. **Re-run phase**: Execute phase markdown exactly as written
4. **Verify again**: Run verification commands

### Git Workflow

Create commits per phase:
```bash
git commit -m "Phase 03: SubagentManager stub [@plan:PLAN-20250117-SUBAGENTCONFIG.P03]"
git commit -m "Phase 04: SubagentManager TDD [@plan:PLAN-20250117-SUBAGENTCONFIG.P04]"
git commit -m "Phase 05: SubagentManager implementation [@plan:PLAN-20250117-SUBAGENTCONFIG.P05]"
```

This allows easy rollback to any phase.

---

## Open Questions for Investigation

1. **Completion System**: Does `slashCommandProcessor.ts` pass `fullLine` to completion functions?
   - If not, need to enhance completion system
   - Alternative: Parse from context or use different approach

2. **Editor Launch**: How does existing codebase launch system editor?
   - Search for editor launch patterns
   - Check if there's a utility function

3. **Services Initialization**: Where are services initialized for CommandContext?
   - Trace through BuiltinCommandLoader
   - Ensure SubagentManager gets initialized correctly

These questions will be answered in Phase 01 (Analysis).
