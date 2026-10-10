/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import {
  readHookDefinitions,
  hookSessionRuntime,
} from '@vybestack/llxprt-code-core/hooks/hook-configuration.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { escapeShellArg } from '@vybestack/llxprt-code-core/utils/shell-utils.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  CoreToolScheduler,
  type CompletedToolCall,
} from './coreToolScheduler.js';
import {
  expectErrored,
  expectSuccessful,
} from './__tests__/coreToolScheduler-test-helpers.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';

const ownedFixtures: Array<{
  config: Config;
  policyOwner: RuntimePolicyOwner;
  settingsOwner: SessionSettingsOwner;
  hooks: SessionHookOwner;
}> = [];

function createMockToolRegistry(tool: MockTool): ToolRegistry {
  return {
    getTool: () => tool,
    getToolByName: () => tool,
    getFunctionDeclarations: () => [],
    tools: new Map(),
    discovery: {},
    registerTool: () => {},
    getToolByDisplayName: () => tool,
    getTools: () => [tool],
    discoverTools: async () => {},
    getAllTools: () => [tool],
    getAllToolNames: () => [tool.name],
    getToolsByServer: () => [],
  } as unknown as ToolRegistry;
}

function createHookSystem(options?: {
  beforeToolResult?: Record<string, unknown> | undefined;
  afterToolResult?: Record<string, unknown> | undefined;
}) {
  return options ?? {};
}

function createMockConfig(
  toolRegistry: ToolRegistry,
  hookSystem: ReturnType<typeof createHookSystem>,
): {
  config: Config;
  settingsOwner: SessionSettingsOwner;
  policyOwner: RuntimePolicyOwner;
} {
  const config = Object.assign(
    new Config({
      sessionId: 'test-session-id',
      cwd: process.cwd(),
      targetDir: process.cwd(),
      model: 'test-model',
      debugMode: false,
      trustedFolder: true,
      enableHooks: true,
      hooks: {
        [HookEventName.BeforeTool]: [
          {
            hooks: [
              {
                type: HookType.Command,
                command:
                  'printf %s ' +
                  escapeShellArg(
                    JSON.stringify(hookSystem.beforeToolResult ?? {}),
                    'bash',
                  ),
              },
            ],
          },
        ],
        [HookEventName.AfterTool]: [
          {
            hooks: [
              {
                type: HookType.Command,
                command:
                  'printf %s ' +
                  escapeShellArg(
                    JSON.stringify(hookSystem.afterToolResult ?? {}),
                    'bash',
                  ),
              },
            ],
          },
        ],
      },
      policyEngineConfig: { defaultDecision: PolicyDecision.ALLOW },
    }),
    {
      getSessionId: () => 'test-session-id',
      getUsageStatisticsEnabled: () => false,
      getDebugMode: () => false,
      isInteractive: () => true,
      getApprovalMode: () => ApprovalMode.YOLO,

      getAllowedTools: () => [],
      getExcludeTools: () => [],
      getContentGeneratorConfig: () => ({ model: 'test-model' }),
      getEnableHooks: () => true,
    },
  );
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  const settingsOwner = new SessionSettingsOwner(settings);
  settingsOwner.bindTelemetry(config);
  const policyOwner = new RuntimePolicyOwner(config);
  const hooks = new SessionHookOwner(
    readHookDefinitions(config),
    hookSessionRuntime(
      config,
      new WorkspaceTrustLifecycle({ localTrust: config.initialWorkspaceTrust }),
      settingsOwner.telemetry,
    ),
    true,
    policyOwner.session.messageBus,
  );
  ownedFixtures.push({ config, settingsOwner, policyOwner, hooks });
  return { config, settingsOwner, policyOwner };
}

