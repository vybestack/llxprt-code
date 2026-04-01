# Phase 18: CLI Config Event Audit + AppEvent Deprecation

## Phase ID

`PLAN-20260325-MCPSTATUS.P18`

## Prerequisites

- Required: Phase 17a (AppContainer Impl Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P17a.md`
- Expected files from previous phase: AppContainer gating fully working with useMcpStatus + useMessageQueue

## Requirements Implemented (Expanded)

### REQ-EVT-003: Single Source of Truth for Event Name

**Full Text**: The string value of the `McpClientUpdate` event shall appear exactly once in the codebase — as the enum definition.
**Behavior**:
- GIVEN: All MCP emit/listen sites migrated to `CoreEvent.McpClientUpdate`
- WHEN: `grep -rn "mcp-client-update" packages/core/src packages/cli/src integration-tests/` is run
- THEN: Only the `CoreEvent` enum definition line matches
**Why This Matters**: Prevents drift between emit/listen sites using different string values.

### REQ-EVT-005: Extension and Non-MCP Event Compatibility

**Full Text**: Extension lifecycle events and all other non-MCP events shall continue to function correctly after the migration.
**Behavior**:
- GIVEN: MCP events migrated to `coreEvents`
- WHEN: Extension loads/unloads, flicker event fires, OAuth message fires
- THEN: All work exactly as before
**Why This Matters**: Migration must not break existing functionality.

### REQ-CFG-001: MCP Event Propagation via coreEvents

**Full Text**: CoreEvent.McpClientUpdate events emitted by McpClientManager are receivable by useMcpStatus via coreEvents singleton.
**Behavior**:
- GIVEN: McpClientManager emits on coreEvents
- WHEN: useMcpStatus listens on coreEvents
- THEN: Events are received correctly
**Why This Matters**: The entire feature depends on emit and listen using the same event bus.

### REQ-TEST-005: String Literal Enforcement

**Full Text**: No raw `mcp-client-update` string literals outside the enum definition.
**Behavior**:
- GIVEN: All migration complete
- WHEN: Grep for the raw string
- THEN: Only the enum definition matches
**Why This Matters**: Prevents accidental use of raw strings instead of the enum.

## Implementation Tasks

### Files to Audit/Modify

- `packages/cli/src/utils/events.ts`
  - REMOVE or DEPRECATE `AppEvent.McpClientUpdate` (if it exists)
  - Verify no other code references it
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P18` marker

- `packages/core/src/utils/events.ts`
  - Verify `CoreEvent.McpClientUpdate` is the ONLY definition of the string
  - Verify `McpClientUpdatePayload` is exported
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P18` marker if changes needed

- `packages/cli/src/ui/AppContainer.tsx`
  - Verify no remaining references to `AppEvent.McpClientUpdate`
  - Verify all MCP event usage goes through `CoreEvent.McpClientUpdate`

- `packages/core/src/tools/mcp-client-manager.ts`
  - Verify no remaining raw string `'mcp-client-update'` emit calls
  - Verify all emit sites use `CoreEvent.McpClientUpdate`

### Audit Steps

1. **Raw string audit**: `grep -rn "mcp-client-update" packages/core/src packages/cli/src integration-tests/`
   - Expected: Only `CoreEvent` enum definition
   - Fix: Replace any raw strings with `CoreEvent.McpClientUpdate`

2. **AppEvent.McpClientUpdate audit**: `grep -rn "AppEvent.McpClientUpdate\|AppEvent\.McpClientUpdate" packages/`
   - Expected: Only the deprecation/removal site
   - Fix: Remove usages, replace with `CoreEvent.McpClientUpdate`

3. **Event emitter injection audit**: Verify `Config.getExtensionEvents()` still works
   - `grep -rn "getExtensionEvents\|extensionEvents" packages/`
   - Expected: Still returns injected emitter for extensions

4. **Non-MCP event audit**: Verify these events are unchanged
   - `appEvents`: OpenDebugConsole, OauthDisplayMessage, Flicker, McpServersDiscoveryStart, McpServerConnected, McpServerError, LogError
   - `coreEvents`: UserFeedback, MemoryChanged, ModelChanged, ConsoleLog, Output, ExternalEditorClosed, SettingsChanged

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P18
 * @requirement:REQ-EVT-003, REQ-EVT-005, REQ-CFG-001, REQ-TEST-005
 */
```

## Verification Commands

### Automated Checks

```bash
# String literal audit — ONLY enum definition should match
grep -rn "mcp-client-update" packages/core/src packages/cli/src integration-tests/ | grep -v "CoreEvent\." | grep -v "node_modules"
# Expected: 0 matches (only the enum value line itself matches, which contains CoreEvent)

# AppEvent.McpClientUpdate removed/deprecated
grep -rn "AppEvent\.McpClientUpdate" packages/cli/src packages/core/src | grep -v "deprecated\|DEPRECATED\|@deprecated"
# Expected: 0 active usages

# Extension events still work
grep -rn "getExtensionEvents\|extensionEvents" packages/
# Expected: Still present, unchanged

# Non-MCP events intact
grep -rn "OpenDebugConsole\|OauthDisplayMessage\|Flicker\|McpServersDiscoveryStart" packages/cli/src/utils/events.ts
# Expected: All still present

# TypeScript compiles
npm run typecheck

# Full test suite passes
npm run test

# Lint passes
npm run lint
```


### Structural Verification Checklist

- [ ] Previous phase markers present
- [ ] No skipped phases
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Semantic Verification Checklist

1. **Does the code DO what the requirement says?**
   - [ ] Only one definition of the raw string value
   - [ ] All emit/listen sites use the enum constant
   - [ ] Extension events unchanged
   - [ ] Non-MCP events unchanged

2. **Is this REAL implementation, not placeholder?**
   - [ ] Audit found and fixed all raw string usages
   - [ ] AppEvent.McpClientUpdate actually removed/deprecated

3. **Would the test FAIL if implementation was removed?**
   - [ ] This is an audit phase — verification is the implementation

4. **Is the feature REACHABLE?**
   - [ ] CoreEvent.McpClientUpdate used by McpClientManager (emit) and useMcpStatus (listen)

5. **What's MISSING?** (should be nothing after audit)
   - [ ] (check for gaps)

### Deferred Implementation Detection

```bash
# Check for any "will migrate later" comments
grep -rn -E "(TODO|FIXME|migrate later|will be removed)" packages/cli/src/utils/events.ts packages/core/src/utils/events.ts
# Expected: 0 (or only the deprecation notice itself)
```

## Success Criteria

- Zero raw `'mcp-client-update'` strings outside the enum definition
- `AppEvent.McpClientUpdate` removed or marked `@deprecated`
- Extension events unaffected
- Non-MCP events unaffected
- TypeScript compiles
- Full test suite passes
- Lint passes

### Extension Event Safety Matrix

This section documents critical invariants about extension event delivery that MUST be preserved during the MCP event migration.

#### 1. Extension Lifecycle Events Use the INJECTED `eventEmitter`

Extension lifecycle events (`extensionsStarting`, `extensionsStopping`) are emitted via the `eventEmitter` that is injected into `Config`. In the CLI, this injected emitter is `appEvents`. Extensions receive events through this channel — it is their event bus.

#### 2. This Plan MUST NOT Change What Emitter Is Injected Into Config for Extensions

The `appEvents` emitter stays as the extension event bus. The injection site (`Config({ eventEmitter: appEvents })`) is NOT part of this migration. Only MCP-specific events migrate to `coreEvents`; the `Config` constructor's `eventEmitter` parameter continues to receive `appEvents`.

#### 3. Only MCP Events Migrate to `coreEvents`

All other events on `appEvents` remain untouched:
- `OpenDebugConsole`, `OauthDisplayMessage`, `Flicker` — stay on `appEvents`
- `McpServersDiscoveryStart`, `McpServerConnected`, `McpServerError`, `LogError` — stay on `appEvents`
- Extension lifecycle events (`extensionsStarting`, `extensionsStopping`) — stay on the injected `eventEmitter` (which is `appEvents`)

Only `McpClientUpdate` migrates from `appEvents` to `coreEvents`.

#### 4. Verification Grep: Confirm Extension Emitter Wiring Is Preserved

```bash
# Verify that Config's eventEmitter injection still uses appEvents
grep -rn "eventEmitter.*appEvents\|appEvents.*eventEmitter" packages/cli/src/config/ --include="*.ts"
# Expected: At least one match showing appEvents is passed as eventEmitter to Config
```

This grep MUST be run after all changes in this phase and MUST still show `appEvents` being wired as the `eventEmitter`.

#### 5. FORBIDDEN Action

> **🚫 FORBIDDEN: Do NOT change `Config({ eventEmitter: appEvents })` to `coreEvents` — this would break extension event delivery.**

Extensions depend on receiving events through the injected `eventEmitter`. Changing this injection to `coreEvents` would silently break all extension lifecycle events (`extensionsStarting`, `extensionsStopping`) and any other events extensions listen for on the injected emitter. This is a hard constraint — no exceptions.

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/utils/events.ts packages/core/src/utils/events.ts`
2. Re-audit with broader grep to find missed sites
3. Retry audit fixes

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P18.md`
