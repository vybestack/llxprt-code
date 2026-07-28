# Plan: Scroll Bounce-Back Fix (content-only turns)

Plan ID: PLAN-20260727-SCROLLBOUNCE
Generated: 2026-07-27
Total Phases: 6 (0.5 + P01-P05)
Requirements:
- REQ-001: After a content-only model turn, scrolling up stays at the user's position until they explicitly return to the bottom.
- REQ-002: Stick-to-bottom only re-arms when the user is actually within a small epsilon of the bottom, not when intermediate render frames momentarily report a bottom state.
- REQ-003: Toggling the todo panel (changing `scrollableContainerHeight`) does not force a scroll-to-bottom if the user was scrolled away from the bottom.
- REQ-004: Batched wheel scroll deltas (`useBatchedScroll`) are reconciled before bottom-detection so a pending upward scroll is not read as "at bottom".
- REQ-005: `Page Up` smooth-scroll does not re-arm stick-to-bottom on intermediate frames.
- REQ-006: Behavioral tests added covering: (a) scroll up after content turn stays, (b) scroll up then container resize (todo toggle) stays, (c) pending wheel batch then re-render stays, (d) Page Up during smooth-scroll stays.

Issue: https://github.com/vybestack/llxprt-code/issues/2799
Milestone: 0.11.0
Label: Ink UI
Type: Bug

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 0.5)
2. Defined integration contracts for multi-component features
3. Written integration tests BEFORE unit tests
4. Verified all dependencies and types exist as assumed
5. Lint/complexity guardrail: never loosen lint or complexity rules, never add eslint-disable / ts-ignore / ts-expect-error / ts-nocheck. Fix the underlying issue rather than silence the rule.
6. "Fail fast" architecture preference: fix the actual root cause in `useStickToBottom` / `useBatchedScroll` rather than piling on defensive wrappers.

## Architecture context (from research)

The Ink UI alternate-buffer scroll stack:

- `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` renders `<ScrollableList initialScrollIndex={SCROLL_TO_ITEM_END} initialScrollOffsetInIndex={SCROLL_TO_ITEM_END} />`.
- `packages/cli/src/ui/components/shared/ScrollableList.tsx` wraps `VirtualizedList` and adds smooth-scroll (`useSmoothScroll`) + scrollbar animation (`useAnimatedScrollbar`) + key handlers (`useScrollKeyHandlers`).
- `packages/cli/src/ui/components/shared/VirtualizedList.tsx` delegates to `useVirtualizedListState` + `useVirtualizedListEffects` in `VirtualizedList.hooks.tsx`.
- `VirtualizedList.hooks.tsx`:
  - `useScrollAnchor` holds `scrollAnchor` and `isStickingToBottom`.
  - `useItemHeights` asynchronously measures rendered item heights and updates `heights`/`offsets`/`totalHeight`.
  - `computeScrollTop` derives `scrollTop` from `scrollAnchor`.
  - `useStickToBottom` (lines ~181-246) re-derives `wasAtBottom` each render from `prevScrollTop`/`prevTotalHeight`/`prevContainerHeight` and re-sets `isStickingToBottom=true` when `wasAtBottom && scrollTop >= prevScrollTop.current`. It also forces scroll-to-bottom when `(isStickingToBottom && containerChanged)`.
  - `buildScrollMethods` / `buildIndexScrollMethods` implement `scrollBy`, `scrollTo`, `scrollToEnd`, `scrollToIndex`, `scrollToItem`; every user-initiated scroll sets `isStickingToBottom=false`.
- `packages/cli/src/ui/hooks/useBatchedScroll.ts`: holds a `pendingScrollTopRef` so a scroll can be applied before the next commit; `getScrollTop()` returns the pending value if present.
- `packages/cli/src/ui/contexts/ScrollProvider.tsx` mouse wheel handler batches deltas via `pendingScrollsRef` and flushes on `setTimeout(0)`.

