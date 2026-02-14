# P04 Audit: Core Types + Writer TDD

## Plan Requirements
1. Enqueue + flush writes valid JSONL (real filesystem, envelope verified)
2. Each line independently parseable as JSON
3. Monotonic sequence numbers (strictly increasing)
4. Deferred materialization: no file without content
5. Deferred materialization: file created on first content; session_start line 1
6. Buffered metadata events written in order before first content
7. Flush resolves after all events written
8. Flush on empty queue resolves without error
9. ENOSPC disables recording
10. ENOSPC: subsequent enqueue is no-op
11. isActive() starts true and becomes false after ENOSPC
12. getFilePath() null before materialization, path after
13. getSessionId() returns constructor arg
14. initializeForResume sets correct state and sequence continuation
15. dispose stops activity (enqueue after dispose no writes)
16. Property: any valid IContent round-trips
17. Property: sequence monotonic under varied enqueue patterns
18. Property: repeated flush idempotent
19. Property: session_start payload contains matching sessionId
20. Property: N enqueued events => expected line count
21. Property: timestamps valid ISO-8601
22. Property: envelope structure consistent across event types
23. Deferred materialization ordering fix: exact order session_start -> provider_switch -> directories_changed -> content, with seq/timestamp checks
24. Property: arbitrary metadata sequence before first content preserves exact order

## What Was Actually Done
- **1 Exists** — `enqueue + flush writes valid JSONL to disk` (line ~117)
- **2 Exists** — `each line in JSONL file is independently parseable as JSON` (line ~152)
- **3 Exists** — `events have strictly monotonically increasing sequence numbers` (line ~224)
- **4 Exists** — `no file is created when only session_start is enqueued (no content)` (line ~303)
- **5 Exists** — `file materializes on first content event with session_start as line 1` (line ~323)
- **6 Exists** — `metadata events buffered before content are written in enqueue order` (line ~351)
- **7 Exists** — `flush resolves after all queued events are written to disk` (line ~184)
- **8 Exists** — `flush on empty queue resolves immediately without error` (line ~202)
- **9 Partial** — test named `ENOSPC write failure disables recording...` (line ~430) but implementation simulates permission error via `chmod 444` and comments say `EACCES/ENOSPC path`; not an explicit ENOSPC injection
- **10 Exists (behaviorally)** — `subsequent enqueue calls are no-ops after ENOSPC` (line ~468), though same EACCES-vs-ENOSPC caveat
- **11 Partial** — `isActive() starts true...` exists (line ~513) and false-after-write-failure asserted in line ~430 test, but not strictly tied to true ENOSPC
- **12 Exists** — `getFilePath() is null before materialization, returns path after` (line ~397)
- **13 Exists** — `getSessionId() returns the session ID...` (line ~533)
- **14 Exists** — `resumes with correct filePath and sequence continuing from lastSeq` (line ~553)
- **15 Exists** — `dispose stops recording: enqueue after dispose writes nothing` (line ~614)
- **16 Exists (property)** — `any valid IContent round-trips...` (line ~717)
- **17 Exists (property)** — `sequence numbers are always strictly monotonic...` (line ~775)
- **18 Exists (property)** — `multiple flush calls produce same file content...` (line ~848)
- **19 Exists (property)** — `session_start payload always contains matching sessionId...` (line ~898)
- **20 Exists (property)** — `N content events produce exactly N+1 lines...` (line ~942)
- **21 Exists (property)** — `all events have valid ISO-8601 timestamps...` (line ~984)
- **22 Exists (property)** — `every event has consistent envelope...` (line ~1034)
- **23 Exists** — `deferred materialization preserves exact enqueue order for buffered metadata` (line ~689)
- **24 Exists (property)** — `any metadata events before first content are written in exact enqueue order` (line ~1130)

Additional observations:
- Test file includes substantial extra tests beyond plan (schema version, payload shape tests, resume duplicate session_start test, bonus property test).
- Required markers are present globally and per-test naming/annotations are broadly present.

## Gaps / Divergences
1. **ENOSPC specificity divergence**: Plan requested ENOSPC handling tests; implementation uses file permission change (`chmod`) causing likely `EACCES`, then treats it as ENOSPC-equivalent path. This validates graceful write-failure handling but not ENOSPC-specific behavior.
2. **Requirement tag mismatch vs plan text**: file header lists `REQ-REC-003..008` and test suite also references `REQ-REC-001/002` in places. Not harmful behaviorally, but plan asked explicit requirement coverage through REQ-REC-008 with per-test requirement marker discipline.
3. **Property-test percentage**: Exceeds requirement. Found 9 required/plan-aligned property tests plus 1 bonus (10 total). With ~30 tests total, property share is ~33%.
4. **Mock theater / reverse testing**: No clear mock-theater assertions (`toHaveBeenCalled*`) and no reverse-testing anti-pattern (`not.toThrow` as primary validation). Assertions are primarily on file contents and service state.

## Severity
- ENOSPC specificity divergence: **MODERATE**
- Requirement tag mismatch/expansion noise: **MINOR**
- Property-test percentage: **NONE** (meets/exceeds)
- Mock theater / reverse testing: **NONE**

## Summary Verdict
**PARTIAL**

The test file is comprehensive and behavior-first, covering virtually all planned behaviors including deferred ordering/property extensions. The main gap is that ENOSPC tests do not explicitly induce ENOSPC and may only verify generic write-failure (EACCES) behavior.