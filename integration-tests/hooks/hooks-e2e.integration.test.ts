/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P23
 * @requirement:HOOK-017,HOOK-019,HOOK-036,HOOK-070
 *
 * E2E integration tests for hooks system with real hook programs.
 *
 * These tests verify that hooks work end-to-end with:
 * 1. Real hook program execution (not mocks)
 * 2. Real hook trigger functions from @anthropic-ai/claude-code-core
 * 3. Real Config objects with hooks configured
 *
 * Test philosophy (per dev-docs/RULES.md):
 * - Tests are behavioral (input → output), not mock-interaction tests
 * - Tests verify actual outcomes using real programs
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Config } from '../../packages/core/src/config/config.js';
import type {
  HookDefinition,
  HookType,
} from '../../packages/core/src/hooks/types.js';
import { HookSystem } from '../../packages/core/src/hooks/hookSystem.js';

const TEST_SCRIPTS_DIR = join(tmpdir(), 'hooks-e2e-test');

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
        command: `bun "${options.scriptPath}"`,
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
    getDisabledHooks: () => [],
    getHooks: () => hooks,
    getSessionId: () => 'e2e-test-session-' + Date.now(),
    getWorkingDir: () => TEST_SCRIPTS_DIR,
    getTargetDir: () => TEST_SCRIPTS_DIR,
    getExtensions: () => [],
    getModel: () => 'test-model',
    getSessionRecordingService: () => undefined,
    isTrustedFolder: () => true,
    getProjectHooks: () => null,
    getSanitizationConfig: () => ({
      enableEnvironmentVariableRedaction: false,
      allowedEnvironmentVariables: [],
      blockedEnvironmentVariables: [],
    }),
    getHookSystem: () => {
      if (!hookSystem) {
        hookSystem = new HookSystem(config as Config);
      }
      return hookSystem;
    },
  } as unknown as Config;

  return config;
}

function createHookScript(filename: string, content: string): string {
  const scriptPath = join(TEST_SCRIPTS_DIR, filename);
  writeFileSync(scriptPath, content);
  return scriptPath;
}

