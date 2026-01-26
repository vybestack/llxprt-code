# Feature Implementation Plan: Extension Reloading

**Feature:** Extension Enable/Disable with Command Reloading  
**Branch:** `20260126gmerge` (continuation)  
**Prerequisites:** Existing extension enable/disable functions work  
**Estimated Complexity:** Low-Medium  
**Upstream Reference:** `fa93b56243`

---

## Overview

Enhance extension enable/disable to support:
1. **Session scope** - runtime-only changes that don't persist to disk
2. **Command reloading** - when extensions start/stop, custom commands automatically reload
3. **Tab completion** - scope options in `/extensions enable|disable` commands

### Current State in LLxprt
LLxprt already has:
- `enableExtension()` / `disableExtension()` functions in `extension.ts`
- `ExtensionEnablementManager` class
- `/extensions enable <name>` and `/extensions disable <name>` commands
- `SettingScope.User` and `SettingScope.Workspace` support

### What's Missing
- `SettingScope.Session` for runtime-only changes
- Automatic command reloading when extensions change
- Tab completion with scope options

---

## START HERE (If you were told to "DO this plan")

### Step 1: Check current state
```bash
git branch --show-current  # Should be 20260126gmerge
git status                 # Should be clean
```

### Step 2: Create/check todo list
Call `todo_read()`. If empty or this feature not present, call `todo_write()` with todos from "Todo List" section.

### Step 3: Find where to resume
- Look for first `pending` item starting with `EXT-RELOAD-`

### Step 4: Execute using subagents
- **For implementation:** Use `typescriptexpert` subagent
- **For review:** Use `reviewer` subagent

### Step 5: Commit after each phase

---

## Todo List

```javascript
todo_write({
  todos: [
    // Phase 1: Session Scope (TDD)
    {
      id: "EXT-RELOAD-1-test",
      content: "Write tests for SettingScope.Session - enable/disable extension without persisting, verify not written to disk",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-RELOAD-1-impl",
      content: "Implement SettingScope.Session in ExtensionEnablementManager - in-memory only, no disk write",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-RELOAD-1-review",
      content: "Review Phase 1: Session scope works, doesn't persist, lint/typecheck pass",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-RELOAD-1-commit",
      content: "Commit: 'feat(extensions): add session scope for runtime-only enable/disable'",
      status: "pending",
      priority: "high"
    },

    // Phase 2: Command Reloading (TDD)
    {
      id: "EXT-RELOAD-2-test",
      content: "Write tests for command reloading - when extension enabled/disabled, verify custom commands updated",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-RELOAD-2-impl",
      content: "Implement command reloading in BuiltinCommandLoader - listen for extension state changes, reload commands",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-RELOAD-2-review",
      content: "Review Phase 2: Commands reload when extensions change, no stale commands, lint/typecheck/test pass",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-RELOAD-2-commit",
      content: "Commit: 'feat(extensions): auto-reload commands when extensions enabled/disabled'",
      status: "pending",
      priority: "high"
    },

    // Phase 3: Enhanced Tab Completion (TDD)
    {
      id: "EXT-RELOAD-3-test",
      content: "Write tests for tab completion - /extensions enable should suggest extension names and --scope option",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-RELOAD-3-impl",
      content: "Implement enhanced completion in extensionsCommand.ts - add scope options to enable/disable",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-RELOAD-3-review",
      content: "Review Phase 3: Tab completion works with scopes, lint/typecheck/test pass",
      status: "pending",
      priority: "high"
    },
    {
      id: "EXT-RELOAD-3-commit",
      content: "Commit: 'feat(extensions): enhanced tab completion with scope options (upstream fa93b56243)'",
      status: "pending",
      priority: "high"
    }
  ]
})
```

---

## Phase Details

### Phase 1: Session Scope

**Files to modify:**
- `packages/cli/src/config/settings.ts` - add `SettingScope.Session`
- `packages/cli/src/config/extensions/extensionEnablement.ts` - handle session scope
- `packages/cli/src/config/extension.ts` - update enable/disable functions

