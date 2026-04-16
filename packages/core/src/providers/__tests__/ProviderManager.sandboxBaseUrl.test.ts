import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderManager } from '../ProviderManager.js';
import type { IProvider } from '../IProvider.js';
import {
  registerSettingsService,
  resetSettingsService,
} from '../../settings/settingsServiceInstance.js';
import { SettingsService } from '../../settings/SettingsService.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../runtime/providerRuntimeContext.js';

function createMockProvider(name: string): IProvider {
  return {
    name,
    getModels: vi.fn().mockResolvedValue([]),
    getDefaultModel: vi.fn().mockReturnValue('test-model'),
    generateChatCompletion: vi.fn(),
    getServerTools: vi.fn().mockReturnValue([]),
    invokeServerTool: vi.fn().mockRejectedValue(new Error('Not implemented')),
  } as unknown as IProvider;
}

function createMinimalOptions(
  settingsService: SettingsService,
): Record<string, unknown> {
  const mockConfig = {
    getModel: vi.fn().mockReturnValue('test-model'),
    getEphemeralSetting: vi.fn().mockReturnValue(undefined),
    getSettingsService: vi.fn().mockReturnValue(settingsService),
  };

  return {
    settings: settingsService,
    config: mockConfig,
    runtime: {
      runtimeId: 'test-runtime',
      settingsService,
      config: mockConfig,
    },
    resolved: {
      authToken: 'dummy-key',
    },
  };
}

describe('ProviderManager sandbox-base-url resolution', () => {
  let manager: ProviderManager;
  let settingsService: SettingsService;
  let originalSandboxEnv: string | undefined;

  beforeEach(() => {
    originalSandboxEnv = process.env.SANDBOX;
    resetSettingsService();
    setActiveProviderRuntimeContext(createProviderRuntimeContext());
    settingsService = new SettingsService();
    registerSettingsService(settingsService);
    manager = new ProviderManager();
    manager.registerProvider(createMockProvider('test-provider'));
    manager.setActiveProvider('test-provider');
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    if (originalSandboxEnv === undefined) {
      delete process.env.SANDBOX;
    } else {
      process.env.SANDBOX = originalSandboxEnv;
    }
  });

  it('uses sandbox-base-url when in container sandbox and setting is defined', () => {
    process.env.SANDBOX = 'sandbox-0.9.0';
    settingsService.setProviderSetting(
      'test-provider',
      'base-url',
      'http://127.0.0.1:1234/v1/',
    );
    settingsService.setProviderSetting(
      'test-provider',
      'sandbox-base-url',
      'http://host.docker.internal:1234/v1/',
    );

    const options = createMinimalOptions(settingsService);
    const normalized = manager.normalizeRuntimeInputs(
      options as never,
      'test-provider',
    );

    expect(
      (normalized as never as { resolved: { baseURL: string } }).resolved
        .baseURL,
    ).toBe('http://host.docker.internal:1234/v1/');
  });

  it('keeps original base-url when SANDBOX is not set', () => {
    delete process.env.SANDBOX;
    settingsService.setProviderSetting(
      'test-provider',
      'base-url',
      'http://127.0.0.1:1234/v1/',
    );
    settingsService.setProviderSetting(
      'test-provider',
      'sandbox-base-url',
      'http://host.docker.internal:1234/v1/',
    );

    const options = createMinimalOptions(settingsService);
    const normalized = manager.normalizeRuntimeInputs(
      options as never,
      'test-provider',
    );

    expect(
      (normalized as never as { resolved: { baseURL: string } }).resolved
        .baseURL,
    ).toBe('http://127.0.0.1:1234/v1/');
  });

  it('keeps original base-url when SANDBOX is sandbox-exec (seatbelt)', () => {
    process.env.SANDBOX = 'sandbox-exec';
    settingsService.setProviderSetting(
      'test-provider',
      'base-url',
      'http://127.0.0.1:1234/v1/',
    );
    settingsService.setProviderSetting(
      'test-provider',
      'sandbox-base-url',
      'http://host.docker.internal:1234/v1/',
    );

    const options = createMinimalOptions(settingsService);
    const normalized = manager.normalizeRuntimeInputs(
      options as never,
      'test-provider',
    );

    expect(
      (normalized as never as { resolved: { baseURL: string } }).resolved
        .baseURL,
    ).toBe('http://127.0.0.1:1234/v1/');
  });

  it('keeps original base-url when in container sandbox but sandbox-base-url is not set', () => {
    process.env.SANDBOX = 'sandbox-0.9.0';
    settingsService.setProviderSetting(
      'test-provider',
      'base-url',
      'http://127.0.0.1:1234/v1/',
    );

    const options = createMinimalOptions(settingsService);
    const normalized = manager.normalizeRuntimeInputs(
      options as never,
      'test-provider',
    );

    expect(
      (normalized as never as { resolved: { baseURL: string } }).resolved
        .baseURL,
    ).toBe('http://127.0.0.1:1234/v1/');
  });

  it('does not override explicit call-scoped baseURL with sandbox-base-url', () => {
    process.env.SANDBOX = 'sandbox-0.9.0';
    settingsService.setProviderSetting(
      'test-provider',
      'sandbox-base-url',
      'http://host.docker.internal:1234/v1/',
    );

    const options = createMinimalOptions(settingsService);
    (options.resolved as Record<string, unknown>).baseURL =
      'http://custom-override:9999/v1/';
    const normalized = manager.normalizeRuntimeInputs(
      options as never,
      'test-provider',
    );

    expect(
      (normalized as never as { resolved: { baseURL: string } }).resolved
        .baseURL,
    ).toBe('http://custom-override:9999/v1/');
  });
});
