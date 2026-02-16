# Pseudocode: Replay Engine (Issue #1363)

## Interface Contracts

```typescript
// INPUTS
interface ReplayInput {
  filePath: string;          // Path to .jsonl session file
  expectedProjectHash: string;  // Must match file's projectHash
}

// OUTPUTS — Discriminated union on `ok` field
type ReplayResult =
  | { ok: true; history: IContent[]; metadata: SessionMetadata; lastSeq: number; eventCount: number; warnings: string[]; sessionEvents: SessionEventPayload[] }
  | { ok: false; error: string }

// DEPENDENCIES (real, not stubbed)
// - node:fs for createReadStream
// - node:readline for line-by-line reading
// - Types from ../types.ts (SessionRecordLine, payloads)
```

## Integration Points

```
Line 20: CALL fs.createReadStream(filePath) + readline.createInterface
         - File MUST exist and be readable
         - Errors propagate as ReplayError

Line 50: VALIDATE sessionStart.projectHash against expectedProjectHash
         - Mismatch returns ReplayError, not exception
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Load entire file into memory with fs.readFile
[OK] DO: Stream line-by-line with readline interface

[ERROR] DO NOT: Parse seq values for ordering decisions
[OK] DO: Trust file order; use seq only for debugging/warnings

[ERROR] DO NOT: Throw exceptions for corruption
[OK] DO: Return error results or skip with warnings
```

## Replay Function