**Test cases (write FIRST):**
```typescript
describe('SettingScope.Session', () => {
  it('should enable extension in session without persisting', () => {
    const manager = new ExtensionEnablementManager(tempDir);
    manager.enable('my-ext', true, SettingScope.Session);
    
    // Verify enabled
    expect(manager.isEnabled('my-ext')).toBe(true);
    
    // Verify NOT written to disk
    expect(fs.existsSync(path.join(tempDir, 'enablement.json'))).toBe(false);
  });

  it('should disable extension in session without persisting', () => {
    // Pre-enable extension
    manager.enable('my-ext', true, SettingScope.User);
    
    // Disable in session only
    manager.enable('my-ext', false, SettingScope.Session);
    
    // Verify disabled in memory
    expect(manager.isEnabled('my-ext')).toBe(false);
    
    // Verify User scope still has it enabled on disk
    const onDisk = JSON.parse(fs.readFileSync(enablementPath));
    expect(onDisk['my-ext']).toBe(true);
  });

  it('should reset session state when requested', () => {
    manager.enable('my-ext', false, SettingScope.Session);
    manager.resetSessionState();
    // Falls back to persisted state
    expect(manager.isEnabled('my-ext')).toBe(true);
  });
});
```

**Subagent prompt (typescriptexpert):**
```
Implement Phase 1 of Extension Reloading for LLxprt.

TASK: Add SettingScope.Session for runtime-only extension enable/disable.

TDD REQUIREMENT: Write tests FIRST, then implement.

FILES TO MODIFY:
- packages/cli/src/config/settings.ts (add Session to SettingScope enum)
- packages/cli/src/config/extensions/extensionEnablement.ts (handle session scope)
- packages/cli/src/config/extension.ts (update enable/disable to accept session scope)

REQUIREMENTS:
1. SettingScope.Session must be in-memory only - never write to disk
2. Session overrides persisted state while active
3. Provide resetSessionState() to clear session overrides
4. Existing User/Workspace scopes continue to persist to disk

TEST CASES (implement first):
1. Enable in session doesn't persist to disk
2. Disable in session doesn't persist to disk
3. Session state overrides persisted state
4. resetSessionState clears session overrides
5. Multiple extensions can have session state

AFTER IMPLEMENTATION:
1. npm run lint
2. npm run typecheck
3. npm run test -- extensionEnablement.test.ts

Report: test results and any issues.
```

---

### Phase 2: Command Reloading

**Files to modify:**
- `packages/cli/src/services/BuiltinCommandLoader.ts`
- `packages/cli/src/services/BuiltinCommandLoader.test.ts`

**Test cases (write FIRST):**
```typescript
describe('Command Reloading', () => {
  it('should reload commands when extension is enabled', async () => {
    // Setup: extension with custom command, initially disabled
    const loader = new BuiltinCommandLoader(config);
    expect(loader.getCommand('/myext-cmd')).toBeUndefined();
    
    // Enable extension
    enableExtension('my-ext', SettingScope.Session);
    
    // Verify command now available
    expect(loader.getCommand('/myext-cmd')).toBeDefined();
  });

  it('should remove commands when extension is disabled', async () => {
    // Setup: extension enabled with custom command
    const loader = new BuiltinCommandLoader(config);
    expect(loader.getCommand('/myext-cmd')).toBeDefined();
    
    // Disable extension
    disableExtension('my-ext', SettingScope.Session);
    
    // Verify command removed
    expect(loader.getCommand('/myext-cmd')).toBeUndefined();
  });

  it('should not affect built-in commands', async () => {
    // Built-in commands like /help, /extensions should always work
    disableExtension('my-ext', SettingScope.Session);
    expect(loader.getCommand('/help')).toBeDefined();
    expect(loader.getCommand('/extensions')).toBeDefined();
  });
});
```

