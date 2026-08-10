# Pseudocode 08 — Reader/consumer + /perf command + settings

Plan ID: PLAN-20260808-PERFTREND
Applies to: `packages/telemetry/src/perf/perfReader.ts`, cli report command,
`/perf` slash command, `TelemetrySettings` + `resolveTelemetrySettings`.

**Settled (§9):** plain records only (NO gzip); contamination via
`concurrent_instances` (NO contended). Privacy-first: opt-in/default-off,
inspectable, deletable.

```
10:  // --- settings (REQ-3167-8, D2): nested shape, both default false ---
11:  INTERFACE TelemetrySettings:  // configTypes.ts — ADD:
12:    perf?: { enabled?: boolean; memory?: boolean }   // nested: telemetry.perf is NOT a boolean
13:  END
14:  // resolveTelemetrySettings() hierarchy (unchanged): CLI flags > env >
15:  // workspace .llxprt/settings.json > user settings > defaults (false).
16:  FUNCTION resolvePerf(settings): { enabled, memory }
17:    enabled = settings.telemetry?.perf?.enabled ?? false
18:    memory  = settings.telemetry?.perf?.memory ?? false
19:    IF not enabled: RETURN { enabled: false, memory: false }  // master gates memory
20:    RETURN { enabled: true, memory }
21:  END
22:  // D2: the persisted master is telemetry.perf.enabled (not telemetry.perf).
23:  // (spec §7.4 names the master `telemetry.perf`; the resolved persisted
24:  // contract is the nested shape — recorded here because spec is not rewritten.)
22:
30:  // --- streaming reader (cross-platform; works on Windows) ---
31:  FUNCTION* streamPerfRecords(dir):
32:    FOR EACH file in readdirSorted(dir):            // perf-*.jsonl
33:      FOR EACH r in readPerfLines(file):            // pseudocode 01 lines 88-102
34:        yield r                                     // null ⇒ caller counts skipped
35:      END
36:    END
37:  END
38:  // NO gzip. NO argument-limit breakage (streams one file at a time).
39:  // NO abort-on-malformed-line (parsePerfRecord returns null; count it).
40:
50:  // --- report (REQ-3167-9, D7): groups by version/commit within matched dims ---
51:  FUNCTION buildReport(dir, baseline?):
52:    counts = { total:0, skipped:0, truncated:0 }
53:    groups = Map<groupKey, Sample[]>                // groupKey = version|commit|dims
54:    FOR EACH r in streamPerfRecords(dir):
55:      IF r == null: counts.skipped++; CONTINUE
56:      IF r is truncated-tail sentinel: counts.truncated++; CONTINUE
57:      counts.total++
58:      groups.get(groupKeyOf(r)).push(measurementsOf(r))
59:    END
60:    // D7 baseline: --baseline accepts an exact llxprt_version or git_sha.
61:    //   • no baseline → grouped matched-dimension p50/sample/self-health, NO delta
62:    //   • with baseline → each non-baseline group is compared ONLY against
63:    //     baseline rows sharing provider/model/render_mode/terminal-geometry
64:    //     buckets; unmatched groups reported as unmatched, NEVER pooled.
65:    // matched-dimension comparison: p50 within (version,provider,model,
66:    // render_mode, terminal size); contaminated via concurrent_instances>=2
67:    // (NOT contended — excluded). /perf = current-process snapshot; report = longitudinal.
68:    RETURN { counts, groups, baselineDelta, selfHealth }
69:  END
70:  // D1 read-time join: token-usage/session rows are joined to a perf operation
71:  // by deriving operation_id from each row's prompt_id (pseudocode 01 lines
72:  // 104-115); multi-continuation rows join to one operation without child ids
73:  // on the perf record.
74:
75:  // self-health surfaced (NOT records_dropped — excluded):
76:  //   last write error, evictions, skipped/truncated counts.
68:
80:  // --- /perf slash command (SlashCommand convention; subcommands) ---
81:  perfCommand: SlashCommand = {
82:    name: "perf",
83:    subCommands: [
84:      // /perf            → snapshot of THIS process (live MemoryRing + current op)
85:      // /perf inspect    → where data lives, what fields, sample counts
86:      // /perf report     → longitudinal buildReport() output
87:      // /perf delete     → remove all perf files (with live-writer safety)
88:    ],
89:  }
90:  // registered in BuiltinCommandLoader alongside statsCommand/loggingCommand.
91:
88:  // --- inspect (REQ-3167-8, D7): path/schema/privacy/record counts ---
89:  FUNCTION perfInspect(): { dir, schemaVersion, privacy, fileCount, totalBytes,
90:                             operationCount, memorySampleCount }
91:
92:  // --- delete (REQ-3167-8, D3): remove files respecting live claims ---
93:  FUNCTION perfDelete(dir):
94:    FOR EACH f in (perf-*.jsonl AND *.claim):
95:      IF isLiveWriter(f, now): CONTINUE         // pseudocode 06 lines 62-68
96:      IF isFreshClaim(f, now): CONTINUE         // D3: respect live claims
97:      unlink(f)                                 // fail-open; count failures
98:   END
99: END
```

**Anti-patterns (must NOT):**
- gzip streams (excluded §9).
- `contended` exclusion (use concurrent_instances, line 67).
- `records_dropped` in self-health (excluded; use skipped/truncated, line 76).
- Pool unmatched baseline groups (D7 — report them as unmatched).
- Require child ids on the perf record to join (D1 — derive at read time).
- Treat `telemetry.perf` as a boolean (D2 — nested `.enabled`/`.memory`).
- Default-on telemetry (line 17 default false).
- Collect memory without the perf master (line 19 gates).
- `gzcat | jq -s` one-liner (not cross-platform, breaks on arg limits, aborts
  on malformed line — lines 31-39 stream and tolerate).
