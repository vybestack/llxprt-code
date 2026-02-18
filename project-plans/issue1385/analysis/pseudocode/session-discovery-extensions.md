# Pseudocode: Session Discovery Extensions

## Interface Contracts

```typescript
// INPUTS for listSessionsDetailed
interface ListSessionsDetailedInput {
  chatsDir: string;       // Path to chats directory
  projectHash: string;    // Current project hash
}

// OUTPUTS for listSessionsDetailed
interface ListSessionsDetailedResult {
  sessions: SessionSummary[];  // Valid sessions, sorted newest-first
  skippedCount: number;        // Count of unreadable files
}

// INPUTS for readFirstUserMessage
interface ReadFirstUserMessageInput {
  filePath: string;    // Absolute path to JSONL session file
  maxLength?: number;  // Maximum preview length (default 120)
}

// OUTPUTS for readFirstUserMessage
// Returns: string | null (preview text or null if no user message)

// INPUTS for hasContentEvents
interface HasContentEventsInput {
  filePath: string;  // Absolute path to JSONL session file
}

// OUTPUTS for hasContentEvents
// Returns: boolean (true if file has events beyond session_start)

// DEPENDENCIES (real, no mocks)
// - node:fs/promises for file I/O
// - node:readline for line-by-line reading
// - Existing SessionDiscovery class and its internal readFirstLineFromFile()
```

## Integration Points

```
Line 15: CALL fs.open(filePath, 'r') for line-by-line reading
         - Must handle ENOENT, EACCES gracefully
         - Must close file handle in all paths

Line 35: CALL existing listSessions() internally
         - listSessionsDetailed wraps listSessions with error counting
         - Must NOT change listSessions() signature (backward compat)

Line 55: PARSE JSON line to extract content event speaker
         - Must handle malformed JSON without throwing
         - Must handle unexpected schema (missing fields)
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Modify the existing listSessions() return type
[OK] DO: Create listSessionsDetailed() as a separate method

[ERROR] DO NOT: Read the entire file to find the first user message
[OK] DO: Read line-by-line and stop after finding first user content

[ERROR] DO NOT: Return preview text longer than 120 characters
[OK] DO: Truncate to 120 chars before returning

[ERROR] DO NOT: Throw errors from readFirstUserMessage on bad data
[OK] DO: Return null for any file that can't be parsed
```

## listSessionsDetailed

```
10: STATIC METHOD ASYNC listSessionsDetailed(
11:   chatsDir: string,
12:   projectHash: string
13: ): Promise<{ sessions: SessionSummary[]; skippedCount: number }>
14:
15:   LET skippedCount = 0
16:   LET entries: string[]
17:   TRY
18:     SET entries = AWAIT fs.readdir(chatsDir)
19:   CATCH error
20:     IF error.code === 'ENOENT' THEN
21:       RETURN { sessions: [], skippedCount: 0 }
22:     END IF
23:     THROW error
24:   END TRY
25:
26:   LET sessionFiles = entries.filter(f => f.startsWith('session-') AND f.endsWith('.jsonl'))
27:   LET sessions: SessionSummary[] = []
28:
29:   FOR EACH fileName IN sessionFiles
30:     LET filePath = path.join(chatsDir, fileName)
31:     TRY
32:       LET stat = AWAIT fs.stat(filePath)
33:       LET header = AWAIT readFirstLineFromFile(filePath)
34:       IF header IS null THEN
35:         INCREMENT skippedCount
36:         CONTINUE
37:       END IF
38:       IF header.projectHash !== projectHash THEN
39:         CONTINUE  // Different project, not "skipped"
40:       END IF
41:       sessions.push({
42:         sessionId: header.sessionId,
43:         filePath: filePath,
44:         projectHash: header.projectHash,
45:         startTime: header.startTime,
46:         lastModified: stat.mtime,
47:         fileSize: stat.size,
48:         provider: header.provider,
49:         model: header.model
50:       })
51:     CATCH error
52:       INCREMENT skippedCount
53:       CONTINUE
54:     END TRY
55:   END FOR
56:
57:   // Sort newest-first with sessionId tiebreaker
58:   SORT sessions BY lastModified DESC, sessionId DESC
59:
60:   RETURN { sessions, skippedCount }
61: END METHOD
```

