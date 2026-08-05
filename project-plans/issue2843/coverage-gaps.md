# CLI Bun migration — removed tests and the coverage they took with them

Working notes for the single follow-up coverage issue. Every entry records what
was removed and why, so the gap can be re-filled deliberately.

Context: `packages/cli` ran only 534 of its 675 test files under Vitest. A
`baseExclude` glob list in `vitest.test-groups.ts` hid ~116 files, and a further
25 integration files were only reachable through a `test:integration` script
that nothing in CI invoked. Those files never ran, so they drifted out of sync
with the product. Bun now runs every file, which is what surfaced them.

## Deleted: behaviour no longer exists

### `src/ui/hooks/useAgentStream.approval.test.tsx` (7 cases)

Every case drove `result.current.handleApprovalModeChange(...)`. That identifier
does not exist anywhere in `packages/cli/src`; the hook stopped returning it.

Coverage lost — approval-mode transitions:

- switching to YOLO auto-approves all pending tool calls
- switching to AUTO_EDIT auto-approves only edit tools
- switching to REQUIRE_CONFIRMATION auto-approves nothing
- errors while auto-approving are handled without crashing
- tool calls without `confirmationDetails` are skipped
- tool calls without `onConfirm` are skipped
- only `awaiting_approval` tool calls are processed

Needs: locating the current owner of approval-mode changes and covering the same
seven behaviours there.

### `src/ui/hooks/useAgentStream.hooks.test.tsx` (4 cases)

Referenced an undeclared `mockTurnRun`, so the file could never have run. It
asserted that `useAgentStream` surfaces `AgentExecutionStopped` and
`AgentExecutionBlocked` as info messages. Neither event is referenced anywhere
in `packages/cli/src` — they are handled in `packages/a2a-server`
(`src/agent/task-support.ts`), which has its own coverage.

Coverage lost — CLI-side handling of agent execution-control events. Confirm
whether the CLI is still expected to surface them at all.

### `src/ui/components/TodoPanel.semantic.test.tsx` — one case

`should render subtasks with semantic secondary colors`. `TodoPanel.tsx` imports
the `Subtask` type and declares `subtasks?: Subtask[]`, but never renders them.

Coverage lost — subtask rendering in the todo panel. **Worth confirming this is
intended**: the type is still declared, which suggests the rendering was dropped
rather than deliberately removed.

Also corrected in the same file, not lost: the completed-todo marker assertion
expected `` where the component renders `[OK]` (`\u2713`), and two cases expected a
`← current` suffix that the component no longer emits.

## Deleted: structure tests asserting mock interactions

The `*.theme.test.tsx` family (5 files, 5 cases) all worked the same way: mock
`ink`, substitute an instrumented `Box`/`Text` that pushes its props into an
array, render, then assert the array contains an entry with a given
`backgroundColor`/`color`.

That asserts *a prop was passed to a mocked child*, which RULES.md lists under
"What NOT to Test" — implementation details and mock interactions. It is also
structurally incompatible with the Bun setup, where `ink` is redirected to the
local stub at resolution time, and one of them
(`StatsDisplay.theme.test.tsx`) hung forever re-entering the mocked module
during evaluation.

Deleted:

- `src/ui/components/AuthDialog.theme.test.tsx`
- `src/ui/components/AboutBox.theme.test.tsx`
- `src/ui/components/StatsDisplay.theme.test.tsx`
- `src/ui/components/shared/ScrollableList.theme.test.tsx`
- `src/ui/components/shared/VirtualizedList.theme.test.tsx`

Coverage lost — that themed surfaces (auth dialog, about box, stats display,
scrollbar thumbs) pick their colours up from the active theme rather than
hard-coding them.

Re-filling this properly needs assertions on **rendered output** rather than on
props handed to a mock. That requires a render harness that preserves colour
information in the captured frame; the current ink stub discards it, which is
why the original authors reached for prop instrumentation.

## Deleted: written against a component contract that no longer exists

