/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { CoreSubagentServiceAdapter } from './CoreSubagentServiceAdapter.js';
import {
  SubagentOrchestrator,
  type SubagentLaunchResult,
} from '../core/subagentOrchestrator.js';
import { SubagentTerminateMode } from '../core/subagentTypes.js';
import type { Config } from '../config/config.js';
import type { SubagentManager } from '../config/subagentManager.js';
import type { ProfileManager } from '@vybestack/llxprt-code-settings';

interface ScopeSpies {
  runInteractive: ReturnType<typeof vi.fn>;
  runNonInteractive: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function createLaunchResult(spies: ScopeSpies): SubagentLaunchResult {
  const scope = {
    output: {
      terminate_reason: SubagentTerminateMode.GOAL,
      emitted_vars: {},
    },
    onMessage: undefined,
    runInteractive: spies.runInteractive,
    runNonInteractive: spies.runNonInteractive,
    getAgentId: () => 'agent-test',
  };
  return {
    agentId: 'agent-test',
    scope,
    dispose: spies.dispose,
  } as unknown as SubagentLaunchResult;
}

function createAdapter(
  isInteractive: boolean,
  spies: ScopeSpies,
): CoreSubagentServiceAdapter {
  const launchResult = createLaunchResult(spies);

  const fakeOrchestrator = {
    launch: vi.fn().mockResolvedValue(launchResult),
  } as unknown as SubagentOrchestrator;

  const config = {
    getEphemeralSettings: () => ({}),
    getSessionId: () => 'session-test',
    isInteractive: () => isInteractive,
  } as unknown as Config;

  return new CoreSubagentServiceAdapter({
    managerProvider: () => ({}) as unknown as SubagentManager,
    profileManagerProvider: () => ({}) as unknown as ProfileManager,
    config,
    isInteractiveEnvironment: () => config.isInteractive(),
    orchestratorFactory: () => fakeOrchestrator,
  });
}

describe('CoreSubagentServiceAdapter runScope interactivity', () => {
  it('runs the subagent non-interactively when the environment is non-interactive', async () => {
    const spies: ScopeSpies = {
      runInteractive: vi.fn().mockResolvedValue(undefined),
      runNonInteractive: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };

    const adapter = createAdapter(false, spies);

    const result = await adapter.executeSubagent({
      name: 'cplusplu-expert',
      prompt: 'Compose a haiku. Do not use any tools.',
    });

    expect(result.success).toBe(true);
    expect(spies.runNonInteractive).toHaveBeenCalledTimes(1);
    expect(spies.runInteractive).not.toHaveBeenCalled();
    expect(spies.dispose).toHaveBeenCalledTimes(1);
  });

  it('runs the subagent interactively when the environment is interactive', async () => {
    const spies: ScopeSpies = {
      runInteractive: vi.fn().mockResolvedValue(undefined),
      runNonInteractive: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };

    const adapter = createAdapter(true, spies);

    const result = await adapter.executeSubagent({
      name: 'cplusplu-expert',
      prompt: 'Compose a haiku. Do not use any tools.',
    });

    expect(result.success).toBe(true);
    expect(spies.runInteractive).toHaveBeenCalledTimes(1);
    expect(spies.runNonInteractive).not.toHaveBeenCalled();
    expect(spies.dispose).toHaveBeenCalledTimes(1);
  });
});
