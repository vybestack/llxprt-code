/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { SubagentOrchestrator } from '../core/subagentOrchestrator.js';
import { SessionTaskServices } from '../api/agentRuntimeAssembly.js';
import { TaskTool } from './task.js';

describe('TaskTool background execution ownership', () => {
  it('tracks a launched execution until scope and orchestrator disposal finish', async () => {
    const services = new SessionTaskServices(new SettingsService());
    let releaseScope: (() => void) | undefined;
    const scopeGate = new Promise<void>((resolve) => {
      releaseScope = resolve;
    });
    let releaseScopeDisposal: (() => void) | undefined;
    const disposalGate = new Promise<void>((resolve) => {
      releaseScopeDisposal = resolve;
    });
    let signalScopeDisposal: (() => void) | undefined;
    const scopeDisposalStarted = new Promise<void>((resolve) => {
      signalScopeDisposal = resolve;
    });
    const scopeDisposal = vi.fn(async () => {
      signalScopeDisposal?.();
      await disposalGate;
    });
    const scope = {
      runNonInteractive: vi.fn(async () => {
        await scopeGate;
      }),
      output: {
        terminate_reason: SubagentTerminateMode.GOAL,
        emitted_vars: {},
      },
    };
    const launch = vi.fn().mockResolvedValue({
      agentId: 'owned-background-task',
      scope,
      dispose: scopeDisposal,
    });
    const config = {
      getSessionId: () => 'owned-session',
      getSettingsService: () => new SettingsService(),
    } as unknown as Config;
    const tool = new TaskTool(config, {
      messageBus: new MessageBus(),
      orchestratorFactory: () =>
        ({ launch }) as unknown as SubagentOrchestrator,
      getTaskManager: () => services.manager,
      isInteractiveEnvironment: () => false,
    });

    const result = await tool
      .build({
        subagent_name: 'helper',
        goal_prompt: 'Finish the background work',
        async: true,
      })
      .execute(new AbortController().signal);
    expect(result.metadata?.status).toBe('running');
    expect(services.manager.getTask('owned-background-task')?.status).toBe(
      'running',
    );

    const disposal = services.dispose();
    let settled = false;
    void disposal.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(scopeDisposal).not.toHaveBeenCalled();
    expect(
      services.manager.getTask('owned-background-task')?.abortController?.signal
        .aborted,
    ).toBe(true);

    releaseScope?.();
    await scopeDisposalStarted;
    expect(scopeDisposal).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    releaseScopeDisposal?.();
    await disposal;
    expect(settled).toBe(true);
    expect(services.manager.getTask('owned-background-task')?.status).toBe(
      'cancelled',
    );
  });
});
