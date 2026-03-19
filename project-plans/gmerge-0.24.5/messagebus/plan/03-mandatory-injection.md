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

**Production files to make messageBus required (11 files):**
1. `packages/core/src/config/config.ts` — Remove `getMessageBus()` and `setMessageBus()` methods entirely
2. `packages/core/src/core/coreToolScheduler.ts` — Change `messageBus?:` → `messageBus:`, remove `config.getMessageBus()` fallback
3. `packages/core/src/core/subagent.ts` — Make messageBus required in constructor
4. `packages/core/src/tools/tools.ts` — Make messageBus required in `createInvocation()` base
5. `packages/core/src/tools/tool-registry.ts` — Remove `setMessageBus()` shim, make required
6. `packages/core/src/tools/edit.ts` — Make messageBus required in `createInvocation()`
7. `packages/core/src/tools/google-web-fetch.ts` — Make messageBus required in `createInvocation()`
8. `packages/cli/src/auth/oauth-manager.ts` — Remove `config.getMessageBus()` call
9. `packages/cli/src/providers/providerManagerInstance.ts` — Pass messageBus explicitly
10. `packages/cli/src/runtime/runtimeSettings.ts` — Pass messageBus explicitly
11. `packages/cli/src/ui/components/BucketAuthConfirmation.tsx` — Pass messageBus explicitly

**Test files to update (20 files):**
Every test that constructs these classes must provide MessageBus. Use the `createMockMessageBus()` helper from Phase 1.

1. `packages/core/src/core/coreToolScheduler.test.ts`
2. `packages/core/src/core/coreToolScheduler.cancellation.test.ts`
3. `packages/core/src/core/coreToolScheduler.contextBudget.test.ts`
4. `packages/core/src/core/coreToolScheduler.duplication.test.ts`
5. `packages/core/src/core/coreToolScheduler.interactiveMode.test.ts`
6. `packages/core/src/core/coreToolScheduler.publishingError.test.ts`
7. `packages/core/src/core/coreToolScheduler.raceCondition.test.ts`
8. `packages/core/src/core/nonInteractiveToolExecutor.test.ts`
9. `packages/core/src/core/toolExecutorUnification.integration.test.ts`
10. `packages/core/src/tools/base-tool-invocation.test.ts`
11. `packages/core/src/tools/confirmation-policy.test.ts`
12. `packages/core/src/tools/mcp-client.test.ts`
13. `packages/core/src/hooks/hooks-caller-application.test.ts`
14. `packages/cli/src/auth/__tests__/oauth-manager.issue913.spec.ts`
15. `packages/cli/src/auth/__tests__/oauth-manager.user-declined.spec.ts`
16. `packages/cli/src/runtime/anthropic-oauth-defaults.test.ts`
17. `packages/cli/src/runtime/provider-alias-defaults.test.ts`
18. `packages/cli/src/ui/hooks/atCommandProcessor.test.ts`
19. `packages/cli/src/ui/hooks/useGeminiStream.dedup.test.tsx`
20. `packages/cli/src/ui/hooks/useToolScheduler.test.ts`

**Total: 31 files** (11 production + 20 test).

### Key Verification Searches (Post-Implementation)
```bash
# MUST return 0 results:
grep -rn "config\.getMessageBus\|config\.setMessageBus" packages/ --include="*.ts" | grep -v "\.d\.ts"

# MUST return 0 results:
grep -rn "setMessageBus" packages/core/src/tools/tool-registry.ts

# MUST return 0 results (in Config class):
grep -n "getMessageBus\|setMessageBus\|messageBus" packages/core/src/config/config.ts
```

## Subagent Prompt

```markdown
CONTEXT: You are implementing Phase 03 of the MessageBus DI migration (PLAN-20260303-MESSAGEBUS.P03).
This is the BREAKING CHANGE phase — after this, MessageBus is mandatory everywhere.

READ FIRST:
1. project-plans/gmerge-0.24.5/messagebus/design.md
2. This phase file (project-plans/gmerge-0.24.5/messagebus/plan/03-mandatory-injection.md)
3. packages/core/src/config/config.ts — remove getMessageBus() and setMessageBus()
4. All files modified in Phase 01 and 02 (check git log for recent commits)

TASK:
1. Change all `messageBus?:` (optional) to `messageBus:` (required) in constructors
2. Remove `?? config.getMessageBus()` fallbacks
3. Remove getMessageBus() and setMessageBus() from Config class
4. Update ALL test files to explicitly provide a MessageBus instance
5. Remove dead setMessageBus() stubs from ToolRegistry and DeclarativeTool

CRITICAL: This touches ~57 files (33 prod + 24 test). Work methodically.

VERIFY: npm run typecheck && npm run test && npm run lint && npm run build
ALL must pass.
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