The `src/ui/App.*.test.tsx` family (5 files, 41 cases) renders
`<AppWrapper config={...} />`. `config` has not been a prop of `AppWrapper` for
some time — it now takes `uiRuntime: UiRuntime`, and reads
`props.uiRuntime.app` and `props.uiRuntime.session.getSessionId()`.

Reviving them needs two migrations, not one. Substituting
`buildUiRuntimeFromSource(mockConfig)` for the `config` prop gets past the first
error and straight into the second: the CLI runtime scope introduced by
PLAN-20251023-STATELESS-HARDENING, which requires `setCliRuntimeContext()` and
`registerCliProviderInfrastructure()` to be established around every render.

Deleted (`App.e2e.test.tsx` is kept — it passes, 3 cases):

- `src/ui/App.test.tsx` (10 cases) — auto-updater behaviour (skips when running
  from git, success/failure messaging, spawn failure, the
  `LLXPRT_CODE_DISABLE_AUTOUPDATER` opt-out) and IDE open-file display.
- `src/ui/App.behavior.test.tsx` (1 case) — cancelling while a tool is executing
  clears the prompt without cancelling the tool.
- `src/ui/App.components.test.tsx` (10 cases) — footer/tips visibility including
  system-over-workspace-over-user settings precedence, theme dialog vs
  `NO_COLOR`, initial render, automatic submission of an initial prompt, error
  count aggregation, column layout.
- `src/ui/App.context.test.tsx` (16 cases) — context-file messaging (custom
  `contextFileName`, singular/plural, zero-count suppression, core memory files
  listed separately, MCP server counts), and Tips/Header/TodoPanel/Footer
  visibility toggles.
- `src/ui/App.dialogs.test.tsx` (4 cases) — `NO_COLOR` rendering and the folder
  trust dialog's open/disabled states.

Partly mitigated: `src/ui/__tests__/AppContainer.{mount,keybindings,render-budget}.test.tsx`
cover the container against the current architecture and pass (21 cases). The
gaps above are the parts they do not reach — chiefly the auto-updater, settings
precedence for footer/tips, and context-file messaging.

## Deleted: individual cases whose presentation was removed

- `src/ui/components/TodoPanel.responsive.test.tsx` — the case
  `should show only task count and status indicators for narrow width`, plus
  count-summary assertions (`3 tasks`, `1 completed`, `1 in progress`,
  `1 pending`) in neighbouring cases. `TodoPanel` renders no count summary at
  all any more, and narrow widths now truncate content rather than hiding it,
  so the case's premise no longer describes the component.

  Coverage lost — the todo panel summarising how many tasks are complete, in
  progress and pending. Truncation at narrow widths is still covered by the
  remaining 6 cases in that file.

### `src/ui/hooks/useAgentStream.cancellation.test.tsx` (3 cases)

Every case asserted that the CLI hook writes cancelled tool responses back
through `client.addHistory`. `addHistory` is not called anywhere in
`src/ui/hooks/agentStream/` or `useAgentStream*.ts` any more — continuation is
owned by the Agent loop, as the comment in `useAgentStreamLifecycle.ts` states.
The same cases also expected `markToolsAsDisplayCleared` for primary tools; it
now fires only for external (subagent) tools.

Coverage lost:

- all tool calls being cancelled leaves history in the expected shape
- multiple cancelled tool responses group into a single history entry
- no follow-up API call is made after a cancellation

Partly mitigated: `useAgentStream.usercancel.test.tsx` passes and covers
cancelling an in-progress stream, the `onCancelSubmit` handler, shell focus
restoration, cancelling while a tool is in progress, and that processing stops
after cancellation. The gap is specifically the *history-writing* half, which
should now be covered wherever the Agent loop owns it.

### `src/ui/hooks/useAgentStream.loopdetect.test.tsx` (5 cases)

Every case drove a loop-detection *confirmation* flow. Neither
`loopDetectionConfirmationRequest` nor `disableForSession` appears anywhere in
any package's source. The flow was replaced: `handleLoopDetectedEvent` in
`useStreamEventHandlers.ts` now just adds an info message and halts the request.

Coverage lost:

