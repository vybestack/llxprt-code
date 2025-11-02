# Subagent Configuration Management - Requirements Specification

**Plan ID**: PLAN-20250117-SUBAGENTCONFIG  
**Generated**: 2025-01-17  
**Status**: Draft  

---

## Overview

This specification defines requirements for implementing a `/subagent` slash command system that allows users to create, manage, and configure subagent definitions stored as JSON files in `~/.llxprt/subagents/`.

### Scope

**IN SCOPE:**
- Slash command implementation (`/subagent`)
- SubagentManager class for file I/O operations
- Auto mode (LLM-generated system prompts)
- Manual mode (user-provided system prompts)
- CRUD operations (create, read, update, delete)
- Multi-level autocomplete
- Profile reference validation

**OUT OF SCOPE:**
- Subagent execution/invocation
- SubAgentScope modifications
- Tool configuration in subagent files
- Run configuration in subagent files

---

## Requirements

### REQ-001: Subagent JSON Schema

**Priority**: CRITICAL  
**Category**: Data Model

The subagent configuration file format SHALL be:

```json
{
  "name": "string",
  "profile": "string",
  "systemPrompt": "string",
  "createdAt": "ISO8601-timestamp",
  "updatedAt": "ISO8601-timestamp"
}
```

**Fields:**
- `name`: Subagent identifier (matches filename without .json)
- `profile`: Reference to profile name in `~/.llxprt/profiles/`
- `systemPrompt`: The system prompt text for this subagent
- `createdAt`: ISO 8601 timestamp when subagent was created
- `updatedAt`: ISO 8601 timestamp when subagent was last modified

**Validation Rules:**
- `name`: Must be valid filename (alphanumeric, hyphens, underscores only)
- `profile`: Must reference an existing profile in `~/.llxprt/profiles/`
- `systemPrompt`: Non-empty string
- Timestamps: Must be valid ISO 8601 format

**Files Implementing:**
- `packages/core/src/config/types.ts` (SubagentConfig interface)
- `packages/core/src/config/subagentManager.ts` (validation logic)

---

### REQ-002: SubagentManager Class

**Priority**: CRITICAL  
**Category**: Core Logic

A SubagentManager class SHALL be created following the ProfileManager pattern.

**Location**: `packages/core/src/config/subagentManager.ts`

**Required Methods:**

```typescript
class SubagentManager {
  constructor(baseDir: string, profileManager: ProfileManager);
  
  // Create or update subagent
  async saveSubagent(name: string, profile: string, systemPrompt: string): Promise<void>;
  
  // Load subagent config
  async loadSubagent(name: string): Promise<SubagentConfig>;
  
  // List all subagent names
  async listSubagents(): Promise<string[]>;
  
  // Delete subagent
  async deleteSubagent(name: string): Promise<boolean>;
  
  // Check if subagent exists
  async subagentExists(name: string): Promise<boolean>;
  
  // Validate profile reference
  async validateProfileReference(profileName: string): Promise<boolean>;
}
```

**Implementation Requirements:**
- Storage location: `~/.llxprt/subagents/`
- Files named: `<name>.json`
- Automatically create directory if not exists
- Validate profile exists before saving
- Update `updatedAt` timestamp on save
- Set `createdAt` only on first save

**Pattern Reference**: `packages/core/src/config/profileManager.ts`

---

### REQ-003: /subagent save Command - Auto Mode

**Priority**: CRITICAL  
**Category**: User Interface

**Syntax:**
```bash
/subagent save <agentname> <profilename> auto "<description>"
```

**Behavior:**
1. Validate that `<profilename>` exists in `~/.llxprt/profiles/`
2. Use currently active model (via `config.getGeminiClient()`) to generate system prompt
3. Send prompt to LLM:
   ```
   Generate a detailed system prompt for a subagent with the following purpose:
   
   <description>
   
   Requirements:
   - Create a comprehensive system prompt that defines the subagent's role, capabilities, and behavior
   - Be specific and actionable
   - Use clear, professional language
   - Output ONLY the system prompt text, no explanations or metadata
   ```
4. Extract generated text as `systemPrompt`
5. Save subagent config using SubagentManager
6. Display success message with subagent name

