# Phase 30a: LspServiceClient Implementation Verification

## Phase ID
`PLAN-20250212-LSP.P30a`

## Prerequisites
- Required: Phase 28 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P30" packages/core/src/lsp/lsp-service-client.ts`

## Verification Commands

```bash
# All phase tests pass
npx vitest run packages/core/src/lsp/__tests__/lsp-service-client.test.ts packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts
# Expected: All pass

# No test modifications
TEST_DIFF=$(git diff --name-only -- packages/core/src/lsp/__tests__/)
if [ -n "$TEST_DIFF" ]; then
  echo "FAIL: tests modified"
  echo "$TEST_DIFF"
else
  echo "PASS"
fi

# No deferred implementation markers
grep -rn -E "(TODO|FIXME|HACK|STUB|placeholder|for now)" packages/core/src/lsp/lsp-service-client.ts && echo "FAIL" || echo "PASS"

# No cop-out language in implementation
grep -rn -E "(in a real|in production|ideally|not yet|will be|should be)" packages/core/src/lsp/lsp-service-client.ts && echo "FAIL" || echo "PASS"

# No Bun APIs in core implementation
grep -rn "Bun\.\|from.*bun" packages/core/src/lsp/lsp-service-client.ts && echo "FAIL: Bun in core" || echo "PASS"

# MUST-HAVE presence checks: real process + jsonrpc coupling
grep -rn -E "from 'node:child_process'|from \"node:child_process\"|\bspawn\(" packages/core/src/lsp/lsp-service-client.ts
# Expected: matches child_process import and spawn usage

grep -rn -E "vscode-jsonrpc|createMessageConnection|StreamMessageReader|StreamMessageWriter|MessageConnection" packages/core/src/lsp/lsp-service-client.ts
# Expected: matches jsonrpc import/use and connection construction

grep -rn "sendRequest" packages/core/src/lsp/lsp-service-client.ts
# Expected: 1+ matches

# MUST-HAVE RPC method coverage
grep -rn -E "lsp/checkFile|lsp/diagnostics|lsp/status|lsp/shutdown|lsp/ready" packages/core/src/lsp/lsp-service-client.ts
# Expected: 1+ matches for each method including lsp/ready handling

# MUST-HAVE environment handling
grep -rn "LSP_BOOTSTRAP" packages/core/src/lsp/lsp-service-client.ts
# Expected: 1+ matches

# MUST-HAVE signal handling
grep -rn -E "SIGTERM|SIGKILL" packages/core/src/lsp/lsp-service-client.ts
# Expected: 1+ matches for both

# TypeScript validation
cd packages/core && npx tsc --noEmit
```

### Semantic Verification Checklist
- [ ] `packages/core/src/lsp/lsp-service-client.ts` imports and uses child process spawn (`node:child_process` + `spawn`)
- [ ] `packages/core/src/lsp/lsp-service-client.ts` imports and uses `vscode-jsonrpc`
- [ ] Implementation uses `createMessageConnection` with stream reader/writer over subprocess stdio
- [ ] Implementation uses `sendRequest` to perform RPC calls
- [ ] RPC methods `lsp/checkFile`, `lsp/diagnostics`, `lsp/status`, and `lsp/shutdown` are present and invoked
- [ ] `lsp/ready` lifecycle handling is implemented
- [ ] `LSP_BOOTSTRAP` environment handling is implemented
- [ ] Shutdown signal handling includes both `SIGTERM` and `SIGKILL`
- [ ] Bun detection via which/execSync — silent fail if not found
- [ ] LSP package detection via fs.accessSync — silent fail if missing
- [ ] Exit/error event handlers set alive=false (no restart)
- [ ] checkFile/getAllDiagnostics/status return empty on dead service
- [ ] getMcpTransportStreams returns stdio[3]/stdio[4]
- [ ] No Bun-specific APIs used anywhere in the file

## Holistic Functionality Assessment

### What was implemented?
[Describe in your own words: LspServiceClient is the core-side bridge to the LSP service subprocess. It detects whether Bun is available and the LSP package is installed, spawns the Bun subprocess with 5-element stdio array, creates a JSON-RPC MessageConnection over stdin/stdout for the diagnostic channel, exposes fd3/fd4 for MCP navigation, provides checkFile/getAllDiagnostics/status methods that forward to JSON-RPC, handles subprocess death by setting alive=false permanently (no restart per REQ-LIFE-080), and performs graceful+forced shutdown. Verify by reading lsp-service-client.ts.]

