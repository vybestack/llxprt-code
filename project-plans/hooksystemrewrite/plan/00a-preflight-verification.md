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
- rg "tools.enableHooks" project-plans/hooksystemrewrite/overview.md project-plans/hooksystemrewrite/usecaseexamples.md project-plans/hooksystemrewrite/specification.md -n
- rg "enableHooks" project-plans/hooksystemrewrite/overview.md project-plans/hooksystemrewrite/usecaseexamples.md project-plans/hooksystemrewrite/specification.md -n
- Fail only on stale normative usage in user-facing docs/examples/specification; allow intentional references in plan phase docs and review/remediation notes.

## Gate
- [ ] No dependency, symbol, or call path blockers
- [ ] Test harness exists for unit and integration levels
- [ ] No stale normative config-key usage in overview/usecaseexamples/specification (plan/review/remediation references allowed)

If any item remains unchecked, stop and update plan files before phase 01.
