# Issue 3400 Plan — ProviderDialog: zero-match Enter must not insert a carriage return

Generated: 2026-09-08
Branch: `issue3400`
Issue: https://github.com/vybestack/llxprt-code/issues/3400

## Root cause

`createProviderDialogKeypressHandler` in
`packages/cli/src/ui/components/ProviderDialog.tsx` routes every key through
the search branch when `isSearching || isNarrow`. The Enter guard requires
`filteredProviders.length > 0`, so a zero-match Enter falls through to
`isPrintableKeypress`. That helper accepts any single-character sequence that
is not a ctrl/meta chord, and Enter arrives with `sequence === '\r'`, so the
carriage return is appended to the search term. The term can then never match
a provider name, and the extra character is invisible in the rendered frame.

## Accepted behavior

1. Wide layout, search mode (Tab entered): pressing Enter when the search
   term matches zero providers is a no-op. The search term stays byte-for-byte
   unchanged (no `\r` appended), the dialog stays in search mode, and neither
   `onSelect` nor `onClose` fires. The frame keeps showing the typed term,
   `No providers match`, and `(Found 0 of N providers)`.
2. Narrow layout: same no-op behavior, because narrow mode always takes the
   same search branch.
3. Enter with one or more matches keeps every existing behavior: narrow mode
   selects `filteredProviders[index]`; wide search mode exits search mode
   without closing; wide non-search mode selects the highlighted provider.
4. All other key semantics are unchanged: Tab toggles search mode (wide),
   Backspace/Delete trim the term, printable ASCII input appends, Escape
   clears the term first and closes on the second press.

## Fix approach

Narrow `isPrintableKeypress` in `ProviderDialog.tsx` to actual printable ASCII
with a `PRINTABLE_ASCII = /[\x20-\x7E]/` test, mirroring the rule
`ModelDialog.tsx` already uses (`isPrintableCharacterKey`). `\r` (0x0D) is no
longer accepted as text input, so a zero-match Enter matches no branch and is
consumed. This is the second fix option the issue suggests. Inherent,
issue-authorized consequence: other single-character control sequences (for
example Tab in the narrow layout) are no longer appended to the term either.

Rejected alternative: special-casing `key.name === 'return'` before the
printable branch. It fixes only the Enter name and leaves the helper accepting
every other control character, so the same corruption remains reachable.

## Tests

All in `packages/cli/src/ui/components/ProviderDialog.selection.test.tsx`
(wide default 180 cols), written first and confirmed failing (TDD RED), then
the fix makes them pass (GREEN). No new test files.

1. `keeps the search term unchanged when Enter is pressed with zero matches`
   (wide): Tab into search mode, type `zzzz`, assert `No providers match` and
   `(Found 0 of 6 providers)`. Press Enter. Assert `onSelect`/`onClose` were
   not called, the frame still shows `zzzz`, `(Found 0 of 6 providers)`, and
   the `Search Providers` title (still in search mode). Then the discriminating
   probe for the invisible character: Backspace 4 times, assert the full list
   is back (`anthropic` visible); type `openai`, assert `openai` is visible and
   `anthropic` is not. With the bug the term after the probe is `\ropenai`,
   which matches nothing, so the probe fails.
2. Same scenario in the narrow layout (override the terminal-size mock to
   60 columns inside the test): no Tab needed (narrow starts in search mode),
   type `zzzz`, Enter, assert no select/close, Backspace 4 times, type
   `openai`, assert `openai` visible and `anthropic` not.

The existing test `does not select or close when Enter is pressed with zero
matches` stays unmodified and keeps passing; it already avoids enshrining the
bug.

Placement note: the sizing-audit comment on the issue suggested extending
`ProviderDialog.responsive.test.tsx`. That file holds layout tests with no
stdin interaction. The component's keypress-behavior tests, including the
zero-match Enter scenario the issue references, live in
`ProviderDialog.selection.test.tsx`, so the regression tests go there.

## Out of scope

- No files other than `ProviderDialog.tsx` and
  `ProviderDialog.selection.test.tsx`.
- No lint/test config changes, no new suppression directives.
- No keyboard handling changes in other dialogs (ModelDialog already has the
  printable rule).

## Verification

- Targeted ProviderDialog suites passed (16/16).
- Full `npm run typecheck` passed.
- Lint checks passed on the touched files. Repo-wide `npm run lint` reports 11
  pre-existing errors in unrelated MCP/consent files that are also present at
  main HEAD.
- `npm run format` passed without out-of-scope changes.
- `npm run build` passed.
- The test-audit scanner reported no MOCK_MIRROR, ALWAYS_TRUE,
  SELF_CONFIRMING, or NO_ASSERT findings on the touched test file. It reported
  one pre-existing DUP_ASSERT at line 130, outside the new tests.
- Full `npm run test` (completed run, log at `tmp/verify3400/test-full2.log`) failed
  in 6 environmental files, all byte-identical to main HEAD and unrelated to this
  change: oauthManager.proactive-renewal (token-renewal timing),
  factory-detection-wiring (capability proxy), secure-store.native-keyring (no
  OS keyring in container), ide-client-integration (MCP sockets in sandbox),
  docsCommand (asserts the non-sandbox code path inside a sandbox), and
  sandbox-node-modules-preflight (image-global bun location layout). 737/743
  CLI test files passed. Those suites pass in GitHub CI on main at this
  branch's base; LLxprt Code CI was green on 2026-09-08.
- The smoke test failed during profile credential resolution with
  `Credential proxy authentication failed: Invalid or missing capability token`
  before model invocation. The sandbox credential proxy is broken; the PR's
  On Merge Smoke Test CI workflow is the authoritative gate.
- Compliance review: PASS with zero findings.
- Final review: REQUEST_CHANGES with two LOW findings. Both were remediated in
  this pass.
