/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createRuntimeStateFromConfig,
  type AgentClientContract,
  type AgentClientFactory,
  type ToolRegistry,
} from '@vybestack/llxprt-code-core';

type AgentClientFactorySource = Parameters<AgentClientFactory>[0];

export interface DetachedAutoPromptClientSource {
  getSessionId?(): string | undefined;
  getProvider?(): string | undefined;
  getModel?(): string | undefined;
  getContentGeneratorConfig?(): { model?: string } | undefined;
  getEphemeralSetting?(key: string): unknown;
  getProxy?(): string | undefined;
  getToolRegistry(): ToolRegistry;
  getAgentClientFactory?(): AutoPromptAgentClientFactory | undefined;
}

export type AutoPromptAgentClientFactory = AgentClientFactory;

function isAgentClientContract(value: unknown): value is AgentClientContract {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.generateDirectMessage === 'function' &&
    typeof candidate.clearTools === 'function' &&
    typeof candidate.dispose === 'function'
  );
}

function disposeInvalidClient(value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    return;
  }
  const candidate = value as { dispose?: unknown };
  if (typeof candidate.dispose === 'function') {
    candidate.dispose();
  }
}

function hasAgentClientFactorySource(
  value: unknown,
): value is AgentClientFactorySource {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.getContentGeneratorConfig === 'function' &&
    typeof candidate.getToolRegistry === 'function'
  );
}

function createDetachedRuntimeId(baseRuntimeId: string | undefined): string {
  const timestamp = Date.now().toString(36);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${baseRuntimeId ?? 'llxprt-session'}#subagent-auto#${timestamp}-${suffix}`;
}

export function createDetachedAutoPromptClient(
  source: DetachedAutoPromptClientSource,
): AgentClientContract {
  const baseRuntimeId =
    typeof source.getSessionId === 'function'
      ? source.getSessionId()
      : undefined;
  const runtimeState = createRuntimeStateFromConfig(source, {
    runtimeId: createDetachedRuntimeId(baseRuntimeId),
  });
  const factory = source.getAgentClientFactory?.();
  if (factory === undefined) {
    throw new Error(
      'No agent client factory available. Run /auth login or try manual mode.',
    );
  }
  if (!hasAgentClientFactorySource(source)) {
    throw new Error(
      'Agent client factory source is incomplete. Run /auth login or try manual mode.',
    );
  }
  const factorySource: AgentClientFactorySource = source;
  let client: unknown;
  try {
    client = factory(factorySource, runtimeState);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create detached auto-prompt client: ${message}`);
  }
  if (!isAgentClientContract(client)) {
    try {
      disposeInvalidClient(client);
    } catch {
      // Preserve the validation error; disposal failure is secondary cleanup.
    }
    throw new Error(
      'Agent client factory returned an invalid contract. Check for version mismatch or provider misconfiguration.',
    );
  }
  try {
    client.clearTools();
  } catch (error) {
    try {
      disposeInvalidClient(client);
    } catch {
      // Preserve the clearTools error; disposal failure is secondary cleanup.
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to initialize detached auto-prompt client: ${message}`,
    );
  }
  return client;
}
