# Pseudocode: SessionRecordingService (Issue #1362)

## Interface Contracts

```typescript
// INPUTS
interface SessionRecordingServiceConfig {
  sessionId: string;
  projectHash: string;
  chatsDir: string;
  workspaceDirs: string[];
  provider: string;
  model: string;
}

// OUTPUTS (side effect: JSONL file on disk)
// Each enqueue produces a SessionRecordLine written to file

// DEPENDENCIES (real, injected via constructor or environment)
// - node:fs/promises for file I/O
// - node:path for path construction
// - No external dependencies
```

## Integration Points

```
Line 35: CALL fs.appendFile(filePath, serializedLine)
         - fs MUST be node:fs/promises
         - Errors MUST be caught and trigger ENOSPC handling
         - File path determined by deferred materialization

Line 65: EMIT warning to UI via callback when ENOSPC detected
         - Callback MUST be injected, not hardcoded console.warn
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Write entire history as snapshot (that's the old system)
[OK] DO: Append individual events as JSONL lines

[ERROR] DO NOT: Create file eagerly on construction
[OK] DO: Defer file creation until first content event

[ERROR] DO NOT: Use synchronous fs operations in the write path
[OK] DO: Use async fs.appendFile, drain queue in background
```

## Types

```
10: TYPE SessionEventType = 'session_start' | 'content' | 'compressed'
11:   | 'rewind' | 'provider_switch' | 'session_event' | 'directories_changed'
12:
13: TYPE SessionRecordLine = {
14:   v: number           // schema version, always 1 for initial
15:   seq: number         // monotonic sequence counter
16:   ts: string          // ISO-8601 timestamp
17:   type: SessionEventType
18:   payload: unknown    // type-specific payload
19: }
20:
21: TYPE SessionStartPayload = {
22:   sessionId: string
23:   projectHash: string
24:   workspaceDirs: string[]
25:   provider: string
26:   model: string
27:   startTime: string   // ISO-8601
28: }
29:
30: TYPE ContentPayload = { content: IContent }
31: TYPE CompressedPayload = { summary: IContent, itemsCompressed: number }
32: TYPE RewindPayload = { itemsRemoved: number }
33: TYPE ProviderSwitchPayload = { provider: string, model: string }
34: TYPE SessionEventPayload = { severity: 'info'|'warning'|'error', message: string }
35: TYPE DirectoriesChangedPayload = { directories: string[] }
```

## SessionRecordingService Class

