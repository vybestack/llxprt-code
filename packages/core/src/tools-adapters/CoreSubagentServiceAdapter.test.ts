/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { CoreSubagentServiceAdapter } from './CoreSubagentServiceAdapter.js';
import type {
  CoreSubagentLauncher,
  CoreSubagentLaunchResult,
} from './CoreSubagentServiceAdapter.js';
import { SubagentTerminateMode } from '../core/subagentTypes.js';
import type { Config } from '../config/config.js';
import type { SubagentManager } from '../config/subagentManager.js';
import type { ProfileManager } from '@vybestack/llxprt-code-settings';

interface ScopeSpies {
  runInteractive: ReturnType<typeof vi.fn>;
  runNonInteractive: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function createLaunchResult(spies: ScopeSpies): CoreSubagentLaunchResult {
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
  } as unknown as CoreSubagentLaunchResult;
}

function createAdapter(
  isInteractive: boolean,
  spies: ScopeSpies,
): CoreSubagentServiceAdapter {
  const launchResult = createLaunchResult(spies);

  const fakeOrchestrator = {
    launch: vi.fn().mockResolvedValue(launchResult),
  } as unknown as CoreSubagentLauncher;

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

interface AdapterWithLaunch {
  adapter: CoreSubagentServiceAdapter;
  launch: ReturnType<typeof vi.fn>;
}

function createAdapterWithLaunch(
  configOverrides: Partial<Config> = {},
): AdapterWithLaunch {
  const spies: ScopeSpies = {
    runInteractive: vi.fn().mockResolvedValue(undefined),
    runNonInteractive: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  const launchResult = createLaunchResult(spies);
  const launch = vi.fn().mockResolvedValue(launchResult);

  const fakeOrchestrator = {
    launch,
  } as unknown as CoreSubagentLauncher;

  const config = {
    getEphemeralSettings: () => ({}),
    getSessionId: () => 'session-test',
    isInteractive: () => false,
    ...configOverrides,
  } as unknown as Config;

  const adapter = new CoreSubagentServiceAdapter({
    managerProvider: () => ({}) as unknown as SubagentManager,
    profileManagerProvider: () => ({}) as unknown as ProfileManager,
    config,
    isInteractiveEnvironment: () => false,
    orchestratorFactory: () => fakeOrchestrator,
  });
  return { adapter, launch };
}

describe('CoreSubagentServiceAdapter toolConfig preservation (Issue #2069)', () => {
  it('preserves explicit empty toolWhitelist as toolConfig: { tools: [] }', async () => {
    const { adapter, launch } = createAdapterWithLaunch();

    await adapter.executeSubagent({
      name: 'helper',
      prompt: 'Do work',
      toolWhitelist: [],
      hasExplicitToolWhitelist: true,
    });

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: unknown }
      | undefined;
    expect(launchRequest).toBeDefined();
    expect(launchRequest).toHaveProperty('toolConfig');
    expect(launchRequest?.toolConfig).toStrictEqual({ tools: [] });
  });

  it('preserves explicit whitelist fully filtered to zero as toolConfig: { tools: [] }', async () => {
    const { adapter, launch } = createAdapterWithLaunch({
      getEphemeralSettings: () => ({ 'tools.disabled': ['read_file'] }),
      getToolRegistry: () => ({
        getEnabledTools: () => [{ name: 'read_file' }, { name: 'write_file' }],
      }),
    } as Partial<Config>);

    await adapter.executeSubagent({
      name: 'helper',
      prompt: 'Do work',
      toolWhitelist: ['read_file'],
      hasExplicitToolWhitelist: true,
    });

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: unknown }
      | undefined;
    expect(launchRequest).toBeDefined();
    expect(launchRequest).toHaveProperty('toolConfig');
    expect(launchRequest?.toolConfig).toStrictEqual({ tools: [] });
  });

  it('filters explicit whitelist to zero when config ephemerals have tools.allowed=[] (Issue #2069)', async () => {
    const { adapter, launch } = createAdapterWithLaunch({
      getEphemeralSettings: () => ({ 'tools.allowed': [] }),
      getExcludeTools: () => [],
      getToolRegistry: () => ({
        getEnabledTools: () => [{ name: 'read_file' }, { name: 'write_file' }],
      }),
    } as Partial<Config>);

    await adapter.executeSubagent({
      name: 'helper',
      prompt: 'Do work',
      toolWhitelist: ['read_file', 'write_file'],
      hasExplicitToolWhitelist: true,
    });

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: unknown }
      | undefined;
    expect(launchRequest).toBeDefined();
    // Explicit empty tools.allowed in config means "block all normal tools"
    // (fail-closed), so even an explicit non-empty request whitelist filters to
    // zero → toolConfig { tools: [] }.
    expect(launchRequest).toHaveProperty('toolConfig');
    expect(launchRequest?.toolConfig).toStrictEqual({ tools: [] });
  });

  it('omits toolConfig when no explicit whitelist and registry unavailable', async () => {
    const { adapter, launch } = createAdapterWithLaunch();

    await adapter.executeSubagent({
      name: 'helper',
      prompt: 'Do work',
    });

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: unknown }
      | undefined;
    expect(launchRequest).toBeDefined();
    expect(launchRequest).not.toHaveProperty('toolConfig');
  });

  it('omits toolConfig when no explicit whitelist but registry available (Issue #2069)', async () => {
    const { adapter, launch } = createAdapterWithLaunch({
      getEphemeralSettings: () => ({}),
      getExcludeTools: () => [],
      getToolRegistry: () => ({
        getEnabledTools: () => [
          { name: 'read_file' },
          { name: 'write_file' },
          { name: 'task' },
          { name: 'list_subagents' },
        ],
      }),
    } as Partial<Config>);

    await adapter.executeSubagent({
      name: 'helper',
      prompt: 'Do work',
      // No toolWhitelist and no hasExplicitToolWhitelist → runtime defaults.
    });

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: unknown }
      | undefined;
    expect(launchRequest).toBeDefined();
    // No explicit whitelist must NOT synthesize toolConfig from the parent
    // registry. toolConfig omitted → runtime/profile defaults apply.
    expect(launchRequest).not.toHaveProperty('toolConfig');
  });

  it('resolves API-qualified explicit whitelist entries through the registry (Issue #2184)', async () => {
    const { adapter, launch } = createAdapterWithLaunch({
      getEphemeralSettings: () => ({}),
      getExcludeTools: () => [],
      getToolRegistry: () => ({
        getEnabledTools: () => [
          { name: 'run_shell_command' },
          { name: 'read_file' },
          { name: 'tool.v1' },
        ],
      }),
    } as Partial<Config>);

    await adapter.executeSubagent({
      name: 'helper',
      prompt: 'Do work',
      toolWhitelist: [
        'functions.run_shell_command',
        'api.v1.read_file',
        'functions.tool.v1',
      ],
      hasExplicitToolWhitelist: true,
    });

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: { tools?: string[] } }
      | undefined;
    expect(launchRequest).toBeDefined();
    expect(launchRequest).toHaveProperty('toolConfig');
    expect(launchRequest?.toolConfig?.tools).toStrictEqual([
      'run_shell_command',
      'read_file',
      'tool.v1',
    ]);
  });

  it('does not treat GitHub namespaces as API aliases for registry tools', async () => {
    const { adapter, launch } = createAdapterWithLaunch({
      getEphemeralSettings: () => ({}),
      getExcludeTools: () => [],
      getToolRegistry: () => ({
        getEnabledTools: () => [
          { name: 'repo' },
          { name: 'read_file' },
          { name: 'repo.read_file' },
        ],
      }),
    } as Partial<Config>);

    await adapter.executeSubagent({
      name: 'helper',
      prompt: 'Do work',
      toolWhitelist: [
        'github.repo',
        'github.read_file',
        'github.repo.read_file',
      ],
      hasExplicitToolWhitelist: true,
    });

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: { tools?: string[] } }
      | undefined;
    expect(launchRequest).toBeDefined();
    expect(launchRequest).toHaveProperty('toolConfig');
    expect(launchRequest?.toolConfig?.tools).toStrictEqual([]);
  });

  it('drops unresolved API-qualified whitelist entries when registry validation is available', async () => {
    const { adapter, launch } = createAdapterWithLaunch({
      getEphemeralSettings: () => ({}),
      getExcludeTools: () => [],
      getToolRegistry: () => ({
        getEnabledTools: () => [{ name: 'read_file' }],
      }),
    } as Partial<Config>);

    await adapter.executeSubagent({
      name: 'helper',
      prompt: 'Do work',
      toolWhitelist: ['functions.read_file', 'functions.nonexistent_tool'],
      hasExplicitToolWhitelist: true,
    });

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: { tools?: string[] } }
      | undefined;
    expect(launchRequest).toBeDefined();
    expect(launchRequest).toHaveProperty('toolConfig');
    expect(launchRequest?.toolConfig?.tools).toStrictEqual(['read_file']);
  });

  it('honors qualified disabled entries before resolving registry aliases', async () => {
    const { adapter, launch } = createAdapterWithLaunch({
      getEphemeralSettings: () => ({
        'tools.disabled': ['functions.read_file'],
      }),
      getExcludeTools: () => [],
      getToolRegistry: () => ({
        getEnabledTools: () => [{ name: 'read_file' }],
      }),
    } as Partial<Config>);

    await adapter.executeSubagent({
      name: 'helper',
      prompt: 'Do work',
      toolWhitelist: ['functions.read_file'],
      hasExplicitToolWhitelist: true,
    });

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: { tools?: string[] } }
      | undefined;
    expect(launchRequest).toBeDefined();
    expect(launchRequest).toHaveProperty('toolConfig');
    expect(launchRequest?.toolConfig?.tools).toStrictEqual([]);
  });

  it('honors versioned API entries in config allowlists', async () => {
    const { adapter, launch } = createAdapterWithLaunch({
      getEphemeralSettings: () => ({
        'tools.allowed': ['api.v1.read_file'],
      }),
      getExcludeTools: () => [],
      getToolRegistry: () => ({
        getEnabledTools: () => [{ name: 'read_file' }],
      }),
    } as Partial<Config>);

    await adapter.executeSubagent({
      name: 'helper',
      prompt: 'Do work',
      toolWhitelist: ['functions.read_file'],
      hasExplicitToolWhitelist: true,
    });

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: { tools?: string[] } }
      | undefined;
    expect(launchRequest).toBeDefined();
    expect(launchRequest?.toolConfig?.tools).toStrictEqual(['read_file']);
  });

  it('filters task/list_subagents from explicit whitelist when registry is unavailable (Issue #2069)', async () => {
    // No getToolRegistry on config — simulates registry unavailable
    const { adapter, launch } = createAdapterWithLaunch({});

    await adapter.executeSubagent({
      name: 'helper',
      prompt: 'Do work',
      toolWhitelist: ['read_file', 'task', 'list_subagents'],
      hasExplicitToolWhitelist: true,
    });

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: { tools?: string[] } }
      | undefined;
    expect(launchRequest).toBeDefined();
    expect(launchRequest).toHaveProperty('toolConfig');
    // task/list_subagents must be removed even without a registry;
    // read_file is preserved (no-registry explicit whitelist semantics).
    expect(launchRequest?.toolConfig?.tools).toStrictEqual(['read_file']);
  });

  it('preserves fail-closed toolConfig { tools: [] } when explicit whitelist only contains task/list_subagents and registry unavailable (Issue #2069)', async () => {
    const { adapter, launch } = createAdapterWithLaunch({});

    await adapter.executeSubagent({
      name: 'helper',
      prompt: 'Do work',
      toolWhitelist: ['task', 'list_subagents'],
      hasExplicitToolWhitelist: true,
    });

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: { tools?: string[] } }
      | undefined;
    expect(launchRequest).toBeDefined();
    expect(launchRequest).toHaveProperty('toolConfig');
    expect(launchRequest?.toolConfig?.tools).toStrictEqual([]);
  });
});

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

