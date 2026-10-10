/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `/clear` must leave the model with no prior conversation turns, matching
 * the CLI behavior on main where `resetChat()` emptied model history. The
 * recording owner must stay consistent: the cleared turns are durably rewound
 * so a later resume does not resurrect them.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent, AgentHistoryItem } from '@vybestack/llxprt-code-agents';
import { buildAgent, drain, isDoneEvent } from './helpers/agentHarness.js';

function textItem(speaker: 'human' | 'ai', text: string): AgentHistoryItem {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function itemText(item: AgentHistoryItem): string {
  return item.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

function recordedLineTypes(path: string): string[] {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => (JSON.parse(line) as { type: string }).type);
}

async function withRecordedConversation<T>(
  fn: (agent: Agent, recordingPath: string) => Promise<T>,
): Promise<T> {
  const workingDir = mkdtempSync(join(tmpdir(), 'llxprt-clear-conversation-'));
  const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
    workingDir,
  });
  try {
    await agent.setHistory([
      textItem('human', 'first question'),
      textItem('ai', 'first answer'),
      textItem('human', 'second question'),
      textItem('ai', 'second answer'),
    ]);
    await agent.session.setRecording({ enabled: true });
    return await fn(agent, agent.session.getRecording().path ?? '');
  } finally {
    await cleanup();
    rmSync(workingDir, { recursive: true, force: true });
  }
}

describe('Agent.resetChat without retained initial history (/clear)', () => {
  it('leaves no prior conversation turns for the next model request', async () => {
    const afterReset = await withRecordedConversation(async (agent) => {
      await agent.resetChat({ retainInitialHistory: false });
      return agent.getHistory();
    });
    expect(afterReset).toStrictEqual([]);
  });

  it('sends only the new turn on the next request after the reset', async () => {
    const texts = await withRecordedConversation(async (agent) => {
      await agent.resetChat({ retainInitialHistory: false });
      const events = await drain(agent.stream('fresh start'));
      expect(events.filter(isDoneEvent)).toHaveLength(1);
      return (await agent.getHistory()).map(itemText);
    });
    expect(texts).not.toContain('first question');
    expect(texts).not.toContain('second answer');
    expect(texts[0]).toBe('fresh start');
  });

  it('durably rewinds every cleared turn so resume does not resurrect them', async () => {
    const { types, resumed } = await withRecordedConversation(
      async (agent, recordingPath) => {
        await agent.resetChat({ retainInitialHistory: false });
        await agent.session.setRecording({ enabled: false });
        const recordedTypes = recordedLineTypes(recordingPath);
        const resumedItems = await agent.session.resume('latest');
        return { types: recordedTypes, resumed: resumedItems };
      },
    );
    expect(types.filter((type) => type === 'rewind')).toHaveLength(1);
    expect(types.filter((type) => type === 'content')).toHaveLength(4);
    expect(resumed).toStrictEqual([]);
  });

  it('still retains the initial turn by default while recording', async () => {
    const texts = await withRecordedConversation(async (agent) => {
      await agent.resetChat();
      return (await agent.getHistory()).map(itemText);
    });
    expect(texts).toStrictEqual(['first question', 'first answer']);
  });
});
