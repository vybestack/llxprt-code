/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 WP18: a portable session package exported from one real Agent is
 * imported into a second real Agent and the next turn goes through the default
 * send path to a real FakeProvider. The provider must receive the imported
 * rows exactly as the original session sent them, and the import must adopt
 * the recording through the streamed resume cursor rather than an array.
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '@vybestack/llxprt-code-providers/IProvider.js';
import { AgentClient } from '../../core/client.js';
import { buildAgent, drain, internalConfig } from './helpers/agentHarness.js';
import type { Agent } from './helpers/agentHarness.js';

const NEXT_PROMPT = 'next-prompt-after-import';

type ChatCompletion = FakeProvider['generateChatCompletion'];

interface ProviderObservation {
  readonly requests: IContent[][];
  restore(): void;
}

/** Records the rows each real FakeProvider call receives, then replays it. */
function observeProviderRequests(): ProviderObservation {
  const original: ChatCompletion =
    FakeProvider.prototype.generateChatCompletion;
  const requests: IContent[][] = [];
  FakeProvider.prototype.generateChatCompletion = async function* (
    this: FakeProvider,
    options: GenerateChatOptions | AsyncIterable<IContent>,
  ) {
    const contents = 'contents' in options ? options.contents : options;
    const rows: IContent[] = [];
    for await (const row of contents) rows.push(row);
    requests.push(rows);
    yield* original.call(this, options);
  };
  return {
    requests,
    restore: () => {
      FakeProvider.prototype.generateChatCompletion = original;
    },
  };
}

function textOf(row: IContent): string {
  return row.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

async function withIsolatedAgent<T>(
  workingDir: string,
  fn: (agent: Agent) => Promise<T>,
): Promise<T> {
  const { agent, cleanup } = await buildAgent('multi-turn-text.jsonl', {
    workingDir,
  });
  const projectTemp = internalConfig(agent).storage.getProjectTempDir();
  try {
    return await fn(agent);
  } finally {
    await cleanup();
    rmSync(projectTemp, { recursive: true, force: true });
  }
}

async function exportFirstTurn(
  workingDir: string,
  packageDirectory: string,
  observation: ProviderObservation,
): Promise<IContent[]> {
  return withIsolatedAgent(workingDir, async (agent) => {
    await agent.session.setRecording({ enabled: true });
    await drain(agent.stream('first-turn-prompt'));
    const [session] = await agent.session.listSessions();
    await agent.session.exportSession(session.id, packageDirectory);
    await drain(agent.stream(NEXT_PROMPT));
    await agent.session.setRecording({ enabled: false });
    expect(observation.requests).toHaveLength(2);
    return observation.requests[1];
  });
}

describe('portable session import through the default send path', () => {
  it('sends the imported rows byte-equal to the original session request, adopted through the streamed cursor', async () => {
    const root = mkdtempSync(join(tmpdir(), 'llxprt-package-import-'));
    const observation = observeProviderRequests();
    const adopt = HistoryService.prototype.adoptResumeBoot;
    const adoptedBoots: unknown[] = [];
    HistoryService.prototype.adoptResumeBoot = function (
      this: HistoryService,
      ...args: Parameters<HistoryService['adoptResumeBoot']>
    ) {
      adoptedBoots.push(args[1]);
      return adopt.apply(this, args);
    };
    const arraySetters: unknown[] = [];
    const resumeChat = AgentClient.prototype.resumeChat;
    AgentClient.prototype.resumeChat = function (
      this: AgentClient,
      history: readonly IContent[],
    ) {
      arraySetters.push(history);
      return resumeChat.call(this, history);
    };
    try {
      const packageDirectory = join(root, 'package');
      const original = await exportFirstTurn(
        join(root, 'source-workspace'),
        packageDirectory,
        observation,
      );
      observation.requests.length = 0;
      adoptedBoots.length = 0;
      arraySetters.length = 0;

      const imported = await withIsolatedAgent(
        join(root, 'destination-workspace'),
        async (agent) => {
          const info = await agent.session.importSession(packageDirectory);
          expect(info.id).toBeTruthy();
          await drain(agent.stream(NEXT_PROMPT));
          await agent.session.setRecording({ enabled: false });
          return observation.requests[0];
        },
      );

      expect(imported).toHaveLength(original.length);
      expect(imported.length).toBeGreaterThanOrEqual(3);
      const sentPrefix = imported.slice(0, -1);
      expect(JSON.stringify(sentPrefix)).toBe(
        JSON.stringify(original.slice(0, -1)),
      );
      expect(textOf(sentPrefix[0])).toContain('first-turn-prompt');
      expect(textOf(imported[imported.length - 1])).toBe(NEXT_PROMPT);
      expect(textOf(original[original.length - 1])).toBe(NEXT_PROMPT);

      expect(adoptedBoots).toHaveLength(1);
      const boot = adoptedBoots[0] as { streamRows?: unknown };
      expect(typeof boot.streamRows).toBe('function');
      expect(
        arraySetters.every((history) => (history as unknown[]).length === 0),
      ).toBe(true);
    } finally {
      HistoryService.prototype.adoptResumeBoot = adopt;
      AgentClient.prototype.resumeChat = resumeChat;
      observation.restore();
      rmSync(root, { recursive: true, force: true });
    }
  }, 120000);
});
