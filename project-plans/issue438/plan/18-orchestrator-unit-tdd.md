# Phase 18: Orchestrator Unit TDD

## Phase ID
`PLAN-20250212-LSP.P18`

## Prerequisites
- Required: Phase 17a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P17" packages/lsp/test/orchestrator-integration.test.ts`

## Requirements Implemented (Expanded)

Unit tests for Orchestrator edge cases and internal logic.

### REQ-LIFE-030: Workspace Root Detection
**Behavior**:
- GIVEN: File at "/project/packages/core/src/foo.ts"
- WHEN: workspace root detection runs
- THEN: Finds nearest package.json and uses that directory as workspace root for the LSP server

### REQ-ARCH-090: No Duplicate Processes
**Behavior**:
- GIVEN: Two files in same workspace needing tsserver
- WHEN: Both trigger checkFile
- THEN: Only one tsserver is started (reused for both)

### REQ-TIME-085: Partial Results
**Behavior**:
- GIVEN: tsserver responds but eslint times out
- WHEN: checkFile returns
- THEN: tsserver diagnostics are included, eslint is omitted

### REQ-KNOWN-030: Multi-Server Known-Files Tracking
**Behavior**:
- GIVEN: File tracked by tsserver (has diags) and eslint (no diags)
- WHEN: eslint clears its diags
- THEN: File STAYS in known set (tsserver still has diags)
- GIVEN: Both tsserver and eslint clear diags for file
- WHEN: Known set is checked
- THEN: File is REMOVED from known set

### REQ-STATUS-025: All Known and Configured Servers
**Behavior**:
- GIVEN: Built-in + custom servers configured
- WHEN: status() is called
- THEN: All servers appear in result

### REQ-STATUS-045: Deterministic Alphabetical Ordering
**Behavior**:
- GIVEN: Servers with IDs "typescript", "eslint", "gopls"
- WHEN: status() returns
- THEN: Order is eslint, gopls, typescript

## Concrete Test Fixtures (Golden Tests)

### Fixture 1: Parallel Collection — Both Servers Respond

```typescript
// Scenario: .ts file served by both tsserver and eslint, both respond
const input = { filePath: '/workspace/src/app.ts' };
// tsserver returns: [{ range: r(5,0,5,10), message: 'Type error', severity: 1, code: 2322 }]
// eslint returns:   [{ range: r(10,0,10,5), message: 'no-unused-vars', severity: 2, code: 'no-unused-vars' }]

const expected = [
  { range: r(5,0,5,10), message: 'Type error', severity: 1, code: 2322, source: 'typescript' },
  { range: r(10,0,10,5), message: 'no-unused-vars', severity: 2, code: 'no-unused-vars', source: 'eslint' },
];
// Both server results merged, ordered by line number
```

### Fixture 2: Partial Timeout — One Server Responds, Other Doesn't

```typescript
// Scenario: tsserver responds in 500ms, eslint hangs (timeout at 3000ms)
const config = { diagnosticTimeout: 3000 };
const input = { filePath: '/workspace/src/app.ts' };

// tsserver returns after 500ms: [{ range: r(3,0,3,8), message: 'Missing return', severity: 1, code: 2355 }]
// eslint does NOT respond within 3000ms

const expected = [
  { range: r(3,0,3,8), message: 'Missing return', severity: 1, code: 2355, source: 'typescript' },
];
// REQ-TIME-085: Only tsserver results returned. No error. No "timeout" text.
// Total wall time: ~3000ms (bounded by timeout, not additive: REQ-TIME-015)
```

### Fixture 3: Broken Server Skipped

```typescript
// Scenario: tsserver crashed previously, eslint is alive
// Setup: orchestrator.brokenServers has "typescript:/workspace"
const input = { filePath: '/workspace/src/app.ts' };

// Only eslint is queried (tsserver skipped)
// eslint returns: [{ range: r(2,0,2,12), message: 'prefer-const', severity: 2, code: 'prefer-const' }]

const expected = [
  { range: r(2,0,2,12), message: 'prefer-const', severity: 2, code: 'prefer-const', source: 'eslint' },
];
// No error about tsserver being broken. Partial results are normal operation.
```

### Fixture 4: Known-Files Multi-Server Tracking (REQ-KNOWN-030)

