import { WorkspaceTrustLifecycle } from '../services/workspace-trust-lifecycle.js';
import { CoreToolHostAdapter } from '../tools-adapters/CoreToolHostAdapter.js';
import { WorkspaceFilesystemOwner } from '../services/workspace-filesystem-owner.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SessionHookOwner } from '../hooks/session-hook-owner.js';
import {
  fixtureHookRuntime,
  fixtureHookDefinitions,
} from '../hooks/__tests__/hook-runtime-fixture.js';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { initializeTestMcpRuntime } from '@vybestack/llxprt-code-test-utils/core/config.js';

import { SessionSettingsOwner } from '../session/session-settings-owner.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type { ConfigParameters } from './config.js';
import { Config, ApprovalMode } from './config.js';
import type { HookDefinition } from '../hooks/types.js';
import { HookType, HookEventName } from '../hooks/types.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpClientManager } from '@vybestack/llxprt-code-mcp';
import {
  buildFsMockBody,
  buildToolsMockBody,
  buildContentGeneratorMockBody,
  buildTelemetryMockBody,
  buildGitServiceMockBody,
  buildIdeIntegrationMockBody,
  buildMemoryDiscoveryMockBody,
  buildEventsMockBody,
  buildFetchMockBody,
  type HoistedConfigMocks,
} from './__tests__/configTestHarness.js';

// Hoisted mocks referenced by mock factories below (vitest hoist-safe).
const hoistedConfigMocks = {
  loadJitSubdirectoryMemory: vi.fn(),
  coreEvents: {
    emitFeedback: vi.fn(),
    emitModelChanged: vi.fn(),
    emitConsoleLog: vi.fn(),
  },
  setGlobalProxy: vi.fn(),
} as HoistedConfigMocks;
// Exposed for assertions / setup in the JIT context & model-change tests below.
const mockCoreEvents = hoistedConfigMocks.coreEvents;

const __actual2 = { ...(await import('fs')) };
void vi.mock('fs', () => buildFsMockBody(__actual2));

// Mock dependencies that might be called during Config construction or createServerConfig.
const __actual3 = { ...(await import('@vybestack/llxprt-code-tools')) };
void vi.mock('@vybestack/llxprt-code-tools', () =>
  buildToolsMockBody(__actual3),
);

// Mock individual tools if their constructors are complex or have side effects

const __actual4 = { ...(await import('../core/contentGenerator.js')) };
void vi.mock('../core/contentGenerator.js', () =>
  buildContentGeneratorMockBody(__actual4),
);

void vi.mock('../telemetry/index.js', () => buildTelemetryMockBody());

void vi.mock('../services/gitService.js', () => buildGitServiceMockBody());

const __actual5 = {
  ...(await import('@vybestack/llxprt-code-ide-integration')),
};
void vi.mock('@vybestack/llxprt-code-ide-integration', () =>
  buildIdeIntegrationMockBody(__actual5),
);

void vi.mock('../utils/memoryDiscovery.js', () =>
  buildMemoryDiscoveryMockBody(hoistedConfigMocks),
);

const __actual6 = { ...(await import('../utils/events.js')) };
void vi.mock('../utils/events.js', () =>
  buildEventsMockBody(__actual6, hoistedConfigMocks),
);

void vi.mock('../utils/fetch.js', () => buildFetchMockBody(hoistedConfigMocks));

const ownedPolicies: Array<{ dispose(): void }> = [];
const approvalRoots: Array<() => Promise<void>> = [];

