# Issue #1576: Decompose AppContainer.tsx

## Overview

Break up `packages/cli/src/ui/AppContainer.tsx` (2,518 lines) into focused, single-responsibility modules following React hooks architecture.

**Parent Issue:** #1568 (0.10.0 Code Improvement Plan)

## Goals

- No single file exceeds 800 lines
- No single function exceeds 80 lines
- All existing tests pass
- Test coverage does not decrease
- Idempotent under React StrictMode

## Directory Structure

```
packages/cli/src/ui/
├── AppContainer.tsx (~650 lines, down from 2518)
├── containers/
│   └── AppContainer/
│       ├── builders/
│       │   ├── buildUIState.ts
│       │   ├── buildUIActions.ts
│       │   ├── useUIStateBuilder.ts
│       │   └── useUIActionsBuilder.ts
│       └── hooks/
│           ├── useDialogOrchestration.ts
│           ├── useDisplayPreferences.ts
│           ├── useModelTracking.ts
│           ├── useRecordingInfrastructure.ts
│           ├── useExitHandling.ts
│           ├── useInputHandling.ts
│           ├── useKeybindings.ts
│           ├── useOAuthOrchestration.ts
│           ├── useCoreEventHandlers.ts
│           ├── useExtensionAutoUpdate.ts
│           ├── useTokenMetricsTracking.ts
│           ├── useStaticRefreshManager.ts
│           ├── useFlickerDetector.ts
│           ├── useLayoutMeasurement.ts
│           ├── useSessionInitialization.ts
│           └── useTodoContinuationFlow.ts
```

## Test-First Approach

**CRITICAL:** This refactor follows test-first development:

1. **Phase 0:** Write/modify tests BEFORE extracting hooks
2. **Each Phase:** Tests pass → extract hook → verify tests still pass
3. **Final:** Full verification suite

See [TEST_PLAN.md](./TEST_PLAN.md) for complete test specifications.

## Implementation Order

See [PHASES.md](./PHASES.md) for the 7-phase implementation sequence.

## Hook Specifications

See [HOOKS.md](./HOOKS.md) for detailed hook contracts.

## Builder Specifications

See [BUILDERS.md](./BUILDERS.md) for builder function specifications.

## Acceptance Criteria

- [ ] `find packages/cli/src/ui/containers/AppContainer -name "*.ts" | xargs wc -l | awk '$1 > 800'` returns empty
- [ ] `npm run lint` passes with max-lines-per-function: 80
- [ ] All 20 integration tests pass
- [ ] `npx madge --circular packages/cli/src/ui/containers/AppContainer/hooks/` returns no cycles
- [ ] Smoke test: `node scripts/start.js --profile-load synthetic "write me a haiku"` works
- [ ] Existing tests `AppContainer.cancel-race.test.tsx` and `AppContainer.oauth-dismiss.test.ts` pass

## Coordination

This plan is designed for subagent implementation:

1. **typescriptexpert** - Primary implementation (hooks, builders, tests)
2. **deepthinker** - Review after each phase
3. **Me (acoliver)** - Coordinate, run verification, merge

Each phase should be a commit. Run full verification after each phase.

## Line Range Mapping

| Lines | Content | Destination |
|-------|---------|-------------|
| 1-188 | License, imports, constants, helpers | AppContainer.tsx |
| 189-286 | Props, external hooks | AppContainer.tsx |
| 287-349 | Recording refs | useRecordingInfrastructure.ts |
| 350-398 | OAuth coordination | useOAuthOrchestration.ts |
| 400-450 | Console, events | useCoreEventHandlers.ts |
| 451-500 | Extension auto-update | useExtensionAutoUpdate.ts |
| 501-573 | Token metrics | useTokenMetricsTracking.ts |
| 575-670 | Static refresh | useStaticRefreshManager.ts |
| 672-805 | Dialog state | useDialogOrchestration.ts |
| 807-850 | Model tracking | useModelTracking.ts |
| 851-917 | Settings, events | useDisplayPreferences.ts |
| 918-1501 | External hooks | AppContainer.tsx (calls) |
| 1503-1596 | Cancel, submit | useInputHandling.ts |
| 1599-1670 | Exit handling | useExitHandling.ts |
| 1671-1768 | Keybindings | useKeybindings.ts |
| 1770-1896 | Mouse, layout | useLayoutMeasurement.ts |
| 1898-1920 | Flicker | useFlickerDetector.ts |
| 1921-1970 | Resize | useStaticRefreshManager.ts |
| 1971-2024 | Todo continuation | useTodoContinuationFlow.ts |
| 2026-2094 | Console, git, init | AppContainer.tsx |
| 2096-2285 | UIState literal | builders/buildUIState.ts |
| 2287-2499 | UIActions memo | builders/buildUIActions.ts |
| 2501-2518 | Render | AppContainer.tsx |

**Total Coverage:** 2,518 lines mapped, no gaps, no overlaps.
