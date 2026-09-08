# Issue #2019 — Increase slash, at-command, and path completion coverage

## Nature of the work

Test-only. No production behavior changes. Every new test must fail if the
corresponding production code is broken, and must not enshrine a bug as spec.

## Baseline: what is already covered (verified, do not duplicate)

Audited against the real sources and test files on `main`.

| Behavior | Status | Evidence |
| --- | --- | --- |
| Slash filtering by partial prefix | COVERED | `useSlashCompletion.part2.test.ts:114`, `:139`, `:533` |
| Slash no-result (unknown command, invalid subcommand, fully-typed leaf) | COVERED | `part2:376`, `part2:567`, `part2:353` |
| Enter accepts active suggestion | COVERED | `InputPrompt.test.tsx:716` |
| Tab accepts active suggestion | COVERED | `InputPrompt.test.tsx:666-697`, `:737`, `InputPrompt.editing.test.tsx:363` |
| `isPerfectMatch` Enter short-circuit | COVERED | `InputPrompt.test.tsx:781`, `:796`, `:819` |
| At-command debounce (150ms) | COVERED | `useAtCompletion.subagent.test.ts:343`, `:392`, `:519` |
| At-command cancellation / abort | COVERED | `useAtCompletion.test.ts:267`, `subagent.test.ts:464` |
| Slow-loading indicator (200ms) | COVERED | `useAtCompletion.test.ts:181`, `:210` |
| Entering the ERROR state | COVERED | `useAtCompletion.test.ts:327`, `:360` |
| Path completion with spaces | COVERED | `useAtCompletion.test.ts:44`, `part4:371` |
| gitignore / llxprtignore filtering | COVERED | `useAtCompletion.test.ts:384`, `:518`, `part3:433`, `:460`, `:495` |
| Special chars: `()`, `[]`, `{}`, `&`, `$`, `!`, separators | COVERED | `part4:398`, `:424`, `:450`, `:480`, `:512`, `:546`, `:586` |
| Dotfile INCLUSION when prefix starts with `.` | COVERED | `part3:310` |
| tmux real-keyboard slash smoke (open/navigate/Escape-dismiss) | COVERED | `scripts/tmux-script.slash-autocomplete.json`, registered `interactive-ui.test.ts:133` |

## Verified gaps → acceptance criteria

### AC1 — `SuggestionsDisplay` rendering contract

`SuggestionsDisplay.test.tsx` today asserts only the `[Subagent]` badge. The
rest of the render contract is unasserted.

Deliver, in the existing `SuggestionsDisplay.test.tsx`:

1. `isLoading: true` renders `Loading suggestions...` and renders no suggestion
   labels (even when suggestions are non-empty).
2. Empty `suggestions` renders nothing (component returns `null`).
3. `scrollOffset > 0` renders the up marker; a list longer than the visible
   window renders the down marker; a list that fits renders neither.
4. Only `MAX_SUGGESTIONS_TO_SHOW` (8) rows are rendered from `scrollOffset`;
   items outside the window are absent.
5. The `(activeIndex+1/total)` counter appears only when
   `suggestions.length > MAX_SUGGESTIONS_TO_SHOW`; it is absent at exactly 8,
   and its value tracks `activeIndex`.
6. Descriptions render alongside labels.
7. Slash mode (`userInput` starts with `/`) pads labels into a fixed-width
   column so descriptions align across rows of differing label length;
   non-slash mode does not pad.
8. `activeHint` renders above the list when provided and is absent otherwise.

Boundary cases to pin: exactly 8 suggestions (no counter, no down marker);
9 suggestions (counter present, down marker present); `scrollOffset` at the
last window (up marker present, down marker absent).

Active-row highlighting is observable when `chalk.level` is raised to 3. A test
now saves the prior level, renders with level 3, asserts the active-row ANSI
colour, and restores the prior level. The default level of 0 explains why the
first probe emitted no ANSI escapes.

### AC2 — Acceptance and dismissal at the key-handler boundary

In `InputPrompt.completion.test.tsx`:

1. With `showSuggestions: true`, non-empty suggestions, and
   `activeSuggestionIndex: -1`, pressing Tab accepts index 0.
2. Same state, pressing Enter accepts index 0.
   (This is the untested `-1 → 0` fallback in
   `inputPromptKeyHandlers.ts` `acceptCompletionSuggestion`.)
3. Escape dismisses without accepting: `resetCompletionState` is called,
   `handleAutocomplete` is NOT called, and the buffer text is unchanged.
   The existing test at `:800` asserts only the first of these three.

Enter tests must use the existing `pressEnter` helper pattern
(`InputPrompt.test.tsx:129-135`) — a bare fast `\r` is classified as pasted
text by `KeypressContext`, not as submit.

### AC3 — At-command error recovery

