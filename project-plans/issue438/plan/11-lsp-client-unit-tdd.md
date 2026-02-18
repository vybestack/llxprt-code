# Phase 11: LSP Client Unit TDD

## Phase ID
`PLAN-20250212-LSP.P11`

## Prerequisites
- Required: Phase 10a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P10" packages/lsp/test/lsp-client-integration.test.ts`

## Requirements Implemented (Expanded)

Unit tests for LspClient edge cases, error conditions, and internal logic that are impractical to test through the full integration test path.

### REQ-TIME-050: Debounce Edge Cases
**Behavior**:
- GIVEN: diagnostics arriving at 0ms, 50ms, 100ms, 140ms
- WHEN: 150ms debounce applied
- THEN: Only the 140ms diagnostics are returned (wait 150ms after last)

### REQ-TIME-030: First Touch Timeout
**Behavior**:
- GIVEN: Server is cold starting (first file touch)
- WHEN: isFirstTouch() is true
- THEN: Extended timeout (10s) is used instead of normal (3s)

### REQ-TIME-070: Cold-Start Returns Empty on Timeout
**Behavior**:
- GIVEN: Server is cold-starting and firstTouchTimeout expires
- WHEN: waitForDiagnostics returns
- THEN: Returns empty diagnostics, no error, mutation still succeeds

### REQ-TIME-080: Abort Signal
**Behavior**:
- GIVEN: waitForDiagnostics is in progress
- WHEN: Abort signal is triggered
- THEN: Returns empty diagnostics without error

### REQ-TIME-090: Timeout Switching
**Behavior**:
- GIVEN: Server has completed initialization (isFirstTouch = false)
- WHEN: waitForDiagnostics is called
- THEN: Uses diagnosticTimeout instead of firstTouchTimeout

## Concrete Test Fixtures (Golden Tests)

### Fixture 1: Debounce Settles on Last Update

```typescript
// Scenario: 4 publishDiagnostics arrive in rapid succession
// Only the final one should be returned after the 150ms debounce window

const diagnosticUpdates = [
  { time: 0,   diagnostics: [{ range: r(1,0,1,5), message: 'error-v1', severity: 1, code: 1001 }] },
  { time: 50,  diagnostics: [{ range: r(1,0,1,5), message: 'error-v2', severity: 1, code: 1001 }] },
  { time: 100, diagnostics: [{ range: r(1,0,1,5), message: 'error-v3', severity: 1, code: 1001 }] },
  { time: 140, diagnostics: [{ range: r(1,0,1,5), message: 'error-v4', severity: 1, code: 1001 }] },
];
// Expected: after 290ms (140 + 150), waitForDiagnostics resolves with:
const expected = [{ range: r(1,0,1,5), message: 'error-v4', severity: 1, code: 1001 }];
// The first 3 updates are superseded by the 4th.
```

### Fixture 2: First-Touch vs Normal Timeout

```typescript
// Scenario: Server is cold-starting (first file touch)
const config = { diagnosticTimeout: 3000, firstTouchTimeout: 10000 };

// First call to touchFile: isFirstTouch = true → timeout = 10000ms
client.touchFile('/workspace/src/index.ts');
// Expected: waitForDiagnostics uses 10000ms timeout

// After server completes initialization:
// Second call to touchFile: isFirstTouch = false → timeout = 3000ms
client.touchFile('/workspace/src/utils.ts');
// Expected: waitForDiagnostics uses 3000ms timeout
```

### Fixture 3: Abort Signal Cancellation

```typescript
// Scenario: External abort signal fires while waiting for diagnostics
const controller = new AbortController();
const promise = client.waitForDiagnostics('/workspace/src/index.ts', 3000, controller.signal);

// Abort after 50ms:
setTimeout(() => controller.abort(), 50);

// Expected: promise resolves (not rejects!) with empty array:
const result = await promise;
expect(result).toEqual([]);
// No error thrown, no timeout message
```

