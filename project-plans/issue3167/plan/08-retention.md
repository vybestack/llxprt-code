# Phase 08: Retention (eventual bound, live-writer safe, claim files)

Plan ID: PLAN-20260808-PERFTREND.P08
Prerequisites: P04.
Package: `telemetry`. @pseudocode: `06-retention.md` lines 10-72.

> **Decisions applied (D3/D5/D6):** claim-file concurrency accounting (D3) reuses
> the one owned maintenance timer to touch claims and reap stale ones.
> **D5:** before implementing caps, P08 derives and documents **concrete**
> max-bytes/max-files/maintenance-interval/diagnostic-rate-limit defaults from the
> P04 Bun record-size benchmark and operational evidence — **no placeholders at
> implementation time**. The eventual bound explicitly permits active-day and
> claim overshoot. **D6:** unlink-failure tests use a package-private fs port, not
> chmod.

## Stub
- `packages/telemetry/src/perf/retention.ts`: `maybeMaintain`/`maintain`/
  `isLiveWriter`/`createClaim`/`touchClaim`/`countNonStaleClaims` throw/empty.

## Constants derivation (D5 — FIRST in this phase)
- From the P04 record-size benchmark + operational evidence, derive and record:
  `MAX_BYTES`, `MAX_FILES`, `MAINTENANCE_INTERVAL_MS`, `CLAIM_LEASE_MS`,
  `DIAG_RATE_LIMIT_MS`. Document that the eventual bound permits active-day and
  claim overshoot. No placeholders remain after this step.

## Integration TDD (Bun, REAL files — no vi.mock(fs))
- `retention.behavior.test.ts` (EVIDENCE-AC7):
  - **Live-writer safety**: a file with today's day-key and mtime within the
    maintenance window survives a sweep that evicts older files (assert present
    after `maintain`).
  - **24×7 convergence**: one continuously claimed run's old-day JSONL remains
    evictable while its current/recent JSONL and fresh claim survive; assert both
    the byte and artifact caps converge after `maintain`.
  - **24×7 trigger**: `maintain` runs on the coarse interval without restart;
    a roll boundary also triggers it; the same interval touches the claim file.
  - **Failed unlink (D6)**: inject the failure via a package-private fs port;
    accounting NOT decremented (total unchanged); older file still listed for next
    sweep; diagnostics rate-limited.
  - **Concurrency overshoot**: many writers appending between scan and delete ⇒
    documented overshoot, NOT an assertion of zero loss. Assert that after enough
    evictions the total eventually falls under the cap.
  - **Claim accounting (D3)**: `.claim` files count toward total bytes/files but
    are never parsed as JSONL; a fresh claim is not reaped; a stale claim is.
  - **Clock step**: materially-future mtime delays eligibility (benign).
- `retention.capSelection.behavior.test.ts`:
  - Under observed volume, assert which of (count cap, byte cap) binds.

## Impl (pseudocode 06 lines 10-72)
- Claim-file lifecycle: create on enable, touch by the maintenance interval,
  remove on clean dispose; count non-stale claims for `concurrent_instances`.
- Evict oldest-first until BOTH caps satisfied; skip live-writer files; decrement
  accounting ONLY on unlink success; rate-limit diagnostics; run on roll boundary
  + coarse interval. Claims counted in accounting but not parsed. A fresh claim
  protects the claim artifact, not that run's old-day JSONL; explicit delete's
  broader claim-to-JSONL protection is intentionally separate.

## Verify
- [x] Constants derived from the P04 benchmark (D5); no placeholders.
- [x] AC-7 evidenced; no instantaneous-cap assertion; live-writer never deleted.
- [x] Claim files counted but not parsed as JSONL (D3).
- [x] No `vi.mock('fs')`; real files + package-private port for fault injection (D6).
- [x] typecheck/lint clean.

Post-implementation convergence evidence: the telemetry perf suite passes 456
Bun tests, including a deterministic fixture where one continuously claimed
owner begins over both caps, loses five historical day files, and retains only
its current/recent live file plus its fresh claim.

## Note on REQ-3167-6
Guarantee is eventual-with-overshoot + live-writer safety (§6), explicitly NOT an
instantaneous no-loss cap, and explicitly permits active-day and claim overshoot.
`rotateReports()` shape reused; its weaker guarantees (in-process-only protection,
decrement-on-failure) NOT copied.
