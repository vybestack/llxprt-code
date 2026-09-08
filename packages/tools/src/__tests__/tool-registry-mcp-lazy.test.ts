/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ToolRegistry } from '../tools/tool-registry.js';
import { BaseDeclarativeTool, Kind } from '../tools/tools.js';
import type {
  IToolRegistryHost,
  IToolMessageBus,
  ToolInvocation,
  ToolResult,
} from '../index.js';
import type { PublishSubscribeCapable } from '../interfaces/index.js';
import { ActivateMcpServerTool } from '../tools/activate-mcp-server.js';
import { ACTIVATE_MCP_SERVER_TOOL_NAME } from '../types/tool-names.js';

class TestMcpTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  readonly serverName: string;

  constructor(name: string, serverName: string, description: string) {
    const schema = zodToJsonSchema(
      z.object({
        query: z.string().describe('the query to run'),
        limit: z.number().optional().describe('max results'),
        path: z.string().optional().describe('target path'),
        selector: z.string().optional().describe('element selector'),
        value: z.string().optional().describe('value to apply'),
        timeout: z.number().optional().describe('operation timeout'),
      }),
    );
    super(
      name,
      `${name} (${serverName})`,
      description,
      Kind.Other,
      schema,
      true,
      false,
    );
    this.serverName = serverName;
  }

  protected createInvocation(
    _params: Record<string, unknown>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    throw new Error('not used in registry declaration tests');
  }
}

class TestBuiltinTool extends BaseDeclarativeTool<
  Record<string, unknown>,
  ToolResult
> {
  constructor(name: string, description: string) {
    const schema = zodToJsonSchema(
      z.object({ input: z.string().describe('the input') }),
    );
    super(name, name, description, Kind.Other, schema, true, false);
  }

  protected createInvocation(
    _params: Record<string, unknown>,
  ): ToolInvocation<Record<string, unknown>, ToolResult> {
    throw new Error('not used in registry declaration tests');
  }
}

function createHost(
  ephemerals: Record<string, unknown> = {},
): IToolRegistryHost {
  return {
    getEphemeralSettings: () => ephemerals,
    getCoreTools: () => [],
    getExcludeTools: () => [],
  };
}

function createMessageBus(): IToolMessageBus & PublishSubscribeCapable {
  return {
    requestConfirmation: async () => undefined,
    publish: () => {},
    subscribe: () => () => {},
    unsubscribe: () => {},
  };
}

function namesOf(decls: Array<{ name?: string }>): string[] {
  return decls
    .map((d) => d.name)
    .filter((n): n is string => typeof n === 'string')
    .sort();
}

function mcpTool(name: string, server: string, desc = name): TestMcpTool {
  return new TestMcpTool(name, server, desc);
}

