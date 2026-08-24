# Issue #2021: Increase tool approval and tool-call UI coverage

Coverage-only issue. The organizing invariant (from issue comment, rpelevin):
every emitted tool call that requires approval becomes exactly one terminal
state — allowed result, user-denied result, policy-denied result, cancelled
result, timed-out result, or tool error — and the UI the reviewer sees stays
attached to the same pending call the scheduler is waiting on.

No production behavior changes. The only non-test code change allowed is the
tmux harness `approveTool` step, whose default confirmation matcher and
`choice:"always"` visibility check reference UI labels ("Yes, allow once" /
"Yes, allow always") that no longer exist; the current labels are "Allow once"
and "Allow for this session". That fix is required to express AC6 and also
un-breaks `tmux-script.approvals.json` (uses `choice:"once"` with the stale
default matcher).

## Accepted behavior

### AC1 — Scheduler approval outcomes reach exactly one terminal state

Driven through the real `CoreToolScheduler.schedule()` with an ASK policy and
a tool whose `shouldConfirmExecute` returns confirmation details; the wrapped
`confirmationDetails.onConfirm(outcome)` captured from the
`awaiting_approval` call drives the decision.

- ProceedOnce → `success`, tool executed (execute mock called once).
- Cancel (user denial) → `cancelled`, reason `User did not allow tool call`.
- Abort signal fired while awaiting approval, then onConfirm → `cancelled`,
  never `error`.
- Policy DENY contrast: `status: 'error'`, `errorType: POLICY_VIOLATION`,
  `TOOL_POLICY_REJECTION` bus event, and NO `TOOL_CONFIRMATION_REQUEST`
  published. User denial contrast: `TOOL_CONFIRMATION_REQUEST` published
  first, final status `cancelled`, no `errorType`.

Boundary: abort-before-confirmation is already covered in
`coreToolScheduler.confirmation.test.ts` (stays); the new coverage is
abort-while-awaiting and the policy/user denial contrast.

### AC2 — Multiple pending calls and the ProceedAlways cascade

Real scheduler, two or more calls scheduled together, each landing in
`awaiting_approval` with distinct call ids.

- Resolving call A with ProceedOnce leaves call B awaiting (decisions do not
  leak across call ids).
- Resolving call A with ProceedAlways, where A's original `onConfirm` adds the
  tool to an instance-scoped allowlist that B's `shouldConfirmExecute`
  consults (mirrors ShellTool/publishPolicyUpdate semantics), flips B to
  `scheduled` → `success` with no additional `TOOL_CONFIRMATION_REQUEST`
  published for B.
- Partial cascade: a second, non-allowlisted tool still awaiting approval
  stays `awaiting_approval` (only compatible calls auto-approve).

Fixtures are fresh per test (instance-scoped allowlist), per the "always
allow where safe with isolated fixtures" requirement.

### AC3 — Message-bus round-trip resolves the pending call it names

A fake bus that records `subscribe` handlers and captured publishes. The
scheduler publishes `TOOL_CONFIRMATION_REQUEST` with a correlationId; emitting
`TOOL_CONFIRMATION_RESPONSE` carrying that correlationId + ProceedOnce
transitions that call (and only that call) to `success`. A response with an
unknown correlationId leaves the call awaiting.

### AC4 — Confirmation modal rendering and keyboard selection

`ToolConfirmationMessage` component tests using the FolderTrustDialog stdin
pattern (`renderWithProviders` + `stdin.write` + `act`/`waitFor`):

- Enter selects the default → `onConfirm(ProceedOnce)`.
- Down+Enter → `onConfirm(ProceedAlways)` when the folder is trusted.
- Down+Down+Enter → `onConfirm(Cancel)` (deny).
- Escape and ctrl+c → `onConfirm(Cancel)` without selecting an option.
- Cancel keys are gated by `isFocused` (no `onConfirm` when not focused).
- Trusted vs untrusted folder: "Allow for this session" present/absent
  (extends existing coverage which is render-only).

