# Phase 00a: Preflight Verification

## Phase ID
PLAN-20260216-HOOKSYSTEMREWRITE.P00a

## Purpose
Validate dependencies, type contracts, call paths, and baseline test infrastructure before implementation phases begin.

## Dependency Checks
- npm ls vitest
- npm ls typescript
- npm ls tsx

## Type and Symbol Checks
- rg "class HookRegistry" packages/core/src/hooks/hookRegistry.ts
- rg "class HookRunner" packages/core/src/hooks/hookRunner.ts
- rg "class HookAggregator" packages/core/src/hooks/hookAggregator.ts
- rg "class HookPlanner" packages/core/src/hooks/hookPlanner.ts
- rg "getEnableHooks" packages/core/src/config/config.ts

## Call Path Checks
- rg "triggerBeforeToolHook|triggerAfterToolHook" packages/core/src/core/coreToolScheduler.ts
- rg "triggerBeforeModelHook|triggerAfterModelHook|triggerBeforeToolSelectionHook" packages/core/src/core/geminiChat.ts

## Test Harness Checks
- ls packages/core/src/hooks/*.test.ts
- ls packages/core/src/core/*HookTriggers.test.ts
- ls integration-tests

## Config-Key Consistency Checks
- rg "tools.enableHooks" project-plans/hooksystemrewrite -n
- rg "enableHooks" project-plans/hooksystemrewrite -n
- Resolve stale tools.enableHooks usage in plan artifacts before implementation phases.

## Gate
- [ ] No dependency, symbol, or call path blockers
- [ ] Test harness exists for unit and integration levels
- [ ] Config-key consistency resolved (top-level enableHooks canonicalized)

If any item remains unchecked, stop and update plan files before phase 01.
