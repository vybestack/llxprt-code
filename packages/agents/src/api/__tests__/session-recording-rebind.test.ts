/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  HookEventName,
  HookType,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import type { CompressionStrategy } from '@vybestack/llxprt-code-core/core/compression/types.js';
import * as compressionFactory from '../../compression/compressionStrategyFactory.js';
import { drain, fixturesDir } from './helpers/agentHarness.js';

async function withHookAgents(
  scenario: (
    config: Config,
    agents: Agent[],
    hookOutput: string,
  ) => Promise<void>,
  event: HookEventName = HookEventName.BeforeModel,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'llxprt-recording-rebind-'));
  const hookOutput = join(root, 'hook-input.json');
  const priorFixture = process.env.LLXPRT_FAKE_RESPONSES;
  process.env.LLXPRT_FAKE_RESPONSES = join(
    fixturesDir,
    'multi-turn-text.jsonl',
  );
  const config = new Config({
    sessionId: 'same-label',
    targetDir: root,
    cwd: root,
    provider: 'fake',
    model: 'fake-model',
    debugMode: false,
    enableHooks: true,
    hooks: {
      [event]: [
        {
          hooks: [{ type: HookType.Command, command: `cat > "${hookOutput}"` }],
        },
      ],
    },
  });
  const agents: Agent[] = [];
  try {
    await scenario(config, agents, hookOutput);
  } finally {
    await Promise.all(agents.map((agent) => agent.dispose()));
    await config.dispose();
    if (priorFixture === undefined) {
      delete process.env.LLXPRT_FAKE_RESPONSES;
    } else {
      process.env.LLXPRT_FAKE_RESPONSES = priorFixture;
    }
    rmSync(root, { recursive: true, force: true });
    const hash = createHash('sha256').update(root).digest('hex');
    rmSync(join(homedir(), '.llxprt', 'tmp', hash), {
      recursive: true,
      force: true,
    });
  }
}

async function sameLabelRecordings(
  config: Config,
  agents: Agent[],
): Promise<{
  first: Agent;
  second: Agent;
  firstPath: string;
  secondPath: string;
}> {
  const first = await fromConfig({ config });
  agents.push(first);
  await first.addHistory({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'first recording history' }],
  });
  await first.session.setRecording({ enabled: true });
  const firstPath = first.session.getRecording().path;
  const second = await fromConfig({ config });
  agents.push(second);
  await second.addHistory({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'second recording history' }],
  });
  await second.session.setRecording({ enabled: true });
  const secondPath = second.session.getRecording().path;
  if (firstPath === undefined || secondPath === undefined) {
    throw new Error('expected both recordings to have materialized');
  }
  expect(secondPath).not.toBe(firstPath);
  return { first, second, firstPath, secondPath };
}

