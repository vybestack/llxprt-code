/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  createToolExecutionConfig,
  createSchedulerConfig,
} from './subagentRuntimeSetup.js';
import { buildToolGovernance, isToolBlocked } from './toolGovernance.js';

interface SchedulerFixture {
  runtimeBundle: {
    runtimeContext: { state: { sessionId: string } };
  };
  toolRegistry: {
    getTool: () => undefined;
    getFunctionDeclarationsFiltered: () => never[];
  };
  foregroundConfig: {
    getOrCreateScheduler: () => void;
    disposeScheduler: () => void;
  };
}

const makeSchedulerFixture = (sessionId: string): SchedulerFixture => ({
  runtimeBundle: {
    runtimeContext: { state: { sessionId } },
  },
  toolRegistry: {
    getTool: () => undefined,
    getFunctionDeclarationsFiltered: () => [],
  },
  foregroundConfig: {
    getOrCreateScheduler: () => {},
    disposeScheduler: () => {},
  },
});

/**
 * Creates a foreground config mock with configurable allowedTools.
 */
const makeForegroundWithDefaults = (allowedTools: string[]) => ({
  getApprovalMode: () => 'DEFAULT' as const,
  getPolicyEngine: () => undefined,
  getOrCreateScheduler: () => Promise.resolve({}),
  disposeScheduler: () => {},
  getEphemeralSettings: () => ({}),
  getExcludeTools: () => [],
  getTelemetryLogPromptsEnabled: () => false,
  getAllowedTools: () => allowedTools,
  getEnableHooks: () => false,
  getHooks: () => undefined,
  getHookSystem: () => undefined,
  getWorkingDir: () => '/tmp',
  getTargetDir: () => '/tmp',
});

describe('createToolExecutionConfig', () => {
  it('should build config from runtime context', () => {
    const fixture = makeSchedulerFixture('sess-123');
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      fixture.foregroundConfig,
    );
    expect(config).toBeDefined();
    expect(config.getSessionId()).toBe('sess-123');
  });

  it('should apply tool whitelist restrictions', () => {
    const fixture = makeSchedulerFixture('sess-123');
    const toolConfig = { tools: ['allowed_tool'] };
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      fixture.foregroundConfig,
      undefined,
      undefined,
      toolConfig,
    );
    const allowed = config.getEphemeralSetting('tools.allowed');
    expect(Array.isArray(allowed)).toBe(true);
    expect(allowed).toContain('allowed_tool');
  });

  it('should include ephemeral settings', () => {
    const fixture = makeSchedulerFixture('sess-456');
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      fixture.foregroundConfig,
    );
    expect(config.getEphemeralSettings()).toBeDefined();
  });
});

describe('createToolExecutionConfig — fail-closed empty whitelist (#2069)', () => {
  it('preserves explicit empty tools array as tools.allowed=[]', () => {
    const fixture = makeSchedulerFixture('sess-fc');
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      fixture.foregroundConfig,
      undefined,
      undefined,
      { tools: [] },
    );
    expect(config.getEphemeralSetting('tools.allowed')).toStrictEqual([]);
    expect(config.getEphemeralSettings()['tools.allowed']).toStrictEqual([]);
  });

  it('preserves parent explicit empty tools.allowed when intersecting with a non-empty whitelist', () => {
    const fixture = makeSchedulerFixture('sess-fc');
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      fixture.foregroundConfig,
      undefined,
      { tools: { allowed: [] } },
      { tools: ['read_file'] },
    );
    expect(config.getEphemeralSetting('tools.allowed')).toStrictEqual([]);
    expect(config.getEphemeralSettings()['tools.allowed']).toStrictEqual([]);
  });

  it('does not set tools.allowed when toolConfig is undefined', () => {
    const fixture = makeSchedulerFixture('sess-fc');
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      fixture.foregroundConfig,
      undefined,
      undefined,
      undefined,
    );
    expect(config.getEphemeralSetting('tools.allowed')).toBeUndefined();
    expect(config.getEphemeralSettings()['tools.allowed']).toBeUndefined();
  });

  it('does not set tools.allowed when toolConfig is omitted', () => {
    const fixture = makeSchedulerFixture('sess-fc');
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      fixture.foregroundConfig,
    );
    expect(config.getEphemeralSetting('tools.allowed')).toBeUndefined();
  });
});