**Error Cases:**
- Profile does not exist: "Error: Profile '<profilename>' not found. Use /profile list to see available profiles."
- LLM generation fails: "Error: Failed to generate system prompt. Try manual mode or check your connection."
- Invalid agent name: "Error: Invalid subagent name. Use alphanumeric characters, hyphens, and underscores only."

**Files Implementing:**
- `packages/cli/src/ui/commands/subagentCommand.ts`

---

### REQ-004: /subagent save Command - Manual Mode

**Priority**: CRITICAL  
**Category**: User Interface

**Syntax:**
```bash
/subagent save <agentname> <profilename> manual "<system-prompt-text>"
```

**Behavior:**
1. Validate that `<profilename>` exists in `~/.llxprt/profiles/`
2. Use provided `<system-prompt-text>` directly as systemPrompt
3. Save subagent config using SubagentManager
4. Display success message with subagent name

**Error Cases:**
- Profile does not exist: "Error: Profile '<profilename>' not found. Use /profile list to see available profiles."
- Empty prompt: "Error: System prompt cannot be empty."
- Invalid agent name: "Error: Invalid subagent name. Use alphanumeric characters, hyphens, and underscores only."

**Files Implementing:**
- `packages/cli/src/ui/commands/subagentCommand.ts`

---

### REQ-005: /subagent list Command

**Priority**: HIGH  
**Category**: User Interface

**Syntax:**
```bash
/subagent list
```

**Behavior:**
1. Call `SubagentManager.listSubagents()`
2. For each subagent, load config to get profile name and creation date
3. Display formatted list:
   ```
   List of saved subagents:
   
     - agentname     (profile: profilename, created: 2025-01-17 10:30:45)
     - otheragent    (profile: otherprofile, created: 2025-01-16 14:22:10)
   
   Note: Use '/subagent show <name>' to view full configuration
   ```
4. If no subagents exist: "No subagents found. Use '/subagent save' to create one."

**Display Format:**
- Align columns (name, profile)
- Show human-readable timestamps
- Sort by creation date (newest last)

**Files Implementing:**
- `packages/cli/src/ui/commands/subagentCommand.ts`

---

### REQ-006: /subagent show Command

**Priority**: HIGH  
**Category**: User Interface

**Syntax:**
```bash
/subagent show <agentname>
```

**Behavior:**
1. Load subagent config using SubagentManager
2. Display full configuration:
   ```
   Subagent: agentname
   Profile: profilename
   Created: 2025-01-17 10:30:45
   Updated: 2025-01-17 10:30:45
   
   System Prompt:
   ───────────────────────────────────────────────────────────
   You are an expert Python debugger specialized in...
   [full system prompt text]
   ───────────────────────────────────────────────────────────
   ```

**Error Cases:**
- Subagent does not exist: "Error: Subagent '<agentname>' not found. Use /subagent list to see available subagents."

**Files Implementing:**
- `packages/cli/src/ui/commands/subagentCommand.ts`

---

### REQ-007: /subagent delete Command

**Priority**: HIGH  
**Category**: User Interface

**Syntax:**
```bash
/subagent delete <agentname>
```

**Behavior:**
1. Check if subagent exists
2. If exists, prompt for confirmation (unless overwriteConfirmed)
3. Delete file using SubagentManager
4. Display success message: "Subagent '<agentname>' has been deleted."

**Confirmation Prompt:**
```
Are you sure you want to delete subagent '<agentname>'? This action cannot be undone.
```

**Error Cases:**
- Subagent does not exist: "Error: Subagent '<agentname>' not found."

**Files Implementing:**
- `packages/cli/src/ui/commands/subagentCommand.ts`

---

### REQ-008: /subagent edit Command

**Priority**: MEDIUM  
**Category**: User Interface

**Syntax:**
```bash
/subagent edit <agentname>
```

**Behavior:**
1. Check if subagent exists
2. Get full path to subagent JSON file
3. Launch system editor (using same mechanism as `/editor` command)
4. After editor closes, reload and validate JSON
5. Update `updatedAt` timestamp
6. Display success message: "Subagent '<agentname>' updated successfully."

