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

## Ported, not deleted

- `src/ui/components/ContextIndicator.ui.test.tsx` — constructed
  `new ProviderManager()` with no arguments, which has been rejected since issue
  #2300 required an explicit runtime context; supplied a `SettingsService`, and
  mocked the runtime bridge that `Footer` pulls in. One expectation was a stale
  context window (`1049k` for `claude-3-opus`, which is `200k`).