describe('createSchedulerConfig — fail-closed empty whitelist (#2069)', () => {
  it('getAllowedTools() returns [] for explicit empty even when foreground returns defaults', () => {
    const toolExecCtxWithEmpty = {
      getToolRegistry: () => ({}),
      getSessionId: () => 'sess-fc',
      getEphemeralSettings: () => ({ 'tools.allowed': [] }),
      getEphemeralSetting: (key: string) =>
        key === 'tools.allowed' ? [] : undefined,
      getExcludeTools: () => [],
      getTelemetryLogPromptsEnabled: () => false,
      getOrCreateScheduler: () => Promise.resolve({}),
      disposeScheduler: () => {},
    };
    const foregroundWithDefaults = makeForegroundWithDefaults([
      'read_file',
      'write_file',
    ]);
    const config = createSchedulerConfig(
      toolExecCtxWithEmpty,
      foregroundWithDefaults,
    );
    expect(config.getAllowedTools()).toStrictEqual([]);
  });

  it('getAllowedTools() falls back to foreground when ephemerals omit tools.allowed', () => {
    const toolExecCtxNoOverride = {
      getToolRegistry: () => ({}),
      getSessionId: () => 'sess-default',
      getEphemeralSettings: () => ({}),
      getEphemeralSetting: () => undefined,
      getExcludeTools: () => [],
      getTelemetryLogPromptsEnabled: () => false,
      getOrCreateScheduler: () => Promise.resolve({}),
      disposeScheduler: () => {},
    };
    const foregroundWithDefaults = makeForegroundWithDefaults(['read_file']);
    const config = createSchedulerConfig(
      toolExecCtxNoOverride,
      foregroundWithDefaults,
    );
    expect(config.getAllowedTools()).toStrictEqual(['read_file']);
  });
});

describe('createToolExecutionConfig — scheduler delegation', () => {
  it('should forward toolRegistry to foregroundConfig.getOrCreateScheduler', async () => {
    const capturedDeps: Record<string, unknown> = {};
    const sentinelRegistry = { sentinel: 'subagent-registry' };
    const runtimeBundle = {
      runtimeContext: { state: { sessionId: 'sess-fwd' } },
    };
    const foregroundConfig = {
      getOrCreateScheduler: (
        _sid: string,
        _cb: unknown,
        _opts: unknown,
        deps: Record<string, unknown>,
      ) => {
        Object.assign(capturedDeps, deps);
        return Promise.resolve({});
      },
      disposeScheduler: () => {},
    };

    const config = createToolExecutionConfig(
      runtimeBundle,
      sentinelRegistry,
      foregroundConfig,
    );
    await config.getOrCreateScheduler('sess-fwd', {} as never, undefined, {});

    expect(capturedDeps.toolRegistry).toBe(sentinelRegistry);
  });

  it('should allow caller to override toolRegistry via dependencies', async () => {
    const capturedDeps: Record<string, unknown> = {};
    const defaultRegistry = { default: true };
    const overrideRegistry = { override: true };
    const runtimeBundle = {
      runtimeContext: { state: { sessionId: 'sess-override' } },
    };
    const foregroundConfig = {
      getOrCreateScheduler: (
        _sid: string,
        _cb: unknown,
        _opts: unknown,
        deps: Record<string, unknown>,
      ) => {
        Object.assign(capturedDeps, deps);
        return Promise.resolve({});
      },
      disposeScheduler: () => {},
    };

    const config = createToolExecutionConfig(
      runtimeBundle,
      defaultRegistry,
      foregroundConfig,
    );
    await config.getOrCreateScheduler('sess-override', {} as never, undefined, {
      toolRegistry: overrideRegistry,
    } as never);

    expect(capturedDeps.toolRegistry).toBe(overrideRegistry);
  });
});

describe('createSchedulerConfig', () => {
  it('should return a Config-shaped object', () => {
    const mockToolExecCtx = makeToolExecCtx('test-session');
    const mockForeground = makeForegroundWithDefaults([]);
    const config = createSchedulerConfig(mockToolExecCtx, mockForeground);
    expect(config).toBeDefined();
    expect(typeof config.getSessionId).toBe('function');
  });

  it('should delegate getOrCreateScheduler through toolExecutorContext, not foregroundConfig', async () => {
    const flags = { toolExecCalled: false, foregroundCalled: false };
    const mockToolExecCtx = {
      ...makeToolExecCtx('test-session'),
      getOrCreateScheduler: () => {
        flags.toolExecCalled = true;
        return Promise.resolve({});
      },
    };
    const mockForeground = {
      ...makeForegroundWithDefaults([]),
      getOrCreateScheduler: () => {
        flags.foregroundCalled = true;
        return Promise.resolve({});
      },
    };
    const config = createSchedulerConfig(mockToolExecCtx, mockForeground);
    await config.getOrCreateScheduler('test-session', {} as never);

    expect(flags.toolExecCalled).toBe(true);
    expect(flags.foregroundCalled).toBe(false);
  });

  it('should inject interactiveMode into scheduler options', async () => {
    const mockToolExecCtx = makeToolExecCtx('test-session');
    let capturedOptions: Record<string, unknown> = {};
    const mockForeground = {
      ...makeForegroundWithDefaults([]),
      getOrCreateScheduler: () => Promise.resolve({}),
    };
    // Override toolExec to capture options
    const toolExecWithOptions = {
      ...mockToolExecCtx,
      getOrCreateScheduler: (
        _sid: string,
        _cb: unknown,
        opts: Record<string, unknown>,
      ) => {
        capturedOptions = opts;
        return Promise.resolve({});
      },
    };
    const config = createSchedulerConfig(toolExecWithOptions, mockForeground, {
      interactive: true,
    });
    await config.getOrCreateScheduler('test-session', {} as never);

    expect(capturedOptions.interactiveMode).toBe(true);
  });

  it('should delegate disposeScheduler through toolExecutorContext', () => {
    const flags = { toolExec: false, foreground: false };
    const mockToolExecCtx = {
      ...makeToolExecCtx('test-session'),
      disposeScheduler: () => {
        flags.toolExec = true;
      },
    };
    const mockForeground = {
      ...makeForegroundWithDefaults([]),
      getOrCreateScheduler: () => Promise.resolve({}),
      disposeScheduler: () => {
        flags.foreground = true;
      },
    };
    const config = createSchedulerConfig(mockToolExecCtx, mockForeground);
    config.disposeScheduler('test-session');

    expect(flags.toolExec).toBe(true);
    expect(flags.foreground).toBe(false);
  });
});

