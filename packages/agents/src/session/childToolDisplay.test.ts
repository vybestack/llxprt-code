import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import { createSessionSettingsFixture } from '../api/__tests__/helpers/session-settings-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach as disposeOwnedPolicies } from 'bun:test';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';

import { describe, expect, it } from 'bun:test';
import { ChildToolDisplay } from './childToolDisplay.js';
import { initInteractiveScheduler } from '../core/subagentExecution.js';
import { bindSchedulerOwner } from './assembleSchedulerOwner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { initializeTestMcpRuntime } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { PolicyDecision } from '@vybestack/llxprt-code-policy';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';

describe('Child execution display subscriptions', () => {
  it('keeps engine completion and tool execution alive after its observer detaches', async () => {
    const config = new Config({
      sessionId: 'child-display',
      model: 'test-model',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      trustedFolder: true,
    });
    const configPolicy = new RuntimePolicyOwner(config);
    ownedPolicies.push(configPolicy);
    const mcp = await initializeTestMcpRuntime(
      config,
      undefined,
      undefined,
      undefined,
      configPolicy,
    );
    ownedMcp.push(mcp);
    const toolRegistry = mcp.toolSelection;
    configPolicy.session.confirmation.addRule({
      toolName: '*',
      decision: PolicyDecision.ALLOW,
      priority: 1000,
    });
    const bus = configPolicy.session.messageBus;
    let finish = (): void => {};
    const deferred = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let entered = (): void => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let executions = 0;
    mcp.toolPublication.registerTool(
      new MockTool({
        name: 'child_record',
        execute: async () => {
          executions++;
          entered();
          await deferred;
          return {
            llmContent: 'completed child work',
            returnDisplay: 'child result',
          };
        },
      }),
    );
    const display = new ChildToolDisplay();
    const updates: string[] = [];
    const detach = display.subscribe({
      onToolCallsUpdate: (_id, calls) => {
        updates.push(...calls.map((call) => call.status));
      },
    });
    const settingsRoot = createSessionSettingsFixture(config);
    const execution = await initInteractiveScheduler(
      { displayCallbacks: display.open() },
      {
        createSchedulerOwner: bindSchedulerOwner(
          config,
          bus,
          true,
          toolRegistry,
          (options) => new CoreToolScheduler(options),
          () => settingsRoot.settingsOwner.readToolExecutionPolicy(),
          () =>
            settingsRoot.settingsOwner.readToolGovernance(
              config.getExcludeTools() ?? [],
            ),
          undefined,
          RootTelemetry.prepare({
            enabled: false,
            sessionId: 'isolated-caller-fixture',
            maxBytes: 1024,
            maxFiles: 1,
          }),
        ),
        subagentId: 'child',
        logger: new DebugLogger('child-display-test'),
      },
    );
    try {
      const result = execution.scheduler.awaitCompletedCalls();
      const scheduled = execution.scheduler.schedule(
        {
          callId: 'child-call',
          name: 'child_record',
          args: {},
          isClientInitiated: false,
          prompt_id: 'child-prompt',
          agentId: 'child',
        },
        new AbortController().signal,
      );
      await started;
      expect(updates).toContain('executing');
      detach();
      const before = [...updates];
      finish();
      await scheduled;
      const calls = await result;
      expect(
        calls.map((call) => [
          call.status,
          call.request.agentId,
          call.response.resultDisplay,
        ]),
      ).toStrictEqual([['success', 'child', 'child result']]);
      expect(executions).toBe(1);
      expect(updates).toStrictEqual(before);
    } finally {
      finish();
      await execution.schedulerDispose();
      await config.dispose();
    }
  });
});

const ownedPolicies: Array<{ dispose(): void }> = [];
disposeOwnedPolicies(() => {
  for (const owner of ownedPolicies.splice(0)) owner.dispose();
});

const ownedMcp: Array<{ dispose(): Promise<void> }> = [];
disposeOwnedPolicies(async () => {
  for (const owner of ownedMcp.splice(0)) await owner.dispose();
});
