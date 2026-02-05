import { describe, it, expect, vi } from 'vitest';
import { createAgentRuntimeState } from './AgentRuntimeState.js';
import { createAgentRuntimeContext } from './createAgentRuntimeContext.js';
import type { IProvider } from '../providers/IProvider.js';
import type { ToolRegistryView } from './AgentRuntimeContext.js';
import { createProviderRuntimeContext } from './providerRuntimeContext.js';
import { SettingsService } from '../settings/SettingsService.js';

const baseState = createAgentRuntimeState({
  runtimeId: 'stateless-runtime',
  provider: 'stub-provider',
  model: 'stub-model',
  sessionId: 'session-123',
});

describe('AgentRuntimeContext stateless enforcement', () => {
  it('should require explicit provider adapter when no provider manager supplied', () => {
    expect(() =>
      createAgentRuntimeContext({
        state: baseState,
        settings: {},
        telemetry: {
          logApiRequest: vi.fn(),
          logApiResponse: vi.fn(),
          logApiError: vi.fn(),
        },
        tools: {
          listToolNames: vi.fn(() => []),
          getToolMetadata: vi.fn(() => undefined),
        },
        providerRuntime: createProviderRuntimeContext({
          settingsService: new SettingsService(),
          runtimeId: baseState.runtimeId,
        }),
      }),
    ).toThrow(/provider adapter/i);
  });

  it('should route telemetry events through injected adapter without Config access', () => {
    const provider = {
      getActiveProvider: vi.fn(() => ({ name: 'stub-provider' }) as IProvider),
      setActiveProvider: vi.fn(),
    };
    const telemetry = {
      logApiRequest: vi.fn(),
      logApiResponse: vi.fn(),
      logApiError: vi.fn(),
    };
    const tools: ToolRegistryView = {
      listToolNames: vi.fn(() => ['alpha']),
      getToolMetadata: vi.fn(() => ({
        name: 'alpha',
        description: 'Alpha',
      })),
    };

    const context = createAgentRuntimeContext({
      state: baseState,
      settings: {},
      provider,
      telemetry,
      tools,
      providerRuntime: createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: baseState.runtimeId,
      }),
    });

    const requestEvent = { model: 'stub-model', promptId: 'req-1' };
    context.telemetry.logApiRequest(requestEvent);

    expect(telemetry.logApiRequest).toHaveBeenCalledWith(requestEvent);
    expect(context.provider.getActiveProvider()).toEqual(
      expect.objectContaining({ name: 'stub-provider' }),
    );
    expect(context.tools.listToolNames()).toEqual(['alpha']);
  });
});
