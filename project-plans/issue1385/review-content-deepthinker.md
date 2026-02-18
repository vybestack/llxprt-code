# Review: PLAN-20260214-SESSIONBROWSER

## CRITICAL

1. **Requirements traceability is structurally impossible in current plan corpus (high risk of silent spec gaps).**
   - **File/section:** `project-plans/issue1385/requirements.md` (global), all plan phase docs (`project-plans/issue1385/plan/*.md`) and `project-plans/issue1385/execution-tracker.md`.
   - **What’s wrong:** The requirement set is large and granular, but plan phases do not maintain stable requirement IDs in implementation tasks and verification checklists. This makes it impossible to prove complete coverage phase-by-phase and creates a strong likelihood of missed behavior in implementation/review handoffs.
   - **Fix:** Introduce strict requirement IDs in `requirements.md` and require every phase to include a “Req Coverage” table (`Req-ID -> task(s) -> test(s)`). Add CI-like plan gate in `execution-tracker.md` requiring 100% mapped coverage before phase completion.

2. **Two-phase resume swap failure semantics are under-specified at the lock/service boundary (can leave runtime in ambiguous state).**
   - **File/section:** `project-plans/issue1385/analysis/domain-model.md` and `project-plans/issue1385/plan/20-continue-command-swap-orchestrator.md`, `26-continue-command-recovery-and-rollforward.md`.
   - **What’s wrong:** The plan references two-phase swap and recovery, but does not fully define atomic boundaries across: acquiring target lock, pausing/stopping current recording service, activation of target session state, and rollback strategy if failure occurs mid-transition. Missing explicit state machine transitions and ownership guarantees can cause dual-writer risk or no-active-writer dead state.
   - **Fix:** Define explicit orchestration states and invariants: `Idle -> Preparing -> CurrentQuiesced -> TargetActivated -> Committed` with compensating transitions. Require lock ownership proof before quiesce, and deterministic rollforward/rollback matrix for each failure point.

3. **Generation guard appears insufficiently specified against concurrent resume invocations and stale UI intents.**
   - **File/section:** `project-plans/issue1385/plan/25-continue-command-generation-guard.md`, `03-dialog-state-machine.md`, `10-session-browser-dialog-manager-integration.md`.
   - **What’s wrong:** Guard concept exists, but the plan does not fully define lifecycle of generation increments (who increments, when compared, which async operations are invalidated). Without complete CAS-like semantics, race conditions remain when multiple `/continue` attempts or dialog reopen/refresh operations overlap.
   - **Fix:** Specify monotonic generation source-of-truth, read/compare/write protocol for async handlers, and guaranteed stale-result discard paths. Add dedicated concurrency tests for overlapping resume requests and rapid open/close/reopen dialog flows.

4. **Non-cancellable `/continue` execution conflicts with interactive CLI event handling unless explicit shielding points are enforced.**
   - **File/section:** `project-plans/issue1385/plan/24-continue-command-non-cancellable-execution.md`, `22-continue-command-cli-integration.md`, `packages/cli/src/ui/slashCommandProcessor.ts`.
   - **What’s wrong:** Requirement for non-cancellable critical section is present, but the plan does not clearly delineate pre-critical cancellable work vs non-interruptible swap segment and how signal handling is deferred/acknowledged. This can violate UX expectations or corrupt swap invariants under Ctrl+C timing.
   - **Fix:** Introduce explicit “cancellation barrier” API: resolve session + validate preconditions (cancellable), then enter uninterruptible section with deferred cancellation token acknowledgment after commit/rollback completes. Add signal timing tests.

5. **Session browser progressive preview enrichment risks stale/incorrect preview due to missing consistency contract.**
   - **File/section:** `project-plans/issue1385/plan/12-progressive-preview-enrichment.md`, `06-session-browser-preview-pane.md`.
   - **What’s wrong:** Progressive enrichment is planned, but there is no strict binding between selected session identity and arriving async enrichment payloads. Rapid selection changes can display wrong preview data.
   - **Fix:** Require per-request session key/version tagging and discard enrichment responses that do not match current selected session + generation. Add tests for fast keyboard navigation while enrichment requests are in flight.