```typescript
// Scenario: Track which servers hold diagnostics for which files
// Initial state after touchFile("src/app.ts"):
//   tsserver reports diagnostics for src/app.ts: [error1]
//   eslint reports diagnostics for src/app.ts: [warning1]
// → knownFileDiagSources = Map { "src/app.ts" => Set { "typescript", "eslint" } }

// Step 1: eslint clears diagnostics for src/app.ts (publishDiagnostics with empty array)
// → knownFileDiagSources = Map { "src/app.ts" => Set { "typescript" } }
// Expected: "src/app.ts" is STILL in the known set (tsserver still has diags)
expect(orchestrator.getKnownFiles()).toContain('src/app.ts');

// Step 2: tsserver also clears diagnostics for src/app.ts
// → knownFileDiagSources = Map { }
// Expected: "src/app.ts" is REMOVED from the known set (all servers empty)
expect(orchestrator.getKnownFiles()).not.toContain('src/app.ts');
```

### Fixture 5: Workspace Boundary Rejection

```typescript
// Scenario: checkFile called with path outside workspace
const orchestrator = new Orchestrator(config, serverRegistry, languageMap);
const result = await orchestrator.checkFile('/etc/passwd');
// Expected: returns empty array, no server started, no error thrown
expect(result).toEqual([]);
// No language server process should have been spawned

const result2 = await orchestrator.checkFile('/other-project/src/app.ts');
expect(result2).toEqual([]);
```

### Fixture 6: Status with All Server Types

```typescript
// Scenario: Mix of active, broken, disabled, and unavailable servers
// Setup:
//   typescript: active (running, serving requests)
//   eslint: broken (crashed earlier in session)
//   gopls: disabled (user set servers.gopls.enabled: false)
//   pyright: unavailable (command not found in PATH)
//   rust-analyzer: unavailable (not started, no Rust files touched)
//   myserver: active (custom user-defined server)

const expected = [
  { serverId: 'eslint', status: 'broken' },
  { serverId: 'gopls', status: 'disabled' },
  { serverId: 'myserver', status: 'active' },
  { serverId: 'pyright', status: 'unavailable' },
  { serverId: 'rust-analyzer', status: 'unavailable' },
  { serverId: 'typescript', status: 'active' },
];
// REQ-STATUS-045: sorted alphabetically by serverId
// REQ-STATUS-025: all known + configured servers included
```

### Fixture 7: Single-Flight Server Startup (RESEARCH Bug 1)

```typescript
// Scenario: Two checkFile calls arrive 50ms apart for the same .ts file.
// Only one tsserver process should be started; both calls share the startup promise.
const orchestrator = new Orchestrator(config, serverRegistry, languageMap);

// Fire two checkFile calls nearly simultaneously
const promise1 = orchestrator.checkFile('/workspace/src/app.ts');
await delay(50);
const promise2 = orchestrator.checkFile('/workspace/src/utils.ts');

const [result1, result2] = await Promise.all([promise1, promise2]);

// GIVEN: Two checkFile calls 50ms apart for files served by the same tsserver
// WHEN: Both calls attempt to start the server
// THEN: spawn is called exactly once (startServer called once)
// AND: Both callers receive the same LspClient instance reference (object identity check)
expect(spawnCount).toBe(1); // single server process, not two
// Verify both callers got the same client instance (not just equivalent results)
const client1 = orchestrator._getClientForTest('typescript:/workspace');
const client2 = orchestrator._getClientForTest('typescript:/workspace');
expect(client1).toBe(client2); // same object reference
```

### Fixture 7a: ClientOpQueue — Writes Serialize, Reads Wait for Prior Writes

```typescript
// Scenario: Two writes and a read enqueued on the same ClientOpQueue.
// Writes must serialize. Reads must wait for prior writes but not block each other.
const queue = new ClientOpQueue();

const order: string[] = [];
const write1 = queue.enqueueWrite(async () => { order.push('w1-start'); await delay(100); order.push('w1-end'); });
const write2 = queue.enqueueWrite(async () => { order.push('w2-start'); await delay(50); order.push('w2-end'); });
const read1 = queue.enqueueRead(async () => { order.push('r1'); return 'read-result'; });

await Promise.all([write1, write2, read1]);

// GIVEN: Two enqueueWrite calls followed by an enqueueRead
// WHEN: All three complete
// THEN: Write operations complete in enqueue order (w1 completes before w2 starts)
// AND: The second write's side effects are observable after the first's
// AND: Read waits for both writes to complete before executing
expect(order).toEqual(['w1-start', 'w1-end', 'w2-start', 'w2-end', 'r1']);
// Verify side effect ordering: w1-end appears before w2-start proves serialization
expect(order.indexOf('w1-end')).toBeLessThan(order.indexOf('w2-start'));
```