```
40: CLASS SessionRecordingService
41:   PRIVATE queue: SessionRecordLine[] = []
42:   PRIVATE seq: number = 0
43:   PRIVATE filePath: string | null = null
44:   PRIVATE materialized: boolean = false
45:   PRIVATE active: boolean = true
46:   PRIVATE draining: boolean = false
47:   PRIVATE drainPromise: Promise<void> | null = null
48:   PRIVATE sessionId: string
49:   PRIVATE projectHash: string
50:   PRIVATE chatsDir: string
51:   PRIVATE preContentBuffer: SessionRecordLine[] = []
52:
53:   CONSTRUCTOR(config: SessionRecordingServiceConfig)
54:     SET this.sessionId = config.sessionId
55:     SET this.projectHash = config.projectHash
56:     SET this.chatsDir = config.chatsDir
57:     // Buffer the session_start event
58:     LET startPayload = {
59:       sessionId: config.sessionId,
60:       projectHash: config.projectHash,
61:       workspaceDirs: config.workspaceDirs,
62:       provider: config.provider,
63:       model: config.model,
64:       startTime: new Date().toISOString()
65:     }
66:     CALL this.bufferPreContent('session_start', startPayload)
67:   END CONSTRUCTOR
68:
69:   METHOD bufferPreContent(type: string, payload: unknown): void
70:     INCREMENT this.seq
71:     LET line = {
72:       v: 1,
73:       seq: this.seq,
74:       ts: new Date().toISOString(),
75:       type: type,
76:       payload: payload
77:     }
78:     APPEND line TO this.preContentBuffer
79:   END METHOD
80:
81:   METHOD enqueue(type: string, payload: unknown): void
82:     IF NOT this.active THEN RETURN  // ENOSPC or disposed
83:
84:     IF type == 'content' AND NOT this.materialized THEN
85:       CALL this.materialize()
86:       // Flush preContentBuffer into queue first
87:       FOR EACH buffered IN this.preContentBuffer
88:         APPEND buffered TO this.queue
89:       END FOR
90:       CLEAR this.preContentBuffer
91:       SET this.materialized = true
92:     END IF
93:
94:     IF NOT this.materialized AND type != 'content' THEN
95:       // Buffer non-content events before materialization
96:       CALL this.bufferPreContent(type, payload)
97:       RETURN
98:     END IF
99:
100:    INCREMENT this.seq
101:    LET line = {
102:      v: 1,
103:      seq: this.seq,
104:      ts: new Date().toISOString(),
105:      type: type,
106:      payload: payload
107:    }
108:    APPEND line TO this.queue
109:    CALL this.scheduleDrain()
110:  END METHOD
111:
112:  METHOD materialize(): void
113:    LET timestamp = FORMAT_TIMESTAMP(new Date())  // YYYY-MM-DDTHH-MM
114:    LET prefix = this.sessionId.substring(0, 8)
115:    LET fileName = "session-" + timestamp + "-" + prefix + ".jsonl"
116:    SET this.filePath = path.join(this.chatsDir, fileName)
117:    CALL fs.mkdirSync(this.chatsDir, { recursive: true })
118:  END METHOD
119:
120:  METHOD scheduleDrain(): void
121:    IF this.draining THEN RETURN  // already draining
122:    SET this.draining = true
123:    SET this.drainPromise = this.drain()
124:  END METHOD
125:
126:  METHOD ASYNC drain(): Promise<void>
127:    WHILE this.queue.length > 0
128:      LET batch = COPY(this.queue)
129:      CLEAR this.queue
130:      LET lines = ""
131:      FOR EACH event IN batch
132:        lines += JSON.stringify(event) + "\n"
133:      END FOR
134:      TRY
135:        AWAIT fs.appendFile(this.filePath, lines, 'utf-8')
136:      CATCH error
137:        IF error.code == 'ENOSPC' OR error.code == 'EACCES' THEN
138:          SET this.active = false
139:          // Emit warning (via callback or event)
140:          RETURN
141:        END IF
142:        THROW error  // unexpected error
143:      END TRY
144:    END WHILE
145:    SET this.draining = false
146:  END METHOD
147:
148:  METHOD ASYNC flush(): Promise<void>
149:    IF NOT this.active THEN RETURN
150:    IF this.queue.length == 0 AND NOT this.draining THEN RETURN
151:    // If already draining, wait for current drain to finish
152:    IF this.drainPromise THEN
153:      AWAIT this.drainPromise
154:    END IF
155:    // If more items queued during drain, drain again
156:    IF this.queue.length > 0 THEN
157:      SET this.drainPromise = this.drain()
158:      AWAIT this.drainPromise
159:    END IF
160:  END METHOD
161:
162:  METHOD isActive(): boolean
163:    RETURN this.active
164:  END METHOD
165:
166:  METHOD getFilePath(): string | null
167:    RETURN this.filePath
168:  END METHOD
169:
170:  METHOD getSessionId(): string
171:    RETURN this.sessionId
172:  END METHOD
173:
174:  METHOD initializeForResume(filePath: string, lastSeq: number): void
175:    SET this.filePath = filePath
176:    SET this.seq = lastSeq
177:    SET this.materialized = true
178:    CLEAR this.preContentBuffer  // session_start not needed for resume
179:  END METHOD
180:
181:  METHOD dispose(): void
182:    SET this.active = false
183:    CLEAR this.queue
184:    CLEAR this.preContentBuffer
185:  END METHOD
186: END CLASS
```

## Convenience Methods (on class)

```
190: METHOD recordContent(content: IContent): void
191:   CALL this.enqueue('content', { content })
192: END METHOD
193:
194: METHOD recordCompressed(summary: IContent, itemsCompressed: number): void
195:   CALL this.enqueue('compressed', { summary, itemsCompressed })
196: END METHOD
197:
198: METHOD recordRewind(itemsRemoved: number): void
199:   CALL this.enqueue('rewind', { itemsRemoved })
200: END METHOD
201:
202: METHOD recordProviderSwitch(provider: string, model: string): void
203:   CALL this.enqueue('provider_switch', { provider, model })
204: END METHOD
205:
206: METHOD recordSessionEvent(severity: string, message: string): void
207:   CALL this.enqueue('session_event', { severity, message })
208: END METHOD
209:
210: METHOD recordDirectoriesChanged(directories: string[]): void
211:   CALL this.enqueue('directories_changed', { directories })
212: END METHOD
```


---

## Addendum: Schema Version Governance — SessionStartPayload Correction

**Per the Schema Version Governance resolution in specification.md:**

The `SessionStartPayload` type at lines 21-28 above is CORRECT as written — it does NOT include a `v` or `schemaVersion` field. The schema version is carried solely in the envelope `v` field (line 14).

The `session_start` event in the constructor (lines 58-65) correctly builds the payload without a version field. The `v: 1` at line 72 is the ENVELOPE field, not a payload field — this is the canonical and sole location for schema version.

**Verification:** In the `bufferPreContent` method (line 69-79), the `v: 1` is set on the `SessionRecordLine` envelope, never duplicated inside `payload`. The `startPayload` at lines 58-65 contains only: `sessionId`, `projectHash`, `workspaceDirs`, `provider`, `model`, `startTime`. This is correct and must not be changed.

