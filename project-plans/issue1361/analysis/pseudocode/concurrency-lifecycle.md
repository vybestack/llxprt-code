# Pseudocode: Concurrency + Process Lifecycle (Issue #1367)

## Interface Contracts

```typescript
// INPUTS
interface LockRequest {
  chatsDir: string;     // Directory containing session files
  sessionId: string;    // Session identifier
}

// OUTPUTS
interface LockHandle {
  lockPath: string;
  release(): Promise<void>;
}

// DEPENDENCIES
// - node:fs/promises for file operations
// - node:process for PID
// - registerCleanup from cleanup.ts
```

## Lock Path Contract

The lock path is ALWAYS `<chatsDir>/<sessionId>.lock` — session-ID-based, regardless of materialization state.

| Scenario | Lock Path | JSONL File May Exist? |
|----------|-----------|----------------------|
| New session (pre-materialization) | `<chatsDir>/<sessionId>.lock` | No — file hasn't been created yet |
| New session (materialized, content written) | `<chatsDir>/<sessionId>.lock` | Yes — `session-<sessionId>.jsonl` |
| Resumed session | `<chatsDir>/<sessionId>.lock` | Yes — file already existed |
| Cleanup check (is session active?) | `<chatsDir>/<sessionId>.lock` | Maybe — check lock first |
| Delete check (is session in use?) | `<chatsDir>/<sessionId>.lock` | Yes — deleting the file |
| Orphaned lock cleanup | `<chatsDir>/<sessionId>.lock` | Maybe — PID dead, check for `.jsonl` |

One path from creation to cleanup. The lock path is derived from the session ID alone:

```typescript
// THE canonical lock path derivation:
function getLockPath(chatsDir: string, sessionId: string): string {
  return path.join(chatsDir, sessionId + '.lock');
}

// The corresponding JSONL file path (when materialized):
function getSessionFilePath(chatsDir: string, sessionId: string): string {
  return path.join(chatsDir, 'session-' + sessionId + '.jsonl');
}

// DERIVED: Extract sessionId from file path, then use canonical
function getLockPathFromFilePath(sessionFilePath: string): string {
  const dir = path.dirname(sessionFilePath);
  const basename = path.basename(sessionFilePath);
  const match = basename.match(/^session-(.+)\.jsonl$/);
  if (!match) throw new Error('Cannot extract session ID from path: ' + sessionFilePath);
  return getLockPath(dir, match[1]);
}
```

Both share the same parent directory (`chatsDir`) and the same key (`sessionId`). The lock path never changes, never needs migration, and is known before the JSONL file exists.

## Integration Points

```
Line 30: CALL fs.writeFile(lockPath, pidContent, { flag: 'wx' })
         - 'wx' flag = exclusive create, fails if exists
         - Atomic lock acquisition

Line 60: CALL process.kill(pid, 0) to check if PID is alive
         - Returns silently if alive, throws if dead
         - Used for stale lock detection

Line 90: CALL registerCleanup(releaseHandler)
         - From packages/cli/src/utils/cleanup.ts
         - Ensures lock released on exit
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Use file locking libraries that add external dependencies
[OK] DO: Simple PID file with stale detection (adequate for CLI tool)

[ERROR] DO NOT: Release lock manually in multiple places
[OK] DO: Register release as cleanup handler, single ownership

[ERROR] DO NOT: Trust that SIGKILL handlers will run
[OK] DO: Implement stale detection for crashed processes

[ERROR] DO NOT: Use file-path-based lock paths (e.g., session-<id>.jsonl.lock)
[OK] DO: Always use session-ID-based lock paths (<sessionId>.lock)
```

## SessionLockManager

