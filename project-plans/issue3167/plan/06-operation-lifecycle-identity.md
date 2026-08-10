# Phase 06: Operation lifecycle registry + identity

Plan ID: PLAN-20260808-PERFTREND.P06
Prerequisites: P04, P09.
Package: `cli`. @pseudocode: `04-operation-lifecycle.md` lines 10-66,
`01-schema-and-reader.md` lines 60-66 + 104-115.

> **Decisions applied (D1/D3):** the registry collects **no** child prompt/turn
> ids (D1 — they do not arrive via `AgentEvent`); `operation_id` is the sole join
> key. `concurrent_instances` is derived from non-stale claim files at
> finalization (D3).

## Stub
- `OperationLifecycleRegistry`: `begin`/`finalise` throw NotYetImplemented or
  return typed handles. (No `observePromptId` — child ids are not collected.)

## Integration TDD (Bun, real behaviour)
- `operationLifecycle.behavior.test.ts` (EVIDENCE-AC3, AC4):
  - EVIDENCE-AC3: a real continuation stream through the recorder; for initial id
    `S#agentic-loop#U` and continuations `…#continuation#1/2`, assert
    `deriveOperationId(c) === S#agentic-loop#U` for every observed child id; assert
    the produced record carries **no** `prompt_ids`/`turn_ids` fields (D1); assert
    `concurrent_instances` reflects non-stale claims (D3).
  - EVIDENCE-AC3 read-time join: N continuation token-usage rows each derive to the
    same `operation_id` and join to the single perf operation.
  - EVIDENCE-AC4: drive each terminal path (completed, error,
    cancelled_before_send, cancelled_during_api/tool/approval) through the
    integrated lifecycle (fixture provider + real AbortControllers); assert one
    record per path with the correct `status`.
  - **Superseded**: a newer turn replaces `abortControllerRef.current`; assert the
    displaced op is finalised as `superseded` exactly once despite
    `isCurrentTurn==false`.
  - Exactly-once: double-finalise is a no-op.
- `promptIdPrefixInvariant.behavior.test.ts` (EVIDENCE-AC3):
  - Assert `operation_id = promptId.split('#continuation#')[0]` for initial,
    continuation, and CLI-fallback (8-hash) ids. Extend, do not duplicate, the
    existing `agenticLoop.prompt-id.test.ts`.

## Impl (pseudocode 04 lines 10-66)
- Registry keyed by turn signal; `begin` derives operationId (pseudocode 01 lines
  60-66), snapshots identity; `finalise` derives `concurrent_instances` from
  non-stale claims (pseudocode 06), builds+writes the record exactly once.
- Superseded sweep: on a new `begin` that detects an already-displaced signal,
  finalise the displaced op as `superseded`.

## Verify
- [ ] AC-3, AC-4 evidenced; superseded explicitly covered.
- [ ] `packages/agents` untouched (no telemetry import added there).
- [ ] No mint+propagation; operation_id derived; no child-id arrays on the record.
- [ ] typecheck/lint clean.
