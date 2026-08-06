/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for ZedAgent agent-disposal when terminal setup fails after
 * the agent was constructed (buildSessionAgent leak). When `fromConfig`
 * succeeds but `buildZedTerminalSetup` throws, the already-built agent MUST be
 * disposed so it (and its MessageBus/session resources) is not leaked.
 *
 * Drives the REAL ZedAgent.newSession with a stubbed fromConfig (spy on dispose)
 * and a mocked buildZedTerminalSetup that throws — no result-shaped mocks.
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { Config } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../config/settings.js';

import { RecordingConnection } from './zed-test-helpers.js';

const mockFromConfig = vi.fn();
const mockBuildZedTerminalSetup = vi.fn();

const actual = { ...(await import('@vybestack/llxprt-code-agents')) };
void vi.mock('@vybestack/llxprt-code-agents', () => ({
  ...actual,
  fromConfig: (...args: unknown[]) => mockFromConfig(...args),
}));

const actualActual = { ...(await import('./zed-terminal-setup.js')) };
void vi.mock('./zed-terminal-setup.js', () => ({
  ...actualActual,
  buildZedTerminalSetup: (...args: unknown[]) =>
    mockBuildZedTerminalSetup(...args),
}));

void vi.mock('@vybestack/llxprt-code-providers/runtime.js', () => ({
  registerAgentRuntimeFactories: vi.fn(),
  resetAgentRuntimeFactories: vi.fn(),
  clearActiveModelParam: vi.fn(),
  getActiveModelParams: vi.fn(),
  loadProfileByName: vi.fn(),
  setCliRuntimeContext: vi.fn(),
}));

function buildBaseConfig(): Config {
  return {
    getFileSystemService: () => ({
      readTextFile: vi.fn(async () => 'base'),
      writeTextFile: vi.fn(async () => undefined),
    }),
    getProviderManager: () => ({ id: 'base' }),
    getProfileManager: () => undefined,
    getEphemeralSetting: () => undefined,
    getDebugMode: () => false,
    getTargetDir: () => '/project',
    getProjectRoot: () => '/project',
    getMaxSessionTurns: () => 50,
    getModel: () => 'test-model',
    getSessionRecordingService: () => ({
      isActive: () => false,
      recordSessionMetadata: () => undefined,
      getSessionMetadataTitle: () => undefined,
    }),
    getToolRegistry: () => ({ getAllTools: () => [] }),
    storage: {
      getProjectTempDir: () => '/tmp',
      getProjectChatsDir: () => '/tmp/chats',
    },
  } as unknown as Config;
}

function buildTerminalCapableInit(): acp.InitializeRequest {
  return { protocolVersion: 1, clientCapabilities: { terminal: true } };
}

describe('ZedAgent.buildSessionAgent disposal on terminal-setup failure', () => {
  beforeEach(() => {
    mockFromConfig.mockReset();
    mockBuildZedTerminalSetup.mockReset();
  });

  it('disposes the already-built agent when buildZedTerminalSetup throws', async () => {
    const dispose = vi.fn(async () => undefined);
    const agent = {
      getApprovalMode: () => 'default',
      setApprovalMode: vi.fn(),
      dispose,
      getHistory: vi.fn(async () => []),
      async *stream() {
        yield { type: 'done', reason: 'stop' };
      },
      getMessageBus: () => ({}),
      tools: { respondToConfirmation: vi.fn() },
    } as unknown as Agent;
    mockFromConfig.mockResolvedValue(agent);
    mockBuildZedTerminalSetup.mockImplementation(() => {
      throw new Error('terminal registry construction failed');
    });

    const mod = await import('./zedIntegration.js');
    const zedAgent = new mod.ZedAgent(
      buildBaseConfig(),
      {} as LoadedSettings,
      new RecordingConnection() as unknown as acp.AgentSideConnection,
    );
    await zedAgent.initialize(buildTerminalCapableInit());

    await expect(
      zedAgent.newSession({ cwd: '/project', mcpServers: [] }),
    ).rejects.toThrow('terminal registry construction failed');

    // The agent built by fromConfig MUST be disposed — not leaked — because
    // buildSessionAgent aborted before handing ownership to the caller.
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
