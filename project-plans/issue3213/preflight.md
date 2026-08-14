# Issue #3213 — Preflight Audit (independently re-run)

Branch: `issue3213` @ `72f606aa0`
Date: 2026-08-12

All commands below were re-run independently on the current branch before any deletion.

## §4.1 — No production writer

```
git grep -n -E "startTrackingToolCall|completeToolCallTracking|failToolCallTracking" \
  -- . ':!bundle' ':!node_modules'
```

Matches only in:
- `packages/core/src/services/tool-call-tracker-service.ts` (the definitions)
- `packages/core/src/services/tool-call-tracker-service.test.ts`
- `packages/core/src/integration-tests/todo-system.test.ts`
- `project-plans/todo-3/**`, `project-plans/todo-flicker/**` (historical prose — not code)

**Zero production callers.** ✓ Matches plan.

## §4.2 — Full dead reader chain

`ToolCallTrackerService`: only in `packages/core/src/services/tool-call-tracker-service.ts`
(definition), its test, `integration-tests/todo-system.test.ts`, and
`packages/cli/src/ui/contexts/ToolCallProvider.tsx` (reader). No production writer.

`ToolCallProvider|ToolCallContext|useToolCallContext`:
- `App.tsx:24,70,95-107` — provider mount + comment
- `ToolCallContext.tsx` — definition + `useToolCallContext`
- `ToolCallProvider.tsx` — reader + subscriber
- `TodoPanel.tsx:11,252,260-265` — dead subscription
- `ToolGroupMessage.tsx:24,285` — dead read
- Three test files wrapping with `<ToolCallContext.Provider>`

`getLiveToolCalls|mergeToolCalls`:
- `llxprt-code-core.d.ts:18` — augmented option field
- `ToolGroupMessage.tsx:291` — passes callback to formatter
- `core/todo/todoFormatter.ts:18,144-162,197` — mergeToolCalls
- `tools/utils/todoFormatter.ts:18,134-152,187` — mergeToolCalls

All match plan §4.2 exactly. ✓

## §4.3 — Suppression hook is test-only

`ToolRenderSuppressionHook|tool-render-suppression`:
- `packages/core/src/hooks/tool-render-suppression-hook.ts` (definition)
- `packages/core/src/hooks/tool-render-suppression-hook.test.ts` (only consumer)
- `packages/core/src/hooks/__tests__/test-run.log` (stale committed log — not code)

Not exported from `packages/core/src/index.ts`. No production importer. ✓

## §4.4 — Three distinct `TodoContextTracker` symbols

| # | File | Status | Key method |
| --- | --- | --- | --- |
| 1 | `packages/core/src/services/todo-context-tracker.ts` | **DEAD** | `getActiveTodoId(): string \| null` |
| 2 | `packages/tools/src/utils/todoContextTracker.ts` | **ACTIVE** | `getActiveTodo(): string \| null` |
| 3 | `packages/tools/src/interfaces/ITodoService.ts:61` | **ACTIVE** | interface `TodoContextTracker` |

Dead (#1) consumers: only `tool-call-tracker-service.ts`,
`tool-render-suppression-hook.ts`, and test files (all deleted by this slice).
Live (#2) consumers: `todo-write.ts:22`, `CoreTodoServiceAdapter.ts:10` (from
`@vybestack/llxprt-code-tools`). ✓ Matches plan.

## §4.5 — The two formatters have diverged; do not merge them

```
diff -u packages/core/src/todo/todoFormatter.ts packages/tools/src/utils/todoFormatter.ts
```

The two files share a name and shape but have **genuine behavioral differences**:

- **Import source:** core imports `Todo`/`TodoToolCall` from
  `@vybestack/llxprt-code-tools`; tools imports from its local
  `../types/todo-schemas.js`.
- **String truncation:** core uses `truncateStringValue(key, value, max)`
  (truncates *any* string longer than `max`, path or not); tools uses
  `formatStringDisplayValue(key, value, max)`, which only truncates *path-like*
  values (`file_path` / `absolute_path` / contains `/`) and leaves other long
  strings untouched.
- **`formatTodoEntry`:** core emits
  `` `${marker} ${todo.content}${currentSuffix}` `` (no status text); tools
  inserts ` (in_progress)` before the ` ← current` suffix for in-progress todos.
- **Subtask helper name:** core calls `pushSubtaskLines`; tools calls
  `formatSubtasks` (different early-return shape).

They are consumed by different callers (core → CLI `ToolGroupMessage`;
tools → `todo-read.ts` / `todo-write.ts`). Consolidating them would change
user-visible output and is **out of scope**. The slice applies the *same
targeted edit* to each (drop `getLiveToolCalls`, drop `mergeToolCalls`, inline
`todo.toolCalls ?? []` into `pushToolCalls`) and changes nothing else. ✓ Matches
plan §4.5.

## §4.6 — `bundle/` is not tracked

```
git ls-files bundle | wc -l   # → 0
```

Zero tracked files. ✓

## §4.7 — No supported public API

```
git grep -n -iE "ToolCallTrackerService|ToolCallProvider|ToolCallContext|getLiveToolCalls|mergeToolCalls|ToolRenderSuppressionHook" \
  -- docs dev-docs schemas '*.json' '*.md' ':!project-plans' ':!bundle'
```

→ **zero matches.** ✓

## §4.8 — `todo-utils.ts` has no importer

```
git grep -n "todo-utils" -- . ':!bundle' ':!node_modules' ':!project-plans'   # → (none)
```

File exists, tracked, re-exports `groupToolCalls`/`GroupedToolCall`. Nothing imports it. ✓

## §4.9 — Coverage gap

```
git grep -ln "formatTodoListForDisplay" -- '*.test.ts' '*.test.tsx'   # → (none)
```

Zero direct test coverage for `formatTodoListForDisplay`. Phase 1 safety net is load-bearing. ✓

## Conclusion

All preflight results match the recorded plan evidence exactly. No discrepancies found.
Proceeding with the deletion phases.