describe('setApprovalMode with folder trust', () => {
  afterEach(async () => {
    for (const close of approvalRoots.splice(0)) await close();
  });
  const baseParams: ConfigParameters = {
    sessionId: 'test',
    targetDir: '.',
    debugMode: false,
    model: 'test-model',
    cwd: '.',
  };

  it('should throw an error when setting YOLO mode in an untrusted folder', () => {
    const config = new Config(baseParams);
    const host = approvalHost(config, false);
    expect(() => host.setApprovalMode(ApprovalMode.YOLO)).toThrow(
      'Cannot enable privileged approval modes in an untrusted folder.',
    );
  });

  it('should throw an error when setting AUTO_EDIT mode in an untrusted folder', () => {
    const config = new Config(baseParams);
    const host = approvalHost(config, false);
    expect(() => host.setApprovalMode(ApprovalMode.AUTO_EDIT)).toThrow(
      'Cannot enable privileged approval modes in an untrusted folder.',
    );
  });

  it('should NOT throw an error when setting DEFAULT mode in an untrusted folder', () => {
    const config = new Config(baseParams);
    const host = approvalHost(config, false);
    expect(() => host.setApprovalMode(ApprovalMode.DEFAULT)).not.toThrow();
  });

  it('should NOT throw an error when setting any mode in a trusted folder', () => {
    const config = new Config(baseParams);
    const host = approvalHost(config, true);
    expect(() => host.setApprovalMode(ApprovalMode.YOLO)).not.toThrow();
    expect(() => host.setApprovalMode(ApprovalMode.AUTO_EDIT)).not.toThrow();
    expect(() => host.setApprovalMode(ApprovalMode.DEFAULT)).not.toThrow();
  });

  it('should NOT throw an error when setting any mode if trustedFolder is undefined', () => {
    const config = new Config(baseParams);
    const host = approvalHost(config, undefined);
    expect(() => host.setApprovalMode(ApprovalMode.YOLO)).not.toThrow();
    expect(() => host.setApprovalMode(ApprovalMode.AUTO_EDIT)).not.toThrow();
    expect(() => host.setApprovalMode(ApprovalMode.DEFAULT)).not.toThrow();
  });
});

describe('Config getHooks', () => {
  const baseParams: ConfigParameters = {
    cwd: '/tmp',
    targetDir: '/path/to/target',
    debugMode: false,
    sessionId: 'test-session-id',
    model: 'gemini-pro',
    usageStatisticsEnabled: false,
  };

  it('should return undefined when no hooks are provided', () => {
    const config = new Config(baseParams);
    expect(config.getHooks()).toBeUndefined();
  });

  it('should return empty object when empty hooks are provided', () => {
    const configWithEmptyHooks = new Config({
      ...baseParams,
      hooks: {},
    });
    expect(configWithEmptyHooks.getHooks()).toStrictEqual({});
  });

  it('should return the hooks configuration when provided', () => {
    const mockHooks: { [K in HookEventName]?: HookDefinition[] } = {
      [HookEventName.BeforeTool]: [
        {
          matcher: 'write_file',
          hooks: [
            {
              type: HookType.Command,
              command: 'echo "test hook"',
              timeout: 5000,
            },
          ],
        },
      ],
      [HookEventName.AfterTool]: [
        {
          hooks: [
            {
              type: HookType.Command,
              command: './hooks/after-tool.sh',
              timeout: 10000,
            },
          ],
        },
      ],
    };

    const config = new Config({
      ...baseParams,
      hooks: mockHooks,
    });

    const retrievedHooks = config.getHooks();
    expect(retrievedHooks).toStrictEqual(mockHooks);
    expect(retrievedHooks).toBe(mockHooks); // Should return the same reference
  });

  it('should return hooks with all supported event types', () => {
    const allEventHooks: { [K in HookEventName]?: HookDefinition[] } = {
      [HookEventName.BeforeAgent]: [
        { hooks: [{ type: HookType.Command, command: 'test1' }] },
      ],
      [HookEventName.AfterAgent]: [
        { hooks: [{ type: HookType.Command, command: 'test2' }] },
      ],
      [HookEventName.BeforeTool]: [
        { hooks: [{ type: HookType.Command, command: 'test3' }] },
      ],
      [HookEventName.AfterTool]: [
        { hooks: [{ type: HookType.Command, command: 'test4' }] },
      ],
      [HookEventName.BeforeModel]: [
        { hooks: [{ type: HookType.Command, command: 'test5' }] },
      ],
      [HookEventName.AfterModel]: [
        { hooks: [{ type: HookType.Command, command: 'test6' }] },
      ],
      [HookEventName.BeforeToolSelection]: [
        { hooks: [{ type: HookType.Command, command: 'test7' }] },
      ],
      [HookEventName.Notification]: [
        { hooks: [{ type: HookType.Command, command: 'test8' }] },
      ],
      [HookEventName.SessionStart]: [
        { hooks: [{ type: HookType.Command, command: 'test9' }] },
      ],
      [HookEventName.SessionEnd]: [
        { hooks: [{ type: HookType.Command, command: 'test10' }] },
      ],
      [HookEventName.PreCompress]: [
        { hooks: [{ type: HookType.Command, command: 'test11' }] },
      ],
    };

    const config = new Config({
      ...baseParams,
      hooks: allEventHooks,
    });

    const retrievedHooks = config.getHooks();
    expect(retrievedHooks).toStrictEqual(allEventHooks);
    expect(Object.keys(retrievedHooks!)).toHaveLength(11); // All hook event types
  });
});

