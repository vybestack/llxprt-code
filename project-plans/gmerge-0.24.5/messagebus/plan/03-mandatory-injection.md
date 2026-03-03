# Phase 03: Mandatory Injection + Cleanup (Upstream Phase 3)

## Phase ID
`PLAN-20260303-MESSAGEBUS.P03`

## Prerequisites
- Phase 02a verified

## Requirements Implemented

### REQ MB-DI-003: Mandatory MessageBus Injection
**EARS**: ALL classes using MessageBus SHALL receive it as a required (non-optional) constructor parameter. The `config.getMessageBus()` service locator and `setMessageBus()` shims SHALL be removed.

**Behavior**:
- GIVEN: A tool or agent class needs MessageBus
- WHEN: It is constructed
- THEN: MessageBus MUST be provided (not optional)
- AND: No fallback to config.getMessageBus() exists

### REQ MB-DI-004: Config Class Cleanup
**EARS**: The Config class SHALL NOT store, provide, or manage MessageBus instances.

**Behavior**:
- GIVEN: The Config class
- WHEN: Inspected
- THEN: No `getMessageBus()` method exists
- AND: No `setMessageBus()` method exists
- AND: No MessageBus field exists

## Implementation Tasks

### Reference Diff
`git show 12c7c9cc426b` — Upstream Phase 3. Largest phase (~57 files).

### Files to Modify (~57 files)

**Config cleanup (1 file):**
- `packages/core/src/config/config.ts`
  - Remove `getMessageBus()` method
  - Remove `setMessageBus()` method
  - Remove `private messageBus` field
  - Remove MessageBus import if no longer needed

**ToolRegistry cleanup (1 file):**
- `packages/core/src/tools/tool-registry.ts`
  - Change `messageBus?: MessageBus` to `messageBus: MessageBus` in constructor
  - Remove `setMessageBus()` method entirely
  - Remove the `setMessageBus` iteration loop (lines ~645-649)

**CoreToolScheduler (1 file):**
- `packages/core/src/core/coreToolScheduler.ts`
  - Change `messageBus?: MessageBus` to `messageBus: MessageBus`
  - Replace ALL `this.config.getMessageBus()` with `this.messageBus`
  - Remove fallback logic

**All tools — make messageBus required (~20 files):**
Change `messageBus?: MessageBus` to `messageBus: MessageBus` in every `createInvocation()` method.

**All agent invocations — make messageBus required (~5 files):**
Same pattern for agent constructors.

**CLI/hooks (~3 files):**
- `cli/src/ui/hooks/atCommandProcessor.ts`
- `cli/src/zed-integration/zedIntegration.ts`
- `hooks/hookEventHandler.ts`

**Test files (~28 files):**
Every test that constructs these classes must provide MessageBus. The `createMockMessageBus()` helper from Phase 1 handles this.

### Key Verification Searches (Post-Implementation)
```bash
# MUST return 0 results:
grep -rn "config\.getMessageBus\|config\.setMessageBus" packages/ --include="*.ts" | grep -v "\.d\.ts"

# MUST return 0 results:
grep -rn "setMessageBus" packages/core/src/tools/tool-registry.ts

# MUST return 0 results (in Config class):
grep -n "getMessageBus\|setMessageBus\|messageBus" packages/core/src/config/config.ts
```

## Verification Commands
```bash
npm run typecheck
npm run test
npm run lint
npm run build
```

## Success Criteria
- Zero `config.getMessageBus()` references in codebase
- Zero `setMessageBus()` methods in codebase
- Config class has no MessageBus-related code
- MessageBus is required (non-optional) everywhere
- All tests pass
- Build succeeds

## Failure Recovery
This phase has the most files. If it fails:
1. Check which tests are failing — likely missing MessageBus in construction
2. Search for `createMockMessageBus` — ensure it's imported and used
3. If Config.getMessageBus is still referenced somewhere, find and replace with constructor-injected messageBus
4. If a circular dependency appears, check that MessageBus is imported from `confirmation-bus/message-bus.js`, not from Config

## Required Code Markers (@plan Strategy)

