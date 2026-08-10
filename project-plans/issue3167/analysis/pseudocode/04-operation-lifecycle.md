# Pseudocode 04 — Operation lifecycle registry + identity collection

Plan ID: PLAN-20260808-PERFTREND
Applies to: `packages/cli/src/...` (OperationLifecycleRegistry), `useSubmitQuery.ts`.

**Settled (§3/§9, D1):** operation_id is DERIVED, not minted+propagated. The CLI
holds the initial prompt id (`turn.promptId`/`resolvedPromptId`) before
`runStream(...)`; `deriveOperationId` recovers grouping. Child prompt/turn ids are
**NOT collected** — they do not arrive via `AgentEvent`, so `operation_id` is the
sole join key and the report correlates at read time (pseudocode 01 lines
104-115). `concurrent_instances` is derived from claim files at finalization (D3).

```
10:  TYPE OperationStatus =
11:    "completed" | "error"
12:    | "cancelled_before_send" | "cancelled_during_api"
13:    | "cancelled_during_tool" | "cancelled_during_approval"
14:    | "superseded"
15:
16:  CLASS OperationLifecycleRegistry:
17:    private active: Map<AbortSignal, PendingOp>   // keyed by turn's signal
18:    private sink: PerfSink | null                  // null ⇒ perf disabled
19:    private finalised: WeakSet<AbortSignal>        // exactly-once guard
20:
21:  METHOD begin(turn): OperationHandle
22:    signal = turn.abortSignal
23:    op = new PendingOp({
24:      operationId: deriveOperationId(turn.promptId),  // pseudocode 01 lines 60-66
25:      sessionId, runtimeId, parentRuntimeId, subagentName, projectHash,
26:      startedAtMs: performance.now(),
27:      // D1: NO promptIds/turnIds sets — child ids not collected
28:      identity snapshotted from config/runtime/build,
29:      phases: { prepare, streamHandler, finalize },   // see pseudocode 05
30:      providerIntervals: IntervalUnion, toolIntervals: IntervalUnion,
31:      memory: sampled-at-end (optional),
32:    })
33:    active.set(signal, op)
34:    RETURN { signal, op }
35:  END
36:
37:  METHOD finalise(signal, status: OperationStatus):
38:    op = active.get(signal)
39:    IF op == null OR finalised.has(signal): RETURN   // exactly-once
40:    finalised.add(signal)
41:    active.delete(signal)
42:    IF sink == null: RETURN                           // disabled ⇒ no file
43:    concurrentInstances = countNonStaleClaims(dir, now)  // D3 — see pseudocode 06
44:    record = buildRecord(op, status, concurrentInstances) // pseudocode 05 lines 50-74
45:    sink.write(record)
46:  END
49:
50:  // --- wiring into useSubmitQuery (acquire ~:627, release ~:650-659) ---
51:  // acquire:  registry.begin(turn)                      -> handle
52:  // pre-send failure / no-send path:
53:  //   registry.finalise(signal, "cancelled_before_send" | "error")
54:  // during-API abort: registry.finalise(signal, "cancelled_during_api")
55:  // during-tool abort: registry.finalise(signal, "cancelled_during_tool")
56:  // approval reject:  registry.finalise(signal, "cancelled_during_approval")
57:  // normal completion: registry.finalise(signal, "completed")
58:  // error:            registry.finalise(signal, "error")
59:  // SUPERSEDED sweep: a newer turn replaces abortControllerRef.current;
60:  //   the older signal's guarded finally (isCurrentTurn==false) never runs,
61:  //   so when begin() detects an already-replaced signal on a NEW acquire,
62:  //   it finalises the displaced op as "superseded" exactly once (line 42 guard).
63:  //
64:  // queued submission drain: each drained submission begins its own op;
65:  //   a requeued-and-later-consumed submission finalises the prior op as
66:  //   appropriate before beginning the new one.
```

**Anti-patterns (must NOT):**
- Mint+propagate operation_id through `packages/agents` (line 24 derives it).
- Collect child prompt/turn ids (D1 — they do not arrive via AgentEvent; the
  record carries `operation_id` only).
- Hang finalisation off the ownership release alone (lines 59-62: superseded
  never reaches it).
- Finalise twice (line 39 guard).
- Block the UI thread on finalisation (line 45 is the sink's serialized chain).
