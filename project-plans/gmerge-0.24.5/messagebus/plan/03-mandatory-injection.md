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

## Phase Completion Marker
```bash
echo "PLAN-20260303-MESSAGEBUS.P03 COMPLETE"
# Final verification:
grep -rn "config\.getMessageBus\|setMessageBus" packages/ --include="*.ts" | grep -v "\.d\.ts" | wc -l
# Expected: 0
npm run typecheck && npm run test && npm run lint && npm run build && echo "FULLY VERIFIED"
```
