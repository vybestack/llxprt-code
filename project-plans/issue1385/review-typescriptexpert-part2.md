# Review: PLAN-20260214-SESSIONBROWSER — Phases 20–33 (Second Half)

**Reviewer**: typescriptexpert  
**Date**: 2025-02-14  
**Scope**: P20 (continue-command-impl) through P33 (final-verification)  
**Method**: Cross-referenced all 14 plan phases against requirements.md, PLAN-TEMPLATE.md, RULES.md, and live codebase files  

---

## CRITICAL Issues

### C-01: P23 Instructs Reducer Pattern — Codebase Uses useState for New Dialogs

**File**: `project-plans/issue1385/plan/23-integration-wiring-impl.md` line 32  
**Problem**: P23 says "Ensure reducer handles OPEN_SESSION_BROWSER / CLOSE_SESSION_BROWSER actions." The codebase has **two dialog management patterns**:

- **Older (reducer)**: theme, auth, editor, provider, privacy, profiles, tools, oauthCode — managed via `appReducer.ts` `OPEN_DIALOG`/`CLOSE_DIALOG` actions with `AppState.openDialogs` map.
- **Newer (useState)**: subagent, models, logging, permissions, folderTrust, workspaceMigration — managed via `useState` in `AppContainer.tsx` with `useCallback` open/close pairs (e.g., `isSubagentDialogOpen` at AppContainer.tsx L613).

All new dialogs added in recent history use the **useState** pattern. Following the reducer pattern would be inconsistent with the codebase convention and would add session browser to the `appReducer.ts` action type union — a pattern the project is moving away from.

