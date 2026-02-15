# Phase 33: Config Integration & MCP Registration

## Phase ID
`PLAN-20250212-LSP.P33`

## Prerequisites
- Required: Phase 32a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P32" packages/core/src/tools/write-file.ts`
- Expected: Edit and write tool integration complete
- Preflight verification: Phase 00a completed

## Requirements Implemented (Expanded)

### REQ-CFG-010: Disable LSP via Configuration
**Full Text**: The system shall support disabling LSP entirely via `"lsp": false` in user configuration, which shall prevent starting any LSP servers, appending any diagnostics, and exposing any navigation tools.
**Behavior**:
- GIVEN: User configuration contains `"lsp": false`
- WHEN: Config.initialize() runs
- THEN: No LspServiceClient is created, getLspServiceClient() returns undefined
**Why This Matters**: Users in environments without Bun or who don't want LSP overhead can cleanly disable it.

### REQ-CFG-015: Zero-Configuration Operation
**Full Text**: The system shall support zero-configuration LSP operation: when the `lsp` configuration key is absent, the system shall treat LSP as enabled by default, subject to runtime and package availability.
**Behavior**:
- GIVEN: No `lsp` key in configuration
- WHEN: Config.initialize() runs
- THEN: LSP is enabled with default settings (treated as `lsp: {}`)

### REQ-CFG-020: Object Presence = Enabled
**Full Text**: The system shall treat the presence of an `"lsp": { ... }` object in configuration as enabling LSP. There shall be no separate `enabled` boolean within the object.
**Behavior**:
- GIVEN: Configuration has `"lsp": { "diagnosticTimeout": 5000 }`
- WHEN: Config.initialize() runs
- THEN: LSP is enabled with diagnosticTimeout=5000

### REQ-CFG-030: Disable Individual Servers
**Full Text**: Where LSP is enabled, the system shall allow disabling individual LSP servers via `"lsp": { "servers": { "<serverId>": { "enabled": false } } }`.

### REQ-CFG-040: Custom Server Configurations
**Full Text**: Where LSP is enabled, the system shall allow users to define custom LSP server configurations specifying command, arguments, file extensions, environment variables, and initialization options.

### REQ-CFG-050: Configurable Diagnostic Timeout
**Full Text**: Where LSP is enabled, the system shall allow users to configure the diagnostic wait timeout via `diagnosticTimeout`.

### REQ-CFG-055: Configurable First-Touch Timeout
**Full Text**: Where LSP is enabled, the system shall allow users to configure the cold-start first-touch timeout via `firstTouchTimeout`.
**Behavior**:
- GIVEN: Configuration has `"lsp": { "firstTouchTimeout": 15000 }`
- WHEN: Config is parsed and passed to LspServiceClient
- THEN: LspServiceClient forwards firstTouchTimeout=15000 to the LSP service
**Why This Matters**: Cold-start timeouts may need tuning for large projects where server initialization takes longer.

### REQ-CFG-060: Configurable Severity Inclusion
**Full Text**: Where LSP is enabled, the system shall allow users to configure included diagnostic severity levels via `includeSeverities`.
**Behavior**:
- GIVEN: Configuration has `"lsp": { "includeSeverities": ["error", "warning"] }`
- WHEN: Config is parsed and passed to LspServiceClient
- THEN: LspServiceClient forwards includeSeverities=["error", "warning"] to the LSP service, and diagnostic output includes both error and warning severity levels instead of the default error-only filter
**Why This Matters**: Some projects benefit from seeing warnings (e.g., unused variables, deprecated API usage) alongside errors. This allows users to tune the diagnostic verbosity to match their workflow without code changes.

### REQ-CFG-070: Navigation Tools Independently Disableable
**Full Text**: Where LSP is enabled, the system shall allow users to disable navigation tools independently of diagnostic feedback via `"lsp": { "navigationTools": false }`.
**Behavior**:
- GIVEN: Configuration has `"lsp": { "navigationTools": false }`
- WHEN: Config.initialize() runs
- THEN: LSP service started (diagnostics work), MCP navigation server NOT registered

### REQ-CFG-080: Server Config Only via User Files
**Full Text**: The system shall only allow custom server `command` and `env` settings via user configuration files, never via LLM-accessible tool calls.

