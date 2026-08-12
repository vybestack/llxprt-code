# Issue #3213 Verification

Branch: `issue3213`
Date: 2026-08-12

## Behavioral verification

Focused Bun tests covered the real disk-backed TodoWrite/TodoRead path, both
TodoStore path-resolution contracts, both formatter implementations, TodoPanel,
and ToolGroupMessage:

```text
63 pass
0 fail
14 snapshots
145 expect() calls
```

The persistence test uses separate `TodoStore` instances over one temporary data
directory. It verifies that top-level and subtask `toolCalls` survive JSON
serialization and reload, that their timestamps hydrate back into `Date`, and
that malformed persisted timestamps reject. The model-facing schema remains
strict `z.date()`; ISO-string hydration exists only at the store read boundary.

## Terminal UI verification

Command:

```text
bun scripts/tmux-harness.ts \
  --script scripts/tmux-script.issue3213-todo-panel.llxprt.json \
  --out-dir /tmp/issue3213-tmux-evidence-final
```

Result: exit 0. The scripted fake-provider fixture makes the tool sequence
repeatable, while `todo_pause` checkpoints prevent automatic continuation from
consuming the next scripted response.

Evidence from the final run:

| Capture | Observed state |
| --- | --- |
| `014-01-after-todo-write-screen-screen.txt` | `todo-continuation=false`; panel shows `Read README.md` in progress and `Write summary` pending |
| `022-02-after-todo-read-screen-screen.txt` | `Todo list read (2 tasks).`; panel state remains unchanged |
| `030-03-read-file-while-active-screen-screen.txt` | `ReadFile README.md` is visible in the same frame as the unchanged active TODO panel |
| `037-04-after-status-update-screen-screen.txt` | panel shows `Read README.md` completed and `Write summary` in progress |

## Required gates

| Gate | Result |
| --- | --- |
| Focused ESLint over every changed TypeScript/TSX file | PASS |
| `npm run typecheck` | PASS |
| Prettier check over all supported changed files | PASS |
| `git diff --check` | PASS |
| `npm run build` | PASS |
| stepfun-37 haiku smoke test | PASS |
| ESLint policy guard | PASS |
| no-Vitest guard | PASS |
| no-new-JS guard | PASS |
| CLI test discovery guard | PASS, 707/707 discovered |
| copyright-year guard | PASS |
| doc-placement guard | PASS |
| test-file coverage guard | PASS |

The full-tree `npm run lint` command exceeded the local shell's 900-second
execution ceiling without reporting a lint diagnostic. The scoped ESLint run
and all applicable policy guards passed.

## Full test-suite status

Two full `npm run test` attempts exceeded the local shell's 900-second execution
ceiling. The latest attempt completed tools (107/107 files), storage (38/38),
auth (43/43), settings (16/16), telemetry (42/42), IDE integration (10/10),
policy (12/12), and MCP (43/43) before the shell terminated it while core was
still running; no failure had been reported in those completed workspaces.

An isolated core run with the runner's supported concurrency override completed
388/389 files. Its only failing file was the unchanged
`packages/core/test/utils/ripgrepPathResolver.test.ts`: four stale mocks expect
`/usr/local/bin/rg`, while the current re-exported tools implementation resolves
the host's `/opt/homebrew/bin/rg`. The same failures reproduce on clean HEAD, so
this issue does not weaken or rewrite that unrelated cross-platform test suite.

## Release-output and reference audit

A fresh `npm run build` completed successfully. Searches of rebuilt package
output found no generated copies of the removed tracker/provider/context/hook or
live formatter symbols. The active tools `TodoContextTracker`, `getActiveTodo`,
`TodoToolCall`, and both `formatTodoListForDisplay` implementations remain.

Repository source search leaves no production reference to
`ToolCallTrackerService`, `ToolCallProvider`, `ToolCallContext`,
`useToolCallContext`, `ToolRenderSuppressionHook`, `getLiveToolCalls`, or
`mergeToolCalls`. Historical planning text and the stale tracked core test log
are not production consumers.

Generated `dist`/`bundle` output remains ignored and will not be staged.
`.llxprt/LLXPRT.md` contains a pre-existing user change and will remain unstaged
and uncommitted.

## OCR remediation (TOCTOU in readFileDataAt)

OCR identified a real TOCTOU race in `TodoStore.readFileDataAt`: the method
checked `fs.existsSync` then called `fs.promises.readFile`, so a file
disappearing between the two operations surfaced an unhandled ENOENT. The fix
removes the check-then-read race entirely: `readFile` is now attempted
directly, and only a genuine Node `ENOENT` error is caught and mapped to the
legitimate empty state (`{ todos: [], paused: false }`). All other errors —
including malformed persisted JSON/schema validation failures and non-ENOENT
I/O errors — propagate unchanged via re-throw. A small typed predicate
(`isENOENT`) narrows the error by its `code` property without type assertions.

### Verification (scoped)

| Gate | Command | Result |
| --- | --- | --- |
| Injection + missing-file tests | `bun test packages/tools/src/tools/todo-store-injection.test.ts` | 12 pass, 0 fail |
| Single-resolution tests | `bun test packages/tools/src/tools/todo-store-single-resolve.test.ts` | 4 pass, 0 fail |
| Behavior (incl. malformed-data rejection) | `bun test packages/tools/src/__tests__/todo-write-tracker.behavior.test.ts` | 4 pass, 0 fail |
| Scoped ESLint | `npx eslint` on `todo-store.ts` + `todo-store-injection.test.ts` | PASS (exit 0) |
| Scoped Prettier | `npx prettier --check` on both changed files | PASS |
| ESLint policy guard | `npm run lint:eslint-guard` | PASS |
| Tools typecheck | `tsc --noEmit` in `packages/tools` | PASS (exit 0) |
| Whitespace | `git diff --check` | PASS (exit 0) |

The new tests prove a never-written store returns an empty todo list and a
non-paused state, and that a fresh write succeeds without a pre-existing file.
The pre-existing "fails fast when persisted toolCall timestamps are malformed"
test confirms corrupt persisted data still rejects after the fix.
