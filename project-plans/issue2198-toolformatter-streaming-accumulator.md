# Issue #2198 — Replace ToolFormatter streaming accumulator unknown casts

Follow-up to audit issue #2159.

## Problem

`packages/tools/src/formatters/ToolFormatter.ts`,
`accumulateStreamingArguments`, stores per-tool-call streaming state by
mutating the `ToolCallBlock` argument with an undeclared `_argumentsString`
property, reached through four `as unknown as { _argumentsString: string }`
casts. `ToolCallBlock` (declared in `IToolFormatter.ts`) does not have that
property. The casts are not an external boundary; they are a local state
modeling gap.

Current code (lines 527-561):

```ts
if (!('_argumentsString' in tc)) {
  (tc as unknown as { _argumentsString: string })._argumentsString = '';
}
if (format === 'qwen') {
  logDoubleEscapingInChunk(chunk || '', tc.name || 'unknown', format);
}
(tc as unknown as { _argumentsString: string })._argumentsString += chunk;
try {
  const argsStr = (tc as unknown as { _argumentsString: string })._argumentsString;
  if (argsStr.trim()) {
    tc.parameters = doubleEscapeProcessToolParameters(argsStr, tc.name || 'unknown', format);
  }
} catch {
  // Keep accumulating
}
```

## Grounding facts

- `_argumentsString` appears nowhere else in the repository (grep: 5 hits, all
  inside `accumulateStreamingArguments`). Nothing reads the property off an
  accumulated block, so removing it from the emitted objects breaks no consumer.
- `logDoubleEscapingInChunk` in this package is intentionally a no-op (core's
  `DebugLogger` is not importable from `packages/tools`). "Preserve qwen
  double-escaping logging" therefore means: keep calling it, with the same
  arguments, on the same code path, for `qwen` only.
- `accumulateStreamingToolCall` has no non-test in-repo callers today (only
  historical `project-plans/multi-provider/*` docs reference it), so the current
  streaming behavior is only observable through the formatter's own API.
- `ToolFormatter.test.ts` has zero coverage of `accumulateStreamingToolCall`;
  the issue's "add focused tests" clause therefore applies.

## Accepted behavior (acceptance criteria)

AC1. `accumulateStreamingArguments` contains no `as unknown as` cast and does
not write any undeclared property onto `ToolCallBlock`. Streaming state is held
in a module-level `WeakMap<ToolCallBlock, string>`.

AC2. Accumulated `ToolCallBlock` objects carry no `_argumentsString` own
property (before, during, or after accumulation).

AC3. Behavior preserved exactly:

- Chunks concatenate in arrival order per tool-call block.
- After each chunk, when the accumulated string is non-blank, `tc.parameters`
  is set to `processToolParameters(accumulated, tc.name || 'unknown', format)`.
- A parse/processing throw is swallowed and accumulation continues; the
  previously computed `parameters` value is retained.
- For `format === 'qwen'` only, `logDoubleEscapingInChunk(chunk, tc.name ||
  'unknown', format)` is called once per chunk, before the chunk is appended.
- Blocks at different stream indices accumulate independently.

AC4. Module-level (not instance-level) WeakMap, because current state lives on
the block object and therefore survives across `ToolFormatter` instances.
Keying on the block preserves that; keying on the formatter instance would not.

AC5. No lint suppressions, no `eslint-disable`, no loosening of lint/type
config.

## Boundary cases to cover

- Multi-chunk JSON split mid-key and mid-value (`{"ci` + `ty":"SF` + `"}`).
- Chunk arriving before the tool name is known (name applied later in stream).
- Delta with `index === undefined` -> ignored, no state created.
- Whitespace-only accumulation -> `parameters` untouched (`{}`).
- Two indices interleaved -> independent accumulators, no cross-talk.
- Invalid JSON accumulated to completion -> no throw escapes.
- `qwen` double-escaped payload split across chunks -> same repaired result as
  a single chunk.

## Tests

New `describe('ToolFormatter streaming argument accumulation')` block in
`packages/tools/src/formatters/ToolFormatter.test.ts` (bun test, real
formatter, no mocks), covering each boundary case above plus an assertion that
`Object.prototype.hasOwnProperty.call(block, '_argumentsString')` is false and
`Object.keys(block)` contains only the declared fields.

## Explicitly out of scope

- The unused `index` parameter / `void index;` in `accumulateStreamingArguments`
  (leave as-is; not part of the accepted behavior).
- Any other `as unknown as` cast in the file or package.
- Changes to `doubleEscapeUtils.ts`, `IToolFormatter.ts`, or callers.