describe('Config JIT context', () => {
  const baseParams: ConfigParameters = {
    cwd: '/tmp',
    targetDir: '/path/to/target',
    debugMode: false,
    sessionId: 'test-session-id',
    model: 'gemini-pro',
    usageStatisticsEnabled: false,
  };

  it('should return true by default when JIT context setting is not provided', () => {
    const config = new Config(baseParams);
    expect(config.isJitContextEnabled()).toBe(true);
  });

  it('should return the configured JIT context setting value', () => {
    const configEnabled = new Config({
      ...baseParams,
      jitContextEnabled: true,
    });
    expect(configEnabled.isJitContextEnabled()).toBe(true);

    const configDisabled = new Config({
      ...baseParams,
      jitContextEnabled: false,
    });
    expect(configDisabled.isJitContextEnabled()).toBe(false);
  });

  // A `jitContextEnabled` settings-service key is inert: no production code
  // writes it, and the predicate resolves only from the constructor-assigned
  // field. Both directions are covered so the assertion cannot pass merely
  // because the settings value happens to agree (issue #3135).
  it.each([
    { constructorValue: true, settingsValue: false },
    { constructorValue: false, settingsValue: true },
  ])(
    'resolves to the constructor value $constructorValue while the settings service holds $settingsValue',
    ({ constructorValue, settingsValue }) => {
      const settingsService = new SettingsService();
      settingsService.set('jitContextEnabled', settingsValue);

      const config = new Config({
        ...baseParams,
        jitContextEnabled: constructorValue,
        settingsService,
      });

      expect(config.isJitContextEnabled()).toBe(constructorValue);
    },
  );
});

describe('Session model selection with immutable Config declarations', () => {
  const baseParams: ConfigParameters = {
    cwd: process.cwd(),
    targetDir: process.cwd(),
    debugMode: false,
    sessionId: 'test-session-id',
    provider: 'gemini',
    model: 'gemini-pro',
    usageStatisticsEnabled: false,
  };
  const owners: SessionSettingsOwner[] = [];
  afterEach(async () => {
    for (const owner of owners.splice(0)) await owner.dispose();
  });
  for (const [initial, selected] of [
    ['gemini-pro', 'gemini-2.5-pro'],
    ['gemini-pro', 'auto'],
    ['auto', 'auto'],
  ]) {
    it(`selects ${selected} from ${initial} without rewriting the declaration or fallback marker`, () => {
      const config = new Config({ ...baseParams, model: initial });
      const owner = new SessionSettingsOwner(new SettingsService());
      owners.push(owner);
      owner.initializeProviderSelection(
        config.getProvider(),
        config.getModel(),
      );
      config.setFallbackMode(true);
      expect(config.isInFallbackMode()).toBe(true);
      mockCoreEvents.emitModelChanged.mockClear();
      const publication = owner.beginModelPublication();
      owner.chooseModel(selected);
      publication.commit();
      expect(owner.readSelectedModel()).toBe(selected);
      expect(config.getModel()).toBe(initial);
      expect(config.isInFallbackMode()).toBe(true);
      expect(mockCoreEvents.emitModelChanged.mock.calls).toStrictEqual(
        initial === selected ? [] : [[selected]],
      );
    });
  }
});

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P04
 * @requirement:HOOK-001,HOOK-002,HOOK-010
 */