## hasContentEvents

```
65: STATIC METHOD ASYNC hasContentEvents(filePath: string): Promise<boolean>
66:   LET fh: FileHandle | undefined
67:   TRY
68:     SET fh = AWAIT fs.open(filePath, 'r')
69:     LET reader = readline.createInterface({ input: fh.createReadStream() })
70:     LET lineCount = 0
71:
72:     FOR AWAIT (line OF reader)
73:       INCREMENT lineCount
74:       IF lineCount === 1 THEN
75:         CONTINUE  // Skip session_start header
76:       END IF
77:       IF line.trim() !== '' THEN
78:         // Any non-empty second line means content exists
79:         CALL reader.close()
80:         AWAIT fh.close()
81:         RETURN true
82:       END IF
83:     END FOR
84:
85:     AWAIT fh.close()
86:     RETURN false  // Only had session_start or empty
87:   CATCH error
88:     AWAIT fh?.close()
89:     RETURN false  // Treat unreadable as empty
90:   END TRY
91: END METHOD
```

## readFirstUserMessage

```
95:  STATIC METHOD ASYNC readFirstUserMessage(
96:    filePath: string,
97:    maxLength: number = 120
98:  ): Promise<string | null>
99:
100:   LET fh: FileHandle | undefined
101:   TRY
102:     SET fh = AWAIT fs.open(filePath, 'r')
103:     LET reader = readline.createInterface({ input: fh.createReadStream() })
104:     LET lineNumber = 0
105:
106:     FOR AWAIT (line OF reader)
107:       INCREMENT lineNumber
108:       IF lineNumber === 1 THEN
109:         CONTINUE  // Skip session_start header
110:       END IF
111:
112:       TRY
113:         LET parsed = JSON.parse(line)
114:         IF parsed.type !== 'content' THEN
115:           CONTINUE  // Skip non-content events
116:         END IF
117:         LET payload = parsed.payload
118:         IF NOT payload OR NOT payload.content THEN
119:           CONTINUE
120:         END IF
121:         LET content = payload.content as IContent
122:         IF content.role !== 'user' THEN
123:           CONTINUE  // Only interested in user messages
124:         END IF
125:
126:         // Extract text from parts
127:         LET textParts: string[] = []
128:         IF content.parts AND Array.isArray(content.parts) THEN
129:           FOR EACH part OF content.parts
130:             IF typeof part === 'object' AND 'text' IN part AND typeof part.text === 'string' THEN
131:               textParts.push(part.text)
132:             END IF
133:           END FOR
134:         END IF
135:
136:         IF textParts.length === 0 THEN
137:           CONTINUE  // User message with no text parts
138:         END IF
139:
140:         LET fullText = textParts.join(' ').trim()
141:         IF fullText === '' THEN
142:           CONTINUE
143:         END IF
144:
145:         // Truncate to maxLength chars
146:         LET preview = fullText.length > maxLength
147:           ? fullText.substring(0, maxLength) + '...'
148:           : fullText
149:
150:         CALL reader.close()
151:         AWAIT fh.close()
152:         RETURN preview
153:
154:       CATCH parseError
155:         CONTINUE  // Skip malformed lines
156:       END TRY
157:     END FOR
158:
159:     AWAIT fh.close()
160:     RETURN null  // No user message found
161:   CATCH error
162:     AWAIT fh?.close()
163:     RETURN null  // File unreadable
164:   END TRY
165: END METHOD
```

## Core Export Updates

```
170: // In packages/core/src/recording/index.ts, ensure exports include:
171: EXPORT { SessionDiscovery } FROM './SessionDiscovery.js'
172: // listSessionsDetailed, readFirstUserMessage, hasContentEvents
173: // are static methods on SessionDiscovery — no separate export needed
174: //
175: // All three methods are new additions for PLAN-20260214-SESSIONBROWSER:
176: //   - listSessionsDetailed: REQ-SB-008 (skipped count)
177: //   - hasContentEvents: REQ-SB-005 (empty session filtering)
178: //   - readFirstUserMessage: REQ-PV-002 (first message preview)
```
