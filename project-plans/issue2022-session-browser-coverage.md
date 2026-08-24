# Issue #2022 — Increase session browser UI coverage

## Context

The session browser is `packages/cli/src/ui/components/SessionBrowserDialog.tsx`
driven by `useSessionBrowser` → `useSessionBrowserController`
(`useSessionBrowserHelpers.ts`) and `useSessionKeypressHandler`
(`useSessionBrowserKeypress.ts`).

Existing coverage is already broad:

- `useSessionBrowser.spec.ts` + `part2`–`part6` (loading/listing, search, sort,
  pagination, navigation, escape precedence, delete flow, resume flow,
  property-based invariants).
- `SessionBrowserDialog.spec.tsx` + `.layout.spec.tsx` (static wide and narrow
  rendering, preview states, confirmations, controls bars).
- `packages/cli/src/__tests__/sessionBrowserE2E.*.spec.ts` (discovery, locking,
  resume, history, errors).

This effort adds coverage only where a real behavioral gap exists. It does not
change production code and does not export module-private helpers.

## Gap analysis

| Issue bullet                        | Current state                                                                                                                | Gap |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --- |
| Open, close, navigate, select       | Covered (part3, part5, dialog specs)                                                                                          | No  |
| Search and filter                   | Covers preview text, provider, model                                                                                          | Yes — `name`, `checkpointName`, `sessionId` match arms and the loading-preview retention arm of `filterSessions` are untested |
| Empty / locked / current sessions   | Covered (`useSessionBrowser.spec.ts`)                                                                                         | No  |
| Corrupt sessions                    | One test asserts `skippedCount` for a single malformed file                                                                   | Yes — corrupt files mixed with valid ones, and that the corrupt entries never reach `pageItems`/`selectedSession`/navigation |
| Preview-loading sessions            | Hook-level covers `'loaded'` only; `'none'` and `'error'` are only asserted at component level with a hand-built state object  | Yes — hook-level resolution to `'none'` |
| Resize / narrow terminal            | Static wide and static narrow renders only                                                                                    | Yes — no live wide→narrow→wide transition on a mounted dialog |
| Resume or cancel state cleanup      | `hasActiveConversation: true` is never exercised; the two "Conversation Confirmation" tests only assert the property is a boolean | Yes — the whole confirm/cancel path |
| tmux end-to-end navigation smoke    | `scripts/tests/session-browser-e2e.test.ts` exists but is not executed by any CI lane, and its scenario is stale (depends on a local `synthetic` profile and asserts `"sessions found"`, which the component no longer renders — it renders `"targets found"`) | Yes — see "Deferred pending approval" |

## Acceptance criteria

### AC1 — Search matches session name, checkpoint name, and session id

`filterSessions` matches case-insensitively across `firstUserMessage`,
`provider`, `model`, `name`, `checkpointName`, and `sessionId`. The last three
arms have no test.

Note on the pre-existing tests: the `firstUserMessage` / `provider` / `model`
arms do have tests, but they are positive-only — they assert the wanted row is
present without asserting the unwanted row is absent, so they would still pass
if filtering returned everything. This effort does not rewrite them (out of
scope); it adds a new test that proves exclusion and case-insensitivity for
`provider` and `model` directly.

Tests (hook-level, real JSONL fixtures, `useSessionBrowser.part2.spec.ts`):

- Typing a substring of a named session's `name` keeps that session and drops
  the others.
- Typing a substring of a checkpoint's `checkpointName` keeps the checkpoint row
  and drops the plain session rows.
- Typing a substring of a `sessionId` keeps only that session.
- Matching is case-insensitive for `name`.
- Searching a provider and then a model, both in the wrong case, each narrows
  the list to exactly the owning session.

### AC2 — Sessions whose preview is still loading are retained while searching

`filterSessions` returns `true` unconditionally for
`previewState === 'loading'`, so a session cannot be filtered out before its
preview resolves. Untested.

Test: with a search term applied before previews resolve, sessions still in
`'loading'` appear in `filteredSessions`; once resolved, non-matching ones drop
out.

