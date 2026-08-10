# Plan: Bound Shell Foreground Output Acquisition (Issue #3200)

Plan ID: PLAN-20260809-ISSUE3200
Generated: 2026-08-09
Parent: #3202

## Problem

Foreground shell output acquisition is unbounded across both child_process and
PTY backends. The child_process path stores every raw Buffer in
`outputChunks[]` and does `Buffer.concat()` at completion. The PTY path stores
every re-encoded chunk in `outputChunks[]`, uses a 600,000-line xterm
scrollback, an unbounded processing-chain promise queue, and quadratic
`reduce()` for binary progress. Direct `!` shell accumulates
`cumulativeStdout` without limit. Prompt injection and ACP/Zed paths inherit
the same defect. Token limiting runs only after full materialization.

## Architecture

### Acquisition Primitives (packages/tools/src/acquisition/)

Establish reusable, dependency-safe acquisition contracts in the leaf
`packages/tools` package under an explicit `./acquisition` subpath. Core,
MCP, CLI, providers, and agents already depend on tools; no reverse dependency
or new package.

**Public surface:**
- `ByteBudget` — immutable validated finite byte-budget value with hard ceiling
- `BoundedStreamCollector` — single-stream copied head/tail collector with
  deferred multibyte-safe decoding and O(1) byte accounting
- `BoundedCombinedCollector` — combined stdout+stderr budget preserving
  provenance and arrival order
- `AcquisitionResult` — result type with decoded text, observed/retained/omitted
  accounting, and durable truncation metadata
- `DEFAULT_OMISSION_NOTICE` — shared durable truncation marker

**Constraints on shared primitives:**
- Do NOT read settings, spawn/kill processes, parse terminal state, detect
  encodings, strip ANSI, import xterm/MCP, or choose drain/terminate policy
- Receive plain validated `ByteBudget` values from callers
- No full-size duplicate materialization (no `Buffer.concat(allChunks)`)

### Setting: shell-output-retention-max-bytes

Add a shell-specific ephemeral setting to the settings registry:
- Finite default: 4 MiB (4,194,304 bytes)
- Immutable hard maximum: 64 MiB (67,108,864 bytes)
- Separate from model-facing token limits (`tool-output-max-tokens`)
- Integrated with established settings registry/profile/runtime patterns
- Clamped at resolution boundary so bad values cannot exceed the hard max

### Child-Process Path

1. Replace `outputChunks: Buffer[]` with `BoundedCombinedCollector`
2. Preserve bounded per-stream live decoding while using the combined raw
   collector as the authoritative shared byte budget
3. Replace completion-time `Buffer.concat(state.outputChunks)` with bounded
   collector results
4. Use byte accounting (not UTF-16 code units) for the budget
5. Keep fixed-size binary sniff state with O(1) accounting
6. Expose only bounded raw head/tail bytes for compatibility
7. Continue draining after retention fills (side effects, final exit status)
8. Surface durable text and structured truncation metadata

### PTY Path

1. Replace `outputChunks: Buffer[]` with bounded collector
2. Process terminal data in order — do not feed a head/tail-dropped ANSI
   stream to xterm
3. Bound xterm scrollback to a finite limit derived from the byte budget
4. Bound retained serialization output
5. Bound pending processing-queue bytes with high/low watermarks
6. Use byte and item high/low watermarks on backpressure-capable adapters;
   for Bun (whose pause/resume are no-ops), fail fast at the hard bound
7. Terminate through the existing platform process-tree lifecycle on overflow
8. Remove quadratic accounting and cap retained pending Promise closures by
   the hard queue item limit

### Entry Point Coverage

Apply the validated byte budget to ALL foreground shell entry points:
1. Normal Shell tool — bounded via execution layer
2. Direct `!` shell — bound `cumulativeStdout`
3. Prompt shell injection — bound `executionResult.output`
4. ACP/Zed — enforce byte budget, do NOT approximate as tokens*4
5. Preserve truncation metadata through interfaces/adapters

### Preservation

- Exit status, signal handling, CLIXML handling, binary behavior, live output
  behavior, managed background-job behavior — all preserved
- Background jobs are disk-backed and out of scope (shared interface
  compatibility only)

## Phases

### Phase 01: Acquisition Primitives (packages/tools/src/acquisition/)
- Create `byteBudget.ts`, `boundedStreamCollector.ts`,
  `boundedCombinedCollector.ts`, `types.ts`, `index.ts`
- Export via package.json subpath `./acquisition.js`
- Write behavioral tests: head/tail overflow, combined provenance, UTF-8
  multibyte boundaries, one-huge-chunk, many-tiny-chunks, O(1) accounting

### Phase 02: Setting Registration
- Add `shell-output-retention-max-bytes` to settings registry
- Add to profile types, runtime settings, /set command schema
- Wire through Config.getShellExecutionConfig()

### Phase 03: Child-Process Integration
- Replace CpExecState.outputChunks with BoundedCombinedCollector
- Update handleCpOutput, cleanupCpResources, buildCpExitResult
- Write tests: bounded overflow with metadata, continue-and-drain, CLIXML

### Phase 04: PTY Integration
- Replace PtyExecState.outputChunks with bounded collector
- Bound scrollback, processing queue, serialization
- Fail-fast for Bun adapter overflow
- Write tests: ANSI cursor/clear/wrap, bounded scrollback, fail-fast

### Phase 05: Entry Point Coverage
- Direct `!` shell: bound cumulativeStdout
- Prompt injection: bounded output
- ACP/Zed: enforce byte budget
- Write tests: propagation through each entry point

### Phase 06: Verification
- npm run test, lint, typecheck, format, build, smoke test