### Fixture 4: Cold-Start Timeout Returns Empty

```typescript
// Scenario: Server is starting up but firstTouchTimeout expires before initialization completes
// Server takes 15s to init, firstTouchTimeout is 10s

const result = await client.waitForDiagnostics('/workspace/src/index.ts', 10000);
// Expected: resolves with empty array after 10s:
expect(result).toEqual([]);
// No error, no timeout message in output
// The mutation tool that called this will return success without diagnostics (REQ-TIME-070)
```

### Fixture 5: Concurrent touchFile — didOpen vs didChange

```typescript
// Scenario: Same file touched twice — first gets didOpen, second gets didChange
client.touchFile('/workspace/src/app.ts');
// Expected: sends textDocument/didOpen with version=1

client.touchFile('/workspace/src/app.ts');
// Expected: sends textDocument/didChange with version=2 (NOT didOpen again)
// Because the file is already opened in the language server

client.touchFile('/workspace/src/other.ts');
// Expected: sends textDocument/didOpen with version=1 (new file)
```

### Fixture 6: Deadline-Aware Debounce — Diagnostics Near Timeout Boundary (RESEARCH Bug 3)

```typescript
// Scenario: Diagnostics arrive very close to the timeout deadline.
// The debounce timer must be clamped so it never pushes past the deadline.
const config = { diagnosticTimeout: 3000 };

// Diagnostics arrive at T=2900ms (100ms before deadline)
// Old behavior: debounce(150ms) → resolve at T=3050ms, but hard timeout fires at 3000ms → race
// New behavior: debounce clamped to min(150, 3000-2900) = 100ms → resolve at T=3000ms

const result = await client.waitForDiagnostics('/workspace/src/app.ts', 3000);
// Expected: resolves at or before T=3000ms with the latest diagnostics
// Expected: total elapsed time <= 3000ms (never exceeds deadline)
```

### Fixture 7: Deadline-Aware Debounce — Diagnostics at T=timeout-10ms (RESEARCH Bug 3)

```typescript
// Scenario: Diagnostics arrive at T=2990ms (10ms before deadline)
const config = { diagnosticTimeout: 3000 };

// Debounce clamped to min(150, 3000-2990) = 10ms → resolve at T=3000ms
const result = await client.waitForDiagnostics('/workspace/src/app.ts', 3000);
// Expected: resolves at T~3000ms, not T=3140ms
// Expected: still returns the T=2990ms diagnostics (the freshest available)
```

### Fixture 8a: Epoch Waiter Resolves False on Server Crash

```typescript
// Scenario: A pending waitForDiagnosticEpoch call is active when the server crashes.
// The waiter must resolve with false (not hang forever) and be cleaned up.
const client = new LspClient(serverConfig, '/workspace', onDiags);
await client.initialize();

// Start waiting for epoch 5 (current epoch is 0)
const waiterPromise = client.waitForDiagnosticEpoch(5, 30000);

// Server crashes
simulateServerCrash(client);

// GIVEN: A pending waitForDiagnosticEpoch call
// WHEN: Server crashes
// THEN: Waiter resolves with false AND is removed from waiter array
const result = await waiterPromise;
expect(result).toBe(false);
// No hanging promise, no memory leak from lingering waiter
```

### Fixture 8b: Pending waitForDiagnostics Resolves Empty on Server Crash

```typescript
// Scenario: waitForDiagnostics is in progress when the server crashes.
// The inner promise is rejected, but the outer wrapper catches and returns [].
const client = new LspClient(serverConfig, '/workspace', onDiags);
await client.initialize();

// Open a file and start waiting for diagnostics
client.touchFile('/workspace/src/app.ts', 10000);
// waitForDiagnostics is now pending internally

// Server crashes — all diagnostic resolvers are rejected with Error('Server crashed')
simulateServerCrash(client);

// GIVEN: A pending waitForDiagnostics call
// WHEN: Server crashes
// THEN: Promise resolves with empty array (via rejection catch in waitForDiagnostics wrapper)
// NOT: Rejects with Error — the outer try/catch returns []
```

