/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Config } from './config.js';
import {
  registerSettingsService,
  resetSettingsService,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import { clearActiveProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import { initializeTestConfig } from '../test-utils/config.js';
import {
  ACTIVATE_MCP_SERVER_TOOL_NAME,
  ActivateMcpServerTool,
  BaseDeclarativeTool,
  Kind,
  ToolRegistry,
  type ToolInvocation,
  type ToolResult,
  type IToolMessageBus,
  type IToolRegistryHost,
} from '@vybestack/llxprt-code-tools';
import { syncActivateMcpServerTool } from './mcp-lazy-tool-sync.js';

const NOOP = async (): Promise<void> => {};

function createHost(ephemerals: Record<string, unknown>): IToolRegistryHost {
  return {
    getEphemeralSettings: () => ephemerals,
    getCoreTools: () => [],
    getExcludeTools: () => [],
  };
}

function createMessageBus(): IToolMessageBus {
  return {
    publish: () => {},
    subscribe: () => () => {},
    unsubscribe: () => {},
  };
}

class TestMcpTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  readonly serverName: string;
  constructor(name: string, serverName: string) {
    super(
      name,
      name,
      name,
      Kind.Other,
      zodToJsonSchema(z.object({ query: z.string() })),
      true,
      false,
    );
    this.serverName = serverName;
  }
  protected createInvocation(
    _params: Record<string, unknown>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    throw new Error('not used');
  }
}

class TestForeignTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  constructor() {
    super(
      ACTIVATE_MCP_SERVER_TOOL_NAME,
      'Foreign activate',
      'foreign tool occupying the reserved name',
      Kind.Other,
      zodToJsonSchema(z.object({ x: z.string() })),
      true,
      false,
    );
  }
  protected createInvocation(
    _params: Record<string, unknown>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    throw new Error('not used');
  }
}

function mcpTool(name: string, server: string): TestMcpTool {
  return new TestMcpTool(name, server);
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extractNameEnum(schema: unknown): readonly string[] {
  if (!isStringRecord(schema)) return [];
  const properties = schema['properties'];
  if (!isStringRecord(properties)) return [];
  const nameProp = properties['name'];
  if (!isStringRecord(nameProp)) return [];
  const enumValues = nameProp['enum'];
  if (!Array.isArray(enumValues)) return [];
  return enumValues.filter((v): v is string => typeof v === 'string');
}

function findActivationTool(registry: ToolRegistry) {
  return registry
    .getAllTools()
    .find((t) => t.name === ACTIVATE_MCP_SERVER_TOOL_NAME);
}

describe('syncActivateMcpServerTool — collision and default-mode preservation', () => {
  it('preserves a foreign activate_mcp_server tool when lazy mode is off', async () => {
    const registry = new ToolRegistry(createHost({}), createMessageBus());
    registry.registerTool(new TestForeignTool());
    const before = JSON.stringify(registry.getFunctionDeclarations());

    await syncActivateMcpServerTool(registry, createMessageBus(), NOOP);

    expect(JSON.stringify(registry.getFunctionDeclarations())).toBe(before);
  });

  it('fails fast when a foreign tool occupies the reserved name with deferred servers', async () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));
    registry.registerTool(new TestForeignTool());

    await expect(
      syncActivateMcpServerTool(registry, createMessageBus(), NOOP),
    ).rejects.toThrow('foreign tool');
  });

  it('rebuilds only an actual ActivateMcpServerTool on repeated syncs', async () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));

    await syncActivateMcpServerTool(registry, createMessageBus(), NOOP);
    const first = findActivationTool(registry);
    expect(first).toBeDefined();
    expect(first instanceof ActivateMcpServerTool).toBe(true);

    await syncActivateMcpServerTool(registry, createMessageBus(), NOOP);
    expect(
      registry
        .getAllTools()
        .filter((t) => t.name === ACTIVATE_MCP_SERVER_TOOL_NAME),
    ).toHaveLength(1);
  });

  it('removes activation tool when all servers are activated (B6)', async () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));

    await syncActivateMcpServerTool(registry, createMessageBus(), NOOP);
    expect(findActivationTool(registry)).toBeDefined();

    registry.activateMcpServer('alpha');
    await syncActivateMcpServerTool(registry, createMessageBus(), NOOP);
    expect(findActivationTool(registry)).toBeUndefined();
  });

  it('no-ops when messageBus is undefined (pre-initialization lifecycle)', async () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));

    await expect(
      syncActivateMcpServerTool(registry, undefined, NOOP),
    ).resolves.toBeUndefined();
    expect(findActivationTool(registry)).toBeUndefined();
  });
});

