# Issue #3031 — `timeout_seconds` surface for `task` and `run_shell_command`

## Problem restated

Two tools expose a `timeout_seconds` parameter with one-line descriptions that omit
everything a model needs in order to use them:

- `task` (`packages/agents/src/tools/task.ts`)
- `run_shell_command` (`packages/tools/src/tools/shell-helpers.ts`)

Three concrete defects:

1. **No resolution rules in the description.** Neither description mentions that a
   default applies when the parameter is omitted, that a configured maximum clamps
   larger requests, or that both bounds are tunable ephemeral settings.
2. **Silent clamping.** A request above the maximum is reduced to the maximum with
   no signal in the result. The caller believes it got what it asked for.
3. **`-1` defeats the ceiling (bug).** Both `resolveTimeoutSeconds` copies return
   early on `-1` *before* consulting the maximum, so the most extreme request
   escapes the bound entirely — the inverse of how a ceiling should behave.

There are **three** near-identical copies of the resolver, not two:

| File | Notes |
| --- | --- |
| `packages/agents/src/tools/taskAbortHelpers.ts:38` | task tool (agents) |
| `packages/core/src/tools-adapters/coreSubagentServiceHelpers.ts:189` | core subagent adapter |
| `packages/tools/src/tools/shell.ts:740` | private method on `ShellToolInvocation` |

All three share the `-1` bypass.

## Target semantics

The configured maximum is a **ceiling only**. It bounds upward and never upward-adjusts
a shorter request. The caller keeps full authority downward.

Given `(requested, default, max)`:

| Condition | Result |
| --- | --- |
| `max === -1` or `max === undefined` (no ceiling) | `effective = requested ?? default`; `-1` → unbounded |
| finite `max`, `requested === -1` | `max`, clamped |
| finite `max`, `requested === undefined` and `default === -1` | `max`, clamped |
| finite `max`, `effective > max` | `max`, clamped |
| finite `max`, `effective <= max` | `effective` exactly, not clamped |

`requested = 300` under `default = 900, max = 1800` must resolve to `300`. Small
requests are legitimate (racing subagents, self-imposed deadlines) and must be honoured.

Unbounded execution is reachable **only** when the operator sets the maximum to `-1`.

## Design

### 1. Canonical shared helper

`packages/tools` has no `@vybestack/llxprt-code-*` dependencies and is depended on by
both `core` and `agents`, so it is the only package all three call sites can import
from. New module:

`packages/tools/src/utils/timeoutResolution.ts`

```ts
export interface TimeoutResolution {
  /** Effective timeout in seconds; undefined means unbounded. */
  readonly effectiveTimeoutSeconds: number | undefined;
  /** What the caller asked for, verbatim (undefined when omitted). */
  readonly requestedTimeoutSeconds: number | undefined;
  /** Configured default that applies when the caller omits the parameter. */
  readonly defaultTimeoutSeconds: number;
  /** Configured ceiling; -1 or undefined means no ceiling. */
  readonly maxTimeoutSeconds: number | undefined;
  /** True when the request (or default) was reduced to the ceiling. */
  readonly clamped: boolean;
}

export function resolveTimeout(
  requestedTimeoutSeconds: number | undefined,
  defaultTimeoutSeconds: number,
  maxTimeoutSeconds: number | undefined,
): TimeoutResolution;

export function resolveTimeoutSeconds(
  requestedTimeoutSeconds: number | undefined,
  defaultTimeoutSeconds: number,
  maxTimeoutSeconds: number | undefined,
): number | undefined;
```

`resolveTimeoutSeconds` is a thin wrapper over `resolveTimeout` returning
`effectiveTimeoutSeconds`, so existing call sites keep their shape.

Also export a shared message builder so both tools word the clamp notice identically:

```ts
export function describeTimeoutClamp(
  resolution: TimeoutResolution,
  settings: { defaultSetting: string; maxSetting: string },
): string | undefined;
```

Returns `undefined` when not clamped. When clamped, returns a single sentence naming
the requested value, the applied value, and the setting that would raise the ceiling.

The tools package must export this via a `./utils/timeoutResolution.js` entry in
`packages/tools/package.json` `exports` (follow the existing `./utils/fetch.js` shape)
and register it wherever the export map is generated/validated.

### 2. Call site consolidation

