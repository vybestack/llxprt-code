/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { GoogleGenAIWrapper } from './googleGenAIWrapper.js';
import { GoogleGenAI } from '@google/genai';
import type { ModelGenerationRequest } from '../llm-types/modelRequest.js';

vi.mock('@google/genai');

function makeModels() {
  const mockGenerateContent = vi.fn().mockResolvedValue({
    candidates: [
      { content: { role: 'model', parts: [{ text: 'test response' }] } },
    ],
  });
  const mockGenerateContentStream = vi.fn().mockResolvedValue(
    (async function* () {
      yield {
        candidates: [
          { content: { role: 'model', parts: [{ text: 'chunk' }] } },
        ],
      };
    })(),
  );
  const mockCountTokens = vi.fn().mockResolvedValue({ totalTokens: 100 });
  const mockEmbedContent = vi
    .fn()
    .mockResolvedValue({ embeddings: [{ values: [0.1, 0.2, 0.3] }] });

  return {
    generateContent: mockGenerateContent,
    generateContentStream: mockGenerateContentStream,
    countTokens: mockCountTokens,
    embedContent: mockEmbedContent,
  };
}

describe('GoogleGenAIWrapper (neutral)', () => {
  it('generateContent converts neutral request and returns neutral ModelOutput', async () => {
    const models = makeModels();
    vi.mocked(GoogleGenAI).mockImplementation(
      () => ({ models }) as unknown as GoogleGenAI,
    );

    const wrapper = new GoogleGenAIWrapper(
      { model: 'gemini-pro', apiKey: 'test-key' },
      { headers: {} },
    );

    const request: ModelGenerationRequest = {
      model: 'gemini-pro',
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      ],
    };

    const output = await wrapper.generateContent(request, 'prompt-id');

    // Neutral output shape
    expect(output.content.speaker).toBe('ai');
    expect(output.content.blocks).toHaveLength(1);
    expect(output.content.blocks[0]).toStrictEqual({
      type: 'text',
      text: 'test response',
    });

    // The SDK call received a Google-shaped request (not the neutral one)
    const sdkCall = models.generateContent.mock.calls[0][0];
    expect(sdkCall.contents).toBeDefined();
    expect(sdkCall.model).toBe('gemini-pro');
  });

  it('generateContentStream yields neutral ModelStreamChunk values', async () => {
    const models = makeModels();
    vi.mocked(GoogleGenAI).mockImplementation(
      () => ({ models }) as unknown as GoogleGenAI,
    );

    const wrapper = new GoogleGenAIWrapper(
      { model: 'gemini-pro', apiKey: 'test-key' },
      { headers: {} },
    );

    const request: ModelGenerationRequest = {
      model: 'gemini-pro',
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      ],
    };

    const stream = await wrapper.generateContentStream(request, 'prompt-id');
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content.speaker).toBe('ai');
    expect(chunks[0].content.blocks[0]).toStrictEqual({
      type: 'text',
      text: 'chunk',
    });
  });

  it('countTokens returns neutral CountTokensResult', async () => {
    const models = makeModels();
    vi.mocked(GoogleGenAI).mockImplementation(
      () => ({ models }) as unknown as GoogleGenAI,
    );

    const wrapper = new GoogleGenAIWrapper(
      { model: 'gemini-pro', apiKey: 'test-key' },
      { headers: {} },
    );

    const result = await wrapper.countTokens({
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    });

    expect(result.totalTokens).toBe(100);
  });

  it('embedContent returns neutral EmbedContentResult', async () => {
    const models = makeModels();
    vi.mocked(GoogleGenAI).mockImplementation(
      () => ({ models }) as unknown as GoogleGenAI,
    );

    const wrapper = new GoogleGenAIWrapper(
      { model: 'gemini-pro', apiKey: 'test-key' },
      { headers: {} },
    );

    const result = await wrapper.embedContent({ texts: ['hello'] });

    expect(result.embeddings).toStrictEqual([[0.1, 0.2, 0.3]]);
  });

  it('properly initializes GoogleGenAI with config', () => {
    vi.mocked(GoogleGenAI).mockImplementation(
      () => ({ models: makeModels() }) as unknown as GoogleGenAI,
    );

    const config = {
      model: 'gemini-pro',
      apiKey: 'test-key',
      vertexai: true,
    };

    const httpOptions = { headers: { 'User-Agent': 'Test' } };

    new GoogleGenAIWrapper(config, httpOptions);

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-key',
      vertexai: true,
      httpOptions,
    });
  });

  it('handles undefined apiKey', () => {
    vi.mocked(GoogleGenAI).mockImplementation(
      () => ({ models: makeModels() }) as unknown as GoogleGenAI,
    );

    const config = {
      model: 'gemini-pro',
      apiKey: '',
    };

    new GoogleGenAIWrapper(config, { headers: {} });

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: undefined,
      vertexai: undefined,
      httpOptions: { headers: {} },
    });
  });
});
