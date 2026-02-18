# Pseudocode: Framing Protocol & Socket Client

Plan ID: PLAN-20250214-CREDPROXY
Component: `packages/core/src/auth/proxy/framing.ts`, `packages/core/src/auth/proxy/proxy-socket-client.ts`

---

## Contract

### Inputs
```typescript
// Framing
interface FrameInput { payload: Record<string, unknown> }
interface RawBytes { data: Buffer }

// Socket Client
interface SocketClientConfig { socketPath: string }
interface ProxyRequest { op: string; payload: Record<string, unknown> }
```

### Outputs
```typescript
interface FrameOutput { buffer: Buffer } // 4-byte length prefix + JSON
interface ParsedFrame { payload: Record<string, unknown> }
interface ProxyResponse { ok: boolean; data?: Record<string, unknown>; error?: string; code?: string; retryAfter?: number }
```

### Dependencies (NEVER stubbed)
```typescript
import net from 'node:net';       // Real Node.js net module
import crypto from 'node:crypto'; // For request ID generation
```

---

## Integration Points

- Line 15: `net.createConnection(socketPath)` — creates Unix domain socket connection
- Line 31: `socket.write(frame)` — sends framed data; socket MUST be connected
- Line 60: `socket.on('data', handler)` — receives framed data; data may arrive in chunks

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Use newline-delimited JSON
[OK]    DO: Use 4-byte uint32 BE length prefix + JSON payload

[ERROR] DO NOT: Allocate buffer before validating length against MAX_FRAME_SIZE
[OK]    DO: Validate length prefix FIRST, then allocate

[ERROR] DO NOT: Assume data events contain exactly one frame
[OK]    DO: Buffer incoming data, parse frames from accumulator
```

---

## Pseudocode: Frame Encoding

```
 1: CONSTANT MAX_FRAME_SIZE = 65536
 2:
 3: FUNCTION encodeFrame(payload: object): Buffer
 4:   SET json = JSON.stringify(payload)
 5:   SET jsonBytes = Buffer.from(json, 'utf8')
 6:   IF jsonBytes.length > MAX_FRAME_SIZE
 7:     THROW FrameError('Frame exceeds maximum size')
 8:   SET header = Buffer.alloc(4)
 9:   header.writeUInt32BE(jsonBytes.length, 0)
