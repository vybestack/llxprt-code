# Phase 06: Integration Stub (Hook + UI)

## Phase ID
`PLAN-20251013-AUTOCOMPLETE.P06`

## Prerequisites
- Phases P05/P05a complete

## Implementation Tasks
- `packages/cli/src/ui/hooks/useSlashCompletion.tsx`
  - Introduce wiring to call `createCompletionHandler` while still returning legacy data structure (no hint exposed yet).
  - Add comments referencing pseudocode **ArgumentSchema.md lines 71-90**.
- `packages/cli/src/ui/components/SuggestionsDisplay.tsx`
  - Add optional `activeHint` prop (default undefined) and placeholder render block hidden behind feature flag constant.
  - Reference pseudocode **UIHintRendering.md lines 4-7**.
- Add feature flag constant (e.g., `SHOW_ARGUMENT_HINTS = false`) to ensure no user-visible change yet.

### Compliance Notes
- No tests should change state (verify existing suite still green).
- Comments must cite exact pseudocode line numbers per requirement.

## Verification Commands

```bash
npm run typecheck -- --filter cli
npm test -- --filter "subagent" # ensure legacy behavior unaffected
```

## Manual Verification Checklist
- [ ] Feature flag prevents hints from displaying
- [ ] Schema handler invoked without altering outputs
- [ ] Plan markers inserted for P06 tasks

## Success Criteria
- Code staged for hint integration with zero behavioral change.

## Failure Recovery
- If behavior changes, revert and reapply with stricter feature flagging.

## Phase Completion Marker
- Create `project-plans/autocomplete/.completed/P06.md` summarizing typecheck/test results.