**Impact**: TypeScript will compile either way, but the implementation would violate codebase conventions and create inconsistency. P22 tests that assert reducer behavior will be wrong.  
**Fix**: Rewrite P23 §1 to use `useState` in `AppContainer.tsx`:
```typescript
const [isSessionBrowserDialogOpen, setIsSessionBrowserDialogOpen] = useState(false);
const openSessionBrowserDialog = useCallback(() => setIsSessionBrowserDialogOpen(true), []);
const closeSessionBrowserDialog = useCallback(() => setIsSessionBrowserDialogOpen(false), []);
```
Also update P21 and P22 to follow this pattern (UIState still needs the boolean, but it's populated from AppContainer useState, not from appReducer).

---

### C-02: P20 References `ctx.isProcessing` — Does Not Exist in CommandContext

**File**: `project-plans/issue1385/plan/20-continue-command-impl.md` line 33, 90  
**Problem**: P20's algorithm step 1 says "CHECK in-flight: if `ctx.isProcessing` → error". The `CommandContext` interface in `packages/cli/src/ui/commands/types.ts` has NO `isProcessing` field. Searching the entire commands directory confirms no command accesses `isProcessing`.

The `isProcessing` state lives in `slashCommandProcessor.ts` (L102, L420, L804) as a parameter to the `useSlashCommandProcessor` hook — it is not exposed to individual command actions.

**Impact**: Implementation would fail TypeScript immediately. If worked around by adding the field to CommandContext, it adds plumbing that no other command uses, violating existing patterns.  
**Fix**: Either (a) remove the in-flight check from the `/continue` command (no other command does this — the processor already blocks input during processing), or (b) add `isProcessing: boolean` to `CommandContext` in P18 stub phase and thread it through the processor. Option (a) is strongly preferred — it matches existing command behavior.

---

### C-03: P20 References `ctx.session.currentSessionId` — Does Not Exist

**File**: `project-plans/issue1385/plan/20-continue-command-impl.md` line 39, 88  
**Problem**: P20 algorithm step 4a says "GET currentSessionId from `ctx.session`". The `CommandContext.session` field (types.ts L94) only contains `{ stats: SessionStatsState; sessionShellAllowlist: Set<string> }`. There is no `currentSessionId`.

**Impact**: Implementation would fail TypeScript. The command needs session ID to check "already active" but has no access path.  
**Fix**: Add `currentSessionId?: string` to `CommandContext.session` in P18, OR source it from `ctx.services.config.getSessionId()` (which does exist on the Config interface). The latter requires no interface changes and is the idiomatic approach — config already exposes session ID.

---

### C-04: P26 Has Wrong Import Path for `formatRelativeTime`

**File**: `project-plans/issue1385/plan/26-stats-session-section-impl.md` line 77  
**Problem**: P26 instructs importing `formatRelativeTime` from `'../utils/formatRelativeTime.js'`. The source file is `packages/cli/src/ui/commands/formatSessionSection.ts`. Resolving the relative path:
- `packages/cli/src/ui/commands/` + `../utils/` = `packages/cli/src/ui/utils/formatRelativeTime.js`
- But the actual file (per P03 — the creator phase) is at `packages/cli/src/utils/formatRelativeTime.ts`
- **Correct import**: `'../../utils/formatRelativeTime.js'`

**Impact**: TypeScript will fail with "module not found" — this completely blocks P26 implementation.  
**Fix**: Change the import directive in P26 to `'../../utils/formatRelativeTime.js'`.

---

### C-05: P29 Missing Test File Updates — `gemini.test.tsx` and `config.loadMemory.test.ts`

**File**: `project-plans/issue1385/plan/29-legacy-cleanup-impl.md` lines 69–87  
**Problem**: P29 lists only 3 files to modify: `config.ts`, `sessionUtils.ts`, and `config.test.ts`. But removing the `resume` field from the args type interface will cause TypeScript failures in **two additional test files** that include `resume: undefined` in their config mocks:

1. `packages/cli/src/gemini.test.tsx` line 336: `resume: undefined,`
2. `packages/cli/src/config/config.loadMemory.test.ts` line 327: `resume: undefined,`

Both files construct typed mock objects that conform to the args interface. After removal of the `resume` field, these mocks will have an excess property that TypeScript will flag.

**Impact**: `npm run typecheck` will fail after P29, blocking P30-P33.  
**Fix**: Add both files to P29's "Files to Modify" section with instruction to remove the `resume: undefined` line from each mock object. Also add them to the failure recovery git checkout list.

---

### C-06: P30 and P32 Use Wrong Path for `performResume.ts`

**File**: `project-plans/issue1385/plan/30-e2e-integration-stub.md` line 14; `project-plans/issue1385/plan/32-e2e-integration-impl.md` lines 91, 159, 236  
**Problem**: P09 (the creator phase) places `performResume.ts` at `packages/cli/src/services/performResume.ts`. P10, P11, and P20 consistently reference this path. But P30 (line 14), P32 (lines 91, 159, 236), and P33 (line 274 implicitly) all reference `packages/cli/src/utils/performResume.ts`.

**Impact**: P32 will modify a non-existent file. The failure recovery in P32 (line 236: `git checkout -- packages/cli/src/utils/performResume.ts`) would also silently fail. The E2E tests in P31 that import from `utils/performResume` will get "module not found".  
**Fix**: Change all references in P30, P32, P33 from `packages/cli/src/utils/performResume.ts` to `packages/cli/src/services/performResume.ts`.

---

### C-07: P30 Uses Wrong Path for `formatRelativeTime.ts`

**File**: `project-plans/issue1385/plan/30-e2e-integration-stub.md` line 17  
**Problem**: P30 prerequisite list says `packages/cli/src/ui/utils/formatRelativeTime.ts` but P03 (creator) places it at `packages/cli/src/utils/formatRelativeTime.ts`. The `ui/utils/` path is wrong.

**Impact**: Prerequisite check would incorrectly report the file as missing, though this is non-blocking since it's a documentation-only prerequisite. However, if an implementer uses this path in E2E test imports, it would fail.  
**Fix**: Change to `packages/cli/src/utils/formatRelativeTime.ts`.

---

## MAJOR Issues

### M-01: P20 References `ctx.hasActiveConversation` — Does Not Exist

**File**: `project-plans/issue1385/plan/20-continue-command-impl.md` line 41  
**Problem**: P20 algorithm step 4c says "CHECK active conversation: if `ctx.hasActiveConversation`". The `CommandContext` interface has no such field. The concept of "active conversation" (whether the user has exchanged messages) would need to be derived — likely from checking if the history is non-empty.

**Impact**: Implementation needs a workaround. The intent is valid (don't silently replace an active conversation), but the mechanism doesn't exist.  
**Fix**: Either (a) derive from `ctx.session.stats` (if it tracks message count), (b) add a `hasMessages: boolean` field to CommandContext in P18, or (c) check the history length via the services available in CommandContext. Option (c) is most pragmatic — most commands don't need this check, and the UI processor already handles confirmation flows.

---

### M-02: P24 Doesn't Address `defaultSessionView()` Sync-to-Async Conversion

**File**: `project-plans/issue1385/plan/24-stats-session-section-stub.md` line 51  
**Problem**: P24 acknowledges that `defaultSessionView()` in `statsCommand.ts` is currently synchronous (returns `string[]` directly), but `formatSessionSection` returns `Promise<string[]>` (because it calls `fs.stat`). P24 mentions this in passing ("will need to be made async or the section appended separately") but provides NO concrete instructions for how to handle it.

The existing `defaultSessionView()` (L102-123 in statsCommand.ts) is called synchronously from the action handler. Making it async requires changes to the calling code that aren't specified.

**Impact**: The implementer will discover this at P26 when trying to wire the async function into the sync call chain. This could cause cascading changes to the stats command action flow.  
**Fix**: P24 should specify the exact transformation: make `defaultSessionView` return `Promise<string[]>`, update the calling action to `await` it (the action is already async based on the quota subcommand), and update `defaultSessionView`'s callers (likely just the main stats action switch).

---

### M-03: P22 Test #7-#8 Require Rendering Tests — Forbidden by Test Pattern

**File**: `project-plans/issue1385/plan/22-integration-wiring-tdd.md` lines 47-48  
**Problem**: Tests 7-8 assert that "DialogManager renders browser when open / does not render when closed." The Forbidden Patterns section (line 74) forbids `expect(DialogManager).toContainComponent(SessionBrowserDialog)`. But the only way to verify rendering is through component testing (e.g., `@testing-library/react` render + query).

These tests sit in an awkward middle ground: they're too specific for behavioral testing (you can't observe "rendered" without mounting the component) but the test strategy explicitly forbids component-internal assertions.

**Impact**: Tests 7-8 may be impractical as written. They would need either (a) a different assertion strategy (e.g., testing that the dialog's side effects fire when opened, not the render tree), or (b) explicitly using Ink testing utilities which IS allowed by RULES.md for component tests.  
**Fix**: Rewrite tests 7-8 to use Ink test rendering (`render(<DialogManager ... />)` and query for output text), which is the established pattern for component-level behavioral tests in this project. The "forbidden" note is about testing internal implementation details, not about rendering the component.

---

### M-04: P20 Command Returns `LoadHistoryActionReturn` But Processor May Not Handle Swap

**File**: `project-plans/issue1385/plan/20-continue-command-impl.md` lines 48-50  
**Problem**: P20 says the command should "Update recording state (swap recording, lock handle)" and return `LoadHistoryActionReturn`. But looking at the processor's `load_history` handler (slashCommandProcessor.ts L612-619), it only updates UI history (`setHistory()`, `clear()`, `addItem()` loop). It does NOT handle recording swap (dispose old recording, acquire new lock, update recording state).

The `/continue <ref>` direct path needs to perform the recording swap, but the command action doesn't have access to the recording infrastructure — that lives in `AppContainer.tsx`. The action return type `LoadHistoryActionReturn` only carries `history` and `clientHistory`, not recording swap state.

**Impact**: The direct resume path (with args) would update UI history but leave the old recording infrastructure active. New messages would be recorded to the OLD session file, completely defeating the resume purpose.  
**Fix**: The recording swap must happen BEFORE the command returns. Two options:
1. Pass recording swap capability into CommandContext (requires P18 changes), or
2. Return a new action type (e.g., `ResumeActionReturn`) that carries the swap payload, and handle it in the processor with a new case that performs both history replacement AND recording swap. This is cleaner but requires a new action type.

Option 2 is recommended since it follows the existing pattern of actions returning data and the processor performing side effects.

---

### M-05: P33 Requirement Traceability Missing REQ-SB-022

**File**: `project-plans/issue1385/plan/33-final-verification.md` line 78  
**Problem**: P33's requirement traceability check for session browser lists REQ-SB-001 through REQ-SB-026, but explicitly skips REQ-SB-022. While REQ-SB-022 is marked as "Merged into REQ-SB-005" in requirements.md (L78-79), the grep verification would miss it entirely. If any code uses `@requirement:REQ-SB-022`, the P33 check wouldn't validate it. More importantly, P33 also skips REQ-SB-022 in the grep loop — this is correct if there truly are no `@requirement:REQ-SB-022` markers, but the verification should explicitly confirm this.

**Impact**: Low — requirement is merged. But incomplete traceability verification.  
**Fix**: Add a comment in P33's SB block noting `REQ-SB-022 merged into REQ-SB-005 — no separate marker expected`, and optionally add a negative check: `grep -r "@requirement:REQ-SB-022" packages/ | wc -l` expecting 0.

---

### M-06: P22 Tests Don't Match P21's UIState/UIActions Pattern

**File**: `project-plans/issue1385/plan/22-integration-wiring-tdd.md` lines 40-43  
**Problem**: P22 test #5 asserts "Dialog action triggers UIState: When dialog action is processed, `isSessionBrowserDialogOpen` becomes true." This test requires observing UIState changes, which in the useState pattern means testing the AppContainer's state management. But the test file is `packages/cli/src/ui/__tests__/integrationWiring.test.ts` — not an AppContainer test.

If following the useState pattern (per C-01), the UIState changes happen inside AppContainer's callback, not through a testable reducer. Testing that "processing a dialog action sets UIState" requires either mounting AppContainer or testing the slash command processor with a mock actions object — but the forbidden patterns explicitly prohibit `expect(openSessionBrowserDialog).toHaveBeenCalled()`.

**Impact**: Tests 5-6 are potentially untestable as currently described if the useState pattern is used.  
**Fix**: Reframe tests 5-6 to test the slash command processor's dialog dispatch in isolation: verify that calling `handleSlashCommand('/continue')` with a mock actions object calls the `openSessionBrowserDialog` callback. This IS allowed because we're testing the processor's routing logic, not mocking component internals. The key is testing that the processor calls the correct action, which is its behavioral contract.

---

### M-07: P31 E2E Tests Reference `/continue` Command Action Directly — Wrong Abstraction Level

**File**: `project-plans/issue1385/plan/31-e2e-integration-tdd.md` lines 119-166  
**Problem**: P31 test cases mix unit-level testing (calling `performResume()` directly, testing `continueCommand.action()` return types) with what's labeled as "E2E integration tests." True E2E tests should test the full flow through the slash command processor, not call internal functions directly. Several tests (1-6, 12-14) are really unit tests for `performResume` and `continueCommand` — they duplicate coverage from P10/P19.

**Impact**: Test duplication increases maintenance burden. The "E2E" tests won't catch integration wiring bugs because they bypass the wiring.  
**Fix**: Keep performResume-level tests (1-6) as they are (they exercise real filesystem), but rewrite tests 12-14 to flow through the slash command processor (or at minimum through the action→processor→state pipeline). The test labeled "E2E" should verify the full chain: command input → action return → processor handling → state update.

---

### M-08: No Plan Phase Covers `CommandContext` Extension

**File**: Multiple plan phases reference `ctx.session`, `ctx.isProcessing`, `ctx.hasActiveConversation` — none exist  
**Problem**: P20 relies on CommandContext fields that don't exist (C-02, C-03, M-01). While P18 creates the `continueCommand.ts` stub, it doesn't mention extending `CommandContext` in `types.ts`. The fields needed by the command:
- `currentSessionId` (or access via config)
- Some way to detect active conversation
- `recordingIntegration` (already exists)

But NO phase explicitly adds these fields to the interface or threads them through the processor.

**Impact**: P20 implementation will require ad-hoc changes to `types.ts` and the processor's context construction (in `slashCommandProcessor.ts` L233-280 where CommandContext is built). These unplanned changes could introduce regressions.  
**Fix**: Add a substep to P18 (stub phase) that explicitly extends `CommandContext.session` with:
```typescript
session: {
  stats: SessionStatsState;
  sessionShellAllowlist: Set<string>;
  currentSessionId?: string;       // NEW
  recordingMetadata?: SessionRecordingMetadata; // NEW
};
```
And add the corresponding threading in the processor's context construction.

---

## MINOR Issues

### N-01: P33 Requirement IDs Use Inconsistent Grep Pattern

**File**: `project-plans/issue1385/plan/33-final-verification.md` lines 78-250  
**Problem**: P33 uses `@requirement:$req` (with colon) in the grep pattern, but the plan phases' required code markers section shows two different formats:
- In describe/it strings: `@requirement:REQ-XX-NNN` (colon, no space)
- In JSDoc comments: `@requirement REQ-XX-NNN` (space, no colon)

The grep would miss JSDoc-style markers.  
**Fix**: Change grep to `grep -r "@requirement[: ]$req"` to match both formats.

---

### N-02: P28 Property Test May Not Be Meaningful

**File**: `project-plans/issue1385/plan/28-legacy-cleanup-tdd.md` lines 98-102  
**Problem**: P28's property test #12 says "For any valid session reference string, `['--continue', ref]` and `['--delete-session', ref]` are accepted by the parser." This tests yargs parsing, which is already well-tested. The property space (arbitrary strings that aren't flags) doesn't exercise interesting edge cases — it's a property test for a third-party library (yargs).

**Impact**: Low — test exists but adds little value.  
**Fix**: Consider replacing with a more valuable property: "For any string that was previously accepted by --resume, --continue accepts it too" — this verifies behavioral equivalence.

---

### N-03: P27 Deprecation Marker Line Numbers May Be Stale

**File**: `project-plans/issue1385/plan/27-legacy-cleanup-stub.md` lines 87-96  
**Problem**: P27 references specific line numbers (L52, L167, L349-361, L687) in config.ts and (L19, L44, L161) in sessionUtils.ts. By the time P27 executes, earlier phases (P18, P21, P23) will have modified these files, shifting line numbers.

**Impact**: Low — these are advisory. Implementer should search for the code patterns, not rely on line numbers.  
**Fix**: Add a note: "Line numbers are approximate — search for the patterns, not line numbers, as earlier phases may have shifted them."

---

### N-04: P24 Doesn't Specify Where `recordingMetadata` Comes From in statsCommand

**File**: `project-plans/issue1385/plan/24-stats-session-section-stub.md` line 50  
**Problem**: P24 says to call `formatSessionSection(context.session.recordingMetadata ?? null)`. But `context.session` in the stats command's action context is `SessionStatsState` — which has no `recordingMetadata` field. The stats command would need this threaded through its context, similar to M-08.

**Impact**: The implementation will need to figure out how to pass recording metadata to the stats command. This is not explicitly planned in any phase.  
**Fix**: P24 should specify: add `recordingMetadata: SessionRecordingMetadata | null` to the stats command's context (likely passed from AppContainer via the command context), or access it via a shared state context.

---

### N-05: P31 Expects 19+ Tests but P30 Infrastructure Only Sets Up Describe Blocks

**File**: `project-plans/issue1385/plan/31-e2e-integration-tdd.md` line 115; P30 line 83  
**Problem**: P30 creates the test infrastructure (helpers, describe blocks) but P31 adds 19+ actual test cases. The helper functions `createTestSession` and `setupChatsDir` in P30 create JSONL files for `SessionDiscovery`, but P31 tests 12-14 test `continueCommand.action()` which needs a full `CommandContext`. No infrastructure for creating mock CommandContext is described in P30.

**Impact**: P31 implementer will need to create CommandContext test helpers that aren't in the P30 spec.  
**Fix**: Add CommandContext helper creation to P30's infrastructure setup, or explicitly note it as required in P31.

---

### N-06: P33 Smoke Test Uses Hardcoded Keyfile Path

**File**: `project-plans/issue1385/plan/33-final-verification.md` line 68  
**Problem**: The smoke test uses `--keyfile ~/.llxprt/keys/.synthetic2_key` which is a machine-specific path. The project memory notes this is needed "because the basic synthetic key hits quota." This works on the developer's machine but would fail in CI or on another developer's machine.

**Impact**: Low — P33 is manual verification, not CI.  
**Fix**: Add a note: "This keyfile is specific to the development machine. In CI, use the standard synthetic profile without --keyfile." Or better: check if the keyfile exists first.

---

### N-07: P32 "DO NOT MODIFY" Constraint May Be Impractical

**File**: `project-plans/issue1385/plan/32-e2e-integration-impl.md` line 117  
**Problem**: P32 says "DO NOT MODIFY `packages/cli/src/__tests__/sessionBrowserE2E.test.ts`" (tests from P31). But P32 is the "green phase" — if any test from P31 has a legitimate mistake (wrong expected value, incorrect assumption about API), the implementer is forbidden from fixing it. This is overly rigid for E2E tests which often need adjustment when the full integration is first wired up.

**Impact**: Could cause unnecessary phase failure and rollback.  
**Fix**: Soften to: "PREFER not to modify tests from P31. If a test must be changed, document the change and justification in the phase completion marker."

---

### N-08: P22 Test Count Discrepancy

**File**: `project-plans/issue1385/plan/22-integration-wiring-tdd.md`  
**Problem**: The body describes 17 tests (1-17), but the success criteria says "15+ tests." The verification command expects `grep -c "it("` to return 15+. This is fine but inconsistent — either document all 17 or lower the expectations consistently.

**Impact**: Cosmetic only.  
**Fix**: Update success criteria to "17 tests" or note "15+ minimum, 17 described."

---

## PLAN-TEMPLATE.md Compliance

| Requirement | P20 | P21 | P22 | P23 | P24 | P25 | P26 | P27 | P28 | P29 | P30 | P31 | P32 | P33 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Phase 0.5 preflight reference | [ERROR] | [ERROR] | [ERROR] | [ERROR] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] |
| @plan markers specified | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | N/A |
| @requirement markers | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] |
| @pseudocode references | [OK] | [ERROR] | [ERROR] | [ERROR] | [OK] | [ERROR] | [OK] | [ERROR] | [ERROR] | [OK] | [ERROR] | [ERROR] | [OK] | N/A |
| Deferred impl detection | [ERROR] | [ERROR] | [ERROR] | [ERROR] | [ERROR] | [ERROR] | [OK] | [ERROR] | [ERROR] | [OK] | [ERROR] | [ERROR] | [OK] | [OK] |
| Semantic verification checklist | [ERROR] | [ERROR] | [ERROR] | [ERROR] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] |
| Failure recovery | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [ERROR] |
| Completion marker | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] | [OK] |

