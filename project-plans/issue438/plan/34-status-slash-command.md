# Phase 34: Status Slash Command

## Phase ID
`PLAN-20250212-LSP.P34`

## Prerequisites
- Required: Phase 33a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P33" packages/core/src/config/config.ts`
- Expected files from previous phase:
  - `packages/core/src/config/config.ts` — with LSP config integration complete
  - `packages/core/src/lsp/lsp-service-client.ts` — fully implemented
- Preflight verification: Phase 00a MUST be completed before any implementation phase

## Requirements Implemented (Expanded)

### REQ-STATUS-010: Slash Command for LSP Status
**Full Text**: The system shall expose LSP server status via a slash command (e.g., `/lsp status`).
**Behavior**:
- GIVEN: User is in an active CLI session with LSP enabled
- WHEN: User types `/lsp status`
- THEN: System displays the status of all known LSP servers
**Why This Matters**: Users need visibility into which LSP servers are running, broken, or unavailable for debugging.

### REQ-STATUS-020: Server Status Values
**Full Text**: When the user invokes `/lsp status`, the system shall report each known server with one of the following statuses: `active`, `starting`, `broken`, `disabled`, or `unavailable`.
**Behavior**:
- GIVEN: tsserver is running, gopls has crashed, pyright is disabled
- WHEN: `/lsp status` invoked
- THEN: Output shows "typescript: active", "gopls: broken", "pyright: disabled"
**Why This Matters**: Clear, consistent status labels help users understand what LSP functionality is available.

### REQ-STATUS-025: All Known and Configured Servers Reported
**Full Text**: When reporting `/lsp status`, the system shall include all known and configured servers tracked by the LSP service (built-in and user-defined custom), each shown with one of the defined statuses.
**Behavior**:
- GIVEN: Built-in servers (typescript, eslint, gopls, pyright, rust-analyzer) and a user-defined custom server "myserver"
- WHEN: `/lsp status` invoked
- THEN: All 6 servers are listed with their current status
**Why This Matters**: Users with custom server configurations need to see those servers in the status output too.

### REQ-STATUS-030: Unavailable Service Reason
**Full Text**: If the LSP service itself is unavailable (Bun not installed, LSP package not present), then `/lsp status` shall display a single line: `LSP unavailable: <reason>`.
**Behavior**:
- GIVEN: Bun is not installed
- WHEN: `/lsp status` invoked
- THEN: Displays "LSP unavailable: Bun not found in PATH" (or similar specific reason)
**Why This Matters**: Users need to know WHY LSP is not working to take corrective action.

### REQ-STATUS-035: Specific Failure Reason in Status
**Full Text**: If `/lsp status` reports LSP as unavailable, then the reason shall reflect the specific startup failure cause (e.g., "Bun not found in PATH," "LSP package not installed," or "service startup failed").
**Behavior**:
- GIVEN: The `@vybestack/llxprt-code-lsp` package is not installed
- WHEN: `/lsp status` invoked
- THEN: Displays "LSP unavailable: LSP package not installed" (specific, not generic)
**Why This Matters**: Generic "unavailable" messages are not actionable; specific reasons guide the user.

### REQ-STATUS-040: Available Regardless of Navigation Tools Setting
**Full Text**: The `/lsp status` command shall remain available regardless of whether navigation tools are disabled via `lsp.navigationTools: false`. Status visibility is independent of navigation tool exposure.
**Behavior**:
- GIVEN: Configuration has `lsp: { navigationTools: false }`
- WHEN: `/lsp status` invoked
- THEN: Status command still works, shows server statuses
**Why This Matters**: Disabling navigation tools should not prevent users from checking server health.

### REQ-STATUS-045: Deterministic Alphabetical Server Ordering
**Full Text**: When the user invokes `/lsp status`, the system shall order reported servers deterministically by server ID in ascending alphabetical order.
**Behavior**:
- GIVEN: Servers typescript, eslint, gopls, pyright, rust-analyzer are known
- WHEN: `/lsp status` invoked
- THEN: Output order is: eslint, gopls, pyright, rust-analyzer, typescript
**Why This Matters**: Deterministic ordering makes the output predictable and machine-parseable; prevents confusing random reordering across invocations.