describe('CoreSubagentServiceAdapter inferred explicit whitelist (Issue #2069 direct callers)', () => {
  it('treats toolWhitelist: [] without hasExplicitToolWhitelist as explicit and fail-closed', async () => {
    const { adapter, launch } = createAdapterWithLaunch();

    await adapter.executeSubagent({
      name: 'helper',
      prompt: 'Do work',
      // Direct ISubagentService caller: toolWhitelist present but flag omitted.
      toolWhitelist: [],
    });

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: unknown }
      | undefined;
    expect(launchRequest).toBeDefined();
    expect(launchRequest).toHaveProperty('toolConfig');
    expect(launchRequest?.toolConfig).toStrictEqual({ tools: [] });
  });

  it('treats toolWhitelist with only excluded tools and no flag as explicit and fail-closed', async () => {
    const { adapter, launch } = createAdapterWithLaunch({});

    await adapter.executeSubagent({
      name: 'helper',
      prompt: 'Do work',
      toolWhitelist: ['task', 'list_subagents'],
    });

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: { tools?: string[] } }
      | undefined;
    expect(launchRequest).toBeDefined();
    expect(launchRequest).toHaveProperty('toolConfig');
    expect(launchRequest?.toolConfig?.tools).toStrictEqual([]);
  });

  it('treats toolWhitelist: ["read_file"] without flag as explicit and preserves it after excluded filtering (no registry)', async () => {
    const { adapter, launch } = createAdapterWithLaunch({});

    await adapter.executeSubagent({
      name: 'helper',
      prompt: 'Do work',
      toolWhitelist: ['read_file'],
    });

    const launchRequest = launch.mock.calls[0]?.[0] as
      | { toolConfig?: { tools?: string[] } }
      | undefined;
    expect(launchRequest).toBeDefined();
    expect(launchRequest).toHaveProperty('toolConfig');
    expect(launchRequest?.toolConfig?.tools).toStrictEqual(['read_file']);
  });
});
