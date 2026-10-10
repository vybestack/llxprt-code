import { loadAgentRuntime } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';

import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { act } from 'react';
import { cleanup, renderHook } from '../../__tests__/render.js';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { buildCliStyleConfig } from '../../../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import { TaskTool } from '../../../../agents/src/tools/task.js';
import { SubAgentScope } from '../../../../agents/src/core/subagent.js';
import { SubagentOrchestrator } from '../../../../agents/src/core/subagentOrchestrator.js';
import { createStatelessRuntimeBundle } from '../../../../agents/src/core/__tests__/subagent-test-helpers.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools/tools/tool-registry.js';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import {
  SubagentTerminateMode,
  PolicyDecision,
  AgentEventType,
  type ToolCallRequestInfo,
  type CompletedToolCall,
} from '@vybestack/llxprt-code-core';
import { useReactToolScheduler } from './useReactToolScheduler.js';
import {
  useChildToolDisplay,
  type SchedulerRefs,
} from '../../runtime/interactiveToolScheduler.js';

function gate() {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const noop = (): void => {};

describe('Mounted CLI child execution ownership', () => {
  const cleanupOwners: Array<() => Promise<void>> = [];
  const finishes: Array<() => void> = [];
  afterEach(async () => {
    cleanup();
    finishes.splice(0).forEach((finish) => finish());
    for (const dispose of cleanupOwners.splice(0).reverse()) await dispose();
  });

  async function owner(
    name: string,
    mounted = true,
    decision = PolicyDecision.ALLOW,
  ) {
    const built = await buildCliStyleConfig('plain-text.jsonl', {
      sessionId: 'equal-child-owner-label',
      folderTrust: true,
      telemetry: { enabled: false },
      recording: { enabled: false },
    });
    const base = join(tmpdir(), 'llxprt-cli-child-scheduler-deletion');
    await mkdir(base, { recursive: true });
    const dir = await mkdtemp(resolve(base, 'child-fixture-'));
    const profiles = new ProfileManager(resolve(dir, 'profiles'));
    await profiles.saveProfile('child', {
      version: 1,
      provider: 'fake',
      model: 'fake-model',
      modelParams: {},
      ephemeralSettings: {},
    });
    const subagents = new SubagentManager(resolve(dir, 'subagents'), profiles);
    await subagents.saveSubagent('worker', 'child', 'Run one record tool.');
    const effects: string[] = [];
    const started = gate();
    const finish = gate();
    finishes.push(finish.release);
    built.policyOwner.session.confirmation.addRule({
      toolName: 'task',
      decision: PolicyDecision.ALLOW,
      priority: 10000,
    });
    built.policyOwner.session.confirmation.addRule({
      toolName: 'child_record',
      decision,
      priority: 10000,
    });
    const childRegistry = new ToolRegistry(
      built.config,
      new CoreMessageBusAdapter(built.messageBus),
      assembleTaskSchemaPolicy(built.settingsService),
    );
    const parentRecord = new MockTool({
      name: 'child_record',
      execute: async () => {
        throw new Error('Parent registry must not execute the child tool');
      },
    });
    childRegistry.registerTool(
      new MockTool({
        name: 'child_record',
        canUpdateOutput: true,
        shouldConfirmExecute: async () => ({
          type: 'info',
          title: name,
          prompt: name,
          onConfirm: async () => {},
        }),
        execute: async (_args, signal, updateOutput) => {
          effects.push(name);
          updateOutput?.({
            mode: 'append',
            data: `${name} streaming child work`,
          });
          started.release();
          await Promise.race([
            finish.promise,
            new Promise<void>((resolve) => {
              if (signal.aborted) resolve();
              else
                signal.addEventListener('abort', () => resolve(), {
                  once: true,
                });
            }),
          ]);
          signal.throwIfAborted();
          return {
            llmContent: `${name} child work`,
            returnDisplay: `${name} child display`,
          };
        },
      }),
    );
    let scope: SubAgentScope | undefined;
    const task = new TaskTool(built.config, {
      createChildSettings: () => built.settingsOwner.createChildStore(),
      readRunPolicy: () => built.settingsOwner.readSubagentRunPolicy(),
      readTaskPolicy: () => built.settingsOwner.readTaskPolicy(),
      readGovernance: () =>
        built.settingsOwner.readToolGovernance(
          built.config.getExcludeTools() ?? [],
        ),
      instructions: emptyInstructionReads,
      workspacePaths: built.mcpRuntime.workspacePaths,
      readMcpInstructions: built.mcpRuntime.readInstructions,
      messageBus: built.messageBus,
      isInteractiveEnvironment: () => true,
      orchestratorFactory: (messageBus) =>
        new SubagentOrchestrator({
          workspaceTrust: built.mcpRuntime.trust,
          createChildSettings: () => built.settingsOwner.createChildStore(),
          readRunPolicy: () => built.settingsOwner.readSubagentRunPolicy(),
          instructions: emptyInstructionReads,
          workspacePaths: built.mcpRuntime.workspacePaths,
          readMcpInstructions: built.mcpRuntime.readInstructions,
          foregroundConfig: built.config,
          toolRegistry: childRegistry,
          messageBus,
          profileManager: profiles,
          subagentManager: subagents,
          runtimeLoader: async (options) => {
            const bundle = createStatelessRuntimeBundle({
              history: new HistoryService(),
              toolRegistry: childRegistry,
              toolsView: {
                listToolNames: () => ['child_record'],
                getToolMetadata: (toolName) => ({
                  name: toolName,
                  description: toolName,
                  parameterSchema: { type: 'object', properties: {} },
                }),
              },
            });
            return loadAgentRuntime({
              ...options,
              overrides: {
                ...options.overrides,
                historyService: new HistoryService(),
                toolsView: bundle.toolsView,
                contentGenerator: bundle.contentGenerator,
              },
            });
          },
          scopeFactory: async (
            childName,
            config,
            prompt,
            model,
            run,
            tools,
            outputs,
            overrides,
            signal,
          ) => {
            let turn = 0;
            scope = await SubAgentScope.create(
              childName,
              config,
              prompt,
              model,
              run,
              tools,
              outputs,
              { ...overrides, environmentContextLoader: async () => [] },
              signal,
              {
                createTurn: (_chat, promptId, agentId) => {
                  const requests: ToolCallRequestInfo[] =
                    turn++ === 0
                      ? [
                          {
                            callId: 'same-child-call',
                            name: 'child_record',
                            args: {},
                            prompt_id: promptId,
                            agentId,
                            isClientInitiated: false,
                          },
                        ]
                      : [];
                  return {
                    pendingToolCalls: requests,
                    async *run() {
                      yield {
                        type: AgentEventType.Content,
                        value: requests.length > 0 ? 'Recording' : 'Done',
                      };
                    },
                  };
                },
              },
            );
            return scope;
          },
        }),
    });
    const agent: Agent = await fromConfig({
      settingsService: built.settingsService,
      settingsOwner: built.settingsOwner,
      prepareSessionTools: (_config, _bus, tools) => {
        tools.registerTool(parentRecord);
        tools.registerTool(task);
      },
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      config: built.config,
      mcpRuntime: built.mcpRuntime,
      messageBus: built.messageBus,
    });
    cleanupOwners.push(async () => {
      await agent.dispose();
      await built.config.dispose();
      await built.cleanup();
      await rm(dir, { recursive: true, force: true });
    });
    const completed: Array<{ primary: boolean; calls: CompletedToolCall[] }> =
      [];
    const runtime = { agent };
    const hook = mounted
      ? renderHook(() =>
          useReactToolScheduler(
            (_id, calls, options) => {
              completed.push({ primary: options.isPrimary, calls });
            },
            runtime,
            noop,
            () => undefined,
            noop,
          ),
        )
      : undefined;
    if (hook) await waitFor(() => expect(hook.result.current[5]).toBe(true));
    const channel = mounted ? undefined : agent.tools.openClientChannel();
    if (channel) await channel.ready;
    async function run(detached = false) {
      const request: ToolCallRequestInfo = {
        callId: `${name}-task`,
        name: 'task',
        args: {
          subagent_name: 'worker',
          goal_prompt: 'Record work',
          tool_whitelist: ['child_record'],
        },
        prompt_id: `${name}-prompt`,
        isClientInitiated: false,
      };
      if (detached) {
        const execution = agent.tools.openClientChannel();
        try {
          await execution.schedule(request, new AbortController().signal);
        } finally {
          await execution.release();
        }
      } else if (hook)
        await hook.result.current[1](request, new AbortController().signal);
      else await channel?.schedule(request, new AbortController().signal);
    }
    return {
      ...built,
      agent,
      hook,
      completed,
      started,
      finish,
      effects,
      run,
      getScope: () => scope,
    };
  }

  it('displays actual child owners once, isolates equal labels, and keeps B alive after A detaches and disposes', async () => {
    const a = await owner('A');
    const b = await owner('B');
    let runA!: Promise<void>;
    let runB!: Promise<void>;
    act(() => {
      runA = a.run();
      runB = b.run();
    });
    await Promise.all([a.started.promise, b.started.promise]);
    await waitFor(() =>
      expect(
        a.hook?.result.current[0].some(
          (call) => call.request.callId === 'same-child-call',
        ),
      ).toBe(true),
    );
    expect(
      b.hook?.result.current[0].find(
        (call) => call.request.callId === 'same-child-call',
      )?.request.agentId,
    ).toBe(b.getScope()?.getAgentId());
    expect(a.getScope()?.getAgentId()).not.toBe(b.getScope()?.getAgentId());
    a.hook?.unmount();
    await a.agent.dispose();
    await runA;
    b.hook?.rerender();
    b.finish.release();
    await act(async () => {
      await runB;
    });
    await waitFor(() =>
      expect(b.completed.some((entry) => !entry.primary)).toBe(true),
    );
    expect(a.effects).toStrictEqual(['A']);
    expect(b.effects).toStrictEqual(['B']);
    expect(a.completed.filter((entry) => !entry.primary)).toStrictEqual([]);
    const childCalls = b.completed
      .filter((entry) => !entry.primary)
      .flatMap((entry) => entry.calls);
    expect(
      childCalls.map((call) => [call.status, call.response.resultDisplay]),
    ).toStrictEqual([['success', 'B child display']]);
  });

  it('executes a task child without any renderer', async () => {
    const a = await owner('headless', false);
    const run = a.run();
    await a.started.promise;
    a.finish.release();
    await run;
    expect(a.effects).toStrictEqual(['headless']);
    expect(a.getScope()?.output.terminate_reason).toBe(
      SubagentTerminateMode.GOAL,
    );
  });

  it('cancels child work through its owning task signal', async () => {
    const a = await owner('cancel');
    let run!: Promise<void>;
    act(() => {
      run = a.run();
    });
    await a.started.promise;
    act(() => {
      a.hook?.result.current[3]();
    });
    await act(async () => {
      await run;
    });
    expect(a.effects).toStrictEqual(['cancel']);
    expect(
      a.completed
        .flatMap((entry) => entry.calls)
        .some((call) => call.status === 'cancelled'),
    ).toBe(true);
  });
  it('detaches mounted child display during deferred work without replacing execution completion', async () => {
    const a = await owner('detached');
    const b = await owner('peer');
    let run!: Promise<void>;
    act(() => {
      run = a.run(true);
    });
    await a.started.promise;
    await waitFor(() =>
      expect(
        a.hook?.result.current[0].some(
          (call) => call.request.callId === 'same-child-call',
        ),
      ).toBe(true),
    );
    await b.agent.dispose();
    a.hook?.unmount();
    a.finish.release();
    await run;
    expect(a.getScope()?.output.terminate_reason).toBe(
      SubagentTerminateMode.GOAL,
    );
    expect(a.effects).toStrictEqual(['detached']);
    expect(a.completed).toStrictEqual([]);
  });

  it('routes equal child call IDs to independent approval buses and honors each owner policy', async () => {
    const a = await owner('approve', true, PolicyDecision.ASK_USER);
    const b = await owner('deny', true, PolicyDecision.ASK_USER);
    let runA!: Promise<void>;
    let runB!: Promise<void>;
    act(() => {
      runA = a.run();
      runB = b.run();
    });
    const waiting = (value: Awaited<ReturnType<typeof owner>>) =>
      value.hook?.result.current[0].find(
        (call) => call.request.callId === 'same-child-call',
      );
    await waitFor(() => {
      expect(waiting(a)?.status).toBe('awaiting_approval');
      expect(waiting(b)?.status).toBe('awaiting_approval');
    });
    const approval = waiting(a);
    const denial = waiting(b);
    if (
      approval?.status !== 'awaiting_approval' ||
      denial?.status !== 'awaiting_approval' ||
      !('onConfirm' in approval.confirmationDetails) ||
      !('onConfirm' in denial.confirmationDetails)
    )
      throw new Error('Missing child confirmations');
    const approve = approval.confirmationDetails.onConfirm;
    const deny = denial.confirmationDetails.onConfirm;
    a.finish.release();
    await act(async () => {
      await approve(ToolConfirmationOutcome.ProceedOnce);
    });
    await runA;
    expect(a.effects).toStrictEqual(['approve']);
    expect(b.effects).toStrictEqual([]);
    expect(waiting(b)?.status).toBe('awaiting_approval');
    await act(async () => {
      await deny(ToolConfirmationOutcome.Cancel);
      await runB;
    });
    expect(
      b.completed
        .filter((entry) => !entry.primary)
        .flatMap((entry) => entry.calls)
        .map((call) => call.status),
    ).toStrictEqual(['cancelled']);
    const c = await owner('policy-denied', true, PolicyDecision.DENY);
    await act(async () => {
      await c.run();
    });
    expect(c.effects).toStrictEqual([]);
    expect(
      c.completed
        .filter((entry) => !entry.primary)
        .flatMap((entry) => entry.calls)
        .map((call) => call.status),
    ).toStrictEqual(['error']);
  });
  it('finishes engine work independently of a deferred renderer completion and never updates after unmount', async () => {
    const a = await owner('renderer', false);
    const entered = gate();
    const finishRenderer = gate();
    finishes.push(finishRenderer.release);
    const updates: number[] = [];
    const output: string[] = [];
    const refs: SchedulerRefs = {
      updateToolCallOutput: (_id, _call, update) => {
        if (update.mode === 'append') output.push(update.data);
      },
      replaceToolCallsForScheduler: (_id, calls) => {
        updates.push(calls.length);
      },
      onCompleteRef: {
        current: async () => {
          entered.release();
          await finishRenderer.promise;
        },
      },
      getPreferredEditorRef: { current: () => undefined },
      onEditorCloseRef: { current: noop },
      onEditorOpenRef: { current: noop },
      setLastToolOutputTime: noop,
    };
    const hook = renderHook(() => useChildToolDisplay(a.agent, refs, noop));
    const run = a.run();
    await a.started.promise;
    a.finish.release();
    await entered.promise;
    await run;
    hook.unmount();
    const before = [...updates];
    finishRenderer.release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(updates).toStrictEqual(before);
    expect(output.join('')).toContain('renderer streaming child work');
    expect(a.getScope()?.output.terminate_reason).toBe(
      SubagentTerminateMode.GOAL,
    );
  });
});
