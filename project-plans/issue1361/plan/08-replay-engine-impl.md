# Phase 08: Replay Engine Implementation

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P08`

## Prerequisites
- Required: Phase 07 completed
- Verification: `test -f project-plans/issue1361/.completed/P07.md`
- Expected: Tests in ReplayEngine.test.ts exist and fail against stub

## Requirements Implemented

Implements REQ-RPL-002 through REQ-RPL-008 to make Phase 07 tests pass.

## Implementation Tasks

### Task 8.1: Core Types

**File: `packages/core/src/recording/types/ReplayResult.ts`**

```typescript
// Discriminated union on `ok` field
type ReplayResult =
  | { ok: true; history: IContent[]; metadata: SessionMetadata; lastSeq: number; eventCount: number; warnings: string[]; sessionEvents: SessionEventPayload[] }
  | { ok: false; error: string }

interface SessionMetadata {
  sessionId: string;
  projectHash: string;
  provider: string;
  model: string;
  workspaceDirs: string[];
  startedAt: string;
}

interface SessionEventPayload {
  message: string;
  severity: 'info' | 'warning' | 'error';
  timestamp: string;
  seq: number;
}
```

### Task 8.2: ReplayEngine Core Implementation

**File: `packages/core/src/recording/ReplayEngine.ts`**

The replay engine reads JSONL files line-by-line, maintains accumulated state, and returns a `ReplayResult`.

#### Algorithm Overview

```
FUNCTION replaySession(filePath, expectedProjectHash?):
  LET history = []
  LET metadata = null
  LET sessionEvents = []
  LET warnings = []
  LET lastSeq = 0
  LET eventCount = 0
  LET malformedCount = 0       // Known event types with invalid payloads
  LET unknownEventCount = 0    // Unrecognized event types (forward-compatible, not "malformed")
  LET unparseableLineCount = 0 // Lines that fail JSON.parse (not categorizable as events)
  LET totalLineCount = 0

  // Read file line by line
  FOR EACH (line, lineNumber, isLastLine) IN readLines(filePath):
    totalLineCount++

    // Parse JSON
    TRY
      LET event = JSON.parse(line)
    CATCH
      IF isLastLine THEN
        // Silent discard — truncated last line is expected crash-recovery behavior, not exceptional
        CONTINUE
      ELSE
        unparseableLineCount++
        warnings.push("Malformed JSON at line " + lineNumber)
        CONTINUE
      END IF
    END TRY

    // Track sequence
    IF event.seq IS defined THEN
      IF event.seq <= lastSeq AND lastSeq > 0 THEN
        warnings.push("Non-monotonic seq at line " + lineNumber)
      END IF
      lastSeq = event.seq
    END IF

    eventCount++

    // Dispatch by event type
    SWITCH event.type:
      CASE "session_start":
        IF lineNumber > 1 THEN
          warnings.push("Unexpected session_start at line " + lineNumber + " (skipped)")
          CONTINUE
        END IF
        // Validate required fields (payload fields are under event.payload.*)
        IF NOT event.payload.sessionId THEN RETURN errorResult("Invalid session_start: missing sessionId")
        metadata = extractMetadata(event.payload)
        IF expectedProjectHash AND event.payload.projectHash !== expectedProjectHash THEN
          RETURN errorResult("Project hash mismatch")
        END IF

      CASE "content":
        IF NOT event.payload.content THEN
          malformedCount++; warnings.push("Malformed content at line " + lineNumber); CONTINUE
        END IF
        history.push(event.payload.content)

      CASE "compressed":
        IF NOT event.payload.summary THEN
          malformedCount++; warnings.push("Malformed compressed at line " + lineNumber); CONTINUE
        END IF
        IF event.payload.itemsCompressed IS undefined THEN
          malformedCount++; warnings.push("Malformed compressed (missing itemsCompressed) at line " + lineNumber); CONTINUE
        END IF
        history = [event.payload.summary]  // Compression replaces all prior history

      CASE "rewind":
        IF event.payload.itemsRemoved IS undefined OR event.payload.itemsRemoved < 0 THEN
          malformedCount++; warnings.push("Malformed rewind at line " + lineNumber); CONTINUE
        END IF
        history = history.slice(0, Math.max(0, history.length - event.payload.itemsRemoved))

      CASE "provider_switch":
        IF NOT event.payload.provider THEN
          malformedCount++; warnings.push("Malformed provider_switch at line " + lineNumber); CONTINUE
        END IF
        metadata.provider = event.payload.provider
        IF event.payload.model THEN metadata.model = event.payload.model

      CASE "directories_changed":
        IF NOT event.payload.directories THEN
          malformedCount++; warnings.push("Malformed directories_changed at line " + lineNumber); CONTINUE
        END IF
        metadata.workspaceDirs = event.payload.directories

      CASE "session_event":
        IF NOT event.payload.severity THEN
          malformedCount++; warnings.push("Malformed session_event at line " + lineNumber); CONTINUE
        END IF
        // Collected for audit — NOT added to IContent[] history
        sessionEvents.push({
          message: event.payload.message,
          severity: event.payload.severity,
          timestamp: event.ts,
          seq: event.seq
        })

      DEFAULT:
        unknownEventCount++
        warnings.push("Unknown event type '" + event.type + "' at line " + lineNumber)
    END SWITCH
  END FOR

  // Validate that we got a session_start
  IF metadata IS null THEN
    RETURN errorResult("Missing session_start")
  END IF

  // Malformed event threshold warning
  // Formula: malformedKnownEvents / (totalEventCount - unknownEventCount - unparseableLineCount)
  // Unknown events (unrecognized type) are not "malformed" — they are forward-compatible.
  // Unparseable lines (invalid JSON) are not "known events" — they can't be categorized.
  // Only known event types with invalid payloads count as "malformed known events."
  LET knownEventCount = eventCount - unknownEventCount - unparseableLineCount
  IF knownEventCount > 0 THEN
    LET malformedRate = malformedCount / knownEventCount
    IF malformedRate > 0.05 THEN
      warnings.push("WARNING: >" + (malformedRate * 100).toFixed(1) + "% of known events are malformed (" + malformedCount + "/" + knownEventCount + ")")
    END IF
  END IF

  RETURN { history, metadata, lastSeq, eventCount, sessionEvents, warnings }