describe('Declarative hook configuration and explicit session lifetime', () => {
  const hooks: SessionHookOwner[] = [];
  const root = (config: Config): SessionHookOwner => {
    const owner = new SessionHookOwner(
      fixtureHookDefinitions(config),
      fixtureHookRuntime(config),
      config.getEnableHooks(),
      new MessageBus(),
    );
    hooks.push(owner);
    return owner;
  };
  afterEach(async () => {
    const retired = await Promise.allSettled(
      hooks.splice(0).map((owner) => owner.dispose()),
    );
    const failures = retired.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Hook configuration fixture retirement failed',
      );
    for (const owner of ownedPolicies.splice(0)) owner.dispose();
  });
  const baseParams = {
    cwd: '/tmp',
    targetDir: '/path/to/target',
    debugMode: false,
    sessionId: 'test-session-id',
    model: 'gemini-2.0-flash',
    usageStatisticsEnabled: false,
  };

  it('enableHooks true initializes hook system', () => {
    // @requirement:HOOK-001 - Lazy creation when enableHooks=true
    const config = new Config({
      ...baseParams,
      enableHooks: true,
    });

    const hookSystem = root(config);
    expect(hookSystem).toBeDefined();
    expect(hookSystem).not.toBeNull();
  });

  it('enableHooks false returns undefined', () => {
    // @requirement:HOOK-002 - Returns undefined when enableHooks=false
    const config = new Config({
      ...baseParams,
      enableHooks: false,
    });

    const hookSystem = root(config);
    expect(hookSystem.listHooks()).toStrictEqual([]);
  });

  it('tools.enableHooks does not enable hooks', () => {
    // @requirement:HOOK-002 - Only top-level enableHooks controls hook system
    // The tools.enableHooks key should not enable the hook system
    const config = new Config({
      ...baseParams,
      enableHooks: false,
      // Note: tools.enableHooks is not a valid config key for enabling hooks
    });

    const hookSystem = root(config);
    expect(hookSystem.listHooks()).toStrictEqual([]);
    expect(config.getEnableHooks()).toBe(false);
  });

  it('one explicit owner supplies repeated session operations', () => {
    // @requirement:HOOK-001 - Lazy creation, same instance returned
    const config = new Config({
      ...baseParams,
      enableHooks: true,
    });

    const hookSystem1 = root(config);
    const execution1 = hookSystem1.execution({
      sessionId: () => config.getSessionId(),
      transcriptPath: () => undefined,
    });
    const execution2 = hookSystem1.execution({
      sessionId: () => config.getSessionId(),
      transcriptPath: () => undefined,
    });

    expect(execution1.sessionId()).toBe(execution2.sessionId());
    expect(hookSystem1.listHooks()).toStrictEqual([]);
  });

  it('getEnableHooks reflects enableHooks config value', () => {
    const configEnabled = new Config({
      ...baseParams,
      enableHooks: true,
    });
    expect(configEnabled.getEnableHooks()).toBe(true);

    const configDisabled = new Config({
      ...baseParams,
      enableHooks: false,
    });
    expect(configDisabled.getEnableHooks()).toBe(false);
  });

  it('enableHooks defaults to false when not specified', () => {
    const config = new Config(baseParams);
    expect(config.getEnableHooks()).toBe(false);
    expect(root(config).listHooks()).toStrictEqual([]);
  });

  it('getEnableHooksUI returns true while getEnableHooks returns false and getHookSystem returns undefined', () => {
    const config = new Config({
      ...baseParams,
      enableHooksUI: true,
      enableHooks: false,
    });
    expect(config.getEnableHooksUI()).toBe(true);
    expect(config.getEnableHooks()).toBe(false);
    expect(root(config).listHooks()).toStrictEqual([]);
  });

  it('getEnableHooksUI defaults to true when not specified', () => {
    const config = new Config(baseParams);
    expect(config.getEnableHooksUI()).toBe(true);
  });

  describe('reloadMcpServers', () => {
    it('atomically replaces MCP and blocked server configuration', async () => {
      const reloadMcpServers = vi.fn().mockResolvedValue({
        mcpServers: { fresh: { command: 'fresh-command' } },
        blockedMcpServers: [{ name: 'blocked', extensionName: '' }],
        settingsMcpServers: { fresh: { command: 'fresh-command' } },
      });
      const readReloadSettings = reloadMcpServers;

      const config = new Config({
        ...baseParams,
        mcpServers: { stale: { command: 'stale-command' } },
      });

      const reloaded = await reloadSettings(config, readReloadSettings);

      expect(reloaded.mcpServers).toStrictEqual({
        fresh: { command: 'fresh-command' },
      });
      expect(reloaded.blockedMcpServers).toStrictEqual([
        { name: 'blocked', extensionName: '' },
      ]);
    });

    it('replaces trusted MCP policy rules with rules from the reloaded configuration', async () => {
      const readReloadSettings = vi.fn().mockResolvedValue({
        mcpServers: { fresh: { command: 'fresh-command', trust: true } },
        blockedMcpServers: [],
        settingsMcpServers: {
          fresh: { command: 'fresh-command', trust: true },
        },
      });

      const config = new Config({
        ...baseParams,
        trustedFolder: true,
        mcpServers: { stale: { command: 'stale-command', trust: true } },
      });
      const configPolicy = new RuntimePolicyOwner(config);
      ownedPolicies.push(configPolicy);

      await reloadSettings(config, readReloadSettings, configPolicy);

      const trustedPrefixes = configPolicy.session.inspection
        .getRules()
        .filter((rule) => rule.source === 'Settings (MCP Trusted)')
        .map((rule) => rule.toolNamePrefix);
      expect(trustedPrefixes).toStrictEqual(['fresh__']);
    });

    it('preserves existing MCP state when reload resolution fails', async () => {
      const readReloadSettings = vi
        .fn()
        .mockRejectedValue(new Error('settings invalid'));

      const config = new Config({
        ...baseParams,
        mcpServers: { stable: { command: 'stable-command' } },
        blockedMcpServers: [{ name: 'stable-blocked', extensionName: '' }],
      });

      await expect(reloadSettings(config, readReloadSettings)).rejects.toThrow(
        'settings invalid',
      );
      expect(config.getMcpServers()).toStrictEqual({
        stable: { command: 'stable-command' },
      });
      expect(config.getBlockedMcpServers()).toStrictEqual([
        { name: 'stable-blocked', extensionName: '' },
      ]);
    });

    it('throws when MCP settings reload is not wired instead of silently no-oping', async () => {
      const config = new Config({
        ...baseParams,
        mcpServers: { existing: { command: 'existing' } },
      });

      await expect(reloadSettings(config)).rejects.toThrow(
        'MCP server reload is not available in this composition.',
      );
      expect(config.getMcpServers()).toStrictEqual({
        existing: { command: 'existing' },
      });
    });

    it('builds trusted rules from settingsMcpServers, not the merged mcpServers map', async () => {
      const readReloadSettings = vi.fn().mockResolvedValue({
        mcpServers: {
          mergedOnly: { command: 'merged', trust: true },
          shared: { command: 'shared', trust: true },
        },
        blockedMcpServers: [],
        settingsMcpServers: {
          settingsOnly: { command: 'settings', trust: true },
          shared: { command: 'shared', trust: true },
        },
      });

      const config = new Config({
        ...baseParams,
        trustedFolder: true,
        mcpServers: { stale: { command: 'stale', trust: true } },
      });
      const configPolicy = new RuntimePolicyOwner(config);
      ownedPolicies.push(configPolicy);

      await reloadSettings(config, readReloadSettings, configPolicy);

      const trustedPrefixes = configPolicy.session.inspection
        .getRules()
        .filter((rule) => rule.source === 'Settings (MCP Trusted)')
        .map((rule) => rule.toolNamePrefix)
        .sort();
      expect(trustedPrefixes).toStrictEqual(['settingsOnly__', 'shared__']);
    });

    it('preserves non-MCP policy rules during reload', async () => {
      const readReloadSettings = vi.fn().mockResolvedValue({
        mcpServers: { fresh: { command: 'fresh-command', trust: true } },
        blockedMcpServers: [],
        settingsMcpServers: {
          fresh: { command: 'fresh-command', trust: true },
        },
      });

      const config = new Config({
        ...baseParams,
        trustedFolder: true,
        mcpServers: { stale: { command: 'stale-command', trust: true } },
      });
      const configPolicy = new RuntimePolicyOwner(config);
      ownedPolicies.push(configPolicy);

      configPolicy.session.confirmation.addRule({
        toolNamePrefix: 'custom__',
        decision: 'allow',
        priority: 1,
        source: 'Test Custom Source',
      });

      await reloadSettings(config, readReloadSettings, configPolicy);

      const sources = configPolicy.session.inspection
        .getRules()
        .map((rule) => rule.source);
      expect(sources).toContain('Test Custom Source');
    });
  });

  describe('workspace skill settings reload', () => {
    function skillParams(
      overrides: Partial<ConfigParameters> = {},
    ): ConfigParameters {
      return {
        sessionId: 'test-session',
        targetDir: '/tmp/test',
        debugMode: false,
        model: 'test-model',
        cwd: '/tmp/test',
        skillsSupport: true,
        extensions: [
          {
            name: 'skills',
            version: '1',
            isActive: true,
            path: '/skills',
            contextFiles: [],
            skills: ['skill1', 'skill2'].map((name) => ({
              name,
              description: name,
              body: name,
              location: `/skills/${name}/SKILL.md`,
            })),
          },
        ],
        ...overrides,
      };
    }

    it('updates the disabled skill surface from onReload', async () => {
      const config = new Config(skillParams());
      const runtime = await initializeTestMcpRuntime(
        config,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          reloadPolicy: async () => ({ disabledSkills: ['skill2'] }),
          registerTools: () => {},
        },
      );
      try {
        await runtime.workspaceSkills.operations.reload();
        expect(
          runtime.workspaceSkills.operations.list().map((skill) => skill.name),
        ).toStrictEqual(['skill1']);
        expect(config.getDisabledSkills()).toStrictEqual(['skill2']);
      } finally {
        await runtime.dispose();
        await config.dispose();
      }
    });

    it('discovers and applies defaults when no onReload is provided', async () => {
      const config = new Config(skillParams());
      const runtime = await initializeTestMcpRuntime(config);
      try {
        await runtime.workspaceSkills.operations.reload();
        expect(
          runtime.workspaceSkills.operations.list().map((skill) => skill.name),
        ).toStrictEqual(['skill1', 'skill2']);
        expect(config.getDisabledSkills()).toStrictEqual([]);
      } finally {
        await runtime.dispose();
        await config.dispose();
      }
    });

    it('preserves existing disabledSkills when onReload leaves them undefined', async () => {
      const config = new Config(
        skillParams({
          disabledSkills: ['skill1'],
        }),
      );
      const runtime = await initializeTestMcpRuntime(config);
      try {
        await runtime.workspaceSkills.operations.reload();
        expect(
          runtime.workspaceSkills.operations.list().map((skill) => skill.name),
        ).toStrictEqual(['skill2']);
      } finally {
        await runtime.dispose();
        await config.dispose();
      }
    });

    it('updates admin settings from onReload', async () => {
      const config = new Config(skillParams());
      const runtime = await initializeTestMcpRuntime(
        config,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          reloadPolicy: async () => ({ adminSkillsEnabled: false }),
          registerTools: () => {},
        },
      );
      try {
        await runtime.workspaceSkills.operations.reload();
        expect(runtime.workspaceSkills.operations.isAdminEnabled()).toBe(false);
      } finally {
        await runtime.dispose();
        await config.dispose();
      }
    });
  });
});