- a confirmation request is raised when a `LoopDetected` event arrives
- choosing "disable" disables loop detection for the session and reports it
- choosing "keep" leaves it enabled and reports it
- repeated loop-detection events are handled
- `LoopDetected` is processed after pending history is flushed

Also worth filling: the *current* behaviour (a single info message on
`LoopDetected`) has no test at all.

### `src/ui/components/messages/ToolConfirmationMessage.responsive.test.tsx` (10 cases)

Every case exercised a responsive summary/details toggle: a narrow-width
summary plus `Press 'd' to see full details`, expanding to `Full Parameters:`.
Neither string exists anywhere in any package's source; the affordance was
removed.

Coverage lost:

- narrow-width summary with a details toggle, for exec and info confirmations
- `d` toggles full details on, and again toggles back to the summary
- full URLs appear once details are expanded
- `d` is ignored when the component is not focused
- a details toggle is still offered at standard width for very long commands
- more detail is shown by default at wide width
- commands with no parameters render gracefully
- details state survives a re-render

Non-responsive confirmation behaviour is still covered by
`ToolConfirmationMessage.test.tsx` (13 cases, passing).

## Ported, not deleted

- `src/ui/components/ContextIndicator.ui.test.tsx` — constructed
  `new ProviderManager()` with no arguments, which has been rejected since issue
  #2300 required an explicit runtime context; supplied a `SettingsService`, and
  mocked the runtime bridge that `Footer` pulls in. One expectation was a stale
  context window (`1049k` for `claude-3-opus`, which is `200k`).

## Product defects the revived tests exposed

