# Phase 25: System Integration TDD

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P25`

## Prerequisites
- Required: Phase 24a completed
- Verification: `test -f project-plans/issue1361/.completed/P24a.md`

## Requirements Implemented (Expanded)

This phase tests the FULL end-to-end integration: recording during a session, resuming a session, and the complete session lifecycle.

### REQ-INT-FULL-001: End-to-End Recording
**Full Text**: A complete session (start, converse, exit) produces a valid JSONL file that can be replayed.
**Behavior**:
- GIVEN: SessionRecordingService created with config
- WHEN: Content events are recorded, flushed, and service disposed
- THEN: JSONL file exists with session_start + content events in correct order, replayable
**Why This Matters**: The fundamental promise of the system — record and replay.

### REQ-INT-FULL-002: End-to-End Resume
**Full Text**: A recorded session can be resumed, producing the same history state as when it was saved.
**Behavior**:
- GIVEN: Session was recorded with 5 user+ai turns
- WHEN: resumeSession() is called
- THEN: Returns 10 IContent items matching the original conversation
**Why This Matters**: Resume must perfectly reconstruct session state.

### REQ-INT-FULL-003: Resume + Continue Recording
**Full Text**: After resume, new content is appended to the same file with continuing sequence numbers.
**Behavior**:
- GIVEN: Resumed session with lastSeq=10
- WHEN: New content is recorded and flushed
- THEN: New events have seq > 10, file contains original + new events
**Why This Matters**: Sessions span multiple CLI invocations.

### REQ-INT-FULL-004: Compression Survives Resume
**Full Text**: A session with compression can be resumed with correct post-compression history.
**Behavior**:
- GIVEN: Session with 10 content events then compression
- WHEN: Session is resumed
- THEN: History contains only compression summary + post-compression content
**Why This Matters**: Compression is a critical memory management feature.

### REQ-INT-FULL-005: Config Integration
**Full Text**: Config.isContinueSession() and getContinueSessionRef() work with string --continue values.
**Behavior**:
- GIVEN: Config created with continueSession = "abc123"
- WHEN: isContinueSession() and getContinueSessionRef() called
- THEN: Returns true and "abc123" respectively
**Why This Matters**: CLI flag must reach the resume flow.

## Implementation Tasks

### Files to Create
- `packages/core/src/recording/integration.test.ts` — End-to-end integration tests
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P25`

### Test Strategy
These tests exercise the FULL flow: create recording service → record events → flush → dispose → discover → resume → verify history → continue recording → verify continuation. Uses real filesystem, real services, no mocks.

### Test Cases (BEHAVIORAL — E2E)

1. **Full session lifecycle: record → flush → dispose → replay** — Create service, record 3 turns (6 content events), flush, dispose, replay file → 6 IContent items
2. **Record + resume + continue recording** — Record 3 turns, dispose, resume, record 2 more turns, dispose, replay → 10 IContent items
3. **Sequence numbers continuous across resume** — Record (seq 1-7), resume (continues from 7), record (seq 8-11), verify all seq monotonic
4. **Compression in recording + replay roundtrip** — Record 5 content, record compressed, record 2 more, replay → history has summary + 2
5. **Rewind in recording + replay roundtrip** — Record 5 content, record rewind(2), replay → 3 items
6. **Provider switch recorded and replayed** — Record content, switch provider, record more, replay → metadata has new provider
7. **Directories changed recorded and replayed** — Record directoriesChanged, replay → metadata has new dirs
8. **Deferred materialization: no file without content** — Create service, dispose without content → no file on disk
9. **Session discovery finds recorded sessions** — Record 3 sessions, list → 3 found with correct metadata
10. **Resume most recent (CONTINUE_LATEST) picks correctly** — Record 3 sessions (staggered), resume latest → gets most recent
11. **Resume specific session by ID** — Record 2 sessions, resume specific by ID → correct one
12. **Delete session removes file** — Record session, dispose, delete → file gone
13. **Lock prevents concurrent resume** — Record, resume (holds lock), attempt second resume → fails
14. **Config.getContinueSessionRef with string value** — Set config.continueSession = "abc", verify getContinueSessionRef returns "abc"
15. **Config.getContinueSessionRef with bare --continue** — Set config.continueSession = true, verify getContinueSessionRef returns null (bare continue = latest)
16. **Config.isContinueSession with string value** — Set config.continueSession = "abc", verify isContinueSession returns true

