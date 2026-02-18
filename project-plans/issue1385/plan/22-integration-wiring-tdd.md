# Phase 22: Integration Wiring & E2E Tests — TDD

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P22`

## Prerequisites
- Required: Phase 21a completed
- Verification: `test -f project-plans/issue1385/.completed/P21a.md`
- Expected files:
  - All integration stubs from P21
  - `packages/cli/src/ui/commands/continueCommand.ts` (impl from P20)
  - `packages/cli/src/ui/components/SessionBrowserDialog.tsx` (impl from P17)

## Requirements Implemented (Expanded)

### REQ-DI-001 through REQ-DI-006: Dialog Integration
### REQ-SM-001 through REQ-SM-003: Session Metadata
### REQ-EN-001: /continue Opens Browser via Dialog System
### REQ-EN-004: --continue Unchanged
### REQ-EN-005: --list-sessions Unchanged
### REQ-SB-001: /continue Opens Interactive Browser

## Test Strategy

This phase creates TWO test types:

1. **Unit integration tests** (`integrationWiring.spec.ts`): Test the glue code connects correctly — commands route to processor, processor updates state, state triggers rendering.

2. **E2E tmux harness tests** (`scripts/tests/session-browser-e2e.test.js`): Test real user interaction through the terminal UI — typing commands, pressing keys, seeing visual output.

Both test types verify BEHAVIOR (what the user sees/experiences), NOT implementation details.

## Test Cases — Unit Integration

### File to Create
- `packages/cli/src/ui/__tests__/integrationWiring.spec.ts`
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P22`

### BEHAVIORAL Tests — Command → State Flow

1. **`/continue` sets dialog state**: Execute `/continue` through processor with real command context → `uiState.isSessionBrowserDialogOpen` becomes true.

2. **Escape closes dialog and clears state**: With browser open, simulating Escape key → `uiState.isSessionBrowserDialogOpen` becomes false.

3. **Resume updates session metadata**: Execute resume flow → `SessionRecordingMetadata.sessionId` changes to the selected session ID.

### BEHAVIORAL Tests — Processor Routing

4. **Processor routes 'dialog' action correctly**: When command returns `{ type: 'dialog', dialog: 'sessionBrowser' }`, processor sets correct UI state (not testing that it "calls" something, testing the state result).

5. **Processor routes 'perform_resume' action**: When command returns `{ type: 'perform_resume', sessionRef }`, processor calls performResume and returns LoadHistoryActionReturn.

6. **Processor handles resume errors**: When performResume returns `{ ok: false, error }`, processor returns MessageActionReturn with error content.

### BEHAVIORAL Tests — DialogManager Rendering

7. **Browser dialog shows "Session Browser" title**: With `isSessionBrowserDialogOpen=true`, rendered output contains "Session Browser".

8. **Browser dialog shows search bar**: With dialog open, rendered output contains "Search:".

9. **Browser dialog hides when closed**: With `isSessionBrowserDialogOpen=false`, rendered output does NOT contain "Session Browser".

### BEHAVIORAL Tests — State Transitions

10. **Initial state has browser closed**: Fresh UIState has `isSessionBrowserDialogOpen=false`.

11. **Opening browser doesn't affect other state**: Opening browser preserves unrelated UIState fields.

12. **Resume success closes browser**: After successful resume, `isSessionBrowserDialogOpen` becomes false.

### BEHAVIORAL Tests — Existing Behavior

13. **Other slash commands unaffected**: `/stats`, `/quit`, `/profile` still work normally after adding `/continue`.

14. **CLI flags unaffected**: `--continue` and `--list-sessions` still parsed correctly.

## Test Cases — E2E tmux Harness

### File Reference
- `scripts/oldui-tmux-script.session-browser.json` (created)
- `scripts/tests/session-browser-e2e.test.js` (created)

### E2E Test Scenarios (via tmux harness)

15. **Open browser with /continue**: Type `/continue` → screen shows "Session Browser" title.

16. **Keyboard navigation works**: Press Down/Up → selection indicator moves.

17. **Tab switches modes**: Press Tab → mode changes (search ↔ nav).

18. **Sort cycling works**: In nav mode, press `s` → sort indicator changes.

19. **Search filtering works**: Type characters → search term appears in search bar.

20. **Escape closes browser**: Press Escape → "Session Browser" no longer visible.

21. **Browser shows session count**: Screen shows "N sessions found" with actual count.

### E2E Verification Commands

```bash
# Run E2E tests (requires tmux installed)
node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.session-browser.json --assert

# Or run via test runner
npx vitest run scripts/tests/session-browser-e2e.test.js
```

## FORBIDDEN Patterns

```typescript
// NO structural component tree tests
expect(DialogManager).toContainComponent(SessionBrowserDialog) // FORBIDDEN

// NO mock theater
vi.mock('../commands/continueCommand') // FORBIDDEN
expect(openSessionBrowserDialog).toHaveBeenCalled() // FORBIDDEN

// NO registration/metadata tests
expect(command.kind).toBe(CommandKind.BUILT_IN) // FORBIDDEN
expect(command.schema).toBeDefined() // FORBIDDEN

// OK: State assertions
expect(uiState.isSessionBrowserDialogOpen).toBe(true)

// OK: Rendered output assertions
expect(render(DialogManager, props).lastFrame()).toContain('Session Browser')

// OK: Action result assertions
expect(result.type).toBe('dialog')
expect(result.dialog).toBe('sessionBrowser')
```

## Verification Commands

```bash
# Integration test file exists
test -f packages/cli/src/ui/__tests__/integrationWiring.spec.ts || echo "FAIL"

# E2E test script exists
test -f scripts/oldui-tmux-script.session-browser.json || echo "FAIL"

# Test count
grep -c "it(" packages/cli/src/ui/__tests__/integrationWiring.spec.ts
# Expected: 14+

# No mock theater
grep "toHaveBeenCalled\|vi.mock\|jest.mock" packages/cli/src/ui/__tests__/integrationWiring.spec.ts && echo "FAIL" || echo "OK"

# E2E script has expected steps
grep -c '"type"' scripts/oldui-tmux-script.session-browser.json
# Expected: 20+

# Run E2E test
node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.session-browser.json --assert
```

## Success Criteria
- 14+ unit integration tests
- E2E tmux test passing
- No mock theater
- Tests verify visible state/output, not internals

## Failure Recovery
```bash
rm -f packages/cli/src/ui/__tests__/integrationWiring.spec.ts
git checkout -- scripts/oldui-tmux-script.session-browser.json
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P22.md`