```
10: FUNCTION ASYNC replaySession(filePath: string, expectedProjectHash: string): ReplayResult
11:   LET history: IContent[] = []
 12:   LET metadata: SessionMetadata | null = null
 13:   LET lastSeq: number = 0
 14:   LET eventCount: number = 0
 15:   LET warnings: string[] = []
 15a:  LET sessionEvents: SessionEventPayload[] = []
 16:   LET lineNumber: number = 0
 17:   LET totalLines: number = 0
18:
19:   // Open file as line-by-line stream
20:   LET stream = fs.createReadStream(filePath, { encoding: 'utf-8' })
21:   LET reader = readline.createInterface({ input: stream })
22:
23:   TRY
24:     FOR EACH rawLine IN reader (line by line)
25:       INCREMENT lineNumber
26:       SET totalLines = lineNumber
27:
28:       IF rawLine.trim() == '' THEN CONTINUE  // skip empty lines
28a:
28b:      // Strip UTF-8 BOM if present on first line (0xEF 0xBB 0xBF = U+FEFF)
28c:      IF lineNumber == 1 AND rawLine starts with '\uFEFF' THEN
28d:        SET rawLine = rawLine.slice(1)
28e:      END IF
29:
30:       // Parse JSON line
31:       LET parsed: SessionRecordLine | null
32:       TRY
33:         SET parsed = JSON.parse(rawLine)
34:       CATCH parseError
35:         // Corruption handling: is this the last line?
36:         // We can't know yet if it's last, so record and check later
37:         APPEND "Line " + lineNumber + ": failed to parse JSON" TO warnings
38:         SET parsed = null
39:       END TRY
40:
41:       IF parsed == null THEN CONTINUE  // skip unparseable lines
42:
43:       // Track sequence numbers for debugging
44:       IF parsed.seq IS defined
45:         IF parsed.seq <= lastSeq AND eventCount > 0
46:           APPEND "Line " + lineNumber + ": non-monotonic seq " + parsed.seq + " (expected > " + lastSeq + ")" TO warnings
47:         END IF
48:         SET lastSeq = parsed.seq
49:       END IF
50:
51:       INCREMENT eventCount
52:
53:       // Process by event type
54:       SWITCH parsed.type
55:
56:         CASE 'session_start':
57:           IF lineNumber != 1 THEN
58:             APPEND "session_start at line " + lineNumber + " (expected line 1)" TO warnings
59:           END IF
60:           LET payload = parsed.payload AS SessionStartPayload
61:           // Validate required fields
62:           IF NOT payload.sessionId OR NOT payload.projectHash THEN
63:             RETURN { ok: false, error: "Invalid session_start: missing required fields" }
64:           END IF
65:           // Validate project hash
66:           IF payload.projectHash != expectedProjectHash THEN
67:             RETURN { ok: false, error: "Project hash mismatch: expected " + expectedProjectHash + " got " + payload.projectHash }
68:           END IF
69:           SET metadata = {
70:             sessionId: payload.sessionId,
71:             projectHash: payload.projectHash,
72:             provider: payload.provider,
73:             model: payload.model,
74:             workspaceDirs: payload.workspaceDirs || [],
75:             startTime: payload.startTime
76:           }
77:           BREAK
78:
79:         CASE 'content':
80:           LET contentPayload = parsed.payload AS ContentPayload
81:           IF contentPayload.content AND contentPayload.content.speaker THEN
82:             APPEND contentPayload.content TO history
83:           ELSE
84:             APPEND "Line " + lineNumber + ": malformed content event, skipping" TO warnings
85:           END IF
86:           BREAK
87:
88:         CASE 'compressed':
89:           LET compPayload = parsed.payload AS CompressedPayload
90:           IF compPayload.summary AND compPayload.summary.speaker THEN
91:             // Clear all accumulated history
92:             CLEAR history
93:             // Summary becomes the sole starting point
94:             APPEND compPayload.summary TO history
95:           ELSE
96:             APPEND "Line " + lineNumber + ": malformed compressed event, skipping" TO warnings
97:           END IF
98:           BREAK
99:
100:        CASE 'rewind':
101:          LET rewindPayload = parsed.payload AS RewindPayload
102:          LET itemsToRemove = rewindPayload.itemsRemoved
103:          IF typeof itemsToRemove != 'number' OR itemsToRemove < 0 THEN
104:            APPEND "Line " + lineNumber + ": malformed rewind event, skipping" TO warnings
105:            BREAK
106:          END IF
107:          IF itemsToRemove >= history.length THEN
108:            CLEAR history  // Full reset, not an error
109:          ELSE
110:            REMOVE last itemsToRemove items FROM history
111:          END IF
112:          BREAK
113:
114:        CASE 'provider_switch':
115:          LET switchPayload = parsed.payload AS ProviderSwitchPayload
116:          IF metadata AND switchPayload.provider THEN
117:            SET metadata.provider = switchPayload.provider
118:            SET metadata.model = switchPayload.model
119:          END IF
120:          BREAK
121:
122:        CASE 'session_event':
123:          // Operational metadata — collected for audit, NOT added to IContent[] history
124:          LET sePayload = parsed.payload AS SessionEventPayload
125:          APPEND sePayload TO sessionEvents
126:          BREAK
125:
126:        CASE 'directories_changed':
127:          LET dirPayload = parsed.payload AS DirectoriesChangedPayload
128:          IF metadata AND Array.isArray(dirPayload.directories) THEN
129:            SET metadata.workspaceDirs = dirPayload.directories
130:          END IF
131:          BREAK
132:
133:        DEFAULT:
134:          // Unknown event type — forward compatibility
135:          APPEND "Line " + lineNumber + ": unknown event type '" + parsed.type + "', skipping" TO warnings
136:          BREAK
137:
138:       END SWITCH
139:     END FOR
140:
141:   CATCH streamError
142:     RETURN { ok: false, error: "Failed to read file: " + streamError.message }
143:   END TRY
144:
145:   // Post-processing: validate we got a session_start
146:   IF metadata == null THEN
147:     IF totalLines == 0 THEN
148:       RETURN { ok: false, error: "Empty file" }
149:     ELSE
150:       RETURN { ok: false, error: "Missing or corrupt session_start event" }
151:     END IF
152:   END IF
153:
154:   // Post-processing: check if last warning was about parse failure on last line
155:   // If so, that's the "bad last line" case — downgrade from warning to silent discard
156:   LET lastWarning = warnings[warnings.length - 1]
157:   IF lastWarning AND lastWarning.startsWith("Line " + totalLines + ":") AND lastWarning.includes("failed to parse") THEN
158:     REMOVE last item FROM warnings  // Silent discard of corrupt last line
159:   END IF
160:
161:   RETURN {
162:     ok: true,
163:     history: history,
164:     metadata: metadata,
165:     lastSeq: lastSeq,
166:     eventCount: eventCount,
167:     warnings: warnings,
168:     sessionEvents: sessionEvents
169:   }
169: END FUNCTION
```

## Helper: Read Session Header (first line only)

```
175: FUNCTION ASYNC readSessionHeader(filePath: string): SessionStartPayload | null
176:   TRY
177:     LET stream = fs.createReadStream(filePath, { encoding: 'utf-8' })
178:     LET reader = readline.createInterface({ input: stream })
179:     LET firstLine: string | null = null
180:
181:     FOR EACH line IN reader
182:       SET firstLine = line
183:       BREAK  // Only read first line
184:     END FOR
185:
186:     CALL reader.close()
187:     CALL stream.destroy()
188:
189:     IF firstLine == null THEN RETURN null
190:
190a:    // Strip UTF-8 BOM if present (0xEF 0xBB 0xBF = U+FEFF)
190b:    IF firstLine starts with '\uFEFF' THEN
190c:      SET firstLine = firstLine.slice(1)
190d:    END IF
191:
192:     LET parsed = JSON.parse(firstLine)
193:     IF parsed.type != 'session_start' THEN RETURN null
193:
194:     RETURN parsed.payload AS SessionStartPayload
195:   CATCH error
196:     RETURN null
197:   END TRY
198: END FUNCTION
```