**Key gaps**: P20-P23 (the most complex phases) lack deferred implementation detection and semantic verification checklists. These are the phases most likely to produce incomplete implementations — exactly where those checks are most needed.

---

## Test Strategy Assessment

| Phase | Test Type | Count | Property Tests | Mock-Free | Verdict |
|---|---|---|---|---|---|
| P22 | Integration/wiring | 17 | 1 | [OK] (with caveats) | Tests 7-8 problematic (M-03) |
| P25 | Unit/behavioral | 13 | 3 | [OK] | Good coverage |
| P28 | Behavioral + structural | 12 | 1 | [OK] | Property test low-value (N-02) |
| P31 | E2E integration | 19 | 3 | [OK] | Mislabeled — many are unit tests (M-07) |

Overall test strategy is solid for individual components but weak at the true integration seams. The biggest testing gap is that no test verifies the full chain: user types `/continue` → processor dispatches → dialog opens → user selects session → performResume called → recording swapped → UI updated. This end-to-end chain is the most critical path and is only tested piecemeal.

---

## Summary

| Severity | Count | Blocking? |
|---|---|---|
| CRITICAL | 7 | Yes — C-01 through C-07 will cause TypeScript failures or wrong behavior |
| MAJOR | 8 | Likely — require plan amendments or workarounds during implementation |
| MINOR | 8 | No — documentation/cosmetic issues |

**Highest-risk phases**: P20 (3 critical CommandContext issues), P23 (wrong dialog pattern), P26 (wrong import path), P29 (missing file updates).

**Recommendation**: Address all CRITICAL issues before starting implementation. The P20 CommandContext issues (C-02, C-03, M-01, M-08) are systemic — they require adding a substep to P18 that extends the CommandContext interface, which cascades to P19 (tests) and P20 (impl). Starting implementation without fixing these will result in P20 failing and requiring unplanned rework.
