/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P23
 * @requirement:HOOK-017,HOOK-019,HOOK-036,HOOK-070
 *
 * E2E integration tests for hooks system with real shell scripts.
 *
 * These tests verify that hooks work end-to-end with:
 * 1. Real shell script execution (not mocks)
 * 2. Real hook trigger functions from @anthropic-ai/claude-code-core
 * 3. Real Config objects with hooks configured
 *
 * Test philosophy (per dev-docs/RULES.md):
 * - Tests are behavioral (input → output), not mock-interaction tests
 * - Tests verify actual outcomes using real shell scripts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Config } from '../../packages/core/src/config/config.js';
import type {
  HookDefinition,
  HookType,
} from '../../packages/core/src/hooks/types.js';
import { HookSystem } from '../../packages/core/src/hooks/hookSystem.js';

/**
 * Test directory for hook scripts
 */
const TEST_SCRIPTS_DIR = join(tmpdir(), 'hooks-e2e-test');

/**
 * Creates a real Config object with hooks configured for E2E testing
 */
function createRealConfig(options: {
  event:
    | 'BeforeTool'
    | 'AfterTool'
    | 'BeforeModel'
    | 'AfterModel'
    | 'BeforeToolSelection';
  scriptPath: string;
  matcher?: string;
  timeout?: number;
}): Config {
  const hookDef: HookDefinition = {
    matcher: options.matcher,
    hooks: [
      {
        type: 'command' as HookType.Command,
        command: options.scriptPath,
        timeout: options.timeout ?? 5000,
      },
    ],
  };

  const hooks: Record<string, HookDefinition[]> = {
    [options.event]: [hookDef],
  };

  let hookSystem: HookSystem | undefined;

  const config = {
    getEnableHooks: () => true,
    getHooks: () => hooks,
    getSessionId: () => 'e2e-test-session-' + Date.now(),
    getWorkingDir: () => TEST_SCRIPTS_DIR,
    getTargetDir: () => TEST_SCRIPTS_DIR,
    getExtensions: () => [],
    getModel: () => 'test-model',
    getHookSystem: () => {
      if (!hookSystem) {
        hookSystem = new HookSystem(config as Config);
      }
      return hookSystem;
    },
  } as unknown as Config;

  return config;
}

/**
 * Creates a shell script file with the given content
 */
