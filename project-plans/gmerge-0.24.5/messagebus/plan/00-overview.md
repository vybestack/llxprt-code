# MessageBus DI Refactoring Plan

Plan ID: PLAN-20260303-MESSAGEBUS
Total Phases: 8 (00a preflight + 3 implementation + 3 verification + 01-characterize)

## START HERE

```bash
git branch --show-current  # Should be gmerge/0.24.5
git status                 # Check for uncommitted changes
```

Read:
1. `project-plans/gmerge-0.24.5/messagebus/design.md`
2. This file
3. The specific phase file you're executing

## Critical Context

This is a **mechanical refactoring** — changing how MessageBus is passed (service locator → constructor injection). NO behavior changes. The system works the same; the dependency is just made explicit.

**Upstream reference**: Commits `eec5d5ebf839`, `90be9c35876d`, `12c7c9cc426b` (in that order).

## Phase Execution Order

```
00a → 01 → 01a → 02 → 02a → 03 → 03a
```

### Phase 00a: Preflight Verification
Verify MessageBus interface, Config.getMessageBus(), setMessageBus() exist where expected.

### Phase 01 / 01a: Characterize + Phase 1 (Optional Parameters)
- Write characterization tests for MessageBus flow through tools and scheduler
- Add `messageBus?: MessageBus` as optional constructor param to CoreToolScheduler, ToolRegistry
- Fall back to `config.getMessageBus()` when not provided
- Update test setup to pass MessageBus explicitly
- **~16 files changed** (matches upstream Phase 1 scope)

### Phase 02 / 02a: Phase 2 (Standardize Constructors)
- Add MessageBus parameter to ALL `createInvocation()` methods
- Add to agent invocation constructors (SubagentInvocation, DelegateToAgentTool)
- Wire MessageBus through ToolRegistry → tool → invocation chain
- **~23 files changed** (matches upstream Phase 2 scope)

### Phase 03 / 03a: Phase 3 (Mandatory + Cleanup)
- Change all `messageBus?:` to `messageBus:` (remove optionality)
- Remove `config.getMessageBus()` and `config.setMessageBus()`
- Remove `setMessageBus()` shim from ToolRegistry
- Remove MessageBus storage from Config class
- Clean up exports in index.ts
- **~57 files changed** (matches upstream Phase 3 scope)

## Success Criteria

1. All `config.getMessageBus()` removed (0 occurrences)
2. All `setMessageBus()` removed (0 occurrences)
3. MessageBus is required constructor param everywhere
4. All tests pass
5. TypeScript compiles
6. No behavior changes

## Verification Commands (Final)

```bash
# No service locator usage remaining
grep -rn "config.getMessageBus\|config\.setMessageBus" packages/core/src/ --include="*.ts" | grep -v test && echo "FAIL: service locator still used" || echo "PASS"

# No setMessageBus shim
grep -rn "setMessageBus" packages/core/src/ --include="*.ts" | grep -v test | grep -v "\.d\.ts" && echo "FAIL: setMessageBus still exists" || echo "PASS"

# Full test suite
npm run typecheck && npm run test && npm run lint
```