`ToolGroupMessage` behavioral assertions (not snapshots): with one Confirming
call alongside Pending/Executing/Success/Error calls, exactly one
`ToolConfirmationMessage` renders (the first Confirming) and every other call
is passed emphasis `'low'` via the mocked `ToolMessage`.

### AC5 — Tool-call result rendering state transitions

- `ToolMessage` (or group) rerender of the same instance through
  Confirming → Success / Error / Canceled updates the status indicator glyph
  (`?` → `✓` / `x` / `-`).
- Presentation contrast: an errored (policy-denied) call and a canceled
  (user-denied) call render with different status indicators
  (characterization; no production change).
- Long output: `ToolResultDisplay` with content taller than
  `availableTerminalHeight` renders the MaxSizedBox truncation marker
  (`... first N lines hidden ...`), and the marker is absent when content
  fits. (The 1M-character `...` prefix path is impractical to render in CI;
  existing tests already cover large-input stability at 50–100K.)

### AC6 — Real keyboard approval flows in tmux

New CI-wired scenarios in `scripts/tests/interactive-ui.test.ts`, each with
its own JSONL fake-provider fixture (isolated per scenario):

- Deny: dialog appears, `choice: "no"` (Down,Down,Enter) → dialog closes, the
  tool row renders cancelled, the turn ends and the input prompt returns.
  (Verified behavior: `AgenticLoop.buildNextMessage` ends the turn when every
  call in the batch is cancelled, so no final model message follows — the
  scenario asserts the turn-end contract, not a follow-up response.)
- Escape mid-dialog: raw `Escape` key while the dialog is focused aborts the
  request — the dialog and the tool-call group are removed, `Request
  cancelled` is shown, and the input prompt returns. (Distinct presentation
  from an explicit deny, which keeps the cancelled tool row.)
- Always-allow: `choice: "always"` (Down,Enter) on the first of two
  simultaneously pending `run_shell_command` calls → the shell tool's
  instance-scoped allowlist cascades to the sibling (both execute, no second
  dialog), and a later matching call in a subsequent turn also auto-executes
  (three executions total, no new dialog). Shell is used because its
  always-allow consults a real tool-instance allowlist; policy-bus-based
  tools do not (see Known issues).
- Multiple approvals: successive approval-gated tool calls surface separate
  dialogs that are each keyboard-approved in turn; each call's result is
  asserted before the next dialog is answered. Simultaneous-pending batch
  semantics (one dialog at a time, decisions isolated per call id, batch
  gating on full approval) are pinned deterministically by the AC2 scheduler
  unit tests; at the tmux layer a simultaneous mixed-tool batch races on
  which confirmation dialog renders first (verified empirically both orders
  occur), so the e2e scenario uses sequential turns for determinism.
- Long output then approval: a tool emits large real output, then a later
  approval dialog is visible and answerable (waitFor output, then waitFor
  dialog, then approve).

### Known issues surfaced by this coverage (production bugs, not fixed here)

1. Session always-allow is dead for policy-bus tools: selecting "Allow for
   this session" on e.g. `activate_skill` publishes an `UPDATE_POLICY` bus
   message, but `createPolicyUpdater` (the only subscriber that applies the
   dynamic ALLOW rule to the policy engine) is never wired at CLI startup, so
   subsequent calls still prompt. Shell tools work because they keep a
   tool-instance allowlist. Tracked in #3299.
2. Cancelling the last awaiting sibling strands already-approved `scheduled`
   calls: `handleCancellation` only marks the cancelled call; the batch never
   executes and `onAllToolCallsComplete` never fires (pinned as 2
   characterization tests in the scheduler suite). Follow-up issue filed
   separately.

Registration duties: new script + fixture paths added to BOTH the
pull_request and push path filters in `.github/workflows/interactive-ui.yml`
(the path-contract test `scripts/tests/interactive-ui-paths.bun.test.ts`
requires symmetry and forbids broad globs; its `toContain` assertions keep
passing as we only add entries).

### Out of scope

- Any production behavior change beyond none at all (the harness step fix is
  test infrastructure under `scripts/`).
