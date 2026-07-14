/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the ISSUE-2376 enriched tool projection + named-tool
 * lookup handle. Drives the REAL ToolControl over a fake Config whose
 * getToolRegistry() returns REAL MockTool instances (genuine
 * BaseDeclarativeTool subclasses with real .build()/.schema/.displayName), so
 * the assertions exercise real behavior — not mock call counts.
 *
 * Covers:
 *  - list() projects description/displayName/parametersSchema from the registry.
 *  - get('read_many_files') returns a handle whose build().getDescription()
 *    and execute() delegate to the real tool.
 *  - get('nonexistent') returns undefined.
 *  - buildAndExecute() convenience works end-to-end.
 *  - setContext() is present on context-aware tools and absent on plain tools.
 *  - mcp details() resources include description.
 */

import { describe, it, expect } from 'vitest';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { MockTool } from '@vybestack/llxprt-code-core/test-utils/mock-tool.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AnyDeclarativeTool } from '@vybestack/llxprt-code-tools';
import { Kind } from '@vybestack/llxprt-code-tools';
import { ToolControl } from '../control/toolControl.js';
import type { ToolControlDeps } from '../control/toolControl.js';
import { createToolControlDeps } from './helpers/fakeToolControlDeps.js';
import { projectRegistryTool } from '../agentBootstrap.js';
import { McpControl } from '../control/mcpControl.js';
import type { McpControlDeps } from '../control/mcpControl.js';
import type { EditorCallbacks } from '../config-types.js';
import { getToolKeyStorage } from '@vybestack/llxprt-code-core';

const noopEditorCallbacks: EditorCallbacks = {
  getPreferredEditor: () => undefined,
  onEditorClose: () => {},
  onEditorOpen: () => {},
};

/**
 * Builds a ToolControlDeps backed by REAL MockTool instances. The fake
 * registry duck-types the ToolRegistry surface ToolControl reads
 * (getAllTools/getEnabledTools/getTool), returning the genuine tool objects so
 * list()/get() project real .schema/.displayName/.build() behavior.
 */
function buildDepsWithRealTools(
  tools: readonly AnyDeclarativeTool[],
  opts: { readonly enabledNames?: readonly string[] } = {},
): ToolControlDeps {
  const enabledSet = new Set(opts.enabledNames ?? tools.map((t) => t.name));
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const toolRegistry = {
    getAllTools: () => [...tools],
    getEnabledTools: () => tools.filter((t) => enabledSet.has(t.name)),
    getTool: (name: string): AnyDeclarativeTool | undefined =>
      toolMap.get(name),
  };
  const settingsService = { set: () => {} };
  const config = {
    getToolRegistry: () => toolRegistry,
    getSettingsService: () => settingsService,
  } as unknown as Config;
  const messageBus = new MessageBus();
  return {
    messageBus,
    config,
    editorCallbacksHolder: { editorCallbacks: noopEditorCallbacks },
    keysDeps: { getStorage: () => getToolKeyStorage() },
  };
}

describe('ToolControl.list enriched projection @plan:ISSUE-2376', () => {
  it('projects displayName, description, and parametersSchema from the real registry tools', () => {
    const tool = new MockTool({
      name: 'read_many_files',
      displayName: 'Read Many Files',
      description: 'Reads many files at once.',
    });
    const deps = buildDepsWithRealTools([tool]);
    const control = new ToolControl(deps);
    const tools = control.list();
    expect(Object.isFrozen(tools)).toBe(true);
    const info = tools.find((t) => t.name === 'read_many_files');
    expect(info).toBeDefined();
    // buildDepsWithRealTools defaults every tool to enabled; verify the
    // enabled-set lookup projects true so a regression there is caught.
    expect(info?.enabled).toBe(true);
    expect(info?.displayName).toBe('Read Many Files');
    expect(info?.description).toBe('Reads many files at once.');
    // MockTool is constructed with a parameter schema; parametersJsonSchema
    // must be projected from tool.schema.parametersJsonSchema — assert the
    // actual content, not just that some object is present.
    expect(info?.parametersSchema).toBeDefined();
    expect(typeof info?.parametersSchema).toBe('object');
    expect((info?.parametersSchema as Record<string, unknown>).type).toBe(
      'object',
    );
    expect(
      (info?.parametersSchema as Record<string, unknown>).properties,
    ).toBeDefined();
  });

  it('projects enabled=false for tools not in the enabled set', () => {
    const tool = new MockTool({ name: 'disabled_tool' });
    // Pass an empty enabled set so the tool is present but NOT enabled.
    const deps = buildDepsWithRealTools([tool], { enabledNames: [] });
    const control = new ToolControl(deps);
    const info = control.list().find((t) => t.name === 'disabled_tool');
    expect(info).toBeDefined();
    expect(info?.enabled).toBe(false);
  });

  it('omits parametersSchema when the tool schema is null (null does not leak as a type lie)', () => {
    // DeclarativeTool.schema can yield parametersJsonSchema: null at runtime.
    // projectRegistryTool must include parametersSchema ONLY when the value is
    // a non-null object — a null must NOT leak into ToolInfo.parametersSchema.
    const projected = projectRegistryTool({
      name: 'null-schema-tool',
      displayName: 'Null Schema Tool',
      description: 'A tool whose schema resolved to null.',
      schema: { parametersJsonSchema: null },
    });
    expect(projected.parametersSchema).toBeUndefined();
  });

  it('projects source builtin/server for builtin tools and omits serverToolName for non-MCP tools', () => {
    const tool = new MockTool({ name: 'glob' });
    const deps = buildDepsWithRealTools([tool]);
    const control = new ToolControl(deps);
    const info = control.list().find((t) => t.name === 'glob');
    expect(info?.source).toBe('builtin');
    expect(info?.server).toBeUndefined();
    expect(info?.serverToolName).toBeUndefined();
  });
});

