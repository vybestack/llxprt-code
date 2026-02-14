# Pseudocode: Session Cleanup Adaptation (Issue #1369)

## Interface Contracts

```typescript
// INPUTS (same as existing cleanupExpiredSessions)
// - Config (for chatsDir, sessionId, debug mode)
// - Settings (for retention config)

// OUTPUTS (same interface: CleanupResult)

// NEW DEPENDENCIES
// - SessionLockManager (from #1367) for lock-aware protection
```

## Integration Points

```
Line 25: CALL SessionLockManager.isLocked(filePath)
         - Check before deletion of .jsonl files

Line 40: CALL SessionLockManager.checkStale(lockPath)
         - For stale lock cleanup

Line 55: CALL SessionLockManager.removeStaleLock(filePath)
         - Clean up stale locks
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Delete locked files
[OK] DO: Always check lock status before deletion

[ERROR] DO NOT: Leave orphaned lock files
[OK] DO: Clean up .lock files with no corresponding .jsonl

[ERROR] DO NOT: Handle old .json files in the new cleanup code
[OK] DO: Only target session-*.jsonl — old .json cleanup is preexisting and untouched
```

## File Pattern Scanning

```
10: // In sessionUtils.ts or equivalent:
11: // Scan for session-*.jsonl files only
12:
13: FUNCTION ASYNC getAllSessionFiles(chatsDir: string, currentSessionId: string): SessionFileEntry[]
14:   TRY
15:     LET files = AWAIT fs.readdir(chatsDir)
16:   CATCH error
17:     IF error.code == 'ENOENT' THEN RETURN []
18:     THROW error
19:   END TRY
20:
21:   LET entries: SessionFileEntry[] = []
22:
23:   // Match session-*.jsonl files
24:   LET sessionFiles = files.filter(f => f.startsWith('session-') AND f.endsWith('.jsonl'))
25:   FOR EACH fileName IN sessionFiles
26:     LET filePath = path.join(chatsDir, fileName)
27:     LET stat = AWAIT fs.stat(filePath)
28:     LET header = AWAIT readSessionHeader(filePath)
29:     LET info = header ? {
30:       id: header.sessionId,
31:       lastUpdated: stat.mtime.toISOString(),
32:       isCurrentSession: header.sessionId == currentSessionId
33:     } : null
34:     APPEND { fileName, filePath, stat, sessionInfo: info } TO entries
35:   END FOR
36:
37:   RETURN entries
38: END FUNCTION
```

## Lock-Aware Active Protection

```
50: // Lock-based active session protection for .jsonl files:
51:
52: FUNCTION ASYNC shouldDeleteSession(entry: SessionFileEntry): 'delete' | 'skip' | 'stale-lock-only'
53:   // Check lock
54:   LET lockPath = entry.filePath + '.lock'
55:   LET lockExists: boolean
56:   TRY
57:     AWAIT fs.access(lockPath)
58:     SET lockExists = true
59:   CATCH
60:     SET lockExists = false
61:   END TRY
62:
63:   IF NOT lockExists THEN
64:     RETURN 'delete'  // No lock, eligible for policy-based deletion
65:   END IF
66:
67:   // Lock exists — check if stale
68:   LET isStale = AWAIT SessionLockManager.checkStale(lockPath)
69:   IF isStale THEN
70:     RETURN 'stale-lock-only'  // Lock is stale: remove lock, but data file subject to normal policy only
71:   ELSE
72:     RETURN 'skip'  // Active process, do not touch
73:   END IF
74: END FUNCTION
```

## Stale Lock Cleanup

```
85: FUNCTION ASYNC cleanupStaleLocks(chatsDir: string): number
86:   LET files = AWAIT fs.readdir(chatsDir)
87:   LET lockFiles = files.filter(f => f.endsWith('.lock'))
88:   LET cleaned = 0
89:
90:   FOR EACH lockFileName IN lockFiles
91:     LET lockPath = path.join(chatsDir, lockFileName)
92:
93:     // Check for orphaned lock (no corresponding .jsonl)
94:     LET dataFileName = lockFileName.replace('.lock', '')
95:     LET dataPath = path.join(chatsDir, dataFileName)
96:     LET dataExists: boolean
97:     TRY
98:       AWAIT fs.access(dataPath)
99:       SET dataExists = true
100:    CATCH
101:      SET dataExists = false
102:    END TRY
103:
104:    IF NOT dataExists THEN
105:      // Orphaned lock — delete it
106:      TRY
107:        AWAIT fs.unlink(lockPath)
108:        INCREMENT cleaned
109:      CATCH
110:        // Best-effort
111:      END TRY
112:      CONTINUE
113:    END IF
114:
115:    // Lock has data file — check if stale
116:    LET isStale = AWAIT SessionLockManager.checkStale(lockPath)
117:    IF isStale THEN
118:      // Stale lock — don't delete data file here (let age/count policy handle it)
119:      // But do remove the stale lock
120:      TRY
121:        AWAIT fs.unlink(lockPath)
122:        INCREMENT cleaned
123:      CATCH
124:        // Best-effort
125:      END TRY
126:    END IF
127:  END FOR
128:
129:  RETURN cleaned
130: END FUNCTION
```

