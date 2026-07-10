/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigParameters } from './config.js';
import { Config, ApprovalMode } from './config.js';
import type { HookDefinition } from '../hooks/types.js';
import { HookType, HookEventName } from '../hooks/types.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { initializeTestConfig } from '../test-utils/config.js';
import { type HoistedConfigMocks } from './configTestHarness.js';

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

vi.mock('fs', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildFsMockBody(await importOriginal());
});

// Mock dependencies that might be called during Config construction or createServerConfig.
vi.mock('@vybestack/llxprt-code-tools', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildToolsMockBody(
    await importOriginal<typeof import('@vybestack/llxprt-code-tools')>(),
  );
});

// Mock individual tools if their constructors are complex or have side effects

vi.mock('../core/contentGenerator.js', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildContentGeneratorMockBody(await importOriginal());
});

vi.mock('../telemetry/index.js', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildTelemetryMockBody();
});

vi.mock('../services/gitService.js', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildGitServiceMockBody();
});

vi.mock('@vybestack/llxprt-code-settings', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildSettingsMockBody();
});

vi.mock('@vybestack/llxprt-code-ide-integration', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildIdeIntegrationMockBody(
    await importOriginal<
      typeof import('@vybestack/llxprt-code-ide-integration')
    >(),
  );
});

vi.mock('../utils/memoryDiscovery.js', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildMemoryDiscoveryMockBody(hoistedConfigMocks);
});

vi.mock('../utils/events.js', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildEventsMockBody(await importOriginal(), hoistedConfigMocks);
});

vi.mock('../utils/fetch.js', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildFetchMockBody(hoistedConfigMocks);
});

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
        [baseParams.targetDir],
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
