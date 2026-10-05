import { observeHistorySynchronouslyForTest as testHistory } from '../../test-utils/synchronous-history-test-observation.js';
import {
  collectRowsForAssertions,
  collectJournalRowsForAssertions,
} from '../../test-utils/collect-rows-for-assertions.js';
import { curatedHistoryForTest } from '../../test-utils/curated-history-fixture.js';
/// <reference lib="esnext.array" />
/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { createHash } from 'node:crypto';
import { HistoryService, type HistorySummarySource } from './HistoryService.js';
import type { IContent, ToolCallBlock, ToolResponseBlock } from './IContent.js';
import {
  createUserMessage as createUserMessageFromIContent,
  createToolResponse as createToolResponseFromIContent,
} from './IContent.js';
import { ContentConverters } from './ContentConverters.js';

const createUserMessage = createUserMessageFromIContent;
const createToolResponse = createToolResponseFromIContent;

function toolResponseBlocksFor(
  curated: IContent[],
  callId: string,
): ToolResponseBlock[] {
  return curated
    .flatMap((content) => content.blocks)
    .filter(
      (block): block is ToolResponseBlock =>
        block.type === 'tool_response' && block.callId === callId,
    );
}

function toolResponsesFor(
  curated: IContent[],
  callId: string,
): ToolResponseBlock[] {
  return curated
    .filter((content) => content.speaker === 'tool')
    .flatMap((content) =>
      content.blocks.filter(
        (block): block is ToolResponseBlock =>
          block.type === 'tool_response' && block.callId === callId,
      ),
    );
}

function hasSyntheticReconstructedToolCall(curated: IContent[]): boolean {
  return curated.some(
    (content) =>
      content.metadata?.synthetic === true &&
      content.metadata.reason === 'reconstructed_tool_call',
  );
}

function containsToolResponseFor(
  content: IContent | undefined,
  callId: string,
): boolean {
  return (
    content?.blocks.some(
      (block) => block.type === 'tool_response' && block.callId === callId,
    ) ?? false
  );
}

function toolCallIndexAfter(curated: IContent[], callId: string): number {
  return curated.findIndex(
    (content) =>
      content.speaker === 'ai' &&
      content.blocks.some(
        (block) => block.type === 'tool_call' && block.id === callId,
      ),
  );
}

function waitingTextIndex(curated: IContent[]): number {
  return curated.findIndex(
    (content) =>
      content.speaker === 'ai' &&
      content.blocks.some(
        (block) =>
          block.type === 'text' &&
          (block as { text?: string }).text === '...waiting for tool...',
      ),
  );
}

async function managementCase1(service: HistoryService): Promise<IContent[]> {
  // Add messages with known token counts
  for (let i = 0; i < 10; i++) {
    service.add(createUserMessage(`Message ${i}`));
    service.add({
      speaker: 'ai',
      blocks: [{ type: 'text', text: `Response ${i}` }],
      metadata: {
        usage: {
          promptTokens: 10,
          completionTokens: 10,
          totalTokens: 20,
        },
      },
    });
  }

  // Mock token counter (10 tokens per message)
  const countTokens = (_content: IContent) => 10;

  // Get history within 50 token limit (should return last 5 messages)
  return Array.fromAsync(service.getWithinTokenLimit(50, countTokens));
}

async function managementCase2(service: HistoryService): Promise<unknown> {
  // Add many messages
  for (let i = 0; i < 20; i++) {
    service.add(createUserMessage(`Question ${i}`));
    service.add({
      speaker: 'ai',
      blocks: [{ type: 'text', text: `Answer ${i}` }],
    });
  }

  // Mock summarize function
  const summarizeFn = async (
    contents: HistorySummarySource,
  ): Promise<IContent> => ({
    speaker: 'ai',
    blocks: [
      {
        type: 'text',
        text: `Summary of ${contents.length} messages`,
      },
    ],
    metadata: { isSummary: true },
  });

  // Summarize old history, keeping last 4 messages
  await service.summarizeOldHistory(4, summarizeFn);

  let summary: unknown;
  await collectRowsForAssertions(service.streamRawHistory(), (history) => {
    // Should have: 1 summary + 4 recent messages = 5 total
    expect(history).toHaveLength(5);
    summary = history[0].metadata?.isSummary;
  });
  return summary;
}

async function managementCase3(
  service: HistoryService,
  assertResult: (result: {
    importedHistory: readonly IContent[];
    originalHistory: readonly IContent[];
  }) => void,
): Promise<void> {
  // Add some content
  service.add(createUserMessage('Test message'));
  service.add({
    speaker: 'ai',
    blocks: [
      { type: 'text', text: 'Test response' },
      {
        type: 'tool_call',
        id: 'tc1',
        name: 'test_tool',
        parameters: { test: true },
      },
    ],
  });

  await collectJournalRowsForAssertions(service, async (rows) => {
    const originalHistory = rows;
    const oracle = JSON.stringify(originalHistory, null, 2);
    const hash = createHash('sha256');
    await service.writeJSON(async (chunk) => {
      hash.update(chunk);
    });
    expect(hash.digest('hex')).toBe(
      createHash('sha256').update(oracle).digest('hex'),
    );
    const newService = HistoryService.fromJSON(oracle);
    try {
      await collectRowsForAssertions(
        newService.streamRawHistory(),
        async (rows) => {
          const importedHistory = rows;
          expect(importedHistory).toHaveLength(originalHistory.length);
          expect(importedHistory[0]).toStrictEqual(originalHistory[0]);
          assertResult({ importedHistory, originalHistory });
        },
      );
    } finally {
      newService.dispose();
    }
  });
}