### Fixture 7b: ClientOpQueue — Concurrent Async Callers Serialize Correctly

```typescript
// Scenario: Two async callers enqueue writes on the same queue concurrently.
// Both should complete — the queue serializes them without false deadlock detection.
// (The `executing` flag was removed because it incorrectly blocked legitimate
// concurrent async callers from different contexts.)
const queue = new ClientOpQueue();

const order: string[] = [];
// Two independent async callers enqueue writes concurrently
const p1 = queue.enqueueWrite(async () => { order.push('a-start'); await delay(50); order.push('a-end'); return 'a'; });
const p2 = queue.enqueueWrite(async () => { order.push('b-start'); await delay(50); order.push('b-end'); return 'b'; });

const [r1, r2] = await Promise.all([p1, p2]);

// GIVEN: Two concurrent async callers enqueue writes
// WHEN: Both complete
// THEN: Writes serialize (a completes before b starts)
// AND: Both callers receive their results (no false deadlock throw)
expect(r1).toBe('a');
expect(r2).toBe('b');
expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
```

### Fixture 7c: findClientForFile — Per-Server Workspace Root Resolution

```typescript
// Scenario: Navigation requests must find the correct client for a file by computing
// the per-server workspace root (not the global workspace root).
const orchestrator = new Orchestrator(config, serverRegistry, languageMap);

// Setup: tsserver started with workspace root /workspace/packages/app (nearest package.json)
// File: /workspace/packages/app/src/index.ts
// The client key is "typescript:/workspace/packages/app"

// GIVEN: tsserver was started for /workspace/packages/app (detected via nearest package.json)
// WHEN: gotoDefinition is called for /workspace/packages/app/src/index.ts
// THEN: findClientForFile computes per-server workspace root → /workspace/packages/app
// AND: Looks up client by key "typescript:/workspace/packages/app"
// AND: Returns the correct alive client (not null)
const locations = await orchestrator.gotoDefinition('/workspace/packages/app/src/index.ts', 10, 5);
expect(locations).not.toEqual([]); // Found the client and delegated
```

### Fixture 7d: getStatus — Reports All Servers Including Not-Yet-Started

```typescript
// Scenario: getStatus must include servers from the registry that haven't been started yet.
const orchestrator = new Orchestrator(config, serverRegistry, languageMap);

// No files touched — no servers started
// Registry contains: typescript, eslint, gopls (all enabled)
// GIVEN: No servers have been started yet
// WHEN: getStatus() is called
// THEN: All servers appear with status 'unavailable' (not omitted)
const statuses = orchestrator.getStatus();
expect(statuses).toEqual([
  { serverId: 'eslint', status: 'unavailable' },
  { serverId: 'gopls', status: 'unavailable' },
  { serverId: 'typescript', status: 'unavailable' },
]);
// REQ-STATUS-025: All known + configured servers reported
// REQ-STATUS-045: Sorted alphabetically
```

### Fixture 7e: getAllDiagnosticsAfter — Epoch-Based Freshness Flow

```typescript
// Scenario: After checkFile returns, getAllDiagnosticsAfter uses the epoch
// to wait for cross-file diagnostic propagation before snapshotting.
const orchestrator = new Orchestrator(config, serverRegistry, languageMap);

// Step 1: Capture epoch BEFORE checkFile
const epoch = orchestrator.getDiagnosticEpoch();

// Step 2: checkFile returns Diagnostic[] and increments internal epoch
const diagnostics = await orchestrator.checkFile('/workspace/src/app.ts');

// Step 3: getAllDiagnosticsAfter waits for epoch to advance past captured value
const allDiags = await orchestrator.getAllDiagnosticsAfter(epoch, 250);

// GIVEN: epoch was captured before checkFile
// WHEN: getAllDiagnosticsAfter is called with that epoch
// THEN: It waits for the orchestrator epoch to advance (checkFile incremented it)
// AND: Returns the full diagnostic snapshot including cross-file effects
expect(orchestrator.getDiagnosticEpoch()).toBeGreaterThan(epoch);
expect(allDiags).toBeDefined();
```