Root cause of the bounce-back: `useStickToBottom` re-arms stick-to-bottom from stale "was at bottom" state that becomes true again on intermediate renders even after the user has scrolled up. This is amplified by:
1. Async height measurement changing `totalHeight` (so `wasScrolledToBottomPixels` flips back true for a frame).
2. `useBatchedScroll` committing the previous `scrollTop` for one extra render while a pending upward scroll exists, so `scrollTop >= prevScrollTop.current` is true.
3. Smooth-scroll (`Page Up`) landing at the bottom on intermediate frames.
4. Todo panel toggle causing `containerChanged=true`, which together with stale `isStickingToBottom=true` forces scroll-to-bottom.

## Phase 0.5: Preflight Verification

### Phase ID
`PLAN-20260727-SCROLLBOUNCE.P0.5`

### Purpose
Verify ALL assumptions before writing any code.

### Dependency Verification

| Dependency | npm ls Output | Status |
|------------|---------------|--------|
| ink | ink@x.y.z (already used by ScrollableList) | OK |
| react | react@x.y.z | OK |

No new dependencies; this is a fix to existing code.

### Type/Interface Verification

| Type Name | Expected Definition | Actual Definition | Match? |
|-----------|---------------------|-------------------|--------|
| `VirtualizedListState` | has `scrollAnchor`, `isStickingToBottom`, `setIsStickingToBottom`, `setScrollAnchor`, `getAnchorForScrollTop`, `scrollTop`, `scrollableContainerHeight`, `totalHeight` | YES (see `VirtualizedList.hooks.tsx` `useVirtualizedListState`) | YES |
| `useStickToBottom` signature | `(data, scrollTop, totalHeight, scrollableContainerHeight, scrollAnchor, isStickingToBottom, setIsStickingToBottom, setScrollAnchor, getAnchorForScrollTop, offsets)` | matches current implementation | YES |
| `useBatchedScroll` return | `{ getScrollTop, setPendingScrollTop }` | matches | YES |

### Call Path Verification

| Function | Expected Caller | Actual Caller | Evidence |
|----------|-----------------|---------------|----------|
| `useStickToBottom` | `useVirtualizedListEffects` | `useVirtualizedListEffects` | `VirtualizedList.hooks.tsx` ~line 735 |
| `useBatchedScroll` | `useVirtualizedListEffects` | `useVirtualizedListEffects` | `VirtualizedList.hooks.tsx` ~line 750 |
| `useScrollWheelHandler` | `ScrollProvider` | `ScrollProvider.useScrollMouseHandler` | `ScrollProvider.tsx` |

### Test Infrastructure Verification

| Component | Test File Exists? | Test Patterns Work? |
|-----------|-------------------|---------------------|
| `VirtualizedList.hooks.tsx` | `VirtualizedList.hooks.tsx` (in same dir) | YES |
| `ScrollProvider` | `ScrollProvider.test.tsx` | YES |
| `ScrollableList` | `ScrollableList.theme.test.tsx` | YES |

### Blocking Issues Found
- None. All hooks are independently testable via `renderHook`.

### Verification Gate
- [x] All dependencies verified
- [x] All types match expectations
- [x] All call paths are possible
- [x] Test infrastructure ready

IF ANY CHECKBOX IS UNCHECKED: STOP and update plan before proceeding.

## Phase 01: TDD — Scroll-Stick Regression Tests

### Phase ID
`PLAN-20260727-SCROLLBOUNCE.P01`

### Prerequisites
- Required: Phase 0.5 completed
- Verification: `grep -r "@plan PLAN-20260727-SCROLLBOUNCE.P0.5" .`
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

### Requirements Implemented (Expanded)

### REQ-006: Behavioral tests added covering scroll-stick scenarios

**Full Text**: Behavioral tests added covering: (a) scroll up after content turn stays, (b) scroll up then container resize (todo toggle) stays, (c) pending wheel batch then re-render stays, (d) Page Up during smooth-scroll stays.

**Behavior**:
- GIVEN: a `VirtualizedList` with content-only items and the user scrolled away from the bottom
- WHEN: a re-render occurs (heights measurement, container resize, batched scroll flush, smooth-scroll intermediate frame)
- THEN: the scroll position does not snap back to the bottom and `isStickingToBottom` is not re-armed

**Why This Matters**: Without behavioral tests the fix cannot be verified and regressions will recur.

### Implementation Tasks