**Subagent prompt (typescriptexpert):**
```
Implement Phase 2 of Extension Reloading for LLxprt.

TASK: Auto-reload custom commands when extensions are enabled/disabled.

TDD REQUIREMENT: Write tests FIRST, then implement.

FILES TO MODIFY:
- packages/cli/src/services/BuiltinCommandLoader.ts
- packages/cli/src/services/BuiltinCommandLoader.test.ts

CURRENT ARCHITECTURE:
- BuiltinCommandLoader loads commands from extensions at startup
- Extensions can define custom slash commands
- Commands are currently static after initial load

REQUIREMENTS:
1. When extension is enabled, reload its custom commands
2. When extension is disabled, remove its custom commands
3. Built-in commands (help, extensions, etc.) must never be removed
4. Use event-based architecture if possible (extensionStateChanged event)
5. Handle race conditions (rapid enable/disable)

TEST CASES (implement first):
1. Enable extension adds its commands
2. Disable extension removes its commands
3. Built-in commands unaffected by extension state
4. Rapid enable/disable doesn't cause issues
5. Multiple extensions can be enabled/disabled independently

EXISTING PATTERNS:
- Look at how extensionLoader.ts handles extension lifecycle
- Check if there's an event system for extension state changes

AFTER IMPLEMENTATION:
1. npm run lint
2. npm run typecheck
3. npm run test -- BuiltinCommandLoader.test.ts

Report: test results and any issues.
```

---

### Phase 3: Enhanced Tab Completion

**Files to modify:**
- `packages/cli/src/ui/commands/extensionsCommand.ts`
- `packages/cli/src/ui/commands/extensionsCommand.test.ts`

**Test cases (write FIRST):**
```typescript
describe('Extension Command Completion', () => {
  describe('/extensions enable', () => {
    it('should suggest disabled extension names', async () => {
      const suggestions = await getCompletions('/extensions enable ', context);
      expect(suggestions).toContain('disabled-ext');
      expect(suggestions).not.toContain('already-enabled-ext');
    });

    it('should suggest --scope option', async () => {
      const suggestions = await getCompletions('/extensions enable my-ext --', context);
      expect(suggestions).toContain('--scope');
    });

    it('should suggest scope values after --scope', async () => {
      const suggestions = await getCompletions('/extensions enable my-ext --scope ', context);
      expect(suggestions).toContain('user');
      expect(suggestions).toContain('workspace');
      expect(suggestions).toContain('session');
    });
  });

  describe('/extensions disable', () => {
    it('should suggest enabled extension names', async () => {
      const suggestions = await getCompletions('/extensions disable ', context);
      expect(suggestions).toContain('enabled-ext');
      expect(suggestions).not.toContain('already-disabled-ext');
    });

    it('should suggest --scope option', async () => {
      const suggestions = await getCompletions('/extensions disable my-ext --', context);
      expect(suggestions).toContain('--scope');
    });
  });
});
```

**Subagent prompt (typescriptexpert):**
```
Implement Phase 3 of Extension Reloading for LLxprt.

TASK: Enhance tab completion for /extensions enable and /extensions disable.

TDD REQUIREMENT: Write tests FIRST, then implement.

FILES TO MODIFY:
- packages/cli/src/ui/commands/extensionsCommand.ts
- packages/cli/src/ui/commands/extensionsCommand.test.ts

CURRENT STATE:
- extensionsCommand.ts has subCommands for list and update
- Need to add/enhance enable and disable subcommands with completion

REQUIREMENTS:
1. /extensions enable should suggest:
   - Names of disabled extensions
   - --scope option
   - Scope values: user, workspace, session
2. /extensions disable should suggest:
   - Names of enabled extensions
   - --scope option
   - Scope values: user, workspace, session
3. Follow existing completion patterns in updateExtensionsCommand

COMMAND SYNTAX:
/extensions enable <extension-name> [--scope user|workspace|session]
/extensions disable <extension-name> [--scope user|workspace|session]

TEST CASES (implement first):
1. enable suggests disabled extension names
2. enable suggests --scope option
3. enable --scope suggests user, workspace, session
4. disable suggests enabled extension names
5. disable suggests --scope option

AFTER IMPLEMENTATION:
1. npm run lint
2. npm run typecheck
3. npm run test -- extensionsCommand.test.ts

Report: test results and any issues.
```

---

## Success Criteria

- [ ] All tests pass (`npm run test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] `/extensions enable <name>` works with session scope
- [ ] `/extensions disable <name>` works with session scope
- [ ] Commands auto-reload when extensions enabled/disabled
- [ ] Tab completion shows scope options
- [ ] Session changes don't persist across restarts

---

## Rollback Strategy

Each phase has its own commit:
```bash
git log --oneline -5
# Revert specific phase if needed
git revert <commit-hash>
```