## MAJOR

6. **Dialog cascade integration lacks explicit focus-return contract across nested/adjacent dialogs.**
   - **File/section:** `10-session-browser-dialog-manager-integration.md`, `11-session-browser-keyboard-and-focus.md`, `packages/cli/src/ui/components/DialogManager.tsx`.
   - **What’s wrong:** Integration mentions dialog manager wiring but does not fully specify focus restoration source/target when session browser opens from command flow and closes after selection/cancel/error. This causes accessibility regressions and keyboard traps.
   - **Fix:** Add deterministic focus policy (origin focus capture + restore fallback), tested across normal close, error close, and terminal resize.

7. **Responsive layout planning does not explicitly handle resize during active keyboard interaction and pagination boundaries.**
   - **File/section:** `09-session-browser-responsive-layout.md`, `14b-session-browser-responsive-tests.md`, `packages/cli/src/ui/hooks/useResponsive.ts`.
   - **What’s wrong:** Breakpoint behavior is planned, but no explicit invariants for preserving selection index, scroll window, and preview pane state when crossing breakpoints mid-navigation.
   - **Fix:** Define resize invariants and add test matrix: narrow->wide, wide->narrow while search active, no-results state, last-page state.

8. **Error taxonomy for session discovery/loading is not normalized end-to-end.**
   - **File/section:** `08-session-browser-error-and-loading-states.md`, `23-continue-command-output-and-errors.md`, `packages/core/src/recording/SessionDiscovery.ts`.
   - **What’s wrong:** The plan distinguishes errors conceptually but does not enforce a canonical error model from core discovery through CLI rendering. This risks inconsistent user messaging and brittle error handling branches.
   - **Fix:** Add shared error enum/category mapping (NotFound, Locked, Corrupt, Permission, Unknown) and require translation at boundary layers only.

9. **Session deleted/changed-between-list-and-select edge case not fully closed in selection flow.**
   - **File/section:** `05-session-browser-core-dialog.md`, `19-continue-command-session-resolution.md`, `28-continue-command-e2e-tests.md`.
   - **What’s wrong:** Edge case is acknowledged in spirit, but plan does not guarantee revalidation immediately prior to swap and user-facing remediation path (refresh prompt/reopen behavior).
   - **Fix:** Enforce final session existence + lockability recheck in orchestrator entrance; surface actionable message and keep user in recoverable flow.

10. **Lock contention strategy is not clearly differentiated for same-process vs cross-process ownership.**
    - **File/section:** `20-continue-command-swap-orchestrator.md`, `21-continue-command-recording-service-integration.md`, `packages/core/src/recording/SessionLockManager.ts`.
    - **What’s wrong:** Plan handles “locked by another process” generally, but lacks explicit branch for current-process-held lock scenarios during swap (handoff semantics). This can produce false-positive lock failures or unsafe unlock ordering.
    - **Fix:** Define lock ownership metadata checks and precise handoff behavior for intra-process transitions versus external lock denial.

11. **Corrupt JSONL handling may stop list rendering instead of degrading per-session.**
    - **File/section:** `02-session-summary-builder.md`, `08-session-browser-error-and-loading-states.md`, `packages/core/src/recording/ReplayEngine.ts`.
    - **What’s wrong:** Corruption handling does not clearly guarantee partial-failure tolerance during session list/preview generation. One bad session may poison full list or preview pipeline.
    - **Fix:** Require per-session fault isolation with placeholder metadata and warning state; never fail full browser load from a single corrupt artifact.

