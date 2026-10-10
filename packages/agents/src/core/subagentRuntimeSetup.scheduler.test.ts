import { createSessionPolicyFixture } from './__tests__/session-policy-fixture.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { createToolExecutionConfig } from './subagentRuntimeSetup.js';
import { isToolBlocked } from './toolGovernance.js';

interface SchedulerFixture {
  runtimeBundle: {
    runtimeContext: {
      state: { sessionId: string };
      readToolExecutionPolicy: ReturnType<
        typeof createSessionPolicyFixture
      >['readExecutionPolicy'];
    };
  };
  toolRegistry: {
    getTool: () => undefined;
    getFunctionDeclarationsFiltered: () => never[];
  };
}

const makeSchedulerFixture = (sessionId: string): SchedulerFixture => ({
  runtimeBundle: {
    runtimeContext: {
      state: { sessionId },
      readToolExecutionPolicy: createSessionPolicyFixture().readExecutionPolicy,
    },
  },
  toolRegistry: {
    getTool: () => undefined,
    getFunctionDeclarationsFiltered: () => [],
  },
});

describe('createToolExecutionConfig', () => {
  it('should build config from runtime context', () => {
    const fixture = makeSchedulerFixture('sess-123');
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
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
      undefined,
      toolConfig,
    );
    const allowed = config.readGovernance().allowedExplicit
      ? [...config.readGovernance().allowed]
      : undefined;
    expect(Array.isArray(allowed)).toBe(true);
    expect(allowed).toContain('allowed_tool');
  });

  it('should include ephemeral settings', () => {
    const fixture = makeSchedulerFixture('sess-456');
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
    );
    expect(config.readExecutionPolicy()).toBeDefined();
  });
});

describe('createToolExecutionConfig — fail-closed empty whitelist (#2069)', () => {
  it('preserves explicit empty tools array as tools.allowed=[]', () => {
    const fixture = makeSchedulerFixture('sess-fc');
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      undefined,
      { tools: [] },
    );
    expect(
      config.readGovernance().allowedExplicit
        ? [...config.readGovernance().allowed]
        : undefined,
    ).toStrictEqual([]);
    expect(
      config.readGovernance().allowedExplicit
        ? [...config.readGovernance().allowed]
        : undefined,
    ).toStrictEqual([]);
  });

  it('preserves parent explicit empty tools.allowed when intersecting with a non-empty whitelist', () => {
    const fixture = makeSchedulerFixture('sess-fc');
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      { tools: { allowed: [] } },
      { tools: ['read_file'] },
    );
    expect(
      config.readGovernance().allowedExplicit
        ? [...config.readGovernance().allowed]
        : undefined,
    ).toStrictEqual([]);
    expect(
      config.readGovernance().allowedExplicit
        ? [...config.readGovernance().allowed]
        : undefined,
    ).toStrictEqual([]);
  });

  it('intersects API-qualified snapshot allowlist entries with canonical whitelist entries', () => {
    const fixture = makeSchedulerFixture('sess-fc');
    const toolRegistry = {
      ...fixture.toolRegistry,
      getEnabledTools: () => [{ name: 'read_file' }],
    };
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      toolRegistry,
      { tools: { allowed: ['functions.read_file'] } },
      { tools: ['functions.read_file'] },
    );

    expect(
      config.readGovernance().allowedExplicit
        ? [...config.readGovernance().allowed]
        : undefined,
    ).toStrictEqual(['read_file']);
  });

  it('does not set tools.allowed when toolConfig is undefined', () => {
    const fixture = makeSchedulerFixture('sess-fc');
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      undefined,
      undefined,
    );
    expect(
      config.readGovernance().allowedExplicit
        ? [...config.readGovernance().allowed]
        : undefined,
    ).toBeUndefined();
    expect(
      config.readGovernance().allowedExplicit
        ? [...config.readGovernance().allowed]
        : undefined,
    ).toBeUndefined();
  });

  it('does not set tools.allowed when toolConfig is omitted', () => {
    const fixture = makeSchedulerFixture('sess-fc');
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
    );
    expect(
      config.readGovernance().allowedExplicit
        ? [...config.readGovernance().allowed]
        : undefined,
    ).toBeUndefined();
  });
});

