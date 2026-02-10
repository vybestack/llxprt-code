/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAgentRuntimeContext } from './createAgentRuntimeContext.js';
import type {
  AgentRuntimeContextFactoryOptions,
  ReadonlySettingsSnapshot,
  AgentRuntimeProviderAdapter,
  AgentRuntimeTelemetryAdapter,
  ToolRegistryView,
} from './AgentRuntimeContext.js';
import type { AgentRuntimeState } from './AgentRuntimeState.js';
import type { ProviderRuntimeContext } from './providerRuntimeContext.js';
import type { IProvider } from '../providers/IProvider.js';

describe('createAgentRuntimeContext', () => {
  let mockProvider: IProvider;
  let mockProviderAdapter: AgentRuntimeProviderAdapter;
  let mockTelemetryAdapter: AgentRuntimeTelemetryAdapter;
  let mockToolsView: ToolRegistryView;
  let mockProviderRuntime: ProviderRuntimeContext;
  let mockState: AgentRuntimeState;
  let settings: ReadonlySettingsSnapshot;

  beforeEach(() => {
    // Mock provider
    mockProvider = {
      name: 'test-provider',
      makeRequest: vi.fn(),
    } as unknown as IProvider;

    // Mock provider adapter
    mockProviderAdapter = {
      getActiveProvider: vi.fn().mockReturnValue(mockProvider),
      setActiveProvider: vi.fn(),
    };

    // Mock telemetry adapter
    mockTelemetryAdapter = {
      logApiRequest: vi.fn(),
      logApiResponse: vi.fn(),
      logApiError: vi.fn(),
    };

    // Mock tools view
    mockToolsView = {
      listToolNames: vi.fn().mockReturnValue([]),
      getToolMetadata: vi.fn(),
    };

    // Mock provider runtime
    mockProviderRuntime = {
      provider: 'test-provider',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
      runtimeId: 'test-runtime',
    };

    // Mock state
    mockState = {
      provider: 'test-provider',
      model: 'gemini-2.0-flash',
      sessionId: 'test-session',
      runtimeId: 'test-runtime',
    };

    // Initial settings
    settings = {
      contextLimit: 50000,
      compressionThreshold: 0.7,
      preserveThreshold: 0.3,
    };
  });

  describe('validation', () => {
    it('should throw if provider is missing', () => {
      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings,
        provider: undefined as unknown as AgentRuntimeProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: mockProviderRuntime,
      };

      expect(() => createAgentRuntimeContext(options)).toThrow(
        'AgentRuntimeContext requires a provider adapter',
      );
    });

    it('should throw if telemetry is missing', () => {
      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings,
        provider: mockProviderAdapter,
        telemetry: undefined as unknown as AgentRuntimeTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: mockProviderRuntime,
      };

      expect(() => createAgentRuntimeContext(options)).toThrow(
        'AgentRuntimeContext requires a telemetry adapter',
      );
    });

    it('should throw if tools is missing', () => {
      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings,
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: undefined as unknown as ToolRegistryView,
        providerRuntime: mockProviderRuntime,
      };

      expect(() => createAgentRuntimeContext(options)).toThrow(
        'AgentRuntimeContext requires a tools view',
      );
    });

    it('should throw if providerRuntime is missing', () => {
      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings,
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: undefined as unknown as ProviderRuntimeContext,
      };

      expect(() => createAgentRuntimeContext(options)).toThrow(
        'AgentRuntimeContext requires a provider runtime context',
      );
    });
  });

  describe('ephemerals.contextLimit()', () => {
    it('should return initial context limit from settings', () => {
      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings,
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: mockProviderRuntime,
      };

      const context = createAgentRuntimeContext(options);
      expect(context.ephemerals.contextLimit()).toBe(50000);
    });

    it('should use model default when contextLimit is not set', () => {
      const settingsWithoutLimit: ReadonlySettingsSnapshot = {
        compressionThreshold: 0.7,
      };

      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings: settingsWithoutLimit,
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: mockProviderRuntime,
      };

      const context = createAgentRuntimeContext(options);
      // gemini-2.0-flash has a default of 1_048_576
      expect(context.ephemerals.contextLimit()).toBe(1_048_576);
    });

    it('should return live context limit when settings change (fix for issue #602)', () => {
      // Create mutable settings object to simulate settings changes
      const mutableSettings: ReadonlySettingsSnapshot = {
        contextLimit: 50000,
        compressionThreshold: 0.7,
      };

      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings: mutableSettings,
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: mockProviderRuntime,
      };

      const context = createAgentRuntimeContext(options);

      // Verify initial context limit
      expect(context.ephemerals.contextLimit()).toBe(50000);

      // Simulate profile load or context-limit change by mutating the settings object
      mutableSettings.contextLimit = 100000;

      // THIS IS THE KEY TEST: contextLimit should return the NEW value
      expect(context.ephemerals.contextLimit()).toBe(100000);
    });

    it('should handle invalid context limit values and fall back to model default', () => {
      const mutableSettings: ReadonlySettingsSnapshot = {
        contextLimit: 50000,
      };

      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings: mutableSettings,
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: mockProviderRuntime,
      };

      const context = createAgentRuntimeContext(options);
      expect(context.ephemerals.contextLimit()).toBe(50000);

      // Test invalid values
      mutableSettings.contextLimit = 0;
      expect(context.ephemerals.contextLimit()).toBe(1_048_576);

      mutableSettings.contextLimit = -1000;
      expect(context.ephemerals.contextLimit()).toBe(1_048_576);

      mutableSettings.contextLimit = NaN;
      expect(context.ephemerals.contextLimit()).toBe(1_048_576);

      mutableSettings.contextLimit = Infinity;
      expect(context.ephemerals.contextLimit()).toBe(1_048_576);

      // Test back to valid value
      mutableSettings.contextLimit = 75000;
      expect(context.ephemerals.contextLimit()).toBe(75000);
    });

    it('should handle different model context limits', () => {
      const gpt4State: AgentRuntimeState = {
        ...mockState,
        model: 'gpt-4o',
      };

      const gpt4ProviderRuntime: ProviderRuntimeContext = {
        ...mockProviderRuntime,
        model: 'gpt-4o',
      };

      const mutableSettings: ReadonlySettingsSnapshot = {};

      const options: AgentRuntimeContextFactoryOptions = {
        state: gpt4State,
        settings: mutableSettings,
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: gpt4ProviderRuntime,
      };

      const context = createAgentRuntimeContext(options);
      // gpt-4o has default of 128_000
      expect(context.ephemerals.contextLimit()).toBe(128_000);

      // Override should work
      mutableSettings.contextLimit = 50000;
      expect(context.ephemerals.contextLimit()).toBe(50000);
    });
  });

  describe('ephemerals other properties', () => {
    it('should return compression threshold with fallback', () => {
      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings: { compressionThreshold: 0.9 },
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: mockProviderRuntime,
      };

      const context = createAgentRuntimeContext(options);
      expect(context.ephemerals.compressionThreshold()).toBe(0.9);
    });

    it('should use default compression threshold when not set', () => {
      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings: {},
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: mockProviderRuntime,
      };

      const context = createAgentRuntimeContext(options);
      expect(context.ephemerals.compressionThreshold()).toBe(0.8);
    });

    it('should return preserve threshold with fallback', () => {
      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings: { preserveThreshold: 0.15 },
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: mockProviderRuntime,
      };

      const context = createAgentRuntimeContext(options);
      expect(context.ephemerals.preserveThreshold()).toBe(0.15);
    });

    it('should use default preserve threshold when not set', () => {
      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings: {},
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: mockProviderRuntime,
      };

      const context = createAgentRuntimeContext(options);
      expect(context.ephemerals.preserveThreshold()).toBe(0.2);
    });

    it('should return tool format override when set', () => {
      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings: { toolFormatOverride: 'custom-format' },
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: mockProviderRuntime,
      };

      const context = createAgentRuntimeContext(options);
      expect(context.ephemerals.toolFormatOverride()).toBe('custom-format');
    });

    it('should return undefined for tool format override when not set', () => {
      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings: {},
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: mockProviderRuntime,
      };

      const context = createAgentRuntimeContext(options);
      expect(context.ephemerals.toolFormatOverride()).toBeUndefined();
    });
  });

  describe('context immutability', () => {
    it('should freeze the returned context', () => {
      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings,
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: mockProviderRuntime,
      };

      const context = createAgentRuntimeContext(options);
      expect(Object.isFrozen(context)).toBe(true);
    });

    it('should freeze provider runtime metadata', () => {
      const runtimeWithMetadata: ProviderRuntimeContext = {
        ...mockProviderRuntime,
        metadata: { custom: 'value' },
      };

      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings,
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: runtimeWithMetadata,
      };

      const context = createAgentRuntimeContext(options);
      expect(Object.isFrozen(context.providerRuntime)).toBe(true);
      expect(Object.isFrozen(context.providerRuntime.metadata)).toBe(true);
    });
  });

  describe('history service', () => {
    it('should use provided history service', () => {
      const mockHistory = {
        addMessage: vi.fn(),
        getHistory: vi.fn(),
      } as unknown as import('../services/history/HistoryService.js').HistoryService;

      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings,
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: mockProviderRuntime,
        history: mockHistory,
      };

      const context = createAgentRuntimeContext(options);
      expect(context.history).toBe(mockHistory);
    });

    it('should create new history service when not provided', () => {
      const options: AgentRuntimeContextFactoryOptions = {
        state: mockState,
        settings,
        provider: mockProviderAdapter,
        telemetry: mockTelemetryAdapter,
        tools: mockToolsView,
        providerRuntime: mockProviderRuntime,
      };

      const context = createAgentRuntimeContext(options);
      expect(context.history).toBeDefined();
    });
  });
});
