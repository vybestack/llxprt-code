/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AgentHistoryItem } from '../../agent.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
export function readinessTokenizer(): RuntimeTokenizerFactory {
  return {
    prepareTokenizer: async () => {},
    getTokenizer: () => ({
      fallbackPolicy: 'deny',
      countTokens: () => 1,
    }),
    estimatePrompt: async (request) => ({
      count: await request.legacyEstimate(),
      method: 'calibrated',
      family: 'test-readiness',
      estimatorVersion: 'test-readiness-v1',
      assetRevision: 'none',
      projectionRevision: request.projectionRevision,
    }),
  };
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise = (): void => {
    throw new Error('Barrier not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

export function textItem(
  speaker: 'human' | 'ai',
  text: string,
): AgentHistoryItem {
  return { speaker, blocks: [{ type: 'text', text }] };
}

export function itemText(item: AgentHistoryItem): string {
  return item.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

import { openRouteBPreflight } from '../helpers/route-b-preflight.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type { Agent } from '../../agent.js';
import type { AgentConfig } from '../../config-types.js';
import { runCleanupSteps } from '../../../core/subagent-cleanup.js';
export async function withTelemetryAgent<T>(
  fn: (agent: Agent, telemetry: RootTelemetry) => Promise<T>,
  overrides: Partial<AgentConfig> = {},
): Promise<T> {
  const route = await openRouteBPreflight({ config: overrides });
  const settingsOwner = new SessionSettingsOwner(route.settings);
  let agent: Agent | undefined;
  try {
    await route.prepare({ settingsOwner });
    agent = await route.createAgent();
    return await fn(agent, settingsOwner.telemetry);
  } finally {
    await runCleanupSteps([
      () => agent?.dispose(),
      () => route.disposePreflight(),
      () => route.close(),
      () => settingsOwner.dispose(),
    ]);
  }
}

import { expect } from 'bun:test';
import { readJournalFileFacts } from '../helpers/native-session-fixture.js';
export async function recordingSessionId(path: string): Promise<string> {
  const found = await readJournalFileFacts(path);
  if (found === undefined) throw new Error('Missing journal facts');
  return found.facts.sessionId;
}
export async function verifyJournalSessionLayout(
  oldPath: string,
  newPath: string,
  nextId: string,
): Promise<void> {
  expect(await recordingSessionId(newPath)).toBe(nextId);
  expect((await readJournalFileFacts(oldPath))?.rows).toBe(4);
}