async function scheduleAndWaitForCompletion(
  scheduler: CoreToolScheduler,
  completionConfig: Config,
  settingsOwner: SessionSettingsOwner,
  request:
    | {
        callId: string;
        name: string;
        args: Record<string, unknown>;
        isClientInitiated: boolean;
        prompt_id: string;
      }
    | Array<{
        callId: string;
        name: string;
        args: Record<string, unknown>;
        isClientInitiated: boolean;
        prompt_id: string;
      }>,
): Promise<CompletedToolCall[]> {
  let completionResolver: ((calls: CompletedToolCall[]) => void) | null = null;
  const completionPromise = new Promise<CompletedToolCall[]>((resolve) => {
    completionResolver = resolve;
  });

  scheduler.setCallbacks({
    telemetry: settingsOwner.telemetry,
    readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
    getToolGovernance: () =>
      settingsOwner.readToolGovernance(
        completionConfig.getExcludeTools() ?? [],
      ),
    config: completionConfig,
    onAllToolCallsComplete: async (calls) => {
      completionResolver?.(calls);
    },
    getPreferredEditor: () => undefined,
    onEditorClose: () => {},
  });

  await scheduler.schedule(
    Array.isArray(request) ? request : [request],
    new AbortController().signal,
    ownedFixtures
      .find((fixture) => fixture.config === completionConfig)
      ?.hooks.execution({
        sessionId: () => completionConfig.getSessionId(),
        transcriptPath: () => undefined,
      }),
  );
  return completionPromise;
}

