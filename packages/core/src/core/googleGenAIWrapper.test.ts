/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { GoogleGenAIWrapper } from './googleGenAIWrapper.js';
import { GoogleGenAI } from '@google/genai';

vi.mock('@google/genai');

describe('GoogleGenAIWrapper', () => {
  it('should not pass user_prompt_id to the GoogleGenAI models', async () => {
    const mockGenerateContent = vi.fn().mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'test response' }] } }],
    });
    const mockGenerateContentStream = vi.fn().mockResolvedValue(
      (async function* () {
        yield {
          candidates: [{ content: { parts: [{ text: 'test response' }] } }],
        };
      })(),
    );
    const mockCountTokens = vi.fn().mockResolvedValue({ totalTokens: 100 });
    const mockEmbedContent = vi
      .fn()
      .mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] });

    const mockModels = {
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
      countTokens: mockCountTokens,
      embedContent: mockEmbedContent,
    };

    vi.mocked(GoogleGenAI).mockImplementation(
      () =>
        ({
          models: mockModels,
        }) as unknown as GoogleGenAI,
    );

    const config = {
      model: 'gemini-pro',
      apiKey: 'test-key',
    };

    const wrapper = new GoogleGenAIWrapper(config, { headers: {} });

    // Test generateContent - should NOT receive user_prompt_id
    const request = {
      model: 'gemini-pro',
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
    };

    await wrapper.generateContent(request);

    expect(mockGenerateContent).toHaveBeenCalledWith(request);
    expect(mockGenerateContent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        user_prompt_id: 'test-prompt-id',
      }),
    );

    // Test generateContentStream - should NOT receive user_prompt_id
    await wrapper.generateContentStream(request);

    expect(mockGenerateContentStream).toHaveBeenCalledWith(request);
    expect(mockGenerateContentStream).not.toHaveBeenCalledWith(
      expect.objectContaining({
        user_prompt_id: 'test-prompt-id',
      }),
    );
  });

  it('should properly initialize GoogleGenAI with config', () => {
    const mockModels = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn(),
      embedContent: vi.fn(),
    };

    vi.mocked(GoogleGenAI).mockImplementation(
      () =>
        ({
          models: mockModels,
        }) as unknown as GoogleGenAI,
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

  it('should handle undefined apiKey', () => {
    const mockModels = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn(),
      embedContent: vi.fn(),
    };

    vi.mocked(GoogleGenAI).mockImplementation(
      () =>
        ({
          models: mockModels,
        }) as unknown as GoogleGenAI,
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