### Files to Create
- `packages/cli/src/ui/components/shared/useStickToBottom.test.ts`
  - MUST include: `@plan PLAN-20260727-SCROLLBOUNCE.P01`
  - MUST include: `@requirement REQ-001`, `REQ-002`, `REQ-003`, `REQ-004`, `REQ-005`, `REQ-006`
  - Tests:
    - (a) render list, scroll up via `scrollBy(-N)`, re-render (heights change) -> stays scrolled, `isStickingToBottom` false
    - (b) scroll up, then change `scrollableContainerHeight` (todo toggle simulation) -> stays scrolled
    - (c) set pending scroll up via `setPendingScrollTop`, then re-render -> bottom-detection does not re-arm
    - (d) `Page Up` smooth-scroll: simulate intermediate frame at bottom -> does not re-arm
    - (e) scroll to bottom explicitly -> `isStickingToBottom` becomes true and list grows -> sticks
    - (f) scroll up then new content appended (list grows) -> does NOT stick (user was away from bottom)

### Files to Modify
- None (test-only phase)

### Required Code Markers
Every test MUST include:
```typescript
/**
 * @plan PLAN-20260727-SCROLLBOUNCE.P01
 * @requirement REQ-006
 */
```

## Verification Commands

### Automated Checks
```bash
grep -r "@plan PLAN-20260727-SCROLLBOUNCE.P01" packages/cli/src/ui/components/shared/useStickToBottom.test.ts | wc -l
# Expected: 6+ occurrences

npx vitest run packages/cli/src/ui/components/shared/useStickToBottom.test.ts
# Expected: tests fail naturally until Phase 02 (RED)
```

### Structural Verification Checklist
- [ ] Previous phase markers present (P0.5)
- [ ] No skipped phases
- [ ] Test file created
- [ ] Plan markers added to all tests
- [ ] Tests fail with assertion failures, not "cannot find"

### Success Criteria
- 6+ behavioral tests created
- Tests fail naturally until Phase 02

### Failure Recovery
1. `git checkout -- packages/cli/src/ui/components/shared/useStickToBottom.test.ts`
2. Re-run Phase 01 with corrected expectations

## Phase 02: Fix `useStickToBottom` Bottom-Detection

### Phase ID
`PLAN-20260727-SCROLLBOUNCE.P02`

### Prerequisites
- Required: Phase 01 completed
- Verification: `grep -r "@plan PLAN-20260727-SCROLLBOUNCE.P01" .`

### Requirements Implemented (Expanded)

### REQ-001: Scroll up after content turn stays
**Full Text**: After a content-only model turn, scrolling up (Page Up, wheel, drag) stays at the user's position until they explicitly return to the bottom.
**Behavior**:
- GIVEN: a content-only turn has completed (no further list growth from streaming)
- WHEN: the user scrolls up
- THEN: the scroll position stays where the user scrolled until they scroll back to the bottom
**Why This Matters**: Users cannot review prior output if the view keeps snapping back.

### REQ-002: Stick-to-bottom only re-arms when actually at bottom
**Full Text**: Stick-to-bottom only re-arms when the user is actually within a small epsilon of the bottom, not when intermediate render frames momentarily report a bottom state.
**Behavior**:
- GIVEN: the user has scrolled away from the bottom
- WHEN: an async height measurement or re-render changes `totalHeight`
- THEN: `isStickingToBottom` is not re-armed unless the user is within `BOTTOM_EPSILON` (e.g. 1.5px) of the new bottom
**Why This Matters**: Prevents the bounce-back from stale bottom state.

### Implementation Tasks

### Files to Modify
- `packages/cli/src/ui/components/shared/VirtualizedList.hooks.tsx`
  - `useStickToBottom`:
    - Replace the `wasAtBottom` heuristic with an explicit `userIsAtBottom` check computed from the CURRENT (reconciled) `scrollTop`, `totalHeight`, `scrollableContainerHeight`, including any pending batched scroll delta from `useBatchedScroll` (passed in or read via a ref).
    - Introduce `BOTTOM_EPSILON = 1.5` (px) constant.
    - Only set `isStickingToBottom=true` when `userIsAtBottom` is true on the current frame; remove the `wasAtBottom && scrollTop >= prevScrollTop.current` re-arm path that re-arms from stale previous-frame state.
    - Keep the explicit user "scrollToEnd" path (`isStickingToBottom=true`) since that is a direct user action.
    - For the `(listGrew && shouldStickToBottom)` branch: only stick when `isStickingToBottom` is true (do not infer stickiness from `wasAtBottom`).
    - For the `containerChanged` branch: only scroll-to-bottom when `isStickingToBottom` is true AND the user was at the bottom before the resize; otherwise preserve the anchor relative to the top (recompute anchor against new container height without forcing to bottom).
  - ADD comment: `@plan PLAN-20260727-SCROLLBOUNCE.P02`
  - Implements: `@requirement REQ-001`, `REQ-002`, `REQ-003`

