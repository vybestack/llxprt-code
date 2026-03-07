# Deferred: Console → debugLogger/coreEvents Migration

**Upstream SHA:** `10ae84869a39`
**Status:** DEFERRED to separate PR

## Reason for Deferral
893 `console.*` instances across 140+ production files. This is a pure mechanical
refactoring with zero functional impact. Including it in the gmerge sync PR would:
1. Bloat the diff by ~1000 lines of mechanical changes
2. Make code review of actual feature changes much harder
3. Risk introducing subtle test failures from mock changes

## Scope
- Add ESLint `no-console` rule
- Migrate ~662 non-test `console.*` calls to `debugLogger`/`coreEvents.emitFeedback`
- Update ~231 test `console.*` references to use appropriate mocks
- Special cases: ConsolePatcher, ErrorBoundary, sandbox.ts, errorReporting.ts (keep as-is)

## Plan
Track as separate GitHub issue. Execute in batches (core → cli → tests).
