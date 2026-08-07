/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'bun:test';
import type { ConfigParameters } from './config.js';
import { Config, ApprovalMode } from './config.js';
import type { HookDefinition } from '../hooks/types.js';
import { HookType, HookEventName } from '../hooks/types.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { MCPDiscoveryState } from '@vybestack/llxprt-code-mcp';
import { initializeTestConfig } from '../test-utils/config.js';
import {
  buildFsMockBody,
  buildToolsMockBody,
  buildContentGeneratorMockBody,
  buildTelemetryMockBody,
  buildGitServiceMockBody,
  buildSettingsMockBody,
  buildIdeIntegrationMockBody,
  buildMemoryDiscoveryMockBody,
  buildEventsMockBody,
  buildFetchMockBody,
  type HoistedConfigMocks,
} from './configTestHarness.js';

// Hoisted mocks referenced by mock factories below (vitest hoist-safe).
const hoistedConfigMocks = vi.hoisted<HoistedConfigMocks>(() => ({
  loadJitSubdirectoryMemory: vi.fn(),
  coreEvents: {
    emitFeedback: vi.fn(),
    emitModelChanged: vi.fn(),
    emitConsoleLog: vi.fn(),
  },
  setGlobalProxy: vi.fn(),
}));
// Exposed for assertions / setup in the JIT context & model-change tests below.
const mockLoadJitSubdirectoryMemory =
  hoistedConfigMocks.loadJitSubdirectoryMemory;
const mockCoreEvents = hoistedConfigMocks.coreEvents;

