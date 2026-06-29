/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for diagnostics command load-balancer token accounting
 * output (issue #2207).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { diagnosticsCommand } from './diagnosticsCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { MessageActionReturn } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../../config/settings.js';

const getCliProviderManagerMock = vi.fn();
const getActiveProviderStatusMock = vi.fn();
const getRuntimeDiagnosticsSnapshotMock = vi.fn();
const getCliOAuthManagerMock = vi.fn();
const getSessionTokenUsageMock = vi.fn();

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => ({
    getCliOAuthManager: getCliOAuthManagerMock,
    getActiveProviderStatus: getActiveProviderStatusMock,
    getCliProviderManager: getCliProviderManagerMock,
    getRuntimeDiagnosticsSnapshot: getRuntimeDiagnosticsSnapshotMock,
    getSessionTokenUsage: getSessionTokenUsageMock,
  }),
}));

function setupDefaultRuntimeMocks(): void {
  getActiveProviderStatusMock.mockReturnValue({
    providerName: 'load-balancer',
    modelName: 'gptfirst',
    profileName: 'gptfirst',
    modelParams: {},
    ephemeralSettings: {},
  });
  getRuntimeDiagnosticsSnapshotMock.mockReturnValue({
    providerName: 'load-balancer',
    modelName: 'gptfirst',
    profileName: 'gptfirst',
    modelParams: {},
    ephemeralSettings: {},
  });
  getCliOAuthManagerMock.mockReturnValue(undefined);
  getSessionTokenUsageMock.mockReturnValue({
    input: 100,
    output: 20,
    cache: 5,
    tool: 7,
    thought: 3,
    total: 135,
  });
}

function addConfigStubs(mockContext: CommandContext): void {
  const config = mockContext.services.config as unknown as Record<
    string,
    unknown
  >;
  config.getDebugMode = () => false;
  config.getApprovalMode = () => 'normal';
  config.getIdeMode = () => false;
  config.getIdeClient = () => undefined;
  config.getMcpServers = () => undefined;
  config.getMcpServerCommand = () => undefined;
  config.getUserMemory = () => '';
  config.getLlxprtMdFileCount = () => 0;
  config.getToolRegistry = () => ({
    getAllTools: () => [],
  });
  mockContext.services.settings = {
    merged: {
      ui: { theme: 'default', usageStatisticsEnabled: false },
      defaultProfile: 'load-balancer',
      sandbox: undefined,
    },
  } as unknown as LoadedSettings;
}

async function getDiagnosticsOutput(
  mockContext: CommandContext,
): Promise<string> {
  const result = (await diagnosticsCommand.action!(
    mockContext,
    '',
  )) as MessageActionReturn;
  return result.content;
}

