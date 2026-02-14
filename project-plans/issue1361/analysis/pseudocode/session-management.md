# Pseudocode: Session Listing and Deletion (Issue #1366)

## Interface Contracts

```typescript
// INPUTS
interface ListSessionsRequest {
  chatsDir: string;
  projectHash: string;
}

interface DeleteSessionRequest {
  ref: string;            // session ID, prefix, or numeric index
  chatsDir: string;
  projectHash: string;
}

// OUTPUTS
interface ListSessionsResult {
  sessions: SessionSummary[];
}

interface DeleteSessionResult {
  ok: true;
  deletedSessionId: string;
}

interface DeleteSessionError {
  ok: false;
  error: string;
}

// DEPENDENCIES
// - SessionDiscovery (shared utility from #1365)
// - SessionLockManager (from #1367)
```

## Integration Points

```
Line 15: CALL SessionDiscovery.listSessions(chatsDir, projectHash)
         - Shared with --continue resolution

Line 50: CALL SessionLockManager.isLocked(filePath)
         - Must check before deletion

Line 60: CALL fs.unlink(filePath) + fs.unlink(lockFilePath)
         - Delete both data and sidecar lock files
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Implement separate session listing logic (duplicate of SessionDiscovery)
[OK] DO: Use shared SessionDiscovery utility

[ERROR] DO NOT: Delete without checking lock
[OK] DO: Always check advisory lock before deletion
```

## SessionDiscovery Utility (Shared)

```
10: CLASS SessionDiscovery
11:
12:   STATIC ASYNC METHOD listSessions(chatsDir: string, projectHash: string): SessionSummary[]
13:     TRY
14:       LET files = AWAIT fs.readdir(chatsDir)
15:     CATCH error
16:       IF error.code == 'ENOENT' THEN RETURN []
17:       THROW error
18:     END TRY
19:
20:     LET sessionFiles = files.filter(f => f.startsWith('session-') AND f.endsWith('.jsonl'))
21:
22:     LET summaries: SessionSummary[] = []
23:     FOR EACH fileName IN sessionFiles
24:       LET filePath = path.join(chatsDir, fileName)
25:       LET header = AWAIT readSessionHeader(filePath)
26:       IF header == null THEN CONTINUE  // invalid file, skip
27:
28:       IF header.projectHash != projectHash THEN CONTINUE  // different project
29:
30:       LET stat = AWAIT fs.stat(filePath)
31:       APPEND {
32:         sessionId: header.sessionId,
33:         filePath: filePath,
34:         startTime: header.startTime,
35:         lastModified: stat.mtime,
36:         fileSize: stat.size,
37:         provider: header.provider,
38:         model: header.model
39:       } TO summaries
40:     END FOR
41:
42:     // Sort newest-first by lastModified
43:     SORT summaries BY lastModified DESCENDING
44:     RETURN summaries
45:   END METHOD
46:
47:   STATIC METHOD resolveSessionRef(ref: string, sessions: SessionSummary[]): { session: SessionSummary } | { error: string }
48:     // 1. Exact session ID match
49:     LET exactMatch = sessions.find(s => s.sessionId == ref)
50:     IF exactMatch THEN RETURN { session: exactMatch }
51:
52:     // 2. Unique prefix match
53:     LET prefixMatches = sessions.filter(s => s.sessionId.startsWith(ref))
54:     IF prefixMatches.length == 1 THEN RETURN { session: prefixMatches[0] }
55:     IF prefixMatches.length > 1 THEN
56:       LET ids = prefixMatches.map(s => s.sessionId).join(', ')
57:       RETURN { error: "Ambiguous session prefix '" + ref + "' matches: " + ids }
58:     END IF
59:
60:     // 3. Numeric index (1-based, matching --list-sessions output)
61:     LET indexNum = parseInt(ref, 10)
62:     IF NOT isNaN(indexNum) AND indexNum >= 1 AND indexNum <= sessions.length THEN
63:       RETURN { session: sessions[indexNum - 1] }
64:     END IF
65:
66:     RETURN { error: "Session not found for this project: " + ref }
67:   END METHOD
68: END CLASS
```