Every file that removes service locator pattern or makes MessageBus mandatory MUST include:

```typescript
/**
 * @plan PLAN-20260303-MESSAGEBUS.P03
 * Mandatory MessageBus injection, service locator removed (Phase 3)
 */
```

**Marker Placement**:
- Above constructors changed from `messageBus?:` to `messageBus:`
- In Config class (comment where getMessageBus/setMessageBus were removed)
- In ToolRegistry (where setMessageBus shim removed)
- Above replaced `config.getMessageBus()` calls (changed to `this.messageBus`)

**Example**:
```typescript
/**
 * @plan PLAN-20260303-MESSAGEBUS.P03
 * MessageBus now required (Phase 3)
 */
constructor(
  private readonly config: Config,
  private readonly messageBus: MessageBus, // No longer optional
) {
  // No fallback — messageBus must be provided
}
```

## Structural Verification Checklist

### Service Locator Removal
- [ ] `Config.getMessageBus()` method REMOVED
- [ ] `Config.setMessageBus()` method REMOVED
- [ ] Config class has NO MessageBus field
- [ ] ToolRegistry.setMessageBus() method REMOVED
- [ ] ToolRegistry setMessageBus iteration loop REMOVED (lines ~645-649)

### Mandatory Injection
- [ ] ToolRegistry: `messageBus: MessageBus` (required, not optional)
- [ ] CoreToolScheduler: `messageBus: MessageBus` (required)
- [ ] All tools: `createInvocation(..., messageBus: MessageBus)` (required)
- [ ] All agent invocations: `messageBus: MessageBus` (required)

### Codebase Cleanup
- [ ] Zero `config.getMessageBus()` references in production code
- [ ] Zero `setMessageBus()` methods in codebase
- [ ] All MessageBus imports from `confirmation-bus/message-bus.js`, not Config

### Tests Updated
- [ ] All tests provide MessageBus via `createMockMessageBus()`
- [ ] Test constructors pass MessageBus (no fallback)
- [ ] ~57 files total changed (matches upstream Phase 3)

## Semantic Verification Checklist

**Behavioral Verification Questions**:

1. **Does the code DO what the requirement says?**
   - [ ] MessageBus is REQUIRED everywhere (TypeScript enforces this)
   - [ ] Service locator pattern completely removed
   - [ ] Config class has no MessageBus concerns

2. **Is this REAL implementation, not placeholder?**
   - [ ] No TODO/HACK/STUB markers
   - [ ] All fallback logic removed
   - [ ] All tests updated to provide MessageBus

3. **Would the system FAIL if MessageBus not provided?**
   - [ ] TypeScript compilation would fail (required parameter)
   - [ ] Runtime would fail if somehow bypassed
   - [ ] No fallback paths exist

4. **Is the feature REACHABLE by users?**
   - [ ] MessageBus created at CLI/session entry point
   - [ ] MessageBus flows down through all components
   - [ ] No component can function without MessageBus

5. **What's MISSING?** (list gaps that need fixing)
   - [ ] N/A or [list any gaps]

**Behavior Verification** (manual test if possible):
```bash
# Run a tool execution and verify MessageBus is used
# Example: run edit tool and confirm policy confirmation works
# This proves MessageBus flows end-to-end
```

**Integration Points Verified**:
- [ ] CLI creates MessageBus (verified by reading CLI entry code)
- [ ] MessageBus passed to CoreToolScheduler (verified by constructor call)
- [ ] CoreToolScheduler passes to ToolRegistry (verified by reading code)
- [ ] ToolRegistry passes to tools (verified by createInvocation calls)
- [ ] Tools use MessageBus for confirmations (verified by tests)

**Lifecycle Verified**:
- [ ] MessageBus created once per session
- [ ] MessageBus lives for entire session lifetime
- [ ] MessageBus cleaned up on session end
- [ ] No circular dependencies introduced

