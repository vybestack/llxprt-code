# Phase 23: End-to-End Verification

## Phase ID
PLAN-20260216-HOOKSYSTEMREWRITE.P23

## Prerequisites
- P22 completed (caller application implemented)
- All unit tests passing
- TypeScript compiles without errors

## Purpose

Verify that the hooks system works end-to-end with real hook scripts, not just mocks. This phase creates integration tests that run actual shell commands.

## Integration Test File: hooks-e2e.integration.test.ts

Location: `integration-tests/hooks/hooks-e2e.integration.test.ts`

### Test 1: Real Hook Blocks Real Tool

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createRealConfig } from './test-utils.js';
import { triggerBeforeToolHook } from '@anthropic-ai/claude-code-core';

describe('Hooks E2E', () => {
  const testDir = '/tmp/hooks-e2e-test';
  const hookScript = join(testDir, 'block-write.sh');
  
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    // Create a real hook script that blocks write_file to /etc
    writeFileSync(hookScript, `#!/bin/bash
if echo "$1" | grep -q '"path":.*"/etc'; then
  echo '{"decision": "block", "reason": "Cannot write to /etc"}' >&2
  exit 2
fi
echo '{"decision": "allow"}'
exit 0
`, { mode: 0o755 });
  });
  
  afterEach(() => {
    unlinkSync(hookScript);
  });
  
  it('should block write_file to /etc with real hook script', async () => {
    const config = createRealConfig({
      enableHooks: true,
      hooks: {
        block_etc_writes: {
          type: 'command',
          event: 'BeforeTool',
          matcher: 'write_file',
          command: hookScript,
        },
      },
    });
    
    const result = await triggerBeforeToolHook(config, 'write_file', { 
      path: '/etc/passwd',
      content: 'malicious'
    });
    
    expect(result).toBeDefined();
    expect(result!.isBlockingDecision()).toBe(true);
    expect(result!.getEffectiveReason()).toContain('Cannot write to /etc');
  });
  
  it('should allow write_file to /tmp with real hook script', async () => {
    const config = createRealConfig({
      enableHooks: true,
      hooks: {
        block_etc_writes: {
          type: 'command',
          event: 'BeforeTool',
          matcher: 'write_file',
          command: hookScript,
        },
      },
    });
    
    const result = await triggerBeforeToolHook(config, 'write_file', { 
      path: '/tmp/safe.txt',
      content: 'ok'
    });
    
    // Should allow (not block)
    if (result) {
      expect(result.isBlockingDecision()).toBe(false);
    }
    // Or undefined (no hooks matched/no decision)
  });
});
```

### Test 2: Real Hook Modifies Input

```typescript
it('should modify tool input with real hook script', async () => {
  const modifyScript = join(testDir, 'sanitize-path.sh');
  writeFileSync(modifyScript, `#!/bin/bash
# Read input JSON from stdin
INPUT=$(cat)

# Always redirect to /tmp
echo '{"decision": "allow", "hookSpecificOutput": {"tool_input": {"path": "/tmp/sanitized.txt"}}}'
exit 0
`, { mode: 0o755 });

  const config = createRealConfig({
    enableHooks: true,
    hooks: {
      sanitize_paths: {
        type: 'command',
        event: 'BeforeTool',
        matcher: 'write_file',
        command: modifyScript,
      },
    },
  });
  
  const result = await triggerBeforeToolHook(config, 'write_file', { 
    path: '/anywhere/file.txt',
    content: 'data'
  });
  
  expect(result).toBeDefined();
  const modifiedInput = result!.getModifiedToolInput();
  expect(modifiedInput).toBeDefined();
  expect(modifiedInput!.path).toBe('/tmp/sanitized.txt');
  
  unlinkSync(modifyScript);
});
```

### Test 3: Real Hook Timeout

```typescript
it('should timeout slow hook and fail-open', async () => {
  const slowScript = join(testDir, 'slow.sh');
  writeFileSync(slowScript, `#!/bin/bash
sleep 10
echo '{"decision": "block"}'
exit 2
`, { mode: 0o755 });

  const config = createRealConfig({
    enableHooks: true,
    hooks: {
      slow_hook: {
        type: 'command',
        event: 'BeforeTool',
        command: slowScript,
        timeout: 100, // 100ms timeout
      },
    },
  });
  
  const startTime = Date.now();
  const result = await triggerBeforeToolHook(config, 'read_file', { path: '/test' });
  const elapsed = Date.now() - startTime;
  
  // Should timeout quickly, not wait 10 seconds
  expect(elapsed).toBeLessThan(500);
  
  // Should fail-open (not block)
  if (result) {
    expect(result.isBlockingDecision()).toBe(false);
  }
  
  unlinkSync(slowScript);
});
```

### Test 4: Real BeforeModel Hook

```typescript
it('should block model call with real BeforeModel hook', async () => {
  const contentFilterScript = join(testDir, 'content-filter.sh');
  writeFileSync(contentFilterScript, `#!/bin/bash
INPUT=$(cat)
if echo "$INPUT" | grep -qi "harmful"; then
  echo '{"decision": "block", "reason": "Content policy violation", "hookSpecificOutput": {"llm_response": {"text": "I cannot help with harmful content."}}}'
  exit 2
fi
echo '{"decision": "allow"}'
exit 0
`, { mode: 0o755 });

  const config = createRealConfig({
    enableHooks: true,
    hooks: {
      content_filter: {
        type: 'command',
        event: 'BeforeModel',
        command: contentFilterScript,
      },
    },
  });
  
  const result = await triggerBeforeModelHook(config, {
    messages: [{ role: 'user', content: 'Generate harmful content' }],
  });
  
  expect(result).toBeDefined();
  expect(result!.isBlockingDecision()).toBe(true);
  
  const synthetic = result!.getSyntheticResponse();
  expect(synthetic).toBeDefined();
  expect(synthetic!.text).toContain('cannot help');
  
  unlinkSync(contentFilterScript);
});
```

## Verification Commands

```bash
# Run E2E tests
npm run test:integration -- hooks-e2e.integration.test.ts

# Full verification
npm run test
npm run typecheck
npm run lint
npm run format
npm run build

# Manual E2E sanity check with real hooks
# Create ~/.claude/settings.json with a test hook
# Run: node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
```

## Success Criteria for P23

- [ ] All 4 E2E tests pass with real shell scripts
- [ ] Hook timeout works correctly (fails open)
- [ ] Hook blocking works with real scripts
- [ ] Hook input modification works with real scripts
- [ ] BeforeModel synthetic response works with real scripts
- [ ] Full verification suite passes

## Phase Completion Marker
- Update `project-plans/hooksystemrewrite/.completed/P23.md`
- Set Status: COMPLETED when all criteria met