12. **Slash command registration/invocation plan may conflict with existing command parsing precedence.**
    - **File/section:** `27-continue-command-slash-command-registration.md`, `22-continue-command-cli-integration.md`, `packages/cli/src/ui/commands/chatCommand.ts`, `packages/cli/src/ui/slashCommandProcessor.ts`.
    - **What’s wrong:** Plan adds `/continue` but does not explicitly verify parser precedence, aliases, argument tokenization, and conflict with existing commands.
    - **Fix:** Add parser contract tests ensuring deterministic dispatch, help text inclusion, and unambiguous behavior for `/continue`, `/continue <id>`, invalid args.

13. **Plan verification phases are too late for integration defects (front-loaded risk not mitigated).**
    - **File/section:** `17a-session-browser-dialog-impl-verification.md`, `31a/31b`, `32`, `33`.
    - **What’s wrong:** Major cross-component validation is concentrated late, after significant implementation accumulation. This increases rework risk for architecture-level mismatches.
    - **Fix:** Add earlier cross-cutting checkpoints after phases 10 and 22 with minimal end-to-end vertical slices.

## MINOR

14. **Plan naming/granularity is uneven across some phases (harder reviewability).**
    - **File/section:** `13a/13b`, `14a/14b`, `31a/31b`.
    - **What’s wrong:** Split phases are useful but don’t consistently declare strict entry/exit criteria; reviewers may mark completion without objective gates.
    - **Fix:** Add explicit phase completion criteria with required test files and expected assertions.

15. **Mockup-to-implementation trace is weak for keyboard shortcut parity.**
    - **File/section:** `mockup.md`, `11-session-browser-keyboard-and-focus.md`.
    - **What’s wrong:** Visual/interaction spec includes shortcut expectations, but mapping to implementation/test cases is not fully explicit.
    - **Fix:** Add shortcut matrix table (key, context, expected effect, blocked contexts) and bind each row to automated tests.

16. **Manual validation checklists may duplicate but not reconcile with automated test scope.**
    - **File/section:** `15-session-browser-manual-validation.md`, `29-continue-command-manual-validation.md`, `33-final-verification.md`.
    - **What’s wrong:** Some scenarios appear only in manual steps without clear rationale for why they cannot be automated.
    - **Fix:** Tag each manual-only scenario with automation gap reason and follow-up backlog item.

17. **Execution tracker does not appear to encode explicit risk burn-down metrics.**
    - **File/section:** `execution-tracker.md`.
    - **What’s wrong:** Progress tracking is phase-centric but lacks explicit “top integration risks” list with mitigation status.
    - **Fix:** Add rolling risk register tied to phases and test evidence.

18. **Documentation update phases should include migration note for users with existing mental model of session switching.**
    - **File/section:** `16-session-browser-doc-updates.md`, `30-continue-command-doc-updates.md`.
    - **What’s wrong:** Docs updates are included, but migration-style clarification of old vs new resume workflow may be missing.
    - **Fix:** Add “Behavior changes” section in user docs and command help.

---

## Cross-cutting Requirement Coverage Findings

### A. Requirements that are present but weakly enforced
- Two-phase swap integrity: present in phases 20/26 but missing precise atomicity and rollback matrix.
- Generation guard: present in phase 25 but missing complete concurrent intent invalidation rules.
- Progressive preview enrichment: present in phase 12 but stale payload handling not fully specified.
- Dialog cascade/focus integration: present in phases 10/11 but not fully contract-tested.
- Non-cancellable resume: present in phase 24 but missing signal boundary details.

### B. Requirements likely under-covered or ambiguously covered
- Session mutation between list and commit point.
- Lock ownership differentiation (same process vs other process).
- Resize during active interaction with preserved semantic state.
- Parser precedence/ambiguity for slash command dispatch.
- Per-session corruption isolation without global list failure.

### C. Process/spec compliance concern
- Given requirement volume, the absence of strict Req-ID traceability in each plan phase is itself a specification fidelity risk and should be treated as a blocking quality issue.
