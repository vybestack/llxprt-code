# Phase 19: Orchestrator Implementation

## Phase ID
`PLAN-20250212-LSP.P19`

## Prerequisites
- Required: Phase 18a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P18" packages/lsp/test/orchestrator.test.ts`
- Expected: Integration (P17) and unit (P18) tests exist, all failing on stubs

## Requirements Implemented (Expanded)

### REQ-ARCH-040: Shared Orchestrator
**Full Text**: Single orchestrator instance shared between diagnostic and navigation channels.

### REQ-BOUNDARY-010/020/030: Workspace Boundary Enforcement
**Full Text**: Reject files outside workspace root. Normalize paths first.

### REQ-TIME-040: Parallel Collection
**Full Text**: Collect from multiple servers in parallel for same file.

### REQ-TIME-015: Bounded Latency
**Full Text**: Timeout bounds overall response latency.

### REQ-LIFE-010/020/030: Lazy Startup & Workspace Root Detection
**Full Text**: Start servers on demand, detect workspace root per-file.

### REQ-LIFE-070/090: Crash Handling
**Full Text**: Broken server skipped, no restart.

### REQ-KNOWN-010/020: Known Files Set
**Full Text**: Track files with non-empty diagnostics. Remove when empty, server shutdown, or session end.

### REQ-OBS-010: Debug Logging via DebugLogger
**Full Text**: The system shall log LSP operational metrics via the existing DebugLogger infrastructure at debug log level, visible only when the user enables debug logging.

### REQ-OBS-020: Operational Metrics Logged
**Full Text**: The system shall log server startup success/failure counts, crash counts, diagnostic collection latency, diagnostic timeout rates, and diagnostic counts per file.
**Behavior**:
- GIVEN: Debug logging is enabled
- WHEN: Orchestrator starts a server, collects diagnostics, or handles a crash
- THEN: Relevant metrics are logged at debug level
**Why This Matters**: Operators need visibility into LSP behavior for troubleshooting.

### REQ-OBS-030: No Remote Telemetry
**Full Text**: The system shall not send any LSP metrics or diagnostic data to any remote telemetry service.

### REQ-KNOWN-030: Multi-Server Known-Files Tracking
**Full Text**: When multiple LSP servers track the same file (e.g., tsserver and eslint for a `.ts` file), the known-files set shall include that file if any active server holds non-empty diagnostics for it. The file shall be removed from the set only when all servers' diagnostics for it are empty or all tracking servers have shut down.
**Behavior**:
- GIVEN: tsserver has errors for `src/app.ts`, eslint has no errors for `src/app.ts`
- WHEN: Known files set is queried
- THEN: `src/app.ts` IS in the set (because tsserver has non-empty diagnostics)
- GIVEN: tsserver clears its errors for `src/app.ts`, eslint also has no errors
- WHEN: Known files set is queried
- THEN: `src/app.ts` is REMOVED from the set
**Why This Matters**: Without multi-server awareness, clearing errors in one server could prematurely remove a file from the known-files set when another server still has diagnostics.

**CONCRETE DATA STRUCTURE** (from pseudocode `orchestrator.md` lines 005-010, 200-221):
```typescript
// Orchestrator maintains this map for multi-server known-files tracking:
private knownFileDiagSources: Map<string, Set<string>> = new Map();
// Key: workspace-relative file path (e.g., "src/app.ts")
// Value: Set of serverIds that currently hold non-empty diagnostics for this file
//
// Example state after tsserver reports errors for app.ts but eslint reports clean:
//   knownFileDiagSources = Map {
//     "src/app.ts" => Set { "typescript" }
//     "src/utils.ts" => Set { "typescript", "eslint" }
//   }
//
// updateKnownFiles("typescript", "src/app.ts", []) → removes "typescript" from set
// If set becomes empty → file removed from map entirely (REQ-KNOWN-020)
//
// onServerShutdown("eslint") → removes "eslint" from ALL entries
// Any entries that become empty → removed from map
```
This data structure is referenced in pseudocode orchestrator.md lines 200-221 and MUST be implemented in this phase. The `updateKnownFiles` method is called by the LspClient's publishDiagnostics listener, and `onServerShutdown` is called during server crash/shutdown handling.

### REQ-TIME-085: Partial Results from Subset of Servers
**Full Text**: If diagnostics from only a subset of applicable LSP servers are available before the timeout expires, then the system shall return the available subset and shall not fail the mutation operation.
**Behavior**:
- GIVEN: tsserver responds with diagnostics, eslint times out
- WHEN: checkFile completes
- THEN: Returns tsserver diagnostics only (partial result is acceptable)
**Why This Matters**: One slow server should not block diagnostics from faster servers.

