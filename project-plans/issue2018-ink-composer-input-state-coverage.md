# Issue 2018 — Increase Ink composer and input-state coverage

## Problem

The Ink UI surfaces that decide whether the user can type have no direct tests:

- `isInputActive` is computed inline inside the unexported `useInputFinish` in
  `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts`. Nothing
  exercises the predicate.
- `packages/cli/src/ui/components/Composer.tsx` has no test file at all. Nothing
  proves it forwards UI state into `InputPrompt`, nor that the placeholder
  degrades correctly for vim/shell modes.
- `packages/cli/src/ui/components/Notifications.tsx` has no test file. The
  startup-error surface (`InitErrorBox`) is entirely unverified.
- `packages/cli/src/ui/layouts/InlineContent.test.tsx` always passes
  `isInputActive: false`, so the "composer is rendered when input is active"
  branch of `ComposerSection` is never taken.
- `DefaultAppLayout.test.tsx` covers only two of the twenty-five dialog flags in
  `hasActiveDialog`.
- The large-paste placeholder path in `inputPromptText.ts`
  (`handleLargePaste` / `expandLargePastePlaceholders`) has no test. Only the
  below-threshold branch is covered (`InputPrompt.completion.test.tsx:524`).
- Escape priority ordering in `inputPromptKeyHandlers.ts` is covered for single
  states but not for the combinations where one state must win over another.
- There is no tmux smoke asserting the first meaningful startup frame contains
  the composer.

## Scope

Test coverage only, plus one behaviour-preserving extraction needed to make the
gating predicate reachable from a test. No other production changes.

Explicitly out of scope (do not do these):

- Changing when `initError` is set, or fixing the observation that no live call
  site currently assigns it a non-null value. If that gap is confirmed, note it
  in this plan as a follow-up; do not touch production behaviour.
- Refactoring `useAppInput`, `InputPrompt`, or the layout beyond the single
  predicate extraction.
- Adding new CI workflows or harness abstractions.

## Acceptance criteria

### AC1 — Composer is visible when command initialization completes

- **AC1.1** `computeIsInputActive` returns `false` while `slashCommands` is
  `undefined` and `true` once `slashCommands` is a loaded array, with all other
  inputs held at their ready values (`streamingState: Idle`, `initError: null`,
  `isProcessing: false`). An empty array counts as loaded.
- **AC1.2** `InlineContent` renders the composer's input prompt when
  `isInputActive` is `true` (the current suite only exercises `false`).

### AC2 — Composer is hidden only for intentional blocking states

- **AC2.1** `computeIsInputActive` is `true` for `StreamingState.Idle` and
  `StreamingState.Responding`, and `false` for
  `StreamingState.WaitingForConfirmation` (a table-driven case per enum member,
  so a newly added streaming state cannot silently default to visible).
- **AC2.2** `computeIsInputActive` is `false` when `initError` is a non-empty
  string, and `false` when `isProcessing` is `true`, each with every other input
  held at its ready value, so each blocker is proven independently sufficient.
- **AC2.3** `InlineContent` renders nothing for the composer slot when
  `isInputActive` is `false`.
- **AC2.4** `DefaultAppLayout` renders `DialogManager` instead of `Composer` for
  each flag in `hasActiveDialog` — driven off the flag list rather than a
  hand-picked subset, so a newly added dialog flag that is not wired into the
  layout fails the test.

### AC3 — Startup errors render actionable UI, not a blank or partial screen

- **AC3.1** With `initError` set and `streamingState` not `Responding`,
  `Notifications` renders the error text and the actionable remediation line
  ("Please check API key and configuration.").
- **AC3.2** When the history contains an error item whose text includes the
  `initError` string, `Notifications` renders that fuller history text instead
  of the generic box.
- **AC3.3** With `initError` set and `streamingState === Responding`, the init
  error box is suppressed.
- **AC3.4** Startup warnings render alongside/independently of `initError`, and
  with no warnings, no init error, and no update info the component renders
  nothing.

### AC4 — Escape and Ctrl-C behaviour while suggestions or shell mode is active

Only the uncovered combinations. Existing single-state cases in
`InputPrompt.completion.test.tsx` and `InputPrompt.editing.test.tsx` are not to
be duplicated.

- **AC4.1** With shell mode active *and* shell path suggestions showing, Escape
  closes the suggestions and leaves shell mode active (suggestion dismissal wins
  over shell-mode exit).