### Property-Based Tests (30%+ of total — minimum 7 property tests)

17. **Any sequence of content events roundtrips through record → replay** — fc.array of IContent, record, replay → history matches input
18. **Resume always preserves original history length** — fc.nat(1-20) for turn count, record, resume → length matches
19. **Sequence numbers are always monotonic after any number of resumes** — fc.nat(1-5) for resume count, verify monotonic across all
20. **Discovery always returns sessions sorted newest-first** — fc.array of session create times, verify sort order
21. **Compression at any point produces correct post-compression count** — fc.nat for pre/post counts, verify
22. **Any number of provider switches are all captured in recording** — fc.nat(1-10) switches, record and replay, verify all present in file
23. **Deferred materialization holds for any number of non-content events** — fc.nat(1-20) session_events before first content, verify no file until content

### FORBIDDEN Patterns
- No mocking any component — use real SessionRecordingService, ReplayEngine, SessionDiscovery, SessionLockManager
- No mock theater
- All tests use real filesystem

## Verification Commands

```bash
# Test file exists
test -f packages/core/src/recording/integration.test.ts

# Count tests
TOTAL=$(grep -c "it(\|test(" packages/core/src/recording/integration.test.ts)
PROPERTY=$(grep -c "fc\.\|test\.prop\|fc\.assert" packages/core/src/recording/integration.test.ts)
echo "Total: $TOTAL, Property: $PROPERTY"
[ "$TOTAL" -lt 16 ] && echo "FAIL: Insufficient tests"

# No mock theater
grep -r "toHaveBeenCalled\|mockImplementation\|vi\.mock\|vi\.spyOn" packages/core/src/recording/integration.test.ts && echo "FAIL"

# No reverse testing
grep -r "NotYetImplemented" packages/core/src/recording/integration.test.ts && echo "FAIL"

# Tests should pass (all components are implemented)
cd packages/core && npx vitest run src/recording/integration.test.ts 2>&1 | tail -10
```

### Semantic Verification Checklist
- [ ] Tests exercise real multi-component flows (not unit tests)
- [ ] Tests verify data integrity across record → dispose → resume → record cycles
- [ ] Tests use real filesystem with temp directories
- [ ] Property-based tests cover edge cases
- [ ] All tests verify actual IContent data, not just counts

