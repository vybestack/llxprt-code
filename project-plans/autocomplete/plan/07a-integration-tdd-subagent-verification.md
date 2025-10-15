# Phase 07a: Integration TDD Verification – `/subagent`

## Phase ID
`PLAN-20251013-AUTOCOMPLETE.P07a`

## Prerequisites
- Phase 07 tests in place (failing)

## Implementation Tasks
- Append verification comments to moved test files documenting failure stacks and anti-fraud check results.
  - Files moved due to React 19 compatibility issues with vitest exclusions.
- Update execution tracker statuses.

### Required Comment Example
```typescript
// @plan:PLAN-20251013-AUTOCOMPLETE.P07a @requirement:REQ-003 @requirement:REQ-004 @requirement:REQ-005
// Verification: RED on YYYY-MM-DD – see .completed/P07.md.
```

## Verification Commands

```bash
# Test moved command integration file
npm test -- --run --reporter verbose src/ui/commands/subagentCommand.phase07.test.ts || true

# Note: Hook tests moved to src/integration-tests/useSlashCompletion.phase07.test.ts
# but cannot run due to React 19 compatibility issues with vitest exclusions
```

## Manual Verification Checklist
- [ ] Failure traces stored
- [ ] Anti-fraud checks re-run if tests adjusted
- [ ] Execution tracker updated

## Phase Completion Marker
- Create `project-plans/autocomplete/.completed/P07a.md` summarizing verification.