### Fixture 8c: Epoch Waiter Timeout — Cleanup and Resolve False

```typescript
// Scenario: waitForDiagnosticEpoch times out before the target epoch is reached.
const client = new LspClient(serverConfig, '/workspace', onDiags);
await client.initialize();

// Wait for epoch 100 with a 200ms timeout (will never be reached)
const result = await client.waitForDiagnosticEpoch(100, 200);

// GIVEN: Epoch waiter times out
// THEN: Waiter is removed from array AND resolves false
expect(result).toBe(false);
// epochWaiters array should be empty after timeout cleanup
```

### Fixture 9: Anti-Trivial-Timeout — Event-Driven, Not Sleep

```typescript
// Scenario: Language server responds quickly — waitForDiagnostics must return promptly,
// not sleep until the timeout boundary. This prevents a trivial implementation that
// just does setTimeout(resolve, timeoutMs).
const config = { diagnosticTimeout: 3000 };

// Server sends publishDiagnostics 50ms after didOpen
// Expected: waitForDiagnostics resolves in ~200ms (50ms delay + 150ms debounce)
const start = Date.now();
const result = await client.waitForDiagnostics('/workspace/src/app.ts', 3000);
const elapsed = Date.now() - start;

// Assert: elapsed < 500ms, NOT ~3000ms
expect(elapsed).toBeLessThan(500);
expect(result.length).toBeGreaterThan(0);
// A trivial sleep-until-timeout implementation would fail this test
// because elapsed would be ~3000ms.
```

### Fixture 8: touchFile with Provided Content (RESEARCH Design Decision 3)

```typescript
// Scenario: touchFile called with explicit text content
// Instead of reading from disk, uses the provided content for didOpen/didChange
const text = 'const x: number = "wrong";
';
client.touchFile('/workspace/src/app.ts', 3000, text);
// Expected: didOpen sent with text = provided content (not disk content)
// Expected: no disk read occurs when text is provided

// Second call with new content
const text2 = 'const x: number = 42;
';
client.touchFile('/workspace/src/app.ts', 3000, text2);
// Expected: didChange sent with text = text2
```

## Implementation Tasks

### Files to Create

- `packages/lsp/test/lsp-client.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P11`
  - Unit tests (20+):
    - Debounce timing: rapid updates, slow updates, exactly-at-boundary
    - First-touch detection: first file uses extended timeout, subsequent files use normal
    - Open file tracking: same file gets didChange (not didOpen again)
    - File version incrementing: version number increases on each touch
    - Abort signal: cancellation returns empty results (REQ-TIME-080)
    - Cold-start timeout: returns empty, no error (REQ-TIME-070)
    - Timeout switching: firstTouchTimeout → diagnosticTimeout after init (REQ-TIME-090)
    - Diagnostic normalization: 0→1 based conversion delegated to diagnostics module
    - Connection error handling: server not responding
    - Multiple file tracking: concurrent file touches
    - [RESEARCH Bug 3] Deadline-aware debounce: diagnostics at T=timeout-100ms resolve within deadline
    - [RESEARCH Bug 3] Deadline-aware debounce: diagnostics at T=timeout-10ms resolve within deadline
    - [RESEARCH Bug 2] Diagnostic epoch: epoch increments on each publishDiagnostics
    - [RESEARCH Bug 2] Diagnostic epoch: waitForDiagnosticEpoch resolves when target reached
    - [RESEARCH Bug 2] Epoch waiter on crash: GIVEN a pending waitForDiagnosticEpoch call WHEN server crashes THEN waiter resolves with false AND is removed from waiter array
    - [RESEARCH Bug 2] Epoch waiter timeout: GIVEN epoch waiter times out THEN waiter is removed from array AND resolves false
    - Server crash resolver rejection: GIVEN a pending waitForDiagnostics call WHEN server crashes THEN promise resolves with empty array (via rejection catch in waitForDiagnostics wrapper)
    - [RESEARCH DD-3] touchFile with provided text: uses text instead of disk read
    - Anti-trivial-timeout: GIVEN a language server that sends publishDiagnostics 50ms after didOpen, WHEN waitForDiagnostics is called with 3000ms timeout, THEN diagnostics are returned in ~200ms (50ms server delay + 150ms debounce), NOT at the 3000ms timeout boundary. Assert: elapsed time < 500ms. This forces real event-driven implementation, not sleep-until-timeout.
  - 30%+ property-based tests:
    - Any valid file path can be touched without crash
    - Version numbers always increase
    - Diagnostics array is never null/undefined (always empty array minimum)

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P11
 * @requirement REQ-TIME-050
 * @scenario Debounce settles on last diagnostic update
 */