### REQ-STATUS-050: Status Available When LSP Disabled
**Full Text**: If `lsp` is configured as `false`, then the system shall keep `/lsp status` available and shall report that LSP is disabled by configuration.
**Behavior**:
- GIVEN: User configuration has `"lsp": false`
- WHEN: `/lsp status` invoked
- THEN: Displays "LSP disabled by configuration" (not an error, not "command not found")
**Why This Matters**: Even with LSP disabled, the status command should exist to confirm the disabled state rather than confusing users with a missing command.

## Expected Output Contracts (Exact Strings)

These are the exact output strings the `/lsp status` command MUST produce in each scenario. Tests MUST assert these exact strings.

### When `lsp: false` in configuration (REQ-STATUS-050)
```
LSP disabled by configuration
```
Single line, no server list, no additional text.

### When Bun not found in PATH (REQ-STATUS-035)
```
LSP unavailable: Bun not found in PATH
```
Single line, specific reason text.

### When LSP package not installed (REQ-STATUS-035)
```
LSP unavailable: LSP package not installed
```
Single line, specific reason text.

### When service startup failed for other reason (REQ-STATUS-035)
```
LSP unavailable: service startup failed
```
Single line, specific reason text.

### When LSP service is alive with servers (REQ-STATUS-025, REQ-STATUS-045)
```
LSP server status:
  eslint: active
  gopls: unavailable
  myserver: active
  pyright: disabled
  rust-analyzer: unavailable
  typescript: active
```
The universe of servers = ALL built-in servers (typescript, eslint, gopls, pyright, rust-analyzer) PLUS any user-defined custom servers (e.g., "myserver"). Every server in the universe appears in the output, each with one of the defined statuses. Servers are sorted alphabetically by server ID (REQ-STATUS-045). Indentation is 2 spaces. Status values are exactly one of: `active`, `starting`, `broken`, `disabled`, `unavailable`.

### Example with all status types
```
LSP server status:
  eslint: active
  gopls: broken
  myserver: starting
  pyright: disabled
  rust-analyzer: unavailable
  typescript: active
```

## Implementation Tasks

### Files to Create/Modify

- `packages/core/src/commands/lsp-status.ts` (NEW or add to existing slash command handler)
  - MUST include: `@plan:PLAN-20250212-LSP.P34`
  - MUST include: `@requirement:REQ-STATUS-010`, `@requirement:REQ-STATUS-025`, `@requirement:REQ-STATUS-030`, `@requirement:REQ-STATUS-035`, `@requirement:REQ-STATUS-045`, `@requirement:REQ-STATUS-050`
  - Implements `/lsp status` slash command handler:
    - **Path 1: lsp config is false** → Display "LSP disabled by configuration" (REQ-STATUS-050)
    - **Path 2: LspServiceClient is undefined or dead** → Display "LSP unavailable: <specific reason>" (REQ-STATUS-030, REQ-STATUS-035)
    - **Path 3: LspServiceClient is alive** → Call `client.status()`, format each server:
      - Sort servers alphabetically by server ID (REQ-STATUS-045)
      - Format: one line per server: `  serverId: status` (REQ-STATUS-020) — see Expected Output Contracts for exact format
      - Include ALL servers: built-in + custom (REQ-STATUS-025)
  - The unavailability reason must be stored by LspServiceClient during startup failure and exposed via a getter (e.g., `getUnavailableReason(): string | undefined`)

- Register the `/lsp` command with the existing slash command system
  - Identify existing slash command registration pattern (grep for existing commands like `/set`, `/help`)
  - Follow the exact same pattern for registration
  - Command must be registered REGARDLESS of lsp config setting (REQ-STATUS-050)

### Files to Create (Tests)

- `packages/core/src/commands/__tests__/lsp-status.test.ts` (or appropriate test location matching existing patterns)
  - MUST include: `@plan:PLAN-20250212-LSP.P34`
  - Tests (12+):
    1. `/lsp status` with live service and active servers → shows server statuses
    2. `/lsp status` with dead service → shows "LSP unavailable: ..." with specific reason (REQ-STATUS-035)
    3. `/lsp status` with `lsp: false` config → shows "LSP disabled by configuration" (REQ-STATUS-050)
    4. Server statuses formatted correctly (active, starting, broken, disabled, unavailable) (REQ-STATUS-020)
    5. All known servers reported including custom servers (REQ-STATUS-025)
    6. Available when `navigationTools: false` (REQ-STATUS-040)
    7. Specific unavailability reason: "Bun not found in PATH" (REQ-STATUS-035)
    8. Specific unavailability reason: "LSP package not installed" (REQ-STATUS-035)
    9. Specific unavailability reason: "service startup failed" (REQ-STATUS-035)
    10. Servers sorted alphabetically by ID (REQ-STATUS-045)
    11. Follows existing slash command output patterns
    12. Command registered in command system (slash command discoverable)