### Fixture 7f: Known-Files Survives Server Crash (HIGH #10)

```typescript
// Scenario: Two servers track file.ts. One crashes. File stays in known-files
// because the other server still has diagnostics for it.
const orchestrator = new Orchestrator(config, serverRegistry, languageMap, lspClientFactory);

// Both tsserver and eslint report diagnostics for file.ts
await orchestrator.checkFile('/workspace/src/file.ts');
// → knownFileDiagSources = Map { "src/file.ts" => Set { "typescript:/workspace", "eslint:/workspace" } }

// GIVEN: Two servers (tsserver + eslint) track file.ts with non-empty diagnostics
// WHEN: eslint crashes (orchestrator marks it broken, calls onServerShutdown)
simulateServerCrash('eslint:/workspace');
// → knownFileDiagSources = Map { "src/file.ts" => Set { "typescript:/workspace" } }

// THEN: file.ts is STILL in known-files because tsserver still has diagnostics
const allDiags = orchestrator.getAllDiagnostics();
expect(Object.keys(allDiags)).toContain('src/file.ts');

// WHEN: tsserver also clears diagnostics for file.ts
simulateDiagnosticClear('typescript:/workspace', 'src/file.ts');
// THEN: file.ts is REMOVED from known-files (all sources empty)
const allDiags2 = orchestrator.getAllDiagnostics();
expect(Object.keys(allDiags2)).not.toContain('src/file.ts');
```

### Fixture 7g: getAllDiagnosticsAfter Returns Server A's Latest Results (HIGH #10)

```typescript
// Scenario: Verify that getAllDiagnosticsAfter includes results from a specific
// server's checkFile, not stale pre-checkFile data.
const orchestrator = new Orchestrator(config, serverRegistry, languageMap, lspClientFactory);

// Step 1: Capture epoch BEFORE checkFile
const beforeEpoch = orchestrator.getDiagnosticEpoch();

// Step 2: checkFile triggers tsserver which reports new diagnostics
const fileDiags = await orchestrator.checkFile('/workspace/src/app.ts');
// tsserver reports: [{ message: 'Type error', severity: 1 }]

// Step 3: getAllDiagnosticsAfter waits for epoch advancement
const allDiags = await orchestrator.getAllDiagnosticsAfter(beforeEpoch, 250);

// GIVEN: checkFile completed for tsserver (server A)
// WHEN: getAllDiagnosticsAfter(beforeEpoch) is called
// THEN: Returns diagnostics that include tsserver's latest results for app.ts
expect(allDiags['src/app.ts']).toBeDefined();
expect(allDiags['src/app.ts'].length).toBeGreaterThan(0);
expect(allDiags['src/app.ts'][0].message).toBe('Type error');
```

### Fixture 8: Navigation During Active checkFile (RESEARCH Bug 4)

```typescript
// Scenario: gotoDefinition is called while a checkFile is still in progress on the same client.
// The navigation read must wait for the prior touchFile write to complete.
const orchestrator = new Orchestrator(config, serverRegistry, languageMap);

// Start a checkFile that takes time (server is processing didChange)
const checkPromise = orchestrator.checkFile('/workspace/src/app.ts');

// While checkFile is in progress, request navigation on same client
const navPromise = orchestrator.gotoDefinition('/workspace/src/app.ts', 10, 5);

const [checkResult, navResult] = await Promise.all([checkPromise, navPromise]);

// GIVEN: checkFile triggers touchFile (write) on tsserver client
// WHEN: gotoDefinition (read) is called on the same client concurrently
// THEN: gotoDefinition waits for touchFile to complete before executing
// AND: Both return valid results (no interleaving corruption)
```

### Fixture 9: First-Touch Timeout Then Normal Timeout (RESEARCH Bug 5)

