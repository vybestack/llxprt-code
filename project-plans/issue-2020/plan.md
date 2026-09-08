# Plan: Issue #2020 — Increase dialog and modal orchestration coverage

Branch: `issue2020` (from main @ 98b75929f). Test-only effort: no production
code changes are in scope. If a new test exposes a genuine production bug,
stop, file it, and surface it for a decision instead of quietly changing
behavior.

## Current-state research (verified on main)

The June CodeRabbit plan comment is stale. Several of its proposed files now
exist. Verified coverage today:

| Issue bullet | Status on main | Evidence |
|---|---|---|
| Dialog disables composer | Covered | `DefaultAppLayout.test.tsx`: `it.each(ACTIVE_DIALOG_FLAGS)` asserts DialogManager renders instead of Composer for every dialog flag, plus a drift guard keeping the test table aligned with `hasActiveDialog`, plus "renders Composer when no dialog is open" |
| Escape closes only top active dialog | Partial | Per-dialog Escape tests exist for `ProviderDialog.selection.test.tsx` (incl. two-stage escape) and `ModelDialog.test.tsx`. **Gap:** DialogManager render-dispatch priority chain has no test (`DialogManager.test.tsx` only covers `useModelDialogHandler`); LoadProfileDialog Escape untested |
| Nested confirmations don't leak state | Missing | `ProfileCreateWizard/index.tsx` `showCancelConfirm`, `ProfileDetailDialog.tsx` `confirmDelete`, `ProfileSaveStep.tsx` ConflictDialog all untested |
| Provider errors render | Covered | `useProviderDialog.spec.ts`: list failure + switch failure error reporting |
| Model errors render | Covered | `ModelDialog.test.tsx`: listProviders throw, listAvailableModels rejection, partial failure; `DialogManager.test.tsx`: setActiveModel/setProvider failures route error items |
| Settings errors render | Covered | `SettingsDialog.test.tsx`: Error Handling + Error Recovery describes |
| Profile create errors render | Missing | `ProfileSaveStep` validationError/saveError/available-name rendering untested (`validation.test.ts` covers pure helpers only) |
| Profile load errors render | Missing | `useLoadProfileDialog.ts` error classification and `listSavedProfiles` failure auto-close untested; `LoadProfileDialog.tsx` has no test |
| Cancel flows preserve state | Partial | Provider/Model escape-cancel covered; missing for LoadProfileDialog, wizard cancel-resume, detail delete-cancel, save-step conflict back |
| tmux multi-step dialog smoke | Missing | Only single-step dialog scenario exists (`tmux-script.provider-model.json`) |

Architecture facts that shape the tests:

- Dialog state is unified into `UIState` via `useAppDialogs.ts`; flags come
  from `appReducer.ts` (`openDialogs`) and `useDialogOrchestration.ts`.
- `DialogManager.tsx` is a render dispatcher: `renderEarlyDialogs` (workspace
  migration, IDE prompt, folder trust, welcome, confirmation requests) runs
  first, then `renderDialogBodyFirstHalf` (theme, settings, auth, oauth,
  editor, provider) → `renderProfileDialogs` (load, create, list, detail,
  editor) → `renderDialogBodySecondHalf` (tools, privacy, permissions,
  logging, subagent, models, session browser, model config, policies).
  Priority-ordered early returns mean exactly one dialog renders even when
  several flags are true.
- "Nested confirmation" in this codebase means an internal state-machine
  sub-view inside one component (wizard `showCancelConfirm`, detail
  `confirmDelete`, save-step ConflictDialog), not stacked dialogs.
- Composer gating: `hasActiveDialog()` in `DefaultAppLayoutHelpers.tsx` swaps
  Composer for DialogManager in `MainControls`.
- `/profile create` opens the wizard (`profileCommand.ts` createCommand →
  dialog: 'createProfile'); `/profile load` without args opens
  LoadProfileDialog.
- Component tests use bun:test + ink-testing-library with
  `test-utils/render.tsx` (`renderWithProviders`, `waitFor`) and keypress
  simulation via `stdin.write` (pattern: `FolderTrustDialog.test.tsx`,
  `ModelDialog.test.tsx`).