- `packages/agents/src/tools/taskAbortHelpers.ts` — re-export `resolveTimeoutSeconds`
  from the shared module (keep the named export so existing importers and the
  agents API-surface check stay valid), and add `resolveTimeoutResolutionFromConfig`
  returning the full `TimeoutResolution` for the task tool's messaging needs.
  `resolveTimeoutFromConfig` keeps its current signature/return type.
- `packages/core/src/tools-adapters/coreSubagentServiceHelpers.ts` — replace the local
  body with a re-export of the shared helper.
- `packages/tools/src/tools/shell.ts` — delete the private method, call the shared
  helper, and keep the resolution object around so the invocation can report clamping.

Note `packages/core/src/tools-adapters/CoreShellToolHostAdapter.ts:96-112` returns
`{ timeoutSeconds, defaultTimeoutSeconds }` where `timeoutSeconds` is actually the
**maximum**. That naming is confusing and is what `shell.ts:326-330` passes as the
`max` argument. Do not rename the host interface field (public-ish contract), but add
a doc comment on `getTimeoutConfig` clarifying that `timeoutSeconds` is the ceiling.

### 3. Descriptions

**Task** (`packages/agents/src/tools/task.ts`, `timeout_seconds`) — mirror the clarity
of the sibling `max_turns` description. Must convey, without hardcoding numbers:

- precedence: explicit parameter → `task-default-timeout-seconds` → bounded by
  `task-max-timeout-seconds`
- a value below the maximum is honoured exactly, however small
- `-1` means "as long as the configured maximum allows", not unbounded; it resolves to
  the maximum unless the maximum is itself `-1`
- an explicit cue to set it: long-running work (full-suite verification, code review,
  multi-file implementation) routinely outlives the default and should be given an
  explicit timeout
- a request above the maximum is clamped and the result will say so

**Shell** (`packages/tools/src/tools/shell-helpers.ts`, `timeout_seconds`) — same
structure with `shell-default-timeout-seconds` / `shell-max-timeout-seconds`, plus the
existing note that for background jobs the timeout bounds only the launch.

Neither description may state a current numeric default or maximum as fact — both are
overridable through ephemeral settings and hardcoded numbers would teach a false
invariant.

### 4. Clamp visibility

**Task** — `packages/agents/src/tools/task.ts` / `taskResultHelpers.ts`:

- Every task `ToolResult` (success, timeout, cancel) carries metadata:
  `effectiveTimeoutSeconds`, `requestedTimeoutSeconds`, `timeoutClamped`.
- When `timeoutClamped` is true, append the `describeTimeoutClamp` sentence to
  `llmContent` and `returnDisplay` so the model reads it even if it ignores metadata.

**Shell** — `packages/tools/src/tools/shell.ts`:

- When clamped, append the same sentence to the `llmContent` of the foreground result
  (both the timeout branch and the normal-completion branch).
- Background launches: `timeout_seconds` bounds only the launch, so still report the
  clamp if one occurred, since the caller's request was not honoured.

### 5. Timeout legibility

`createTimeoutResult` (`packages/agents/src/tools/taskResultHelpers.ts:137`) currently
produces `Task timed out after Ns (timeout_seconds).` Replace with a message that names:

- the termination reason (timeout),
- the effective timeout that was applied,
- that the bound is raisable, naming `timeout_seconds` and
  `task-max-timeout-seconds` / `task-default-timeout-seconds`,
- when the run was clamped, that the requested value was not the value applied.

Do the same for the shell timeout branch in `formatOutputContent`
(`packages/tools/src/tools/shell.ts:600`).

Note on the reported `[no tool result]`: every return path in `TaskTool` produces a
`ToolResult`, so this is not reproducible from the task tool source as written — it
most plausibly came from the foreground turn itself being aborted, above this layer.
Do **not** invent speculative defensive plumbing to chase it. The deliverable here is
that a timeout that *does* reach the caller is legible.

## Test plan (TDD — tests first)

All new tests are **Bun** (`bun:test`). Do not add or modify Vitest suites except where
an existing Vitest assertion encodes the now-corrected `-1` behaviour and must change.

### T1 — shared helper matrix (new, bun)

`packages/tools/src/utils/timeoutResolution.test.ts`

Table-driven over `(requested, default, max)`. Required cases:

| requested | default | max | expected effective | clamped |
| --- | --- | --- | --- | --- |
| `300` | `900` | `1800` | `300` | false |
| `1800` | `900` | `1800` | `1800` | false |
| `3600` | `900` | `1800` | `1800` | **true** |
| `-1` | `900` | `1800` | `1800` | **true** |
| `undefined` | `900` | `1800` | `900` | false |
| `undefined` | `3600` | `1800` | `1800` | **true** |
| `undefined` | `-1` | `1800` | `1800` | **true** |
| `-1` | `900` | `-1` | `undefined` (unbounded) | false |
| `undefined` | `-1` | `-1` | `undefined` (unbounded) | false |
| `3600` | `900` | `-1` | `3600` | false |
| `3600` | `900` | `undefined` | `3600` | false |
| `-1` | `900` | `undefined` | `undefined` (unbounded) | false |

Plus: `describeTimeoutClamp` returns `undefined` when not clamped, and when clamped
returns a string containing the requested value, the applied value, and the max
setting name.

### T2 — task tool behaviour (new, bun)

`packages/agents/test-bun/taskTimeoutBounds.issue3031.bun.ts`, registered in the
`agents` entry of `scripts/bun-test-manifest.ts`. Prefer this `test-bun/*.bun.ts`
location (precedent: `test-bun/generatingModelStamp.issue2511.bun.ts`) over an
in-`src` `*.test.ts` file, because the `.bun.ts` suffix is outside Vitest's include
glob and therefore needs no `exclude` entry in `packages/agents/vitest.config.ts`.

Behavioural assertions, driving the real `TaskTool` through its public
`build(...).execute(...)` path with a stubbed orchestrator:

- `timeout_seconds: -1` with `task-max-timeout-seconds: 5` → the run is bounded (the
  subagent is aborted), the result is a `TIMEOUT` error, and the message names the
  effective bound. It must **not** run unbounded.
- `timeout_seconds` above the max → result metadata reports the clamped effective
  value and `timeoutClamped: true`, and `llmContent` contains the clamp notice.
- `timeout_seconds` below the max → metadata reports the exact requested value and
  `timeoutClamped: false`; no clamp notice in `llmContent`.
- `task-max-timeout-seconds: -1` with `timeout_seconds: -1` → no timer is armed.
- Timeout message names `timeout_seconds` and `task-max-timeout-seconds`.

### T3 — task schema description (new, bun)

Assert the `timeout_seconds` description mentions `task-default-timeout-seconds`,
`task-max-timeout-seconds`, and `-1`, and asserts that it contains **no** bare
occurrence of the current numeric constants (`900` / `1800`) — that last assertion is
the guard against re-introducing a false invariant.

### T4 — shell tool behaviour (new, bun)

`packages/tools/src/__tests__/shell-timeout-bounds.test.ts`

- `timeout_seconds: -1` with a finite host maximum → bounded; result reports the
  effective timeout, not unbounded.
- above-max request → clamp notice present in `llmContent`.
- below-max request → exact value honoured, no clamp notice.
- host maximum `-1` with `timeout_seconds: -1` → unbounded.
- timeout message names `timeout_seconds` and `shell-max-timeout-seconds`.

### T5 — shell schema description (extend existing bun test)

`packages/tools/src/__tests__/shell-helpers-schema.test.ts` — same shape as T3 with
the `shell-*` setting names.

### T6 — existing suites that must be updated

- `packages/agents/src/tools/task.timeout.test.ts` (Vitest) — the case
  `skips timeout when timeout_seconds is -1` encodes the defect. It must be updated to
  the corrected semantics (bounded under a finite max; unbounded only when the max is
  `-1`). This is a required change, not a new Vitest suite.
- Any `coreSubagentServiceHelpers` / `CoreSubagentServiceAdapter` tests asserting the
  old `-1` behaviour.
- `packages/tools/src/__tests__/shell-tool.test.ts` if it asserts the old behaviour.

Search for `-1` timeout assertions across all three packages before implementing and
fix every one that encodes the bypass.

## Documentation

Update the timeout settings documentation to describe ceiling semantics. Check
`docs/settings-and-profiles.md` and `docs/tools/shell.md` (and any subagents doc) for
existing prose about `task-max-timeout-seconds` / `shell-max-timeout-seconds` and
correct it if it claims `-1` yields an unbounded run regardless of the maximum.

## Constraints

- No `eslint-disable*`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`.
- No loosening of complexity/size lint thresholds, no severity downgrades, no new
  `ignores:` entries. Fix the underlying structure instead (extract helpers).
- No `any`, no unsafe type assertions.
- Fail fast: do not add speculative defensive guards. The only new branching is the
  documented ceiling semantics.
- New tests: Bun + `bun:test` only.
- Copyright headers on new files: `Copyright 2026 Vybestack LLC`.

## Verification

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```
