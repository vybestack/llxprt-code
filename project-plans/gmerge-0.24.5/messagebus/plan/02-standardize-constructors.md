# Phase 02: Standardize Constructors (Upstream Phase 2)

## Phase ID
`PLAN-20260303-MESSAGEBUS.P02`

## Prerequisites
- Phase 01a verified

## Requirements Implemented

### REQ MB-DI-002: Standardize Tool/Agent Constructor MessageBus Parameter
**EARS**: ALL tool `createInvocation()` methods and agent invocation constructors SHALL accept `messageBus?: MessageBus` as a parameter and pass it to the invocation instance.

**Behavior**:
- GIVEN: A tool's `createInvocation()` is called with a messageBus
- WHEN: The invocation is created
- THEN: The invocation stores the messageBus for use during execution
- AND: Does NOT rely on config.getMessageBus() (though fallback still available)

## Implementation Tasks

### Reference Diff
`git show 90be9c35876d` — Upstream Phase 2.

### Files to Modify (~23 files)

**Agent invocations:**
- `packages/core/src/agents/delegate-to-agent-tool.ts` — Accept and pass messageBus
- `packages/core/src/agents/subagent-tool-wrapper.ts` — Accept and pass messageBus
- `packages/core/src/agents/local-invocation.ts` — Accept messageBus in constructor
- `packages/core/src/agents/remote-invocation.ts` — Accept messageBus in constructor

**Tools (ensure all createInvocation methods accept messageBus):**
- `tools/get-internal-docs.ts`
- `tools/glob.ts`
- `tools/grep.ts` / `tools/ripGrep.ts`
- `tools/ls.ts`
- `tools/mcp-tool.ts`
- `tools/read-file.ts`
- `tools/read-many-files.ts`
- `tools/shell.ts`
- `tools/web-fetch.ts`
- `tools/web-search.ts`
- `tools/write-todos.ts`

**Test files (~8 files):**
- `agents/delegate-to-agent-tool.test.ts`
- `agents/subagent-tool-wrapper.test.ts`
- `core/coreToolScheduler.test.ts`
- `tools/message-bus-integration.test.ts`
- `test-utils/mock-tool.ts`
- Others as needed per upstream diff

### Key Pattern
```typescript
// Before (each tool):
createInvocation(params: ToolContext): SomeInvocation {
  return new SomeInvocation(this, params);
}

// After:
createInvocation(params: ToolContext, messageBus?: MessageBus): SomeInvocation {
  return new SomeInvocation(this, params, messageBus);
}
```

### LLxprt-Specific Adaptations
- Skip `smart-edit.ts` (removed from LLxprt)
- `ripGrep.ts` = LLxprt's grep tool (not just `grep.ts`)
- Tool names may differ from upstream — check actual file names
- Some LLxprt tools have additional parameters (e.g., `apply-patch.ts`) — preserve them

## Verification Commands
```bash
npm run typecheck
npm run test
```

## Success Criteria
- All `createInvocation()` methods accept optional `messageBus` parameter
- All agent invocations accept optional `messageBus` parameter
- TypeScript compiles
- All tests pass

## Failure Recovery
If a tool's `createInvocation()` signature doesn't match expected pattern, read the actual file first. Some tools have non-standard invocation creation. Adapt the pattern to match.

## Phase Completion Marker
```bash
echo "PLAN-20260303-MESSAGEBUS.P02 COMPLETE"
npm run typecheck && npm run test && echo "VERIFIED"
```
