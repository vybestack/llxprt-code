# Pseudocode 06 — Directory retention (eventual bound, live-writer safe)

Plan ID: PLAN-20260808-PERFTREND
Applies to: `packages/telemetry/src/perf/retention.ts` (new), triggered by PerfSink.

**Settled (§6, REQ-3167-6):** eventual bound with documented overshoot + live-writer
safety — NOT an instantaneous no-loss cap. Shape reused from
`errorReporting.rotateReports()` but NOT its weaker guarantees (it protects only
in-process paths and decrements accounting even when unlink fails).

```
10:  // --- maintenance triggers: roll boundary + coarse interval (not startup-only) ---
11:  METHOD maybeMaintain(now: number):
12:    IF now - lastMaintenanceMs < MAINTENANCE_INTERVAL_MS RETURN
13:    lastMaintenanceMs = now
14:    maintain(now)
15:  END
16:  // called from PerfSink.rollToNewFile (pseudocode 02 line 68) AND on the
17:  // coarse interval so a 24/7 process (never restarts) still bounds growth.
18:  // The SAME interval touches this run's claim file (D3) — one owned timer,
19:  // no drift-probe timer, no extra memory timer.
20:
21:  // --- D3: per-run claim file (concurrent_instances accounting) ---
22:  FUNCTION createClaim(dir, runUuid):   // on perf enable
23:    writeExclusive(join(dir, `${runUuid}.claim`), "", "wx", 0o600)
24:  END
25:  FUNCTION touchClaim(dir, runUuid):    // by the maintenance interval
26:    utimes(join(dir, `${runUuid}.claim`), now, now)   // best-effort; fail-open
27:  END
28:  FUNCTION countNonStaleClaims(dir, now): number   // ⇒ concurrent_instances
29:    claims = readdir(dir).filter(name => name.endsWith(".claim"))
30:    RETURN claims.filter(c => (now - stat(c).mtimeMs) <= CLAIM_LEASE_MS).length
31:  END
32:  // Lease-window semantics: a value counts a run as concurrent while its claim
33:  // is fresh. A crashed run leaves a stale claim until the next sweep, so the
34:  // count is a lease-window estimate with BOUNDED crash overshoot. Claim files
35:  // are included in artifact accounting (below) but never parsed as JSONL.

40:  FUNCTION maintain(now: number):
41:    files = readdirSortedByMtime(dir)           // perf-*.jsonl AND *.claim
42:    totalBytes = 0
43:    FOR EACH f in files: totalBytes += stat(f).size   // claims counted, not parsed
44:    IF files.length <= maxFiles AND totalBytes <= maxBytes: RETURN
45:
46:    // evict oldest-first until BOTH caps satisfied
47:    FOR EACH f in files (oldest first):
48:      IF filesLeft <= maxFiles AND bytesLeft <= maxBytes: BREAK
49:      IF isLiveWriter(f, now): CONTINUE          // skip — see lines 62-70
50:      TRY:
51:        await unlink(f)
52:        bytesLeft -= stat(f).size                // decrement ONLY on success
53:        filesLeft -= 1
54:      CATCH err:
55:        // do NOT decrement accounting on failure (rotateReports' defect)
56:        logRateLimited(`perf retention unlink failed: ${err.code}`)
57:      END
58:    END
59:  END
60:
61:  // --- live-writer claim (no lock; pure function of filename + one stat) ---
62:  FUNCTION isLiveWriter(file, now): boolean
63:    dayKey = parseDayKeyFromName(file)           // perf-<YYYYMMDD>-...
64:    IF dayKey != todayUtcDayKey(now): RETURN false   // not today ⇒ not live
65:    mtime = stat(file).mtimeMs
66:    IF (now - mtime) <= MAINTENANCE_INTERVAL_MS: RETURN true  // within window
67:    RETURN false
68:  END
69:  // On a read-only/full volume unlink throws (line 54) ⇒ guarantee degrades
70:  // to "no further growth" (new files still bound by per-day segmentation).
71:  // The guarantee is eventual-with-overshoot, never instantaneous, and
72:  // explicitly permits active-day and claim overshoot (D5).
```

**Documented overshoot sources (acknowledged, not hidden; eventual bound
explicitly permits active-day and claim overshoot — D5):**
- Concurrent appends between scan and delete (line 41→51).
- N active live files / fresh claims can collectively exceed the dir cap
  (line 49 skips live files; fresh claims are not reaped).
- A crashed run leaves a stale claim until the next maintenance sweep
  (bounded crash overshoot — D3).
- A materially-future mtime (NTP step) delays eligibility until `mtime +
  interval` — a benign delay, not a correctness bug.

**Anti-patterns (must NOT):**
- Decrement accounting on unlink failure (line 52 only on success).
- Delete a file whose day-key is today AND mtime within window (line 66).
- Parse a `.claim` file as a JSONL record (claims are accounting-only — D3).
- Add a drift-probe timer or an extra memory timer (D3 reuses the one owned
  maintenance interval to touch claims).
- Assert zero loss + hard cap + no coordination simultaneously (impossible).
- Run only at startup (line 16: 24/7 process never restarts).
- Fill the real disk or rely on chmod to test failures (D6 — use a
  package-private filesystem port / failing file handle; real files for
  round-trip/concurrency).