describe('Config.refreshMcpContext — MCP lazy tool synchronization', () => {
  let config: Config;

  beforeEach(async () => {
    resetSettingsService();
    registerSettingsService(new SettingsService());
    config = new Config({
      model: 'test-model',
      question: 'test',
      embeddingModel: 'test-embedding',
      targetDir: '.',
      usageStatisticsEnabled: false,
      sessionId: 'test-session-lazy',
      debugMode: false,
      cwd: '.',
    });
    await initializeTestConfig(config);
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    resetSettingsService();
  });

  it('registers activation tool when deferred servers exist, absent when off (D2)', async () => {
    const registry: ToolRegistry = config.getToolRegistry();
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));

    config.setEphemeralSetting('mcp.lazy', true);
    await config.refreshMcpContext();
    expect(findActivationTool(registry)).toBeDefined();

    config.setEphemeralSetting('mcp.lazy', false);
    await config.refreshMcpContext();
    expect(findActivationTool(registry)).toBeUndefined();
  }, 15_000);

  it('rebuilds activation enum after tool list changes (C4)', async () => {
    config.setEphemeralSetting('mcp.lazy', true);
    const registry: ToolRegistry = config.getToolRegistry();
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));

    await config.refreshMcpContext();
    const initialEnum = extractNameEnum(
      findActivationTool(registry)?.schema.parametersJsonSchema,
    );
    expect(initialEnum).toContain('alpha');
    expect(initialEnum).not.toContain('beta');

    registry.registerTool(mcpTool('mcp__beta__lookup', 'beta'));
    await config.refreshMcpContext();
    const rebuiltEnum = extractNameEnum(
      findActivationTool(registry)?.schema.parametersJsonSchema,
    );
    expect(rebuiltEnum).toContain('alpha');
    expect(rebuiltEnum).toContain('beta');
  });

  it('removes activation tool when all servers become eager (C4)', async () => {
    config.setEphemeralSetting('mcp.lazy', true);
    const registry: ToolRegistry = config.getToolRegistry();
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));

    await config.refreshMcpContext();
    expect(findActivationTool(registry)).toBeDefined();

    config.setEphemeralSetting('mcp.eagerServers', ['alpha']);
    await config.refreshMcpContext();
    expect(findActivationTool(registry)).toBeUndefined();
  });

  it('nested profile-like mcp settings make activation behavior available (D2)', async () => {
    const profileSettings = new SettingsService();
    profileSettings.set('mcp.lazy', true);
    registerSettingsService(profileSettings);
    const nestedConfig = new Config({
      model: 'test-model',
      question: 'test',
      embeddingModel: 'test-embedding',
      targetDir: '.',
      usageStatisticsEnabled: false,
      sessionId: 'test-session-nested',
      debugMode: false,
      cwd: '.',
      settingsService: profileSettings,
    });
    await initializeTestConfig(nestedConfig);

    const registry: ToolRegistry = nestedConfig.getToolRegistry();
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));
    await nestedConfig.refreshMcpContext();

    expect(findActivationTool(registry)).toBeDefined();
    expect(registry.listDeferredMcpServers()).toContain('alpha');
  });
});
