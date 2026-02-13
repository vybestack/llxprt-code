# Phase 04: Core Types + Writer TDD

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P04`

## Prerequisites
- Required: Phase 03a completed
- Verification: `test -f project-plans/issue1361/.completed/P03a.md`

## Requirements Implemented (Expanded)

### REQ-REC-003.1: Synchronous Enqueue
**Full Text**: Enqueue is synchronous and non-blocking. Callers push events into an in-memory queue.
**Behavior**:
- GIVEN: An active SessionRecordingService
- WHEN: enqueue('content', contentPayload) is called
- THEN: The method returns synchronously (void) and the event is queued for writing
**Why This Matters**: Non-blocking enqueue ensures the conversation never pauses for I/O.

### REQ-REC-003.2: Background Writer
**Full Text**: Background writer drains queue and appends JSON lines to disk.
**Behavior**:
- GIVEN: Events have been enqueued
- WHEN: flush() is awaited
- THEN: All queued events are written as individual JSON lines to the file
**Why This Matters**: Background writing decouples conversation flow from disk I/O latency.

### REQ-REC-003.3: JSONL Format
**Full Text**: Each event is one JSON line terminated by newline.
**Behavior**:
- GIVEN: Multiple events are written
- WHEN: The file is read
- THEN: Each line is independently parseable as JSON with the envelope structure
**Why This Matters**: JSONL enables streaming replay and crash recovery (only last line can be corrupt).

### REQ-REC-004: Deferred Materialization
**Full Text**: File not created until first content event. session_start is buffered.
**Behavior**:
- GIVEN: SessionRecordingService is constructed
- WHEN: Only session_start and session_events are enqueued (no content)
- THEN: No file is created on disk
- AND WHEN: First content event is enqueued
- THEN: File is created with session_start as first line, then content as second
**Why This Matters**: Starting CLI and exiting without typing leaves no orphaned files.

### REQ-REC-005: Flush Guarantee
**Full Text**: flush() returns a Promise that resolves when all queued events are written.
**Behavior**:
- GIVEN: 5 events are enqueued
- WHEN: flush() is awaited
- THEN: All 5 events exist in the file
**Why This Matters**: Turn-boundary flush ensures durability before the next turn begins.

### REQ-REC-006: ENOSPC Handling
**Full Text**: Write failure with ENOSPC disables recording for session remainder.
**Behavior**:
- GIVEN: SessionRecordingService is recording
- WHEN: A write fails with ENOSPC error code
- THEN: isActive() returns false and subsequent enqueue() calls are no-ops
**Why This Matters**: Disk-full should degrade gracefully, not crash the session.

### REQ-REC-001.2: Monotonic Sequence
**Full Text**: Sequence numbers are monotonically increasing per session.
**Behavior**:
- GIVEN: Multiple events are recorded
- WHEN: The file is read
- THEN: Each line has a seq value strictly greater than the previous
**Why This Matters**: Monotonic sequence enables integrity checking and debugging.

## Implementation Tasks

### Files to Create
- `packages/core/src/recording/SessionRecordingService.test.ts`
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P04`
  - MUST include: `@requirement:REQ-REC-003` through `@requirement:REQ-REC-008`
  - All tests use REAL filesystem (os.tmpdir temp directories)
  - No mock theater — tests verify actual file contents

### Test Cases (BEHAVIORAL — expect REAL behavior)

1. **Enqueue + flush writes valid JSONL** — enqueue content, flush, read file, verify each line is valid JSON with envelope structure
2. **Each line independently parseable** — write 5 events, read file line-by-line, JSON.parse each
3. **Monotonic sequence numbers** — write 5 events, verify seq is 1,2,3,4,5
4. **Deferred materialization: no file without content** — construct, enqueue session_start only, dispose → no file on disk
5. **Deferred materialization: file created on first content** — enqueue session_start, then content → file exists with session_start as line 1
6. **Buffered events written in order** — enqueue session_start, session_event, provider_switch, then content → file has all 4 in correct order
7. **Flush resolves after all events written** — enqueue 10 events, await flush, count lines in file → 10 lines
8. **Flush on empty queue** — flush without enqueue → resolves immediately, no error
9. **ENOSPC disables recording** — mock fs to throw ENOSPC, verify isActive() becomes false
10. **ENOSPC: subsequent enqueue is no-op** — after ENOSPC, enqueue more events → no additional writes
11. **isActive() starts true, false after ENOSPC** — verify state transitions
12. **getFilePath() null before materialization, path after** — verify deferred path
13. **getSessionId() returns constructor arg** — basic accessor test
14. **initializeForResume sets correct state** — call initializeForResume, verify filePath and seq continuing
15. **dispose stops all activity** — dispose, then enqueue → no writes

### Property-Based Tests (30%+ of total — minimum 7 property tests)

16. **Any valid IContent can be enqueued and round-trips through JSONL** — fc.record for IContent shape, enqueue, flush, read file, parse, verify content matches
17. **Sequence numbers are always monotonic regardless of enqueue pattern** — fc.array of event types, verify seq monotonic
18. **Multiple flush calls are idempotent** — fc.integer for number of flushes after N enqueues, verify file has exactly N+buffered lines
19. **Session ID is always present in session_start payload** — fc.uuid for session IDs, verify first line always has matching sessionId
20. **Any number of enqueued events produces matching line count in file** — fc.nat(1-50) for event count, enqueue that many content events, flush, verify file has N+1 lines (session_start + N)
21. **Timestamps are always valid ISO-8601 in any event** — fc.nat(1-20) for event count, flush, read all lines, verify each has valid ISO-8601 `ts` field
22. **Envelope structure is consistent regardless of event type** — fc.oneof all 7 event types, enqueue each, flush, verify every line has v, seq, ts, type, payload fields