### REQ-NAV-055: Register MCP Only After Service Starts
**Full Text**: The system shall register LSP navigation tools in the LLM's MCP tool list only after the LSP service process has started successfully. If the LSP service fails to start, then navigation tools shall not be registered.
**Behavior**:
- GIVEN: LSP service fails to start (e.g., Bun not found)
- WHEN: Config.initialize() finishes
- THEN: No LSP navigation tools in the LLM's tool list
- GIVEN: LSP service starts successfully and navigationTools is not false
- WHEN: Config.initialize() finishes
- THEN: LSP navigation tools appear in LLM's tool list
**Why This Matters**: Prevents the LLM from seeing tools that will always fail because the backend is not running.

**[RESEARCH — Source 4: MCP Navigation Registration Approach]**: LSP navigation tools use the `@modelcontextprotocol/sdk` `Client` class directly, connecting it with a custom `Transport` that wraps the fd3/fd4 streams from the Bun subprocess. This bypasses `McpClientManager` entirely — no refactoring of `McpClientManager` is needed. The flow is:
1. `LspServiceClient.getMcpTransportStreams()` returns `{ readable: stdio[3], writable: stdio[4] }`
2. Create a custom `Transport` implementing the MCP SDK's `Transport` interface, wrapping these streams
3. Create `new Client({ name: 'lsp-nav', version: '1.0' })` from `@modelcontextprotocol/sdk`
4. `await client.connect(transport)` — discovers available tools
5. Register discovered tools in `ToolRegistry` (the same registry used by other MCP tools)
This is simpler than modifying `McpClientManager` and avoids coupling LSP internals to the general MCP infrastructure.

## Implementation Tasks

### Files to Modify

- `packages/core/src/config/config.ts`
  - MODIFY: Add LSP config parsing, service client lifecycle, MCP registration
  - MUST include: `@plan:PLAN-20250212-LSP.P33`
  - MUST include: `@requirement:REQ-CFG-010`, `@requirement:REQ-CFG-015`, `@requirement:REQ-CFG-070`
  - MUST follow pseudocode `config-integration.md` line-by-line:
    - Lines 42-43: Add imports for LspServiceClient and LspConfig type
    - Lines 46: Add `lsp?: LspConfig | false` to ConfigOptions
    - Lines 49-50: Add private fields `lspServiceClient?` and `lspConfig?`
    - Lines 53: Store lspConfig in constructor
    - Lines 58-81: In initialize(): if lspConfig !== false, create LspServiceClient, call start(), if alive register MCP navigation (if navigationTools not false)
    - Lines 85-91: Add accessor methods getLspConfig() and getLspServiceClient()
    - Lines 95-97: In cleanup/shutdown: shutdown LspServiceClient

- `packages/core/src/lsp/types.ts` (already created in Phase 03)
  - VERIFY: LspConfig and LspServerConfig types exist and match pseudocode lines 20-37

### Files to Create

- `packages/core/src/config/__tests__/config-lsp-integration.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P33`
  - Tests (12+):
    1. `lsp: false` → getLspServiceClient() returns undefined
    2. `lsp` key absent → LSP enabled with defaults
    3. `lsp: {}` → LSP enabled with defaults
    4. `lsp: { diagnosticTimeout: 5000 }` → Config passes to LspServiceClient
    5. getLspConfig() returns undefined when lsp is false
    6. getLspConfig() returns default config when lsp key absent
    7. getLspConfig() returns user config when lsp is object
    8. LspServiceClient.start() called during initialize
    9. LspServiceClient.shutdown() called during cleanup
    10. `navigationTools: false` → MCP navigation server NOT registered
    11. `navigationTools: true` (or absent) → MCP navigation server registered
    12. LspServiceClient startup failure → no error, getLspServiceClient returns undefined
    13. `firstTouchTimeout: 15000` → Config passes firstTouchTimeout to LspServiceClient (REQ-CFG-055)
    14. LSP service fails to start → MCP navigation tools NOT registered (REQ-NAV-055)
    15. LSP service starts OK + navigationTools true → MCP navigation registered (REQ-NAV-055)

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P33
 * @requirement REQ-CFG-010
 * @requirement REQ-CFG-015
 * @requirement REQ-CFG-070
 * @pseudocode config-integration.md lines 39-114
 */
```

## Verification Commands

### Automated Checks

```bash
# Config LSP integration tests pass
npx vitest run packages/core/src/config/__tests__/config-lsp-integration.test.ts
# Expected: All pass

