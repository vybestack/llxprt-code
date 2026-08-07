# Feature Specification: Honest Bun memory reporting and startup behavior

Issue: [#3112](https://github.com/vybestack/llxprt-code/issues/3112)
Plan ID: `PLAN-20260807-ISSUE3112`
Generated: 2026-08-07
Branch: `issue3112`

## Purpose

The CLI currently presents Bun's growing `v8.getHeapStatistics().heap_size_limit`
value as a fixed heap ceiling and relaunches Bun with a
`--max-old-space-size` argument that Bun silently ignores. The delivered behavior
must stop making either claim while preserving the meaningful Node runtime path.
The memory-retention problem investigated in #3108 is explicitly outside this
issue.

## Accepted behavior

### [REQ-3112-001] Bun footer never presents a heap ceiling

- **GIVEN** the footer is rendered by Bun with memory reporting enabled
- **WHEN** memory usage is displayed at narrow, standard, or wide breakpoints
- **THEN** `Heap:` reports only the current used heap and has no `/limit`
  denominator
- **AND** `RSS:` remains visible at every breakpoint
- **AND** wide/detailed output continues to include `External:` and
  `ArrayBuffers:`
- **AND** compact output retains its existing `G` suffix while non-compact
  output retains `GB`

This is deliberately a reporting correction only. It does not introduce an
in-process memory ceiling or change the existing RSS warning threshold.

### [REQ-3112-002] Node footer behavior remains meaningful and non-stale

- **GIVEN** the same footer code is executed by Node
- **WHEN** memory usage is displayed
- **THEN** the existing Node heap-limit denominator remains available
- **AND** each periodic memory snapshot reads the current heap statistic instead
  of reusing a module-level memoized value

This preserves the runtime where `--max-old-space-size` and
`heap_size_limit` have real semantics while removing the stale-value defect.

### [REQ-3112-003] Bun never relaunches for `--max-old-space-size`

- **GIVEN** startup is running under Bun
- **WHEN** `shouldRelaunchForMemory` is evaluated with any host-memory size,
  heap statistic, debug mode, configured cap, or
  `LLXPRT_CODE_NO_RELAUNCH` state
- **THEN** it returns `[]`
- **AND** no `--max-old-space-size` argument is produced

The no-relaunch environment guard remains unchanged for Node. Bun exits before
performing calculations whose result cannot affect its memory behavior.

### [REQ-3112-004] Bun sandbox launches receive no ignored heap flag

- **GIVEN** a sandbox child is being prepared by a Bun-fronted CLI
- **WHEN** `computeSandboxMemoryArgs` is called with host-derived memory,
  container-derived memory, or a custom heap cap
- **THEN** it returns `[]`
- **AND** the sandbox launch continues with that empty argument list

Node executions retain the existing 50%, minimum, cap, rounding, and debug
behavior. Existing settings remain in place because they are still meaningful
for Node and removing or migrating them is outside scope.

### [REQ-3112-005] Remaining heap-flag uses are classified, not removed broadly

- Bun-fronted live production calls in `packages/cli/src/utils/bootstrap.ts` are
  the dead behavior corrected by REQ-3112-003 and REQ-3112-004.
- `packages/cli/src/cliBootstrap.tsx` and
  `packages/cli/src/cliSandbox.ts` are their callers and require no new public
  contract.
- CLI test fixtures and relaunch utility examples are not independent runtime
  policy decisions.
- Root `package.json`, lint scripts, and CI `NODE_OPTIONS` uses front real Node
  processes and remain untouched.

## Relevant inputs and boundary cases

| Input or boundary | Accepted result |
|---|---|
| Bun version is a non-empty `process.versions.bun` string | Bun behavior is selected |
| Bun footer at compact width | `Heap: <used>G RSS: <rss>G`, with no denominator |
| Bun footer at standard width | `Heap: <used>GB RSS: <rss>GB`, with no denominator |
| Bun footer at wide width | Heap, external, array buffers, and RSS values, with no denominator |
| Memory changes after the two-second refresh | Rendered current metrics update |
| Node heap statistic changes between snapshots | The new denominator is rendered; no stale memoized limit |
| Bun host with large memory and a small reported heap statistic | No relaunch argument |
| Bun sandbox with explicit container memory and custom cap | No sandbox memory argument |
| Node with `LLXPRT_CODE_NO_RELAUNCH` set | Existing empty result remains |
| Node target at or below current heap limit | Existing empty result remains |
| Node target above current heap limit | Existing integer `--max-old-space-size=<MB>` result remains |
| Node sandbox cap/minimum/fractional cases | Existing calculation remains |

## Behavioral evidence

Tests must be written first and observed failing before production changes.
Changed test files must import assertions and lifecycle hooks from `bun:test`;
where module-mocking compatibility is needed, they must import `vi` from the
existing CLI Bun test facade.

1. `Footer.test.tsx` renders the real footer under a Bun-like runtime and proves
   the absence of a heap denominator plus the continued presence of Heap, RSS,
   External, and ArrayBuffers values.
2. `Footer.test.tsx` drives the existing two-second refresh under a Node-like
   runtime with changing heap statistics and proves the denominator updates.
3. `bootstrap.test.ts` establishes Node-like runtime state for the existing
   calculation coverage, preserving all current Node-path assertions.
4. `bootstrap.test.ts` adds Bun cases proving both exported memory-argument
   functions return empty arrays for values that otherwise produce flags.
5. Static call-path evidence confirms that `[]` from `computeSandboxMemoryArgs`
   under Bun is safe: `computeSandboxMemoryArgsFromEnv` returns it unchanged to
   `maybeHopIntoSandbox`, which passes it as `sandboxMemoryArgs` to
   `start_sandbox(config, sandboxMemoryArgs, …)`. `start_sandbox` defaults
   `nodeArgs` to `[]` and spreads it into `NODE_OPTIONS` via
   `addContainerEnvVars` (container path) or into the seatbelt `nodeOptions`
   join (seatbelt path); an empty array contributes nothing to either. The
   existing mocked `cli-sandbox.test.tsx` verifies wiring with a non-empty mock
   return; the empty-array safety is proven by the static spread/default
   analysis, not by a behavioral integration test.
6. The focused Bun test run, full repository verification, smoke test, and tmux
   footer observation must all pass on the candidate head.

## Implementation constraints

- No new dependency, workflow, setting, environment variable, public API, or
  runtime subsystem.
- Runtime detection uses the established non-empty
  `process.versions.bun` convention at the two existing decision points; a
  cross-package export is not introduced for this bounded change.
- No change to #3108 accumulation behavior and no in-process memory limiter.
- No package.json, lint-script, CI, relaunch utility, or unrelated test cleanup.
- No lint/type suppressions, lint-rule changes, complexity threshold changes, or
  ignored source.
- Prefer a direct fail-fast Bun branch over fallback or defensive layers.
