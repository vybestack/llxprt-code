# Pseudocode 05 — Directly measured client phases + record assembly

Plan ID: PLAN-20260808-PERFTREND
Applies to: cli operation recorder; Ink `onRender`; stdout observer (pseudocode 03).

**Core principle (§1.6, REQ-3167-1):** client phases are DIRECTLY measured;
`unclassified_elapsed_ms` is the honest residual, never clamped, never "llxprt time".

```
10:  // --- measurement fields (all directly measured, additive among themselves) ---
11:  client_prepare_ms        // performance.now() delta: submit acquire → first send
12:  stream_handler_ms        // Σ synchronous CPU inside delta handling
13:  ink_render_ms            // Σ from Ink onRender (Ink computes it; pure accumulate)
14:  ink_render_count         // count of onRender callbacks (render passes)
15:  stdout_bytes             // Σ encoded bytes from stdout observer
16:  stdout_write_calls       // count of write invocations from observer
17:  stdout_write_sync_ms     // Σ sync invocation duration from observer
18:  client_finalize_ms       // performance.now() delta: last send → finalise
19:
20:  // --- Ink onRender wiring (REQ-3167-4) ---
21:  // VERIFIED against installed @jrichman/ink@6.4.8: RenderMetrics = { renderTime: number }
22:  // (Ink computes performance.now() delta around the render computation).
23:  // The pseudocode's earlier "renderDurationMs" name is corrected to "renderTime".
24:  FUNCTION onRender(metrics: RenderMetrics):
25:    op.ink_render_ms += metrics.renderTime   // Ink's own clock (renderTime)
26:    op.ink_render_count += 1
27:  END
25:  // installed on the interactive Ink render options, per-operation accumulate.
26:  // Writes and renders are DISTINCT: one write != one frame (Ink throttles/coalesces).
27:
28:  // --- stream handler accumulation ---
29:  FUNCTION onDeltaProcessed(syncCpuMs):
30:    op.stream_handler_ms += syncCpuMs
31:  END
32:
40:  // --- provider/tool: sum + union (overlapping, NOT additive with client phases) ---
41:  provider_attempts, tool_calls: counters
42:  provider_attempt_sum_ms = Σ attempt durations
43:  tool_call_sum_ms        = Σ tool durations
44:  provider_union_ms       = providerIntervals.durationMs()  // IntervalUnion
45:  tool_union_ms           = toolIntervals.durationMs()
46:  agent_activity_union_ms = providerIntervals.union(toolIntervals).durationMs()
47:
50:  // --- record assembly at finalise (REQ-3167-1/-2/-4) ---
51:  FUNCTION buildRecord(op, status, concurrentInstances):
52:    elapsedMs = op.startedAtMs → performance.now()
53:    unclassified = elapsedMs
54:      - client_prepare_ms - stream_handler_ms - ink_render_ms
55:      - stdout_write_sync_ms - client_finalize_ms
56:      - approval_wait_ms
57:      // provider/tool unions are OVERLAPPING with client phases (work happens
58:      // inside them), so they are NOT subtracted. unclassified may be small
59:      // or large; report it HONESTLY, never clamp, never zero.
60:    RETURN PerfOperationRecord({
61:      ...envelope, ...identity(op.operationId), ...build,
62:      ...dimensions(concurrentInstances),   // incl. concurrent_instances (D3)
63:      status,
64:      client_prepare_ms, stream_handler_ms, ink_render_ms, ink_render_count,
65:      stdout_bytes, stdout_write_calls, stdout_write_sync_ms, client_finalize_ms,
66:      provider_attempts, provider_attempt_sum_ms, provider_union_ms,
67:      tool_calls, tool_call_sum_ms, tool_union_ms, agent_activity_union_ms,
68:      operation_elapsed_ms: elapsedMs, approval_wait_ms,
69:      unclassified_elapsed_ms: unclassified,
70:      // D1: NO prompt_ids/turn_ids here — operation_id is the sole join key.
71:      ...(memoryEnabled ? memoryColumns(op) : {}),  // OMIT when disabled
72:      session_operation_index, uptime_ms,
73:    })
74:  END
```

**Anti-patterns (must NOT):**
- Compute any client phase as `elapsed − provider − tool` (the rev.1 error).
- Subtract provider/tool unions from elapsed (lines 57-59: overlapping).
- Clamp `unclassified_elapsed_ms` (line 59).
- Write zeros for memory when disabled (line 71 omits the field).
- Use Ink render count as a proxy for stdout writes (distinct — lines 14/16).