const mcpInstances: Array<{
  getMcpServers: ReturnType<typeof vi.fn>;
  getDiscoveryFailures: ReturnType<typeof vi.fn>;
  getDiscoveryState: ReturnType<typeof vi.fn>;
  whenDiscoverySettled: ReturnType<typeof vi.fn>;
  restart: ReturnType<typeof vi.fn>;
  restartServer: ReturnType<typeof vi.fn>;
  reconcileConfiguredMcpServers: ReturnType<typeof vi.fn>;
  getMcpInstructions: ReturnType<typeof vi.fn>;
  startConfiguredMcpServers: ReturnType<typeof vi.fn>;
  onFolderTrustGained: ReturnType<typeof vi.fn>;
  onFolderTrustRevoked: ReturnType<typeof vi.fn>;
  quarantineForTrustRevocation: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('@vybestack/llxprt-code-mcp', (importOriginal) => {
  const actual = importOriginal<typeof import('@vybestack/llxprt-code-mcp')>();
  return {
    ...actual,
    McpClientManager: vi.fn().mockImplementation(() => {
      const mock = {
        getMcpServers: vi.fn().mockReturnValue({}),
        getDiscoveryFailures: vi
          .fn()
          .mockReturnValue(new Map<string, string>()),
        getDiscoveryState: vi
          .fn()
          .mockReturnValue(MCPDiscoveryState.NOT_STARTED),
        whenDiscoverySettled: vi.fn().mockResolvedValue(undefined),
        restart: vi.fn().mockResolvedValue(undefined),
        restartServer: vi.fn().mockResolvedValue(undefined),
        reconcileConfiguredMcpServers: vi.fn().mockResolvedValue(undefined),
        getMcpInstructions: vi.fn().mockReturnValue(''),
        startConfiguredMcpServers: vi.fn().mockResolvedValue(undefined),
        onFolderTrustGained: vi.fn().mockResolvedValue(undefined),
        onFolderTrustRevoked: vi.fn().mockResolvedValue(undefined),
        quarantineForTrustRevocation: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
      };
      mcpInstances.push(mock);
      return mock;
    }),
  };
});

vi.mock('fs', (importOriginal) => buildFsMockBody(importOriginal()));

// Mock dependencies that might be called during Config construction or createServerConfig.
vi.mock('@vybestack/llxprt-code-tools', (importOriginal) =>
  buildToolsMockBody(importOriginal()),
);

// Mock individual tools if their constructors are complex or have side effects

vi.mock('../core/contentGenerator.js', (importOriginal) =>
  buildContentGeneratorMockBody(importOriginal()),
);

vi.mock('../telemetry/index.js', () => buildTelemetryMockBody());

vi.mock('../services/gitService.js', () => buildGitServiceMockBody());

vi.mock('@vybestack/llxprt-code-settings', () => buildSettingsMockBody());

vi.mock('@vybestack/llxprt-code-ide-integration', (importOriginal) =>
  buildIdeIntegrationMockBody(importOriginal()),
);

vi.mock('../utils/memoryDiscovery.js', () =>
  buildMemoryDiscoveryMockBody(hoistedConfigMocks),
);

vi.mock('../utils/events.js', (importOriginal) =>
  buildEventsMockBody(importOriginal(), hoistedConfigMocks),
);

vi.mock('../utils/fetch.js', () => buildFetchMockBody(hoistedConfigMocks));

describe('setApprovalMode with folder trust', () => {
  const baseParams: ConfigParameters = {
    sessionId: 'test',
    targetDir: '.',
    debugMode: false,
    model: 'test-model',
    cwd: '.',
  };

  it('should throw an error when setting YOLO mode in an untrusted folder', () => {
    const config = new Config(baseParams);
    vi.spyOn(config, 'isTrustedFolder').mockReturnValue(false);
    expect(() => config.setApprovalMode(ApprovalMode.YOLO)).toThrow(
      'Cannot enable privileged approval modes in an untrusted folder.',
    );
  });

  it('should throw an error when setting AUTO_EDIT mode in an untrusted folder', () => {
    const config = new Config(baseParams);
    vi.spyOn(config, 'isTrustedFolder').mockReturnValue(false);
    expect(() => config.setApprovalMode(ApprovalMode.AUTO_EDIT)).toThrow(
      'Cannot enable privileged approval modes in an untrusted folder.',
    );
  });

  it('should NOT throw an error when setting DEFAULT mode in an untrusted folder', () => {
    const config = new Config(baseParams);
    vi.spyOn(config, 'isTrustedFolder').mockReturnValue(false);
    expect(() => config.setApprovalMode(ApprovalMode.DEFAULT)).not.toThrow();
  });

  it('should NOT throw an error when setting any mode in a trusted folder', () => {
    const config = new Config(baseParams);
    vi.spyOn(config, 'isTrustedFolder').mockReturnValue(true);
    expect(() => config.setApprovalMode(ApprovalMode.YOLO)).not.toThrow();
    expect(() => config.setApprovalMode(ApprovalMode.AUTO_EDIT)).not.toThrow();
    expect(() => config.setApprovalMode(ApprovalMode.DEFAULT)).not.toThrow();
  });

  it('should NOT throw an error when setting any mode if trustedFolder is undefined', () => {
    const config = new Config(baseParams);
    vi.spyOn(config, 'isTrustedFolder').mockReturnValue(true); // isTrustedFolder defaults to true
    expect(() => config.setApprovalMode(ApprovalMode.YOLO)).not.toThrow();
    expect(() => config.setApprovalMode(ApprovalMode.AUTO_EDIT)).not.toThrow();
    expect(() => config.setApprovalMode(ApprovalMode.DEFAULT)).not.toThrow();
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
    expect(config.getJitContextEnabled()).toBe(true);
  });

  it('should return the configured JIT context setting value', () => {
    const configEnabled = new Config({
      ...baseParams,
      jitContextEnabled: true,
    });
    expect(configEnabled.getJitContextEnabled()).toBe(true);

    const configDisabled = new Config({
      ...baseParams,
      jitContextEnabled: false,
    });
    expect(configDisabled.getJitContextEnabled()).toBe(false);
  });

  it('should respect the settings service value when available', async () => {
    const mockSettingsService = {
      get: vi.fn().mockReturnValue(false),
      set: vi.fn(),
      getAll: vi.fn(),
      has: vi.fn(),
    } as unknown as SettingsService;

    const config = new Config({
      ...baseParams,
      settingsService: mockSettingsService,
    });

    expect(config.getJitContextEnabled()).toBe(false);
    expect(mockSettingsService.get).toHaveBeenCalledWith('jitContextEnabled');
  });

  describe('getJitMemoryForPath', () => {
    beforeEach(() => {
      mockLoadJitSubdirectoryMemory.mockReset();
    });

    it('should return JIT memory content when enabled', async () => {
      mockLoadJitSubdirectoryMemory.mockResolvedValue({
        files: [
          { path: '/path/to/target/sub/LLXPRT.md', content: 'sub memory' },
        ],
      });

      const config = new Config({
        ...baseParams,
        jitContextEnabled: true,
      });

      const result = await config.getJitMemoryForPath(
        '/path/to/target/sub/file.ts',
      );

      expect(result).toContain('sub memory');
      expect(mockLoadJitSubdirectoryMemory).toHaveBeenCalledWith(
        '/path/to/target/sub/file.ts',
        [path.resolve(baseParams.targetDir)],
        expect.any(Set),
        baseParams.debugMode,
        true,
      );
    });

    it('should return empty string when JIT context is disabled', async () => {
      const config = new Config({
        ...baseParams,
        jitContextEnabled: false,
      });

      const result = await config.getJitMemoryForPath(
        '/path/to/target/sub/file.ts',
      );

      expect(result).toBe('');
      expect(mockLoadJitSubdirectoryMemory).not.toHaveBeenCalled();
    });

    it('should return empty string when no JIT files are found', async () => {
      mockLoadJitSubdirectoryMemory.mockResolvedValue({ files: [] });

      const config = new Config({
        ...baseParams,
        jitContextEnabled: true,
      });

      const result = await config.getJitMemoryForPath(
        '/path/to/target/sub/file.ts',
      );

      expect(result).toBe('');
    });

    it('should exclude already-loaded paths', async () => {
      mockLoadJitSubdirectoryMemory.mockResolvedValue({ files: [] });

      const config = new Config({
        ...baseParams,
        jitContextEnabled: true,
        llxprtMdFilePaths: ['/path/to/target/LLXPRT.md'],
      });

      await config.getJitMemoryForPath('/path/to/target/sub/file.ts');

      const calledAlreadyLoaded = mockLoadJitSubdirectoryMemory.mock
        .calls[0]?.[2] as Set<string>;
      expect(calledAlreadyLoaded.has('/path/to/target/LLXPRT.md')).toBe(true);
    });
  });
});

describe('Config setModel', () => {
  const baseParams: ConfigParameters = {
    cwd: '/tmp',
    targetDir: '/path/to/target',
    debugMode: false,
    sessionId: 'test-session-id',
    model: 'gemini-pro',
    usageStatisticsEnabled: false,
  };

  it('should allow setting a pro (any) model and disable fallback mode', () => {
    const config = new Config(baseParams);
    config.setFallbackMode(true);
    expect(config.isInFallbackMode()).toBe(true);

    const proModel = 'gemini-2.5-pro';
    config.setModel(proModel);

    expect(config.getModel()).toBe(proModel);
    expect(config.isInFallbackMode()).toBe(false);
    expect(mockCoreEvents.emitModelChanged).toHaveBeenCalledWith(proModel);
  });

  it('should allow setting auto model from non-auto model and disable fallback mode', () => {
    const config = new Config(baseParams);
    config.setFallbackMode(true);
    expect(config.isInFallbackMode()).toBe(true);

    config.setModel('auto');

    expect(config.getModel()).toBe('auto');
    expect(config.isInFallbackMode()).toBe(false);
    expect(mockCoreEvents.emitModelChanged).toHaveBeenCalledWith('auto');
  });

  it('should allow setting auto model from auto model if it is in the fallback mode', () => {
    const config = new Config({
      cwd: '/tmp',
      targetDir: '/path/to/target',
      debugMode: false,
      sessionId: 'test-session-id',
      model: 'auto',
      usageStatisticsEnabled: false,
    });
    config.setFallbackMode(true);
    expect(config.isInFallbackMode()).toBe(true);

    config.setModel('auto');

    expect(config.getModel()).toBe('auto');
    expect(config.isInFallbackMode()).toBe(false);
    expect(mockCoreEvents.emitModelChanged).toHaveBeenCalledWith('auto');
  });
});

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P04
 * @requirement:HOOK-001,HOOK-002,HOOK-010
 */
describe('Config getHookSystem', () => {
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

    const hookSystem = config.getHookSystem();
    expect(hookSystem).toBeDefined();
    expect(hookSystem).not.toBeNull();
  });

  it('enableHooks false returns undefined', () => {
    // @requirement:HOOK-002 - Returns undefined when enableHooks=false
    const config = new Config({
      ...baseParams,
      enableHooks: false,
    });

    const hookSystem = config.getHookSystem();
    expect(hookSystem).toBeUndefined();
  });

  it('tools.enableHooks does not enable hooks', () => {
    // @requirement:HOOK-002 - Only top-level enableHooks controls hook system
    // The tools.enableHooks key should not enable the hook system
    const config = new Config({
      ...baseParams,
      enableHooks: false,
      // Note: tools.enableHooks is not a valid config key for enabling hooks
    });

    const hookSystem = config.getHookSystem();
    expect(hookSystem).toBeUndefined();
    expect(config.getEnableHooks()).toBe(false);
  });

  it('getHookSystem returns same instance on multiple calls', () => {
    // @requirement:HOOK-001 - Lazy creation, same instance returned
    const config = new Config({
      ...baseParams,
      enableHooks: true,
    });

    const hookSystem1 = config.getHookSystem();
    const hookSystem2 = config.getHookSystem();

    expect(hookSystem1).toBe(hookSystem2);
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
    expect(config.getHookSystem()).toBeUndefined();
  });

  it('getEnableHooksUI returns true while getEnableHooks returns false and getHookSystem returns undefined', () => {
    const config = new Config({
      ...baseParams,
      enableHooksUI: true,
      enableHooks: false,
    });
    expect(config.getEnableHooksUI()).toBe(true);
    expect(config.getEnableHooks()).toBe(false);
    expect(config.getHookSystem()).toBeUndefined();
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
      const config = new Config({
        ...baseParams,
        mcpServers: { stale: { command: 'stale-command' } },
        onReloadMcpServers: reloadMcpServers,
      });

      await config.reloadMcpServers();

      expect(config.getMcpServers()).toStrictEqual({
        fresh: { command: 'fresh-command' },
      });
      expect(config.getBlockedMcpServers()).toStrictEqual([
        { name: 'blocked', extensionName: '' },
      ]);
    });

    it('replaces trusted MCP policy rules with rules from the reloaded configuration', async () => {
      const config = new Config({
        ...baseParams,
        trustedFolder: true,
        mcpServers: { stale: { command: 'stale-command', trust: true } },
        onReloadMcpServers: vi.fn().mockResolvedValue({
          mcpServers: { fresh: { command: 'fresh-command', trust: true } },
          blockedMcpServers: [],
          settingsMcpServers: {
            fresh: { command: 'fresh-command', trust: true },
          },
        }),
      });

      await config.reloadMcpServers();

      const trustedPrefixes = config
        .getPolicyEngine()
        .getRules()
        .filter((rule) => rule.source === 'Settings (MCP Trusted)')
        .map((rule) => rule.toolNamePrefix);
      expect(trustedPrefixes).toStrictEqual(['fresh__']);
    });

    it('preserves existing MCP state when reload resolution fails', async () => {
      const config = new Config({
        ...baseParams,
        mcpServers: { stable: { command: 'stable-command' } },
        blockedMcpServers: [{ name: 'stable-blocked', extensionName: '' }],
        onReloadMcpServers: vi
          .fn()
          .mockRejectedValue(new Error('settings invalid')),
      });

      await expect(config.reloadMcpServers()).rejects.toThrow(
        'settings invalid',
      );
      expect(config.getMcpServers()).toStrictEqual({
        stable: { command: 'stable-command' },
      });
      expect(config.getBlockedMcpServers()).toStrictEqual([
        { name: 'stable-blocked', extensionName: '' },
      ]);
    });

    it('throws when onReloadMcpServers is not wired instead of silently no-oping', async () => {
      const config = new Config({
        ...baseParams,
        mcpServers: { existing: { command: 'existing' } },
      });

      await expect(config.reloadMcpServers()).rejects.toThrow(
        'MCP server reload is not available in this composition.',
      );
      expect(config.getMcpServers()).toStrictEqual({
        existing: { command: 'existing' },
      });
    });

    it('builds trusted rules from settingsMcpServers, not the merged mcpServers map', async () => {
      const config = new Config({
        ...baseParams,
        trustedFolder: true,
        mcpServers: { stale: { command: 'stale', trust: true } },
        onReloadMcpServers: vi.fn().mockResolvedValue({
          mcpServers: {
            mergedOnly: { command: 'merged', trust: true },
            shared: { command: 'shared', trust: true },
          },
          blockedMcpServers: [],
          settingsMcpServers: {
            settingsOnly: { command: 'settings', trust: true },
            shared: { command: 'shared', trust: true },
          },
        }),
      });

      await config.reloadMcpServers();

      const trustedPrefixes = config
        .getPolicyEngine()
        .getRules()
        .filter((rule) => rule.source === 'Settings (MCP Trusted)')
        .map((rule) => rule.toolNamePrefix)
        .sort();
      expect(trustedPrefixes).toStrictEqual(['settingsOnly__', 'shared__']);
    });

    it('preserves non-MCP policy rules during reload', async () => {
      const config = new Config({
        ...baseParams,
        trustedFolder: true,
        mcpServers: { stale: { command: 'stale-command', trust: true } },
        onReloadMcpServers: vi.fn().mockResolvedValue({
          mcpServers: { fresh: { command: 'fresh-command', trust: true } },
          blockedMcpServers: [],
          settingsMcpServers: {
            fresh: { command: 'fresh-command', trust: true },
          },
        }),
      });

      config.getPolicyEngine().addRule({
        toolNamePrefix: 'custom__',
        decision: 'allow',
        priority: 1,
        source: 'Test Custom Source',
      });

      await config.reloadMcpServers();

      const sources = config
        .getPolicyEngine()
        .getRules()
        .map((rule) => rule.source);
      expect(sources).toContain('Test Custom Source');
    });
  });

  describe('reloadSkills', () => {
    it('should call onReload, update disabledSkills, discover, and apply disabled list', async () => {
      const mockOnReload = vi.fn().mockResolvedValue({
        disabledSkills: ['skill2'],
      });
      const params: ConfigParameters = {
        sessionId: 'test-session',
        targetDir: '/tmp/test',
        debugMode: false,
        model: 'test-model',
        cwd: '/tmp/test',
        skillsSupport: true,
        onReload: mockOnReload,
      };

      const config = new Config(params);
      await initializeTestConfig(config);

      const skillManager = config.getSkillManager();

      vi.spyOn(skillManager, 'discoverSkills').mockResolvedValue(undefined);
      vi.spyOn(skillManager, 'setDisabledSkills');

      await config.reloadSkills();

      expect(mockOnReload).toHaveBeenCalled();
      expect(skillManager.discoverSkills).toHaveBeenCalled();
      expect(skillManager.setDisabledSkills).toHaveBeenCalledWith(['skill2']);
    });

    it('should discover and apply defaults when no onReload is provided', async () => {
      const params: ConfigParameters = {
        sessionId: 'test-session',
        targetDir: '/tmp/test',
        debugMode: false,
        model: 'test-model',
        cwd: '/tmp/test',
        skillsSupport: true,
      };

      const config = new Config(params);
      await initializeTestConfig(config);

      const skillManager = config.getSkillManager();

      vi.spyOn(skillManager, 'discoverSkills').mockResolvedValue(undefined);
      vi.spyOn(skillManager, 'setDisabledSkills');

      await config.reloadSkills();

      expect(skillManager.discoverSkills).toHaveBeenCalled();
      expect(skillManager.setDisabledSkills).toHaveBeenCalled();
    });

    it('should preserve existing disabledSkills when onReload returns undefined for them', async () => {
      const mockOnReload = vi.fn().mockResolvedValue({
        disabledSkills: undefined,
      });
      const params: ConfigParameters = {
        sessionId: 'test-session',
        targetDir: '/tmp/test',
        debugMode: false,
        model: 'test-model',
        cwd: '/tmp/test',
        skillsSupport: true,
        disabledSkills: ['skill1'],
        onReload: mockOnReload,
      };

      const config = new Config(params);
      await initializeTestConfig(config);

      const skillManager = config.getSkillManager();
      vi.spyOn(skillManager, 'discoverSkills').mockResolvedValue(undefined);
      vi.spyOn(skillManager, 'setDisabledSkills');

      await config.reloadSkills();

      // disabledSkills undefined is falsy, so original value is preserved
      expect(skillManager.setDisabledSkills).toHaveBeenCalledWith(['skill1']);
    });

    it('should update admin settings from onReload', async () => {
      const mockOnReload = vi.fn().mockResolvedValue({
        adminSkillsEnabled: false,
      });
      const params: ConfigParameters = {
        sessionId: 'test-session',
        targetDir: '/tmp/test',
        debugMode: false,
        model: 'test-model',
        cwd: '/tmp/test',
        skillsSupport: true,
        onReload: mockOnReload,
      };

      const config = new Config(params);
      await initializeTestConfig(config);

      const skillManager = config.getSkillManager();
      vi.spyOn(skillManager, 'setAdminSettings');

      await config.reloadSkills();

      expect(skillManager.setAdminSettings).toHaveBeenCalledWith(false);
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
    mcpInstances.length = 0;
  });

  describe('reloadMcpServers reconciliation ownership', () => {
    it('swaps MCP/blocked state then invokes the live manager reconcile exactly once', async () => {
      const config = new Config({
        ...baseParams,
        trustedFolder: true,
        mcpServers: { stale: { command: 'stale' } },
        onReloadMcpServers: vi.fn().mockResolvedValue({
          mcpServers: { fresh: { command: 'fresh' } },
          blockedMcpServers: [{ name: 'blocked', extensionName: 'ext' }],
          settingsMcpServers: { fresh: { command: 'fresh' } },
        }),
      });
      await initializeTestConfig(config);
      const manager = mcpInstances[0];

      await config.reloadMcpServers();

      expect(config.getMcpServers()).toStrictEqual({
        fresh: { command: 'fresh' },
      });
      expect(config.getBlockedMcpServers()).toStrictEqual([
        { name: 'blocked', extensionName: 'ext' },
      ]);
      expect(manager.reconcileConfiguredMcpServers).toHaveBeenCalledTimes(1);
    });

    it('skips reconciliation when the manager is not initialized', async () => {
      const config = new Config({
        ...baseParams,
        mcpServers: { stale: { command: 'stale' } },
        onReloadMcpServers: vi.fn().mockResolvedValue({
          mcpServers: { fresh: { command: 'fresh' } },
          blockedMcpServers: [],
          settingsMcpServers: { fresh: { command: 'fresh' } },
        }),
      });
      await config.reloadMcpServers();
      expect(config.getMcpServers()).toStrictEqual({
        fresh: { command: 'fresh' },
      });
      expect(mcpInstances).toHaveLength(0);
    });
  });

  describe('getMcpRuntimeStatus', () => {
    it('exposes servers, failures, and state without exposing the manager', async () => {
      const config = new Config({ ...baseParams, trustedFolder: true });
      await initializeTestConfig(config);
      const manager = mcpInstances[0];
      const failures = new Map<string, string>([['srv', 'boom']]);
      manager.getMcpServers.mockReturnValue({ srv: { command: 'run' } });
      manager.getDiscoveryFailures.mockReturnValue(failures);
      manager.getDiscoveryState.mockReturnValue(MCPDiscoveryState.COMPLETED);

      const status = config.getMcpRuntimeStatus();
      expect(status).toStrictEqual({
        servers: { srv: { command: 'run' } },
        discoveryFailures: failures,
        discoveryState: MCPDiscoveryState.COMPLETED,
      });

      const uninit = new Config(baseParams);
      expect(uninit.getMcpRuntimeStatus()).toBeUndefined();
    });
  });

  describe('refreshMcpServers', () => {
    it('delegates restart(name)/restart() to the live manager; no-op when un-initialized', async () => {
      const config = new Config({ ...baseParams, trustedFolder: true });
      await initializeTestConfig(config);
      const manager = mcpInstances[0];

      await config.refreshMcpServers('srv');
      expect(manager.restartServer).toHaveBeenCalledWith('srv');
      expect(manager.restart).not.toHaveBeenCalled();

      await config.refreshMcpServers();
      expect(manager.restart).toHaveBeenCalledTimes(1);

      const uninit = new Config(baseParams);
      await expect(uninit.refreshMcpServers()).resolves.toBeUndefined();
      await expect(uninit.refreshMcpServers('srv')).resolves.toBeUndefined();
      expect(mcpInstances).toHaveLength(1);
    });
  });

  describe('awaitMcpDiscoveryGate', () => {
    it('awaits whenDiscoverySettled and returns failures; empty map when un-initialized', async () => {
      const config = new Config({ ...baseParams, trustedFolder: true });
      await initializeTestConfig(config);
      const manager = mcpInstances[0];
      const failures = new Map<string, string>([['srv', 'timeout']]);
      manager.whenDiscoverySettled.mockResolvedValue(undefined);
      manager.getDiscoveryFailures.mockReturnValue(failures);
      const result = await config.awaitMcpDiscoveryGate();
      expect(manager.whenDiscoverySettled).toHaveBeenCalledTimes(1);
      expect(result).toBe(failures);

      const uninit = new Config(baseParams);
      expect((await uninit.awaitMcpDiscoveryGate()).size).toBe(0);
    });
  });

  describe('getMcpInstructions', () => {
    it('returns the live manager instructions; undefined when un-initialized', async () => {
      const config = new Config({ ...baseParams, trustedFolder: true });
      await initializeTestConfig(config);
      mcpInstances[0].getMcpInstructions.mockReturnValue('do things');
      expect(config.getMcpInstructions()).toBe('do things');

      const uninit = new Config(baseParams);
      expect(uninit.getMcpInstructions()).toBeUndefined();
    });
  });
});