- **AC4.2** WITHDRAWN. This criterion originally asked for a case where shell
  mode is active *and* slash-completion suggestions are showing, to prove the
  shell-mode branch of `handleEscapeKey` wins over the completion branch. That
  state is unreachable: `useCommandCompletion` passes
  `reverseSearchActive || shellModeActive` as the disable flag to
  `useSlashCompletion`, so slash suggestions are suppressed entirely while shell
  mode is active, and `inputPromptRender.tsx` does not render them either.
  Covering it would require mocking `useCommandCompletion` into a state the real
  UI cannot produce, which is mock theater. Dropped rather than faked.
- **AC4.3** With suggestions showing and a non-empty buffer, Escape closes the
  suggestions without clearing the buffer and without arming the double-escape
  prompt.

### AC5 — Multiline paste and queued input behaviour

- **AC5.1** A paste at or above the large-paste threshold (line count or char
  count) replaces the pasted content in the buffer with a single placeholder
  label, preserves text before and after the cursor, and leaves the cursor after
  the placeholder.
- **AC5.2** Submitting a buffer containing a large-paste placeholder expands it
  back to the original pasted content; a second, distinct large paste gets a
  distinct placeholder and both expand correctly. The expansion must be proven
  through the real submit path (`InputPrompt` submit -> `onSubmit` payload), not
  only by calling `expandLargePastePlaceholders` directly, so that removing the
  call site in `inputPromptHooks.ts` fails a test.
- **AC5.3** A paste below the threshold is inserted verbatim with CRLF and CR
  normalised to LF (assert the boundary just below the threshold, complementing
  the existing case).

### AC6 — tmux startup smoke asserts the first meaningful frame contains the composer

- **AC6.1** A dedicated tmux script waits for the composer placeholder as the
  first-meaningful-frame gate, captures that frame, then quits cleanly, and is
  registered in `scripts/tests/interactive-ui.test.ts` behind the existing
  `LLXPRT_E2E_TMUX=1` gate following the surrounding `runTmuxE2E` /
  `runHarness` / `assertHarnessSuccess` pattern.

## Production change (the only one)

Extract the inline predicate in
`packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts`:

```ts
const isInputActive =
  isStreamingIdleOrResponding && !initError && !isProcessing && !!slashCommands;
```

into an exported pure function taking `streamingState`, `initError`,
`isProcessing`, and `slashCommands`, and have `useInputFinish` delegate to it.
Behaviour must be identical; the existing Agent-migration TODO note in that file
must be preserved.

## Test plan

| AC | File | Kind |
| --- | --- | --- |
| AC1.1, AC2.1, AC2.2 | `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.predicate.test.ts` (new) | pure unit |
| AC1.2, AC2.3 | `packages/cli/src/ui/layouts/InlineContent.test.tsx` (extend) | component |
| AC2.4 | `packages/cli/src/ui/layouts/DefaultAppLayout.test.tsx` (extend) | component |
| AC3.* | `packages/cli/src/ui/components/Notifications.test.tsx` (new) | component |
| AC4.* | `packages/cli/src/ui/components/InputPrompt.completion.test.tsx` (extend) | component |
| AC5.* | `packages/cli/src/ui/components/inputPromptText.test.ts` (new) | unit |
| AC6.1 | `scripts/tmux-script.issue2018-composer-visibility-smoke.json` (new) + `scripts/tests/interactive-ui.test.ts` (extend) | e2e |

## Test-quality constraints

- Bun + `bun:test` only. TypeScript, strict, no `any`, no new `.js` files.
- New files carry a 2026 copyright header.
- `Composer` coverage is delivered through `InlineContent` (AC1.2/AC2.3) so the
  real `Composer` and real `InputPrompt` render — a standalone `Composer.test`
  that mocks `InputPrompt` and asserts the props it received would be pure mock
  verification and is prohibited by dev-docs/RULES.md. Assert rendered output
  (placeholder text, prompt chrome), not forwarded props.
- No mock-mirror assertions: never assert back a literal that a stub was
  configured with. Drive AC2.4 from the real `hasActiveDialog` flag list.
- `bun scripts/test-audit/scan.ts` must not report new MOCK_MIRROR, ALWAYS_TRUE,
  SELF_CONFIRMING, or NO_ASSERT findings on touched files.

## Verification

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

## Follow-ups (not in this issue)

- Confirm whether any live code path sets `initError` to a non-null value. If it
  is effectively dead, raise a separate issue.