END FUNCTION
```

#### session_event Exclusion Policy

`session_event` records (e.g., "Session resumed at...") are operational metadata. They are:
- **Collected** into `ReplayResult.sessionEvents` for audit purposes
- **NOT added** to `IContent[]` history — they are not conversation content
- **NOT re-displayed** in the UI on resume — they were already shown once

This prevents operational metadata from polluting the LLM conversation model.

#### Warn Logging Rate Limiting

To prevent excessive warning log output when replaying files with many malformed lines, warnings are rate-limited:

- **Inline warnings** (warnings array): all malformed lines are recorded (capped at 100 detailed entries, then summary only)
- **Console/debug logging**: first 5 malformed lines log individually, then suppressed until summary
- **Summary warning**: at end of replay, if malformedCount > 0, one summary line: `"Replay: N malformed events skipped"`

#### Malformed Event 5% Threshold Warning

If more than 5% of **known events** (totalKnownEvents) are malformed, the replay engine adds a prominent WARNING to the warnings array:

```
"WARNING: >X.Y% of known events are malformed (M/N)"
```

Formula: `malformedKnownEventCount / totalKnownEvents > 0.05` where `totalKnownEvents = totalEventCount - unknownEventCount - unparseableLineCount`. Unknown event types (forward-compatible) and unparseable JSON lines are excluded from both numerator and denominator — only known event types with invalid payloads count as "malformed."

### Task 8.3: readSessionHeader Utility

**File: same file or `packages/core/src/recording/utils.ts`**

```typescript
async function readSessionHeader(filePath: string): Promise<SessionMetadata | null> {
  // Read only the first line
  // Parse as JSON
  // Validate it's a session_start event
  // Return metadata or null
}
```

### Task 8.4: File Reading Infrastructure

The replay engine reads files using a buffered line reader. Options:
- `readline.createInterface` with `createReadStream` (Node.js standard)
- Line-by-line reading with position tracking for `isLastLine` detection

The `isLastLine` detection is important for the crash-recovery behavior: if the last line of a file is malformed (truncated JSON), it's silently discarded rather than treated as an error. This handles the case where the process crashed mid-write.

### Task 8.5: Integration Verification

- Run all Phase 07 tests
- Verify TypeScript compiles
- Verify no test modifications

### Files to Create
- `packages/core/src/recording/ReplayEngine.ts`
  - MUST include: `@plan:PLAN-20260211-SESSIONRECORDING.P08`
  - MUST reference pseudocode line numbers

### Files to Modify
- `packages/core/src/recording/index.ts` — Export ReplayEngine and types

### Do NOT Modify
- `packages/core/src/recording/ReplayEngine.test.ts` — Tests must not be changed

## Verification Commands

```bash
# All Phase 07 tests pass
cd packages/core && npx vitest run src/recording/ReplayEngine.test.ts
# Expected: All pass

# No test modifications
git diff packages/core/src/recording/ReplayEngine.test.ts | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"

# Plan markers present
grep -c "@plan:PLAN-20260211-SESSIONRECORDING.P08" packages/core/src/recording/ReplayEngine.ts
# Expected: 1+

# No debug code
grep -rn "console\.\|TODO\|FIXME\|XXX" packages/core/src/recording/ReplayEngine.ts && echo "FAIL"

# TypeScript compiles
cd packages/core && npx tsc --noEmit

# Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|TEMPORARY)" packages/core/src/recording/ReplayEngine.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/recording/ReplayEngine.ts
grep -rn -E "return \[\]$|return \{\}$|return null$|return undefined$" packages/core/src/recording/ReplayEngine.ts
# Expected: No matches

# Verify session_event NOT in history:
# (Phase 07 tests cover this — verify they pass)
cd packages/core && npx vitest run src/recording/ReplayEngine.test.ts -t "session_event"

# Verify 5% threshold warning:
cd packages/core && npx vitest run src/recording/ReplayEngine.test.ts -t "5%"
```

## Success Criteria
- All Phase 07 tests pass without modification
- Implementation follows pseudocode with line references
- session_event records collected in sessionEvents, not in history
- Malformed event rate-limiting and 5% threshold warning work correctly
- No deferred implementation patterns
- TypeScript compiles cleanly

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/ReplayEngine.ts
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P08.md`