## --list-sessions Command

```
75: FUNCTION ASYNC handleListSessions(chatsDir: string, projectHash: string): void
76:   LET sessions = AWAIT SessionDiscovery.listSessions(chatsDir, projectHash)
77:
78:   IF sessions.length == 0 THEN
79:     PRINT "No sessions found for this project"
80:     CALL process.exit(0)
81:   END IF
82:
83:   // Print table header
84:   PRINT "  #  Session ID   Started              Last Updated         Provider/Model          Size"
85:
86:   FOR i = 0 TO sessions.length - 1
87:     LET s = sessions[i]
88:     LET index = String(i + 1).padStart(3)
89:     LET id = s.sessionId.substring(0, 8)  // truncated for display
90:     LET started = formatDate(s.startTime)
91:     LET updated = formatDate(s.lastModified)
92:     LET providerModel = s.provider + "/" + s.model
93:     LET size = formatSize(s.fileSize)
94:     PRINT index + "  " + id + "     " + started + "  " + updated + "  " + providerModel.padEnd(24) + size
95:   END FOR
96:
97:   CALL process.exit(0)
98: END FUNCTION
```

## --delete-session Command

```
105: FUNCTION ASYNC handleDeleteSession(ref: string, chatsDir: string, projectHash: string): void
106:   LET sessions = AWAIT SessionDiscovery.listSessions(chatsDir, projectHash)
107:
108:   IF sessions.length == 0 THEN
109:     PRINT_ERROR "No sessions found for this project"
110:     CALL process.exit(1)
111:   END IF
112:
113:   // Resolve the reference
114:   LET resolved = SessionDiscovery.resolveSessionRef(ref, sessions)
115:   IF resolved.error THEN
116:     PRINT_ERROR resolved.error
117:     CALL process.exit(1)
118:   END IF
119:
120:   LET target = resolved.session
121:
122:   // Check advisory lock
123:   IF SessionLockManager.isLocked(target.filePath) THEN
124:     // Check if stale
125:     IF SessionLockManager.isStale(target.filePath) THEN
126:       // Stale lock — proceed with deletion (clean up both)
127:       AWAIT SessionLockManager.removeStaleLock(target.filePath)
128:     ELSE
129:       PRINT_ERROR "Cannot delete: session is in use by another process"
130:       CALL process.exit(1)
131:     END IF
132:   END IF
133:
134:   // Delete the session file
135:   TRY
136:     AWAIT fs.unlink(target.filePath)
137:     // Also delete sidecar lock file if exists
138:     LET lockPath = target.filePath + '.lock'
139:     TRY
140:       AWAIT fs.unlink(lockPath)
141:     CATCH
142:       // Lock file may not exist, that's fine
143:     END TRY
144:     PRINT "Deleted session " + target.sessionId
145:     CALL process.exit(0)
146:   CATCH error
147:     PRINT_ERROR "Failed to delete session: " + error.message
148:     CALL process.exit(1)
149:   END TRY
150: END FUNCTION
```

## CLI Integration in gemini.tsx

```
155: // Handle pre-run commands early in startup (before UI):
156: IF argv.listSessions THEN
157:   AWAIT handleListSessions(chatsDir, projectHash)
158:   // process.exit(0) called inside
159: END IF
160:
161: IF argv.deleteSession THEN
162:   AWAIT handleDeleteSession(argv.deleteSession, chatsDir, projectHash)
163:   // process.exit(0) or exit(1) called inside
164: END IF
```

## Helper Functions

```
170: FUNCTION formatDate(dateOrString: Date | string): string
171:   LET d = new Date(dateOrString)
172:   RETURN d.toLocaleString()  // e.g., "2026-02-10 09:15"
173: END FUNCTION
174:
175: FUNCTION formatSize(bytes: number): string
176:   IF bytes < 1024 THEN RETURN bytes + "B"
177:   IF bytes < 1024*1024 THEN RETURN Math.round(bytes/1024) + "KB"
178:   RETURN (bytes/(1024*1024)).toFixed(1) + "MB"
179: END FUNCTION
```