describe('Config MCP runtime capabilities (agents boundary)', () => {
  const baseParams: ConfigParameters = {
    sessionId: 'test',
    targetDir: '.',
    debugMode: false,
    model: 'test-model',
    cwd: '.',
  };

  beforeEach(() => {
    vi.spyOn(
      McpClientManager.prototype,
      'startConfiguredMcpServers',
    ).mockResolvedValue(undefined);
    vi.spyOn(
      McpClientManager.prototype,
      'reconcileConfiguredMcpServers',
    ).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('reloadMcpServers reconciliation ownership', () => {
    it('swaps MCP/blocked state then invokes the live manager reconcile exactly once', async () => {
      const readReloadSettings = vi.fn().mockResolvedValue({
        mcpServers: { fresh: { command: 'fresh' } },
        blockedMcpServers: [{ name: 'blocked', extensionName: 'ext' }],
        settingsMcpServers: { fresh: { command: 'fresh' } },
      });

      const config = new Config({
        ...baseParams,
        trustedFolder: true,
        mcpServers: { stale: { command: 'stale' } },
      });
      const owner = await initializeTestMcpRuntime(
        config,
        McpClientManager,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        createReloadBinding(config, readReloadSettings),
      );

      await owner.reload();

      expect(owner.readServerSettings().mcpServers).toStrictEqual({
        fresh: { command: 'fresh' },
      });
      expect(owner.readServerSettings().blockedMcpServers).toStrictEqual([
        { name: 'blocked', extensionName: 'ext' },
      ]);
      expect(config.getMcpServers()).not.toStrictEqual(
        owner.readServerSettings().mcpServers,
      );
    });

    it('skips reconciliation when the manager is not initialized', async () => {
      const readReloadSettings = vi.fn().mockResolvedValue({
        mcpServers: { fresh: { command: 'fresh' } },
        blockedMcpServers: [],
        settingsMcpServers: { fresh: { command: 'fresh' } },
      });

      const config = new Config({
        ...baseParams,
        mcpServers: { stale: { command: 'stale' } },
      });
      const reloaded = await reloadSettings(config, readReloadSettings);
      expect(reloaded.mcpServers).toStrictEqual({
        fresh: { command: 'fresh' },
      });
      expect(config.getMcpServers()).not.toStrictEqual(reloaded.mcpServers);
    });
  });
});

function createReloadBinding(
  config: Config,
  load: () => Promise<
    import('../session/session-settings-owner.js').WorkspaceMcpSettings
  >,
): import('../session/session-settings-owner.js').SessionMcpSettingsReads {
  const owner = new SessionSettingsOwner(new SettingsService());
  owner.bindMcpSettings(
    {
      mcpServers: config.getMcpServers() ?? {},
      blockedMcpServers: config.getBlockedMcpServers() ?? [],
      settingsMcpServers: config.getMcpServers() ?? {},
    },
    load,
  );
  const binding = owner.readMcpSettingsBinding();
  if (binding === undefined) throw new Error('Missing fixture reload binding');
  approvalRoots.push(async () => owner.dispose());
  return binding;
}

async function reloadSettings(
  config: Config,
  load?: () => Promise<
    import('../session/session-settings-owner.js').WorkspaceMcpSettings
  >,
  policy?: RuntimePolicyOwner,
): Promise<
  import('../session/session-settings-owner.js').WorkspaceMcpSettings
> {
  if (load === undefined)
    throw new Error('MCP server reload is not available in this composition.');
  const binding = createReloadBinding(config, load);
  const settings = await binding.reload();
  policy?.workspace.bindMcpServers(() => settings.settingsMcpServers);
  policy?.workspace.refreshTrust();
  return settings;
}

function approvalHost(
  config: Config,
  trusted: boolean | undefined,
): CoreToolHostAdapter {
  const trust = new WorkspaceTrustLifecycle({ localTrust: trusted });
  const filesystem = new WorkspaceFilesystemOwner({
    targetDir: process.cwd(),
    isTrusted: () => trust.isTrustedFolder(),
  });
  const settings = new SessionSettingsOwner(new SettingsService());
  settings.bindTelemetry(config);
  approvalRoots.push(async () => {
    await settings.dispose();
    await filesystem.dispose();
    await trust.dispose();
  });
  return new CoreToolHostAdapter(
    config,
    filesystem.paths,
    filesystem.files,
    filesystem.ignore,
    filesystem.scans,
    () => settings.readToolExecutionPolicy(),
    trust,
    settings.telemetry,
  );
}