```typescript
// Scenario: First touch times out, but server isn't crashed.
// Second checkFile should use normal timeout (not firstTouchTimeout forever).
const config = { diagnosticTimeout: 3000, firstTouchTimeout: 10000 };
const orchestrator = new Orchestrator(config, serverRegistry, languageMap);

// First checkFile: server started but first touch times out at 10s
const result1 = await orchestrator.checkFile('/workspace/src/app.ts');
// Expected: result1 = [] (timeout), firstTouchServers.delete(clientKey) in finally

// Second checkFile: should use diagnosticTimeout=3000, NOT firstTouchTimeout=10000
const result2 = await orchestrator.checkFile('/workspace/src/app.ts');
// GIVEN: First touch timed out (not crashed)
// WHEN: Second checkFile is called
// THEN: Uses diagnosticTimeout (3000ms), not firstTouchTimeout (10000ms)
// Because: firstTouchServers flag was cleared in the finally block
```

### Fixture 10: Path Traversal Boundary Check (RESEARCH Bug 6)

```typescript
// Scenario: Paths that share a prefix with the workspace root but are NOT inside it
const orchestrator = new Orchestrator(config, serverRegistry, languageMap);

// GIVEN: workspace root is /workspace
// WHEN: checkFile with /workspace2/evil.ts
const result1 = await orchestrator.checkFile('/workspace2/evil.ts');
// THEN: returns empty (rejected by segment-safe boundary check)
expect(result1).toEqual([]);

// WHEN: checkFile with /workspace-backup/file.ts
const result2 = await orchestrator.checkFile('/workspace-backup/file.ts');
// THEN: returns empty (rejected — "workspace-backup" is not under "workspace/")
expect(result2).toEqual([]);

// WHEN: checkFile with /workspace/src/valid.ts (legitimate file)
const result3 = await orchestrator.checkFile('/workspace/src/valid.ts');
// THEN: NOT rejected — path separator at boundary position confirms containment
```

## Implementation Tasks

### Files to Create

