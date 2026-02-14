# Phase 13: Recording Integration TDD

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P13`

## Prerequisites
- Required: Phase 12a completed
- Verification: `test -f project-plans/issue1361/.completed/P12a.md`
- Phase 05a completed (writer works)
- Phase 07/08 completed (replay works — needed for round-trip verification)

## Requirements Implemented (Expanded)

### REQ-INT-001: HistoryService Event Subscription
**Full Text**: RecordingIntegration subscribes to HistoryService events (contentAdded, compressionStarted, compressionEnded) and delegates to SessionRecordingService.
**Behavior**:
- GIVEN: A RecordingIntegration is subscribed to a HistoryService
- WHEN: content is added to HistoryService
- THEN: SessionRecordingService.recordContent() is called with that content

### REQ-INT-002: Compression-Aware Content Filtering
**Full Text**: During compression (between compressionStarted and compressionEnded), contentAdded events are suppressed. On compressionEnded, a compressed event is recorded.
**Behavior**:
- GIVEN: RecordingIntegration is subscribed to HistoryService
- WHEN: compressionStarted fires, then contentAdded fires (the re-added post-compression items), then compressionEnded fires
- THEN: The re-add content events are NOT recorded; a single compressed event IS recorded

### REQ-INT-003: Delegate Methods
**Full Text**: RecordingIntegration delegates provider_switch, directories_changed, and session_event to SessionRecordingService.
**Behavior**: Calling recordProviderSwitch/recordDirectoriesChanged/recordSessionEvent on the integration delegates to the underlying service.

### REQ-INT-004: Turn Boundary Flush
**Full Text**: flushAtTurnBoundary() awaits the recording service flush.
**Behavior**: After calling flushAtTurnBoundary(), all prior events are durably written to disk.

### REQ-INT-005: Cleanup/Dispose
**Full Text**: dispose() unsubscribes all event listeners from HistoryService.
**Behavior**: After dispose(), HistoryService events no longer trigger recording.

### REQ-INT-006: HistoryService Instance Switch
**Full Text**: onHistoryServiceReplaced() unsubscribes from old, subscribes to new.
**Behavior**: After replacement, events on old instance are ignored; events on new instance are recorded.

### REQ-INT-007: Non-Interactive Flush
**Full Text**: Non-interactive mode flush guarantee — recording service is flushed in the `finally` block of `runNonInteractive()`.
**Behavior**:
- GIVEN: Non-interactive mode with recording enabled
- WHEN: The query completes (success or error)
- THEN: Recording service is flushed before process exit

## Implementation Tasks

### Files to Create
- `packages/core/src/recording/RecordingIntegration.test.ts`
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P13`

### Test Cases (BEHAVIORAL)

**All tests use REAL HistoryService instances and REAL SessionRecordingService instances writing to temp dirs. No mock theater.**

Testing Strategy: Use REAL HistoryService and REAL SessionRecordingService instances
writing to temp directories. Trigger events via real method calls (historyService.add()),
then assert by reading the JSONL file output. This validates the full event pipeline
without mock theater.

#### Core Event Subscription Tests

1. **Content added to HistoryService triggers recording** — add content via historyService.add() -> verify JSONL file contains content event
2. **Multiple content items recorded in order** — add 3 items -> JSONL has 3 content events with matching seq order
3. **Content with tool_call blocks recorded correctly** — add IContent with tool_call -> JSONL content event has tool_call blocks
4. **Content with tool_response blocks recorded correctly** — add IContent with tool_response -> JSONL preserves structure

#### Compression-Aware Content Filtering Tests

5. **Content during compression is NOT recorded** — fire compressionStarted, add content, fire compressionEnded -> JSONL has NO content events for the re-adds
6. **Compression ended emits compressed event** — fire compressionStarted, then compressionEnded with summary -> JSONL has compressed event
7. **Post-compression content IS recorded** — fire compressionStarted, compressionEnded, then add content -> JSONL has compressed event then content event
8. **Multiple compressions each emit compressed event** — two compression cycles -> two compressed events in JSONL

#### Compression Suppression Verification Tests

8a. **Compression suppression: re-added items not recorded** — GIVEN: compression is in progress (compressionStarted fired), WHEN: contentAdded fires for re-added items, THEN: no content events are enqueued for those re-adds. WHEN: compressionEnded fires, THEN: exactly one compressed event is enqueued with summary and itemsCompressed.
8b. **Compression suppression restored after compressionEnded** — GIVEN: compression has completed (compressionEnded fired), WHEN: new content is added (not a re-add), THEN: the content event IS recorded normally.

