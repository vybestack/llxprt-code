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

## Ported, not deleted

- `src/ui/components/ContextIndicator.ui.test.tsx` — constructed
  `new ProviderManager()` with no arguments, which has been rejected since issue
  #2300 required an explicit runtime context; supplied a `SettingsService`, and
  mocked the runtime bridge that `Footer` pulls in. One expectation was a stale
  context window (`1049k` for `claude-3-opus`, which is `200k`).