**Editor Selection:**
- Use `$EDITOR` environment variable
- Fallback: `vim` on Linux/Mac, `notepad` on Windows

**Validation After Edit:**
- Must be valid JSON
- Must contain all required fields (name, profile, systemPrompt, createdAt, updatedAt)
- Profile must still exist

**Error Cases:**
- Subagent does not exist: "Error: Subagent '<agentname>' not found."
- Invalid JSON after edit: "Error: Invalid JSON format. Changes not saved."
- Missing required fields: "Error: Required field '<field>' missing. Changes not saved."
- Profile no longer exists: "Error: Referenced profile '<profilename>' not found. Changes not saved."

**Files Implementing:**
- `packages/cli/src/ui/commands/subagentCommand.ts`

**Pattern Reference**: Look for existing editor invocation patterns in codebase

---

### REQ-009: Multi-Level Autocomplete

**Priority**: HIGH (BLOCKING)  
**Category**: User Experience

The `/subagent` command SHALL support multi-level autocomplete for all subcommands and arguments.

**CRITICAL**: This requirement is blocking. Phase 01 must prove multi-level completion is achievable. No fallback to "subcommand-only" is acceptable.

**Autocomplete Levels:**

#### Level 1: Subcommand
```bash
/subagent <TAB>
# Returns: ["save", "list", "show", "delete", "edit"]
```

#### Level 2: Agent Name (for show/delete/edit)
```bash
/subagent show <TAB>
/subagent delete <TAB>
/subagent edit <TAB>
# Returns: list of existing subagent names from SubagentManager.listSubagents()
```

#### Level 2: Agent Name (for save) - No completion
```bash
/subagent save <TAB>
# Returns: [] (user must type new name)
```

#### Level 3: Profile Name (for save)
```bash
/subagent save myagent <TAB>
# Returns: list of profile names from ProfileManager.listProfiles()
```

#### Level 4: Mode (for save)
```bash
/subagent save myagent myprofile <TAB>
# Returns: ["auto", "manual"]
```

**Implementation:**

```typescript
completion: async (context, partialArg, fullLine) => {
  const args = fullLine.trim().split(/\s+/);
  const position = args.length - 1;
  
  // Level 1: subcommand
  if (position === 1) {
    const subcommands = ['save', 'list', 'show', 'delete', 'edit'];
    return subcommands.filter(cmd => cmd.startsWith(partialArg));
  }
  
  const subcommand = args[1];
  
  // Level 2: agent names for show/delete/edit
  if (position === 2 && ['show', 'delete', 'edit'].includes(subcommand)) {
    const subagents = await subagentManager.listSubagents();
    return subagents.filter(name => name.startsWith(partialArg));
  }
  
  // Level 3: profile names for save
  if (position === 3 && subcommand === 'save') {
    const profiles = await profileManager.listProfiles();
    return profiles.filter(name => name.startsWith(partialArg));
  }
  
  // Level 4: mode for save
  if (position === 4 && subcommand === 'save') {
    const modes = ['auto', 'manual'];
    return modes.filter(mode => mode.startsWith(partialArg));
  }
  
  return [];
}
```

**Files Implementing:**
- `packages/cli/src/ui/commands/subagentCommand.ts`

**Notes:**
- Check if `slashCommandProcessor.ts` passes `fullLine` to completion functions
- If not, may need to enhance completion system to support multi-argument completion

---

### REQ-010: Command Registration

**Priority**: CRITICAL  
**Category**: Integration

The `/subagent` command SHALL be registered in the builtin command loader.

**File to Modify:**
- `packages/cli/src/services/BuiltinCommandLoader.ts`

**Changes Required:**
1. Import subagentCommand from `../ui/commands/subagentCommand.js`
2. Add to commands array in registerBuiltinCommands()
3. Ensure SubagentManager is initialized and passed via context.services

**Pattern Reference:**
```typescript
import { profileCommand } from '../ui/commands/profileCommand.js';

// In registerBuiltinCommands():
commands.push(profileCommand);
```

---

### REQ-011: Command Structure

**Priority**: CRITICAL  
**Category**: Architecture