### Required Code Markers

Every function/class/test created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250212-LSP.P34
 * @requirement REQ-STATUS-010
 * @requirement REQ-STATUS-025
 * @requirement REQ-STATUS-045
 * @requirement REQ-STATUS-050
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250212-LSP.P34" packages/core/ | wc -l
# Expected: 2+ (source + test)

# Check requirements covered
grep -r "@requirement:REQ-STATUS" packages/core/ | wc -l
# Expected: 4+ occurrences

# Run phase-specific tests
npx vitest run packages/core/src/commands/__tests__/lsp-status.test.ts
# Expected: All pass

# Command registered
grep -r "lsp" packages/core/src/commands/ --include="*.ts" | grep -v test | grep -v __tests__
# Expected: lsp command handler found

# TypeScript compiles
cd packages/core && npx tsc --noEmit
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/commands/lsp-status.ts 2>/dev/null
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/commands/lsp-status.ts 2>/dev/null
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/commands/lsp-status.ts 2>/dev/null
# Expected: No matches in main logic path
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] I read REQ-STATUS-010 through REQ-STATUS-050
   - [ ] I read the lsp-status.ts implementation (not just checked file exists)
   - [ ] I can explain HOW each status requirement is fulfilled

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed (no TODO/HACK/STUB)
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify actual output text (server names, statuses, ordering)
   - [ ] Tests would catch a broken implementation

4. **Is the feature REACHABLE by users?**
   - [ ] `/lsp status` command is registered in the slash command system
   - [ ] User can type it and get a response
   - [ ] Command is available even with `lsp: false`

5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] [gap 1 or "none"]
   - [ ] [gap 2 or "none"]

#### Feature Actually Works

```bash
# Manual test command (RUN THIS and paste actual output):
# In an active llxprt session, type /lsp status
# Expected behavior: Shows list of servers with statuses, sorted alphabetically
# Actual behavior: [paste what actually happens]
```

#### Integration Points Verified

- [ ] Slash command registered following existing patterns (verified by finding registration code)
- [ ] getLspServiceClient() accessed correctly (verified by reading both files)
- [ ] status() call returns ServerStatus[] (verified by tracing return value)
- [ ] Servers sorted alphabetically by ID (verified by reading sort code)
- [ ] Error handling for dead service (verified by reading the fallback branch)

#### Lifecycle Verified

- [ ] Command works during normal session
- [ ] Command works when LSP service is dead
- [ ] Command works when config has `lsp: false`
- [ ] No async leaks (status() call is awaited)

#### Edge Cases Verified

- [ ] No servers at all (empty list) → shows appropriate message
- [ ] All servers broken → shows all as "broken"
- [ ] Mixed statuses → each shown correctly
- [ ] Custom servers → included in output

## Success Criteria

- `/lsp status` command registered and functional
- Shows server statuses when LSP alive, sorted alphabetically (REQ-STATUS-045)
- Shows unavailability reason with specific cause when LSP dead (REQ-STATUS-035)
- Shows "LSP disabled by configuration" when `lsp: false` (REQ-STATUS-050)
- Available regardless of navigationTools setting (REQ-STATUS-040)
- All known + custom servers reported (REQ-STATUS-025)
- 12+ tests pass
- Follows existing slash command patterns

## Failure Recovery

If this phase fails:

1. Rollback commands:
   ```bash
   git checkout -- packages/core/src/commands/lsp-status.ts
   rm -f packages/core/src/commands/__tests__/lsp-status.test.ts
   ```
2. Files to revert: lsp-status.ts, test file
3. Cannot proceed to Phase 35 until fixed

## Phase Completion Marker

Create: `project-plans/issue438/.completed/P34.md`
Contents:
```markdown
Phase: P34
Completed: YYYY-MM-DD HH:MM
Files Created: [list with line counts]
Files Modified: [list with diff stats]
Tests Added: [count]
Verification: [paste of verification command outputs]
```
