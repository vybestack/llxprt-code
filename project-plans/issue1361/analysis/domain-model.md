# Domain Model: Session Recording Service

## Entity Relationships

### SessionRecordingService (Core Writer)
- **Owns**: Event queue (in-memory), sequence counter, file handle (when materialized)
- **References**: Session ID, project hash, chats directory
- **State**: `idle` → `recording` → `disabled` (ENOSPC) | `disposed`
- **Produces**: JSONL file with session events

### ReplayEngine (Reader)
- **Input**: JSONL file path + expected project hash
- **Output**: ReplayResult { history: IContent[], metadata: SessionMetadata, lastSeq, eventCount, warnings }
- **Pure function**: No side effects, no state. Reads file, processes events, returns result.

### SessionDiscovery (Shared Utility)
- **Input**: chats directory path, project hash
- **Output**: SessionSummary[] (sorted newest-first)
- **Used by**: --continue resolution, --list-sessions, --delete-session
- **Reads**: Only first line of each .jsonl file + fs.stat

### SessionLockManager (Concurrency)
- **Owns**: Lock file lifecycle (create, check, release)
- **Lock file**: `<session-file>.lock` containing PID
- **Stale detection**: Check if PID in lock file is still running

### Event Types (Value Objects)
- **SessionRecordLine**: Envelope `{v, seq, ts, type, payload}`
- **Payloads**: session_start, content, compressed, rewind, provider_switch, session_event, directories_changed

## State Transitions

### SessionRecordingService Lifecycle
```
CREATED → enqueue(session_start) → BUFFERING
BUFFERING → enqueue(content) → MATERIALIZING → RECORDING
RECORDING → enqueue(*) → RECORDING
RECORDING → ENOSPC error → DISABLED
RECORDING → flush() + dispose() → DISPOSED
BUFFERING → dispose() → DISPOSED (no file created)
```

### Session File Lifecycle
```
NON-EXISTENT → first content event → ACTIVE (locked)
ACTIVE → flush at turn boundaries → ACTIVE (flushed)
ACTIVE → process exit → CLOSED (lock released)
CLOSED → --continue → ACTIVE (re-locked, append)
CLOSED → cleanup (age/count) → DELETED
CLOSED → --delete-session → DELETED
```

### Resume Flow States
```
CLI_START → parse --continue → DISCOVERY
DISCOVERY → find matching file → LOCK_ACQUIRE
LOCK_ACQUIRE → lock acquired → REPLAY
LOCK_ACQUIRE → lock held by other → ERROR("Session in use")
REPLAY → process events → SEED_HISTORY
SEED_HISTORY → set IContent[] on HistoryService → RECONSTRUCT_UI
RECONSTRUCT_UI → convertToUIHistory() → REOPEN_FILE
REOPEN_FILE → initializeForResume(filePath, lastSeq) → RECORDING
```

## Business Rules

### Recording Rules
1. **Enqueue is never blocking**: callers push events synchronously
2. **Deferred materialization**: file only created when first `content` event arrives
3. **Monotonic sequence**: seq increments by 1 per event, no gaps (except across resume)
4. **ENOSPC is permanent per session**: once disk full is detected, recording stops for the session
5. **Flush guarantees**: flush() resolves only when all queued events are written

### Replay Rules
1. **File order is truth**: seq values are for debugging, replay follows line order
2. **compressed resets history**: all prior IContent items discarded, summary becomes sole item
3. **rewind operates on post-compression**: cannot cross backward past compression boundary
4. **rewind N > list size**: empties list (not an error)
5. **Unknown event types**: skipped with warning (forward compatibility)
6. **Bad last line**: silently discarded (crash recovery)
7. **Bad mid-file line**: warning + skip (not fatal)
8. **Missing session_start**: file invalid for replay

### Resume Rules
1. **Project scoping**: all operations filter by projectHash
2. **Resolution precedence**: exact ID match → unique prefix → numeric index
3. **Provider mismatch**: informational warning, current config takes precedence
4. **Historical session_events**: NOT re-displayed in UI on resume
5. **File append**: after resume, new events continue in same file with seq continuing

### Concurrency Rules
1. **Single writer**: only one process can hold a session lock
2. **Lock before file**: lock acquired before file creation or replay
3. **Stale detection**: check if lock PID is still running
4. **Lock = active file**: cleanup respects locks as active-file indicators

### Cleanup Rules
1. **Lock-aware deletion**: never delete a locked file
2. **Stale lock + data**: remove stale lock; data file subject to normal retention policy
3. **Orphaned lock**: delete lock file with no corresponding data file

## Edge Cases

### Writer Edge Cases
- ENOSPC on first write (before any event written): disable, no partial file
- ENOSPC mid-flush (partial write): file may have incomplete last line → handled by replay's bad-last-line rule
- enqueue after dispose: no-op
- flush when queue is empty: resolves immediately
- Multiple concurrent flush calls: all resolve when drain completes
- Session with only session_start and session_events but no content: no file created

### Replay Edge Cases
- Empty file (0 bytes): error result
- File with only session_start: valid replay, empty history
- File with session_start + session_events only: valid replay, empty history, events collected separately
- Multiple compression events: only last one's summary matters
- Rewind of 0 items: no-op (though spec says positive integer, handle gracefully)
- Very large file (100k+ events): handled by streaming line reader, not loading into memory

### Resume Edge Cases
- All sessions locked: error "All sessions for this project are in use"
- Ambiguous prefix: error listing matching sessions
- Session file corrupted: skip during discovery, error if explicitly selected
- Resume into different provider/model: warning event recorded, continues normally
- Resume after ENOSPC-disabled session: file may be incomplete, replay handles gracefully

### Concurrency Edge Cases
- Process crashes without releasing lock: stale detection via PID check
- PID reuse (very unlikely): accept the risk for CLI tool simplicity
- Lock file permissions: created with same permissions as data file
- Lock race condition: mitigated by atomic file creation (O_EXCL or equivalent)

## Error Scenarios

| Scenario | Component | Behavior |
|----------|-----------|----------|
| Disk full (ENOSPC) | SessionRecordingService | Disable recording, warn user, continue session |
| File permission denied | SessionRecordingService | Treat as ENOSPC (disable recording) |
| Session file deleted mid-session | SessionRecordingService | Write failure → disable recording |
| Corrupt session file | ReplayEngine | Skip bad lines, warn, continue |
| Missing session_start | ReplayEngine | Return error result |
| Project hash mismatch | ReplayEngine | Return error result |
| Lock held by other process | SessionLockManager | Fail with "Session is in use" |
| Lock file permission denied | SessionLockManager | Fail with descriptive error |
| No sessions found | SessionDiscovery | Return empty list |
| Ambiguous session prefix | SessionDiscovery | Error listing matches |
| Process killed (SIGKILL) | Lifecycle | Lock becomes stale, recovered by stale detection |