The subagentCommand SHALL follow the nested subcommand pattern.

**Structure:**
```typescript
export const subagentCommand: SlashCommand = {
  name: 'subagent',
  description: 'Manage subagent configurations.',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    saveCommand,
    listCommand,
    showCommand,
    deleteCommand,
    editCommand
  ],
  completion: async (context, partialArg, fullLine) => {
    // Multi-level completion implementation
  }
};
```

**Subcommands:**
- `saveCommand`: Handles both auto and manual modes
- `listCommand`: Lists all subagents
- `showCommand`: Shows full config
- `deleteCommand`: Deletes with confirmation
- `editCommand`: Launches editor

**Files Implementing:**
- `packages/cli/src/ui/commands/subagentCommand.ts`

**Pattern Reference:**
- `packages/cli/src/ui/commands/profileCommand.ts`
- `packages/cli/src/ui/commands/chatCommand.ts`

---

### REQ-012: TypeScript Interface Definitions

**Priority**: CRITICAL  
**Category**: Type Safety

TypeScript interfaces SHALL be defined for subagent configuration.

**File**: `packages/core/src/config/types.ts`

**Interfaces:**
```typescript
/**
 * Subagent configuration stored in ~/.llxprt/subagents/<name>.json
 * @requirement:REQ-001
 */
export interface SubagentConfig {
  /** Subagent identifier (matches filename) */
  name: string;
  
  /** Reference to profile name in ~/.llxprt/profiles/ */
  profile: string;
  
  /** System prompt text for this subagent */
  systemPrompt: string;
  
  /** ISO 8601 timestamp when created */
  createdAt: string;
  
  /** ISO 8601 timestamp when last updated */
  updatedAt: string;
}

/**
 * Options for saving a subagent
 * @requirement:REQ-003, REQ-004
 */
export interface SaveSubagentOptions {
  name: string;
  profile: string;
  mode: 'auto' | 'manual';
  input: string; // Description for auto, prompt for manual
}
```

---

### REQ-013: Error Handling

**Priority**: HIGH  
**Category**: Robustness

All operations SHALL handle errors gracefully with user-friendly messages.

**Error Categories:**

1. **File System Errors**
   - Permission denied: "Error: Cannot access subagent directory. Check permissions."
   - Disk full: "Error: Cannot save subagent. Disk may be full."
   - Invalid path: "Error: Invalid subagent configuration directory."

2. **Validation Errors**
   - Invalid name: "Error: Invalid subagent name. Use alphanumeric characters, hyphens, and underscores only."
   - Missing profile: "Error: Profile '<name>' not found."
   - Empty prompt: "Error: System prompt cannot be empty."
   - Invalid JSON: "Error: Invalid JSON format in subagent file."

3. **LLM Generation Errors**
   - Connection failed: "Error: Cannot connect to model. Check your connection."
   - Generation timeout: "Error: Model took too long to respond. Try again."
   - Empty response: "Error: Model returned empty response. Try manual mode."

4. **Not Found Errors**
   - Subagent not found: "Error: Subagent '<name>' not found. Use /subagent list to see available subagents."

**Implementation:**
- Use try-catch blocks in all async operations
- Log errors to debug logger
- Return user-friendly MessageActionReturn with type 'error'

---

### REQ-014: Overwrite Confirmation

**Priority**: MEDIUM  
**Category**: User Safety

When saving a subagent that already exists, SHALL prompt for confirmation.

**Behavior:**
1. Before saving, check if subagent exists using `SubagentManager.subagentExists()`
2. If exists and NOT overwriteConfirmed, return confirmation prompt
3. If user confirms, set overwriteConfirmed and retry command
4. If user cancels, abort operation

**Confirmation Message:**
```
A subagent with the name '<agentname>' already exists. Do you want to overwrite it?
```

**Pattern Reference:**
- `packages/cli/src/ui/commands/chatCommand.ts` (saveCommand confirmation)

**Files Implementing:**
- `packages/cli/src/ui/commands/subagentCommand.ts` (saveCommand)

---

### REQ-015: Success Messages

**Priority**: LOW  
**Category**: User Experience