These are genuine bugs found by tests that had not executed in CI. They are
recorded here rather than papered over, per dev-docs/RULES.md ("never write a
passing test that asserts incorrect behavior").

### Fixed in this PR

- **`retries` / `retrywait` lost their validators.** When settings moved to the
  registry, both entries lost their `validate` functions while the neighbouring
  `auth-retry-timeout` kept its. `retries -1` and `retrywait 0` were accepted and
  fed straight into provider retry logic
  (`AnthropicRateLimitHandler`, `openAIResponsesExecutor`). The revived test even
  documented the original error wording, which confirmed the regression.
  Restored both validators in
  `packages/settings/src/settings/registry/registry-entries-2.ts`.

### Not fixed — needs a product decision

- **Inline load-balancer profiles are rejected.**
  `parseInlineProfile` in `packages/cli/src/config/profileBootstrap.ts`
  unconditionally requires `provider` and `model`, with no branch for
  `type: 'loadbalancer'`. A load-balancer profile has neither: it references
  other profiles. So
  `--profile '{"type":"loadbalancer","profiles":[...]}'` always fails with
  `Failed to parse inline profile: 'provider' is required`, while the same
  profile loaded from a file via `--profile-load` works correctly.

  This is an inconsistency between the inline and file paths, not an intended
  contract change. Fixing it means teaching the inline parser about
  load-balancer profiles, which is a functional change beyond the scope of this
  test-runner migration.

  Affected cases, currently failing in
  `src/integration-tests/loadbalancer.integration.test.ts`:
  - accepts inline LoadBalancer profile JSON
  - accepts LoadBalancer with roundrobin policy
  - selects profiles in round-robin fashion

- **`git-stats` summary totals.** One case in
  `src/providers/logging/git-stats.integration.test.ts` has
  `totalLinesAdded` satisfy `expect.any(Number)` inside `toMatchObject` and then
  fail `toBeGreaterThan(0)` with "Expected and actual values must be numbers or
  bigints". Bun's `toMatchObject` was probed and does reject missing keys, so
  matcher leniency is not the explanation. Left failing rather than guessed at.

## `test/integration/auth-e2e.integration.test.ts` — deleted (5 cases)

Every case spawned the CLI with `spawn('npm', ['run', 'cli', ...])`. There is no
`cli` script in `packages/cli/package.json` or in the root `package.json`, and
none appears anywhere in the history reachable from this branch. The spawn
therefore produced no output and every assertion ran against an empty string, so
the file could never have passed. It was invisible because
`test/integration/**` was outside the Vitest selection.

Rebuilding it means writing a real interactive-CLI harness; the repository
already has one (`dev-docs/tmux-harness.md`) and a root-level
`integration-tests/` tree that is the right home for end-to-end coverage.

Behaviours with no end-to-end equivalent today:

- OAuth tokens persist across a complete CLI restart
- `/auth logout` completely removes access
- expired tokens are refreshed automatically on use
- multiple providers hold independent sessions
- a returning user is not asked to re-authenticate

Related unit-level coverage that does exist and still passes:
`packages/auth/src/__tests__/keyring-token-store.di.test.ts` (28 cases,
token storage and isolation) and
`packages/auth/src/__tests__/oauth-manager-contract.test.ts` (8 cases,
manager interface including `getToken` and `forceRefreshToken`). Neither
exercises a real CLI process.

## Vacuous assertions found while porting

`InputPrompt.completion.test.tsx` has ESC tests whose intermediate wait is
`expect(onEscapePromptChange).toHaveBeenCalledWith(false)`. That call happens on
mount, so the wait is satisfied immediately and the assertion proves nothing
about the ESC keypress. "should reset escape state on any non-ESC key" consists
only of two such waits, so it passes without exercising any escape behaviour at
all.

These were passing under Vitest for the same reason. They are noted rather than
rewritten here because correcting them requires understanding why the
double-ESC clear does not fire (below), and a rewrite that merely makes them
strict would convert silent no-ops into red tests without adding information.

### `should clear buffer on second ESC press` — still failing

Established by direct probe rather than inference:

- a lone `\x1B` written to the ink-testing-library stdin is delivered as an
  `escape` key, twice in a row (probe rendered `KeypressProvider` directly)
- a bracketed paste is likewise delivered as a single `paste` key, so the
  keypress pipeline and the ink stub are not at fault
- `completion.showSuggestions` is `false` in this test, so ESC is not being
  consumed by the suggestion-dismiss branch of `handleEscapeKey`
- the mocked buffer's `setText` does update `text`, so `buffer.text` is
  non-empty when the first ESC arrives, and the empty-buffer early return in
  `handleEscapeKey` should not apply

Despite that, `onEscapePromptChange` is never called with `true`, so
`setShowEscapePrompt(true)` never runs and the second ESC never reaches
`buffer.setText('')`. The remaining unknown is inside `InputPrompt`'s own
dispatch. Left failing rather than adjusted to match current output.

### `InputPrompt` keyboard-driven cases — same open unknown

`InputPrompt.vim.test.tsx` fails 10 cases across two describes, all
keyboard-driven ("queued message editing", "command queuing while streaming"),
plus 12 snapshot comparisons. `InputPrompt.completion.test.tsx` has one ESC case
in the same state.

Ruled out by probe, not inference:

- **key delivery** — a probe rendering `KeypressProvider` directly shows `\r`
  arrives as `return`, `\u001B[A` as `up`, `\x1B` as `escape` (twice in a row),
  and a bracketed paste as a single `paste`
- **focus** — `props` is rebuilt per test with `focus: true`, so the
  `!focus && key.name !== 'paste'` early return in `handleSpecialInputKey` does
  not apply
- **subscription state** — `useKeypress` is called with
  `isActive: props.isEmbeddedShellFocused !== true`, which is `true` here
- **a write/subscribe race** — the stub's `Stdin.write` emits immediately and
  drops data when nothing is listening yet, which looked like the cause. Adding
  replay buffering for pre-subscription writes changed nothing, so it is not.
  That change was reverted rather than kept on the grounds that it seemed
  reasonable.

Paste reaches the component while every focus-gated key does not, which is the
most specific clue available: paste is the one key that bypasses the focus
check. The next step is tracing `state.handleInput` inside `inputPromptHooks`
rather than another guess from outside.

### `sandbox.bashrc` extra-fd IPC does not work under Bun — product impact

`packages/cli/src/utils/sandbox-bashrc.ts` spawns a shell with
`stdio: ['inherit', 'inherit', 'inherit', 'pipe', 'pipe']` and reads the
payloads back from `result.output[3]` and `result.output[4]`. Bun's `spawnSync`
does not support extra piped file descriptors.

Measured directly, same command on both runtimes:

| runtime | `output.length` | `output[3]` | `output[4]` |
| --- | --- | --- | --- |
| Node | 5 | `"env-payload\n"` | `"cwd-payload\n"` |
| Bun | 3 | `""` | `""` |

All 16 cases in `src/utils/sandbox-bashrc.test.ts` fail with "child produced no
cwd payload on the dedicated protocol pipe". This is not a test defect and
cannot be fixed in the test: the mechanism the code depends on is absent.

This matters beyond the test suite. The repository is moving to Bun as the
runtime (`bun scripts/start.ts` is the documented entry point), so the same
limitation applies to the shipped CLI: sandbox bashrc environment and cwd
capture would silently return empty under Bun. Carrying the payloads over a
temporary file, or over stdout with delimiters, would work on both runtimes.

Deciding and implementing that transport is a product change beyond a
test-runner migration, so it is recorded here rather than attempted.

## `InputPrompt.vim.test.tsx` — `queued message editing` deleted (8 cases)

The whole describe exercised `props.popAllMessages`. That prop appears exactly
once in non-test source — as an optional field in
`src/ui/components/inputPromptTypes.ts` — and nothing reads or calls it. The
feature it drove has been removed from `InputPrompt`.

The tests were also written against a different signature than the surviving
type declares: the type is
`(callback: (messages: string) => void) => void`, while the tests use
`mockPopAllMessages.mockReturnValue('Message 1\n\nMessage 2')`, i.e. a function
that returns the messages. So they could not have described current behaviour
even if the prop were still wired.

Behaviours lost:

- up arrow on an empty prompt loads all queued messages
- queued messages are not loaded when the prompt already has text
- an undefined return from `popAllMessages` is handled
- the NAVIGATION_UP binding behaves the same as the raw up arrow
- a single queued message is handled
- the check only fires when the buffer trims to empty
- absence of `popAllMessages` is tolerated
- input history is navigated when no queued messages exist

The last of these — up arrow navigating input history — is still covered by
`src/ui/hooks/useInputHistory.test.ts`.

Note for whoever restores this: `handleSpecialInputKey` was instrumented during
triage and the up arrow *does* arrive with `focus: true` and an empty buffer, so
the dispatch path is healthy; only the consumer is missing.

## Self-audit: fabricated snapshots committed during migration

Bun records a snapshot when one is missing and the run is not in CI. During the
early rounds of this migration, failing renders were recorded as new snapshot
entries before the practice of reverting `.snap` files after every run was
adopted. Comparing entry counts against `main` found five affected files:

| file | main | branch (before cleanup) |
| --- | --- | --- |
| `InputPrompt.vim.test.tsx.snap` | 8 | 16 |
| `InputPrompt.paste.test.tsx.snap` | 4 | 8 |
| `SettingsDialog.interactions.test.tsx.snap` | 8 | 16 |
| `MarkdownDisplay.test.tsx.snap` | 30 | 56 |
| `App.components.test.tsx.snap` | 0 | 1 (orphan; its test was deleted) |

All five have been restored from `main` with keys converted to Bun's format, and
the orphan deleted. Verified with `CI=true`, which makes Bun compare instead of
write.

**Consequence to be honest about:** with the fabricated entries removed, three
of these files now fail — `InputPrompt.paste` (14), `SettingsDialog.interactions`
(8) and `MarkdownDisplay` (28). Those tests had been counted as passing in
earlier progress reports in this effort. They were passing against snapshots
this migration had itself recorded, which is not evidence of anything. The
failures are real and are now visible.

`InputPrompt.vim.test.tsx` also had a distinct defect that caused runaway
snapshot growth: `await waitFor(() => expect(stdout.lastFrame()).toMatchSnapshot())`
records a **new numbered snapshot on every poll attempt**, so the stored index
depended on retry timing (observed reaching `... 21`). Fixed by waiting for a
frame and then snapshotting once.

Snapshot work from here must be verified with `CI=true` so a missing snapshot
fails instead of being silently written.
