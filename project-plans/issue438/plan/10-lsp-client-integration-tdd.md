# Phase 10: LSP Client Integration TDD

## Phase ID
`PLAN-20250212-LSP.P10`

## Prerequisites
- Required: Phase 09a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P09" packages/lsp/src/service/lsp-client.ts`
- Expected: LspClient stub compiles with typed methods

## Requirements Implemented (Expanded)

Integration tests that verify LspClient works with a fake LSP server fixture. These exercise the real LSP protocol flow: initialize handshake → didOpen → publishDiagnostics → diagnostic extraction.

### REQ-LIFE-010: Lazy Startup
**Full Text**: When the first file of a given language is touched, the system shall start the appropriate LSP server(s).
**Behavior**:
- GIVEN: An LspClient configured for TypeScript with tsserver command
- WHEN: initialize() is called
- THEN: The LSP server process is started and the initialize/initialized handshake completes

### REQ-TIME-050: Debounce
**Full Text**: The system shall apply a 150 ms debounce period to allow rapid successive diagnostic updates from the server to settle.
**Behavior**:
- GIVEN: An initialized LspClient
- WHEN: touchFile is called and server sends 3 rapid publishDiagnostics notifications
- THEN: waitForDiagnostics returns the final (settled) diagnostics, not intermediate ones

### REQ-LIFE-070: Crash Handling
**Full Text**: If an individual LSP server crashes, the system shall mark it as broken and not restart it.
**Behavior**:
- GIVEN: An initialized, running LspClient
- WHEN: The server process exits unexpectedly
- THEN: isAlive() returns false, subsequent touchFile calls are no-ops

## Implementation Tasks

### Files to Create

- `packages/lsp/test/lsp-client-integration.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P10`
  - Tests use `test/fixtures/fake-lsp-server.ts` (from Phase 03)
  - Integration tests:
    1. Initialize handshake completes with fake server
    2. touchFile sends didOpen, server responds with diagnostics
    3. touchFile on already-open file sends didChange
    4. waitForDiagnostics with debounce settles on final result
    5. Server crash marks client as broken
    6. Shutdown sends shutdown/exit to server
    7. Timeout returns empty diagnostics (not error)
    8. Multiple rapid touchFile calls are handled
  - NO mock theater — uses real fake-lsp-server subprocess
  - Tests FAIL naturally on stubs

### Files to Modify

- `packages/lsp/test/fixtures/fake-lsp-server.ts`
  - MODIFY: Enhance fixture to handle initialize, didOpen, didChange, publishDiagnostics
  - MUST include: `@plan:PLAN-20250212-LSP.P10`
  - The fake server is a real subprocess that speaks LSP protocol
  - Configurable: can return specific diagnostics, crash on command, delay responses

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P10
 * @requirement REQ-LIFE-010
 * @scenario Initialize handshake with fake LSP server
 * @given A fake LSP server configured to respond to initialize
 * @when LspClient.initialize() is called
 * @then Client successfully completes handshake and isAlive() returns true
 */
```

## Verification Commands

```bash
# Test file exists
test -f packages/lsp/test/lsp-client-integration.test.ts && echo "PASS" || echo "FAIL"

# No reverse testing
grep -rn "NotYetImplemented" packages/lsp/test/lsp-client-integration.test.ts && echo "FAIL" || echo "PASS"

# No mock theater
grep -rn "toHaveBeenCalled\|vi.fn\|vi.spyOn" packages/lsp/test/lsp-client-integration.test.ts && echo "WARNING" || echo "PASS"

# Tests fail naturally
cd packages/lsp && bunx vitest run test/lsp-client-integration.test.ts 2>&1 | tail -5
# Expected: FAIL with assertion errors
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/lsp/test/lsp-client-integration.test.ts
# Expected: No matches

grep -rn -E "(skip|xit|xdescribe|\.todo)" packages/lsp/test/lsp-client-integration.test.ts
# Expected: No skipped tests
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do tests exercise the real LSP protocol?** — Tests spawn a fake LSP server and communicate via JSON-RPC
   - [ ] Verified: fake-lsp-server.ts implements proper LSP initialize/initialized handshake
2. **Do tests verify end-to-end diagnostic flow?** — didOpen → publishDiagnostics → waitForDiagnostics returns results
   - [ ] At least one test traces this complete flow
3. **Do tests cover crash resilience?** — Server crash mid-session → client handles gracefully
   - [ ] Test kills server process and verifies client state
4. **Would tests fail if LspClient was a no-op stub?** — Yes, stubs return empty arrays
   - [ ] All assertions check for non-empty, specific diagnostic content

#### Feature Actually Works

```bash
cd packages/lsp && bunx vitest run test/lsp-client-integration.test.ts 2>&1 | tail -5
# Expected: Tests FAIL on stubs — assertion errors on empty results
```

#### Integration Points Verified
- [ ] Tests import LspClient from lsp-client.ts
- [ ] Tests use fake-lsp-server fixture for realistic protocol simulation
- [ ] Diagnostic output matches Diagnostic type from types.ts
- [ ] Tests verify 150ms debounce behavior (REQ-TIME-050)

#### Lifecycle Verified
- [ ] Each test starts a fresh fake server and client
- [ ] Each test properly shuts down client and server (afterEach cleanup)
- [ ] No orphaned processes after test suite completes

#### Edge Cases Verified
- [ ] Server crash during diagnostic collection
- [ ] Server slow response exceeding timeout
- [ ] Empty diagnostic notification (file fixed, diagnostics cleared)
- [ ] Multiple rapid diagnostic updates (debounce behavior)

## Success Criteria
- 8+ integration tests using real fake-lsp-server
- Tests exercise actual LSP protocol flow
- Tests fail naturally on stubs
- Fake server fixture is enhanced and functional

## Failure Recovery
1. `git checkout -- packages/lsp/test/lsp-client-integration.test.ts packages/lsp/test/fixtures/`
2. Re-run Phase 10

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P10.md`
