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
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { EditorCallbacks } from '../../config-types.js';
import type { ToolControlDeps } from '../../control/toolControl.js';

export { MessageBusType };

export interface FakeRegistryToolEntry {
  readonly name: string;
  readonly serverName?: string;
  readonly enabled?: boolean;
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
    readonly outcome: string;
  }>;
}

const noopEditorCallbacks: EditorCallbacks = {
  getPreferredEditor: () => undefined,
  onEditorClose: () => {},
  onEditorOpen: () => {},
};

export function createToolControlDeps(
  tools: readonly FakeRegistryToolEntry[] = [],
): ToolControlDepsHandle {
  const messageBus = new MessageBus();
  let allowed: readonly string[] | undefined;
  const editorCallbacksHolder = { editorCallbacks: noopEditorCallbacks };
  const responses: Array<{ correlationId: string; outcome: string }> = [];

  messageBus.subscribe(MessageBusType.TOOL_CONFIRMATION_RESPONSE, (msg) => {
    const m = msg as unknown as { correlationId: string; outcome: string };
    responses.push({ correlationId: m.correlationId, outcome: m.outcome });
  });

  const allTools = tools.map((t) => ({
    name: t.name,
    ...(t.serverName !== undefined ? { serverName: t.serverName } : {}),
  }));
  const enabledTools = tools
    .filter((t) => t.enabled !== false)
    .map((t) => ({ name: t.name }));

  const settingsService = {
    set: (key: string, value: unknown): void => {
      if (key === 'tools.allowed' && Array.isArray(value)) {
        allowed = value as readonly string[];
      }
    },
  };

  const toolRegistry = {
    getAllTools: () => allTools,
    getEnabledTools: () => enabledTools,
  };

  const config = {
    getToolRegistry: () => toolRegistry,
    getSettingsService: () => settingsService,
  } as unknown as Config;

  const deps: ToolControlDeps = {
    messageBus,
    config,
    editorCallbacksHolder,
  };

  return {
    deps,
    messageBus,
    lastAllowed: () => allowed,
    editorCallbacksHolder,
    responses: () => responses,
  };
}