describe('Issue #2069: scheduler governance excludes task/list_subagents', () => {
  it('createToolExecutionConfig().getExcludeTools() returns task and list_subagents', () => {
    const fixture = makeSchedulerFixture('sess-2069');
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
    );
    const excluded = [...config.readGovernance().excluded];
    expect(excluded).toContain('task');
    expect(excluded).toContain('list_subagents');
  });

  it('buildToolGovernance from child execution config marks task/list_subagents as blocked (fail-closed)', async () => {
    const fixture = makeSchedulerFixture('sess-2069');
    const toolExecConfig = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
    );

    const governance = toolExecConfig.readGovernance();
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
      undefined,
      toolConfig,
    );
    const allowed = (
      config.readGovernance().allowedExplicit
        ? [...config.readGovernance().allowed]
        : undefined
    ) as string[];
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
      undefined,
      toolConfig,
    );
    const allowed = (
      config.readGovernance().allowedExplicit
        ? [...config.readGovernance().allowed]
        : undefined
    ) as string[];
    expect(Array.isArray(allowed)).toBe(true);
    expect(allowed).toStrictEqual([]);
  });

  it('applyToolWhitelistToEphemerals preserves fail-closed empty enabled registry', () => {
    const fixture = makeSchedulerFixture('sess-2069');
    const toolRegistry = {
      ...fixture.toolRegistry,
      getEnabledTools: () => [],
    };
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      toolRegistry,
      undefined,
      { tools: ['read_file'] },
    );
    expect(
      config.readGovernance().allowedExplicit
        ? [...config.readGovernance().allowed]
        : undefined,
    ).toStrictEqual([]);
  });

  it('applyToolWhitelistToEphemerals removes canonical variants (TaskTool, listSubagents)', () => {
    const fixture = makeSchedulerFixture('sess-2069');
    const toolConfig = {
      tools: ['ReadFileTool', 'TaskTool', 'listSubagents'],
    };
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      undefined,
      toolConfig,
    );
    const allowed = (
      config.readGovernance().allowedExplicit
        ? [...config.readGovernance().allowed]
        : undefined
    ) as string[];
    expect(Array.isArray(allowed)).toBe(true);
    expect(allowed).toContain('read_file');
    expect(allowed).not.toContain('task');
    expect(allowed).not.toContain('list_subagents');
  });

  it('applyToolWhitelistToEphemerals resolves API-qualified entries against dotted registry names', () => {
    const fixture = makeSchedulerFixture('sess-2184');
    const toolRegistry = {
      ...fixture.toolRegistry,
      getEnabledTools: () => [{ name: 'tool.v1' }],
    };
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      toolRegistry,
      undefined,
      { tools: ['functions.tool.v1'] },
    );

    expect(
      config.readGovernance().allowedExplicit
        ? [...config.readGovernance().allowed]
        : undefined,
    ).toStrictEqual(['tool.v1']);
  });

  it('applyToolWhitelistToEphemerals includes non-string declaration names in tools.allowed', () => {
    const fixture = makeSchedulerFixture('sess-2184');
    const customDeclaration = {
      name: 'custom_tool',
      description: 'custom',
    };
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      undefined,
      { tools: [customDeclaration] },
    );

    expect(
      config.readGovernance().allowedExplicit
        ? [...config.readGovernance().allowed]
        : undefined,
    ).toStrictEqual(['custom_tool']);
  });

  it('applyToolWhitelistToEphemerals skips non-string declaration names absent from enabled registry', () => {
    const fixture = makeSchedulerFixture('sess-2184');
    const toolRegistry = {
      ...fixture.toolRegistry,
      getEnabledTools: () => [{ name: 'read_file' }],
    };
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      toolRegistry,
      undefined,
      {
        tools: [
          { name: 'read_file', description: 'read' },
          { name: 'custom_tool', description: 'custom' },
        ],
      },
    );

    expect(
      config.readGovernance().allowedExplicit
        ? [...config.readGovernance().allowed]
        : undefined,
    ).toStrictEqual(['read_file']);
  });
  it('applyToolWhitelistToEphemerals fail-closes when only excluded non-string declarations remain', () => {
    const fixture = makeSchedulerFixture('sess-2184');
    const config = createToolExecutionConfig(
      fixture.runtimeBundle,
      fixture.toolRegistry,
      undefined,
      { tools: [{ name: 'functions.task', description: 'nested' }] },
    );

    expect(
      config.readGovernance().allowedExplicit
        ? [...config.readGovernance().allowed]
        : undefined,
    ).toStrictEqual([]);
  });
});
