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
    { id: "EXT-RELOAD-1-test", content: "Write tests for SettingScope.Session", status: "pending", priority: "high" },
    { id: "EXT-RELOAD-1-impl", content: "Implement SettingScope.Session", status: "pending", priority: "high" },
    { id: "EXT-RELOAD-1-review", content: "Review Phase 1 (qualitative)", status: "pending", priority: "high" },
    { id: "EXT-RELOAD-1-commit", content: "Commit Phase 1", status: "pending", priority: "high" },

    // Phase 2: Command Reloading (TDD)
    { id: "EXT-RELOAD-2-test", content: "Write tests for command reloading", status: "pending", priority: "high" },
    { id: "EXT-RELOAD-2-impl", content: "Implement command reloading", status: "pending", priority: "high" },
    { id: "EXT-RELOAD-2-review", content: "Review Phase 2 (qualitative)", status: "pending", priority: "high" },
    { id: "EXT-RELOAD-2-commit", content: "Commit Phase 2", status: "pending", priority: "high" },

    // Phase 3: Enhanced Tab Completion (TDD)
    { id: "EXT-RELOAD-3-test", content: "Write tests for tab completion", status: "pending", priority: "high" },
    { id: "EXT-RELOAD-3-impl", content: "Implement tab completion", status: "pending", priority: "high" },
    { id: "EXT-RELOAD-3-review", content: "Review Phase 3 (qualitative)", status: "pending", priority: "high" },
    { id: "EXT-RELOAD-3-commit", content: "Commit Phase 3", status: "pending", priority: "high" }
  ]
})
```

---

## Phase 1: Session Scope

### Files to modify
- `packages/cli/src/config/settings.ts` - add `SettingScope.Session`
- `packages/cli/src/config/extensions/extensionEnablement.ts` - handle session scope
- `packages/cli/src/config/extension.ts` - update enable/disable functions

### Test cases (write FIRST)
```typescript
describe('SettingScope.Session', () => {
  it('should enable extension in session without persisting', () => {
    const manager = new ExtensionEnablementManager(tempDir);
    manager.enable('my-ext', true, SettingScope.Session);
    expect(manager.isEnabled('my-ext')).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'enablement.json'))).toBe(false);
  });

  it('should disable extension in session without persisting', () => {
    manager.enable('my-ext', true, SettingScope.User);
    manager.enable('my-ext', false, SettingScope.Session);
    expect(manager.isEnabled('my-ext')).toBe(false);
    const onDisk = JSON.parse(fs.readFileSync(enablementPath));
    expect(onDisk['my-ext']).toBe(true);
  });

  it('should reset session state when requested', () => {
    manager.enable('my-ext', false, SettingScope.Session);
    manager.resetSessionState();
    expect(manager.isEnabled('my-ext')).toBe(true);
  });
});
```

### Subagent prompt (typescriptexpert) - TEST
```
Phase 1 TEST for Extension Reloading.

TASK: Write FAILING tests for SettingScope.Session.

TDD: Tests must FAIL initially (no implementation exists).

FILES TO CREATE/MODIFY:
- packages/cli/src/config/extensions/extensionEnablement.test.ts

TEST REQUIREMENTS:
1. Enable in session doesn't write to disk
2. Disable in session doesn't write to disk  
3. Session state overrides persisted state
4. resetSessionState() clears session overrides
5. Multiple extensions can have independent session state