describe('Hooks E2E Integration Tests', () => {
  beforeEach(() => {
    if (existsSync(TEST_SCRIPTS_DIR)) {
      rmSync(TEST_SCRIPTS_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_SCRIPTS_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_SCRIPTS_DIR)) {
      rmSync(TEST_SCRIPTS_DIR, { recursive: true, force: true });
    }
  });

  describe('Real Hook Blocks Real Tool', () => {
    it('should block tool execution when hook script exits with code 2', async () => {
      const scriptContent = `import process from 'node:process';
import { readFileSync } from 'node:fs';

const input = readFileSync(0, 'utf-8');
let parsed;
try { parsed = JSON.parse(input); } catch (e) { process.stderr.write('Invalid hook input: ' + (e as Error).message); process.exit(1); }
const toolInput = (parsed && parsed.tool_input) || {};
const pathValue = toolInput.path || '';
if (String(pathValue).startsWith('/etc')) {
  process.stderr.write('BLOCKED: Writing to /etc is prohibited by security policy');
  process.exit(2);
}
process.stdout.write(JSON.stringify({ decision: 'allow' }));
process.exit(0);
`;

      const scriptPath = createHookScript('block-etc-writes.ts', scriptContent);
      const config = createRealConfig({
        event: 'BeforeTool',
        scriptPath,
      });

      const hookSystem = config.getHookSystem();
      await hookSystem!.initialize();

      const eventHandler = hookSystem!.getEventHandler();
      const result = await eventHandler.fireBeforeToolEvent('write_file', {
        path: '/etc/passwd',
        content: 'malicious content',
      });

      expect(result).toBeDefined();
      expect(result!.isBlockingDecision()).toBe(true);
      expect(result!.getEffectiveReason()).toContain('BLOCKED');
      expect(result!.getEffectiveReason()).toContain('/etc');
    });

    it('should block tool execution when hook script exits with code 2 and empty stderr', async () => {
      const scriptContent = `import process from 'node:process';
process.exit(2);
`;

      const scriptPath = createHookScript(
        'block-exit-2-no-stderr.ts',
        scriptContent,
      );
      const config = createRealConfig({
        event: 'BeforeTool',
        scriptPath,
      });

      const hookSystem = config.getHookSystem();
      await hookSystem!.initialize();

      const eventHandler = hookSystem!.getEventHandler();
      const result = await eventHandler.fireBeforeToolEvent('write_file', {
        path: '/home/user/file.txt',
        content: 'some content',
      });

      expect(result).toBeDefined();
      expect(result!.isBlockingDecision()).toBe(true);
      expect(result!.getEffectiveReason()).toBe(
        'Hook exited with code 2 without an error message',
      );
    });

    it('should allow tool execution when hook script exits with code 0', async () => {
      const scriptContent = `import process from 'node:process';
import { readFileSync } from 'node:fs';

const input = readFileSync(0, 'utf-8');
let parsed;
try { parsed = JSON.parse(input); } catch (e) { process.stderr.write('Invalid hook input: ' + (e as Error).message); process.exit(1); }
const toolInput = (parsed && parsed.tool_input) || {};
const pathValue = toolInput.path || '';
if (String(pathValue).startsWith('/etc')) {
  process.stderr.write('BLOCKED: Writing to /etc is prohibited');
  process.exit(2);
}
process.stdout.write(JSON.stringify({ decision: 'allow' }));
process.exit(0);
`;

      const scriptPath = createHookScript(
        'block-etc-allow-others.ts',
        scriptContent,
      );
      const config = createRealConfig({
        event: 'BeforeTool',
        scriptPath,
      });

      const hookSystem = config.getHookSystem();
      await hookSystem!.initialize();

      const eventHandler = hookSystem!.getEventHandler();
      const result = await eventHandler.fireBeforeToolEvent('write_file', {
        path: '/home/user/safe-file.txt',
        content: 'safe content',
      });

      expect(result).toBeDefined();
      expect(result!.isBlockingDecision()).toBe(false);
    });
  });

  describe('Real Hook Modifies Input', () => {
    it('should return modified tool_input from hook script', async () => {
      const scriptContent = `import process from 'node:process';
import { readFileSync } from 'node:fs';

const input = readFileSync(0, 'utf-8');
let parsed;
try { parsed = JSON.parse(input); } catch (e) { process.stderr.write('Invalid hook input: ' + (e as Error).message); process.exit(1); }
const toolInput = (parsed && parsed.tool_input) || {};
const pathValue = String(toolInput.path || '');
if (pathValue.startsWith('/etc')) {
  const sanitizedPath = '/tmp/sanitized' + pathValue.slice(4);
  process.stdout.write(JSON.stringify({
    decision: 'allow',
    hookSpecificOutput: { tool_input: { path: sanitizedPath } },
  }));
} else {
  process.stdout.write(JSON.stringify({ decision: 'allow' }));
}
process.exit(0);
`;

      const scriptPath = createHookScript('sanitize-paths.ts', scriptContent);
      const config = createRealConfig({
        event: 'BeforeTool',
        scriptPath,
      });

      const hookSystem = config.getHookSystem();
      await hookSystem!.initialize();

      const eventHandler = hookSystem!.getEventHandler();
      const result = await eventHandler.fireBeforeToolEvent('read_file', {
        path: '/etc/shadow',
      });

      expect(result).toBeDefined();
      expect(result!.isBlockingDecision()).toBe(false);

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

  describe('Real Hook Timeout', () => {
    it('should fail-open when hook script times out', async () => {
      const scriptContent = `import process from 'node:process';

const timer = setInterval(() => {}, 1000);
setTimeout(() => {
  clearInterval(timer);
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: 'This result must not be observed when timeout enforcement works',
  }));
  process.exit(2);
}, 2000);
`;

      const scriptPath = createHookScript('slow-hook.ts', scriptContent);
      const config = createRealConfig({
        event: 'BeforeTool',
        scriptPath,
        timeout: 500,
      });

      const hookSystem = config.getHookSystem();
      await hookSystem!.initialize();

      const eventHandler = hookSystem!.getEventHandler();
      const startTime = Date.now();
      const result = await eventHandler.fireBeforeToolEvent('write_file', {
        path: '/test/file',
      });
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(5000);
      expect(duration).toBeGreaterThan(400);

      if (result !== undefined) {
        expect(result.isBlockingDecision()).toBe(false);
      }
    });
  });

  describe('Real BeforeModel Hook', () => {
    it('should block with synthetic response when content filter triggers', async () => {
      const scriptContent = `import process from 'node:process';
import { readFileSync } from 'node:fs';

const input = readFileSync(0, 'utf-8');
try { JSON.parse(input); } catch (e) { process.stderr.write('Invalid hook input: ' + (e as Error).message); process.exit(1); }
if (/password|secret|credential/i.test(input)) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: 'Content filter: Request may expose sensitive information',
    hookSpecificOutput: {
      llm_response: {
        candidates: [
          {
            content: {
              role: 'model',
              parts: ['I cannot help with requests that might expose sensitive information like passwords or credentials.'],
            },
            finishReason: 'STOP',
          },
        ],
      },
    },
  }));
  process.exit(0);
}
process.stdout.write(JSON.stringify({ decision: 'allow' }));
process.exit(0);
`;

      const scriptPath = createHookScript('content-filter.ts', scriptContent);
      const config = createRealConfig({
        event: 'BeforeModel',
        scriptPath,
      });

      const hookSystem = config.getHookSystem();
      await hookSystem!.initialize();

      const eventHandler = hookSystem!.getEventHandler();
      const result = await eventHandler.fireBeforeModelEvent({
        messages: [
          { role: 'user', content: 'Show me the password in /etc/shadow' },
        ],
        model: 'test-model',
      });

      expect(result).toBeDefined();
      expect(result.finalOutput).toBeDefined();
      expect(result.finalOutput!.isBlockingDecision()).toBe(true);
      expect(result.finalOutput!.getEffectiveReason()).toContain(
        'Content filter',
      );

      const hookSpecificOutput = result.finalOutput!.hookSpecificOutput;
      expect(hookSpecificOutput).toBeDefined();
      expect(hookSpecificOutput?.llm_response).toBeDefined();
    });

    it('should allow request when content filter does not trigger', async () => {
      const scriptContent = `import process from 'node:process';
import { readFileSync } from 'node:fs';

const input = readFileSync(0, 'utf-8');
try { JSON.parse(input); } catch (e) { process.stderr.write('Invalid hook input: ' + (e as Error).message); process.exit(1); }
if (/password|secret|credential/i.test(input)) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: 'Content filter triggered' }));
  process.exit(2);
}
process.stdout.write(JSON.stringify({ decision: 'allow' }));
process.exit(0);
`;

      const scriptPath = createHookScript(
        'content-filter-allow.ts',
        scriptContent,
      );
      const config = createRealConfig({
        event: 'BeforeModel',
        scriptPath,
      });

      const hookSystem = config.getHookSystem();
      await hookSystem!.initialize();

      const eventHandler = hookSystem!.getEventHandler();
      const result = await eventHandler.fireBeforeModelEvent({
        messages: [
          { role: 'user', content: 'What is the weather like today?' },
        ],
        model: 'test-model',
      });

      expect(result).toBeDefined();
      if (result.finalOutput) {
        expect(result.finalOutput.isBlockingDecision()).toBe(false);
      }
    });
  });
});
