# Phase 05a: Core Events Implementation Verification

## Phase ID

`PLAN-20260325-MCPSTATUS.P05a`

## Prerequisites

- Required: Phase 05 completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P05.md`

## Verification Tasks

### 1. Pseudocode Compliance

Compare implementation with `analysis/pseudocode/core-events.md`:

- [ ] Lines 01-08 (McpClientUpdate enum member): Present with correct string value
- [ ] Lines 10-17 (McpClientUpdatePayload): Interface with ReadonlyMap<string, McpClient>
- [ ] Lines 19-28 (CoreEvents interface entry): [CoreEvent.McpClientUpdate]: [McpClientUpdatePayload]
- [ ] Lines 30-46 (CoreEventEmitter overloads): on, off, emit overloads all present

### 2. Comprehensive Verification

```bash
npm run typecheck
npm test -- packages/core/src/utils/events.test.ts
npm run test
```

### 3. Re-Export Verification

```bash
# Verify CoreEvent and McpClientUpdatePayload are accessible from the package
grep "export.*from.*events" packages/core/src/index.ts
# Expected: Wildcard export that covers events.ts
```

### 4. String Literal Isolation

```bash
# Only the enum definition should have the raw string
grep -rn "'mcp-client-update'" packages/core/src/utils/events.ts
# Expected: 1 match (the enum value assignment)
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/utils/events.ts
# Expected: No new deferred work

grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/utils/events.ts
# Expected: No matches
```

## Success Criteria

- Pseudocode compliance confirmed for all line ranges
- TypeScript compiles
- All tests pass (events.test.ts and full suite)
- Re-export verified
- String literal isolated to enum definition

## Semantic Verification Checklist (MANDATORY)

### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] I read the requirement text
   - [ ] I read the implementation code (not just checked file exists)
   - [ ] I can explain HOW the requirement is fulfilled
2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed (no TODO/HACK/STUB)
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments
3. **Would the test FAIL if implementation was removed?**
   - [ ] Test verifies actual outputs, not just that code ran
   - [ ] Test would catch a broken implementation
4. **Is the feature REACHABLE by users?**
   - [ ] Code is called from existing code paths
   - [ ] There's a path from UI/CLI/API to this code
5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] [gap 1]
   - [ ] [gap 2]

### Feature Actually Works

```bash
# Manual test command (RUN THIS and paste actual output):
npm run typecheck && npm test -- packages/core/src/utils/events.test.ts
# Expected behavior: TypeScript compiles, all event tests pass
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] McpClientUpdate enum member accessible from @vybestack/llxprt-code-core
- [ ] McpClientUpdatePayload type accessible from @vybestack/llxprt-code-core
- [ ] CoreEventEmitter overloads follow existing pattern
- [ ] No existing event types broken

### Edge Cases Verified

- [ ] Empty Map payload compiles and works at runtime
- [ ] Removing listener prevents further callbacks
- [ ] Multiple listeners for same event both fire

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P05a.md`