#### Delegate Method Tests

9. **recordProviderSwitch delegates to service** — call recordProviderSwitch("openai", "gpt-5") -> JSONL has provider_switch event
10. **recordDirectoriesChanged delegates to service** — call with new dirs -> JSONL has directories_changed event
11. **recordSessionEvent delegates to service** — call with message -> JSONL has session_event

#### Turn Boundary Flush Tests

12. **flushAtTurnBoundary writes pending events** — add content, call flush, read file -> content is in file
13. **flushAtTurnBoundary is awaitable** — verify it returns a Promise that resolves
14. **Flush after no activity is harmless** — call flush with no pending events -> no error

#### Cleanup/Dispose Tests

15. **dispose stops event recording** — dispose, then add content -> NO new events in JSONL
16. **dispose is idempotent** — call dispose twice -> no error
17. **After dispose, HistoryService events ignored** — add content after dispose -> JSONL unchanged

#### Instance Switch Tests

18. **onHistoryServiceReplaced switches subscription** — replace with new HS, add content to new -> recorded
19. **After replacement, old HistoryService events ignored** — replace, add to OLD -> not recorded
20. **Replacement with same instance is safe** — replace with identical instance -> still works

#### Round-Trip Verification Tests

21. **Recorded session replays correctly** — record a full session (session_start + content + provider_switch + content), flush, replay -> matches
22. **Recorded compression replays correctly** — record content, trigger compression, record more, flush, replay -> history has summary + post-compression
23. **Recorded rewind replays correctly** — record content, record rewind, flush, replay -> correct history length

#### Non-Interactive Flush Guarantee Tests

24. **Flush in finally block captures all content (success path)** — simulate successful non-interactive run with recording -> JSONL has all events
25. **Flush in finally block captures content on error** — simulate error during non-interactive run -> JSONL has events recorded before error
26. **Flush in finally block called before shutdown** — verify flush ordering relative to other cleanup

#### Flush Guarantee Tier Tests

27. **Tier 1 (controlled shutdown): flush is awaited** — initiate normal shutdown -> verify all pending events written, file integrity verified
28. **Tier 2 (signal path): flush is best-effort** — simulate SIGTERM -> verify flush attempt occurred (may not complete all events)
29. **Flush failure does not propagate to caller** — recording service throws during flush -> error is caught, process continues normally

#### Replay Telemetry Tests

30. **Replay result includes correct eventCount** — record N events, replay -> eventCount matches N
31. **Replay result includes correct lastSeq** — record events, replay -> lastSeq matches final seq
32. **Replay result metadata matches recorded state** — record with provider switch, replay -> metadata.provider matches last switch

#### Edge Case Tests

33. **Empty session (no content) produces NO file** — create recording, enqueue session_start, dispose without any content events -> NO file exists on disk (deferred materialization: file is not created until first content event per REQ-REC-004)
34. **Very large content recorded without truncation** — add large IContent, flush, replay -> content matches exactly
35. **Rapid content addition doesn't lose events** — add 100 items rapidly, flush, replay -> all 100 present
36. **Recording after flush continues to same file** — flush, add more content, flush -> all events in single file

### FORBIDDEN Patterns
- No mocking HistoryService — use real instances
- No mocking SessionRecordingService — use real instances writing to temp dirs
- No mocking filesystem — use real temp directories
- No testing for NotYetImplemented
- No toHaveBeenCalled assertions (no spy/mock verification)

## Verification Commands

```bash
# Test file exists
test -f packages/core/src/recording/RecordingIntegration.test.ts

# Count tests
TOTAL=$(grep -c "it(\|test(" packages/core/src/recording/RecordingIntegration.test.ts)
echo "Total: $TOTAL"
[ "$TOTAL" -lt 30 ] && echo "FAIL: Insufficient tests"

# No mock theater
grep -r "toHaveBeenCalled\|vi\.fn\|jest\.fn\|mock(" packages/core/src/recording/RecordingIntegration.test.ts && echo "FAIL: Mock theater detected"

# No reverse testing
grep -r "NotYetImplemented" packages/core/src/recording/RecordingIntegration.test.ts && echo "FAIL"

# Tests fail against stub
cd packages/core && npx vitest run src/recording/RecordingIntegration.test.ts 2>&1 | tail -5
```

## Success Criteria
- 36+ behavioral tests using real HistoryService and real SessionRecordingService
- Tests create real JSONL files in temp directories
- No mock/spy patterns
- Tests cover compression filtering, non-interactive flush, flush tiers, replay telemetry
- All tests fail against stub implementation

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/RecordingIntegration.test.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P13.md`
