/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { GeminiProvider } from '../gemini/GeminiProvider.js';
import type {
  GeminiApiClient,
  GeminiApiClientOptions,
  GenerateContentResponse,
} from '../gemini/geminiWireTypes.js';
import { createProviderCallOptions } from './testSupport.js';

async function routedOptions(
  baseURL: string | undefined,
  vertex: boolean,
  project: string | undefined = 'routing-project',
): Promise<GeminiApiClientOptions> {
  const settings = new SettingsService();
  let captured: GeminiApiClientOptions | undefined;
  const provider = new GeminiProvider(
    vertex ? undefined : 'routing-api-key',
    baseURL,
    {
      googleAuthDefaults: {
        GOOGLE_CLOUD_PROJECT: project,
        GOOGLE_CLOUD_LOCATION: 'us-central1',
      },
    },
    async (options): Promise<GeminiApiClient> => {
      captured = options;
      return {
        models: {
          async generateContent(): Promise<GenerateContentResponse> {
            return {
              candidates: [
                { content: { role: 'model', parts: [{ text: 'routed' }] } },
              ],
            };
          },
          async generateContentStream(): Promise<
            AsyncIterable<GenerateContentResponse>
          > {
            throw new Error('Routing fixture requires non-streaming');
          },
        },
      };
    },
  );
  provider.setRuntimeSettingsService(settings);
  const contents = [];
  for await (const content of provider.generateChatCompletion(
    createProviderCallOptions({
      providerName: 'gemini',
      settings,
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'route' }] },
      ],
      resolved: { model: 'gemini-2.5-flash' },
      ephemerals: { streaming: 'disabled' },
    }),
  )) {
    contents.push(content);
  }
  expect(contents.flatMap((content) => content.blocks)).toContainEqual({
    type: 'text',
    text: 'routed',
  });
  if (!captured)
    throw new Error('Expected public generation to reach transport');
  return captured;
}

describe('Gemini base URL routing', () => {
  for (const baseURL of [
    undefined,
    'https://generativelanguage.googleapis.com',
    'https://generativelanguage.googleapis.com/v1beta',
    'https://GENERATIVELANGUAGE.GOOGLEAPIS.COM:443/v1beta',
  ]) {
    it(`keeps the Vertex endpoint for the standard Google origin ${baseURL}`, async () => {
      const options = await routedOptions(baseURL, true);
      expect(options.httpOptions?.baseUrl).toBeUndefined();
      expect(options.vertexai).toBe(true);
      expect(options.project).toBe('routing-project');
      expect(options.location).toBe('us-central1');
    });
  }

  for (const baseURL of [
    'https://generativelanguage.googleapis.com.attacker.example/v1beta',
    'https://generativelanguage.googleapis.com@attacker.example/v1beta',
    'https://proxy.example/?next=https://generativelanguage.googleapis.com',
    'https://generativelanguage.googleapis.com:8443/v1beta',
    'http://generativelanguage.googleapis.com/v1beta',
    'https://custom.example/v1beta',
  ]) {
    it(`retains the explicit custom Vertex endpoint ${baseURL}`, async () => {
      const options = await routedOptions(baseURL, true);
      expect(options.httpOptions?.baseUrl).toBe(baseURL);
      expect(options.vertexai).toBe(true);
    });
  }

  for (const baseURL of [
    'https://generativelanguage.googleapis.com/v1beta',
    'https://custom.example/v1beta',
  ]) {
    it(`preserves the explicit API-key endpoint ${baseURL}`, async () => {
      const options = await routedOptions(baseURL, false);
      expect(options.httpOptions?.baseUrl).toBe(baseURL);
      expect(options.vertexai).toBe(false);
      expect(options.apiKey).toBe('routing-api-key');
      expect(options.project).toBeUndefined();
    });
  }

  it('rejects a malformed Vertex endpoint before constructing transport', async () => {
    await expect(routedOptions('not a URL', true)).rejects.toThrow(TypeError);
  });

  it('retains the missing authentication error before endpoint parsing', async () => {
    await expect(routedOptions('not a URL', true, '')).rejects.toThrow(
      'No Gemini authentication configured. Set GEMINI_API_KEY environment variable, use --keyfile, or configure Vertex AI credentials.',
    );
  });
});