async function managementCase4(service: HistoryService): Promise<void> {
  expect(service.isEmpty()).toBe(true);
  expect(service.length()).toBe(0);
  expect(testHistory(service)).toStrictEqual([]);
  expect(curatedHistoryForTest(service)).toStrictEqual([]);
  expect(await service.pop()).toBeUndefined();
  expect(service.getLastUserContent()).toBeUndefined();
}

function managementCase5(service: HistoryService): IContent[] {
  // Add AI message with thinking
  service.add({
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'Let me think about this...',
        isHidden: true,
      },
      { type: 'text', text: 'Here is my response.' },
    ],
  });

  const history = testHistory(service);
  expect(history).toHaveLength(1);
  expect(history[0].blocks).toHaveLength(2);

  // Curated history might filter hidden thinking
  const curated = curatedHistoryForTest(service);
  // Implementation could choose to filter hidden thinking blocks
  return curated;
}

function managementCase6(service: HistoryService): void {
  service.add({
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'Unsigned thinking',
        sourceField: 'thinking',
      },
    ],
  });
}

function managementCase7(service: HistoryService): IContent[] {
  service.add({
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'Here is an image:' },
      {
        type: 'media',
        mimeType: 'image/png',
        data: 'base64encodeddata',
        encoding: 'base64',
        caption: 'Screenshot',
      },
    ],
  });

  const history = testHistory(service);
  expect(history).toHaveLength(1);
  expect(history[0].blocks).toHaveLength(2);
  return history;
}

async function managementCase8(service: HistoryService): Promise<{
  curated: IContent[];
  toolCallId: string;
}> {
  const combined = ContentConverters.toIContent(
    {
      role: 'user',
      parts: [
        {
          functionCall: {
            id: 'call_cancel_123',
            name: 'run_shell_command',
            args: { command: 'echo hi' },
          },
        },
        {
          functionResponse: {
            id: 'call_cancel_123',
            name: 'run_shell_command',
            response: { error: '[Operation Cancelled] Reason: user' },
          },
        },
      ],
    },
    service.getIdGeneratorCallback(),
  );

  // This shape can occur when a cancelled tool interaction is recorded as a
  // single user Content containing both functionCall and functionResponse parts.
  service.add(combined);

  const curated = await Array.fromAsync(service.getCuratedForProviderStream());

  expect(curated).toHaveLength(2);
  expect(curated[0]?.speaker).toBe('ai');
  expect(curated[0]?.blocks[0]).toMatchObject({
    type: 'tool_call',
    name: 'run_shell_command',
  });
  const toolCallId = (curated[0]?.blocks[0] as ToolCallBlock).id;
  expect(toolCallId).toMatch(/^hist_tool_[a-zA-Z0-9_-]+$/);

  expect(curated[1]?.speaker).toBe('tool');
  return { curated, toolCallId };
}

async function managementCase9(service: HistoryService): Promise<IContent> {
  const orphanCallId = 'hist_tool_orphan';

  service.add(createUserMessage('Please list files.'));
  service.add(
    createToolResponse(orphanCallId, 'run_shell_command', {
      output: '[Operation Cancelled]',
    }),
  );

  const curated = await Array.fromAsync(service.getCuratedForProviderStream());
  expect(curated).toHaveLength(3);

  const synthesizedCall = curated[1];
  expect(synthesizedCall.speaker).toBe('ai');
  expect(synthesizedCall.metadata?.synthetic).toBe(true);
  expect(synthesizedCall.metadata?.reason).toBe('reconstructed_tool_call');
  expect(synthesizedCall.blocks).toHaveLength(1);
  expect(synthesizedCall.blocks[0]).toMatchObject({
    type: 'tool_call',
    id: orphanCallId,
    name: 'run_shell_command',
  });

  const toolMessage = curated[2];
  return toolMessage;
}

async function managementCase10(service: HistoryService): Promise<IContent[]> {
  const callId = 'hist_tool_valid';

  service.add(createUserMessage('Please list files.'));
  service.add({
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: callId,
        name: 'run_shell_command',
        parameters: { command: 'ls' },
      },
    ],
  });
  service.add(
    createToolResponse(callId, 'run_shell_command', {
      output: 'file.txt',
    }),
  );

  const curated = await Array.fromAsync(service.getCuratedForProviderStream());
  const toolResponses = toolResponsesFor(curated, callId);

  expect(toolResponses).toHaveLength(1);
  return curated;
}