describe('session recording attribution across client replacement', () => {
  it('keeps the active transcript path in hooks after a model switch and second turn', async () => {
    await withHookAgents(async (config, agents, hookOutput) => {
      const agent = await fromConfig({ config });
      agents.push(agent);
      await agent.session.setRecording({ enabled: true });
      await drain(agent.stream('before model switch'));
      const path = agent.session.getRecording().path;
      expect(path).toBeDefined();

      await agent.setModel('another-fake-model');
      const events = await drain(agent.stream('after model switch'));
      expect(events.some((event) => event.type === 'error')).toBe(false);
      const hookInput = JSON.parse(readFileSync(hookOutput, 'utf8'));
      expect(hookInput.transcript_path).toBe(path);

      let compressionPath: string | undefined;
      const strategy: CompressionStrategy = {
        name: 'one-shot',
        requiresLLM: false,
        trigger: { mode: 'threshold', defaultThreshold: 0.8 },
        compress: async (context) => {
          compressionPath = context.transcriptPath;
          return {
            kind: 'applied',
            newHistory: [
              { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
            ],
            metadata: {
              originalMessageCount: context.history.length,
              compressedMessageCount: 1,
              strategyUsed: 'one-shot',
              llmCallMade: false,
            },
          };
        },
      };
      const strategyOverride = vi
        .spyOn(compressionFactory, 'getCompressionStrategy')
        .mockReturnValue(strategy);
      try {
        expect((await agent.compress()).status).toBe('compressed');
        expect(compressionPath).toBe(path);
      } finally {
        strategyOverride.mockRestore();
      }
    });
  });

  it('attributes A turn hooks to A after B adopts the same Config with the same label', async () => {
    await withHookAgents(async (config, agents, hookOutput) => {
      const first = await fromConfig({ config });
      agents.push(first);
      await first.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first session' }],
      });
      await first.session.setRecording({ enabled: true });
      const firstPath = first.session.getRecording().path;

      const second = await fromConfig({ config });
      agents.push(second);
      await second.session.setRecording({ enabled: true });
      await drain(second.stream('second session'));
      expect(firstPath).toBeDefined();
      expect(second.session.getRecording().path).not.toBe(firstPath);

      const events = await drain(first.stream('first session again'));
      expect(events.some((event) => event.type === 'error')).toBe(false);
      const hookInput = JSON.parse(readFileSync(hookOutput, 'utf8'));
      expect(hookInput.transcript_path).toBe(firstPath);
    });
  });

  it('attributes an explicit A lifecycle hook after B adopts the same Config', async () => {
    await withHookAgents(async (config, agents, hookOutput) => {
      const first = await fromConfig({ config });
      agents.push(first);
      await first.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'first lifecycle recording' }],
      });
      await first.session.setRecording({ enabled: true });
      const firstPath = first.session.getRecording().path;
      const second = await fromConfig({ config });
      agents.push(second);
      await second.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'second lifecycle recording' }],
      });
      await second.session.setRecording({ enabled: true });
      expect(firstPath).toBeDefined();
      expect(second.session.getRecording().path).not.toBe(firstPath);

      await first.hooks.triggerSessionEnd();
      const hookInput = JSON.parse(readFileSync(hookOutput, 'utf8'));
      expect(hookInput.transcript_path).toBe(firstPath);
    }, HookEventName.SessionEnd);
  });

  it('attributes PreCompress hooks to A after B adopts the same Config, without changing B', async () => {
    await withHookAgents(async (config, agents, hookOutput) => {
      const { first, second, firstPath, secondPath } =
        await sameLabelRecordings(config, agents);
      await config.getHookSystem()!.initialize();
      const strategy: CompressionStrategy = {
        name: 'one-shot',
        requiresLLM: false,
        trigger: { mode: 'threshold', defaultThreshold: 0.8 },
        compress: async (context) => ({
          kind: 'noop',
          reason: 'already-under-target',
          metadata: {
            originalMessageCount: context.history.length,
            compressedMessageCount: context.history.length,
            strategyUsed: 'one-shot',
            llmCallMade: false,
          },
        }),
      };
      const override = vi
        .spyOn(compressionFactory, 'getCompressionStrategy')
        .mockReturnValue(strategy);
      try {
        expect((await first.compress()).status).toBe('noop');
        const firstInput = JSON.parse(readFileSync(hookOutput, 'utf8'));
        expect(firstInput.hook_event_name).toBe(HookEventName.PreCompress);
        expect(firstInput.transcript_path).toBe(firstPath);

        expect((await second.compress()).status).toBe('noop');
        const secondInput = JSON.parse(readFileSync(hookOutput, 'utf8'));
        expect(secondInput.transcript_path).toBe(secondPath);
        expect(first.session.getRecording().path).toBe(firstPath);
      } finally {
        override.mockRestore();
      }
    }, HookEventName.PreCompress);
  });

  it('attributes direct generation BeforeModel hooks to A after B adopts the same Config, without changing B', async () => {
    await withHookAgents(async (config, agents, hookOutput) => {
      const { first, second, firstPath, secondPath } =
        await sameLabelRecordings(config, agents);
      await config.getHookSystem()!.initialize();

      await first.generate('first direct generation');
      const firstInput = JSON.parse(readFileSync(hookOutput, 'utf8'));
      expect(firstInput.hook_event_name).toBe(HookEventName.BeforeModel);
      expect(firstInput.transcript_path).toBe(firstPath);

      await second.generate('second direct generation');
      const secondInput = JSON.parse(readFileSync(hookOutput, 'utf8'));
      expect(secondInput.transcript_path).toBe(secondPath);
      expect(first.session.getRecording().path).toBe(firstPath);
    });
  });
});
