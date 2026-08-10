# Pseudocode 07 — Memory trend (in scope, one PR; zero new timers)

Plan ID: PLAN-20260808-PERFTREND
Applies to: `packages/cli/src/ui/hooks/useMemoryMonitor.ts` (extend), PerfSink,
PerfOperationRecord memory columns, `/perf` live view.

**Settled (§7):** two slopes (per-operation + per-minute) separate legitimate
growth (tracks work) from a leak (tracks uptime — the #3114 signature). Slopes
are DERIVED at read time, never stored. Zero new timers — extend the existing
60 s monitor. Two defects in it are fixed. Memory is independently disableable.

```
10:  // --- existing monitor: useMemoryMonitor.ts ---
11:  // MEMORY_CHECK_INTERVAL_MS = 60_000 (unchanged cadence)
12:  // DEFECT 1 (line ~warning branch): clearInterval(intervalId) after warning
13:  //   once ⇒ it stops monitoring exactly when memory is known bad.
14:  // FIX: separate the warn-once latch from the sampling loop. The interval
15:  //   keeps running; the latch only suppresses duplicate WARNINGS.
16:
17:  let warnedOnce = false
18:  FUNCTION on60sTick():
19:    sample = process.memoryUsage()      // { rss, heapUsed, external, arrayBuffers }
20:    IF sample.rss >= RSS_WARN_THRESHOLD AND NOT warnedOnce:
21:      warnOnce()                        // UI warning (existing behaviour)
22:      warnedOnce = true
23:    END
24:    // sampling continues regardless of the latch:
25:    pushToMemoryRing(sample)            // line 30 — bounded ring (defect 2 fix)
26:    IF perfEnabled AND memoryEnabled:
27:      emitMemorySample(sample)          // line 40
28:    END
29:  END
30:
31:  // --- DEFECT 2: live view needs a bounded ring, not a growing array ---
32:  CLASS MemoryRing:
33:    private buf: MemorySample[]         // FIXED CAPACITY (overwrite oldest)
34:    private head: number = 0
35:    private len: number = 0
36:  METHOD push(s):
37:    buf[head] = s; head = (head+1) % CAPACITY; len = min(len+1, CAPACITY)
38:  END
39:  METHOD snapshot(): MemorySample[]   // ordered oldest→newest
40:  END
41:  // the leak detector must not leak.
42:
50:  // --- memory_sample record (record_type discriminator earns its keep) ---
51:  FUNCTION emitMemorySample(sample):
52:    sink.write({
53:      record_type: "memory_sample", schema_version: PERF_SCHEMA_VERSION,
54:      ts: new Date().toISOString(),
55:      rss_bytes: sample.rss, heap_used_bytes: sample.heapUsed,
56:      external_bytes: sample.external, array_buffers_bytes: sample.arrayBuffers,
57:      uptime_ms: performance.now(),
58:      ms_since_last_operation: performance.now() - lastOperationEndMs,
59:    })
60:  END
61:  // ms_since_last_operation makes an IDLE sample identifiable — idle samples
62:  // are the ones that expose the #3114 "tracks uptime" leak signature.
63:
70:  // --- memory columns on the operation record (per-operation axis) ---
71:  // Present IFF perfEnabled AND memoryEnabled; OMITTED otherwise (never zeros).
72:  FUNCTION memoryColumns(op):
73:    s = process.memoryUsage()
74:    RETURN {
75:      rss_bytes: s.rss, heap_used_bytes: s.heapUsed,
76:      external_bytes: s.external, array_buffers_bytes: s.arrayBuffers,
77:    }
78:  END
79:  // sampled once at operation END; rides the record already being written
80:  // ⇒ the per-operation axis is FREE (no extra sampling).
81:
90:  // --- read-time slope derivation (never stored) ---
91:  // per-operation slope: regress memory columns on session_operation_index
92:  // per-minute slope:     regress on uptime_ms using memory_sample rows
93:  // a fix to the regression maths never requires re-collecting data.
```

**Anti-patterns (must NOT):**
- Add a new timer (line 11 reuses the 60 s interval).
- Piggyback Footer.tsx's 2 s interval (gated on showMemoryUsage + mounted ⇒
  would silently collect nothing).
- Store a computed slope (lines 90-93 derive at read time).
- Write zeros when memory disabled (line 72 omits the field).
- Let the ring grow unbounded (line 33 fixed-capacity overwrite).
- Stop the monitor after warning once (line 15 fix).