```

## Verification Commands

```bash
# Tests exist
test -f packages/lsp/test/lsp-client.test.ts && echo "PASS" || echo "FAIL"

# Test count
TEST_COUNT=$(grep -c "it(\|test(" packages/lsp/test/lsp-client.test.ts)
[ "$TEST_COUNT" -ge 15 ] && echo "PASS" || echo "FAIL"

# Property tests
PROP_COUNT=$(grep -c "fc\.\|prop\[" packages/lsp/test/lsp-client.test.ts)
RATIO=$((PROP_COUNT * 100 / TEST_COUNT))
[ "$RATIO" -ge 30 ] && echo "PASS: ${RATIO}%" || echo "FAIL: ${RATIO}%"

# No mock theater
grep -rn "toHaveBeenCalled" packages/lsp/test/lsp-client.test.ts && echo "WARNING" || echo "PASS"

# Tests fail naturally
cd packages/lsp && bunx vitest run test/lsp-client.test.ts 2>&1 | tail -5
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/lsp/test/lsp-client.test.ts
# Expected: No matches

grep -rn -E "(skip|xit|xdescribe|\.todo)" packages/lsp/test/lsp-client.test.ts
# Expected: No skipped tests
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do tests cover debounce timing?** — 150ms debounce per REQ-TIME-050
2. **Do tests verify first-touch timeout?** — Extended timeout per REQ-TIME-030/090
3. **Do tests cover abort/cancellation?** — REQ-TIME-080
4. **Do property tests express meaningful invariants?** — Not just "doesn't crash"
   - [ ] e.g., "diagnostics always have 1-based line numbers"

#### Feature Actually Works

```bash
cd packages/lsp && bunx vitest run test/lsp-client.test.ts 2>&1 | tail -5
# Expected: Tests FAIL on stubs
```

#### Integration Points Verified
- [ ] Tests import LspClient from lsp-client.ts
- [ ] Tests use types from types.ts for assertions
- [ ] Tests verify method return types match Orchestrator expectations

#### Lifecycle Verified
- [ ] Tests verify initialize() must be called before touchFile()
- [ ] Tests verify shutdown() cleans up state
- [ ] afterEach properly disposes test resources

#### Edge Cases Verified
- [ ] touchFile with non-existent file path
- [ ] waitForDiagnostics with zero timeout
- [ ] Concurrent touchFile calls for same file
- [ ] Server crash between touchFile and waitForDiagnostics
- [ ] Server crash resolves pending waitForDiagnostics with [] (not rejection)
- [ ] Server crash resolves pending waitForDiagnosticEpoch with false
- [ ] Epoch waiter timeout removes waiter from array and resolves false
- [ ] isFirstTouch transitions from true to false after first init

## Success Criteria
- 15+ unit tests
- 30%+ property-based tests
- Cover debounce, first-touch, abort, crash, file tracking
- Tests fail naturally on stubs

## Failure Recovery
1. `git checkout -- packages/lsp/test/lsp-client.test.ts`
2. Re-run Phase 11

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P11.md`
