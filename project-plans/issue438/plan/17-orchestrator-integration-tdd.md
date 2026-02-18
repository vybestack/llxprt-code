# Phase 17: Orchestrator Integration TDD

## Phase ID
`PLAN-20250212-LSP.P17`

## Prerequisites
- Required: Phase 16a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P16" packages/lsp/src/service/orchestrator.ts`
- Expected: Orchestrator stub, LspClient implemented, ServerRegistry implemented, Diagnostics implemented

## Requirements Implemented (Expanded)

Integration tests verifying that the Orchestrator correctly coordinates LspClient, ServerRegistry, and Diagnostics together. Uses the fake-lsp-server fixture for real protocol testing.

### REQ-TIME-040: Parallel Diagnostic Collection
**Full Text**: The system shall collect diagnostics from all servers in parallel, not sequentially.
**Behavior**:
- GIVEN: A .ts file (served by tsserver + eslint)
- WHEN: checkFile() is called
- THEN: Both servers are queried in parallel, results are merged

### REQ-BOUNDARY-010: Workspace Boundary Enforcement
**Full Text**: The system shall reject files outside the workspace root.
**Behavior**:
- GIVEN: workspaceRoot is "/project"
- WHEN: checkFile("/etc/passwd") is called
- THEN: Returns empty diagnostics without starting any server

### REQ-LIFE-090: Broken Server Bypass
**Full Text**: While an LSP server is marked as broken, edits proceed without diagnostics.
**Behavior**:
- GIVEN: TypeScript server crashed and is marked broken
- WHEN: checkFile("foo.ts") is called
- THEN: Only ESLint diagnostics are returned (tsserver is skipped)

### REQ-KNOWN-010: Known Files Set
**Full Text**: Known files are those with non-empty diagnostics from publishDiagnostics.
**Behavior**:
- GIVEN: Server has sent diagnostics for files A, B, C
- WHEN: getAllDiagnostics() is called
- THEN: Returns diagnostics for A, B, C only

### REQ-KNOWN-030: Multi-Server Known-Files Tracking
**Full Text**: When multiple LSP servers track the same file, the known-files set shall include that file if any active server holds non-empty diagnostics for it. The file shall be removed only when all servers' diagnostics for it are empty.
**Behavior**:
- GIVEN: tsserver has errors for foo.ts, eslint has none
- WHEN: getAllDiagnostics() is called
- THEN: foo.ts IS in the result (tsserver has non-empty diags)

### REQ-TIME-090: First-Touch vs Normal Timeout
**Full Text**: While a server is in first-touch initialization, apply firstTouchTimeout. Once initialized, apply diagnosticTimeout.
**Behavior**:
- GIVEN: tsserver has never been started
- WHEN: checkFile() called for a .ts file
- THEN: firstTouchTimeout is used for this request

### REQ-STATUS-025: All Known and Configured Servers in Status
**Full Text**: Status includes all built-in and user-defined custom servers.

### REQ-STATUS-045: Deterministic Server Ordering
**Full Text**: Status returns servers sorted alphabetically by ID.

## Implementation Tasks

### Files to Create

- `packages/lsp/test/orchestrator-integration.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P17`
  - Integration tests using real LspClient + ServerRegistry + Diagnostics + fake-lsp-server:
    1. checkFile routes to correct server based on extension
    2. checkFile starts server lazily on first touch
    3. checkFile collects from multiple servers in parallel
    4. checkFile with workspace-external file returns empty
    5. getAllDiagnostics returns known-files set
    6. Broken server is skipped, others still work
    7. Shutdown stops all servers
    8. Status reports all server states
    9. Navigation methods delegate to correct client
    10. Unknown extension returns empty (no server started)
    11. Multi-server known-files: file in set while ANY server has diags (REQ-KNOWN-030)
    12. First-touch timeout used for cold server, normal timeout for warm (REQ-TIME-090)
    13. Status includes all known + configured servers (REQ-STATUS-025)
    14. Status returns servers sorted alphabetically (REQ-STATUS-045)
  - NO mock theater — uses real components with fake-lsp-server
  - Tests FAIL naturally on orchestrator stubs

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P17
 * @requirement REQ-TIME-040
 * @scenario Parallel diagnostic collection from tsserver + eslint
 * @given A .ts file and both servers are running
 * @when checkFile is called
 * @then Diagnostics from both servers are returned merged
 */
```

## Verification Commands

```bash
test -f packages/lsp/test/orchestrator-integration.test.ts && echo "PASS" || echo "FAIL"
TEST_COUNT=$(grep -c "it(" packages/lsp/test/orchestrator-integration.test.ts)
[ "$TEST_COUNT" -ge 14 ] && echo "PASS" || echo "FAIL"
grep -rn "NotYetImplemented" packages/lsp/test/orchestrator-integration.test.ts && echo "FAIL" || echo "PASS"
grep -rn "toHaveBeenCalled" packages/lsp/test/orchestrator-integration.test.ts && echo "WARNING" || echo "PASS"
cd packages/lsp && bunx vitest run test/orchestrator-integration.test.ts 2>&1 | tail -5
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/lsp/test/orchestrator-integration.test.ts
# Expected: No matches

grep -rn -E "(skip|xit|xdescribe|\.todo)" packages/lsp/test/orchestrator-integration.test.ts
# Expected: No skipped tests
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do tests verify parallel diagnostic collection?** — REQ-TIME-040: multiple servers queried in parallel
   - [ ] Test verifies that total time < sum of individual server times
2. **Do tests verify workspace boundary enforcement?** — REQ-BOUNDARY-010
   - [ ] Test with file outside workspace root → rejected
3. **Do tests verify lazy startup?** — REQ-LIFE-010/020
   - [ ] No servers running before first checkFile, server starts on first touch
4. **Do tests verify crash handling?** — REQ-LIFE-070
   - [ ] Server crash → marked broken → no restart

#### Feature Actually Works

```bash
cd packages/lsp && bunx vitest run test/orchestrator-integration.test.ts 2>&1 | tail -5
# Expected: Tests FAIL on orchestrator stubs
```

#### Integration Points Verified
- [ ] Orchestrator created with real ServerRegistry and LanguageMap instances
- [ ] Orchestrator manages real LspClient instances (via fake-lsp-server)
- [ ] Diagnostics flow: checkFile → LspClient.touchFile → waitForDiagnostics → merge

#### Lifecycle Verified
- [ ] Tests verify no servers started at construction
- [ ] Tests verify shutdown stops all active clients
- [ ] afterEach properly shuts down orchestrator and all servers

#### Edge Cases Verified
- [ ] checkFile for file with no matching server → empty diagnostics, no error
- [ ] checkFile for binary file → ignored (REQ-SCOPE-010)
- [ ] Multiple checkFile calls for same file → server not restarted
- [ ] Known-files set updated correctly (REQ-KNOWN-010/020/030)

## Success Criteria
- 10+ integration tests
- Real components used (no mocking LspClient or ServerRegistry)
- Tests fail naturally on orchestrator stubs
- Covers parallel collection, boundary, crash, known-files

## Failure Recovery
1. `git checkout -- packages/lsp/test/orchestrator-integration.test.ts`
2. Re-run Phase 17

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P17.md`