## Updated identifySessionsToDelete

```
135: // Modify identifySessionsToDelete to use lock-aware logic:
136: FUNCTION ASYNC identifySessionsToDelete(
137:   allFiles: SessionFileEntry[],
138:   retentionConfig: SessionRetentionSettings
139: ): SessionFileEntry[]
140:   LET sessionsToDelete: SessionFileEntry[] = []
141:
142:   // Corrupted files (null sessionInfo) — always delete
143:   APPEND allFiles.filter(e => e.sessionInfo == null) TO sessionsToDelete
144:
145:   // Valid sessions
146:   LET validSessions = allFiles.filter(e => e.sessionInfo != null)
147:
148:   // Evaluate each for deletion
149:   FOR EACH entry IN validSessions
150:     LET action = AWAIT shouldDeleteSession(entry)
151:     IF action == 'skip' THEN CONTINUE
152:     IF action == 'stale-delete' THEN
153:       // Delete stale lock file too
154:       AWAIT SessionLockManager.removeStaleLock(entry.filePath)
155:       // Fall through to normal deletion evaluation
156:     END IF
157:
158:     // Apply age/count policy (same as existing logic)
159:     LET shouldDelete = evaluateRetentionPolicy(entry, retentionConfig)
160:     IF shouldDelete OR action == 'stale-delete' THEN
161:       APPEND entry TO sessionsToDelete
162:     END IF
163:   END FOR
164:
165:   RETURN sessionsToDelete
166: END FUNCTION
```

## Cleanup Timing

```
170: // Existing cleanup runs at startup — no change needed to timing.
171: // Add stale lock cleanup as part of the startup cleanup:
172:
173: FUNCTION ASYNC cleanupExpiredSessions(config, settings): CleanupResult
174:   // ... existing early-exit checks ...
175:
176:   // NEW: Clean up stale locks first
177:   AWAIT cleanupStaleLocks(chatsDir)
178:
179:   // ... existing session file scanning and deletion ...
180: END FUNCTION
```



---

## CORRECTION: Stale-Lock Cleanup Policy (Architecture Review FIX 5)

**A stale lock does NOT justify deleting the session data file.** A crashed session with a stale lock may be perfectly recoverable. The lock is removed, but the JSONL file is ONLY deleted if it ALSO independently meets the age/count retention policy.

### Corrected `shouldDeleteSession` Return Values

The `stale-delete` action is REMOVED. Instead:

```
FUNCTION ASYNC shouldDeleteSession(entry): 'delete' | 'skip' | 'stale-lock-only'
  // ... (lock existence check — see lines 54-65 above) ...

  IF NOT lockExists THEN
    RETURN 'delete'  // No lock, eligible for policy-based deletion
  END IF

  LET isStale = AWAIT SessionLockManager.checkStale(lockPath)
  IF isStale THEN
    RETURN 'stale-lock-only'  // Lock is stale: remove lock, but data file subject to normal policy only
  ELSE
    RETURN 'skip'  // Active process, do not touch
  END IF
END FUNCTION
```

### Corrected `identifySessionsToDelete`

**Lines 152-161 are replaced.** The `OR action == 'stale-delete'` clause is REMOVED:

```
FOR EACH entry IN validSessions
  LET action = AWAIT shouldDeleteSession(entry)
  IF action == 'skip' THEN CONTINUE
  IF action == 'stale-lock-only' THEN
    // Remove the stale lock file, but do NOT auto-delete the session data
    AWAIT SessionLockManager.removeStaleLock(entry.filePath)
    // FALL THROUGH to normal retention policy check — lock staleness is NOT
    // sufficient reason to delete the data file
  END IF

  // Apply age/count policy (same as existing logic)
  LET shouldDelete = evaluateRetentionPolicy(entry, retentionConfig)
  IF shouldDelete THEN
    APPEND entry TO sessionsToDelete
  END IF
END FOR
```

**Key change:** `IF shouldDelete OR action == 'stale-delete'` → `IF shouldDelete`. The stale lock status only affects lock file cleanup; it does NOT override the retention policy for the data file.