- IDE-mode dialogs, `enablePermanentToolApproval` UI beyond existing
  coverage, ModifyWithEditor flows (covered in coordinator tests),
  non-interactive executor, timeouts.
- New abstractions or shared fixtures beyond a single per-file local helper.

## Phase 1 — Scheduler unit tests

New file `packages/agents/src/core/coreToolScheduler.approval-outcomes.test.ts`
(AC1, AC2, AC3): local allowlist-driven fixture tools built on
`BaseDeclarativeTool`/`MockTool` patterns already used in the helpers file,
`createMockConfig` with ASK policy, `waitForStatus`, and a
capturing fake bus for AC3. Follows the exact structure of
`coreToolScheduler.edit-cancel.test.ts`.

## Phase 2 — Component tests

Extend `ToolConfirmationMessage.test.tsx` (keyboard block), extend
`ToolGroupMessage.test.tsx` (behavioral mixed-state block, no new snapshots),
extend `ToolMessage.test.tsx` (rerender transitions + error/canceled
contrast), extend `ToolResultDisplay.test.tsx` (truncation marker).

## Phase 3 — tmux scenarios

New fixtures: `scripts/fixtures/approval-deny.responses.jsonl`,
`approval-always.responses.jsonl`, `approval-multi.responses.jsonl`,
`approval-long-output.responses.jsonl`.
New scripts: `tmux-script.approval-deny.json`, `tmux-script.approval-escape.json`,
`tmux-script.approval-always.json`, `tmux-script.approval-multi.json`,
`tmux-script.approval-long-output.json` (escape may share the deny fixture).
Register all in `scripts/tests/interactive-ui.test.ts`; update
`.github/workflows/interactive-ui.yml` path filters (both blocks).
Harness fix: default matcher → `Allow once`; `always` visibility check →
`Allow for this session`.

## Plan tags

Test blocks are annotated with `@plan PLAN-20260824-ISSUE2021.P0x` /
`@requirement REQ-2021.n` markers:

- P01 / REQ-2021.1 — AC1 single-call terminal outcomes
  (approval-outcomes.test.ts)
- P02 / REQ-2021.2 — AC2 multi-pending isolation, cascade, partial cascade
  (same file)
- P03 / REQ-2021.3 — AC3 message-bus round-trip incl. sibling isolation
  (same file)
- P04 / REQ-2021.4 — AC4 confirmation-modal keyboard selection
  (ToolConfirmationMessage)
- P05 / REQ-2021.5 — AC4/AC5 group queue emphasis + same-instance rerender
  transitions (ToolGroupMessage, ToolMessage)
- P06 / REQ-2021.6 — AC5 truncation marker (ToolResultDisplay) and AC6 tmux
  scenarios (registration block in scripts/tests/interactive-ui.test.ts)

## Verification

- `bun test packages/agents/src/core/coreToolScheduler.approval-outcomes.test.ts`
- `bun test packages/cli/src/ui/components/messages/` (affected files)
- `LLXPRT_E2E_TMUX=1 bun test scripts/tests/interactive-ui.test.ts` locally
  (darwin has tmux) plus `bun test scripts/tests/interactive-ui-paths.bun.test.ts`
- Full cycle: `npm run test`, `npm run lint`, `npm run typecheck`,
  `npm run format`, `npm run build`, smoke test profile stepfun-37.

## OCR round 1 triage record

- Applied: #2 (test rename), #3 (typing simplification), #5 (makeConfig
  delegation), #6 (helper reuse), #7 (long-output dialog matcher), #8
  (negative assertion via frame presence).
- Rejected: #1 (ToolMessage manual provider stack — deliberately stable
  stack, proven harmless) and #4 (fixed sleeps — adjudicated with deepthinker
  against the #3299 characterization precedent).
- #9 reworked: the suggested standalone absence check between two identical
  dialogs is unimplementable (dialog swap has zero absence window; verified
  via error captures). Added opt-in harness `expectClose` on `approveTool`
  (waits for the dialog's matcher to leave the screen after the choice), and
  redesigned the multi scenario per AC6 above.
