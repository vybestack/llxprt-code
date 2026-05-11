/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolDispatcher } from './tool-dispatcher.js';
import type { ToolCallRequestInfo } from '../core/turn.js';
import type { ToolGovernance } from '../core/toolGovernance.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolCallConfirmationDetails,
  type ToolInvocation,
  type ToolResult,
} from '../tools/tools.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { PolicyDecision } from '../policy/types.js';
import { ToolErrorType } from '../tools/tool-error.js';
import type { ContextAwareTool } from '../tools/tool-context.js';
import type { Config } from '../index.js';
import { ApprovalMode } from '../index.js';
import { DEFAULT_GEMINI_MODEL } from '../config/models.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createTestMessageBus(): MessageBus {
  return new MessageBus(
    new PolicyEngine({
      rules: [],
      defaultDecision: PolicyDecision.ALLOW,
      nonInteractive: false,
    }),
    false,
  );
}

function createMockConfig(overrides: Partial<Config> = {}): Config {
  const defaults = {
    getSessionId: () => 'test-session-id',
    getUsageStatisticsEnabled: () => true,
    getDebugMode: () => false,
    getApprovalMode: () => ApprovalMode.YOLO,
    getEphemeralSettings: () => ({}),
    getAllowedTools: () => [],
    getContentGeneratorConfig: () => ({ model: 'test-model' }),
    getToolRegistry: () => ({
      getFunctionDeclarations: vi.fn().mockReturnValue([]),
      getTool: vi.fn().mockReturnValue(null),
      getAllTools: vi.fn().mockReturnValue([]),
    }),
    getMessageBus: vi.fn().mockReturnValue({
      subscribe: vi.fn().mockReturnValue(() => {}),
      publish: vi.fn(),
    }),
    getPolicyEngine: vi.fn().mockReturnValue({
      evaluate: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
      checkDecision: vi.fn().mockReturnValue(PolicyDecision.ALLOW),
    }),
    getEnableHooks: () => false,
    getHookSystem: () => null,
    getModel: () => DEFAULT_GEMINI_MODEL,
    isInteractive: () => false,
  };
  return { ...defaults, ...overrides } as unknown as Config;
}

class MockInvocation extends BaseToolInvocation<
  Record<string, unknown>,
  ToolResult
> {
  constructor(params: Record<string, unknown>, messageBus: MessageBus) {
    super(params, messageBus);
  }
  execute(): Promise<ToolResult> {
    return Promise.resolve({ llmContent: 'ok', returnDisplay: 'ok' });
  }
  shouldConfirmExecute(): Promise<ToolCallConfirmationDetails | false> {
    return Promise.resolve(false);
  }
  getDescription(): string {
    return 'mock';
  }
}

class MockTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  constructor(name: string, throwOnBuild = false) {
    super(
      name,
      name,
      `A mock tool: ${name}`,
      Kind.Other,
      { type: 'object', properties: { param: { type: 'string' } } } as object,
      false,
      false,
      createTestMessageBus(),
    );
    this._throwOnBuild = throwOnBuild;
  }
  private _throwOnBuild: boolean;

  protected createInvocation(
    params: Record<string, unknown>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    if (this._throwOnBuild) {
      throw new Error('build failed');
    }
    return new MockInvocation(params, this.requireMessageBus());
  }
}

class ContextAwareMockTool extends MockTool implements ContextAwareTool {
  context?: { sessionId: string; agentId?: string; interactiveMode?: boolean };
}

function makeRequest(name: string, callId = 'call-1'): ToolCallRequestInfo {
  return {
    callId,
    name,
    args: { param: 'value' },
  } as ToolCallRequestInfo;
}

function makeGovernance(
  overrides: Partial<ToolGovernance> = {},
): ToolGovernance {
  return {
    allowed: new Set<string>(),
    disabled: new Set<string>(),
    excluded: new Set<string>(),
    ...overrides,
  };
}

