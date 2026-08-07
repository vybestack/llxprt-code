/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #207: the neutral IContent conversion boundary must carry
 * IContent.metadata.id onto ModelStreamChunk.responseId while preserving the
 * provider's response-storage status in the embedded content metadata.
 */

import { describe, it, expect } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';

describe('Issue 207: metadata.id carried as responseId @issue:207', () => {
  it('sets responseId when metadata.id is present', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello.' }],
      metadata: { id: 'resp_abc' },
    };

    expect(toModelStreamChunk(content).responseId).toBe('resp_abc');
  });

  it('does not set responseId when metadata.id is absent', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello.' }],
      metadata: {
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      },
    };

    expect(toModelStreamChunk(content).responseId).toBeUndefined();
  });

  it('sets both responseId and usage when both are present', () => {
    const usage = {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    };
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello.' }],
      metadata: { id: 'resp_xyz', usage },
    };

    const chunk = toModelStreamChunk(content);

    expect(chunk.responseId).toBe('resp_xyz');
    expect(chunk.usage).toStrictEqual(usage);
  });

  it('does not set responseId when metadata.id is an empty string', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello.' }],
      metadata: { id: '' },
    };

    expect(toModelStreamChunk(content).responseId).toBeUndefined();
  });

  it('preserves responsesStored=true in content metadata', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello.' }],
      metadata: { id: 'resp_stored', responsesStored: true },
    };

    const chunk = toModelStreamChunk(content);

    expect(chunk.responseId).toBe('resp_stored');
    expect(chunk.content.metadata?.responsesStored).toBe(true);
  });

  it('leaves responsesStored absent when only metadata.id is present', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello.' }],
      metadata: { id: 'resp_plain' },
    };

    const chunk = toModelStreamChunk(content);

    expect(chunk.responseId).toBe('resp_plain');
    expect(chunk.content.metadata?.responsesStored).toBeUndefined();
  });
});