- `packages/lsp/test/orchestrator.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P18`
  - Unit tests (22+):
    - Server routing: correct server selected for each extension
    - Workspace root detection: finds nearest project marker
    - Deduplication: same server not started twice for same workspace
    - Broken server tracking: crash → broken, no restart
    - Parallel collection: Promise.allSettled for multiple servers
    - Partial results: one server timeout, other succeeds
    - Path normalization: resolve symlinks, normalize separators
    - Boundary enforcement: external paths rejected silently
    - Known-files: files with empty diagnostics removed
    - Known-files multi-server: file stays while any server has diags (REQ-KNOWN-030)
    - Known-files multi-server: file removed when all servers' diags empty (REQ-KNOWN-030)
    - Status includes all known + configured servers (REQ-STATUS-025)
    - Status returns servers in alphabetical order (REQ-STATUS-045)
    - Cleanup: shutdown disposes all clients
    - [RESEARCH Bug 1] Single-flight startup: two checkFile calls 50ms apart start only one server process
    - [RESEARCH Bug 1] getOrStartClient: two concurrent calls produce one server (single-flight guard)
    - [RESEARCH Bug 4] Operation queue: navigation during checkFile waits for prior write
    - [RESEARCH Bug 4] ClientOpQueue enqueueWrite/enqueueRead ordering: writes serialize, reads wait for prior writes
    - [RESEARCH Bug 4] ClientOpQueue concurrent async callers: both complete without false deadlock
    - [RESEARCH Bug 5] First-touch one-shot: timeout then second touch uses normal timeout
    - findClientForFile: per-server workspace root resolution finds correct client
    - getStatus: reports all servers including not-yet-started ones from registry (REQ-STATUS-025)
    - getAllDiagnosticsAfter: freshness token flow — waits for post-touch epoch then snapshots (RESEARCH Bug 2)
    - [RESEARCH Bug 6] Path traversal: /workspace2/evil.ts rejected by segment-safe boundary check
    - [RESEARCH Bug 6] Path traversal: /workspace-backup/file.ts rejected
    - [RESEARCH Bug 2] Epoch-aware getAllDiagnosticsAfter waits for post-touch epoch
    - [HIGH #10] GIVEN checkFile completes for server A, WHEN getAllDiagnosticsAfter(beforeEpoch) is called, THEN it returns diagnostics that include server A's latest results
    - [HIGH #10] GIVEN two servers (tsserver + eslint) track file.ts, WHEN eslint crashes, THEN known-files still includes file.ts if tsserver has diagnostics for it
    - [HIGH #10] GIVEN two servers track file.ts, WHEN both clear diagnostics, THEN file.ts is removed from known-files
  - 30%+ property-based tests:
    - Any file path outside workspace returns empty diagnostics
    - checkFile never throws (always returns array)
    - getAllDiagnostics keys are always sorted alphabetically

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P18
 * @requirement REQ-LIFE-030
 * @scenario Workspace root detection finds nearest package.json
 */
```

## Verification Commands

```bash
TEST_COUNT=$(grep -c "it(\|test(" packages/lsp/test/orchestrator.test.ts)
PROP_COUNT=$(grep -c "fc\.\|prop\[" packages/lsp/test/orchestrator.test.ts)
echo "Tests: $TEST_COUNT, Property: $PROP_COUNT"
[ "$TEST_COUNT" -ge 15 ] && echo "PASS" || echo "FAIL"
RATIO=$((PROP_COUNT * 100 / TEST_COUNT))
[ "$RATIO" -ge 30 ] && echo "PASS" || echo "FAIL"
grep -rn "NotYetImplemented" packages/lsp/test/orchestrator.test.ts && echo "FAIL" || echo "PASS"
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/lsp/test/orchestrator.test.ts
# Expected: No matches

grep -rn -E "(skip|xit|xdescribe|\.todo)" packages/lsp/test/orchestrator.test.ts
# Expected: No skipped tests
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do tests cover workspace root detection?** — REQ-LIFE-030: find nearest project marker
   - [ ] Tests with nested directories, multiple marker files
2. **Do tests cover broken server tracking?** — REQ-LIFE-070/090
   - [ ] Server marked broken → never restarted → no diagnostics for that language
3. **Do tests cover partial results?** — REQ-TIME-085
   - [ ] Some servers respond, some timeout → partial results returned
4. **Do property tests express invariants?** — e.g., "diagnostics always have relative paths"
   - [ ] Meaningful invariants verified

#### Feature Actually Works

```bash
cd packages/lsp && bunx vitest run test/orchestrator.test.ts 2>&1 | tail -5
# Expected: Tests FAIL on stubs
```

#### Integration Points Verified
- [ ] Tests import Orchestrator from orchestrator.ts
- [ ] Tests verify orchestrator methods return correct types
- [ ] Tests use types from types.ts for assertions

#### Lifecycle Verified
- [ ] Tests verify construction does not start servers
- [ ] Tests verify shutdown cleans up all state (clients, brokenServers, diagnosticMaps)
- [ ] afterEach properly disposes orchestrator

#### Edge Cases Verified
- [ ] checkFile with path outside workspace → rejected (REQ-BOUNDARY-010)
- [ ] getAllDiagnostics with no active servers → empty record
- [ ] status() with mix of active, broken, disabled servers
- [ ] findNearestProjectRoot at filesystem boundary (no marker found)
- [ ] First-touch timeout vs normal timeout selection (REQ-TIME-090)
- [ ] [RESEARCH Bug 1] Concurrent startup deduplication — two calls, one process (single-flight guard)
- [ ] [RESEARCH Bug 1] getOrStartClient — two concurrent calls for same server produce one client instance
- [ ] [RESEARCH Bug 4] Navigation read waits for prior write on same client
- [ ] [RESEARCH Bug 4] ClientOpQueue enqueueWrite/enqueueRead ordering — writes serialize, reads gate on prior writes
- [ ] [RESEARCH Bug 4] ClientOpQueue concurrent async callers — both complete without false deadlock (executing flag removed)
- [ ] [RESEARCH Bug 5] First-touch flag cleared in finally block (one-shot semantics)
- [ ] [RESEARCH Bug 6] Path traversal: /workspace2/evil.ts and /workspace-backup/file.ts rejected
- [ ] [HIGH #10] getAllDiagnosticsAfter(beforeEpoch) returns server A's latest results after checkFile
- [ ] [HIGH #10] Server crash leaves file in known-files if another server still has diagnostics
- [ ] [HIGH #10] Both servers clear diagnostics → file removed from known-files

## Success Criteria
- 15+ unit tests
- 30%+ property-based
- Cover workspace root, dedup, broken server, partial results, cleanup

## Failure Recovery
1. `git checkout -- packages/lsp/test/orchestrator.test.ts`
2. Re-run Phase 18

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P18.md`