function makeMockRegistry(tool?: MockTool | null) {
  return {
    getTool: vi.fn().mockReturnValue(tool ?? null),
    getAllToolNames: vi.fn().mockReturnValue(tool ? [tool.name] : []),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ToolDispatcher', () => {
  let config: Config;

  beforeEach(() => {
    config = createMockConfig();
  });

  // ── resolveAndValidate ─────────────────────────────────────────────────────

  describe('resolveAndValidate()', () => {
    it('returns ErroredToolCall with TOOL_NOT_REGISTERED when tool is not in registry', () => {
      const registry = makeMockRegistry(null);
      const dispatcher = new ToolDispatcher(registry as never, config);
      const results = dispatcher.resolveAndValidate(
        [makeRequest('unknown_tool')],
        makeGovernance(),
        false,
      );

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result.status).toBe('error');
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (result.status !== 'error')
        throw new Error('unreachable: narrowing failed');
      expect(result.response.errorType).toBe(ToolErrorType.TOOL_NOT_REGISTERED);
      expect(result.response.responseParts).toBeDefined();
    });

    it('includes levenshtein suggestion in error message when tool name is close', () => {
      const registry = {
        getTool: vi.fn().mockReturnValue(null),
        getAllToolNames: vi.fn().mockReturnValue(['list_files', 'read_file']),
      };
      const dispatcher = new ToolDispatcher(registry as never, config);
      const results = dispatcher.resolveAndValidate(
        [makeRequest('list_file')], // close to 'list_files'
        makeGovernance(),
        false,
      );

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('error');
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (results[0].status !== 'error')
        throw new Error('unreachable: narrowing failed');
      const responseStr = JSON.stringify(results[0].response.responseParts);
      expect(responseStr).toContain('list_files');
    });

    it('returns ErroredToolCall with TOOL_DISABLED when tool is blocked by governance', () => {
      const tool = new MockTool('blocked_tool');
      const registry = makeMockRegistry(tool);
      const dispatcher = new ToolDispatcher(registry as never, config);
      const governance = makeGovernance({
        disabled: new Set(['blocked_tool']),
      });

      const results = dispatcher.resolveAndValidate(
        [makeRequest('blocked_tool')],
        governance,
        false,
      );

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('error');
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (results[0].status !== 'error')
        throw new Error('unreachable: narrowing failed');
      expect(results[0].response.errorType).toBe(ToolErrorType.TOOL_DISABLED);
    });

    it('returns ErroredToolCall with INVALID_TOOL_PARAMS when buildInvocation throws', () => {
      const throwingTool = new MockTool('bad_tool', true /* throwOnBuild */);
      const registry = makeMockRegistry(throwingTool);
      const dispatcher = new ToolDispatcher(registry as never, config);

      const results = dispatcher.resolveAndValidate(
        [makeRequest('bad_tool')],
        makeGovernance(),
        false,
      );

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('error');
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (results[0].status !== 'error')
        throw new Error('unreachable: narrowing failed');
      expect(results[0].response.errorType).toBe(
        ToolErrorType.INVALID_TOOL_PARAMS,
      );
    });

    it('sets context on ContextAwareTool during resolveAndValidate', () => {
      const tool = new ContextAwareMockTool('context_tool');
      const registry = makeMockRegistry(tool);
      const dispatcher = new ToolDispatcher(registry as never, config);

      dispatcher.resolveAndValidate(
        [makeRequest('context_tool')],
        makeGovernance(),
        true, // interactiveMode
      );

      expect(tool.context).toBeDefined();
      expect(tool.context?.sessionId).toBe('test-session-id');
      expect(tool.context?.agentId).toBe('primary');
      expect(tool.context?.interactiveMode).toBe(true);
    });

    it('returns ValidatingToolCall for a successfully resolved tool', () => {
      const tool = new MockTool('my_tool');
      const registry = makeMockRegistry(tool);
      const dispatcher = new ToolDispatcher(registry as never, config);

      const results = dispatcher.resolveAndValidate(
        [makeRequest('my_tool')],
        makeGovernance(),
        false,
      );

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('validating');
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (results[0].status !== 'validating')
        throw new Error('unreachable: narrowing failed');
      expect(results[0].tool).toBe(tool);
      expect(results[0].invocation).toBeDefined();
      expect(results[0].request.name).toBe('my_tool');
    });

    it('handles multiple requests mixing success and error', () => {
      const goodTool = new MockTool('good_tool');
      const registry = {
        getTool: vi.fn((name: string) =>
          name === 'good_tool' ? goodTool : null,
        ),
        getAllToolNames: vi.fn().mockReturnValue(['good_tool']),
      };
      const dispatcher = new ToolDispatcher(registry as never, config);

      const results = dispatcher.resolveAndValidate(
        [makeRequest('good_tool', 'c1'), makeRequest('missing_tool', 'c2')],
        makeGovernance(),
        false,
      );

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('validating');
      expect(results[1].status).toBe('error');
    });
  });

  // ── getToolSuggestion ──────────────────────────────────────────────────────

  describe('getToolSuggestion()', () => {
    it('returns empty string when registry has no tools', () => {
      const registry = {
        getTool: vi.fn(),
        getAllToolNames: vi.fn().mockReturnValue([]),
      };
      const dispatcher = new ToolDispatcher(registry as never, config);
      expect(dispatcher.getToolSuggestion('anything')).toBe('');
    });

    it('returns closest levenshtein match', () => {
      const registry = {
        getTool: vi.fn(),
        getAllToolNames: vi
          .fn()
          .mockReturnValue(['list_files', 'read_file', 'write_file']),
      };
      const dispatcher = new ToolDispatcher(registry as never, config);
      const suggestion = dispatcher.getToolSuggestion('list_file');
      expect(suggestion).toContain('list_files');
    });

    it('returns top-N suggestions when multiple close matches exist', () => {
      const registry = {
        getTool: vi.fn(),
        getAllToolNames: vi.fn().mockReturnValue(['ab', 'ac', 'ad', 'xyz']),
      };
      const dispatcher = new ToolDispatcher(registry as never, config);
      const suggestion = dispatcher.getToolSuggestion('a', 3);
      // Should contain the 3 closest matches (ab, ac, ad) but not xyz
      expect(suggestion).toContain('ab');
      expect(suggestion).toContain('ac');
      expect(suggestion).toContain('ad');
      expect(suggestion).not.toContain('xyz');
    });
  });

  // ── buildInvocation ────────────────────────────────────────────────────────

  describe('buildInvocation()', () => {
    it('returns the built invocation on success', () => {
      const tool = new MockTool('my_tool');
      const registry = makeMockRegistry(tool);
      const dispatcher = new ToolDispatcher(registry as never, config);
      const result = dispatcher.buildInvocation(tool, { param: 'x' });
      expect(result).not.toBeInstanceOf(Error);
    });

    it('returns an Error (not throws) when tool.build() throws', () => {
      const throwingTool = new MockTool('bad_tool', true);
      const registry = makeMockRegistry(throwingTool);
      const dispatcher = new ToolDispatcher(registry as never, config);
      const result = dispatcher.buildInvocation(throwingTool, {});
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('build failed');
    });

    it('wraps non-Error throws in an Error', () => {
      const tool = new MockTool('string_throw_tool');
      // Override build to throw a string
      vi.spyOn(tool, 'build').mockImplementation(() => {
        // eslint-disable-next-line no-restricted-syntax
        throw 'just a string';
      });
      const registry = makeMockRegistry(tool);
      const dispatcher = new ToolDispatcher(registry as never, config);
      const result = dispatcher.buildInvocation(tool, {});
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('just a string');
    });
  });
});
