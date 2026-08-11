# Phase 05: Stdout observer seam + Ink onRender wiring

Plan ID: PLAN-20260808-PERFTREND.P05
Prerequisites: P02 (parallel-safe with P04).
Packages: `core` (seam), `cli` (install). @pseudocode: `03-stdout-observer.md`
lines 10-58, `05-client-phases.md` lines 20-26.

## Stub
- `core/utils/stdio.ts`: add `StdoutWriteObserver` interface + optional `observer`
  param to `createInkStdio`; absent ⇒ current behaviour unchanged.
- `cli/ui/inkRenderOptions.ts`: replace module-scope `sharedStdio` with
  `getInteractiveStdio()` lazy cache + `setInteractiveStdoutObserver()`.

## Integration TDD (Bun, real behaviour)
- `createInkStdio.observer.behavior.test.ts` (EVIDENCE-AC6):
  - With an observer, a `Uint8Array` write increments bytes by
    `Uint8Array.byteLength` (NOT string length); a multi-byte UTF-8 string counts
    encoded bytes.
  - `stdout_write_calls` increments once per write; the wrapper returns the real
    `writeToStdout` boolean (backpressure) and invokes the callback.
  - **D8:** an internal observer that throws **propagates** (fail fast — no
    try/catch swallows it). Filesystem writer failures remain fail-open (AC-8).
  - Without an observer, behaviour is byte-identical to today (no counting side-effect).
- `inkRenderOptions.observer.behavior.test.ts` (EVIDENCE-AC6):
  - `setInteractiveStdoutObserver(obs)` then `getInteractiveStdio()` yields a
    Proxy carrying `obs`; calling it again returns the SAME cached instance.
  - A second `setInteractiveStdoutObserver` invalidates the cache (next build
    carries the new observer).
  - Ink `onRender` accumulate: render metrics add `renderTime` (verified
    against installed @jrichman/ink@6.4.8: `RenderMetrics = { renderTime: number }`)
    and increment a render-pass counter (distinct from write calls) — assert
    render_count ≠ write_calls on a coalesced frame.

## Impl (pseudocode 03 lines 10-58, D8)
- Optional observer; measure encoded bytes + sync invocation duration only;
  delegate to `writeToStdout`; the observer is called directly with **no**
  try/catch (internal errors fail fast).
- Zed's `createInkStdio()` call passes no observer ⇒ uncounted.

## Verify
- [x] AC-6 evidenced; Zed path explicitly uncounted.
- [x] Observer errors fail fast (D8); no swallowed internal exception.
- [x] core has no cli import; cli installs the observer it owns.
- [x] typecheck/lint clean; existing stdio tests green.