function builtinTool(name: string, desc = name): TestBuiltinTool {
  return new TestBuiltinTool(name, desc);
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasNameEnum(
  schema: unknown,
): schema is { properties: { name: { enum: string[] } } } {
  if (!isStringRecord(schema)) return false;
  const properties = schema['properties'];
  if (!isStringRecord(properties)) return false;
  const nameProp = properties['name'];
  if (!isStringRecord(nameProp)) return false;
  const enumValues = nameProp['enum'];
  return (
    Array.isArray(enumValues) &&
    enumValues.every((v): v is string => typeof v === 'string')
  );
}

function nameEnumIncludes(schema: unknown, serverName: string): boolean {
  return (
    hasNameEnum(schema) && schema.properties.name.enum.includes(serverName)
  );
}

describe('ToolRegistry — MCP lazy schema deferral', () => {
  describe('A1-A5: lazy/eager/activation declaration behavior', () => {
    const lazyOffCases: ReadonlyArray<[string, Record<string, unknown>]> = [
      ['absent', {}],
      ['false', { 'mcp.lazy': false }],
      ['malformed', { 'mcp.lazy': 'yes' }],
    ];

    for (const [label, ephemerals] of lazyOffCases) {
      it(`emits all declarations when mcp.lazy is ${label}`, () => {
        const registry = new ToolRegistry(
          createHost(ephemerals),
          createMessageBus(),
        );
        registry.registerTool(builtinTool('read_file'));
        registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));

        const decls = registry.getFunctionDeclarations();
        expect(namesOf(decls)).toStrictEqual([
          'mcp__alpha__search',
          'read_file',
        ]);
      });
    }

    it('leaves builtins unchanged with lazy on and no MCP tools (A2)', () => {
      const registry = new ToolRegistry(
        createHost({ 'mcp.lazy': true }),
        createMessageBus(),
      );
      registry.registerTool(builtinTool('read_file'));

      const decls = registry.getFunctionDeclarations();
      expect(namesOf(decls)).toStrictEqual(['read_file']);
      expect(
        decls.find((d) => d.name === ACTIVATE_MCP_SERVER_TOOL_NAME),
      ).toBeUndefined();
    });

    it('omits deferred alpha/beta schemas while keeping non-MCP (A3)', () => {
      const registry = new ToolRegistry(
        createHost({ 'mcp.lazy': true }),
        createMessageBus(),
      );
      registry.registerTool(builtinTool('read_file'));
      registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));
      registry.registerTool(mcpTool('mcp__beta__lookup', 'beta'));

      const decls = registry.getFunctionDeclarations();
      expect(
        decls.find((d) => d.name === 'mcp__alpha__search'),
      ).toBeUndefined();
      expect(decls.find((d) => d.name === 'mcp__beta__lookup')).toBeUndefined();
      expect(namesOf(decls)).toContain('read_file');
    });

    it('keeps alpha eager while beta stays deferred (A4)', () => {
      const registry = new ToolRegistry(
        createHost({ 'mcp.lazy': true, 'mcp.eagerServers': ['alpha'] }),
        createMessageBus(),
      );
      registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));
      registry.registerTool(mcpTool('mcp__beta__lookup', 'beta'));

      const decls = registry.getFunctionDeclarations();
      expect(decls.find((d) => d.name === 'mcp__alpha__search')).toBeDefined();
      expect(decls.find((d) => d.name === 'mcp__beta__lookup')).toBeUndefined();
    });

    const malformedEagerCases: ReadonlyArray<[string, unknown]> = [
      ['absent', undefined],
      ['malformed string', 'alpha'],
      ['unknown server name', ['nonexistent']],
    ];

    for (const [label, value] of malformedEagerCases) {
      const observeTreatsEagerServersLabelAsIrrelevantEmptyA5At205 = () => {
        const ephemerals: Record<string, unknown> = { 'mcp.lazy': true };
        if (value !== undefined) {
          ephemerals['mcp.eagerServers'] = value;
        }
        const registry = new ToolRegistry(
          createHost(ephemerals),
          createMessageBus(),
        );
        registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));
        const decls = registry.getFunctionDeclarations();
        return { decls };
      };

      it(`treats eagerServers ${label} as irrelevant/empty (A5)`, () => {
        const { decls } =
          observeTreatsEagerServersLabelAsIrrelevantEmptyA5At205();
        expect(
          decls.find((d) => d.name === 'mcp__alpha__search'),
        ).toBeUndefined();
      });
    }
  });

  it('omits a governance-disabled MCP tool even from an eager server (A6)', () => {
    const registry = new ToolRegistry(
      createHost({
        'mcp.lazy': true,
        'mcp.eagerServers': ['alpha'],
        'tools.disabled': ['mcp__alpha__search'],
      }),
      createMessageBus(),
    );
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));

    const decls = registry.getFunctionDeclarations();
    expect(decls.find((d) => d.name === 'mcp__alpha__search')).toBeUndefined();
  });

  it('getFunctionDeclarationsFiltered returns deferred tool by name (A7)', () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));

    const filtered = registry.getFunctionDeclarationsFiltered([
      'mcp__alpha__search',
    ]);
    expect(filtered.find((d) => d.name === 'mcp__alpha__search')).toBeDefined();
  });

  it('listDeferredMcpServers returns non-eager/non-activated servers', () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true, 'mcp.eagerServers': ['gamma'] }),
      createMessageBus(),
    );
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));
    registry.registerTool(mcpTool('mcp__beta__lookup', 'beta'));
    registry.registerTool(mcpTool('mcp__gamma__compute', 'gamma'));

    expect(registry.listDeferredMcpServers()).toStrictEqual(['alpha', 'beta']);
  });

  it('listDeferredMcpServers returns empty when lazy mode is off', () => {
    const registry = new ToolRegistry(createHost({}), createMessageBus());
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));

    expect(registry.listDeferredMcpServers()).toStrictEqual([]);
  });

  it('a fresh registry starts with no activation state (C5)', () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));

    expect(registry.listDeferredMcpServers()).toStrictEqual(['alpha']);
  });
});