### Required Code Markers
```typescript
/** @plan PLAN-20260727-SCROLLBOUNCE.P02 @requirement REQ-001 */
```

## Verification Commands

```bash
npx vitest run packages/cli/src/ui/components/shared/useStickToBottom.test.ts
# Expected: tests (a), (d), (e), (f) pass

npm run typecheck
npm run lint
```

### Success Criteria
- Tests (a), (d), (e), (f) pass
- No lint/complexity rules loosened; no suppression directives added

## Phase 03: Fix `useBatchedScroll` / Wheel Handler Reconciliation

### Phase ID
`PLAN-20260727-SCROLLBOUNCE.P03`

### Prerequisites
- Required: Phase 02 completed

### Requirements Implemented (Expanded)

### REQ-004: Pending upward scroll not read as at-bottom
**Full Text**: Batched wheel scroll deltas (`useBatchedScroll`) are reconciled before bottom-detection so a pending upward scroll is not read as "at bottom".
**Behavior**:
- GIVEN: the user has issued a mouse-wheel scroll-up that is batched in `pendingScrollTopRef`
- WHEN: `useStickToBottom` runs before the batched scroll commits
- THEN: bottom-detection uses `getScrollTop()` (which returns the pending value) rather than the stale committed `scrollTop`, so it does not re-arm
**Why This Matters**: Without this, the first wheel-up after being at the bottom is undone on the next render.

### Implementation Tasks

### Files to Modify
- `packages/cli/src/ui/components/shared/VirtualizedList.hooks.tsx`
  - Pass `getScrollTop` (from `useBatchedScroll`) into `useStickToBottom` so the bottom check uses the pending scroll position.
  - `useVirtualizedListEffects`: ensure `useStickToBottom` receives `getScrollTop` and uses it in `userIsAtBottom`.
  - ADD comment: `@plan PLAN-20260727-SCROLLBOUNCE.P03`
  - Implements: `@requirement REQ-004`

- `packages/cli/src/ui/contexts/ScrollProvider.tsx`
  - `useScrollWheelHandler`: when the user scrolls up and the pending delta moves away from the bottom, ensure the scrollable's `isStickingToBottom` is cleared (via a new `clearStickToBottom` callback registered on the `ScrollableEntry`, or by issuing a `scrollBy` that already sets it false). Prefer the existing `scrollBy` path which already sets `isStickingToBottom=false`, and verify the flush calls `scrollBy` (it does). No defensive wrapper needed.
  - ADD comment: `@plan PLAN-20260727-SCROLLBOUNCE.P03`

### Required Code Markers
```typescript
/** @plan PLAN-20260727-SCROLLBOUNCE.P03 @requirement REQ-004 */
```

## Verification Commands

```bash
npx vitest run packages/cli/src/ui/components/shared/useStickToBottom.test.ts
# Expected: test (c) passes

npm run typecheck
npm run lint
```

### Success Criteria
- Test (c) passes
- No new defensive try/catch; fix is in the reconciliation path

## Phase 04: Fix Container-Resize Path (Todo Panel Toggle)

### Phase ID
`PLAN-20260727-SCROLLBOUNCE.P04`

### Prerequisites
- Required: Phase 03 completed

### Requirements Implemented (Expanded)

