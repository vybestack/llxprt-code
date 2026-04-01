# REIMPLEMENT Playbook: 7e6817d — Fix(acp): run exit cleanup when stdin closes

## Upstream Change Summary

This commit fixes an issue where telemetry wouldn't flush when the ACP (Agent Client Protocol) connection closes via stdin. The fix:

1. Stores the `AgentSideConnection` in a variable instead of creating it inline
2. Awaits `connection.closed.finally(runExitCleanup)` to ensure cleanup runs when stdin closes
3. Adds an integration test that verifies telemetry is flushed when stdin closes

The key insight is that SIGTERM/SIGINT handlers don't fire when stdin closes, so explicit cleanup is needed.

**Files changed upstream:**
- `integration-tests/acp-telemetry.test.ts` (new file)
- `package.json` - Add `@agentclientprotocol/sdk` dev dependency
- `packages/cli/package.json` - Update `@agentclientprotocol/sdk` version
- `packages/cli/src/zed-integration/zedIntegration.ts` - Add connection.closed.finally() cleanup
- `packages/core/src/core/contentGenerator.ts` - Minor refactoring (unrelated to main fix)

## LLxprt Current State

### `packages/cli/src/zed-integration/zedIntegration.ts`

LLxprt already has this file with similar structure. Current implementation:

```typescript
const stream = acp.ndJsonStream(stdout, stdin);
const connection = new acp.AgentSideConnection((conn) => {
  logger.debug(() => 'Creating GeminiAgent');
  return new GeminiAgent(config, settings, conn);
}, stream);
logger.debug(() => 'AgentSideConnection created successfully');

await connection.closed.finally(runExitCleanup);
```

**LLxprt ALREADY HAS THIS FIX APPLIED!** The `await connection.closed.finally(runExitCleanup)` line is already present.

### Integration Tests

LLxprt may or may not have the `integration-tests/acp-telemetry.test.ts` file. This is an integration test that:
- Spawns the CLI with ACP mode
- Creates a session and sends a prompt
- Closes stdin to trigger cleanup
- Verifies telemetry was flushed to a log file

## Adaptation Plan

**Code already present in LLxprt — verification required, not skip.**

The main fix (`await connection.closed.finally(runExitCleanup)`) is already applied. However, verification is needed to confirm behavioral equivalence.

**OPTIONAL: Add the integration test**

If LLxprt wants the telemetry flush integration test:
1. Create `integration-tests/acp-telemetry.test.ts`
2. Add `@agentclientprotocol/sdk` to devDependencies if not present
3. Adapt the test for LLxprt's CLI entry point and environment variables

## Files to Read

1. `packages/cli/src/zed-integration/zedIntegration.ts` — verify fix is present
2. `packages/cli/src/utils/cleanup.ts` — verify cleanup utility exists and is wired
3. Check for existing ACP/Zed integration tests (or note their absence)

## Files to Modify

None — the fix is already applied.

## Specific Verification

1. Verify `packages/cli/src/zed-integration/zedIntegration.ts` contains `await connection.closed.finally(runExitCleanup);`
2. Verify `runExitCleanup` import is present and functional
3. Check ACP SDK version compatibility: ensure `@agentclientprotocol/sdk` version is compatible with `connection.closed` API
4. Note explicitly whether LLxprt has an ACP telemetry integration test or intentionally omits it