describe('ToolRegistry — activation lifecycle (B5, B7, C1-C3)', () => {
  it('activateMcpServer throws for unknown server (B7)', () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));

    expect(() => registry.activateMcpServer('nonexistent')).toThrow(
      'Unknown MCP server "nonexistent"',
    );
    expect(registry.listDeferredMcpServers()).toContain('alpha');
  });

  it('activation is idempotent and schemas stay published (B5, C1)', () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));

    registry.activateMcpServer('alpha');
    registry.activateMcpServer('alpha');

    const decls1 = registry.getFunctionDeclarations();
    const decls2 = registry.getFunctionDeclarations();
    expect(decls1.find((d) => d.name === 'mcp__alpha__search')).toBeDefined();
    expect(decls2.find((d) => d.name === 'mcp__alpha__search')).toBeDefined();
    expect(registry.listDeferredMcpServers()).not.toContain('alpha');
  });

  it('disconnect removes activated server schemas and clears stale activation (C2)', () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));

    registry.activateMcpServer('alpha');
    registry.removeMcpToolsByServer('alpha');

    const decls = registry.getFunctionDeclarations();
    expect(decls.find((d) => d.name === 'mcp__alpha__search')).toBeUndefined();
    expect(registry.listDeferredMcpServers()).not.toContain('alpha');
  });

  it('reconnect re-publishes activated server schemas in the same session (C3)', () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));

    registry.activateMcpServer('alpha');
    registry.removeMcpToolsByServer('alpha');
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha', 'alpha v2'));

    const decls = registry.getFunctionDeclarations();
    expect(decls.find((d) => d.name === 'mcp__alpha__search')).toBeDefined();
  });
});

describe('ActivateMcpServerTool — schema and description', () => {
  it('name enum contains deferred servers (B2)', () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));
    registry.registerTool(mcpTool('mcp__beta__lookup', 'beta'));

    const tool = new ActivateMcpServerTool(
      registry,
      createMessageBus(),
      async () => {},
    );
    const paramSchema = tool.schema.parametersJsonSchema;
    expect(hasNameEnum(paramSchema)).toBe(true);
    expect(nameEnumIncludes(paramSchema, 'alpha')).toBe(true);
    expect(nameEnumIncludes(paramSchema, 'beta')).toBe(true);
  });

  it('description contains server names, tool counts, and tool names without full schemas (B2)', () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));
    registry.registerTool(mcpTool('mcp__alpha__insert', 'alpha'));
    registry.registerTool(mcpTool('mcp__beta__lookup', 'beta'));

    const tool = new ActivateMcpServerTool(
      registry,
      createMessageBus(),
      async () => {},
    );
    const description = tool.description;
    expect(description).toContain('alpha');
    expect(description).toContain('beta');
    expect(description).toContain('2 tool(s)');
    expect(description).toContain('1 tool(s)');
    expect(description).toContain('mcp__alpha__search');
    expect(description).toContain('mcp__beta__lookup');
    expect(description).not.toContain('"properties"');
  });

  it('shows 12 names and an omitted-count marker for >12 tools (B3)', () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    for (let i = 0; i < 15; i++) {
      registry.registerTool(mcpTool(`mcp__alpha__tool_${i}`, 'alpha'));
    }

    const tool = new ActivateMcpServerTool(
      registry,
      createMessageBus(),
      async () => {},
    );
    const description = tool.description;
    expect(description).toContain('15 tool(s)');
    expect(description).toContain('mcp__alpha__tool_0');
    expect(description).toContain('mcp__alpha__tool_14');
    expect(description).toMatch(/\+3/);
  });

  it('throws when constructed with no deferred servers', () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );

    expect(
      () =>
        new ActivateMcpServerTool(registry, createMessageBus(), async () => {}),
    ).toThrow('at least one deferred MCP server');
  });

  it('unknown server name fails enum validation at build (B7)', () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));

    const tool = new ActivateMcpServerTool(
      registry,
      createMessageBus(),
      async () => {},
    );

    expect(() => tool.build({ name: 'nonexistent' })).toThrow(
      /must be equal to one of/,
    );
  });

  it('activation execution awaits refresh before resolving (B4)', async () => {
    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    registry.registerTool(mcpTool('mcp__alpha__search', 'alpha'));
    registry.registerTool(mcpTool('mcp__beta__lookup', 'beta'));

    let refreshResolved = false;
    const refreshPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        refreshResolved = true;
        resolve();
      }, 10);
    });
    const refreshMcpContext = (): Promise<void> => refreshPromise;

    const tool = new ActivateMcpServerTool(
      registry,
      createMessageBus(),
      refreshMcpContext,
    );
    const invocation = tool.build({ name: 'alpha' });
    const result = await invocation.execute(new AbortController().signal);

    expect(refreshResolved).toBe(true);
    expect(result.llmContent).toContain('alpha');
    expect(result.llmContent).toContain('available');

    const decls = registry.getFunctionDeclarations();
    expect(decls.find((d) => d.name === 'mcp__alpha__search')).toBeDefined();
    expect(decls.find((d) => d.name === 'mcp__beta__lookup')).toBeUndefined();
  });
});