### AC3 — Preview resolves to `'none'` when a session has no human message

`loadPreview` sets `previewState: 'none'` and leaves `firstUserMessage`
undefined when `readFirstUserMessage` returns `null`. Only `'loaded'` is
asserted at hook level today.

Test: a session recorded with assistant-only content loads without throwing and
settles at `previewState: 'none'` with `firstUserMessage === undefined`.

### AC4 — Corrupt sessions are skipped without disturbing browsing

Test: a chats dir containing both valid sessions and malformed `session-*.jsonl`
files produces a browser where

- `sessions` and `pageItems` contain only the valid sessions,
- `skippedCount` accounts for the corrupt files,
- `selectedSession` is a valid session, and up/down navigation stays within the
  valid rows,
- the hook never surfaces an `error`.

### AC5 — Resume confirmation and cancellation state cleanup

With `hasActiveConversation: true`:

- Enter sets `conversationConfirmActive` to `true` and does **not** invoke
  `onSelect`.
- `y` clears `conversationConfirmActive`, invokes `onSelect`, and on success
  calls `onClose`.
- `n` clears `conversationConfirmActive`, leaves `onSelect` uninvoked, leaves
  `onClose` uninvoked, and the browser remains navigable afterwards.
- Escape clears `conversationConfirmActive` with the same cleanup as `n`.

### AC6 — Live terminal resize swaps the rendered layout

Driving the mocked `useResponsive` value from wide to narrow and back with a
`rerender()` on an already-mounted dialog:

- wide → narrow: the rounded border disappears, the title shortens to
  `Sessions`, the sort bar and the selection detail line disappear, and the
  1-based index column disappears,
- narrow → wide: all of the above return,
- the selected row indicator (`●`) sits on the row named by `selectedIndex` in
  every frame, so both `NarrowSessionRow` and `WideSessionRow` honour the
  selection.

Scope limit, stated plainly: `SessionBrowserDialog.layout.spec.tsx` mocks
`useSessionBrowser`, so selection state does not live in the component. This
test therefore cannot prove "the hook did not lose its selection across a
resize", and it does not claim to. What it proves is that the dialog renders
the correct breakpoint layout after a live resize and marks the selected row
correctly in both layouts. Hook-level selection stability is already covered by
the clamping tests in the hook suites.

## Non-goals

- No production code changes. `filterSessions` / `sortSessions` /
  `getPagination` stay module-private; `dev-docs/RULES.md` says not to test
  private functions, and exporting them purely for tests would be a
  test-driven public-surface change.
- No new corrupt-session counters or statuses.
- No rewrites of existing tests.

## Deferred pending approval — AC7 (tmux navigation smoke)

`scripts/tests/session-browser-e2e.test.ts` is authored but dead: nothing runs
it (`npm run test:interactive-ui` executes only
`scripts/tests/interactive-ui.test.ts`), and its scenario
`scripts/tmux-script.session-browser.json` cannot pass as written — it loads a
`synthetic` profile that does not exist in the repo, and asserts the string
`"sessions found"` which the dialog no longer renders.

Making the issue's "one tmux end-to-end navigation smoke" real requires:

1. Rewriting `tmux-script.session-browser.json` onto the fake-provider pattern
   used by the three CI scenarios (env-prefixed `startCommand`,
   `welcome-completed.json`, `system-settings.interactive-ui.json`, a new
   responses fixture) plus seeding a prior session so `/continue` has a row.
2. Adding a `runTmuxE2E(...)` block to `scripts/tests/interactive-ui.test.ts`.
3. Adding the scenario and its fixture to the `pull_request` **and** `push`
   path filters of `.github/workflows/interactive-ui.yml`.
4. Updating `scripts/tests/interactive-ui-paths.bun.test.ts`, whose contract
   currently names "the three executed scenario JSON files".
5. Deleting the now-duplicate `scripts/tests/session-browser-e2e.test.ts` and
   its `tsconfig.scripts.json` entry.

Step 3 is a workflow change, so this is held for explicit approval before
implementation.