describe('CoreToolScheduler hook-enabled characterization', () => {
  afterEach(async () => {
    for (const fixture of ownedFixtures.splice(0)) {
      await fixture.hooks.dispose();
      await fixture.settingsOwner.dispose();
      await fixture.policyOwner.dispose();
      await fixture.config.dispose();
    }
  });

  let scheduler: CoreToolScheduler | undefined;

  afterEach(() => {
    if (scheduler) {
      scheduler.dispose();
      scheduler = undefined;
    }
  });

  it('buffers an error and skips tool execution when a before-hook blocks', async () => {
    const mockTool = new MockTool('hooked-tool');
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem({
      beforeToolResult: {
        decision: 'block',
        reason: 'blocked by before hook',
      },
    });
    const {
      config: config,
      settingsOwner,
      policyOwner,
    } = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      telemetry: settingsOwner.telemetry,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
      config,
      messageBus: policyOwner.session.messageBus,
      toolRegistry,
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const completedCalls = await scheduleAndWaitForCompletion(
      scheduler,
      config,
      settingsOwner,
      {
        callId: 'blocked-call',
        name: 'hooked-tool',
        args: { original: true },
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      },
    );

    expect(mockTool.executeFn).not.toHaveBeenCalled();
    expect(completedCalls).toHaveLength(1);
    expect(completedCalls[0].status).toBe('error');
    expect(expectErrored(completedCalls[0]).response.error?.message).toBe(
      'blocked by before hook',
    );
  });

  it('surfaces an error and skips tool execution when a before-hook requests stop', async () => {
    const mockTool = new MockTool({
      name: 'hooked-tool',
      execute: async () => ({
        llmContent: 'tool should not run',
        returnDisplay: 'tool should not run',
      }),
    });
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem({
      beforeToolResult: {
        continue: false,
        stopReason: 'stop requested by before hook',
      },
    });
    const {
      config: config,
      settingsOwner,
      policyOwner,
    } = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      telemetry: settingsOwner.telemetry,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
      config,
      messageBus: policyOwner.session.messageBus,
      toolRegistry,
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const completedCalls = await scheduleAndWaitForCompletion(
      scheduler,
      config,
      settingsOwner,
      {
        callId: 'stop-before-call',
        name: 'hooked-tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      },
    );

    expect(mockTool.executeFn).not.toHaveBeenCalled();
    expect(completedCalls).toHaveLength(1);
    expect(completedCalls[0].status).toBe('error');
    expect(expectErrored(completedCalls[0]).response.error?.message).toBe(
      'stop requested by before hook',
    );
  });

  it('executes the tool with modified input when a before-hook returns tool_input', async () => {
    const receivedArgs: Array<Record<string, unknown>> = [];
    const mockTool = new MockTool({
      name: 'hooked-tool',
      execute: async (args) => {
        receivedArgs.push(args);
        return {
          llmContent: JSON.stringify(args),
          returnDisplay: JSON.stringify(args),
        };
      },
    });
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem({
      beforeToolResult: {
        hookSpecificOutput: {
          tool_input: { rewritten: true, count: 2 },
        },
      },
    });
    const {
      config: config,
      settingsOwner,
      policyOwner,
    } = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      telemetry: settingsOwner.telemetry,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
      config,
      messageBus: policyOwner.session.messageBus,
      toolRegistry,
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    await scheduleAndWaitForCompletion(scheduler, config, settingsOwner, {
      callId: 'modified-call',
      name: 'hooked-tool',
      args: { original: true },
      isClientInitiated: false,
      prompt_id: 'prompt-1',
    });

    expect(receivedArgs).toStrictEqual([{ rewritten: true, count: 2 }]);
  });

  it('appends after-hook systemMessage text to the successful result content', async () => {
    const mockTool = new MockTool({
      name: 'hooked-tool',
      execute: async () => ({
        llmContent: 'tool output',
        returnDisplay: 'tool output',
      }),
    });
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem({
      afterToolResult: {
        systemMessage: 'after hook note',
      },
    });
    const {
      config: config,
      settingsOwner,
      policyOwner,
    } = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      telemetry: settingsOwner.telemetry,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
      config,
      messageBus: policyOwner.session.messageBus,
      toolRegistry,
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const completedCalls = await scheduleAndWaitForCompletion(
      scheduler,
      config,
      settingsOwner,
      {
        callId: 'after-message-call',
        name: 'hooked-tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      },
    );

    expect(completedCalls[0].status).toBe('success');
    const responsePart = expectSuccessful(completedCalls[0]).response
      .responseParts[0];
    expect(
      (responsePart as { result?: { output?: string } }).result,
    ).toStrictEqual({
      output: 'tool output\n\nafter hook note',
    });
  });

  it('appends before-hook systemMessage text to the successful result content', async () => {
    const mockTool = new MockTool({
      name: 'hooked-tool',
      execute: async () => ({
        llmContent: 'tool output',
        returnDisplay: 'tool output',
      }),
    });
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem({
      beforeToolResult: {
        systemMessage: 'before hook note',
      },
    });
    const {
      config: config,
      settingsOwner,
      policyOwner,
    } = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      telemetry: settingsOwner.telemetry,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
      config,
      messageBus: policyOwner.session.messageBus,
      toolRegistry,
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const completedCalls = await scheduleAndWaitForCompletion(
      scheduler,
      config,
      settingsOwner,
      {
        callId: 'before-message-call',
        name: 'hooked-tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      },
    );

    expect(completedCalls[0].status).toBe('success');
    const responsePart = expectSuccessful(completedCalls[0]).response
      .responseParts[0];
    expect(
      (responsePart as { result?: { output?: string } }).result,
    ).toStrictEqual({
      output: 'tool output\n\nbefore hook note',
    });
  });

  it('surfaces an error when an after-hook requests stop', async () => {
    const mockTool = new MockTool({
      name: 'hooked-tool',
      execute: async () => ({
        llmContent: 'tool output',
        returnDisplay: 'tool output',
      }),
    });
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem({
      afterToolResult: {
        continue: false,
        stopReason: 'stop requested by after hook',
      },
    });
    const {
      config: config,
      settingsOwner,
      policyOwner,
    } = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      telemetry: settingsOwner.telemetry,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
      config,
      messageBus: policyOwner.session.messageBus,
      toolRegistry,
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const completedCalls = await scheduleAndWaitForCompletion(
      scheduler,
      config,
      settingsOwner,
      {
        callId: 'stop-after-call',
        name: 'hooked-tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      },
    );

    expect(mockTool.executeFn).toHaveBeenCalledTimes(1);
    expect(completedCalls).toHaveLength(1);
    expect(completedCalls[0].status).toBe('error');
    expect(expectErrored(completedCalls[0]).response.error?.message).toBe(
      'stop requested by after hook',
    );
  });

  it('surfaces an error when an after-hook blocks after tool execution', async () => {
    const mockTool = new MockTool({
      name: 'hooked-tool',
      execute: async () => ({
        llmContent: 'tool output',
        returnDisplay: 'tool output',
      }),
    });
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem({
      afterToolResult: {
        decision: 'block',
        reason: 'blocked by after hook',
      },
    });
    const {
      config: config,
      settingsOwner,
      policyOwner,
    } = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      telemetry: settingsOwner.telemetry,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
      config,
      messageBus: policyOwner.session.messageBus,
      toolRegistry,
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const completedCalls = await scheduleAndWaitForCompletion(
      scheduler,
      config,
      settingsOwner,
      {
        callId: 'block-after-call',
        name: 'hooked-tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      },
    );

    expect(mockTool.executeFn).toHaveBeenCalledTimes(1);
    expect(completedCalls).toHaveLength(1);
    expect(completedCalls[0].status).toBe('error');
    expect(expectErrored(completedCalls[0]).response.error?.message).toBe(
      'blocked by after hook',
    );
  });

  it('sets suppressDisplay when an after-hook requests suppressOutput', async () => {
    const mockTool = new MockTool({
      name: 'hooked-tool',
      execute: async () => ({
        llmContent: 'tool output',
        returnDisplay: 'tool output',
      }),
    });
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem({
      afterToolResult: {
        suppressOutput: true,
      },
    });
    const {
      config: config,
      settingsOwner,
      policyOwner,
    } = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      telemetry: settingsOwner.telemetry,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
      config,
      messageBus: policyOwner.session.messageBus,
      toolRegistry,
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const completedCalls = await scheduleAndWaitForCompletion(
      scheduler,
      config,
      settingsOwner,
      {
        callId: 'suppress-call',
        name: 'hooked-tool',
        args: {},
        isClientInitiated: false,
        prompt_id: 'prompt-1',
      },
    );

    expect(completedCalls[0].status).toBe('success');
    expect(expectSuccessful(completedCalls[0]).response.suppressDisplay).toBe(
      true,
    );
  });

  it('preserves parallel batching while publishing results in request order', async () => {
    let activeExecutions = 0;
    let maxConcurrentExecutions = 0;
    const resolvers = new Map<string, () => void>();

    const mockTool = new MockTool({
      name: 'hooked-tool',
      execute: async (args) => {
        const id = String(args.id);
        activeExecutions += 1;
        maxConcurrentExecutions = Math.max(
          maxConcurrentExecutions,
          activeExecutions,
        );

        await new Promise<void>((resolve) => {
          resolvers.set(id, () => {
            activeExecutions -= 1;
            resolve();
          });
        });

        return {
          llmContent: `tool output ${id}`,
          returnDisplay: `tool output ${id}`,
        };
      },
    });
    const toolRegistry = createMockToolRegistry(mockTool);
    const hookSystem = createHookSystem();
    const {
      config: config,
      settingsOwner,
      policyOwner,
    } = createMockConfig(toolRegistry, hookSystem);

    scheduler = new CoreToolScheduler({
      telemetry: settingsOwner.telemetry,
      readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
      config,
      messageBus: policyOwner.session.messageBus,
      toolRegistry,
      onAllToolCallsComplete: async () => {},
      onToolCallsUpdate: vi.fn(),
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
    });

    const completionPromise = scheduleAndWaitForCompletion(
      scheduler,
      config,
      settingsOwner,
      [
        {
          callId: 'batch-1',
          name: 'hooked-tool',
          args: { id: '1' },
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
        {
          callId: 'batch-2',
          name: 'hooked-tool',
          args: { id: '2' },
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
        {
          callId: 'batch-3',
          name: 'hooked-tool',
          args: { id: '3' },
          isClientInitiated: false,
          prompt_id: 'prompt-1',
        },
      ],
    );

    await waitFor(() => {
      expect(resolvers.size).toBe(3);
    });

    resolvers.get('2')?.();
    resolvers.get('3')?.();
    await Promise.resolve();
    resolvers.get('1')?.();

    const completedCalls = await completionPromise;

    expect(maxConcurrentExecutions).toBeGreaterThan(1);
    expect(completedCalls.map((call) => call.request.callId)).toStrictEqual([
      'batch-1',
      'batch-2',
      'batch-3',
    ]);
    expect(completedCalls.map((call) => call.status)).toStrictEqual([
      'success',
      'success',
      'success',
    ]);
  });
});

import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools/tools/tool-registry.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
