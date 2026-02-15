# Phase 07: Replay Engine TDD

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P07`

## Prerequisites
- Required: Phase 06a completed
- Verification: `test -f project-plans/issue1361/.completed/P06a.md`
- Phase 05a completed (writer works — needed to create test files)

## Requirements Implemented (Expanded)

### REQ-RPL-002: Content Accumulation
**Full Text**: Replay reads each `content` event and accumulates IContent[] in order.
**Behavior**:
- GIVEN: A file with session_start + 3 content events (user, ai, user)
- WHEN: replaySession() is called
- THEN: result.history has 3 IContent items in correct order with correct speakers
**Why This Matters**: The accumulated history becomes the HistoryService seed on resume.

### REQ-RPL-003: Compression Handling
**Full Text**: A `compressed` event clears accumulated history and replaces it with the compression summary IContent.
**Behavior**:
- GIVEN: A file with 5 content events followed by a compressed event followed by 2 more content events
- WHEN: replaySession() is called
- THEN: result.history has 3 items (summary + 2 post-compression)
**Why This Matters**: Compression preserves context window management across session resume.

### REQ-RPL-002d: Rewind Handling
**Full Text**: A `rewind` event removes the last N items from accumulated history. (Part of REQ-RPL-002 Event Processing.)
**Behavior**:
- GIVEN: A file with 5 content events followed by rewind(itemsRemoved: 2)
- WHEN: replaySession() is called
- THEN: result.history has 3 items (first 3 of the 5)
**Why This Matters**: Rewind must replay correctly for undo functionality to survive resume.

### REQ-RPL-005: Corruption Handling
**Full Text**: Corrupt last line is silently discarded (no warning); corrupt mid-file line logs warning and skips; missing session_start is fatal.
**Behavior**:
- GIVEN: A file with a corrupt last line (partial JSON)
- WHEN: replaySession() is called
- THEN: All other events are replayed correctly, no error
- AND the truncated last line is silently discarded — NO warning emitted (this is expected crash-recovery behavior, not exceptional)
**Why This Matters**: Crash recovery — a crash mid-write produces a truncated last line. This is expected, not exceptional.

### REQ-RPL-006: Project Hash Validation
**Full Text**: Replay validates session_start projectHash against expected hash.
**Behavior**:
- GIVEN: A file with projectHash "abc" and expected hash "def"
- WHEN: replaySession() is called
- THEN: Returns an error result (project hash mismatch)
**Why This Matters**: Prevents accidentally resuming another project's session.

### REQ-RPL-007: Metadata Tracking
**Full Text**: provider_switch and directories_changed events update session metadata during replay.
**Behavior**:
- GIVEN: A file with session_start (provider=anthropic) then provider_switch(provider=openai)
- WHEN: replaySession() is called
- THEN: result.metadata.provider is "openai"
**Why This Matters**: Resumed session must know the most recent provider state.

### REQ-RPL-008: session_event Handling
**Full Text**: session_event records are collected into ReplayResult.sessionEvents for audit but NOT added to IContent[] history.
**Behavior**:
- GIVEN: A file with session_start, content events, and session_event entries
- WHEN: replaySession() is called
- THEN: result.sessionEvents contains the session_event records; result.history does NOT contain them
**Why This Matters**: session_events are operational metadata, not conversation content. Including them in IContent[] would corrupt the LLM conversation model.

## Implementation Tasks

### Files to Create
- `packages/core/src/recording/ReplayEngine.test.ts`
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P07`

### Test Cases (BEHAVIORAL)

**Use SessionRecordingService (Phase 05) to create well-formed test files, then replay them.**

