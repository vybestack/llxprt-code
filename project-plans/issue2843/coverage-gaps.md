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
expected `✔` where the component renders `✓` (`\u2713`), and two cases expected a
`← current` suffix that the component no longer emits.