### Does it satisfy the requirements?
- [ ] REQ-ARCH-010: Separate Bun-native child process — cite child_process.spawn with 'bun' command
- [ ] REQ-ARCH-020: JSON-RPC over stdin/stdout — cite MessageConnection creation
- [ ] REQ-ARCH-030: MCP over fd3/fd4 — cite getMcpTransportStreams returning stdio[3]/stdio[4]
- [ ] REQ-ARCH-050: No Bun APIs in core — cite imports (only node: and vscode-jsonrpc)
- [ ] REQ-ARCH-060: Only vscode-jsonrpc as new core dependency — cite package.json
- [ ] REQ-GRACE-020: Bun not available → silently disable, debug log — cite the detection method
- [ ] REQ-GRACE-030: LSP package not installed → silently disable — cite the package check
- [ ] REQ-GRACE-040: Service dead → isAlive()=false, empty returns — cite the guard clauses
- [ ] REQ-GRACE-045: Startup failure → permanently disabled — cite no-retry logic
- [ ] REQ-LIFE-050: Shutdown: lsp/shutdown → wait → kill — cite the shutdown method with SIGTERM/SIGKILL
- [ ] REQ-LIFE-080: Service process dies → no restart — cite exit handler

### What is the data flow?
[Trace: start() → detectBun() (if missing, set alive=false, return) → detectPackage() (if missing, set alive=false, return) → spawn('bun', ['run', entryPoint], {stdio: 5-array}) → createMessageConnection(stdout, stdin) → set alive=true. Then checkFile("src/app.ts") → if !alive return [] → connection.sendRequest('lsp/checkFile', {filePath}) → await response → return Diagnostic[]. Show actual code.]

### What could go wrong?
[Identify risks: Bun path detection fails on some platforms (e.g., NixOS with unusual PATH)? Subprocess spawn fails after Bun is detected (bad LSP package entry point)? fd3/fd4 not supported on all Node.js versions? JSON-RPC connection silently drops messages? SIGKILL leaves zombie language servers? Verify each risk is handled.]

### Verdict
[PASS/FAIL with explanation. If PASS, explain confidence in Bun detection, subprocess management, graceful degradation, and IPC channels. If FAIL, list gaps.]

### Anti-Fake Detection

```bash
# FAIL if implementation uses PassThrough transports in production client
grep -rn "PassThrough" packages/core/src/lsp/lsp-service-client.ts && echo "FAIL" || echo "PASS"

# FAIL if implementation has test-aware fake controls or synthetic hardcoded branches
grep -rn -E "(integrationScenarioStartCount|shouldForceIntegrationUnavailableScenario|callNumber\s*===)" packages/core/src/lsp/lsp-service-client.ts && echo "FAIL" || echo "PASS"

# FAIL if implementation includes hardcoded synthetic diagnostic messages
grep -rn -E "(File checked by LSP service|LSP service initialized|synthetic diagnostic|mock diagnostic|fake diagnostic)" packages/core/src/lsp/lsp-service-client.ts && echo "FAIL" || echo "PASS"

# FAIL if implementation stores synthetic/local diagnostic cache names as server truth
grep -rn -E "(diagnosticMap|localDiagnostics|syntheticDiagnostics|fakeDiagnostics|diagnosticsByFile)" packages/core/src/lsp/lsp-service-client.ts && echo "FAIL" || echo "PASS"

# General deferred implementation detection in implementation file
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/lsp/lsp-service-client.ts
# Expected: No matches
```

### Feature Actually Works

```bash
# Verify full core suite and targeted tests
npx vitest run packages/core/src/lsp/__tests__/lsp-service-client.test.ts packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts
cd packages/core && npx tsc --noEmit
# Expected: All pass
```

## Success Criteria
- All verification checks pass
- Anti-fake detection confirms real subprocess + JSON-RPC coupling (not synthetic local behavior)
- Semantic verification confirms behavioral correctness
- Phase 30 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 30 to fix issues
3. Re-run Phase 30a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P30a.md`