VERIFY TESTS FAIL:
npm run test -- extensionEnablement.test.ts
(Should fail because SettingScope.Session doesn't exist yet)
```

### Subagent prompt (typescriptexpert) - IMPL
```
Phase 1 IMPL for Extension Reloading.

TASK: Write MINIMAL code to make tests pass.

FILES TO MODIFY:
- packages/cli/src/config/settings.ts (add Session to SettingScope enum)
- packages/cli/src/config/extensions/extensionEnablement.ts (handle session scope)
- packages/cli/src/config/extension.ts (update enable/disable to accept session scope)

REQUIREMENTS:
1. SettingScope.Session must be in-memory only - never write to disk
2. Session overrides persisted state while active
3. Provide resetSessionState() to clear session overrides
4. Existing User/Workspace scopes continue to persist to disk

VERIFY:
npm run test -- extensionEnablement.test.ts
(All tests should pass)
```

### Subagent prompt (reviewer) - QUALITATIVE REVIEW
```
Phase 1 QUALITATIVE REVIEW for Extension Reloading - Session Scope.

YOU MUST ACTUALLY READ THE CODE, not just run commands.

PART 1: MECHANICAL CHECKS
1. npm run lint
2. npm run typecheck
3. npm run test -- extensionEnablement

PART 2: TEST QUALITY ANALYSIS
Read packages/cli/src/config/extensions/extensionEnablement.test.ts:

Questions to answer:
- Do the tests actually verify SESSION-specific behavior?
- Is there a test that PROVES nothing is written to disk? (Check for fs assertions)
- Is there a test for the priority order: Session > Workspace > User?
- What happens if enable(Session) then enable(User) - is this tested?
- Are there tests for error cases (invalid extension name, etc.)?

RED FLAGS to look for:
- Tests that just check "it doesn't throw" without asserting behavior
- Tests that mock so much the real code isn't exercised
- Missing edge cases (empty string, null, undefined inputs)

PART 3: IMPLEMENTATION ANALYSIS
Read the actual implementation files:

packages/cli/src/config/settings.ts:
- Is SettingScope.Session actually in the enum?
- Is it exported properly?

packages/cli/src/config/extensions/extensionEnablement.ts:
- HOW is session state stored? (Should be a Map or object, NOT in the file)
- Is there clear separation between session state and persisted state?
- What's the lookup order in isEnabled()? (Should check session first)
- Is resetSessionState() actually clearing the right data structure?
- Could there be a memory leak? (Session state growing unbounded?)

packages/cli/src/config/extension.ts:
- Does enableExtension() accept SettingScope.Session?
- Is the scope parameter properly typed?

PART 4: BEHAVIORAL TRACE
Manually trace this scenario through the code:

1. User has extension 'foo' enabled at User scope (persisted)
2. Call: disableExtension('foo', SettingScope.Session)
3. Call: isEnabled('foo') - should return false
4. Restart app (session state lost)
5. Call: isEnabled('foo') - should return true (User scope persisted)

Does the code ACTUALLY implement this correctly? Follow the code paths.

PART 5: RULES.md COMPLIANCE
- Any use of 'any' type?
- Any mutation of shared state?
- Are types derived from schemas where possible?
- Is the code self-documenting (no unnecessary comments)?

OUTPUT FORMAT:
{
  "result": "PASS" or "FAIL",
  "mechanical": {
    "lint": "PASS/FAIL",
    "typecheck": "PASS/FAIL",
    "tests": "PASS/FAIL"
  },
  "qualitative": {
    "test_quality": {
      "verdict": "PASS/FAIL",
      "tests_actually_verify_behavior": true/false,
      "edge_cases_covered": ["list what's covered"],
      "edge_cases_missing": ["list what's missing"],
      "red_flags": ["any issues found"]
    },
    "implementation_quality": {
      "verdict": "PASS/FAIL",
      "session_storage_mechanism": "describe how it works",
      "separation_from_persisted": true/false,
      "lookup_order_correct": true/false,
      "memory_leak_risk": "none/low/medium/high",
      "issues": ["any problems found"]
    },
    "behavioral_trace": {
      "verdict": "PASS/FAIL",
      "scenario_works_correctly": true/false,
      "explanation": "step by step what actually happens"
    },
    "rules_compliance": {
      "verdict": "PASS/FAIL",
      "any_types": false,
      "mutations": false,
      "issues": []
    }
  },
  "overall_assessment": "Will this actually work correctly at runtime? Why/why not?",
  "issues_requiring_remediation": ["specific actionable issues"]
}
```

---

## Phase 2: Command Reloading

### Files to modify
- `packages/cli/src/services/BuiltinCommandLoader.ts`
- `packages/cli/src/services/BuiltinCommandLoader.test.ts`

### Test cases (write FIRST)
```typescript
describe('Command Reloading', () => {
  it('should reload commands when extension is enabled', async () => {
    const loader = new BuiltinCommandLoader(config);
    expect(loader.getCommand('/myext-cmd')).toBeUndefined();
    enableExtension('my-ext', SettingScope.Session);
    expect(loader.getCommand('/myext-cmd')).toBeDefined();
  });

  it('should remove commands when extension is disabled', async () => {
    const loader = new BuiltinCommandLoader(config);
    expect(loader.getCommand('/myext-cmd')).toBeDefined();
    disableExtension('my-ext', SettingScope.Session);
    expect(loader.getCommand('/myext-cmd')).toBeUndefined();
  });

  it('should not affect built-in commands', async () => {
    disableExtension('my-ext', SettingScope.Session);
    expect(loader.getCommand('/help')).toBeDefined();
    expect(loader.getCommand('/extensions')).toBeDefined();
  });
});
```

### Subagent prompt (reviewer) - QUALITATIVE REVIEW
```
Phase 2 QUALITATIVE REVIEW for Extension Reloading - Command Reloading.

YOU MUST ACTUALLY READ THE CODE, not just run commands.

PART 1: MECHANICAL CHECKS
1. npm run lint
2. npm run typecheck
3. npm run test -- BuiltinCommandLoader

PART 2: TEST QUALITY ANALYSIS
Read BuiltinCommandLoader.test.ts:

Questions:
- How is extension enable/disable being triggered in tests?
- Is there an actual extension with commands being used, or just mocks?
- Do tests verify the commands ACTUALLY WORK, not just exist?
- What about timing - is there a race condition test?
- What if extension enable fails partway through?

PART 3: IMPLEMENTATION ANALYSIS
Read BuiltinCommandLoader.ts:

Questions:
- How does the loader KNOW when an extension state changes?
  - Event listener? Polling? Direct call?
- When commands are "reloaded", what actually happens?
  - Are old commands cleaned up properly?
  - Is there reference cleanup (no memory leaks)?
- What's the reload mechanism?
  - Full reload of all extension commands?
  - Incremental (just the changed extension)?
- Thread safety / race conditions:
  - What if user types command DURING reload?
  - What if two extensions enable/disable simultaneously?

PART 4: INTEGRATION ANALYSIS
- How does BuiltinCommandLoader connect to ExtensionEnablementManager?
- Is there an event bus? Direct import? Dependency injection?
- Could this create circular dependencies?

PART 5: BEHAVIORAL TRACE
Trace this scenario:
1. App starts, extension 'foo' is disabled
2. User types /foo-cmd - should fail (command not found)
3. User runs /extensions enable foo --scope session
4. User types /foo-cmd - should work now
5. User runs /extensions disable foo --scope session
6. User types /foo-cmd - should fail again

Does the implementation handle all these transitions?

OUTPUT FORMAT:
{
  "result": "PASS" or "FAIL",
  "mechanical": { "lint": "...", "typecheck": "...", "tests": "..." },
  "qualitative": {
    "test_quality": {
      "verdict": "PASS/FAIL",
      "real_extension_tested": true/false,
      "race_conditions_tested": true/false,
      "issues": []
    },
    "implementation_quality": {
      "verdict": "PASS/FAIL",
      "state_change_mechanism": "describe how loader knows about changes",
      "reload_strategy": "full/incremental",
      "cleanup_on_disable": true/false,
      "race_condition_handling": "describe",
      "memory_leak_risk": "none/low/medium/high",
      "issues": []
    },
    "integration": {
      "verdict": "PASS/FAIL",
      "connection_mechanism": "describe",
      "circular_dependency_risk": true/false
    },
    "behavioral_trace": {
      "verdict": "PASS/FAIL",
      "all_transitions_work": true/false,
      "explanation": "..."
    }
  },
  "issues_requiring_remediation": []
}
```

---

## Phase 3: Enhanced Tab Completion

### Files to modify
- `packages/cli/src/ui/commands/extensionsCommand.ts`
- `packages/cli/src/ui/commands/extensionsCommand.test.ts`

### Test cases (write FIRST)
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
});
```

### Subagent prompt (reviewer) - QUALITATIVE REVIEW
```
Phase 3 QUALITATIVE REVIEW for Extension Reloading - Tab Completion.

YOU MUST ACTUALLY READ THE CODE, not just run commands.

PART 1: MECHANICAL CHECKS
1. npm run lint
2. npm run typecheck
3. npm run test -- extensionsCommand

PART 2: TEST QUALITY ANALYSIS
Read extensionsCommand.test.ts:

Questions:
- Are completions tested with REAL extension data, or just mocks?
- Is there a test for partial input? ("/extensions enable my" -> suggests "my-ext")
- What about invalid states? (no extensions installed)
- Is the completion async? Are there timing tests?

PART 3: IMPLEMENTATION ANALYSIS
Read extensionsCommand.ts:

Questions:
- How does completion get the list of extensions?
- How does it know which are enabled vs disabled?
- Is filtering done correctly? (enable shows disabled, disable shows enabled)
- How are scope suggestions implemented?
- Is there proper error handling if extension list can't be loaded?

PART 4: UX ANALYSIS
- Does completion feel natural? (Follow existing patterns in codebase)
- Is --scope optional? What's the default?
- Are scope values case-sensitive?
- What happens if user types invalid scope?

PART 5: BEHAVIORAL TRACE
Trace this scenario:
1. User types "/extensions enable " and hits Tab
   - Should see list of DISABLED extensions only
2. User types "/extensions enable foo --" and hits Tab
   - Should see "--scope"
3. User types "/extensions enable foo --scope " and hits Tab
   - Should see "user", "workspace", "session"
4. User types "/extensions enable foo --scope ses" and hits Tab
   - Should complete to "session"

Does the implementation handle all these?

OUTPUT FORMAT:
{
  "result": "PASS" or "FAIL",
  "mechanical": { "lint": "...", "typecheck": "...", "tests": "..." },
  "qualitative": {
    "test_quality": {
      "verdict": "PASS/FAIL",
      "real_data_tested": true/false,
      "partial_input_tested": true/false,
      "edge_cases": [],
      "issues": []
    },
    "implementation_quality": {
      "verdict": "PASS/FAIL",
      "extension_list_source": "describe",
      "filtering_correct": true/false,
      "error_handling": "describe",
      "issues": []
    },
    "ux_quality": {
      "verdict": "PASS/FAIL",
      "follows_existing_patterns": true/false,
      "scope_default": "describe",
      "invalid_input_handling": "describe"
    },
    "behavioral_trace": {
      "verdict": "PASS/FAIL",
      "all_scenarios_work": true/false,
      "explanation": "..."
    }
  },
  "issues_requiring_remediation": []
}
```

---

## Success Criteria

- [ ] All tests pass (`npm run test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Typecheck passes (`npm run typecheck`)
- [ ] Qualitative review PASS for all phases
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
git revert <commit-hash>  # Revert specific phase if needed
```