**Edge Cases Verified**:
- [ ] Missing MessageBus caught by TypeScript (won't compile)
- [ ] No runtime null checks needed (TypeScript enforces non-null)
- [ ] Error handling unchanged (MessageBus errors already handled)

## Verification Commands

### Structural Checks (MUST ALL PASS)
```bash
# 1. No service locator usage (MUST be 0)
grep -rn "config\.getMessageBus\|config\.setMessageBus" packages/ --include="*.ts" | grep -v "\.d\.ts" | wc -l
# Expected: 0

# 2. No setMessageBus shim (MUST be 0)
grep -rn "setMessageBus" packages/core/src/ --include="*.ts" | grep -v test | grep -v "\.d\.ts" | wc -l
# Expected: 0

# 3. Config class clean (MUST be 0)
grep -n "messageBus\|MessageBus" packages/core/src/config/config.ts | wc -l
# Expected: 0 (no MessageBus in Config)

# 4. All imports from correct location
grep -rn "import.*MessageBus.*from.*config" packages/core/src/ --include="*.ts" | grep -v test
# Expected: 0 (should import from confirmation-bus/message-bus)
```

### Compilation and Tests
```bash
npm run typecheck  # MUST pass
npm run test       # MUST pass
npm run lint       # MUST pass
npm run build      # MUST pass
```

### @plan Marker Verification
```bash
grep -r "@plan:PLAN-20260303-MESSAGEBUS.P03" packages/core/src/ | wc -l
# Expected: At least 30 occurrences (Config, ToolRegistry, all tools, all agents, tests)
```

## Phase Completion Marker

**Create**: `project-plans/gmerge-0.24.5/messagebus/.completed/P03.md`

**Contents**:
```markdown
# Phase 03: Mandatory MessageBus Injection + Cleanup — COMPLETED

**Completed**: YYYY-MM-DD HH:MM
**Files Modified**: ~57 files (matching upstream Phase 3 scope)

## Files Changed

### Config Cleanup (1 file)
- packages/core/src/config/config.ts
  - REMOVED: getMessageBus() method
  - REMOVED: setMessageBus() method
  - REMOVED: private messageBus field

### ToolRegistry Cleanup (1 file)
- packages/core/src/tools/tool-registry.ts
  - CHANGED: messageBus?: MessageBus → messageBus: MessageBus
  - REMOVED: setMessageBus() method
  - REMOVED: setMessageBus iteration loop

### CoreToolScheduler (1 file)
- packages/core/src/core/coreToolScheduler.ts
  - CHANGED: messageBus?: MessageBus → messageBus: MessageBus
  - REPLACED: all config.getMessageBus() → this.messageBus

### All Tools (~20 files)
[List each tool file with messageBus now required]

### All Agents (~5 files)
[List each agent file with messageBus now required]

### CLI/Hooks (~3 files)
[List CLI integration files]

### Test Files (~28 files)
[List all test files updated]

## Verification Results

### Service Locator Removal
```bash
# config.getMessageBus() references: 0
grep -rn "config\.getMessageBus\|config\.setMessageBus" packages/ --include="*.ts" | grep -v "\.d\.ts" | wc -l
# Result: 0 [OK]

# setMessageBus() references: 0
grep -rn "setMessageBus" packages/core/src/ --include="*.ts" | grep -v test | grep -v "\.d\.ts" | wc -l
# Result: 0 [OK]

# Config class MessageBus references: 0
grep -n "messageBus\|MessageBus" packages/core/src/config/config.ts | wc -l
# Result: 0 [OK]
```

### TypeScript Compilation
```
[Paste npm run typecheck output — PASS]
```

### Test Suite
```
[Paste npm run test summary — all pass]
```

### Build
```
[Paste npm run build output — SUCCESS]
```

### @plan Marker Check
```bash
grep -r "@plan:PLAN-20260303-MESSAGEBUS.P03" packages/core/src/ | wc -l
# Result: [N] occurrences
```

## Diff Stats
```
[Paste git diff --stat output]
Expected: ~57 files changed, ~440 insertions, ~276 deletions (matching upstream)
```

## Final State
- Service locator pattern: REMOVED
- MessageBus injection: MANDATORY everywhere
- Backward compatibility: NO LONGER NEEDED (breaking change completed)
- All tests: PASSING
- All verification checks: PASSED

## Proceed to Phase 03a
Ready for final verification phase.
```
