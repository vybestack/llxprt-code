# Plan: Close the remaining #3046 coverage gaps (OAuth dialog coverage, strict ESC tests)

Issue: #3046
Branch: `issue3046`
Generated: 2026-08-23

## Triage of #3046 against current `main`

Most of #3044/#3046 was resolved by follow-up PRs before this effort started.
Verified on this branch, not assumed:

| Issue item | Status on `main` | Evidence |
| --- | --- | --- |
| 3a sandbox-bashrc extra-fd IPC | Fixed in #3056 (temp-file transport) | `src/utils/sandbox-bashrc.test.ts` 19/19 pass |
| 3b inline load-balancer profiles | Fixed in #3056 (`parseInlineProfile` loadbalancer branch) | `loadbalancer.integration.test.ts` 7/7 pass |
| 3c retries/retrywait validators | Fixed in #2843 | settings registry entries restored |
| §4 all ten "still failing" files | All pass locally | each file run individually, 0 fail |
| comment: bundle alias assets | Fixed via #3068 (`stageCliBundleAssets` wired into `bun-build.config.ts`) | `cli-args.integration.test.ts` 20/20 pass |
| comment: dead coverage-comment job | Removed in #3145 | no `LLXPRT_COVERAGE`/`post_coverage_comment` in `ci.yml` |
| comment: Bun Linux segfault (`settingsIntegration.test.ts`) | CI green on `main` (full runs 2026-08-21..23) | `gh run list --workflow ci.yml --branch main` |

Still open, and therefore this PR's scope:

1. **§2 named behaviours — OAuth code dialog.** No test file exists for
   `OAuthCodeDialog.tsx` today; the deleted placeholder suite's five named
   behaviours have no coverage.
2. **§5 vacuous ESC assertions.** `InputPrompt.completion.test.tsx` still has
   ESC cases whose intermediate waits assert `onEscapePromptChange(false)`,
   which fires on mount (`useEscapeState` effect runs with the initial
   `false`), so the waits are satisfied instantly and prove nothing. The issue
   recorded them rather than silently tightening; this PR tightens them.

### Out of scope (classified, with reasons)

- **Bun workspace coverage reporting** (issue comment): a coordinated
  cross-workspace CI/workflow change; needs explicit approval before any
  workflow change. Not done here. The dead job that consumed the phantom
  artifacts was already removed in #3145.
- **Stale-bundle precedence guard in `resolveBundleEntry`** (issue comment
  "worth considering"): optional hardening, no accepted behaviour. Defer.
- **Removing the dead `popAllMessages` prop** from `inputPromptTypes.ts`:
  adjacent cleanup, not requested. Defer.
- **Rebuilding `auth-e2e.integration.test.ts`**: needs the interactive-CLI
  harness effort described in `project-plans/issue2843/coverage-gaps.md`.
  Defer.

## AC-1: OAuthCodeDialog behavioural coverage

New file: `packages/cli/src/ui/components/OAuthCodeDialog.test.tsx`
(bun:test, co-located, kebab/pascal naming matching sibling component suites).

The component under test is real and unmocked. It reads keypresses through the
real `KeypressProvider` (via `renderWithProviders` from
`src/test-utils/render.tsx`) — no mocking of `useKeypress` or `ink`. Callbacks
`onClose`/`onSubmit` are the component's own props (observed-effect spies, not
mock theater: the real component's dispatch is what invokes them).

Behaviours (each a separate `it`):

1. **Only pasted input is accepted** — typing regular characters leaves the
   code empty; the frame still shows the `(paste only - typing disabled)`
   placeholder and `onSubmit` is never called on Return afterwards. A
   bracketed-paste sequence (`\x1B[200~...\x1B[201~`) delivers the code.
2. **Escape closes the dialog** — `\x1B` → `onClose` called once;
   `onSubmit` never called.
3. **Return submits the verification code** — paste a code, then `\r` →
   `onSubmit` called with the trimmed code; `onClose` called after submit.
4. **Return on an empty code is a no-op** — `\r` with no code → neither
   `onSubmit` nor `onClose` called.
5. **Invalid characters are filtered from a pasted code** — paste
   `4/Ab!@#$%^&*()cde` → displayed code is `4/Ab#cde` (`#` is in the allowed set
   `[a-zA-Z0-9/_#-]`; slash kept for Google `4/…` codes).
6. **All-invalid paste leaves the code empty** — paste `!!!` → placeholder
   still shown (empty `cleanInput` must not call `setCode`).
7. **Paste replaces, not appends** — paste two codes in sequence; only the
   second is displayed.
8. **Provider-specific instructions** — `provider="gemini"` renders the
   clipboard-copy instruction ("The OAuth URL has been copied to your
   clipboard."); a non-gemini provider renders the generic instructions and
   not the clipboard line. This also covers the App-e2e placeholder's named
   behaviour ("clear user instructions for clipboard copy behaviour"),
   which lives in these instruction strings; the URL-message side of the
   copy guidance is already covered by `OAuthUrlMessage.test.tsx`.

Display assertions read `stdout.lastFrame()`; interaction assertions read the
prop callbacks. No snapshots.

## AC-2: Strict ESC tests in InputPrompt.completion.test.tsx

Two cases change; no production code changes.

- **"should reset escape state on any non-ESC key"** — currently two waits on
  `onEscapePromptChange(false)`, both satisfied by the mount-time call; the
  case proves nothing. Strict version:
  1. render, let the mount-time `false` fire, then `mockClear()`;
  2. ESC with a non-empty buffer → wait for `onEscapePromptChange(true)`
     (first press arms the escape prompt);
  3. press `a` → wait for `onEscapePromptChange(false)` — meaningful now the
     mock was cleared;
  4. ESC again → assert the buffer was NOT cleared (state genuinely reset, so
     the press re-arms: `onEscapePromptChange(true)` again) — the strongest
     available proof that the reset happened.
- **"should clear buffer on second ESC press"** — keep the real final
  assertions (`setText('')`, `resetCompletionState`); replace the vacuous
  intermediate wait with a strict one: clear the mount call, then wait for
  `onEscapePromptChange(true)` after the first ESC.

Escape-state machine being specified (from `inputPromptKeyHandlers.ts` /
`useEscapeState`): first ESC on a non-empty buffer arms the prompt and starts
a 500 ms reset timer; any non-ESC key resets; a second ESC inside the window
clears the buffer and resets.

## AC-3: regression confirmation

- The §3/§4 files listed in the triage table stay green (they are exercised
  by the full workspace run in the verification cycle).
- `bun scripts/test-audit/scan.ts` on touched files: no new MOCK_MIRROR /
  ALWAYS_TRUE / SELF_CONFIRMED / NO_ASSERT findings (diff vs `main` baseline).

## Verification

Per the issue workflow: `npm run test`, `npm run lint`, `npm run typecheck`,
`npm run format`, `npm run build`, then the
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`
smoke test. Targeted iteration before that: the two touched test files, then
the full cli workspace runner.