- tmux harness: JSON scenario + entry in `scripts/tests/interactive-ui.test.ts`
  gated behind `LLXPRT_E2E_TMUX=1`; `scripts/tests/interactive-ui-paths.bun.test.ts`
  (issue #2693 contract) hardcodes the executed-scenario list and requires each
  to appear in `.github/workflows/interactive-ui.yml` path filters (PR and
  push, symmetric).

## Acceptance criteria

AC1 (verify-only, no new work): composer gating per dialog flag already
passes on main; the PR must not regress it (existing tests stay green).

AC2 — Mutual exclusivity / escape-closes-active: component tests render the
real `DialogManager` with (a) a single dialog flag set and (b) multiple flags
set simultaneously, and assert exactly one dialog's content renders, matching
the documented priority order (e.g. early dialogs beat body dialogs; provider
beats tools). Escape-driven close is asserted at the dialog level for the
dialogs that lack it (LoadProfileDialog): Escape calls `onClose` exactly once
and does not commit a selection.

AC3 — Wizard cancel confirmation does not leak state: in `ProfileCreateWizard`,
advancing past provider select then cancelling shows the CancelConfirm view;
"No, continue editing" returns to the SAME wizard step with provider/model
selection preserved; "Yes, discard and exit" calls `onClose` exactly once with
nothing persisted. Cancelling on the first step with no provider chosen closes
immediately without the confirm view.

AC4 — Detail delete confirmation does not leak state: in `ProfileDetailDialog`,
'd' enters the confirm view; 'y' invokes `onDelete` once; 'n' and Escape return
to the detail view with `onDelete` never called; Escape from the plain detail
view calls `onClose` without touching `onDelete`.

AC5 — Profile create errors render in-dialog: `ProfileSaveStep` shows the
validationError text for empty name, path separators, and duplicate name;
shows saveError text when save fails; shows "✓ Name is available" for a valid
non-duplicate name; Escape from the ConflictDialog returns to the name input.

AC6 — Profile load errors route correctly: `useLoadProfileDialog.handleSelect`
classifies errors and routes them via `addMessage` — "not found" →
`Profile 'X' not found`; "corrupted" → corrupted message; "missing required
fields" → invalid message; anything else (incl. non-Error throwables) →
generic failure message; the dialog always closes after a selection attempt.
`openDialog` on `listSavedProfiles` failure emits the error and auto-closes
the dialog.

AC7 — LoadProfileDialog states and cancel-preserve: loading state renders
while `isLoading`; empty state renders for zero profiles; Escape calls
`onClose` without `onSelect`; Enter loads the highlighted profile; arrow keys
move the highlight (grid navigation).

AC8 — tmux smoke for one multi-step dialog: a new deterministic scenario
drives `/profile create` with the fake provider: wizard opens, provider
selected (advancing a step), Escape raises the cancel confirmation, "No,
continue editing" resumes with the step state intact, Escape again → "Yes,
discard and exit" closes the wizard, the composer returns, and the app quits
cleanly. Wired into `interactive-ui.test.ts` behind `LLXPRT_E2E_TMUX=1`, the
workflow path filter, and the #2693 paths guard list.

AC9 — All new tests are TypeScript + bun:test, behavioral (no mock theater),
and pass the test-audit scanner with no new findings on touched files.

## Inputs and boundary cases

- DialogManager dispatch: one flag set (representative of each tier: early,
  first-half, profile, second-half) and ≥2 simultaneous flags spanning tiers.
  Boundary: an early-dialog flag set together with a body-dialog flag.
- Escape semantics boundary: LoadProfileDialog ignores navigation keys when
  profiles list is empty; Escape still closes.
- Wizard boundary: cancel at step 1 with no provider (immediate close, no
  confirm) vs cancel after selection (confirm shown). Resume must preserve
  stepHistory (same step, not restart).
- Detail dialog boundary: 'y'/'Y' and 'n'/'N' case variants; Escape inside
  confirm vs outside.
- Save step boundary: name "" / "a/b" / "a\\b" / duplicate of existing;
  forceSave overwrite path through the ConflictDialog.
- Profile load errors: Error messages containing each classification
  substring; a non-Error rejection (string); success path emits INFO with
  infoMessages and warnings.
- LoadProfileDialog: 0 profiles, >0 profiles, isLoading=true; Enter/Escape;
  grid moves including clamping at edges.

## Test plan (files)

New (co-located, bun:test, ink-testing-library via `test-utils/render.tsx`):

1. `packages/cli/src/ui/components/DialogManager.test.tsx` — EXTEND the
   existing file with render-dispatch tests (real DialogManager under context
   mocks already present in that file; assert visible frame content per
   dialog, not mock call shapes).
2. `packages/cli/src/ui/components/LoadProfileDialog.test.tsx` — states,
   navigation, escape, enter (AC7 + AC2 LoadProfileDialog part).
3. `packages/cli/src/ui/hooks/useLoadProfileDialog.test.ts` — error
   classification, auto-close, success messages (AC6). Hook tested through
   `renderHook` with a real-ish runtime double implementing
   `listSavedProfiles`/`loadProfileByName` semantics (infrastructure double,
   not a mirror).
4. `packages/cli/src/ui/components/ProfileCreateWizard/index.test.tsx` —
   cancel-confirm resume/discard, first-step immediate cancel (AC3).
5. `packages/cli/src/ui/components/ProfileCreateWizard/ProfileSaveStep.test.tsx`
   — validation/save error rendering, available name, conflict Escape (AC5).
6. `packages/cli/src/ui/components/ProfileDetailDialog.test.tsx` — EXTEND
   with confirmDelete flow (AC4).
7. `scripts/tmux-script.profile-create-wizard.json` — AC8 scenario (fake
   provider; same env pattern as `tmux-script.provider-model.json`).
8. `scripts/tests/interactive-ui.test.ts` — add the gated test entry (AC8).
9. `.github/workflows/interactive-ui.yml` — add the scenario path to BOTH pr
   and push filters (symmetry is asserted by the guard).
10. `scripts/tests/interactive-ui-paths.bun.test.ts` — add the new scenario
    to the executed-scenarios contract list.

No production file is modified.

## Mock policy (per dev-docs/RULES.md)

- Real components under test in every case (DialogManager, LoadProfileDialog,
  ProfileCreateWizard, ProfileSaveStep, ProfileDetailDialog).
- Infrastructure doubles only: runtime API surface (`listSavedProfiles`,
  `loadProfileByName`, provider listing), filesystem reads for existing
  profiles (bounded to a temp dir where feasible), contexts where the real
  provider is out of scope for a component test.
- Never assert a mock echo; assert rendered frames, callback effects, and
  state transitions that survive deletion of the double.
- Storage.getGlobalConfigDir usage in ProfileSaveStep: point at an isolated
  temp dir (existing pattern: set the storage env var in test setup) so
  duplicate-name and available-name cases are real.

## Verification cycle

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, then the smoke:
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
Plus: `bun test` the new tmux test locally with `LLXPRT_E2E_TMUX=1` to prove
the scenario passes end-to-end before pushing (tmux available in this
environment). Test-audit scan diffed against main with no new findings on
touched files.

## Review plan

deepthinker compliance review (max 2 rounds), then OCR (max 2 rounds:
`nohup ocr review --audience agent --timeout 20`), then PR. Every finding
classified Blocker-Fix / In-scope-Fix / Reject / Defer before action.

## Out of scope (explicitly)

- No new dialog abstraction, no stacked-dialog manager, no production
  behavior changes.
- No re-architecture of dialog state (reducer vs useState split stays).
- No coverage beyond the dialogs named in the issue.
- No cleanup of stale CodeRabbit plan comments.

## Review outcome (compliance round)

Verdict: APPROVE. No BLOCKER/HIGH/MEDIUM findings. Scope verified clean
(packages/ non-test diff vs origin/main is empty; workflow filters symmetric;
all ACs AC1-AC9 have test evidence). Reviewer verification: 46/46 component
and hook tests pass; 24/24 paths-guard tests pass; tmux scenario JSON valid
with all step types supported; every waitFor string traced to component
source.

Finding triage:
- Defer: 'y'/'Y' and 'n'/'N' case variants in ProfileDetailDialog confirmDelete
  (lowercase paths fully covered).
- Defer: ConflictDialog overwrite/forceSave path (cancel path covered; the
  overwrite path is outside the issue's named coverage bullets).
- Reject: EACCES-via-chmod fragility under a root runner (GitHub runners
  execute as the non-root `runner` user, so EACCES holds in CI).
- Defer: same-tier multi-flag dispatch ordering (AC2's cross-tier examples are
  covered; same-tier ordering is adjacent hardening).
- Nits (redundant inner KeypressProvider, act() warnings, one comment
  wording): cosmetic, no action.

Local verification summary (this container):
- Full suite: zero failures in PR files; 79 failures all environmental
  (sandbox-mode detection x14+, missing OS keyring x5, container checkpoint
  store x2, docker sandbox machinery, plus auth-renewal timing blocks under
  the swap-exhaustion window caused by two stale duplicate suites that were
  killed mid-run; none reproducible standalone, none in touched packages).
- typecheck EXIT=0; build EXIT=0; scoped lint EXIT=0 (full-repo lint and
  prettier OOM in this 7.8 GB container; scoped runs clean; CI runs the full
  gates on larger runners).
- Test-audit scan: no new findings on the diff (single pre-existing
  MOCK_ONLY_ORACLE on main's untouched useModelDialogHandler block).
- Startup smoke: blocked environmentally (credential proxy cannot serve the
  stepfun key inside this sandbox); no startup-affecting files changed.