```
10: CLASS SessionLockManager
11:
12:   STATIC METHOD getLockPath(chatsDir: string, sessionId: string): string
13:     RETURN path.join(chatsDir, sessionId + '.lock')
14:   END METHOD
15:
16:   STATIC METHOD getLockPathFromFilePath(sessionFilePath: string): string
17:     LET dir = path.dirname(sessionFilePath)
18:     LET basename = path.basename(sessionFilePath)
19:     LET match = basename.match(/^session-(.+)\.jsonl$/)
20:     IF NOT match THEN THROW new Error('Cannot extract session ID from path: ' + sessionFilePath)
21:     RETURN SessionLockManager.getLockPath(dir, match[1])
22:   END METHOD
23:
24:   STATIC ASYNC METHOD acquireForSession(chatsDir: string, sessionId: string): LockHandle
25:     LET lockPath = SessionLockManager.getLockPath(chatsDir, sessionId)
26:     LET pid = process.pid
27:     LET lockContent = JSON.stringify({
28:       pid,
29:       timestamp: new Date().toISOString(),
30:       sessionId
31:     })
32:
33:     TRY
34:       // Attempt exclusive creation
35:       AWAIT fs.writeFile(lockPath, lockContent, { flag: 'wx' })
36:     CATCH error
37:       IF error.code == 'EEXIST' THEN
38:         // Lock file exists — check if stale
39:         LET isStale = AWAIT SessionLockManager.checkStale(lockPath)
40:         IF isStale THEN
41:           // Break stale lock
42:           AWAIT fs.unlink(lockPath)
43:           // Retry acquisition
44:           TRY
45:             AWAIT fs.writeFile(lockPath, lockContent, { flag: 'wx' })
46:           CATCH retryError
47:             THROW new Error("Session is in use by another process")
48:           END TRY
49:         ELSE
50:           THROW new Error("Session is in use by another process")
51:         END IF
52:       ELSE IF error.code == 'ENOENT' THEN
53:         // Ensure lock directory exists
54:         AWAIT fs.mkdir(path.dirname(lockPath), { recursive: true })
55:         AWAIT fs.writeFile(lockPath, lockContent, { flag: 'wx' })
56:       ELSE
57:         THROW error
58:       END IF
59:     END TRY
60:
61:     // Return lock handle with release method
62:     LET released = false
63:     RETURN {
64:       lockPath,
65:       release: ASYNC () => {
66:         IF released THEN RETURN
67:         SET released = true
68:         TRY
69:           AWAIT fs.unlink(lockPath)
 70:         CATCH releaseError
 71:           // Best-effort release — log but don't throw (we're shutting down)
 72:           console.warn('Failed to release session lock:', lockPath, releaseError.message)
 73:         END TRY
73:       }
74:     }
75:   END METHOD
76:
 77:   STATIC ASYNC METHOD checkStale(lockPath: string): boolean
 78:     TRY
 79:       LET content = AWAIT fs.readFile(lockPath, 'utf-8')
 80:       LET lockData = JSON.parse(content)
 81:       LET lockPid = lockData.pid
 82:
 83:       // PID-based stale detection ONLY.
 84:       // No age-based override — a session can run for days.
 85:       // If the PID is alive, the lock is valid — period.
 86:       TRY
 87:         process.kill(lockPid, 0)  // signal 0 = check existence
 88:         RETURN false  // Process is alive, lock is valid
 89:       CATCH
 90:         RETURN true  // Process is dead, lock is stale
 91:       END TRY
 92:     CATCH
 93:       // Can't read/parse lock file — treat as stale
 94:       RETURN true
 95:    END TRY
 96:  END METHOD
103:
104:  STATIC ASYNC METHOD isLocked(chatsDir: string, sessionId: string): boolean
105:    LET lockPath = SessionLockManager.getLockPath(chatsDir, sessionId)
106:    TRY
107:      AWAIT fs.access(lockPath)
108:      // Lock file exists — check if stale
109:      LET stale = AWAIT SessionLockManager.checkStale(lockPath)
110:      RETURN NOT stale
111:    CATCH
112:      RETURN false  // No lock file
113:    END TRY
114:  END METHOD
115:
116:  STATIC ASYNC METHOD isStale(chatsDir: string, sessionId: string): boolean
117:    LET lockPath = SessionLockManager.getLockPath(chatsDir, sessionId)
118:    TRY
119:      AWAIT fs.access(lockPath)
120:      RETURN AWAIT SessionLockManager.checkStale(lockPath)
121:    CATCH
122:      RETURN false  // No lock file means not stale
123:    END TRY
124:  END METHOD
125:
126:  STATIC ASYNC METHOD removeStaleLock(chatsDir: string, sessionId: string): void
127:    LET lockPath = SessionLockManager.getLockPath(chatsDir, sessionId)
128:    TRY
129:      AWAIT fs.unlink(lockPath)
130:    CATCH
131:      // Best-effort
132:    END TRY
133:  END METHOD
134: END CLASS
```

## Lock State Machine

The lock is created BEFORE the JSONL file exists (deferred materialization means the file
is not created until first content event — REQ-REC-004).

### State Transitions

