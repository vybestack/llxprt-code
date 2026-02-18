# Phase 04: Framing Protocol — TDD

## Phase ID
`PLAN-20250214-CREDPROXY.P04`

## Prerequisites
- Required: Phase 03a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P03" packages/core/src/auth/proxy/`
- Expected files: `packages/core/src/auth/proxy/framing.ts`, `packages/core/src/auth/proxy/proxy-socket-client.ts`

## Requirements Implemented (Expanded)

### R5.1: Length-Prefixed Framing
**Behavior**:
- GIVEN: `{ op: "get_token", payload: { provider: "anthropic" } }`
- WHEN: `encodeFrame(payload)` is called
- THEN: Returns Buffer where first 4 bytes = uint32BE of JSON length, remaining bytes = UTF-8 JSON
**Why This Matters**: Core transport mechanism — if this breaks, no credential operations work.

### R5.2: Maximum Frame Size Enforcement
**Behavior**:
- GIVEN: A payload that serializes to > 65536 bytes
- WHEN: `encodeFrame(oversizedPayload)` is called
- THEN: Throws `FrameError` with message about exceeding maximum size
**Why This Matters**: Without this, a malicious client could cause OOM on the server.

### R5.3: Partial Frame Timeout
**Behavior**:
- GIVEN: A FrameDecoder receives 4 header bytes indicating a 1000-byte payload
- WHEN: Only 500 bytes arrive and 5 seconds elapse
- THEN: The timeout callback fires
**Why This Matters**: Prevents slowloris connections from exhausting server resources.

### R6.1–R6.4: Handshake Protocol
**Behavior**:
- GIVEN: A ProxySocketClient connected to a server
- WHEN: The handshake completes successfully
- THEN: `handshakeComplete` is true and subsequent requests include `id` fields

### R24.1: Request Timeout
**Behavior**:
- GIVEN: A request sent via `ProxySocketClient.request()`
- WHEN: No response arrives within 30 seconds
- THEN: The request promise rejects with a timeout error

## Implementation Tasks

### Files to Create
- `packages/core/src/auth/proxy/__tests__/framing.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P04`
  - 15–20 behavioral tests covering:
    - Frame encoding: correct length prefix, correct JSON payload
    - Frame encoding: roundtrip (encode → decode → original)
    - Frame encoding: empty payload `{}`
    - Frame encoding: payload with special characters (newlines, unicode)
    - Frame encoding: oversized payload throws FrameError (R5.2)
    - Frame decoding: single complete frame
    - Frame decoding: multiple frames in one chunk
    - Frame decoding: frame split across chunks
    - Frame decoding: oversized frame length prefix rejects before allocation
    - Partial frame timeout fires after 5s (R5.3)
    - Partial frame timeout cancelled on complete frame

- `packages/core/src/auth/proxy/__tests__/proxy-socket-client.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P04`
  - 10–15 behavioral tests covering:
    - Handshake sends correct version frame (R6.1)
    - Handshake rejects on version mismatch (R6.3)
    - Request generates unique ID and sends framed data (R6.4)
    - Request timeout after 30s (R24.1)
    - Idle timeout triggers graceful close after 5min (R24.2)
    - Connection error surfaces "Credential proxy connection lost" message
    - Multiple concurrent requests correlate responses by ID
    - Reconnection after idle close sends new handshake

### Test Rules
- Tests expect REAL BEHAVIOR (encode/decode actual data)
- NO testing for NotYetImplemented
- NO reverse tests (expect().not.toThrow())
- Each test has `@requirement` and `@scenario` comments
- Tests WILL FAIL naturally until implementation phase

### Required Test Pattern
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P04
 * @requirement R5.1
 * @scenario Encode a simple JSON payload
 * @given { op: "get_token", payload: { provider: "anthropic" } }
 * @when encodeFrame() is called
 * @then Returns Buffer with 4-byte length prefix + JSON bytes
 */
it('encodes a JSON payload with length prefix', () => {
  const payload = { op: 'get_token', payload: { provider: 'anthropic' } };
  const frame = encodeFrame(payload);
  const length = frame.readUInt32BE(0);
  const json = frame.subarray(4).toString('utf8');
  expect(JSON.parse(json)).toEqual(payload);
  expect(length).toBe(frame.length - 4);
});
```

## Verification Commands

```bash
# Check test files exist
test -f packages/core/src/auth/proxy/__tests__/framing.test.ts || echo "FAIL"
test -f packages/core/src/auth/proxy/__tests__/proxy-socket-client.test.ts || echo "FAIL"

# Check for mock theater
grep -r "toHaveBeenCalled\b" packages/core/src/auth/proxy/__tests__/ && echo "FAIL: Mock verification found"

# Check for reverse testing
grep -r "toThrow.*NotYetImplemented\|expect.*not\.toThrow()" packages/core/src/auth/proxy/__tests__/ && echo "FAIL: Reverse testing found"

# Check behavioral assertions exist
grep -cE "toBe\(|toEqual\(|toMatch\(|toContain\(" packages/core/src/auth/proxy/__tests__/framing.test.ts
# Expected: 15+ assertions

# Tests should fail naturally (stubs not implemented yet)
npm test -- packages/core/src/auth/proxy/__tests__/framing.test.ts 2>&1 | head -20
```

## Success Criteria
- 25–35 behavioral tests across both files
- Tests fail naturally with "NotYetImplemented" or property access errors
- Zero mock theater or reverse testing
- All tests tagged with plan and requirement IDs

## Failure Recovery
1. `git checkout -- packages/core/src/auth/proxy/__tests__/`
2. Re-read pseudocode 001 and specification R5/R6/R24

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P04.md`