10:   RETURN Buffer.concat([header, jsonBytes])
```

## Pseudocode: Frame Decoding (Streaming)

```
11: CLASS FrameDecoder
12:   STATE buffer: Buffer = Buffer.alloc(0)
13:   STATE partialFrameTimer: NodeJS.Timeout | null = null
14:   CONSTANT PARTIAL_FRAME_TIMEOUT_MS = 5000
15:
16:   METHOD feed(chunk: Buffer): ParsedFrame[]
17:     APPEND chunk to this.buffer
18:     SET frames = []
19:     WHILE this.buffer.length >= 4
20:       SET payloadLength = this.buffer.readUInt32BE(0)
21:       IF payloadLength > MAX_FRAME_SIZE
22:         THROW FrameError('Frame exceeds maximum size')
23:       IF this.buffer.length < 4 + payloadLength
24:         START partial frame timer IF not already running
25:         BREAK (incomplete frame, wait for more data)
26:       CANCEL partial frame timer
27:       SET jsonBytes = this.buffer.subarray(4, 4 + payloadLength)
28:       SET this.buffer = this.buffer.subarray(4 + payloadLength)
29:       SET parsed = JSON.parse(jsonBytes.toString('utf8'))
30:       PUSH parsed to frames
31:     RETURN frames
32:
33:   METHOD startPartialFrameTimer(onTimeout: () => void)
34:     IF this.partialFrameTimer IS NOT null THEN RETURN
35:     SET this.partialFrameTimer = setTimeout(onTimeout, PARTIAL_FRAME_TIMEOUT_MS)
36:
37:   METHOD cancelPartialFrameTimer()
38:     IF this.partialFrameTimer IS NOT null
39:       clearTimeout(this.partialFrameTimer)
40:       SET this.partialFrameTimer = null
41:
42:   METHOD reset()
43:     SET this.buffer = Buffer.alloc(0)
44:     CALL cancelPartialFrameTimer()
```

## Pseudocode: ProxySocketClient

```
45: CLASS ProxySocketClient
46:   STATE socket: net.Socket | null = null
47:   STATE decoder: FrameDecoder = new FrameDecoder()
48:   STATE pendingRequests: Map<string, {resolve, reject, timer}> = new Map()
49:   STATE handshakeComplete: boolean = false
50:   STATE idleTimer: NodeJS.Timeout | null = null
51:   CONSTANT REQUEST_TIMEOUT_MS = 30000
52:   CONSTANT IDLE_TIMEOUT_MS = 300000
53:   CONSTANT PROTOCOL_VERSION = 1
54:
55:   CONSTRUCTOR(socketPath: string)
56:     STORE socketPath
57:
58:   METHOD async ensureConnected(): Promise<void>
59:     IF this.socket IS NOT null AND this.handshakeComplete
60:       RESET idle timer
61:       RETURN
62:     CALL await this.connect()
63:     CALL await this.handshake()
64:
65:   METHOD async connect(): Promise<void>
66:     SET this.socket = net.createConnection(this.socketPath)
67:     SET this.decoder = new FrameDecoder()
68:     REGISTER socket.on('data', chunk => this.onData(chunk))
69:     REGISTER socket.on('error', err => this.onError(err))
70:     REGISTER socket.on('close', () => this.onClose())
71:     AWAIT socket 'connect' event
72:
73:   METHOD async handshake(): Promise<void>
74:     SET request = { v: PROTOCOL_VERSION, op: 'handshake', payload: { minVersion: 1, maxVersion: 1 } }
75:     SEND encodeFrame(request) to socket
76:     SET response = AWAIT first decoded frame (with timeout)
77:     IF response.ok IS NOT true
78:       THROW ProxyError('Version mismatch: ' + response.error)
79:     SET this.handshakeComplete = true
80:     START idle timer
81:
82:   METHOD async request(op: string, payload: object): Promise<ProxyResponse>
83:     CALL await this.ensureConnected()
84:     SET id = crypto.randomUUID()
85:     SET frame = { v: PROTOCOL_VERSION, id, op, payload }
86:     SET promise = new Promise with stored resolve/reject
87:     SET timer = setTimeout(() => reject(TimeoutError), REQUEST_TIMEOUT_MS)
88:     STORE { resolve, reject, timer } in pendingRequests keyed by id
89:     SEND encodeFrame(frame) to socket
90:     RESET idle timer
91:     RETURN await promise
92:
93:   METHOD onData(chunk: Buffer)
94:     TRY
95:       SET frames = this.decoder.feed(chunk)
96:       FOR EACH frame in frames
97:         SET pending = this.pendingRequests.get(frame.id)
98:         IF pending EXISTS
99:           clearTimeout(pending.timer)
100:          this.pendingRequests.delete(frame.id)
101:          pending.resolve(frame)
102:    CATCH error
103:      CALL this.destroy('Frame decode error')
104:
105:  METHOD onError(err: Error)
106:    CALL this.destroy('Credential proxy connection lost. Restart the session.')
107:
108:  METHOD onClose()
109:    IF this.handshakeComplete (unexpected close, not idle)
110:      CALL this.destroy('Credential proxy connection lost. Restart the session.')
111:
112:  METHOD destroy(message: string)
113:    CANCEL idle timer
114:    CANCEL all pending request timers
115:    REJECT all pending requests with Error(message)
116:    CLEAR pendingRequests
117:    SET this.handshakeComplete = false
118:    IF this.socket IS NOT null
119:      this.socket.destroy()
120:      SET this.socket = null
121:    this.decoder.reset()
122:
123:  METHOD resetIdleTimer()
124:    CANCEL current idle timer
125:    SET this.idleTimer = setTimeout(() => this.gracefulClose(), IDLE_TIMEOUT_MS)
126:
127:  METHOD gracefulClose()
128:    SET this.handshakeComplete = false
129:    IF this.socket IS NOT null
130:      this.socket.end()
131:      SET this.socket = null
132:    this.decoder.reset()
133:    // Next request will reconnect via ensureConnected()
134:
135:  METHOD close()
136:    CANCEL idle timer
137:    CALL this.destroy('Client closed')
```
