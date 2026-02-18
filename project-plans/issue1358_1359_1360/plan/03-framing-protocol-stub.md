# Phase 03: Framing Protocol — Stub

## Phase ID
`PLAN-20250214-CREDPROXY.P03`

## Prerequisites
- Required: Phase 02a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P02a" . 2>/dev/null || test -f project-plans/issue1358_1359_1360/.completed/P02a.md`
- Expected files from previous phase: All 9 pseudocode files in `analysis/pseudocode/`
- Preflight verification: Phase 00a MUST be completed

## Requirements Implemented (Expanded)

### R5.1: Length-Prefixed Framing
**Full Text**: All messages shall use length-prefixed framing: 4-byte uint32 big-endian length followed by a JSON payload of exactly that length.
**Behavior**:
- GIVEN: A JSON payload to send over the socket
- WHEN: `encodeFrame(payload)` is called
- THEN: Returns a Buffer of `[4-byte uint32 BE length][JSON bytes]`
**Why This Matters**: Newline-delimited JSON breaks on payloads containing newlines. Length-prefixed framing is unambiguous and supports arbitrary JSON content.

### R5.2: Maximum Frame Size
**Full Text**: The maximum frame size shall be 64KB (65536 bytes). The length prefix shall be validated against this limit before allocating a buffer.
**Behavior**:
- GIVEN: An incoming frame with length prefix > 65536
- WHEN: The frame decoder reads the length prefix
- THEN: The connection is closed with a FrameError before any buffer allocation
**Why This Matters**: Prevents memory exhaustion from malicious or buggy oversized frames.

### R5.3: Partial Frame Timeout
**Full Text**: If a frame header is received but the full payload does not arrive within 5 seconds, then the server shall close the connection.
**Behavior**:
- GIVEN: A frame header (4 bytes) is received
- WHEN: The remaining payload bytes do not arrive within 5 seconds
- THEN: The connection is closed
**Why This Matters**: Prevents slowloris-style resource exhaustion attacks.

### R6.1–R6.5: Protocol Handshake
**Full Text**: Client sends version handshake on connection. Server responds with negotiated version or rejects. All post-handshake frames carry request IDs.
**Behavior**:
- GIVEN: A new socket connection
- WHEN: Client sends `{v:1, op:"handshake", payload:{minVersion:1, maxVersion:1}}`
- THEN: Server responds with `{v:1, op:"handshake", ok:true, data:{version:1}}`
**Why This Matters**: Ensures client and server protocol versions are compatible before any credential operations.

### R24.1: Per-Request Timeout (30s)
**Full Text**: Per-request client-side timeout shall be 30 seconds.
**Behavior**:
- GIVEN: A request sent to the proxy
- WHEN: No response arrives within 30 seconds
- THEN: The request is rejected with a timeout error
**Why This Matters**: Prevents the inner process from hanging indefinitely on a stalled proxy.

### R24.2: Idle Connection Timeout (5min)
**Full Text**: Idle connection timeout shall be 5 minutes. Client initiates graceful close on idle. Next operation reconnects.
**Behavior**:
- GIVEN: No requests sent for 5 minutes
- WHEN: The idle timer fires
- THEN: Client gracefully closes the connection; next operation reconnects with new handshake
**Why This Matters**: Releases resources when the proxy isn't actively used while allowing transparent reconnection.

## Implementation Tasks

### Files to Create
- `packages/core/src/auth/proxy/framing.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P03`
  - Exports: `encodeFrame`, `FrameDecoder`, `MAX_FRAME_SIZE`, `PARTIAL_FRAME_TIMEOUT_MS`
  - All methods throw `new Error('NotYetImplemented')` or return empty values
  - Maximum 60 lines

- `packages/core/src/auth/proxy/proxy-socket-client.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P03`
  - Exports: `ProxySocketClient` class
  - Methods: `ensureConnected()`, `request()`, `close()`, `gracefulClose()`
  - All methods throw `new Error('NotYetImplemented')` or return empty values
  - Maximum 40 lines

### Files to Modify
None — these are new files.

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P03
 * @requirement R5.1, R5.2, R5.3, R6.1-R6.5, R24.1, R24.2
 * @pseudocode analysis/pseudocode/001-framing-protocol.md
 */
```

## Verification Commands

### Automated Checks
```bash
# Check files exist
test -f packages/core/src/auth/proxy/framing.ts || echo "FAIL: framing.ts missing"
test -f packages/core/src/auth/proxy/proxy-socket-client.ts || echo "FAIL: proxy-socket-client.ts missing"

# Check plan markers
grep -r "@plan:PLAN-20250214-CREDPROXY.P03" packages/core/src/auth/proxy/ | wc -l
# Expected: 2+ occurrences

# Check for version duplication
find packages/ -name "*V2*" -o -name "*New*" -o -name "*Copy*" | grep -i frame
# Expected: no results

# TypeScript compiles
npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/auth/proxy/framing.ts packages/core/src/auth/proxy/proxy-socket-client.ts | grep -v ".test.ts"
# Expected: Only NotYetImplemented throws (acceptable in stub phase)
```

### Semantic Verification Checklist
1. **Do the stubs compile?** `npm run typecheck`
2. **Are exports correct?** Verify `encodeFrame`, `FrameDecoder`, `ProxySocketClient` are exported
3. **No parallel versions?** No `framingV2.ts` or similar

## Success Criteria
- Both files created with proper plan markers
- TypeScript compiles cleanly
- Exports match pseudocode contract
- No TODO comments (only NotYetImplemented throws)

## Failure Recovery
1. `git checkout -- packages/core/src/auth/proxy/`
2. Re-read pseudocode 001 and retry

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P03.md`