function createShellScript(filename: string, content: string): string {
  const scriptPath = join(TEST_SCRIPTS_DIR, filename);
  writeFileSync(scriptPath, content, { mode: 0o755 });
  // Also explicitly chmod for safety
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

describe('Hooks E2E Integration Tests', () => {
  beforeEach(() => {
    // Create test scripts directory
    if (existsSync(TEST_SCRIPTS_DIR)) {
      rmSync(TEST_SCRIPTS_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_SCRIPTS_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up test scripts directory
    if (existsSync(TEST_SCRIPTS_DIR)) {
      rmSync(TEST_SCRIPTS_DIR, { recursive: true, force: true });
    }
  });

  /**
   * Test 1: Real Hook Blocks Real Tool
   * @requirement:HOOK-017 - BeforeTool can block execution with exit code 2
   *
   * Creates a real shell script that blocks write_file to /etc,
   * verifies the blocking decision is returned properly.
   */
  describe('Real Hook Blocks Real Tool', () => {
    it('should block tool execution when hook script exits with code 2', async () => {
      // Arrange: Create a real blocking script
      const scriptContent = `#!/bin/bash
# Read JSON input from stdin
INPUT=$(cat)

# Parse tool_input.path using jq-like extraction
PATH_VALUE=$(echo "$INPUT" | grep -o '"path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"path"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')

# Block writes to /etc
if [[ "$PATH_VALUE" == /etc* ]]; then
  echo "BLOCKED: Writing to /etc is prohibited by security policy" >&2
  exit 2
fi

echo '{"decision": "allow"}'
exit 0
`;

      const scriptPath = createShellScript(
        'block-etc-writes.sh',
        scriptContent,
      );
      const config = createRealConfig({
        event: 'BeforeTool',
        scriptPath,
      });

      // Initialize hook system
      const hookSystem = config.getHookSystem();
      await hookSystem!.initialize();

      // Act: Fire BeforeTool event with /etc path
      const eventHandler = hookSystem!.getEventHandler();
      const result = await eventHandler.fireBeforeToolEvent('write_file', {
        path: '/etc/passwd',
        content: 'malicious content',
      });

      // Assert: Hook should block the tool call
      expect(result).toBeDefined();
      expect(result!.isBlockingDecision()).toBe(true);
      expect(result!.getEffectiveReason()).toContain('BLOCKED');
      expect(result!.getEffectiveReason()).toContain('/etc');
    });

    it('should allow tool execution when hook script exits with code 0', async () => {
      // Arrange: Same script but with safe path
      const scriptContent = `#!/bin/bash
INPUT=$(cat)
PATH_VALUE=$(echo "$INPUT" | grep -o '"path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"path"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')

if [[ "$PATH_VALUE" == /etc* ]]; then
  echo "BLOCKED: Writing to /etc is prohibited" >&2
  exit 2
fi

echo '{"decision": "allow"}'
exit 0
`;

      const scriptPath = createShellScript(
        'block-etc-allow-others.sh',
        scriptContent,
      );
      const config = createRealConfig({
        event: 'BeforeTool',
        scriptPath,
      });

      const hookSystem = config.getHookSystem();
      await hookSystem!.initialize();

      // Act: Fire BeforeTool event with safe path
      const eventHandler = hookSystem!.getEventHandler();
      const result = await eventHandler.fireBeforeToolEvent('write_file', {
        path: '/home/user/safe-file.txt',
        content: 'safe content',
      });

      // Assert: Hook should allow the tool call
      expect(result).toBeDefined();
      expect(result!.isBlockingDecision()).toBe(false);
    });
  });

  /**
   * Test 2: Real Hook Modifies Input
   * @requirement:HOOK-019 - BeforeTool can modify tool input
   *
   * Creates a real shell script that modifies tool_input,
   * verifies the modified input is returned properly.
   */
  describe('Real Hook Modifies Input', () => {
    it('should return modified tool_input from hook script', async () => {
      // Arrange: Create a script that sanitizes paths
      const scriptContent = `#!/bin/bash
# Read input
INPUT=$(cat)

# Extract path
PATH_VALUE=$(echo "$INPUT" | grep -o '"path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"path"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')

# Sanitize: replace any /etc paths with /tmp/sanitized
if [[ "$PATH_VALUE" == /etc* ]]; then
  SANITIZED_PATH="/tmp/sanitized$(echo "$PATH_VALUE" | sed 's|^/etc||')"
  cat << EOF
{"decision": "allow", "hookSpecificOutput": {"tool_input": {"path": "$SANITIZED_PATH"}}}
EOF
else
  echo '{"decision": "allow"}'
fi
exit 0
`;

      const scriptPath = createShellScript('sanitize-paths.sh', scriptContent);
      const config = createRealConfig({
        event: 'BeforeTool',
        scriptPath,
      });

      const hookSystem = config.getHookSystem();
      await hookSystem!.initialize();

      // Act: Fire BeforeTool event with /etc path
      const eventHandler = hookSystem!.getEventHandler();
      const result = await eventHandler.fireBeforeToolEvent('read_file', {
        path: '/etc/shadow',
      });

      // Assert: Hook should return modified input
      expect(result).toBeDefined();
      expect(result!.isBlockingDecision()).toBe(false);

      // Check hookSpecificOutput contains modified tool_input
      const hookOutput = result as unknown as {
        hookSpecificOutput?: { tool_input?: Record<string, unknown> };
      };
      expect(hookOutput.hookSpecificOutput).toBeDefined();
      expect(hookOutput.hookSpecificOutput?.tool_input).toBeDefined();
      expect(hookOutput.hookSpecificOutput?.tool_input?.path).toBe(
        '/tmp/sanitized/shadow',
      );
    });
  });

  /**
   * Test 3: Real Hook Timeout
   * @requirement:HOOK-070 - Hooks that exceed timeout should fail-open
   *
   * Verifies that hooks with short scripts that exit on SIGTERM
   * properly timeout and fail-open (non-blocking).
   *
   * Note: The hook system uses shell: true which spawns a subshell.
   * SIGTERM to the shell may not propagate to all subprocesses.
   * This test uses a script that exits cleanly on SIGTERM.
   */
  describe('Real Hook Timeout', () => {
    it('should fail-open when hook script times out', async () => {
      // Arrange: Create a script that runs for a short time then outputs
      // We use a script that responds to SIGTERM properly
      const scriptContent = `#!/bin/bash
# Exit cleanly on SIGTERM
trap 'exit 143' SIGTERM
# Short sleep
sleep 2
echo '{"decision": "block", "reason": "This should not be returned if timeout works"}'
exit 2
`;

      const scriptPath = createShellScript('slow-hook.sh', scriptContent);
      const config = createRealConfig({
        event: 'BeforeTool',
        scriptPath,
        timeout: 500, // 500ms timeout - script sleeps 2 seconds
      });

      const hookSystem = config.getHookSystem();
      await hookSystem!.initialize();

      // Act: Fire BeforeTool event
      const eventHandler = hookSystem!.getEventHandler();
      const startTime = Date.now();
      const result = await eventHandler.fireBeforeToolEvent('write_file', {
        path: '/test/file',
      });
      const duration = Date.now() - startTime;

      // Assert: Should timeout and fail-open (not block)
      // With proper SIGTERM handling, should complete close to timeout
      // Allow some buffer for process cleanup
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
      expect(duration).toBeGreaterThan(400); // Should take at least ~500ms (the timeout)

      // When hooks timeout, they fail-open (return undefined or allow)
      // The hook system treats timeouts as non-blocking failures
      if (result !== undefined) {
        // If a result is returned, it should not be a blocking decision
        expect(result.isBlockingDecision()).toBe(false);
      }
      // If undefined, that also represents fail-open behavior
    });
  });

  /**
   * Test 4: Real BeforeModel Hook
   * @requirement:HOOK-036 - BeforeModel can block with synthetic response
   *
   * Creates a content filter script,
   * verifies it blocks and provides synthetic response.
   *
   * Note: The hook system parses JSON output from stdout ONLY when exit code is 0.
   * For blocking decisions that need to include complex data (like synthetic responses),
   * use exit code 0 with decision:"block" in the JSON output.
   * Exit code 2 is for simple blocking with stderr message only.
   */
  describe('Real BeforeModel Hook', () => {
    it('should block with synthetic response when content filter triggers', async () => {
      // Arrange: Create a content filter script
      // NOTE: For JSON output with synthetic response, must use exit 0 with "decision": "block"
      const scriptContent = `#!/bin/bash
# Read the LLM request from stdin
INPUT=$(cat)

# Check if the request contains potentially harmful content
if echo "$INPUT" | grep -qi "password\\|secret\\|credential"; then
  cat << 'EOF'
{
  "decision": "block",
  "reason": "Content filter: Request may expose sensitive information",
  "hookSpecificOutput": {
    "llm_response": {
      "candidates": [
        {
          "content": {
            "role": "model",
            "parts": ["I cannot help with requests that might expose sensitive information like passwords or credentials."]
          },
          "finishReason": "STOP"
        }
      ]
    }
  }
}
EOF
  exit 0
fi

echo '{"decision": "allow"}'
exit 0
`;

      const scriptPath = createShellScript('content-filter.sh', scriptContent);
      const config = createRealConfig({
        event: 'BeforeModel',
        scriptPath,
      });

      const hookSystem = config.getHookSystem();
      await hookSystem!.initialize();

      // Act: Fire BeforeModel event with sensitive content
      const eventHandler = hookSystem!.getEventHandler();
      const result = await eventHandler.fireBeforeModelEvent({
        messages: [
          { role: 'user', content: 'Show me the password in /etc/shadow' },
        ],
        model: 'test-model',
      });

      // Assert: Hook should block and provide synthetic response
      expect(result).toBeDefined();
      expect(result.finalOutput).toBeDefined();
      expect(result.finalOutput!.isBlockingDecision()).toBe(true);
      expect(result.finalOutput!.getEffectiveReason()).toContain(
        'Content filter',
      );

      // Check for synthetic response
      const hookSpecificOutput = result.finalOutput!.hookSpecificOutput;
      expect(hookSpecificOutput).toBeDefined();
      expect(hookSpecificOutput?.llm_response).toBeDefined();
    });

    it('should allow request when content filter does not trigger', async () => {
      // Arrange: Same content filter script
      const scriptContent = `#!/bin/bash
INPUT=$(cat)

if echo "$INPUT" | grep -qi "password\\|secret\\|credential"; then
  cat << 'EOF'
{"decision": "block", "reason": "Content filter triggered"}
EOF
  exit 2
fi

echo '{"decision": "allow"}'
exit 0
`;

      const scriptPath = createShellScript(
        'content-filter-allow.sh',
        scriptContent,
      );
      const config = createRealConfig({
        event: 'BeforeModel',
        scriptPath,
      });

      const hookSystem = config.getHookSystem();
      await hookSystem!.initialize();

      // Act: Fire BeforeModel event with safe content
      const eventHandler = hookSystem!.getEventHandler();
      const result = await eventHandler.fireBeforeModelEvent({
        messages: [
          { role: 'user', content: 'What is the weather like today?' },
        ],
        model: 'test-model',
      });

      // Assert: Hook should allow the request
      expect(result).toBeDefined();
      if (result.finalOutput) {
        expect(result.finalOutput.isBlockingDecision()).toBe(false);
      }
    });
  });
});