# Existing config tests still pass
npx vitest run packages/core/src/config/__tests__/config.test.ts
# Expected: All pass (no regression)

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P33" packages/core/src/config/config.ts | wc -l
# Expected: 1+

# getLspServiceClient accessor exists
grep "getLspServiceClient" packages/core/src/config/config.ts && echo "PASS" || echo "FAIL"

# getLspConfig accessor exists
grep "getLspConfig" packages/core/src/config/config.ts && echo "PASS" || echo "FAIL"

# LspServiceClient imported
grep "LspServiceClient" packages/core/src/config/config.ts && echo "PASS" || echo "FAIL"

# lsp field in ConfigOptions
grep "lsp.*LspConfig\|lsp.*false" packages/core/src/config/config.ts && echo "PASS" || echo "FAIL"

# Shutdown in cleanup
grep -A5 "lspServiceClient" packages/core/src/config/config.ts | grep "shutdown" && echo "PASS" || echo "FAIL"

```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/config/config.ts | grep -i "lsp"
# Expected: No matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/config/config.ts | grep -i "lsp"
# Expected: No matches

grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/config/config.ts | grep -i "lsp"
# Expected: No matches in LSP config/lifecycle code

# TypeScript compiles
cd packages/core && npx tsc --noEmit
```

### Semantic Verification Checklist (MANDATORY)

#### Holistic Functionality Assessment

##### What was implemented?
[Describe: Config parses lsp option, starts LspServiceClient in initialize(), registers MCP nav tools, provides accessors, shuts down on cleanup]

##### Does it satisfy the requirements?
- [ ] REQ-CFG-010: `lsp: false` → no service client created — cite conditional check
- [ ] REQ-CFG-015: Absent `lsp` key → enabled with defaults — cite undefined handling
- [ ] REQ-CFG-020: Object presence = enabled — cite `lspConfig !== false` check
- [ ] REQ-CFG-070: navigationTools false → skip MCP registration — cite conditional
- [ ] REQ-CFG-080: Config only from user files — cite no LLM-accessible config modification

##### Integration points verified
- [ ] LspServiceClient constructor receives config and workspaceRoot
- [ ] start() is called during initialize() (after workspace context ready)
- [ ] isAlive() checked after start() — only register MCP if alive
- [ ] getMcpTransportStreams() used for MCP registration
- [ ] shutdown() called during cleanup
- [ ] getLspServiceClient() accessible from tools (edit.ts, write-file.ts)

##### Verdict
[PASS/FAIL with explanation]

#### Feature Actually Works

```bash
npx vitest run packages/core/src/config/__tests__/config-lsp-integration.test.ts
# Expected: All tests pass — config init/shutdown/accessors
```

#### Integration Points Verified
- [ ] Config.initialize() creates LspServiceClient with correct parameters (config, workspaceRoot)
- [ ] getLspServiceClient() returns the same instance to edit.ts and write-file.ts
- [ ] getLspConfig() returns the parsed config for tools that need cap values
- [ ] MCP registration connects fd3/fd4 streams via direct MCP SDK `Client.connect(fdTransport)`, NOT McpClientManager
- [ ] Config.cleanup/shutdown calls LspServiceClient.shutdown()

#### Lifecycle Verified
- [ ] LSP service started AFTER workspace context is established in initialize()
- [ ] LSP service started BEFORE tools are available (tools depend on getLspServiceClient)
- [ ] MCP navigation registered AFTER LSP service starts successfully
- [ ] LSP service shut down BEFORE other cleanup that might depend on it
- [ ] No async operations left dangling (start() is awaited)

#### Edge Cases Verified
- [ ] `lsp: false` → no service client
- [ ] `lsp` absent → enabled by default
- [ ] LspServiceClient.start() fails → no error, no MCP tools
- [ ] `navigationTools: false` → diagnostics work, no MCP tools
- [ ] `firstTouchTimeout` passed through correctly

## Success Criteria
- Config properly initializes/shuts down LSP service
- All config options respected (false, absent, object)
- MCP navigation conditionally registered
- Existing config tests pass (no regression)
- 12+ new tests pass

## Failure Recovery
1. `git checkout -- packages/core/src/config/config.ts`
2. `git checkout -- packages/core/src/config/__tests__/config-lsp-integration.test.ts`
3. Re-run Phase 33

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P33.md`
