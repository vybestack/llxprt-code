# Pseudocode 02 — PerfSink (reuses narrow FileOutput primitives; D4) + IntervalUnion extraction

Plan ID: PLAN-20260808-PERFTREND
Applies to: `packages/telemetry/src/debug/FileOutput.ts` (refactored), new
`packages/telemetry/src/perf/PerfSink.ts`, extracted
`packages/telemetry/src/telemetry/intervalUnion.ts`.

## Part A — IntervalUnion (extracted, incremental duration)

```
10:  CLASS IntervalUnion:
11:    private intervals: Array<[startMs, endMs]>  // sorted, non-overlapping
12:    private cachedDurationMs: number = 0         // maintained incrementally
13:
14:  METHOD add(startMs, endMs):
15:    IF endMs <= startMs RETURN                  // degenerate, ignore
16:    // find insert position; merge overlapping/adjacent neighbours
17:    // WHILE merging, SUBTRACT removed interval durations from cachedDurationMs
18:    // THEN ADD the merged span to cachedDurationMs
19:    inserted = mergeIntoSorted(intervals, startMs, endMs, ref cachedDurationMs)
20:  END
21:
22:  METHOD union(other): IntervalUnion
23:    result = new IntervalUnion()
24:    FOR EACH [s,e] in this.intervals: result.add(s,e)
25:    FOR EACH [s,e] in other.intervals: result.add(s,e)
26:    RETURN result
27:  END
28:
29:  METHOD durationMs(): number
30:    RETURN cachedDurationMs                      // O(1), no full re-walk
31:  END
32:
33:  METHOD count(): number
34:    RETURN intervals.length
35:  END
```
**Bug fixed (vs current private impl):** the current `add()` calls
`recomputeDuration()` walking every interval on each insert (O(n²) over a 24/7
session). Lines 12/17-18 maintain the total incrementally. `SessionMetricsAggregator`
is refactored to import this exported class.

## Part B — PerfSink (D4: reuses narrow FileOutput primitives; does NOT inherit)

**D4 (resolved):** PerfSink does **not** extend `FileOutput` and does **not**
inherit its bounded/drop queue, batch+interval flush, or singleton. Narrow
file/path/append primitives are extracted/reused where practical while
`FileOutput`'s public singleton/debug behaviour is preserved. PerfSink uses a
**serialized no-drop promise chain** (one record per operation; own back-pressure
⇒ no drop counter), **one exclusive-create day file per run UUID**, UTC roll on
the next record, **no gzip and no size sub-rolling**. Internal observer/programming
errors fail fast; only filesystem persistence/maintenance errors fail open and are
rate-limited.

```
50:  CLASS PerfSink:                       // CONSTRUCTIBLE — not singleton
51:    private dir: string                 // Storage.getGlobalLogDir() + "/perf"
52:    private runUuid: string             // per-run id
53:    private fileDayKey: string | null   // YYYYMMDD from last record ts (UTC)
54:    private currentPath: string | null
55:    private bytesSinceStat: number      // in-memory byte counter (stat once)
56:    private writeChain: Promise<void> = Promise.resolve()  // serialized, NO drop
57:    private lastDiagMs: number = 0      // rate-limit diagnostics
58:    private disposed: boolean = false
59:
60:  CONSTRUCT(dir, runUuid):
61:    this.dir = dir; this.runUuid = runUuid
62:  END
63:
64:  METHOD write(record):                 // returns a Promise; never drops
65:    IF disposed RETURN writeChain       // no-op after dispose
66:    dayKey = utcDayKey(record.ts)       // UTC day from record's own ts
67:    IF dayKey != fileDayKey OR currentPath == null:
68:      rollToNewFile(dayKey)             // UTC midnight-rollover on next record
69:    END
70:    payload = JSON.stringify(record) + "\n"
71:    // serialized no-drop promise chain — own back-pressure, NO bounded queue
72:    writeChain = writeChain
73:      .then(() => appendFile(currentPath, payload, { mode: 0o600 }))
74:      .then(() => { bytesSinceStat += Buffer.byteLength(payload) })  // in-mem count
75:      .catch(err => failOpenDiag(err))  // ONLY filesystem errors fail open
76:    RETURN writeChain
77:  END
78:
79:  PRIVATE METHOD rollToNewFile(dayKey):
80:    // ONE exclusive-create day file per run UUID (no seq, no size sub-roll)
81:    name = `perf-${dayKey}-${runUuid}.jsonl`
82:    path = join(dir, name)
83:    fd = openExclusive(path, "wx", mode 0o600)   // O_EXCL: no check-then-use
84:    currentPath = path
85:    bytesSinceStat = 0                          // new file ⇒ counter from zero
86:    fileDayKey = dayKey
87:  END
88:
89:  METHOD dispose():
90:    disposed = true
91:    await writeChain                          // drain the chain on clean exit
92:    removeClaimFile(runUuid)                   // D3: remove claim on clean dispose
93:  END
94:
95:  // --- fail-open + rate-limited diagnostics (§9/D4: NO retry-threshold machine,
96:  //     NO records_dropped counter) ---
97:  PRIVATE METHOD failOpenDiag(err):
98:    now = Date.now()
99:    IF now - lastDiagMs < DIAG_RATE_LIMIT_MS RETURN   // throttle
100:   lastDiagMs = now
101:   writeToStderrRateLimited(`perf telemetry write failed: ${err.code ?? err.message}`)
102:   // ONLY filesystem persistence errors are caught here. Internal observer /
103:   // programming errors are NOT caught — they propagate (fail fast, D8).
104: END
105:
106: // stat-once: FileOutput stats EVERY flush; PerfSink stats only at exclusive-open
107: // (line 84) and counts bytes in memory thereafter (line 74). No gzip, no size
108: // sub-rolling — UTC day-key roll is the only segmentation.
```

**Anti-patterns (must NOT):**
- Inherit/extend `FileOutput` (D4 — reuse narrow primitives only; preserve its
  public singleton/debug behaviour untouched).
- Carry over FileOutput's bounded queue / drop policy / batch+interval flush /
  per-flush stat (lines 56/72-74 serialize without dropping; line 74 counts in
  memory).
- A `records_dropped` counter or retry-threshold self-disable (excluded §9).
- `existsSync` check-then-create (line 83 uses exclusive `wx`).
- gzip or size sub-rolling (excluded §9 — UTC day-key only).
- Wrap internal observer/programming errors in try/catch (line 75 catches
  filesystem errors only; D8).