### REQ-TIME-090: First-Touch vs Normal Timeout Selection
**Full Text**: While a language server is in first-touch initialization, when collecting diagnostics, the system shall apply `firstTouchTimeout` for that server. Once a server has completed initialization, the system shall apply `diagnosticTimeout` for subsequent diagnostic collections.
**Behavior**:
- GIVEN: tsserver has never been started (first touch)
- WHEN: checkFile is called for a .ts file
- THEN: firstTouchTimeout (default 10000ms) is used
- GIVEN: tsserver has been initialized and is active
- WHEN: checkFile is called again for a .ts file
- THEN: diagnosticTimeout (default 3000ms) is used
**Why This Matters**: First-touch initialization takes longer; subsequent requests should use a shorter timeout.

### REQ-STATUS-025: All Known and Configured Servers in Status
**Full Text**: When reporting status, the system shall include all known and configured servers (built-in and user-defined custom).
**Behavior**:
- GIVEN: Built-in servers + custom server "myserver"
- WHEN: status() is called on orchestrator
- THEN: All servers returned with their current status

### REQ-STATUS-045: Deterministic Alphabetical Server Ordering
**Full Text**: When reporting status, the system shall order servers by server ID in ascending alphabetical order.

### REQ-ARCH-080: Deterministic Ordering
**Full Text**: getAllDiagnostics returns files in alphabetical order.

### REQ-ARCH-090: No Duplicate Processes
**Full Text**: Reuse same server for same server+workspace pair.

## Implementation Tasks

### Files to Modify

- `packages/lsp/src/service/orchestrator.ts`
  - MODIFY: Full implementation
  - MUST include: `@plan:PLAN-20250212-LSP.P19`
  - MUST follow pseudocode `orchestrator.md`:
    - Lines 001-020d: State fields incl. clients, brokenServers, firstTouchServers, knownFileDiagSources, startupPromises [RESEARCH Bug 1], opQueues [RESEARCH Bug 4], diagnosticEpoch [RESEARCH Bug 2]
    - Lines 022-026: Constructor
    - Lines 028-062: checkFile — abort signal guard [REQ-TIME-080], segment-safe boundary check [RESEARCH Bug 6], server resolution, lazy start, per-server workspace root, parallel collection via Promise.allSettled, epoch increment
    - Lines 064-104: collectFromServer — uses getOrStartClient [RESEARCH Bug 1], first-touch one-shot finally block [RESEARCH Bug 5], routes through opQueue.enqueueWrite [RESEARCH Bug 4], passes signal
    - Lines 106-119: startServer — validate binary, spawn via factory with onDiagnostics callback, initialize, crash listener
    - Lines 123-155: getOrStartClient — single-flight startup guard via startupPromises map [RESEARCH Bug 1]
    - Lines 162-183: ClientOpQueue class (enqueueWrite, enqueueRead — no executing flag, deadlock prevention is code-review concern) + getOrCreateOpQueue (lines 191-194)
    - Lines 200-221: Known-files tracking (updateKnownFiles, onServerShutdown) [REQ-KNOWN-030]
    - Lines 223-241: getAllDiagnostics — known-files set via knownFileDiagSources, alphabetical ordering [REQ-ARCH-080]
    - Lines 247-272: getStatus — iterates actual clients map + brokenServers + registry for never-started servers [REQ-STATUS-025, REQ-STATUS-045]
    - Lines 274-285: shutdown — shut down all clients via allSettled, clear all maps including startupPromises and opQueues
    - Lines 289-305: getDiagnosticEpoch + getAllDiagnosticsAfter — epoch-based freshness, waits for orchestrator epoch to advance past captured value [RESEARCH Bug 2]
    - Lines 310-346: Navigation delegation — all routed through opQueue.enqueueRead [RESEARCH Bug 4]
    - Lines 349-360: findClientForFile — per-server workspace root resolution [HIGH 6 FIX]
    - Lines 362-370: isWithinWorkspace — segment-safe boundary check with charAt [RESEARCH Bug 6]
    - Lines 376-385: findNearestProjectRoot — walk up from file, check marker files, fallback to config.workspaceRoot
  - MUST NOT exceed 800 lines

### Files NOT to Modify

- `packages/lsp/test/orchestrator.test.ts` — DO NOT MODIFY
- `packages/lsp/test/orchestrator-integration.test.ts` — DO NOT MODIFY

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P19
 * @requirement REQ-ARCH-040
 * @pseudocode orchestrator.md lines 27-55
 */
```

## Verification Commands

```bash
# All tests pass
cd packages/lsp && bunx vitest run test/orchestrator.test.ts test/orchestrator-integration.test.ts

# No test modifications
git diff packages/lsp/test/orchestrator*.ts | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL" || echo "PASS"

# Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|return \[\]|return \{\})" packages/lsp/src/service/orchestrator.ts
# Expected: No matches

# Pseudocode compliance
grep -c "@pseudocode" packages/lsp/src/service/orchestrator.ts
# Expected: 5+

# Under 800 lines
LINES=$(wc -l < packages/lsp/src/service/orchestrator.ts)
[ "$LINES" -le 800 ] && echo "PASS" || echo "FAIL"