### REQ-003: Todo panel toggle does not force scroll-to-bottom when scrolled away
**Full Text**: Toggling the todo panel (changing `scrollableContainerHeight`) does not force a scroll-to-bottom if the user was scrolled away from the bottom.
**Behavior**:
- GIVEN: the user is scrolled away from the bottom
- WHEN: the todo panel toggles and `scrollableContainerHeight` changes
- THEN: the scroll anchor is recomputed against the new container height but the view does not jump to the bottom; the user's relative scroll position is preserved
**Why This Matters**: The todo panel is the most common container-resize trigger and currently amplifies the bounce-back.

### Implementation Tasks

### Files to Modify
- `packages/cli/src/ui/components/shared/VirtualizedList.hooks.tsx`
  - `useStickToBottom` `containerChanged` branch: when `!isStickingToBottom`, do not force scroll-to-bottom. Instead recompute the anchor against the new container height preserving the current top offset (clamp into valid range). Only scroll-to-bottom on container change when `isStickingToBottom` is true.
  - ADD comment: `@plan PLAN-20260727-SCROLLBOUNCE.P04`
  - Implements: `@requirement REQ-003`

### Required Code Markers
```typescript
/** @plan PLAN-20260727-SCROLLBOUNCE.P04 @requirement REQ-003 */
```

## Verification Commands

```bash
npx vitest run packages/cli/src/ui/components/shared/useStickToBottom.test.ts
# Expected: test (b) passes

npm run typecheck
npm run lint
```

### Success Criteria
- Test (b) passes
- Toggling todo panel while scrolled away preserves position

## Phase 05: Integration + Tmux Harness Verification

### Phase ID
`PLAN-20260727-SCROLLBOUNCE.P05`

### Prerequisites
- Required: Phase 04 completed

### Requirements Implemented (Expanded)

### REQ-001 through REQ-006 (integration verification)
Full integration verification using the tmux harness and full verification suite.

### Implementation Tasks

### Files to Modify
- `packages/cli/src/ui/components/shared/ScrollableList.tsx`
  - Verify `useScrollKeyHandlers` Page Up path: ensure `scrollByWithAnimation` / `smoothScrollTo` does not set `isStickingToBottom=true` on intermediate frames (it already calls `scrollBy`/`scrollTo` which set it false; verify and add a regression test).
  - ADD comment: `@plan PLAN-20260727-SCROLLBOUNCE.P05`

### Files to Create
- `dev-docs/tmux-harness-scroll-bounce.md` (or extend `dev-docs/tmux-harness.md`)
  - Scenario: content-only turn, then Page Up / wheel / drag -> verify no bounce-back
  - Scenario: content-only turn, scroll up, toggle todo panel -> verify position preserved

### Verification Commands

```bash
# Full verification suite
npm run test
npm run lint
npm run typecheck
npm run format
npm run build

# Smoke test
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"

# Tmux harness (visual/terminal-UI change)
# Follow dev-docs/tmux-harness.md; run the scroll-bounce scenario
```

### Structural Verification Checklist
- [ ] All phase markers present (P0.5, P01-P05)
- [ ] All tests pass
- [ ] No lint/complexity rules loosened
- [ ] No eslint-disable / ts-ignore / ts-expect-error / ts-nocheck added
- [ ] Tmux harness scenario passes

### Success Criteria
- Full verification suite green
- Tmux harness scroll-bounce scenario passes
- Issue #2799 acceptance criteria all met

## Phase Completion Marker

Create: `project-plans/20260727-scrollbounce/.completed/P05.md`

## Execution Tracker

| Phase | ID | Status | Started | Completed | Verified | Semantic? | Notes |
|-------|-----|--------|---------|-----------|----------|-----------|-------|
| 0.5 | P0.5 | [x] | 2026-07-27 | 2026-07-27 | [x] | N/A | Preflight verification |
| 01 | P01 | [ ] | - | - | - | [ ] | TDD regression tests |
| 02 | P02 | [ ] | - | - | - | [ ] | Fix useStickToBottom bottom-detection |
| 03 | P03 | [ ] | - | - | - | [ ] | Fix batched scroll reconciliation |
| 04 | P04 | [ ] | - | - | - | [ ] | Fix container-resize path |
| 05 | P05 | [ ] | - | - | - | [ ] | Integration + tmux harness |

## Completion Markers

- [ ] All phases have @plan markers in code
- [ ] All requirements have @requirement markers
- [ ] Verification script passes
- [ ] No phases skipped