# Pseudocode: Concurrent Dispatch with Write Ordering

Plan ID: `PLAN-20260731-GHBROKER`
Phase: P02 (analysis) → implemented in P03
Requirement: REQ-005
Component: `packages/providers/src/auth/proxy/credential-proxy-server.ts`

---

## Contract

### Inputs
```typescript
interface ConnectionState {
  id: number;
  isSandboxConnection: boolean;
  inFlight?: Promise<void>;          // REMOVED by this phase
  pending?: Map<string, InFlightOp>; // ADDED by this phase
}

interface InFlightOp {
  op: string;
  startedAt: number;
  abort: AbortController;
}
```

### Outputs
Response frames written to the socket, one `socket.write()` per frame,
correlated to requests by `id`.

### Dependencies (NEVER stubbed)
```typescript
import net from 'node:net';   // real sockets in tests
```

---

## Finding that shapes this design

The current serialization is justified in-code as:

```
// Serialize dispatch per-connection to prevent overlapping socket.write()
// calls when multiple frames arrive in a single TCP chunk.
```

**That invariant is already guaranteed by Node.** `net.Socket` is a
`stream.Duplex`; `write(buffer)` appends the whole buffer to the stream's
internal queue. Concurrent `write()` calls from different async contexts are
appended in call order and **cannot interleave bytes mid-buffer**.

Both response paths already emit exactly one complete frame per call:

```
sendOk:    socket.write(encodeFrame({ id, ok: true, data }))
sendError: socket.write(encodeFrame({ id, ok: false, code, error }))
```

**Therefore no write queue is required.** The safe change is to remove the
handler chain while preserving the *one-frame-one-write* invariant, and to
assert that invariant with a test. This is materially smaller and lower-risk
than introducing new queueing machinery on a security-critical path — which
matters because this file is the subject of two shipped security fixes
(#2467, #2784).

Response ordering is **not** a guarantee we owe: responses carry `id`, and
`ProxySocketClient.resolvePendingRequest()` matches on `id`. Out-of-order
completion is correct by design and is the entire point of REQ-005.

---

## Algorithm

### `handleConnection(socket)` — modified

```
01: ADD state.pending = new Map<string, InFlightOp>()
02: (existing decoder / handshakeState / data handler unchanged)
03: ON socket 'close' OR 'error':
04:   FOR EACH op IN state.pending.values():
05:     CALL op.abort.abort()          // stop host-side work; no orphans
06:   CLEAR state.pending
07:   (existing cleanupConnection unchanged)
```

### `shouldContinueProcessing(socket, frame, state, handshakeState)` — modified

```
08: IF NOT handshakeState.completed:
09:   (unchanged handshake path — still strictly synchronous, so no request
10:    can be dispatched before the handshake is validated)
11:   RETURN as today
12:
13: // REMOVED: state.inFlight = (state.inFlight ?? resolve()).then(...)
14: // Dispatch concurrently. Frames from one chunk still START in arrival
15: // order because processFrames iterates synchronously; they may COMPLETE
16: // in any order, which is intended.
17: VOID this.dispatchRequest(socket, frame, state)
18:       .catch((err) => {
19:         this.auditLog('ERROR', state.id, 'unhandled_dispatch', { error: String(err) })
20:         IF NOT socket.destroyed: socket.destroy()
21:       })
22: RETURN true
```

### `dispatchRequest(socket, frame, state)` — modified

```
23: EXTRACT id, op FROM frame
24: IF state.pending.has(id):
25:   SEND error INVALID_REQUEST 'Duplicate request id'   // fail fast
26:   RETURN
27: LET controller = new AbortController()
28: state.pending.set(id, { op, startedAt: now(), abort: controller })
29: TRY:
30:   AWAIT existing handler dispatch, passing controller.signal to
31:   long-running handlers
32: FINALLY:
33:   state.pending.delete(id)
```

### Concurrency bound

```
34: CONST MAX_CONCURRENT_PER_CONNECTION = 16
35: IN dispatchRequest, BEFORE line 27:
36:   IF state.pending.size >= MAX_CONCURRENT_PER_CONNECTION:
37:     SEND error RESOURCE_EXHAUSTED 'Too many concurrent requests'
38:     RETURN
```

Rationale: removing serialization removes an implicit concurrency limit of 1.
A hostile sandbox could otherwise open unbounded concurrent host-side `gh`
processes. The bound is a genuine external-input defense (REQ-015 spirit), not
speculative hedging.

---

## Error Handling

```
39: Handler throws            → audit 'unhandled_dispatch', destroy socket
                                (unchanged from today)
40: Socket closes mid-op      → abort signal fires; handler stops; no write
                                (sendOk/sendError already no-op when
                                 socket.destroyed || !socket.writable)
41: Duplicate request id      → INVALID_REQUEST, fail fast, no dispatch
42: Concurrency cap exceeded  → RESOURCE_EXHAUSTED
```

---

## Invariants (assert in tests)

```
I1: Every response is emitted by exactly ONE socket.write() of one complete
    frame. (Guards the removed serialization's stated purpose.)
I2: No request is dispatched before handshake validation completes.
I3: A slow op never delays an unrelated op on the same connection.
I4: state.pending is empty after a connection closes.
I5: Concurrent ops never exceed MAX_CONCURRENT_PER_CONNECTION.
```

---

## Integration Points

- `credential-proxy-server.ts:215` `handleConnection` — pending map, abort on close
- `credential-proxy-server.ts:~306` `shouldContinueProcessing` — remove chain
- `credential-proxy-server.ts:~338` `dispatchRequest` — registry, cap, signal
- `credential-proxy-server.ts:991/1001` `sendOk`/`sendError` — unchanged;
  their one-write shape is now load-bearing and must be asserted

---

## Test Plan (integration first, real sockets, no mocks)

```
T1: slow op + fast op on one connection → fast returns first          (I3, REQ-005)
T2: blocking watch in flight + get_api_key → key returns immediately  (REQ-005)
T3: 200 interleaved responses under load → every frame decodes,
    no truncation, no interleaving                                     (I1)
T4: request before handshake → rejected as today                       (I2)
T5: close mid-op → abort fires, pending empty, no write after close    (I4)
T6: 17 concurrent → 17th gets RESOURCE_EXHAUSTED                       (I5)
T7: duplicate id → INVALID_REQUEST                                     (line 25)
T8: full #2467/#2784 suites pass unchanged                             (REQ-015)
```