1. **Simple replay with user+ai messages** — 2 content events -> history has 2 items
2. **Replay preserves IContent structure** — content events with text+tool_call blocks -> replay preserves all block types
3. **Compression resets history** — 5 content + compressed + 2 content -> 3 items in result
4. **Multiple compressions use last** — compressed at event 5, another at event 8, 2 more content -> result has 3 items (second summary + 2)
5. **Rewind removes N items** — 5 content + rewind(2) -> 3 items
6. **Rewind exceeding history empties** — 2 content + rewind(10) -> 0 items (not error)
7. **Rewind after compression operates on post-compression** — compressed + 3 content + rewind(1) -> summary + 2 items
8. **Corrupt last line silently discarded** — write file with truncated last line -> other events replay fine, NO warning emitted for the truncated last line (silent discard — expected crash-recovery behavior)
9. **Corrupt mid-file line skipped with warning** — insert garbage line mid-file -> events around it replay, warnings include line number
10. **Missing session_start returns error** — file starting with content event -> error result
11. **Empty file returns error** — 0-byte file -> error result
12. **Project hash mismatch returns error** — session_start hash "abc", expected "def" -> error
13. **Unknown event types skipped with warning** — include "custom_event" type -> skipped, rest replays fine
14. **Non-monotonic seq logs warning but succeeds** — write events with seq 1,3,2,4 -> warning but history correct
15. **provider_switch updates metadata** — provider switch mid-file -> result.metadata has new provider
16. **directories_changed updates metadata** — dirs change mid-file -> result.metadata has new dirs
17. **lastSeq matches final event's seq** — replay returns correct lastSeq value
18. **eventCount matches total processed** — replay returns correct count
19. **readSessionHeader returns first line metadata** — utility function test
20. **readSessionHeader returns null for invalid file** — bad first line -> null
21. **session_event collected in sessionEvents, not in history** — file with session_event entries -> result.sessionEvents has them, result.history does not
22. **session_event during resumed session collected for audit** — session_event("Session resumed...") -> appears in sessionEvents, not in IContent[] history, not re-displayed in UI

### Golden Replay Tests (Event Ordering Contract)

23. **Golden: New session event ordering** — session_start (seq=1) + 4 content events + session_event -> history has 4 IContent, metadata matches, lastSeq correct, no warnings
24. **Golden: Resumed session event ordering** — session_start + content + session_event("Session resumed...") + provider_switch + content -> history has correct count, metadata.provider updated, no duplicate session_start
25. **Golden: Session with compression** — session_start + 4 content + compressed + 2 content -> history = summary + 2 post-compression
26. **Golden: Session with multiple resumes** — session_start + content pairs + 2 session_event("Session resumed...") boundaries + provider_switch -> all content preserved across resume boundaries, metadata updated
27. **Golden: Resume + compression + resume** — session_start + content + session_event("resumed") + content + compressed + content + session_event("resumed") + content -> compression supersedes all prior, post-compression content from both resume segments present

### Interleaved and Edge-Case Tests

28. **Interleaved content + compressed + rewind in same turn boundary** — compression then rewind then new content -> correct accumulated state
29. **Interleaved events in same turn boundary (extended)** — content -> compressed -> content -> rewind -> content -> verify final state

### Malformed Known Payloads

30. **Malformed session_start (missing sessionId)** — as first line -> fatal error; as mid-file after valid session_start -> skipped with warning
31. **Malformed content (missing content field)** — skipped with warning, surrounding events replayed
32. **Malformed compressed (missing summary)** — skipped with warning, history NOT cleared
33. **Malformed rewind (missing itemsRemoved)** — skipped with warning, history unchanged
34. **Malformed rewind (negative itemsRemoved)** — skipped with warning, history unchanged
35. **Malformed provider_switch (missing provider)** — skipped with warning, metadata unchanged
36. **Malformed session_event (missing severity)** — skipped with warning
37. **Malformed directories_changed (missing directories)** — skipped with warning, metadata unchanged
38. **Malformed compressed (missing itemsCompressed)** — skipped with warning, history preserved

### BOM Handling Tests

42a. **UTF-8 BOM on first line stripped before parsing** — GIVEN: a valid JSONL file with a UTF-8 BOM (U+FEFF, bytes 0xEF 0xBB 0xBF) prepended to the first line, WHEN: replaySession() is called, THEN: BOM is stripped, session_start is parsed normally, replay succeeds with no errors.
42b. **readSessionHeader strips BOM** — GIVEN: a valid JSONL file with a UTF-8 BOM on the first line, WHEN: readSessionHeader() is called, THEN: BOM is stripped and the session metadata is returned correctly.

