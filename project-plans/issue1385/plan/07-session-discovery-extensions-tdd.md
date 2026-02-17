# Phase 07: Session Discovery Extensions — TDD

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P07`

## Prerequisites
- Required: Phase 06a completed
- Verification: `test -f project-plans/issue1385/.completed/P06a.md`
- Expected files: `packages/core/src/recording/SessionDiscovery.ts` (with stub methods from P06)

## Requirements Implemented (Expanded)

### REQ-SB-005: Empty Session Filtering (via hasContentEvents)
**Behavior**:
- GIVEN: A JSONL file with only `session_start` event
- WHEN: `hasContentEvents(filePath)` is called
- THEN: Returns `false`
- GIVEN: A JSONL file with `session_start` + at least one `content` event
- WHEN: `hasContentEvents(filePath)` is called
- THEN: Returns `true`

### REQ-SB-008: Skipped Session Count (via listSessionsDetailed)
**Behavior**:
- GIVEN: A directory with 5 valid and 2 corrupted session files
- WHEN: `listSessionsDetailed()` is called
- THEN: Returns `{ sessions: [5 items], skippedCount: 2 }`

### REQ-PV-002: First Message Preview (via readFirstUserMessage)
**Behavior**:
- GIVEN: A session with a user message "fix the login bug"
- WHEN: `readFirstUserMessage(filePath)` is called
- THEN: Returns `"fix the login bug"`

### REQ-PV-009: Text Extraction
**Behavior**:
- GIVEN: IContent with [TextPart("hello"), InlineDataPart, TextPart(" world")]
- WHEN: Text is extracted
- THEN: Returns `"hello world"`

### REQ-PV-010: Unexpected Schema Resilience
**Behavior**:
- GIVEN: A valid JSON line with unexpected structure
- WHEN: `readFirstUserMessage` processes it
- THEN: Returns `null` (no throw)

## Test Cases

### File to Create
- `packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts`
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P07`

### BEHAVIORAL Tests — hasContentEvents

1. **Empty session (only session_start)**: Write a JSONL file with only a session_start line. `hasContentEvents(path)` returns `false`.
2. **Session with content**: Write a JSONL file with session_start + content event. Returns `true`.
3. **Session with multiple events**: session_start + metadata + content. Returns `true`.
4. **Non-existent file**: Returns `false` (or throws — match spec).
5. **Empty file (no lines at all)**: Returns `false`.
6. **File with only whitespace/empty lines after header**: Returns `false`.

### BEHAVIORAL Tests — listSessionsDetailed

7. **All valid sessions**: Returns all sessions with `skippedCount: 0`.
8. **Mix of valid and corrupted**: Returns valid sessions only, `skippedCount` equals corrupted count.
9. **All corrupted**: Returns `{ sessions: [], skippedCount: N }`.
10. **Empty directory**: Returns `{ sessions: [], skippedCount: 0 }`.
11. **Sessions sorted newest-first**: Verify ordering matches existing `listSessions` behavior.

### BEHAVIORAL Tests — readFirstUserMessage

12. **Single user message**: Returns the message text.
13. **Multiple user messages**: Returns only the FIRST user message.
14. **No user messages (system only)**: Returns `null`.
15. **Message with TextPart only**: Extracts text correctly.
16. **Message with mixed parts (TextPart + InlineDataPart)**: Returns only TextPart text concatenated.
17. **Message exceeding 120 chars**: Truncated to 120 chars.
18. **Message exactly 120 chars**: Not truncated.
19. **Message with 119 chars**: Not truncated.
20. **Empty text in TextPart**: Returns `""` or `null`.
21. **Valid JSON but unexpected schema**: Returns `null`, does NOT throw.
22. **File I/O error (permissions)**: Returns `null` (or throws — match spec for `previewState: 'error'`).
23. **Non-existent file path**: Returns `null`.

### Edge-Case Tests

24. **JSONL with trailing newline**: Handles correctly.
25. **Very large file (only reads until first user message found)**: Does not OOM.
26. **Session with tool-call events before first user message**: Skips non-user events.
27. **Session with model response before first user message**: Skips model events.

### Property-Based Tests (~30%)

28. **Property: hasContentEvents is idempotent**: Calling twice on same file returns same result.
29. **Property: readFirstUserMessage returns string or null**: For any generated JSONL content, result is string|null, never throws.
30. **Property: preview length <= 120**: For any input, `readFirstUserMessage(path)?.length ?? 0 <= 120`.
31. **Property: listSessionsDetailed.sessions + listSessionsDetailed.skippedCount >= total files**: No sessions lost or double-counted.

### Test Data Strategy
- Create REAL JSONL files in a temp directory using `fs.mkdtemp` + `fs.writeFile`
- Use the actual SessionRecordLine format from `packages/core/src/recording/types.ts`
- Clean up temp directories after each test
- NO mocking of filesystem operations

### FORBIDDEN Patterns
```typescript
// NO mock filesystem
vi.mock('fs') // FORBIDDEN
vi.mock('fs/promises') // FORBIDDEN

// NO reverse testing
expect(hasContentEvents(path)).not.toThrow()

// NO mock theater
expect(mockReadFile).toHaveBeenCalledWith(path)
```

## Verification Commands

```bash
# Test file exists
test -f packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts || echo "FAIL"

# Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P07" packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts
# Expected: 1+

# Count test cases
grep -c "it(" packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts
# Expected: 28+

# Property-based tests
grep -c "fc\.\|fast-check\|property" packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts
# Expected: 3+

# No mock theater
grep "toHaveBeenCalled\|vi.mock.*fs\|jest.mock.*fs" packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts && echo "FAIL: mock theater" || echo "OK"

# Tests fail against stubs (expected)
cd packages/core && npx vitest run src/recording/__tests__/SessionDiscovery.extensions.spec.ts 2>&1 | tail -5
# Expected: FAIL
```

## Success Criteria
- 28+ test cases
- 4+ property-based tests
- All use real filesystem (temp dirs)
- All fail against stubs (expected)
- No mock theater, no reverse testing

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P07.md`

## Implementation Tasks

- Execute the scoped file updates for this phase only.
- Preserve @plan, @requirement, and @pseudocode traceability markers where applicable.

## Deferred Implementation Detection

```bash
rg -n "TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|NotYetImplemented" [modified-files]
```

## Feature Actually Works

- Manual verification is required for this phase before completion is marked.

## Integration Points Verified

- Verify caller/callee boundaries for every touched integration point.
