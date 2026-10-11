import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { resolveShellJobSettings } from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P17
 * @requirement:REQ-006
 *
 * Focused infra fake for ToolControlDeps (NOT the Agent under test). Lives
 * under __tests__/helpers/ so deep imports of core/policy types are permitted
 * while staying excluded from the T17 boundary scan.
 *
 * Uses a REAL core MessageBus (so respondToConfirmation publishes a real
 * TOOL_CONFIRMATION_RESPONSE message a subscriber can observe), a minimal
 * settings-service that records the last `tools.allowed` value, and an
 * in-memory tool registry. The single class-narrowing cast is isolated here.
 */

import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type ToolConfirmationResponse,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
// @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
import { getToolKeyStorage } from '@vybestack/llxprt-code-core';
import type {
  ToolConfirmationOutcome,
  ToolConfirmationPayload,
} from '@vybestack/llxprt-code-tools';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import type { AnyDeclarativeTool } from '@vybestack/llxprt-code-tools';
import type { EditorCallbacks } from '../../config-types.js';
import type { ToolControlDeps } from '../../control/toolControl.js';
import { ShellJobOwner } from '../../../session/shell-job-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

import { afterEach } from 'bun:test';

const fixtureRoots: Array<{
  config: Config;
  settingsOwner: SessionSettingsOwner;
  shellOwner: ShellJobOwner;
}> = [];
afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map(async (root) => {
      await root.shellOwner.dispose();
      await root.settingsOwner.dispose();
      await root.config.dispose();
    }),
  );
});

export { MessageBusType };

export interface FakeRegistryToolEntry {
  readonly name: string;
  readonly serverName?: string;
  readonly enabled?: boolean;
  readonly serverToolName?: string;
}

export interface ToolControlDepsHandle {
  readonly deps: ToolControlDeps;
  readonly messageBus: MessageBus;
  /** Returns the last value written to the `tools.allowed` ephemeral setting. */
  lastAllowed(): readonly string[] | undefined;
  /** The shared editor-callbacks holder ToolControl mutates. */
  editorCallbacksHolder: { editorCallbacks: EditorCallbacks };
  /** All TOOL_CONFIRMATION_RESPONSE messages the bus published. */
  responses(): ReadonlyArray<{
    readonly correlationId: string;
    readonly outcome?: ToolConfirmationOutcome;
    readonly payload?: ToolConfirmationPayload;
    readonly requiresUserConfirmation?: boolean;
  }>;
}

const noopEditorCallbacks: EditorCallbacks = {
  getPreferredEditor: () => undefined,
  onEditorClose: () => {},
  onEditorOpen: () => {},
};

/**
 * Builds REAL invocable MockTool instances so ToolControl.get(name) returns a
 * handle whose build()/buildAndExecute() delegate to genuine tool behavior
 * (execute returns { llmContent: `ran:${name}`, returnDisplay: '...' }).
 * serverName/serverToolName are attached at runtime for MCP tools so the
 * projectRegistryTool projection reads them (MockTool does not declare them;
 * they are runtime-only on real DiscoveredMCPTool instances).
 */
function buildFakeRegistryTools(
  tools: readonly FakeRegistryToolEntry[],
): AnyDeclarativeTool[] {
  const attachRuntimeProp = (
    mock: MockTool,
    key: 'serverName' | 'serverToolName',
    value: string | undefined,
  ): void => {
    if (value === undefined) return;
    Object.defineProperty(mock, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  };
  return tools.map((t) => {
    const mock = new MockTool({
      name: t.name,
      displayName: t.name,
      description: t.name,
      execute: async () => ({
        llmContent: `ran:${t.name}`,
        returnDisplay: `ran:${t.name}`,
      }),
    });
    attachRuntimeProp(mock, 'serverName', t.serverName);
    attachRuntimeProp(mock, 'serverToolName', t.serverToolName);
    return mock as AnyDeclarativeTool;
  });
}

export function createToolControlDeps(
  tools: readonly FakeRegistryToolEntry[] = [],
): ToolControlDepsHandle {
  const messageBus = new MessageBus();
  const editorCallbacksHolder = { editorCallbacks: noopEditorCallbacks };
  const responses: ToolConfirmationResponse[] = [];

  messageBus.subscribe<ToolConfirmationResponse>(
    MessageBusType.TOOL_CONFIRMATION_RESPONSE,
    (msg) => {
      responses.push(msg);
    },
  );

  const allTools: AnyDeclarativeTool[] = buildFakeRegistryTools(tools);
  // Derive enabledTools from the full AnyDeclarativeTool instances (allTools)
  // rather than fabricating { name } stubs, mirroring the real
  // ToolRegistry.getEnabledTools() which returns AnyDeclarativeTool[]. This
  // keeps the fake future-proof if production ever reads more than `.name`.
  const enabledNames = new Set(
    tools.filter((t) => t.enabled !== false).map((t) => t.name),
  );
  const enabledTools = allTools.filter((t) => enabledNames.has(t.name));

  const settingsService = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(settingsService);

  const toolMap = new Map(allTools.map((t) => [t.name, t]));
  const toolRegistry = {
    getAllToolNames: () => [...toolMap.keys()],
    getFunctionDeclarations: () => allTools.map((tool) => tool.schema),
    getFunctionDeclarationsFiltered: (names: string[]) =>
      allTools
        .filter((tool) => names.includes(tool.name))
        .map((tool) => tool.schema),
    getAllTools: () => allTools,
    getEnabledTools: () => enabledTools,
    getTool: (name: string): AnyDeclarativeTool | undefined =>
      toolMap.get(name),
  };

  const config = new Config({
    sessionId: 'tool-control-fixture',
    model: 'tool-control-fixture',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
  });
  const shellOwner = new ShellJobOwner(() =>
    resolveShellJobSettings(settingsService),
  );
  fixtureRoots.push({ config, settingsOwner, shellOwner });
  const deps: ToolControlDeps = {
    telemetry: settingsOwner.bindTelemetry(config),
    readExecutionPolicy: () => settingsOwner.readToolExecutionPolicy(),
    getToolGovernance: () => settingsOwner.readToolGovernance([]),
    selection: toolRegistry,
    setAllowedTools: (names) => {
      settingsOwner.setAllowedTools(names);
    },
    describeConfiguration: () => ({
      registered: allTools.map((tool) => ({ displayName: tool.name })),
      unregistered: [],
    }),
    messageBus,
    config,
    shellOwner,
    editorCallbacksHolder,
    displayCallbacksHolder: {},
    resolveClient: () => {
      throw new Error('not used by ToolControl tests');
    },
    // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
    keysDeps: { getStorage: () => getToolKeyStorage() },
  };

  return {
    deps,
    messageBus,
    lastAllowed: () => {
      const value = settingsOwner.readNamedParameter('tools.allowed');
      return Array.isArray(value)
        ? value.filter((name): name is string => typeof name === 'string')
        : undefined;
    },
    editorCallbacksHolder,
    responses: () => responses,
  };
}
