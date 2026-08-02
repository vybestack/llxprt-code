# Pseudocode: Frame Capacity, Per-Op Timeout, Cancellation

Plan ID: `PLAN-20260731-GHBROKER`
Phase: P02 (analysis) → implemented in P05
Requirements: REQ-006, REQ-007
Components: `packages/auth/src/proxy/framing.ts`,
`packages/auth/src/proxy/proxy-socket-client.ts`,
`packages/providers/src/auth/proxy/credential-proxy-server.ts`

---

## Contract

### Inputs
```typescript
interface RequestOptions {
  timeoutMs?: number;        // per-op override; defaults to REQUEST_TIMEOUT_MS
  signal?: AbortSignal;      // caller cancellation (Ctrl+C)
}
```

### Outputs
Unchanged `ProxyResponse`. New server op `cancel`. New error code
`CANCELLED`.

### Dependencies (NEVER stubbed)
```typescript
import net from 'node:net';
import crypto from 'node:crypto';
```

---

## Part A — Frame capacity (REQ-006)

Measured need: issue #1663 with comments is 50,512 bytes — 77 % of the current
64 KB cap. A PR with a full review thread exceeds it.

```
01: CHANGE MAX_FRAME_SIZE FROM 65_536 TO 4_194_304   // 4 MiB
02: KEEP the cap enforced in BOTH encodeFrame and FrameDecoder.feed
03: KEEP the 4-byte big-endian length prefix (wire format unchanged)
```

**The cap stays bounded and is not removed.** `FrameDecoder.feed` accumulates
into `this.buffer` before length validation; an unbounded cap would let a
hostile sandbox exhaust host memory. 4 MiB × 16 concurrent (per 001 line 34)
bounds worst-case buffering at 64 MiB per connection.

```
04: KEEP PARTIAL_FRAME_TIMEOUT_MS = 5000
05: NOTE: a 4 MiB frame over a Unix socket completes far inside 5 s;
06:       the partial-frame timer needs no change.
```

Responses that would still exceed 4 MiB are a **shaping failure**, not a
transport problem:

```
07: IF encodeFrame WOULD exceed MAX_FRAME_SIZE:
08:   THROW FrameError (unchanged behavior)
09: Broker-side (P10): ops cap list/search results and truncate oversized
10:   bodies with an explicit truncation marker, so this is unreachable in
11:   normal operation. Fail fast rather than silently dropping data.
```

---

## Part B — Per-op timeout (REQ-007)

Current: `REQUEST_TIMEOUT_MS = 30000` applied unconditionally in
`sendRequest`. A 15-minute CI watch cannot be expressed.

```
12: EXTEND ProxySocketClient.request(op, payload, options?)
13: IN sendRequest:
14:   LET timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS
15:   LET timer = setTimeout(() => {
16:                 this.pendingRequests.delete(id)
17:                 SEND cancel frame FOR id      // free host-side work
18:                 REJECT(new Error(`Request timed out after ${timeoutMs}ms`))
19:               }, timeoutMs)
20:   (rest of sendRequest unchanged)
```

### Idle timer interaction — the subtle part

```
21: PROBLEM: resetIdleTimer() runs on request send and on response receipt.
22:   During a 15-minute silent block there is NO traffic, so the 5-minute
23:   IDLE_TIMEOUT_MS fires gracefulClose(), which REJECTS ALL PENDING
24:   REQUESTS — killing the watch at 5 minutes.
25:
26: FIX: idle means "no work outstanding", not "no bytes moving".
27: IN resetIdleTimer():
28:   IF this.pendingRequests.size > 0:
29:     DO NOT arm the idle timer
30: IN resolvePendingRequest() and in the timeout path, AFTER deleting:
31:   IF this.pendingRequests.size === 0:
32:     ARM the idle timer
```

This preserves the idle-close behavior for genuinely idle connections (the
security-relevant case) while never closing a connection with outstanding
work. No new timer, no keepalive frames, no protocol chatter.

---

## Part C — Cancellation (REQ-007)

```
33: NEW client method: ProxySocketClient.cancel(id)
34:   IF NOT connected: RETURN
35:   WRITE frame { v: PROTOCOL_VERSION, id: newUuid(), op: 'cancel',
36:                 payload: { targetId: id } }
37:
38: IN sendRequest, IF options.signal PROVIDED:
39:   ON signal 'abort':
40:     this.pendingRequests.delete(id)
41:     CALL this.cancel(id)
42:     REJECT(new Error('Request cancelled'))
```

