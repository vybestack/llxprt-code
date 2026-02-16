# P19 Audit

## Plan Requirements
- Two files must exist and be scoped to P19:
  - `packages/core/src/recording/SessionDiscovery.test.ts`
  - `packages/core/src/recording/resumeSession.test.ts`
- Behavioral coverage targets from plan:
  - Discovery/resolve flows (list, sorting, metadata, exact/prefix/index resolution, ambiguity, not found)
  - Resume flows (`CONTINUE_LATEST`, specific ref, replay/history reconstruction, compressed history, metadata, error paths, locking paths, provider mismatch, append sequencing, replay warnings)
  - Addenda: numeric-vs-prefix precedence, exact-vs-prefix precedence, mtime tiebreaker + deterministic property variant
- Property-based coverage target:
  - Minimum 10 property tests (>=30% of total)
  - Specific properties listed in cases 24–33
- Constraints:
  - Real components (no mocks) and no reverse/stub tests
  - Plan/requirement markers on tests

## What Was Actually Done
- `SessionDiscovery.test.ts` includes:
  - Behavioral tests for listSessions (matching hash, sort newest-first, no match, missing dir, metadata extraction)
  - Behavioral tests for resolveSessionRef (exact, unique prefix, ambiguous prefix, numeric index, not found)
  - Addendum behaviors covered:
    - Numeric string treated as index over prefix
    - Exact ID precedence over prefix
    - Identical mtime tiebreaker by lexicographic descending sessionId
  - Additional `readSessionHeader` tests
  - 6 property tests (discovery count, exact match, ordering, non-matching hash, numeric index range, deterministic mtime tiebreaker)
- `resumeSession.test.ts` includes:
  - Behavioral tests for resume latest, resume by ID, replay/history reconstruction, compressed replay behavior, metadata, no sessions, specific not found, locked target, skip locked latest, all locked, provider switch recording, append seq monotonicity, replay warning passthrough
  - Additional behavioral check for returned recording service shape
  - 7 property tests (roundtrip content preservation, provider mismatch event, sequence monotonicity, recording non-null, compression length rule, plus extra success-for-any-count)
- Combined property tests: 13 total (6 + 7)
- Combined tests are well above the minimum behavioral count and include required plan/requirement annotations at file and test levels.

## Gaps
1. **REQ-RSM-005 warning assertion is incomplete**
   - Plan requires: provider mismatch should both (a) warn and (b) record `provider_switch`.
   - Tests assert event recording, but do **not** explicitly assert `result.warnings` contains a provider-mismatch warning in the dedicated mismatch test/property test.
2. **REQ-RSM-002 wording includes numeric index; requirement tagging mixed in discovery file**
   - Some `resolveSessionRef` tests are tagged REQ-RSM-003 (from addendum/context) though original requirement mapping in plan associates specific resume selection behavior with REQ-RSM-002.
   - Coverage behavior exists; this is mostly traceability/tagging inconsistency, not missing behavior.
3. **Addendum corollary not explicitly tested in resume suite**
   - Plan addendum corollary states `CONTINUE_LATEST` should pick lexicographically greater ID when mtime ties.
   - Discovery-level tiebreaker behavior is tested (including property determinism), but there is no explicit resume-level assertion for this exact corollary. Likely transitively covered but not directly asserted.

## Severity
- Gap 1 (missing provider mismatch warning assertion): **Medium**
- Gap 2 (requirement tag consistency): **Low**
- Gap 3 (resume corollary direct assertion absent): **Low**

## Summary Verdict
**Mostly complete with minor-to-moderate traceability/assertion gaps.**

The implemented tests strongly cover the P19 behavioral intent and exceed the property-based threshold. Core discovery and resume scenarios (including lock behavior, compression replay, and append sequencing) are present and realistic (no mock theater). The primary substantive miss is that provider mismatch tests verify `provider_switch` persistence but do not explicitly assert the expected mismatch warning in `result.warnings` per REQ-RSM-005 wording.