# Pseudocode 09 — End-to-end overhead harness (Bun, real integration)

Plan ID: PLAN-20260808-PERFTREND
Applies to: `packages/cli` test (Bun/bun:test), exercising the REAL integration.

**Settled (PLAN §"Measured facts" withdrawal):** no overhead claim ships until a
real end-to-end measurement exists, enabled and disabled, under streaming load,
reporting p50/p95/p99 event-loop impact — **without asserting unstable wall-clock
thresholds.**

```
10:  // The harness exercises the ACTUAL integrated pipeline (NOT mocks):
11:  //   real PerfSink (tmpdir) + real stdout observer + real Ink onRender path
12:  //   + real operation lifecycle registry + a fixture streaming provider.
13:  //
14:  // It runs the SAME code paths a user runs, twice: perf ENABLED and DISABLED.
15:
20:  FUNCTION runOverheadHarness(scenario):
21:    // scenario drives N streaming turns through the integrated recorder with
22:    // a fixture provider that emits a deterministic delta stream (no network).
23:    samplesEnabled  = measure(scenario, perfEnabled=true)
24:    samplesDisabled = measure(scenario, perfEnabled=false)
25:    RETURN {
26:      enabled:  percentiles(samplesEnabled),   // p50/p95/p99 of per-op overhead
27:      disabled: percentiles(samplesDisabled),
28:      delta:    compare(enabled, disabled),
29:    }
30:  END
31:
32:  FUNCTION measure(scenario, perfEnabled):
33:    set resolvePerf to {enabled: perfEnabled}
34:    perOpOverheads = []
35:    FOR i in 0..N:
36:      t0 = performance.now()
37:      await scenario.runOneTurn()              // real integrated recorder path
38:      perOpOverheads.push(performance.now() - t0 - scenario.baselineCpuMs)
39:    END
40:    RETURN perOpOverheads
41:  END
42:
43:  // --- ASSERTION POLICY (critical) ---
44:  // The harness REPORTS p50/p95/p99 and the enabled-vs-disabled delta.
45:  // It does NOT assert a wall-clock threshold (those are CI-flaky and
46:  // machine-dependent). Instead it asserts STABLE INVARIANTS:
47:  ASSERT(perfDisabled ⇒ no perf file created)              // default-off no files
48:  ASSERT(perfEnabled  ⇒ record count == operation count)   // every op recorded
48:  ASSERT(perfDisabled ⇒ overhead delta is within noise band)// not measurably costly
49:  // The quantitative p50/p95/p99 are PRINTED as evidence, not gated.
50:  END
51:
60:  // --- observer-effect evidence: enabled path must not perturb disabled path ---
61:  // The disabled path short-circuits at resolvePerf (line 16/19 of pseudocode 08):
62:  //   no sink construction, no observer install, no ring, no onRender wiring.
63:  // The harness proves the disabled path produces ZERO side-effects (no files,
64:  // no appended listeners) — the architectural guarantee, not a timing number.
```

**Anti-patterns (must NOT):**
- Mock the recorder/sink/observer (must exercise the real integration).
- Assert a fixed µs threshold (line 49 prints, never gates).
- Omit the disabled-path measurement (line 24 is the control).
- Run only the idle heap (the cost-relevance is under load — §7.3).
- Count wall time without subtracting the fixture baseline (line 38).
