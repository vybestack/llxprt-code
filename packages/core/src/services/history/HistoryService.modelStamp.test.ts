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

import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryService } from './HistoryService.js';
import { stampAiTurnModel, type IContent } from './IContent.js';

/**
 * Issue #2335: model-origin stamping lives at the generation-recording
 * boundary (ConversationManager/TurnProcessor), NOT in HistoryService. History
 * that is imported/restored/rebuilt must remain unstamped so its true (possibly
 * different) origin model is never falsified. These tests pin that boundary.
 */
describe('HistoryService does NOT stamp metadata.model (issue #2335 import-safety)', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  it('does NOT inject metadata.model on an AI turn added with a modelName', () => {
    const aiContent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello there.' }],
    };

    service.add(aiContent, 'claude-opus-4-8');

    // HistoryService.add is used by import/restore paths; stamping here would
    // falsify the origin of imported turns (false negative defeating the fix).
    expect(service.getAll()[0].metadata?.model).toBeUndefined();
  });

  it('does NOT inject metadata.model on a human turn added with a modelName', () => {
    const humanContent: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Hi' }],
    };

    service.add(humanContent, 'claude-opus-4-8');

    expect(service.getAll()[0].metadata?.model).toBeUndefined();
  });

  it('preserves an explicit metadata.model already present on added content', () => {
    const aiContent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello there.' }],
      metadata: { model: 'claude-opus-4-8', turnId: 'turn-1' },
    };

    service.add(aiContent, 'claude-fable-5');

    expect(service.getAll()[0].metadata?.model).toBe('claude-opus-4-8');
  });
});

describe('stampAiTurnModel pure helper (issue #2335)', () => {
  it('stamps metadata.model on an AI turn when model is provided', () => {
    const aiContent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello there.' }],
    };

    const stamped = stampAiTurnModel(aiContent, 'claude-opus-4-8');

    expect(stamped.metadata?.model).toBe('claude-opus-4-8');
  });

  it('returns content unchanged for human speaker', () => {
    const humanContent: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Hi' }],
    };

    const stamped = stampAiTurnModel(humanContent, 'claude-opus-4-8');

    expect(stamped.metadata?.model).toBeUndefined();
    expect(stamped).toBe(humanContent);
  });

  it('returns content unchanged for tool speaker', () => {
    const toolContent: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call_1',
          toolName: 'read_file',
          result: { ok: true },
        },
      ],
    };

    const stamped = stampAiTurnModel(toolContent, 'claude-opus-4-8');

    expect(stamped.metadata?.model).toBeUndefined();
    expect(stamped).toBe(toolContent);
  });

  it('does NOT overwrite an existing metadata.model', () => {
    const aiContent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello there.' }],
      metadata: { model: 'claude-sonnet-5', turnId: 'turn-1' },
    };

    const stamped = stampAiTurnModel(aiContent, 'claude-opus-4-8');

    expect(stamped.metadata?.model).toBe('claude-sonnet-5');
  });

  it('preserves existing metadata fields (usage, turnId, id) when stamping', () => {
    const aiContent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello there.' }],
      metadata: {
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        turnId: 'turn-42',
        id: 'content-id-1',
      },
    };

    const stamped = stampAiTurnModel(aiContent, 'claude-opus-4-8');

    expect(stamped.metadata?.model).toBe('claude-opus-4-8');
    expect(stamped.metadata?.turnId).toBe('turn-42');
    expect(stamped.metadata?.id).toBe('content-id-1');
    expect(stamped.metadata?.usage).toStrictEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it('returns content unchanged when model is undefined', () => {
    const aiContent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello there.' }],
    };

    const stamped = stampAiTurnModel(aiContent, undefined);

    expect(stamped.metadata?.model).toBeUndefined();
    expect(stamped).toBe(aiContent);
  });

  it('returns content unchanged when model is an empty string', () => {
    const aiContent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello there.' }],
    };

    const stamped = stampAiTurnModel(aiContent, '');

    expect(stamped.metadata?.model).toBeUndefined();
    expect(stamped).toBe(aiContent);
  });

  it('does NOT mutate the caller-held object', () => {
    const aiContent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello there.' }],
    };

    stampAiTurnModel(aiContent, 'claude-opus-4-8');

    expect(aiContent.metadata).toBeUndefined();
  });
});
