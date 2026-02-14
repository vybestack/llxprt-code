# P16 Audit: Session Cleanup TDD
## Plan Requirements
The plan requires coverage for:
- **REQ-CLN-001**: scan `session-*.jsonl` only, include empty/missing dir behavior, and header extraction.
- **REQ-CLN-002**: lock-aware protection (`skip` for active lock, `delete` for unlocked).
- **REQ-CLN-003**: stale lock handling semantics (stale lock should not itself force data deletion; addendum cases for recent vs old sessions and property test asserting within-retention safety).
- **REQ-CLN-004**: orphan/stale lock cleanup and correct cleanup counts.
- Behavioral suite target: 13+ tests; property-based target: 6+ (30%+).
- No mock theater; real FS temp dirs and on-disk assertions.

## What Was Actually Done
`packages/core/src/recording/sessionCleanupUtils.test.ts` includes:
- **Comprehensive behavioral coverage** for scan, filtering, empty/missing dirs, session header extraction, active/unlocked/stale lock disposition, orphan/stale cleanup, and cleanup counts.
- **Addendum intent coverage** is present in spirit: stale locks return `stale-lock-only`, with explicit assertions that stale status does not directly imply delete.
- **Extensive property-based coverage** (12 property tests), well above minimum.
- **Real filesystem testing** throughout (mkdtemp, real files, real lock sidecars, existsSync checks).
- Plan/requirement tags are present at file/suite/test descriptions.

## Gaps / Divergences
1. **File path divergence from plan verification text**
   - Plan examples/verification commands reference `packages/cli/src/utils/sessionCleanup.test.ts`.
   - Actual test is in `packages/core/src/recording/sessionCleanupUtils.test.ts`.
   - This is likely acceptable if implementation moved to core, but it diverges from plan’s explicit file-path checks.

2. **REQ-CLN-003 wording mismatch vs addendum case 24**
   - Addendum case 24 in plan says old session + stale lock should lead to both lock and session deletion during cleanup (deletion attributed to retention policy).
   - Actual tests for old stale sessions assert `shouldDeleteSession(...) === 'stale-lock-only'` and do **not** exercise an integrated retention cleanup flow deleting old data file.
   - The suite tests lock-layer semantics strongly, but not the end-to-end old-session deletion path described in addendum wording.

3. **One count assertion less strict than plan phrasing**
   - Behavioral test for orphan cleanup uses `toBeGreaterThanOrEqual(1)` rather than exact `1` for a single orphan case.
   - Another test does assert exact count `3`, so count correctness is still covered; this is a minor strictness gap for that specific scenario.

## Severity
- **Overall severity: Medium-Low**
  - Core behaviors are well covered and quality is high.
  - Main risk is interpretation drift around addendum case 24 (lock-layer vs retention-layer integration), not missing base cleanup behaviors.

## Summary Verdict
**Mostly Pass (with noted divergence).**
The test file substantially covers the Phase 16 requirements, exceeds property-based targets, and follows no-mock real-FS TDD discipline. The primary divergence is that addendum old-session behavior is validated only at lock-status function level, not as an integrated retention-driven deletion flow; plus a minor path/strictness mismatch versus plan text.