describe('ToolControl.get named-tool lookup handle @plan:ISSUE-2376', () => {
  it('returns undefined for an unknown tool name', () => {
    const deps = buildDepsWithRealTools([new MockTool({ name: 'glob' })]);
    const control = new ToolControl(deps);
    expect(control.get('nonexistent')).toBeUndefined();
  });

  it('returns a handle whose build().getDescription() delegates to the real tool', () => {
    const tool = new MockTool({
      name: 'read_many_files',
      displayName: 'Read Many Files',
      description: 'Reads many files.',
    });
    const deps = buildDepsWithRealTools([tool]);
    const control = new ToolControl(deps);
    const handle = control.get('read_many_files');
    expect(handle).toBeDefined();
    expect(handle?.name).toBe('read_many_files');
    expect(handle?.displayName).toBe('Read Many Files');
    expect(handle?.description).toBe('Reads many files.');
    // Kind is projected from the real tool (MockTool uses Kind.Other).
    expect(handle?.kind).toBe(Kind.Other);

    const invocation = handle!.build({});
    // MockToolInvocation.getDescription() returns a deterministic string.
    expect(invocation.getDescription()).toContain('read_many_files');
  });

  it('build().execute() delegates to the real tool and projects llmContent/returnDisplay', async () => {
    const tool = new MockTool({
      name: 'read_many_files',
      execute: async () => ({
        llmContent: 'file contents here',
        returnDisplay: 'Read 3 files.',
      }),
    });
    const deps = buildDepsWithRealTools([tool]);
    const control = new ToolControl(deps);
    const handle = control.get('read_many_files');
    const invocation = handle!.build({});
    const result = await invocation.execute(new AbortController().signal);
    expect(result.llmContent).toBe('file contents here');
    expect(result.returnDisplay).toBe('Read 3 files.');
    expect(result.error).toBeUndefined();
  });

  it('buildAndExecute() convenience runs build + execute end-to-end', async () => {
    const tool = new MockTool({
      name: 'glob',
      execute: async () => ({
        llmContent: 'a.ts\nb.ts',
        returnDisplay: 'Found 2 files.',
      }),
    });
    const deps = buildDepsWithRealTools([tool]);
    const control = new ToolControl(deps);
    const handle = control.get('glob');
    const result = await handle!.buildAndExecute(
      { pattern: '*.ts' },
      new AbortController().signal,
    );
    expect(result.llmContent).toBe('a.ts\nb.ts');
    expect(result.returnDisplay).toBe('Found 2 files.');
  });

  it('build().shouldConfirmExecute() and toolLocations() delegate to the real invocation', async () => {
    const tool = new MockTool({
      name: 'edit',
      displayName: 'Edit',
    });
    const deps = buildDepsWithRealTools([tool]);
    const control = new ToolControl(deps);
    const handle = control.get('edit');
    const invocation = handle!.build({});
    // MockTool defaults shouldConfirm to false → shouldConfirmExecute resolves false.
    const confirmation = await invocation.shouldConfirmExecute(
      new AbortController().signal,
    );
    expect(confirmation).toBe(false);
    // BaseToolInvocation.toolLocations() returns [] by default.
    expect(invocation.toolLocations()).toStrictEqual([]);
  });

  it('setContext() is present and mutates context on a context-aware tool', () => {
    // BaseTool (the legacy superclass) implements ContextAwareTool, so a MockTool
    // built via BaseDeclarativeTool does NOT carry `context` by default. We
    // attach a context property to simulate a context-aware tool the way real
    // tools (extending BaseTool) do.
    const tool = new MockTool({ name: 'shell' }) as AnyDeclarativeTool & {
      context?: unknown;
    };
    // Simulate a context-aware tool by adding the property the 'context' in tool
    // check looks for.
    Object.defineProperty(tool, 'context', {
      value: undefined,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    const deps = buildDepsWithRealTools([tool]);
    const control = new ToolControl(deps);
    const handle = control.get('shell');
    expect(typeof handle?.setContext).toBe('function');
    handle!.setContext!({ sessionId: 's1', interactiveMode: true });
    expect(tool.context).toStrictEqual({
      sessionId: 's1',
      interactiveMode: true,
    });
  });

  it('setContext() is absent on a plain (non-context-aware) tool', () => {
    const tool = new MockTool({ name: 'glob' });
    const deps = buildDepsWithRealTools([tool]);
    const control = new ToolControl(deps);
    const handle = control.get('glob');
    // A plain MockTool has no `context` property, so setContext is NOT attached.
    expect(handle?.setContext).toBeUndefined();
  });
});

describe('McpControl details() resource description projection @plan:ISSUE-2376', () => {
  it('projects resource description onto McpResourceInfo', async () => {
    const resources = [
      {
        serverName: 'srv',
        name: 'res1',
        uri: 'file:///res1',
        description: 'A test resource.',
      },
      {
        serverName: 'srv',
        name: 'res2',
        uri: 'file:///res2',
      },
    ];
    const resourceRegistry = {
      getAllResources: () => resources,
    };
    const deps: McpControlDeps = {
      isMcpAuthenticated: () => false,
      getManager: () => undefined,
      getToolRegistry: () => undefined,
      getServerConfigs: () => ({
        srv: { type: 'stdio', command: 'fake' },
      }),
      getResourceRegistry: () => resourceRegistry,
      getOAuthStatus: async () => 'not-required',
      getRequiresAuth: () => false,
    };
    const control = new McpControl(deps);
    const detail = await control.details({ includeResources: true });
    const server = detail.servers.find((s) => s.name === 'srv');
    expect(server?.resources).toHaveLength(2);
    const byUri = new Map(server!.resources!.map((r) => [r.uri, r]));
    expect(byUri.get('file:///res1')?.description).toBe('A test resource.');
    expect(byUri.get('file:///res2')?.description).toBeUndefined();
  });
});

describe('ToolControl.get via hardened fakeToolControlDeps @plan:ISSUE-2376', () => {
  it('returns real invocable tools whose build().execute() returns real behavior', async () => {
    const { deps } = createToolControlDeps([
      { name: 'fake_tool', enabled: true },
    ]);
    const control = new ToolControl(deps);
    const handle = control.get('fake_tool');
    expect(handle).toBeDefined();
    expect(handle?.name).toBe('fake_tool');

    const invocation = handle!.build({});
    // MockToolInvocation.getDescription() returns a deterministic string.
    expect(invocation.getDescription()).toContain('fake_tool');

    const result = await invocation.execute(new AbortController().signal);
    // The hardened fake returns ran:<name> for llmContent and returnDisplay.
    expect(result.llmContent).toBe('ran:fake_tool');
    expect(result.returnDisplay).toBe('ran:fake_tool');
  });

  it('buildAndExecute() runs build + execute end-to-end through the public surface', async () => {
    const { deps } = createToolControlDeps([
      { name: 'batch_tool', enabled: true },
    ]);
    const control = new ToolControl(deps);
    const handle = control.get('batch_tool');
    const result = await handle!.buildAndExecute(
      { key: 'val' },
      new AbortController().signal,
    );
    expect(result.llmContent).toBe('ran:batch_tool');
    expect(result.returnDisplay).toBe('ran:batch_tool');
  });

  it('projects serverName/serverToolName for MCP tools in list()', () => {
    const { deps } = createToolControlDeps([
      { name: 'mcp_tool', serverName: 'srv', serverToolName: 'remote_tool' },
    ]);
    const control = new ToolControl(deps);
    const info = control.list().find((t) => t.name === 'mcp_tool');
    expect(info).toBeDefined();
    expect(info?.source).toBe('mcp');
    expect(info?.server).toBe('srv');
    expect(info?.serverToolName).toBe('remote_tool');
  });

  it('get() returns a handle with source "mcp" for MCP tools and "builtin" for others', () => {
    // Covers wrapToolHandle's MCP detection, which now uses the same
    // readOptionalStringProp accessor as list() so both surfaces classify
    // tools identically (@plan:ISSUE-2376).
    const { deps } = createToolControlDeps([
      { name: 'mcp_tool', serverName: 'srv', serverToolName: 'remote_tool' },
      { name: 'builtin_tool' },
    ]);
    const control = new ToolControl(deps);
    expect(control.get('mcp_tool')?.source).toBe('mcp');
    expect(control.get('builtin_tool')?.source).toBe('builtin');
  });
});