## Success Criteria
- 16+ E2E behavioral tests
- 7+ property-based tests (30%+ of total = 7/23 = 30.4%)
- Tests use real components (no mocks)
- Tests pass against implemented components

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/integration.test.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P25.md`


---

## Addendum: Crash Recovery and Corruption Integration Tests

### Context
Integration tests must exercise real crash-recovery scenarios and file corruption cases to ensure the system is resilient to real-world failure modes. These tests use real file I/O — no mocking of file system operations.

### Additional Integration Test Scenarios

**Test: Crash recovery with truncated last JSONL line**

- GIVEN: A valid JSONL session file with 10 complete lines, followed by a truncated 11th line (simulating a crash mid-write — e.g., `{"type":"content","seq":11,"ti` with no closing brace or newline)
- WHEN: The replay engine reads the file
- THEN: The first 10 lines are replayed successfully into `history: IContent[]`. The truncated 11th line is silently discarded (not treated as an error). `warnings` contains at most a summary note about the discarded trailing line. The session is usable for resume.
- `@requirement REQ-RPL-003`

**Test: Mid-file corruption with bad line in middle**

- GIVEN: A valid JSONL session file with lines: session_start (line 1), content (line 2), `GARBAGE_NOT_JSON` (line 3), content (line 4), content (line 5)
- WHEN: The replay engine reads the file
- THEN: Lines 1, 2, 4, and 5 are replayed successfully. Line 3 is skipped. `warnings` includes a summary: "Skipped 1 malformed lines in session file (first at line 3: invalid JSON)". The resulting `history` contains content from lines 2, 4, and 5 (3 items). Session is usable for resume.
- `@requirement REQ-RPL-003`

**Test: Mixed old .json + new .jsonl in chats directory — only .jsonl discovered**

- GIVEN: A chats directory containing: `session-old1.json`, `session-old2.json`, `session-new1.jsonl` (valid, with session_start header), `session-new2.jsonl` (valid, with session_start header)
- WHEN: `SessionDiscovery.listSessions(chatsDir, projectHash)` is called
- THEN: Only `session-new1.jsonl` and `session-new2.jsonl` are returned in the results. The `.json` files are completely ignored — no errors, no warnings, no mention of them.
- AND WHEN: `resolveSessionRef("old1")` is called
- THEN: Error is thrown: session not found (the `.json` file is not discoverable)
- `@requirement REQ-RSM-001`


---

## Addendum: Over-Mocking Prevention Policy for Integration Tests

### Constraint
Integration tests in this phase MUST exercise real behavior, not mocked approximations. The following are **explicitly forbidden** in integration tests:

1. **Do NOT mock HistoryService lifecycle.** Tests must use a real `HistoryService` instance that actually emits `contentAdded` and `compressed` events. Mocking these events defeats the purpose of integration testing.

2. **Do NOT mock file I/O for JSONL operations.** Tests must write real `.jsonl` files to a temp directory and read them back. Use `os.tmpdir()` + unique subdirectory per test, cleaned up in `afterEach`.

3. **Do NOT mock JSONL parsing.** Tests must exercise the real `JSON.parse()` path for each line. The replay engine must actually parse real JSONL content, not pre-parsed objects.

4. **Do NOT mock SessionRecordingService internals.** The recording service must actually write to the file system. Verify by reading the file back and checking contents.

### What IS Acceptable to Mock
- **Provider API calls** (network I/O to LLM APIs) — these are external dependencies.
- **Time/clock** for deterministic timestamps in tests.
- **Process signals** (SIGTERM/SIGINT) for shutdown testing.

### Verification
```bash
# Scan for forbidden mocks in integration tests:
grep -n "vi.mock\|jest.mock\|mock.*HistoryService\|mock.*Recording\|mock.*readFile\|mock.*writeFile" packages/core/src/recording/integration.test.ts
# Expected: No matches for HistoryService/Recording/file mocks
# Provider mocks are acceptable
```


---

## Addendum: Missing Integration Test Scenarios (Architecture Review FIX 6)

### Signal Handling During Tool Turns

24. **SIGINT during active tool turn → verify partial turn flushed** — GIVEN: A recording session with content events being written during a multi-tool turn (user message + AI tool_call committed to history, tool execution in progress). WHEN: SIGINT is delivered to the process (simulated via `process.emit('SIGINT')` or `process.kill(process.pid, 'SIGINT')`). THEN: The flush handler runs, and the JSONL file contains:
    - `session_start` (if materialized)
    - User message `content` event (already committed before tool execution)
    - AI response `content` event with tool_call blocks (already committed)
    - Any tool result `content` events that were committed before the signal
    - Partial tool results that were in the queue but not yet flushed are best-effort (may or may not appear)
    - The file ends with a valid (or truncated-last-line) state — no corruption in the middle
    - `@requirement REQ-INT-007, REQ-CON-005`
    - `@plan PLAN-20260211-SESSIONRECORDING.P25`

25. **Cancellation with partial tool output → verify causal subset persisted** — GIVEN: A multi-tool turn where 3 tools are scheduled. Tool 1 completes successfully (result committed to history). Tool 2 is mid-execution. Tool 3 has not started. WHEN: User cancels (Escape key / abort). THEN: After flush:
    - JSONL contains the user message, AI tool_call response, and Tool 1's result (the causal subset that was committed)
    - Tool 2's partial output is NOT in the file (it was never committed to HistoryService)
    - Tool 3 is absent
    - A `session_event` with "Request cancelled" may be present
    - The session is resumable: replaying this file produces a valid but incomplete turn
    - `@requirement REQ-INT-007`
    - `@plan PLAN-20260211-SESSIONRECORDING.P25`



---

## Missing Test Scenarios (Architecture Review FIX 8)

### Cancel Mid-Tool + Resume

26. **Cancel mid-tool execution → resume loads captured partial turn** —
    - GIVEN: A recording session where the user sends a message, the AI responds with a tool call, and the tool execution is in progress
    - AND: The user message and AI tool_call response have been committed to HistoryService (and thus recorded to JSONL)
    - AND: Tool execution is mid-flight (not yet committed)
    - WHEN: The user cancels (Escape key / abort signal)
    - AND: The `submitQuery` finally block flushes the recording
    - AND: The session is disposed
    - AND: The session is resumed via `ReplayEngine.replaySession()`
    - THEN: The replayed history contains:
      - The user message (IContent, speaker: 'human')
      - The AI response with tool_call blocks (IContent, speaker: 'ai')
      - NO tool result (the tool was cancelled before committing)
    - AND: The resumed session is usable — the HistoryService can accept new content
    - AND: The JSONL file can be appended to for new events (seq continues from lastSeq)
    - `@requirement REQ-INT-007, REQ-INT-FULL-003`
    - `@plan PLAN-20260211-SESSIONRECORDING.P25`

### Crash With Partial Last Line + Subsequent Append

27. **Crash with partial last JSONL line → resume discards corrupt tail → new events append cleanly** —
    - GIVEN: A valid JSONL session file with 5 complete event lines
    - AND: A 6th line is written partially (simulating a crash mid-write): `{"v":1,"seq":6,"type":"content","ts":"2026-02-11T16:00:00.000Z","payload":{"conte`
    - WHEN: The session is resumed via `ReplayEngine.replaySession()`
    - THEN: The replay returns 4 content items from the 5 complete lines (seq 1 is session_start, not content), with `lastSeq=5` and a warning about the truncated last line
    - AND WHEN: A new `SessionRecordingService` is initialized for resume with `initializeForResume(filePath, lastSeq=5)`
    - AND: New content is enqueued and flushed
    - THEN: The new events are appended AFTER the truncated line (the corrupt partial line remains in the file — it is inert dead bytes before the next valid line)
    - AND: A subsequent `replaySession()` on the full file skips the corrupt line and correctly replays all valid events including the newly appended ones
    - `@requirement REQ-RPL-003, REQ-REC-008`
    - `@plan PLAN-20260211-SESSIONRECORDING.P25`

### Concurrent --continue While First Process Active

28. **Concurrent `--continue` while first process holds lock → second process gets "session in use" error** —
    - GIVEN: Process A has started a session and holds the lock (`SessionLockManager.acquireForSession()` succeeded)
    - AND: Process A's PID is still alive
    - WHEN: Process B attempts to resume the same session (`SessionLockManager.acquireForSession()` with same sessionId)
    - THEN: Process B receives an error: "Session is in use by another process"
    - AND: Process A's lock is NOT affected (still held)
    - AND: Process A can continue recording normally
    - AND: The JSONL file is NOT corrupted (Process B never wrote to it)
    - `@requirement REQ-CON-004`
    - `@plan PLAN-20260211-SESSIONRECORDING.P25`

### Cross-Mode Parity: Interactive and --prompt Produce Structurally Identical JSONL

29. **Interactive and `--prompt` modes produce structurally identical JSONL for same conversation** —
    - GIVEN: A conversation consisting of: user message "hello", AI response "world"
    - WHEN: This conversation is recorded via the interactive path (HistoryService events → RecordingIntegration → SessionRecordingService)
    - AND: The same conversation is recorded via the non-interactive path (`--prompt` → runNonInteractive → HistoryService events → RecordingIntegration → SessionRecordingService)
    - THEN: Both JSONL files have identical structure:
      - Line 1: `session_start` event (sessionId and timestamps differ, structure matches)
      - Line 2: `content` event with user message (speaker: 'human', blocks: [{type: 'text', text: 'hello'}])
      - Line 3: `content` event with AI response (speaker: 'ai', blocks: [{type: 'text', text: 'world'}])
    - AND: Both files can be replayed by the same `ReplayEngine.replaySession()` call
    - AND: Both replayed results produce identical `history: IContent[]` arrays (deep equality on speaker+blocks, ignoring metadata timestamps)
    - `@requirement REQ-INT-FULL-001, REQ-INT-007`
    - `@plan PLAN-20260211-SESSIONRECORDING.P25`