describe('E1/E2: lazy mode produces smaller serialized payload', () => {
  it('lazy declarations are fewer and smaller than eager for the same tools', () => {
    const builtin = builtinTool('read_file');
    const alpha = mcpTool('mcp__alpha__search', 'alpha');
    const beta = mcpTool('mcp__beta__lookup', 'beta');

    const eagerRegistry = new ToolRegistry(createHost({}), createMessageBus());
    eagerRegistry.registerTool(builtin);
    eagerRegistry.registerTool(alpha);
    eagerRegistry.registerTool(beta);
    const eagerDecls = eagerRegistry.getFunctionDeclarations();

    const lazyRegistry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    lazyRegistry.registerTool(builtin);
    lazyRegistry.registerTool(alpha);
    lazyRegistry.registerTool(beta);
    lazyRegistry.registerTool(
      new ActivateMcpServerTool(
        lazyRegistry,
        createMessageBus(),
        async () => {},
      ),
    );
    const lazyDecls = lazyRegistry.getFunctionDeclarations();

    const eagerSize = JSON.stringify(eagerDecls).length;
    const lazySize = JSON.stringify(lazyDecls).length;

    expect(eagerDecls).toHaveLength(3);
    expect(lazyDecls.length).toBeLessThan(eagerDecls.length);
    expect(lazySize).toBeLessThan(eagerSize);
  });

  it('reduction is attributable to deferred alpha when beta is activated', () => {
    const builtin = builtinTool('read_file');
    const alphaSearch = mcpTool('mcp__alpha__search', 'alpha');
    const alphaInsert = mcpTool('mcp__alpha__insert', 'alpha');
    const beta = mcpTool('mcp__beta__lookup', 'beta');

    const registry = new ToolRegistry(
      createHost({ 'mcp.lazy': true }),
      createMessageBus(),
    );
    registry.registerTool(builtin);
    registry.registerTool(alphaSearch);
    registry.registerTool(alphaInsert);
    registry.registerTool(beta);
    registry.activateMcpServer('beta');
    registry.registerTool(
      new ActivateMcpServerTool(registry, createMessageBus(), async () => {}),
    );

    const decls = registry.getFunctionDeclarations();
    expect(decls.find((d) => d.name === 'mcp__beta__lookup')).toBeDefined();
    expect(decls.find((d) => d.name === 'mcp__alpha__search')).toBeUndefined();

    const eagerRegistry = new ToolRegistry(createHost({}), createMessageBus());
    eagerRegistry.registerTool(builtin);
    eagerRegistry.registerTool(alphaSearch);
    eagerRegistry.registerTool(alphaInsert);
    eagerRegistry.registerTool(beta);
    const eagerDecls = eagerRegistry.getFunctionDeclarations();

    expect(JSON.stringify(decls).length).toBeLessThan(
      JSON.stringify(eagerDecls).length,
    );
  });
});
