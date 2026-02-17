# Phase 24: Cleanup and Final Verification

## Phase ID
PLAN-20260216-HOOKSYSTEMREWRITE.P24

## Prerequisites
- P23 completed (E2E tests pass)
- All behavioral tests pass
- Full verification suite passes

## Purpose

Final cleanup: delete mock theater tests, update documentation, verify no regressions, and confirm upstream parity.

## Cleanup Tasks

### Task 1: Delete Mock Theater Tests

These test files verified the BROKEN fire-and-forget behavior. They are no longer needed:

```bash
rm packages/core/src/core/coreToolHookTriggers.test.ts
rm packages/core/src/core/geminiChatHookTriggers.test.ts
```

**Rationale:** These tests checked that trigger functions return `undefined` — that was the bug. The new behavioral tests in `hooks-caller-integration.test.ts` and `hooks-caller-application.test.ts` replace them.

### Task 2: Update Exports

Ensure all new types are exported from `packages/core/src/hooks/index.ts`:

```typescript
export {
  // Infrastructure
  HookSystem,
  HookRegistry,
  HookPlanner,
  HookRunner,
  HookAggregator,
  HookEventHandler,
  
  // Output types
  DefaultHookOutput,
  BeforeToolHookOutput,
  AfterToolHookOutput,
  BeforeModelHookOutput,
  AfterModelHookOutput,
  BeforeToolSelectionHookOutput,
  
  // Result types
  AggregatedHookResult,
  
  // Errors
  HookSystemNotInitializedError,
  HookRegistryNotInitializedError,
} from './types.js';
```

### Task 3: Update Documentation

Update or create documentation for hook authors:

**File:** `dev-docs/hooks.md`

```markdown
# Hooks System

## Overview

The hooks system allows external scripts to intercept and modify LLM and tool operations.

## Hook Events

| Event | When | Can Block | Can Modify |
|-------|------|-----------|------------|
| BeforeTool | Before tool execution | Yes | tool_input |
| AfterTool | After tool execution | No | llmContent, suppressDisplay |
| BeforeModel | Before LLM API call | Yes | llm_request, synthetic response |
| AfterModel | After LLM response | No | llm_response, suppressDisplay |
| BeforeToolSelection | Before tool selection | No | toolConfig (allowedFunctionNames, mode) |

## Writing a Hook Script

Hook scripts receive JSON input on stdin and output JSON on stdout.

### Exit Codes
- 0: Allow (with possible modifications)
- 2: Block/Deny

### Example: Block writes to /etc

```bash
#!/bin/bash
INPUT=$(cat)
if echo "$INPUT" | jq -e '.tool_input.path | startswith("/etc")' > /dev/null; then
  echo '{"decision": "block", "reason": "Cannot write to /etc"}' >&2
  exit 2
fi
echo '{"decision": "allow"}'
```

### Example: Sanitize paths

```bash
#!/bin/bash
INPUT=$(cat)
SAFE_PATH="/tmp/$(echo "$INPUT" | jq -r '.tool_input.path' | sed 's|.*/||')"
echo "{\"decision\": \"allow\", \"hookSpecificOutput\": {\"tool_input\": {\"path\": \"$SAFE_PATH\"}}}"
```
```

### Task 4: Verify Upstream Parity

Check that we support all capabilities that Claude Code (upstream) hooks support:

| Capability | Claude Code | LLxprt | Status |
|------------|-------------|--------|--------|
| Block tool execution | [OK] | [OK] | DONE |
| Modify tool input | [OK] | [OK] | DONE |
| Block model calls | [OK] | [OK] | DONE |
| Provide synthetic response | [OK] | [OK] | DONE |
| Modify model request | [OK] | [OK] | DONE |
| Restrict tool selection | [OK] | [OK] | DONE |
| Inject systemMessage | [OK] | [OK] | DONE |
| Suppress output display | [OK] | [OK] | DONE |
| Stop agent loop | [OK] | [OK] | DONE |
| Add additional context | [OK] | [OK] | DONE |

### Task 5: Remove [Target] Markers

Now that requirements are implemented, update `requirements.md` to remove `[Target]` markers and replace with `[Implemented]` or just remove the marker entirely.

### Task 6: Final Verification

```bash
# Full test suite
npm run test

# TypeScript
npm run typecheck

# Linting
npm run lint

# Formatting
npm run format

# Build
npm run build

# Haiku sanity check
node scripts/start.js --profile-load synthetic --prompt "write me a haiku"

# Count tests
npm run test -- --reporter=dot 2>&1 | tail -5
```

## Verification Checklist

- [ ] Mock theater tests deleted
- [ ] All behavioral tests pass
- [ ] All E2E tests pass
- [ ] TypeScript compiles without errors
- [ ] Linting passes
- [ ] Build succeeds
- [ ] Haiku test works
- [ ] No `void trigger*Hook` patterns remain in codebase:
  ```bash
  grep -rn "void trigger.*Hook" packages/core/src/core/
  # Should return empty
  ```
- [ ] All trigger functions return typed results:
  ```bash
  grep -n "Promise<.*HookOutput" packages/core/src/core/*HookTriggers.ts
  # Should show all 5 functions
  ```
- [ ] Documentation updated
- [ ] [Target] markers resolved

## Success Criteria for P24

- [ ] Zero mock theater tests remain
- [ ] Zero `void trigger*Hook` calls remain
- [ ] All hook trigger functions return typed outputs
- [ ] All behavioral contracts verified by tests
- [ ] Upstream parity achieved
- [ ] Documentation complete
- [ ] Full verification passes

## Phase Completion Marker
- Update `project-plans/hooksystemrewrite/.completed/P24.md`
- Set Status: COMPLETED
- Update `execution-tracker.md` to mark plan COMPLETE