Scope limit found during implementation: the hook can only recover from `ERROR`
via a `cwd`/`config` change, because `usePatternChangeHandler` starts work only
from `IDLE`, `READY`, or `SEARCHING`. A same-directory pattern change while in
`ERROR` dispatches nothing — verified by probe (no second
`FileSearchFactory.create`, no suggestions). That is a production bug, filed as
issue #3373, and deliberately not fixed here. The test added covers the
recovery path that actually exists and is named for it; no test asserts that
same-directory retry fails, so nothing freezes the bug as specification.

In `useAtCompletion.test.ts`: drive the hook into ERROR (first `initialize`
rejects), then let a subsequent search succeed, and assert the hook recovers —
suggestions populate and `isLoadingSuggestions` is `false`. Today only ERROR
*entry* and ERROR-then-disable are covered; the ERROR → success transition is
not.

### AC4 — Path completion edge cases (dotfiles, quotes, unicode)

1. Dotfile EXCLUSION: with a fixture containing hidden and visible entries,
   a prefix that does not start with `.` surfaces only the visible entries.
   Pair this with the existing inclusion case so both halves of the
   `shouldIgnoreDotfile` rule are pinned.
2. Quote characters in filenames (`'` and `"`) are surfaced and escaped.
   They are in `SHELL_SPECIAL_CHARS` but appear in no test fixture.
3. Unicode filenames are surfaced as suggestions and their values round-trip.
   Today unicode appears only in trigger-detection assertions
   (`InputPrompt.editing.test.tsx:674`), never as a surfaced suggestion.

Prefer exercising the exported helpers in `atCompletionUtils.ts`
(`filterEntriesByPrefix`, `findFilesRecursively`) against a real temp directory
where that gives a direct, non-duplicative assertion of the dotfile rule.

### AC5 — tmux real-keyboard smoke

The existing `slash-autocomplete` script already provides real-keyboard smoke
coverage for opening, filtering, navigating, and Escape-dismissing the slash
menu, and it runs in the `interactive-ui` CI lane. The issue asks to *keep* one
or two such tests, and directs that most coverage be hook and component tests.

Decision: **pending user approval** — adding a second (at/path) tmux script
requires editing `.github/workflows/interactive-ui.yml` path filters and the
`interactive-ui-paths.bun.test.ts` contract that pins "the three executed
scenario JSON files". That is a workflow change, so it is not taken
unilaterally. See "Open question" below.

## Known divergences found during the audit (reported, NOT fixed here)

These are production-behavior observations outside the scope of a
test-coverage issue. They are recorded so new tests do not accidentally
contradict them, and are candidates for separate issues.

1. **Cross-engine dotfile divergence.** Bare `@path` completion is served by
   `useAtCompletion` (FileSearch engine); `@path` inside a slash-command line
   is served by `slashCompletionEffect` (which applies `shouldIgnoreDotfile`).
   The two disagree about whether hidden entries appear for an empty prefix:
   `useAtCompletion.test.ts:384` expects `.gitignore` present,
   `part3:460` expects it absent. Both currently pass. New dotfile tests must
   target one engine explicitly and must not assert the other engine's rule.
2. **Tautological existing test.** `part3:398` asserts
   `length >= 0` alongside `length > 0`; the first assertion cannot fail.
3. **Backslash separator divergence** between the `useCommandCompletion`
   accept path and `slashCompletionEffect`'s `normalizePathSeparators`.
4. **Orphaned scenario.** `scripts/tmux-script.github-at-completion.llxprt.json`
   is git-tracked but referenced by no test, workflow, or doc. It also hits a
   live GitHub broker, so registering it would need a fixture first.

## Constraints

- `bun:test` only. No vitest, no new `.js` files.
- Reuse existing harnesses: `renderHook`/`waitFor` from `test-utils/render.js`,
  `createTmpDir`/`cleanupTmpDir`/`FileSystemStructure` from
  `@vybestack/llxprt-code-test-utils`, `vi.spyOn(FileSearchFactory, 'create')`
  for search injection, the established `useCommandCompletion` mock shape and
  `stdin.write` keystroke dispatch for `InputPrompt`.
- Do not copy the `result.current.suggestions.push(...)` state-fabrication
  smell from `part4:283/:310/:340`; drive real suggestions.
- No production source changes.
- New files carry a 2026 copyright year.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, plus the `stepfun-37` startup smoke, and
`bun scripts/test-audit/scan.ts` with no new MOCK_MIRROR / ALWAYS_TRUE /
SELF_CONFIRMING / NO_ASSERT findings on touched files.

## Open question for the user

Should AC5 add a second, deterministic at/path-completion tmux scenario? It
would require workflow and workflow-contract-test edits. If not, the existing
slash scenario stands as the "one" smoke test the issue permits.
