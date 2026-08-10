# Phase 07: Client phase measurement + record assembly

Plan ID: PLAN-20260808-PERFTREND.P07
Prerequisites: P05, P06.
Package: `cli`. @pseudocode: `05-client-phases.md` lines 10-79.

## Stub
- Recorder measurement fields + `buildRecord` throw/empty.

## Integration TDD (Bun, real behaviour)
- `clientPhases.behavior.test.ts` (EVIDENCE-AC5):
  - Real streaming turn (fixture provider, deterministic deltas): assert every
    client phase (`client_prepare_ms`, `stream_handler_ms`, `ink_render_ms`,
    `stdout_write_sync_ms`, `client_finalize_ms`) is ≥ 0 and directly measured.
  - Assert NO phase is computed as `elapsed − provider − tool` (inspect the record
    shape: phases are independent fields; the subtraction never appears).
  - Overlapping provider+tool: `provider_union_ms` ≤ `provider_attempt_sum_ms`
    permitted; `agent_activity_union_ms` = provider∪tool union; record does not
    claim they sum to elapsed.
  - `unclassified_elapsed_ms` reported honestly; on a turn with a synthetic gap it
    is positive and non-clamped (assert ≥ the injected gap, never < 0 unconditionally
    — it MAY be 0 only when there is genuinely no residual).
- `inkRenderVsWrite.behavior.test.ts` (EVIDENCE-AC6, partial):
  - Coalesced/throttled frame ⇒ `ink_render_count` ≠ `stdout_write_calls`.

## Impl (pseudocode 05 lines 10-74)
- `client_prepare_ms`/`client_finalize_ms` via `performance.now()` deltas;
  `stream_handler_ms` Σ sync delta CPU; `ink_render_ms`/`ink_render_count` from
  onRender; stdout fields from the observer; provider/tool sums+unions via
  IntervalUnion; `unclassified_elapsed_ms` honest residual (provider/tool NOT
  subtracted); `concurrent_instances` passed in from finalisation (D3); memory
  columns omitted when disabled (delegated to P10). **D1:** no `capAndCount` /
  prompt/turn-id arrays — `operation_id` is the sole join key.

## Verify
- [ ] AC-5 evidenced; AC-6 (render/write) evidenced.
- [ ] No subtraction-based phase; unclassified never clamped.
- [ ] typecheck/lint clean.
