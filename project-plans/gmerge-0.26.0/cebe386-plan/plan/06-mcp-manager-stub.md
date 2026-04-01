# Phase 06: MCP Manager Emit Migration Stub

## Phase ID

`PLAN-20260325-MCPSTATUS.P06`

## Prerequisites

- Required: Phase 05a (Core Events Impl Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P05a.md`
- Expected files from previous phase: `CoreEvent.McpClientUpdate` and `McpClientUpdatePayload` defined in events.ts
- Preflight verification: Phase 0.5 MUST be completed

## Requirements Implemented (Expanded)

### REQ-MGR-005: Server Count Accessibility

**Full Text**: The `McpClientManager` shall provide a way to determine the count of configured/discovered MCP servers.
**Behavior**:
- GIVEN: A `McpClientManager` instance with N clients
- WHEN: `getMcpServerCount()` is called
- THEN: Returns N
**Why This Matters**: `useMcpStatus` needs the server count to determine `isMcpReady` in the zero-server case.

### REQ-MGR-006: Emit via coreEvents Not Injected EventEmitter

**Full Text**: The `McpClientManager` shall emit `CoreEvent.McpClientUpdate` on the `coreEvents` singleton, not on the injected `eventEmitter` parameter.
**Behavior**:
- GIVEN: An `McpClientManager` that previously emitted on `this.eventEmitter`
- WHEN: Any MCP client update occurs
- THEN: The event is emitted on `coreEvents` using the `CoreEvent.McpClientUpdate` constant
**Why This Matters**: `useMcpStatus` listens on `coreEvents`. If events go to `appEvents`, the hook never receives them.

## Implementation Tasks

### Files to Modify

- `packages/core/src/tools/mcp-client-manager.ts`
  - ADD `import { coreEvents, CoreEvent } from '../utils/events.js'` (coreEvents may already be imported for emitFeedback)
  - ADD `getMcpServerCount(): number { return this.clients.size; }` method
  - BEGIN migrating emit sites: replace `this.eventEmitter?.emit('mcp-client-update', this.clients)` with `coreEvents.emit(CoreEvent.McpClientUpdate, { clients: this.clients })` at all 6 existing sites
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P06` marker
  - ADD `@requirement:REQ-MGR-005`, `@requirement:REQ-MGR-006` markers

### Emit Migration Details (from pseudocode mcp-manager-emits.md)

Migrate ALL 6 existing emit sites (lines 07-29 of pseudocode):
- Line ~116: maybeDiscoverMcpServer success
- Line ~191: client add/update
- Line ~196: client error
- Line ~198: client status change
- Line ~233: removeMcpServer
- Line ~268: restartMcpServer

For each site:
```
BEFORE: this.eventEmitter?.emit('mcp-client-update', this.clients)
AFTER:  coreEvents.emit(CoreEvent.McpClientUpdate, { clients: this.clients })
```

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P06
 * @requirement:REQ-MGR-005, REQ-MGR-006
 * @pseudocode mcp-manager-emits.md lines 01-55
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -r "@plan:PLAN-20260325-MCPSTATUS.P06" packages/core/src/tools/mcp-client-manager.ts | wc -l
# Expected: 1+

# Check getMcpServerCount method exists
grep "getMcpServerCount" packages/core/src/tools/mcp-client-manager.ts
# Expected: 1+ matches

# Check no remaining raw string emits (may still be present if not all migrated)
grep -c "'mcp-client-update'" packages/core/src/tools/mcp-client-manager.ts
# Expected: 0 (all migrated to CoreEvent.McpClientUpdate)

# Check CoreEvent.McpClientUpdate usage
grep -c "CoreEvent.McpClientUpdate" packages/core/src/tools/mcp-client-manager.ts
# Expected: 6+ (one per migrated emit site)

# TypeScript compiles
npm run typecheck
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
   - [ ] `getMcpServerCount()` returns `this.clients.size`
   - [ ] All 6 emit sites use `CoreEvent.McpClientUpdate` instead of raw string
   - [ ] All emit sites use `coreEvents` instead of `this.eventEmitter`

2. **Is this REAL implementation, not placeholder?**
   - [ ] `getMcpServerCount()` returns real value, not 0
   - [ ] Emit calls use real `coreEvents.emit` with payload wrapper

3. **Would the test FAIL if implementation was removed?**
   - [ ] P07 tests will verify emit behavior

4. **Is the feature REACHABLE?**
   - [ ] `getMcpServerCount()` will be called from `useMcpStatus`
   - [ ] Emitted events will be received by `useMcpStatus`

5. **What's MISSING?** (expected — deferred to P08)
   - [ ] COMPLETED transition emit (not yet added)
   - [ ] IN_PROGRESS transition emit (not yet added)
   - [ ] Zero-server fast path emit (not yet added)

## Success Criteria

- `getMcpServerCount()` method exists and returns `this.clients.size`
- All 6 existing emit sites migrated from `this.eventEmitter?.emit('mcp-client-update', ...)` to `coreEvents.emit(CoreEvent.McpClientUpdate, ...)`
- No raw `'mcp-client-update'` strings remain in the file
- `npm run typecheck` passes
- Plan markers present

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/tools/mcp-client-manager.ts`
2. Re-read pseudocode `mcp-manager-emits.md` lines 01-55
3. Retry the emit migration

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P06.md`