/**
 * Creates a minimal tool execution context mock for scheduler config tests.
 */
const makeToolExecCtx = (sessionId: string) => ({
  getToolRegistry: () => ({}),
  getSessionId: () => sessionId,
  getEphemeralSettings: () => ({}),
  getEphemeralSetting: () => undefined,
  getExcludeTools: () => [],
  getTelemetryLogPromptsEnabled: () => false,
  getOrCreateScheduler: () => Promise.resolve({}),
  disposeScheduler: () => {},
});

describe('Issue #2069: scheduler governance excludes task/list_subagents', () => {
  it('createToolExecutionConfig().getExcludeTools() returns task and list_subagents', () => {
    const fixture = makeSchedulerFixture('sess-2069');
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      fixture.foregroundConfig,
    );
    const excluded = config.getExcludeTools();
    expect(excluded).toContain('task');
    expect(excluded).toContain('list_subagents');
  });

  it('createSchedulerConfig().getExcludeTools() surfaces task/list_subagents from toolExecutorContext', () => {
    const fixture = makeSchedulerFixture('sess-2069');
    const toolExecConfig = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      fixture.foregroundConfig,
    );
    const schedulerConfig = createSchedulerConfig(
      toolExecConfig,
      fixture.foregroundConfig,
    );
    const excluded = schedulerConfig.getExcludeTools();
    expect(excluded).toContain('task');
    expect(excluded).toContain('list_subagents');
  });

  it('buildToolGovernance from schedulerConfig marks task/list_subagents as blocked (fail-closed)', async () => {
    const fixture = makeSchedulerFixture('sess-2069');
    const toolExecConfig = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      fixture.foregroundConfig,
    );
    const schedulerConfig = createSchedulerConfig(
      toolExecConfig,
      fixture.foregroundConfig,
    );

    const governance = buildToolGovernance(schedulerConfig);
    expect(isToolBlocked('task', governance)).toBe(true);
    expect(isToolBlocked('list_subagents', governance)).toBe(true);
    // Non-excluded tool should not be blocked by excluded set alone
    expect(isToolBlocked('read_file', governance)).toBe(false);
  });

  it('applyToolWhitelistToEphemerals removes task/list_subagents from tools.allowed', () => {
    const fixture = makeSchedulerFixture('sess-2069');
    const toolConfig = { tools: ['read_file', 'task', 'list_subagents'] };
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      fixture.foregroundConfig,
      undefined,
      undefined,
      toolConfig,
    );
    const allowed = config.getEphemeralSetting('tools.allowed') as string[];
    expect(Array.isArray(allowed)).toBe(true);
    expect(allowed).toContain('read_file');
    expect(allowed).not.toContain('task');
    expect(allowed).not.toContain('list_subagents');
  });

  it('applyToolWhitelistToEphemerals sets tools.allowed to [] when only excluded tools remain', () => {
    const fixture = makeSchedulerFixture('sess-2069');
    const toolConfig = { tools: ['task', 'list_subagents'] };
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      fixture.foregroundConfig,
      undefined,
      undefined,
      toolConfig,
    );
    const allowed = config.getEphemeralSetting('tools.allowed') as string[];
    expect(Array.isArray(allowed)).toBe(true);
    expect(allowed).toStrictEqual([]);
  });

  it('applyToolWhitelistToEphemerals removes canonical variants (TaskTool, listSubagents)', () => {
    const fixture = makeSchedulerFixture('sess-2069');
    const toolConfig = {
      tools: ['ReadFileTool', 'TaskTool', 'listSubagents'],
    };
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      fixture.foregroundConfig,
      undefined,
      undefined,
      toolConfig,
    );
    const allowed = config.getEphemeralSetting('tools.allowed') as string[];
    expect(Array.isArray(allowed)).toBe(true);
    expect(allowed).toContain('read_file');
    expect(allowed).not.toContain('task');
    expect(allowed).not.toContain('list_subagents');
  });
});