All successful operations SHALL display clear confirmation messages.

**Message Formats:**

- **Save (new)**: "Subagent '<agentname>' created successfully with profile '<profilename>'."
- **Save (overwrite)**: "Subagent '<agentname>' updated successfully."
- **Delete**: "Subagent '<agentname>' has been deleted."
- **Edit**: "Subagent '<agentname>' updated successfully."

**Color Coding:**
- Success messages: Use Colors.Success or standard info color
- Agent names: Use Colors.AccentPurple
- Profile names: Use Colors.AccentCyan

**Pattern Reference:**
- `packages/cli/src/ui/commands/profileCommand.ts`
- `packages/cli/src/ui/commands/chatCommand.ts`

---

## Requirements Traceability Matrix

| REQ-ID | Component | Priority | Test Phase |
|--------|-----------|----------|------------|
| REQ-001 | SubagentConfig interface | CRITICAL | P04 |
| REQ-002 | SubagentManager class | CRITICAL | P04, P07 |
| REQ-003 | /subagent save auto | CRITICAL | P10 |
| REQ-004 | /subagent save manual | CRITICAL | P10 |
| REQ-005 | /subagent list | HIGH | P10 |
| REQ-006 | /subagent show | HIGH | P10 |
| REQ-007 | /subagent delete | HIGH | P10 |
| REQ-008 | /subagent edit | MEDIUM | P13 |
| REQ-009 | Autocomplete | HIGH | P13 |
| REQ-010 | Command registration | CRITICAL | P16 |
| REQ-011 | Command structure | CRITICAL | P10 |
| REQ-012 | TypeScript types | CRITICAL | P04 |
| REQ-013 | Error handling | HIGH | P04, P10 |
| REQ-014 | Overwrite confirmation | MEDIUM | P13 |
| REQ-015 | Success messages | LOW | P16 |

---

## Implementation Notes

### Profile Reference Pattern

The subagent config stores only the **profile name** as a string reference. The profile itself contains:

```json
{
  "version": 1,
  "provider": "openai",
  "model": "qwen-3-coder-480b",
  "modelParams": {},
  "ephemeralSettings": {
    "context-limit": 100000,
    "auth-key": "...",
    "base-url": "...",
    // ... other settings
  }
}
```

All model configuration (provider, model, params, tools, etc.) comes from the profile. The subagent only adds the `systemPrompt`.

### Auto Mode LLM Call

Use the existing GeminiClient pattern from context:

```typescript
const client = context.services.config.getGeminiClient();
const chat = client.getChat();

const response = await chat.sendMessage({
  message: `Generate a detailed system prompt for a subagent with the following purpose:\n\n${description}\n\nRequirements:\n- Create a comprehensive system prompt that defines the subagent's role, capabilities, and behavior\n- Be specific and actionable\n- Use clear, professional language\n- Output ONLY the system prompt text, no explanations or metadata`
});

const systemPrompt = response.text();
```

### File I/O Pattern

Follow ProfileManager pattern:

```typescript
private getSubagentPath(name: string): string {
  return path.join(this.baseDir, `${name}.json`);
}

async saveSubagent(name: string, profile: string, systemPrompt: string): Promise<void> {
  const filePath = this.getSubagentPath(name);
  const exists = await this.subagentExists(name);
  
  const config: SubagentConfig = {
    name,
    profile,
    systemPrompt,
    createdAt: exists ? (await this.loadSubagent(name)).createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  await fsPromises.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
}
```

---

## Acceptance Criteria

- [ ] All 15 requirements implemented with @requirement:markers
- [ ] SubagentManager class follows ProfileManager pattern
- [ ] All subcommands functional (save auto/manual, list, show, delete, edit)
- [ ] Multi-level autocomplete working for all argument positions
- [ ] Profile validation prevents invalid references
- [ ] Overwrite confirmation prevents accidental data loss
- [ ] Error messages are user-friendly and actionable
- [ ] Success messages provide clear feedback
- [ ] All code includes @plan:markers
- [ ] TypeScript compiles with no errors
- [ ] Tests achieve >80% coverage
- [ ] Integration with existing command system seamless
