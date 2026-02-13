# Phase 05: Core Types + Writer Implementation

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P05`

## Prerequisites
- Required: Phase 04a completed
- Verification: `test -f project-plans/issue1361/.completed/P04a.md`
- Expected: Tests in SessionRecordingService.test.ts exist and fail

## Requirements Implemented (Expanded)

Implements all REQ-REC-001 through REQ-REC-008 to make Phase 04 tests pass.

### REQ-REC-001: Event Envelope Format
- GIVEN: Any event type and payload
- WHEN: The event is serialized by SessionRecordingService
- THEN: The resulting JSON line has `v`, `seq`, `ts`, `type`, and `payload` fields

### REQ-REC-002: Seven Event Types
- GIVEN: The type system from Phase 03
- WHEN: Any of the 7 event types is enqueued
- THEN: The correct type discriminator and payload structure is serialized

### REQ-REC-003: Synchronous Enqueue + Background Write
- GIVEN: An active SessionRecordingService
- WHEN: enqueue() is called
- THEN: Returns synchronously (void), event queued for background writing

### REQ-REC-004: Deferred Materialization
- GIVEN: A new SessionRecordingService
- WHEN: Only session_start/session_events are enqueued (no content)
- THEN: No file is created on disk until first content event arrives

### REQ-REC-005: Flush Guarantee
- GIVEN: N events have been enqueued
- WHEN: flush() is awaited
- THEN: All N events exist in the file

### REQ-REC-006: ENOSPC Handling
- GIVEN: A write fails with ENOSPC error code
- WHEN: Subsequent enqueue() calls are made
- THEN: isActive() returns false, subsequent enqueues are no-ops

### REQ-REC-007: Monotonic Sequence Numbers
- GIVEN: Multiple events recorded in a session
- WHEN: File is read
- THEN: Each line has seq strictly greater than previous

### REQ-REC-008: Resume Initialization
- GIVEN: A session being resumed with known filePath and lastSeq
- WHEN: initializeForResume(filePath, lastSeq) is called
- THEN: New events append to existing file with seq continuing from lastSeq

## Implementation Tasks

### Files to Modify
- `packages/core/src/recording/SessionRecordingService.ts` — Full implementation
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P05`
  - MUST reference pseudocode lines from `analysis/pseudocode/session-recording-service.md`

### Implementation from Pseudocode (MANDATORY line references)

- **Lines 40-51**: Class fields — queue, seq, filePath, materialized, active, draining, preContentBuffer
- **Lines 53-67**: Constructor — store config, buffer session_start event
- **Lines 69-79**: bufferPreContent — increment seq, create line, append to buffer
- **Lines 81-110**: enqueue — check active, trigger materialization on first content, increment seq, create line, schedule drain
- **Lines 112-118**: materialize — construct filename, set filePath, ensure directory exists
- **Lines 120-124**: scheduleDrain — guard against concurrent drains, start drain
- **Lines 126-146**: drain — while queue has items, serialize batch, appendFile, handle ENOSPC
- **Lines 148-160**: flush — await current drain, drain remaining if any
- **Lines 162-185**: isActive, getFilePath, getSessionId, initializeForResume, dispose
- **Lines 190-212**: Convenience methods (recordContent, recordCompressed, etc.)

### Do NOT Modify
- `packages/core/src/recording/SessionRecordingService.test.ts` — Tests must not be changed

## Required Code Markers

Every function/method in the implementation MUST include:
```typescript
/**
 * @plan PLAN-20260211-SESSIONRECORDING.P05
 * @requirement REQ-REC-003 (or appropriate REQ-REC-*)
 * @pseudocode session-recording-service.md lines X-Y
 */
```

## Verification Commands

```bash
# All tests pass
cd packages/core && npx vitest run src/recording/SessionRecordingService.test.ts
# Expected: All pass

# No test modifications
git diff packages/core/src/recording/SessionRecordingService.test.ts | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"

# Plan markers present
grep -c "@plan:PLAN-20260211-SESSIONRECORDING.P05" packages/core/src/recording/SessionRecordingService.ts
# Expected: 1+

# Pseudocode references present
grep -c "@pseudocode" packages/core/src/recording/SessionRecordingService.ts
# Expected: 1+

# No debug code
grep -rn "console\.\|TODO\|FIXME\|XXX" packages/core/src/recording/SessionRecordingService.ts && echo "FAIL: Debug/TODO code"

# TypeScript compiles
cd packages/core && npx tsc --noEmit
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY)" packages/core/src/recording/SessionRecordingService.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/recording/SessionRecordingService.ts
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/recording/SessionRecordingService.ts
# Expected: No matches in implementation
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Does enqueue actually add to an in-memory queue?** — [ ]
2. **Does flush actually write to a file?** — [ ]
3. **Does deferred materialization actually prevent file creation until content?** — [ ]
4. **Does ENOSPC actually disable recording?** — [ ]
5. **Are sequence numbers actually monotonic?** — [ ]

#### Feature Actually Works
```bash
# Manual verification: Create a temp script that uses the service
node -e "
const { SessionRecordingService } = require('./packages/core/dist/recording/index.js');
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-test-'));
const svc = new SessionRecordingService({
  sessionId: 'test-123',
  projectHash: 'hash-abc',
  chatsDir: tmpDir,
  workspaceDirs: ['/test'],
  provider: 'test',
  model: 'test-model'
});
svc.recordContent({ speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] });
svc.flush().then(() => {
  const files = fs.readdirSync(tmpDir);
  console.log('Files:', files);
  const content = fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8');
  console.log('Content:', content);
  fs.rmSync(tmpDir, { recursive: true });
});
"
```

## Success Criteria
- All Phase 04 tests pass without modification
- Implementation follows pseudocode line-by-line
- No deferred implementation patterns
- TypeScript compiles cleanly

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/SessionRecordingService.ts
# Re-implement following pseudocode more carefully
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P05.md`