cd packages/lsp && bunx tsc --noEmit && bunx eslint src/service/orchestrator.ts
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/lsp/src/service/orchestrator.ts
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/lsp/src/service/orchestrator.ts
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/lsp/src/service/orchestrator.ts
# Expected: No matches in main logic (OK in guard clauses like dead-service checks)
```

### Semantic Verification Checklist (MANDATORY)

#### Holistic Functionality Assessment

##### What was implemented?
[Describe the orchestrator: state management, routing, parallel collection, boundary checks]

##### Does it satisfy the requirements?
- [ ] REQ-ARCH-040: Single shared instance — cite singleton pattern
- [ ] REQ-BOUNDARY-010/020/030: Path normalization and **segment-safe** boundary check [RESEARCH Bug 6] — cite charAt(root.length) === path.sep
- [ ] REQ-TIME-040: Promise.allSettled for parallel collection — cite code
- [ ] REQ-TIME-085: Partial results from subset when some servers timeout — cite allSettled handling
- [ ] REQ-TIME-090: firstTouchTimeout for cold servers, diagnosticTimeout for warm — cite timeout selection logic
- [ ] REQ-LIFE-010: Lazy startup in getOrStartClient [RESEARCH Bug 1] — cite single-flight guard
- [ ] REQ-LIFE-070: Broken server tracking — cite crash handler
- [ ] REQ-KNOWN-010/020: Known files map management — cite code
- [ ] REQ-KNOWN-030: Multi-server known-files: file in set if ANY server has non-empty diags — cite per-server tracking
- [ ] REQ-ARCH-080: Alphabetical ordering in getAllDiagnostics — cite sort
- [ ] REQ-ARCH-090: Client reuse by serverId+workspaceRoot key — cite Map key
- [ ] REQ-STATUS-025: status() returns all known + configured servers — cite registry iteration
- [ ] REQ-STATUS-045: status() returns servers sorted alphabetically — cite sort

##### Does it satisfy the research-derived rules?
- [ ] BR-82: Single-flight startup via startupPromises — cite getOrStartClient method
- [ ] BR-83: Diagnostic epoch support — cite getAllDiagnosticsAfter method
- [ ] BR-85: Per-client operation queue — cite ClientOpQueue + enqueueWrite/enqueueRead usage
- [ ] BR-86: First-touch one-shot semantics — cite finally block in collectFromServer
- [ ] BR-87: Segment-safe boundary check — cite charAt check in isWithinWorkspace

##### Verdict
[PASS/FAIL]

#### Feature Actually Works

```bash
# Start LSP service manually and test orchestrator:
# (This will be fully testable in P36 E2E. During P19, verify via integration tests.)
cd packages/lsp && bunx vitest run test/orchestrator-integration.test.ts
# Expected: All tests pass, including parallel collection, boundary, and crash handling
```

#### Integration Points Verified
- [ ] Orchestrator receives checkFile calls from RPC channel (verified by test)
- [ ] Orchestrator creates LspClient instances via ServerRegistry configs (verified by tracing)
- [ ] Orchestrator returns diagnostics to caller (verified by checking return value)
- [ ] Boundary check applied before any server interaction (verified by reading code)

#### Lifecycle Verified
- [ ] Servers start lazily on first file touch (REQ-LIFE-010)
- [ ] Shutdown kills all active clients (REQ-LIFE-040)
- [ ] Cleanup removes diagnostic maps (REQ-LIFE-060)
- [ ] Crashed servers marked broken permanently (REQ-LIFE-070)

#### Edge Cases Verified
- [ ] External file path rejected (REQ-BOUNDARY-010)
- [ ] Timeout returns partial results (REQ-TIME-085)
- [ ] First-touch uses extended timeout (REQ-TIME-090)
- [ ] Multiple servers collected in parallel (REQ-TIME-040)
- [ ] Known-files tracked per-server (REQ-KNOWN-030)

## Success Criteria
- All unit and integration tests pass
- No test files modified
- Pseudocode references (orchestrator.md lines 001-393 including sub-lines like 020a-020d, 033a-033b, etc.)
- No deferred implementation patterns
- Parallel diagnostic collection verified (REQ-TIME-040)
- Workspace boundary enforcement verified — **segment-safe** (REQ-BOUNDARY-010/020/030, BR-87)
- Lazy startup with single-flight guard verified (REQ-LIFE-010/020, BR-82)
- Crash handling verified (REQ-LIFE-070)
- Known-files management verified (REQ-KNOWN-010/020/030)
- Per-client operation queue verified (BR-85)
- First-touch one-shot semantics verified (BR-86)
- getAllDiagnosticsAfter epoch support verified (BR-83)
- File ≤ 800 lines (REQ-PKG-030)

## Failure Recovery
1. `git checkout -- packages/lsp/src/service/orchestrator.ts`
2. Re-run Phase 19

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P19.md`