describe('diagnosticsCommand - load balancer token accounting (issue #2207)', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    getCliProviderManagerMock.mockReset();
    getActiveProviderStatusMock.mockReset();
    getRuntimeDiagnosticsSnapshotMock.mockReset();
    getCliOAuthManagerMock.mockReset();
    getSessionTokenUsageMock.mockReset();
    mockContext = createMockCommandContext();
    setupDefaultRuntimeMocks();
    addConfigStubs(mockContext);
  });

  it('displays shared context limit and accounting source from LB provider diagnostics', async () => {
    getCliProviderManagerMock.mockReturnValue({
      getProviderByName: () => ({
        name: 'load-balancer',
        getStats: () => ({
          profileName: 'gptfirst',
          lastSelected: 'gpt-sub',
          totalRequests: 5,
          profileCounts: { 'gpt-sub': 3, 'opus-sub': 2 },
          members: ['gpt-sub', 'opus-sub'],
          lastSelectedModel: 'gpt-4.1',
          backendMetrics: {},
          circuitBreakerStates: {},
          currentTPM: {},
        }),
        getTokenAccountingDiagnostics: () => ({
          profileName: 'gptfirst',
          selectedSubProfile: 'gpt-sub',
          activeProvider: 'openai',
          activeModel: 'gpt-4.1',
          accountingSource: 'gpt-4.1 (tokenizer)',
          sharedContextLimit: 100000,
          lastEstimatedTokens: 45000,
        }),
      }),
    });

    const output = await getDiagnosticsOutput(mockContext);

    expect(output).toContain('Load Balancer Stats');
    expect(output).toContain('Active Sub-Profile: gpt-sub');
    expect(output).toContain('Load Balancer Profile: gptfirst');
    expect(output).toContain('Selected Sub-Profile: gpt-sub');
    expect(output).toContain('Selected Provider: openai');
    expect(output).toContain('Selected Model: gpt-4.1');
    expect(output).toContain('Accounting Source: gpt-4.1 (tokenizer)');
    expect(output).toContain('Shared Context Limit: 100000');
    expect(output).toContain('Request-Estimated Tokens: 45000');
  });

  it('distinguishes request-estimated tokens in output', async () => {
    getCliProviderManagerMock.mockReturnValue({
      getProviderByName: () => ({
        name: 'load-balancer',
        getStats: () => ({
          profileName: 'gptfirst',
          lastSelected: 'gpt-sub',
          totalRequests: 1,
          profileCounts: { 'gpt-sub': 1 },
          members: ['gpt-sub'],
          lastSelectedModel: 'gpt-4.1',
          backendMetrics: {},
          circuitBreakerStates: {},
          currentTPM: {},
        }),
        getTokenAccountingDiagnostics: () => ({
          profileName: 'gptfirst',
          selectedSubProfile: null,
          activeProvider: null,
          activeModel: null,
          accountingSource: 'claude-opus-4 (tokenizer)',
          sharedContextLimit: 200000,
          lastEstimatedTokens: 120000,
        }),
      }),
    });

    const output = await getDiagnosticsOutput(mockContext);

    expect(output).toContain('Request-Estimated Tokens: 120000');
    expect(output).toContain(
      'Session Status Tokens: 135 total (input 100, output 20, cache 5, tool 7, thought 3)',
    );
    expect(output).toContain('Load Balancer Profile: gptfirst');
    expect(output).toContain('Selected Sub-Profile: none');
    expect(output).toContain('Selected Provider: none');
    expect(output).toContain('Selected Model: none');
  });

  it('shows active sub-profile name in LB stats section', async () => {
    getCliProviderManagerMock.mockReturnValue({
      getProviderByName: () => ({
        name: 'load-balancer',
        getStats: () => ({
          profileName: 'gptfirst',
          lastSelected: 'opus-sub',
          totalRequests: 3,
          profileCounts: { 'gpt-sub': 2, 'opus-sub': 1 },
          members: ['gpt-sub', 'opus-sub'],
          lastSelectedModel: 'claude-opus-4',
          backendMetrics: {},
          circuitBreakerStates: {},
          currentTPM: {},
        }),
        getTokenAccountingDiagnostics: () => ({
          profileName: 'gptfirst',
          selectedSubProfile: 'opus-sub',
          activeProvider: 'anthropic',
          activeModel: 'claude-opus-4',
          accountingSource: 'claude-opus-4 (tokenizer)',
          sharedContextLimit: 200000,
          lastEstimatedTokens: 50000,
        }),
      }),
    });

    const output = await getDiagnosticsOutput(mockContext);

    expect(output).toContain('Active Sub-Profile: opus-sub');
  });

  it('handles providers without getTokenAccountingDiagnostics gracefully', async () => {
    getCliProviderManagerMock.mockReturnValue({
      getProviderByName: () => ({
        name: 'load-balancer',
        getStats: () => ({
          profileName: 'gptfirst',
          lastSelected: null,
          totalRequests: 0,
          profileCounts: {},
          members: ['gpt-sub', 'opus-sub'],
          lastSelectedModel: null,
          backendMetrics: {},
          circuitBreakerStates: {},
          currentTPM: {},
        }),
      }),
    });

    const output = await getDiagnosticsOutput(mockContext);
    expect(output).not.toContain('Accounting Source:');
    expect(output).not.toContain('Session Status Tokens:');
    expect(output).not.toContain('Shared Context Limit:');
    expect(output).not.toContain('Request-Estimated Tokens:');

    expect(output).toContain('Load Balancer Stats');
  });

  it('handles unavailable session token usage gracefully', async () => {
    getCliProviderManagerMock.mockReturnValue({
      getProviderByName: () => ({
        name: 'load-balancer',
        getStats: () => ({
          profileName: 'gptfirst',
          lastSelected: 'gpt-sub',
          totalRequests: 1,
          profileCounts: { 'gpt-sub': 1 },
          members: ['gpt-sub'],
          lastSelectedModel: 'gpt-4.1',
          backendMetrics: {},
          circuitBreakerStates: {},
          currentTPM: {},
        }),
        getTokenAccountingDiagnostics: () => ({
          profileName: 'gptfirst',
          selectedSubProfile: 'gpt-sub',
          activeProvider: 'openai',
          activeModel: 'gpt-4.1',
          accountingSource: 'gpt-4.1 (tokenizer)',
          sharedContextLimit: 100000,
          lastEstimatedTokens: 45000,
        }),
      }),
    });
    getSessionTokenUsageMock.mockReturnValue(null);

    const output = await getDiagnosticsOutput(mockContext);

    expect(output).toContain('Load Balancer Stats');
    expect(output).toContain('Request-Estimated Tokens: 45000');
    expect(output).not.toContain('Session Status Tokens:');
  });

  it('suppresses malformed non-finite session token usage', async () => {
    getCliProviderManagerMock.mockReturnValue({
      getProviderByName: () => ({
        name: 'load-balancer',
        getStats: () => ({
          profileName: 'gptfirst',
          lastSelected: 'gpt-sub',
          totalRequests: 1,
          profileCounts: { 'gpt-sub': 1 },
          members: ['gpt-sub'],
          lastSelectedModel: 'gpt-4.1',
          backendMetrics: {},
          circuitBreakerStates: {},
          currentTPM: {},
        }),
        getTokenAccountingDiagnostics: () => ({
          profileName: 'gptfirst',
          selectedSubProfile: 'gpt-sub',
          activeProvider: 'openai',
          activeModel: 'gpt-4.1',
          accountingSource: 'gpt-4.1 (tokenizer)',
          sharedContextLimit: 100000,
          lastEstimatedTokens: 45000,
        }),
      }),
    });
    getSessionTokenUsageMock.mockReturnValue({
      input: 100,
      output: 20,
      cache: 5,
      tool: 7,
      thought: 3,
      total: Number.NaN,
    });

    const output = await getDiagnosticsOutput(mockContext);

    expect(output).toContain('Request-Estimated Tokens: 45000');
    expect(output).not.toContain('Session Status Tokens:');
    expect(output).not.toContain('NaN');
  });

  it('renders null and zero token accounting values distinctly', async () => {
    getCliProviderManagerMock.mockReturnValue({
      getProviderByName: () => ({
        name: 'load-balancer',
        getStats: () => ({
          profileName: 'gptfirst',
          lastSelected: 'gpt-sub',
          totalRequests: 1,
          profileCounts: { 'gpt-sub': 1 },
          members: ['gpt-sub'],
          lastSelectedModel: 'gpt-4.1',
          backendMetrics: {},
          circuitBreakerStates: {},
          currentTPM: {},
        }),
        getTokenAccountingDiagnostics: () => ({
          profileName: 'gptfirst',
          selectedSubProfile: 'gpt-sub',
          activeProvider: 'openai',
          activeModel: 'gpt-4.1',
          accountingSource: 'gpt-4.1 (tokenizer)',
          sharedContextLimit: null,
          lastEstimatedTokens: null,
        }),
      }),
    });

    let output = await getDiagnosticsOutput(mockContext);
    expect(output).toContain('Shared Context Limit: unbounded');
    expect(output).toContain('Request-Estimated Tokens: n/a');

    getCliProviderManagerMock.mockReturnValue({
      getProviderByName: () => ({
        name: 'load-balancer',
        getStats: () => ({
          profileName: 'gptfirst',
          lastSelected: 'gpt-sub',
          totalRequests: 1,
          profileCounts: { 'gpt-sub': 1 },
          members: ['gpt-sub'],
          lastSelectedModel: 'gpt-4.1',
          backendMetrics: {},
          circuitBreakerStates: {},
          currentTPM: {},
        }),
        getTokenAccountingDiagnostics: () => ({
          profileName: 'gptfirst',
          selectedSubProfile: 'gpt-sub',
          activeProvider: 'openai',
          activeModel: 'gpt-4.1',
          accountingSource: 'gpt-4.1 (tokenizer)',
          sharedContextLimit: 0,
          lastEstimatedTokens: 0,
        }),
      }),
    });

    output = await getDiagnosticsOutput(mockContext);
    expect(output).toContain('Shared Context Limit: 0');
    expect(output).toContain('Request-Estimated Tokens: 0');
  });

  it('suppresses malformed session usage when any token field is non-finite', async () => {
    getCliProviderManagerMock.mockReturnValue({
      getProviderByName: () => ({
        name: 'load-balancer',
        getStats: () => ({
          profileName: 'gptfirst',
          lastSelected: 'gpt-sub',
          totalRequests: 1,
          profileCounts: { 'gpt-sub': 1 },
          members: ['gpt-sub'],
          lastSelectedModel: 'gpt-4.1',
          backendMetrics: {},
          circuitBreakerStates: {},
          currentTPM: {},
        }),
        getTokenAccountingDiagnostics: () => ({
          profileName: 'gptfirst',
          selectedSubProfile: 'gpt-sub',
          activeProvider: 'openai',
          activeModel: 'gpt-4.1',
          accountingSource: 'gpt-4.1 (tokenizer)',
          sharedContextLimit: 100000,
          lastEstimatedTokens: 45000,
        }),
      }),
    });
    getSessionTokenUsageMock.mockReturnValue({
      input: Number.NaN,
      output: 20,
      cache: 5,
      tool: 7,
      thought: 3,
      total: 135,
    });

    const output = await getDiagnosticsOutput(mockContext);

    expect(output).toContain('Request-Estimated Tokens: 45000');
    expect(output).not.toContain('Session Status Tokens:');
    expect(output).not.toContain('NaN');
  });
  it('skips load-balancer diagnostics when provider manager cannot resolve provider', async () => {
    getCliProviderManagerMock.mockReturnValue({
      getProviderByName: () => null,
    });

    const output = await getDiagnosticsOutput(mockContext);

    expect(output).not.toContain('Load Balancer Stats');
    expect(output).not.toContain('Request-Estimated Tokens:');
  });

  it('suppresses load balancer section when stats collection throws', async () => {
    getCliProviderManagerMock.mockReturnValue({
      getProviderByName: () => ({
        name: 'load-balancer',
        getStats: () => {
          throw new Error('stats unavailable');
        },
      }),
    });

    const output = await getDiagnosticsOutput(mockContext);

    expect(output).toContain('# LLxprt Diagnostics');
    expect(output).not.toContain('Load Balancer Stats');
    expect(output).not.toContain('Request-Estimated Tokens:');
  });
});