### Repeated Resume Cycles

39. **Repeated resume cycles verify seq monotonicity and no duplicate session_start** — 3 resume boundaries -> exactly 1 session_start, all seq monotonic, all content preserved
40. **Repeated resume cycles — history accumulation** — all content from all resume cycles present in final history

### Malformed Event Summary Reporting

41. **Replay malformed event summary** — file with N malformed events -> warnings includes summary count
42. **Replay 5% threshold warning** — file where >5% events are malformed -> warnings includes "WARNING: >5%" entry

### Property-Based Tests (30%+ of total)

43. **Any sequence of content events produces history of same length** — fc.array of IContent, write as events, replay, verify length matches
44. **Compression always resets to exactly 1+post items** — fc.nat for pre/post counts, verify replay result length
45. **Rewind(N) on history of size M produces max(0, M-N) items** — fc.nat pairs, verify
46. **Multiple write-then-replay cycles are idempotent** — fc.array events, replay twice, same result
47. **Session metadata survives any event sequence** — fc.array of event types including provider_switch, verify metadata always present
48. **lastSeq always equals the final event's seq regardless of event count** — fc.nat(1-30) for event count, record + replay, verify lastSeq matches
49. **eventCount always matches total events regardless of corruption** — fc.nat(1-20) + optional corrupt last line, verify eventCount correct for valid events
50. **Any valid IContent round-trips through record -> replay losslessly** — fc.record for IContent with various block types, verify deep equality
51. **Warnings array is always present (possibly empty) regardless of input** — fc.array of varied events, verify result.warnings always an array
52. **seq monotonicity is preserved across any number of resumes** — fc.nat(1,5) for resume count, fc.nat(1,10) for turns per segment, verify all invariants
53. **Arbitrary interleaving of content/compressed/rewind produces valid history** — fc.array of fc.oneof event types, verify non-negative history, no undefined items, no exceptions
54. **Malformed payload for any known event type is skipped without crash** — fc.oneof known event types with random payloads, verify replay completes, warnings present, valid content still in history

### Test File Generation Strategy

- **Happy-path tests**: Use `SessionRecordingService` to generate valid JSONL files, then replay them. This validates the writer→reader round-trip and ensures the test fixtures are realistic.
- **Corruption/edge-case tests**: Hand-craft JSONL strings directly (corrupt JSON, missing fields, non-monotonic seq, BOM, partial lines, unknown event types). These cannot be generated by the writer because the writer produces valid output by design. Write these strings to temp files using `fs.writeFile()`.

Both approaches are valid and necessary. The writer generates structurally correct files; hand-crafting generates structurally broken files that test error handling.

### FORBIDDEN Patterns
- No mock filesystem — use real temp dirs (with SessionRecordingService for valid files, or fs.writeFile for hand-crafted corrupt files)
- No testing for NotYetImplemented
- No mock theater

## Verification Commands

```bash
# Test file exists
test -f packages/core/src/recording/ReplayEngine.test.ts

# Count tests (informational — quality over quantity)
TOTAL=$(grep -c "it(\|test(" packages/core/src/recording/ReplayEngine.test.ts)
PROPERTY=$(grep -c "fc\.\|test\.prop\|fc\.assert" packages/core/src/recording/ReplayEngine.test.ts)
echo "Total: $TOTAL, Property: $PROPERTY"

# No mock theater
grep -r "toHaveBeenCalled" packages/core/src/recording/ReplayEngine.test.ts && echo "FAIL"

# No reverse testing
grep -r "NotYetImplemented" packages/core/src/recording/ReplayEngine.test.ts && echo "FAIL"

# Tests fail naturally against stub
cd packages/core && npx vitest run src/recording/ReplayEngine.test.ts 2>&1 | tail -5
```

## Success Criteria
- Tests must cover all requirements and edge cases listed. Quality over quantity.
- Property-based tests should represent ~30% of the total test count
- Tests create real JSONL files using SessionRecordingService
- All tests fail against stub

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/ReplayEngine.test.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P07.md`