### FORBIDDEN Patterns
- `expect(mockFs.appendFile).toHaveBeenCalled()` — NO mock theater
- `expect(() => service.enqueue()).not.toThrow()` — NO reverse testing
- `expect(service).toHaveProperty('queue')` — NO structure-only testing

### Note on ENOSPC Tests
Note: Mocking fs to simulate ENOSPC is NOT "mock theater." The test asserts on the
service's behavioral response (recording disabled, enqueue becomes no-op), not on
whether the mock was called. Infrastructure mocking to trigger error paths is valid.

## Required Code Markers

Every test case MUST include:
```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P04
 * @requirement REQ-REC-003 (or appropriate REQ-REC-*)
 */
```

## Verification Commands

```bash
# Test file exists
test -f packages/core/src/recording/SessionRecordingService.test.ts

# Plan markers
grep -c "@plan:PLAN-20260211-SESSIONRECORDING.P04" packages/core/src/recording/SessionRecordingService.test.ts
# Expected: 15+

# No mock theater
grep -r "toHaveBeenCalled\|toHaveBeenCalledWith" packages/core/src/recording/SessionRecordingService.test.ts && echo "FAIL: Mock theater"

# No reverse testing
grep -r "toThrow.*NotYetImplemented\|not\.toThrow" packages/core/src/recording/SessionRecordingService.test.ts && echo "FAIL: Reverse testing"

# Property-based tests exist
grep -c "fc\.\|test\.prop\|property" packages/core/src/recording/SessionRecordingService.test.ts
# Expected: 7+ (30% of ~22 tests)

# Behavioral assertions present
grep -c "toBe\|toEqual\|toContain\|toMatch\|toHaveLength" packages/core/src/recording/SessionRecordingService.test.ts
# Expected: 15+

# Tests fail naturally (run but expect failures since impl is stub)
cd packages/core && npx vitest run src/recording/SessionRecordingService.test.ts 2>&1 | tail -5
# Expected: Test failures (not "cannot find module" errors)
```

### Semantic Verification Checklist
- [ ] Tests verify ACTUAL file contents (not mock calls)
- [ ] Tests use real temp directories (os.tmpdir)
- [ ] Each test has @requirement annotation
- [ ] Property-based tests use fast-check
- [ ] ENOSPC test mocks at the fs level, not the service level
- [ ] No test would pass with an empty implementation

## Success Criteria
- 15+ behavioral tests created
- 7+ property-based tests (30%+ of total = 7/22 = 31.8%)
- All tests tagged with plan/requirement markers
- Tests fail naturally against stub (not "NotYetImplemented" errors)
- No mock theater, no reverse testing

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/SessionRecordingService.test.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P04.md`


---

## Deferred Materialization Metadata Ordering Test (Architecture Review FIX 7)

### Additional Test Case

23. **Deferred materialization preserves exact enqueue order for buffered metadata events** —
    - GIVEN: A `SessionRecordingService` is constructed (deferred materialization enabled)
    - AND: `session_start` is buffered (enqueued but no file created)
    - AND: `provider_switch` is enqueued (provider: "openai", model: "gpt-5")
    - AND: `directories_changed` is enqueued (directories: ["/new/path"])
    - AND: first `content` event is enqueued (user message: "hello")
    - WHEN: The file is materialized (triggered by the first content event)
    - AND: `flush()` is awaited
    - THEN: The file contains exactly 4 lines in this order:
      1. Line 1: `session_start` event (seq=1)
      2. Line 2: `provider_switch` event (seq=2, provider="openai", model="gpt-5")
      3. Line 3: `directories_changed` event (seq=3, directories=["/new/path"])
      4. Line 4: `content` event (seq=4, user message "hello")
    - AND: All events have monotonically increasing sequence numbers (1, 2, 3, 4)
    - AND: All events have valid ISO-8601 timestamps
    - AND: The `session_start` event appears FIRST regardless of how many metadata events were buffered before materialization
    - `@requirement REQ-REC-004, REQ-REC-001.2`
    - `@plan PLAN-20260211-SESSIONRECORDING.P04`

### Why This Test Matters

This test catches a subtle ordering bug: if the deferred materialization implementation writes the `session_start` and then re-processes the buffer, it might accidentally reorder metadata events relative to when they were originally enqueued. The test ensures that the buffer is drained in strict FIFO order, with `session_start` always first, followed by any metadata events in their original enqueue order, followed by the triggering content event.

### Property-Based Extension

24. **Property: Any number of metadata events before first content preserves exact order** —
    - Use `fc.array(fc.oneof(fc.constant('provider_switch'), fc.constant('directories_changed'), fc.constant('session_event')), { minLength: 0, maxLength: 10 })` to generate a random sequence of metadata event types
    - Enqueue `session_start`, then the generated metadata events, then one `content` event
    - Flush and read the file
    - Verify: line 1 is always `session_start`, lines 2..N are the metadata events in exact generation order, last line is the `content` event
    - Verify: all seq values are strictly monotonically increasing (1, 2, ..., N+2)
    - `@requirement REQ-REC-004, REQ-REC-001.2`
    - `@plan PLAN-20260211-SESSIONRECORDING.P04`