```
170: // Lock State Machine:
171: //
172: // States:
173: //   PRE_MATERIALIZATION — Lock acquired, JSONL file does NOT exist yet
174: //   MATERIALIZED        — Lock acquired, JSONL file exists (first content written)
175: //   RELEASED            — Lock released, session ended normally
176: //   ORPHANED            — Lock exists but owning process is dead
177: //
178: // Transitions:
179: //   (session start) --> PRE_MATERIALIZATION
180: //     Lock acquired with: SessionLockManager.acquireForSession(chatsDir, sessionId)
181: //     At this point, no JSONL file exists.
182: //
183: //   PRE_MATERIALIZATION --> MATERIALIZED
184: //     Triggered by: SessionRecordingService creates the JSONL file (first content event)
185: //     No lock file update needed — the mere existence of the JSONL file is sufficient.
186: //
187: //   MATERIALIZED --> RELEASED
188: //     Triggered by: Normal session end (process exit, /exit, Ctrl-C)
189: //     Lock file deleted via LockHandle.release()
190: //     Registered via registerCleanup() — runs automatically on shutdown
191: //
192: //   PRE_MATERIALIZATION --> RELEASED
193: //     Triggered by: User starts session, does nothing, exits
194: //     Lock file deleted. No JSONL file was ever created. Clean state.
195: //
196: //   * --> ORPHANED
197: //     Triggered by: Process crash (SIGKILL, power loss, OOM killer)
198: //     Lock file remains. Owning PID is dead.
199: //     Detected by: SessionLockManager.checkStale() — process.kill(pid, 0) fails
```

## Shutdown Flush Integration

```
205: // Integration with cleanup.ts:
206:
207: METHOD registerRecordingCleanup(recording: SessionRecordingService, lockHandle: LockHandle): void
208:   // Register flush as cleanup handler (runs before other cleanup)
209:   registerCleanup(ASYNC () => {
210:     TRY
211:       AWAIT recording.flush()
212:     CATCH error
213:       // Best-effort flush on shutdown
214:     END TRY
215:   })
216:
217:   // Register lock release as cleanup handler
218:   registerCleanup(ASYNC () => {
219:     AWAIT lockHandle.release()
220:   })
221: END METHOD
```

## Process Signal Handlers

```
230: // In gemini.tsx, after recording service is initialized:
231: // (These integrate with existing SIGINT/SIGTERM handling)
232:
233: // The existing runExitCleanup() already calls all registered cleanup functions.
234: // So the flush + lock release are handled automatically via registerCleanup.
235:
236: // For uncaught exceptions (best-effort):
237: METHOD registerUncaughtFlush(recording: SessionRecordingService): void
238:   process.on('uncaughtException', ASYNC (error) => {
239:     TRY
240:       AWAIT recording.flush()
241:     CATCH
242:       // Best effort
243:     END TRY
244:     // Let existing uncaught exception handler proceed
245:   })
246: END METHOD
```

## Orphan Lock Cleanup for Never-Materialized Sessions

```
250: // Orphan cleanup handles locks where the JSONL file never materialized:
251: //   - Session was started (lock acquired)
252: //   - Process crashed before first content was written
253: //   - Lock file remains, no JSONL file exists
254: //
255: // Detection: Lock file exists, PID is dead, no corresponding JSONL file
256: //
257: STATIC ASYNC METHOD cleanupOrphanedLocks(chatsDir: string): void
258:   LET lockFiles = (AWAIT fs.readdir(chatsDir)).filter(f => f.endsWith('.lock'))
259:
260:   FOR EACH lockFile IN lockFiles
261:     LET lockPath = path.join(chatsDir, lockFile)
262:     LET isStale = AWAIT SessionLockManager.checkStale(lockPath)
263:
264:     IF NOT isStale THEN
265:       CONTINUE  // Active lock — leave it alone
266:     END IF
267:
268:     // Extract sessionId from lock filename (<sessionId>.lock)
269:     LET sessionId = lockFile.replace(/\.lock$/, '')
270:     LET hasJsonlFile = AWAIT fileExists(path.join(chatsDir, 'session-' + sessionId + '.jsonl'))
271:
272:     // Remove stale lock regardless (PID is dead)
273:     TRY
274:       AWAIT fs.unlink(lockPath)
275:     CATCH
276:       // Best-effort
277:     END TRY
278:
279:     // If no JSONL file: this was a never-materialized session — nothing else to clean
280:     // If JSONL file exists: this is a crashed-but-materialized session — JSONL stays for resume
281:   END FOR
282: END METHOD
```

## PID Reuse Edge Case

```
290: // PID reuse: On long-running systems, a PID can be reused after the original
291: // process dies. This creates a false-negative for stale detection
292: // (lock appears active because PID is alive, but it's a different process).
293: //
294: // Accepted risk: PID reuse is extremely rare for CLI tools. A session can
295: // legitimately run for days. No age-based override — only PID liveness matters.
296: // If the PID is alive, the lock is valid — period.
```
