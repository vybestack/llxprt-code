# Issue #3655: `seen: undefined is not an object (evaluating 'params.todos.length')`

## Root cause

`TodoWrite.getDescription()` (`packages/tools/src/tools/todo-write.ts:123`) evaluates
`params.todos.length` unconditionally. `TodoWrite` extends the legacy `BaseTool`, whose
`validateToolParams` base implementation returns `null` (no schema validation — unlike
`BaseDeclarativeTool`, which runs `SchemaValidator`). Consequence chain when the model
emits a `todo_write` call with malformed arguments (`{}`, `undefined` args, or
`todos: null` / non-array):

1. `ToolDispatcher.buildInvocation()` → `BaseTool.build(params)` succeeds because
   `validateToolParams` never rejects (`tools.ts:584` returns null).
2. An invocation wrapping the invalid params is created.
3. The Ink UI renders the call (`packages/cli/src/ui/hooks/toolMapping.ts:95` →
   `invocation.getDescription()` → `TodoWrite.getDescription(params)`) and throws
   `TypeError: undefined is not an object (evaluating 'params.todos.length')`, crashing
   the React/Ink render — exactly the "react style error" reported.

Notes on how malformed args arrive: `generateContentResponseUtilities.ts:310` defaults
missing args to `{}`; `subagentToolProcessing.ts:644` passes `functionCall.parameters`
with no default, so args can be `undefined` on the subagent path. The Loopbreaker
retry path can re-emit tool calls with degraded output. All of these funnel into
`build()`, which is the single boundary where validation belongs.

The sibling tool `TodoPause` already established the fix pattern: it overrides
`validateToolParams` with runtime checks for the exact same class of malformed params.

## Fix

Add a `validateToolParams` override to `TodoWrite` (plain `string | null` return, the
majority convention used by `ripGrep`, `github`, `memoryTool`):

- `params` not an object (null/undefined/non-object) → error string.
- `todos` missing → error string.
- `todos` not an array → error string.

`build()` then throws for malformed params, `ToolDispatcher.buildInvocation()` converts
the throw into an `INVALID_TOOL_PARAMS` error `ToolCall` (already proven by
`tool-dispatcher.test.ts:495`), and the UI displays a clean tool error
(`toolMapping.getDescription` falls back to `response.error?.message` when no
invocation exists) instead of crashing.

Explicitly out of scope:

- No `?.` guards inside `getDescription` — boundary validation is the fix; masking
  invalid state afterwards is the defense-in-depth antipattern.
- No changes to `execute`/`normalizeTodos` (item-level zod validation already exists
  and only runs after the boundary check passes).
- No changes to `subagentToolProcessing` args defaulting, the Loopbreaker, or the UI.
- Empty array `todos: []` remains valid (clearing the list is legitimate).

## Acceptance criteria

**AC1 — Malformed params rejected at build boundary.** For inputs
`undefined`, `{}`, `{ todos: null }`, `{ todos: 'x' }`, `{ todos: {} }`:
`validateToolParams` returns a non-null error string mentioning `todos`, and
`build()` throws an `Error` (so the dispatcher classifies the call as
`INVALID_TOOL_PARAMS` with no invocation).

**AC2 — Valid params unaffected.** `validateToolParams({ todos: [] })` and
`validateToolParams({ todos: [{ id: '1', content: 'a', status: 'pending' }] })`
return `null`; existing TodoWrite behavior tests (write→read round trip, emoji
filtering, active-todo tracking) pass unchanged.

**AC3 — Crash path eliminated with behavioral evidence.** A test reproduces the
reported scenario end-to-end at the tools layer: building an invocation for
malformed args throws (no invocation whose `getDescription()` could evaluate
`params.todos.length`), while a built invocation for valid args still returns
`Update todo list with N items`.

## Tests

New bun test file `packages/tools/src/__tests__/todo-write-params-validation.test.ts`
following dev-docs/RULES.md behavioral rules (real tool instances + fake
`ITodoService` infrastructure stub, as in `todo-tools.test.ts`; no mock theater):

1. Table-driven: each malformed input → `validateToolParams` non-null string
   containing `todos`; `expect(() => tool.build(input)).toThrow()`.
2. Valid inputs (empty list, single item, item without optional fields) →
   `validateToolParams` returns `null`.
3. `build(valid).getDescription()` → `'Update todo list with 1 items'` style
   description (proves description path intact post-validation).
4. Type-level: cast malformed inputs through `unknown`/`as never`-style honest
   typing where needed, since these inputs are untrusted model output.

## Verification

Full cycle per skill: `npm run test`, `npm run lint`, `npm run typecheck`,
`npm run format`, `npm run build`, plus a bun smoke run with a live profile.
Smoke profile note: the historical `stepfun-37` profile is no longer usable — the
StepFun subscription ended 2026-09-13; use the `glm` profile (Zai-backed
loadbalancer, zai first) for the smoke run instead.

## Review outcome (deepthinker, 2026-09-13)

PASS, no Blocker-Fix findings. Two LOW In-scope-Fix findings, both remediated:
(1) test table extended with null/primitive/array args and `{ todos: undefined }`
plus the empty-list description boundary (now 16 tests); (2) this plan's stale
stepfun-37 smoke reference corrected to `glm`. OCR not run — disabled by standing
instruction until explicitly re-enabled.