### Server-side `cancel` op

```
43: REGISTER handler 'cancel' IN the request handler table
44: handleCancel(socket, id, payload, state):
45:   LET targetId = payload.targetId AS string
46:   IF NOT targetId:
47:     SEND error INVALID_REQUEST 'Missing targetId'; RETURN
48:   LET target = state.pending.get(targetId)     // from 001 line 28
49:   IF target IS undefined:
50:     // already finished, or never existed — idempotent success
51:     AUDIT 'cancel' { status: 'not_found' }
52:     SEND ok { cancelled: false }; RETURN
53:   CALL target.abort.abort()
54:   AUDIT 'cancel' { op: target.op, status: 'ok' }
55:   SEND ok { cancelled: true }
56:
57: NOTE: cancel is scoped to state.pending — the CALLER'S OWN connection.
58:   One connection can never cancel another's work. This falls out of the
59:   per-connection registry and needs no extra check.
```

### Cancelled op completion

```
60: The aborted handler must settle the original request so the client's
61:   map does not leak:
62: IN dispatchRequest FINALLY (001 line 32-33):
63:   IF controller.signal.aborted AND socket writable:
64:     SEND error CANCELLED 'Operation cancelled'  FOR the original id
65: Long-running handlers (P13 watch) MUST poll signal.aborted between
66:   iterations and stop host-side work promptly.
```

---

## Part D — Version negotiation

```
67: BUMP PROTOCOL_VERSION 1 → 2
68: Server isVersionCompatible already accepts a {minVersion,maxVersion}
69:   range in the handshake payload.
70: CONTRACT (state explicitly in docs):
71:   - v2 server + v2 client → 4 MiB frames, per-op timeout, cancel
72:   - v2 server + v1 client → v1 semantics; cancel unavailable; server
73:     MUST NOT emit frames larger than 64 KiB to a v1 client
74: RECORD negotiated version ON ConnectionState AT handshake
75: IN sendOk/sendError: IF state.negotiatedVersion === 1 AND frame > 65_536:
76:   SEND error RESPONSE_TOO_LARGE instead of an undecodable frame
```

Line 75 matters: without it a v2 server silently bricks a v1 client, because
`FrameDecoder.feed` throws `FrameError` on oversize and the client destroys the
connection.

---

## Error Handling

```
77: Oversize encode          → FrameError (unchanged)
78: Oversize to v1 peer      → RESPONSE_TOO_LARGE (line 75)
79: Cancel unknown target    → ok { cancelled: false }, idempotent
80: Cancel missing targetId  → INVALID_REQUEST
81: Timeout                  → cancel sent, then reject (lines 17-18)
82: Abort signal             → cancel sent, then reject (lines 40-41)
```

---

## Invariants (assert in tests)

```
I1: MAX_FRAME_SIZE remains ENFORCED on encode and decode.
I2: A connection with pending requests is NEVER idle-closed.
I3: A connection with no pending requests IS idle-closed as before.
I4: Cancel affects only the calling connection's operations.
I5: After cancel, host-side work stops and no orphan process remains.
I6: A v1 client is never sent a frame it cannot decode.
```

---

## Test Plan (integration first, real sockets, no mocks)

```
T1:  50 KB and 500 KB payload round-trip intact                  (REQ-006)
T2:  4 MiB + 1 byte → FrameError on encode                       (I1)
T3:  op with timeoutMs 900_000 survives past 30 s                (REQ-007)
T4:  op pending past 5 min is NOT idle-closed                    (I2, fake clock)
T5:  idle connection with no pending IS closed at 5 min          (I3)
T6:  cancel stops a long op; original settles CANCELLED          (I5)
T7:  connection A cannot cancel connection B's op                (I4)
T8:  cancel unknown targetId → ok{cancelled:false}               (line 52)
T9:  v1 client + v2 server negotiates v1; oversize →
     RESPONSE_TOO_LARGE, connection survives                     (I6)
T10: capability auth still required for every new op             (REQ-015)
T11: list_api_keys still empty / has_api_key still blocked       (REQ-015)
```