async function managementCase11(service: HistoryService): Promise<{
  toolResultMessage: IContent;
  callId: string;
}> {
  const callId = 'hist_tool_dupe';

  service.add(createUserMessage('Please list files.'));
  service.add({
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: callId,
        name: 'run_shell_command',
        parameters: { command: 'ls' },
      },
    ],
  });
  service.add(
    createToolResponse(callId, 'run_shell_command', {
      output: 'file.txt',
    }),
  );
  service.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'file.txt' }],
  });

  // Corrupted history: the same tool result is written again after the
  // assistant has already continued with normal text.
  service.add(
    createToolResponse(callId, 'run_shell_command', {
      output: 'file.txt',
    }),
  );

  const curated = await Array.fromAsync(service.getCuratedForProviderStream());

  const toolResponsesForCallId = toolResponseBlocksFor(curated, callId);
  expect(toolResponsesForCallId).toHaveLength(1);

  const toolCallIndex = toolCallIndexAfter(curated, callId);
  expect(toolCallIndex).toBeGreaterThanOrEqual(0);

  const toolResultMessage = curated[toolCallIndex + 1];
  expect(toolResultMessage.speaker).toBe('tool');
  return { toolResultMessage, callId };
}

async function managementCase12(service: HistoryService): Promise<{
  waitingMessageIndex: number;
  toolCallIndex: number;
}> {
  const callId = 'hist_tool_out_of_order';

  service.add(createUserMessage('Please list files.'));
  service.add({
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: callId,
        name: 'run_shell_command',
        parameters: { command: 'ls' },
      },
    ],
  });

  // Corrupted ordering: assistant continues before the tool result is recorded.
  service.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: '...waiting for tool...' }],
  });
  service.add(
    createToolResponse(callId, 'run_shell_command', {
      output: 'file.txt',
    }),
  );

  const curated = await Array.fromAsync(service.getCuratedForProviderStream());

  const toolCallIndex = toolCallIndexAfter(curated, callId);
  expect(toolCallIndex).toBeGreaterThanOrEqual(0);

  const toolResultMessage = curated[toolCallIndex + 1];
  expect(toolResultMessage.speaker).toBe('tool');
  expect(containsToolResponseFor(toolResultMessage, callId)).toBe(true);

  const waitingMessageIndex = waitingTextIndex(curated);
  return { waitingMessageIndex, toolCallIndex };
}

describe('HistoryService - Behavioral Tests', () => {
  let service: HistoryService;
  beforeEach(() => {
    service = new HistoryService();
  });

  describe('Token Management', () => {
    it('should return history within token limits', async () => {
      expect(await managementCase1(service)).toHaveLength(5);
    });

    it('should handle history summarization for old messages', async () => {
      expect(await managementCase2(service)).toBe(true);
    });
  });
  describe('Import/Export', () => {
    it('should export and import history via JSON', async () => {
      await managementCase3(service, (result) => {
        expect(result.importedHistory[1]).toStrictEqual(
          result.originalHistory[1],
        );
      });
    });
  });
  describe('Edge Cases', () => {
    it('should handle empty history operations', async () => {
      await managementCase4(service);
      expect(service.getLastAIContent()).toBeUndefined();
    });

    it('should handle thinking blocks appropriately', () => {
      expect(managementCase5(service)).toHaveLength(1);
    });

    it('should treat unsigned Anthropic thinking blocks as invalid content', () => {
      managementCase6(service);
      expect(curatedHistoryForTest(service)).toStrictEqual([]);
    });

    it('should handle media blocks', () => {
      expect(managementCase7(service)[0].blocks[1].type).toBe('media');
    });
  });
  describe('Orphan tool responses handling', () => {
    it('should split tool_call blocks out of tool speaker entries in curated provider history', async () => {
      const { curated, toolCallId } = await managementCase8(service);
      expect(curated[1]?.blocks[0]).toMatchObject({
        type: 'tool_response',
        callId: toolCallId,
        toolName: 'run_shell_command',
      });
    });

    it('should synthesize missing tool_call entries so tool responses survive compression', async () => {
      const toolMessage = await managementCase9(service);
      expect(
        toolMessage.blocks.some((block) => block.type === 'tool_response'),
      ).toBe(true);
    });
    it('should keep tool responses unchanged when a matching tool_call exists', async () => {
      expect(
        hasSyntheticReconstructedToolCall(await managementCase10(service)),
      ).toBe(false);
    });

    it('should drop duplicate late tool_responses to keep provider tool adjacency valid', async () => {
      const { toolResultMessage, callId } = await managementCase11(service);
      expect(containsToolResponseFor(toolResultMessage, callId)).toBe(true);
    });
    it('should relocate out-of-order tool_responses to immediately follow their tool_call', async () => {
      const { waitingMessageIndex, toolCallIndex } =
        await managementCase12(service);
      expect(waitingMessageIndex).toBeGreaterThan(toolCallIndex + 1);
    });
  });

  // NEW TESTS FOR ID NORMALIZATION ARCHITECTURE
  // These tests SHOULD FAIL initially - that's the point of TDD
});
