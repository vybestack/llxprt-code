# Phase 05: Framing Protocol — Implementation

## Phase ID
`PLAN-20250214-CREDPROXY.P05`

## Prerequisites
- Required: Phase 04a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P04" packages/core/src/auth/proxy/__tests__/`
- Expected files: Test files from P04, stub files from P03

## Requirements Implemented (Expanded)

### R5.1–R5.4, R6.1–R6.5, R24.1, R24.2, R24.4
(See Phase 03 for full requirement expansion)

## Implementation Tasks

### Files to Modify (NOT create new)
- `packages/core/src/auth/proxy/framing.ts` — UPDATE stub with full implementation
  - MUST follow pseudocode `analysis/pseudocode/001-framing-protocol.md` lines 1–44
  - Line 1: MAX_FRAME_SIZE = 65536
  - Lines 3–10: encodeFrame() — stringify, check size, write header, concat
  - Lines 11–44: FrameDecoder class — buffer accumulation, frame parsing, partial timer

- `packages/core/src/auth/proxy/proxy-socket-client.ts` — UPDATE stub with full implementation
  - MUST follow pseudocode `analysis/pseudocode/001-framing-protocol.md` lines 45–137
  - Lines 45–57: ProxySocketClient class, state, constants
  - Lines 58–64: ensureConnected() — lazy connect + handshake
  - Lines 65–80: connect() + handshake() — socket creation, version negotiation
  - Lines 82–91: request() — ID generation, framing, timeout, response correlation
  - Lines 93–137: onData, onError, onClose, destroy, resetIdleTimer, gracefulClose, close

### FORBIDDEN
- Do NOT modify any test files
- Do NOT create `framingV2.ts` or `proxy-socket-client-new.ts`
- No TODO/FIXME/HACK comments in implementation
- No `console.log` or debug code

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P05
 * @requirement R5.1, R5.2, R5.3, R6.1-R6.5, R24.1, R24.2, R24.4
 * @pseudocode analysis/pseudocode/001-framing-protocol.md lines 1-137
 */
```

## Verification Commands

```bash
# All tests pass
npm test -- packages/core/src/auth/proxy/__tests__/framing.test.ts
npm test -- packages/core/src/auth/proxy/__tests__/proxy-socket-client.test.ts

# No test modifications
git diff packages/core/src/auth/proxy/__tests__/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"

# No debug code
grep -rn "console\.\|TODO\|FIXME\|XXX\|HACK" packages/core/src/auth/proxy/framing.ts packages/core/src/auth/proxy/proxy-socket-client.ts | grep -v ".test.ts"

# No duplicate files
find packages/ -name "*framingV2*" -o -name "*proxy-socket-client-new*" && echo "FAIL"

# Verify pseudocode compliance
# Compare implementation with pseudocode lines 1-137
# Every numbered pseudocode step must be traceable in implementation

# TypeScript compiles
npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/auth/proxy/framing.ts packages/core/src/auth/proxy/proxy-socket-client.ts
# Expected: No matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/auth/proxy/framing.ts packages/core/src/auth/proxy/proxy-socket-client.ts
# Expected: No matches

grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/auth/proxy/framing.ts packages/core/src/auth/proxy/proxy-socket-client.ts
# Expected: No matches in implementation (stubs replaced)
```

## Semantic Verification Checklist
1. **Does encodeFrame produce correct wire format?** — 4-byte BE length + JSON bytes
2. **Does FrameDecoder handle chunked data?** — Buffer accumulation, multiple frames per chunk
3. **Does ProxySocketClient correlate request/response by ID?** — Map-based pending request tracking
4. **Are timeouts implemented?** — 30s request, 5min idle, 5s partial frame

## Success Criteria
- All tests pass
- No test modifications
- Implementation follows pseudocode lines 1–137
- No deferred implementation markers
- TypeScript compiles cleanly

## Failure Recovery
1. `git checkout -- packages/core/src/auth/proxy/framing.ts packages/core/src/auth/proxy/proxy-socket-client.ts`
2. Re-read pseudocode and fix implementation

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P05.md`
