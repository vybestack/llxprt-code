/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'bun:test';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { PolicyDecision, type Config } from '@vybestack/llxprt-code-core';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import { ToolErrorType } from '@vybestack/llxprt-code-tools';
import { buildFactoryLessConfig } from './helpers/buildCliStyleConfig.js';

function textFromHistory(history: readonly IContent[]): string {
  return history
    .flatMap((message) => message.blocks)
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function turnCounts(first: Agent, second: Agent): readonly [number, number] {
  return [first.getStats().turnCount, second.getStats().turnCount];
}

function providerCallHeaders(call: unknown): unknown {
  if (!Array.isArray(call)) throw new Error('Expected a provider call');
  const options: unknown = call[0];
  if (
    options === null ||
    typeof options !== 'object' ||
    !('settings' in options)
  ) {
    throw new Error('Expected provider request settings');
  }
  const settings: unknown = options.settings;
  if (
    settings === null ||
    typeof settings !== 'object' ||
    !('getProviderSettings' in settings) ||
    typeof settings.getProviderSettings !== 'function'
  ) {
    throw new Error('Expected provider settings service');
  }
  const providerSettings: unknown = settings.getProviderSettings('fake');
  if (
    providerSettings === null ||
    typeof providerSettings !== 'object' ||
    !('custom-headers' in providerSettings)
  ) {
    throw new Error('Expected request header settings');
  }
  return providerSettings['custom-headers'];
}

function models(first: Agent, second: Agent): readonly [string, string] {
  return [first.getModel(), second.getModel()];
}

async function executeWrite(
  agent: Agent,
  config: Config,
  outputPath: string,
  content: string,
): Promise<readonly CompletedToolCall[]> {
  let completed: readonly CompletedToolCall[] = [];
  const scheduler = await agent.scheduler.acquire(
    agent,
    'session',
    {
      getPreferredEditor: () => undefined,
      onEditorClose: () => {},
      onAllToolCallsComplete: async (calls) => {
        completed = calls;
      },
    },
    { interactiveMode: false },
    {
      messageBus: agent.getMessageBus(),
      toolRegistry: config.getToolRegistry(),
    },
  );
  try {
    await scheduler.schedule(
      {
        callId: 'same-policy-probe',
        name: 'write_file',
        args: { absolute_path: outputPath, content },
        isClientInitiated: false,
        prompt_id: 'same-policy-prompt',
      },
      new AbortController().signal,
    );
    return completed;
  } finally {
    agent.scheduler.release(agent, 'session', scheduler);
  }
}

describe('same-label session turn isolation', () => {
  it('keeps provider instances, settings, executed policy, counters, and history independent @requirement:REQ-2615', async () => {
    const first = await buildFactoryLessConfig(
      'multi-turn-text.jsonl',
      {},
      {
        policy: {
          rules: [
            {
              toolName: 'write_file',
              decision: PolicyDecision.ALLOW,
              priority: 100,
              source: 'owner-a-policy',
            },
          ],
          defaultDecision: PolicyDecision.ALLOW,
        },
      },
    );
    const second = await buildFactoryLessConfig(
      'multi-turn-text.jsonl',
      {},
      {
        policy: {
          rules: [
            {
              toolName: 'write_file',
              decision: PolicyDecision.DENY,
              priority: 100,
              source: 'owner-b-policy',
            },
          ],
          defaultDecision: PolicyDecision.DENY,
        },
      },
    );
    const headersA = { 'X-Session-Owner': 'owner-a' };
    const headersB = { 'X-Session-Owner': 'owner-b' };
    first.config
      .getSettingsService()
      .setProviderSetting('fake', 'custom-headers', headersA);
    second.config
      .getSettingsService()
      .setProviderSetting('fake', 'custom-headers', headersB);
    const outputDir = mkdtempSync(
      join(first.config.getTargetDir(), '.s1-policy-'),
    );
    const outputA = join(outputDir, 'owner-a.txt');
    const outputB = join(outputDir, 'owner-b.txt');
    let agentA: Agent | undefined;
    let agentB: Agent | undefined;

    try {
      agentA = await fromConfig({
        config: first.config,
        messageBus: first.messageBus,
        sessionId: 'identical-session-label',
      });
      agentB = await fromConfig({
        config: second.config,
        messageBus: second.messageBus,
        sessionId: 'identical-session-label',
      });
      const providerA = first.config.getProviderManager()?.getActiveProvider();
      const providerB = second.config.getProviderManager()?.getActiveProvider();
      if (providerA === undefined || providerB === undefined) {
        throw new Error('Both sessions need an active provider');
      }
      expect(providerA).not.toBe(providerB);
      const callsA = vi.spyOn(providerA, 'generateChatCompletion');
      const callsB = vi.spyOn(providerB, 'generateChatCompletion');

      agentA.setEphemeralSetting('session-visible-setting', 'setting-a');
      agentB.setEphemeralSetting('session-visible-setting', 'setting-b');
      await agentA.setModel('owner-a-model');
      await agentB.setModel('owner-b-model');
      expect(models(agentA, agentB)).toStrictEqual([
        'owner-a-model',
        'owner-b-model',
      ]);

      expect(agentA.getRuntimeId()).toBe(agentB.getRuntimeId());
      expect(agentA.getMessageBus()).not.toBe(agentB.getMessageBus());
      expect(agentA.getEphemeralSetting('session-visible-setting')).toBe(
        'setting-a',
      );
      expect(agentB.getEphemeralSetting('session-visible-setting')).toBe(
        'setting-b',
      );
      expect(
        first.config.getSettingsService().getProviderSettings('fake')[
          'custom-headers'
        ],
      ).toStrictEqual(headersA);
      expect(
        second.config.getSettingsService().getProviderSettings('fake')[
          'custom-headers'
        ],
      ).toStrictEqual(headersB);
      expect(agentA.policy.getDefaultDecision()).toBe(PolicyDecision.ALLOW);
      expect(agentB.policy.getDefaultDecision()).toBe(PolicyDecision.DENY);

      const [completedA, completedB] = await Promise.all([
        executeWrite(agentA, first.config, outputA, 'written by owner A'),
        executeWrite(agentB, second.config, outputB, 'must not be written'),
      ]);
      expect(completedA).toHaveLength(1);
      expect(completedA[0].status).toBe('success');
      expect(readFileSync(outputA, 'utf8')).toBe('written by owner A');
      expect(completedB).toHaveLength(1);
      expect(completedB[0].status).toBe('error');
      expect(completedB[0].response.errorType).toBe(
        ToolErrorType.POLICY_VIOLATION,
      );
      expect(existsSync(outputB)).toBe(false);

      expect(turnCounts(agentA, agentB)).toStrictEqual([0, 0]);

      const firstA = await agentA.chat('owner A first prompt');
      expect(firstA.text).toContain('turn one reply');
      expect(turnCounts(agentA, agentB)).toStrictEqual([2, 0]);

      const firstB = await agentB.chat('owner B first prompt');
      expect(firstB.text).toContain('turn one reply');
      expect(turnCounts(agentA, agentB)).toStrictEqual([2, 2]);

      const secondA = await agentA.chat('owner A second prompt');
      expect(secondA.text).toContain('turn two reply');
      expect(turnCounts(agentA, agentB)).toStrictEqual([4, 2]);

      const secondB = await agentB.chat('owner B second prompt');
      expect(secondB.text).toContain('turn two reply');
      expect(turnCounts(agentA, agentB)).toStrictEqual([4, 4]);

      expect(callsA.mock.calls).toHaveLength(2);
      expect(callsB.mock.calls).toHaveLength(2);
      for (const call of callsA.mock.calls) {
        expect(providerCallHeaders(call)).toStrictEqual(headersA);
      }
      for (const call of callsB.mock.calls) {
        expect(providerCallHeaders(call)).toStrictEqual(headersB);
      }

      const historyA = textFromHistory(await agentA.getHistory());
      const historyB = textFromHistory(await agentB.getHistory());
      expect(historyA).toContain('owner A first prompt');
      expect(historyA).toContain('owner A second prompt');
      expect(historyA).not.toContain('owner B first prompt');
      expect(historyA).not.toContain('owner B second prompt');
      expect(historyB).toContain('owner B first prompt');
      expect(historyB).toContain('owner B second prompt');
      expect(historyB).not.toContain('owner A first prompt');
      expect(historyB).not.toContain('owner A second prompt');

      await agentA.dispose();
      agentB.setEphemeralSetting('survived-peer-disposal', true);
      expect(agentB.getEphemeralSetting('survived-peer-disposal')).toBe(true);
      expect(agentB.getStats().turnCount).toBe(4);
      expect(textFromHistory(await agentB.getHistory())).toContain(
        'owner B second prompt',
      );
    } finally {
      await Promise.all([agentA?.dispose(), agentB?.dispose()]);
      await second.cleanup();
      await first.cleanup();
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
