/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  extractProviderBaseUrl,
  getBaseUrlFromProvider,
} from './baseUrlResolver.js';

function providerWithUrl(read: () => string): {
  name: string;
  getModels: () => Promise<never[]>;
  generateChatCompletion: () => AsyncGenerator<never>;
  getBaseURL: () => string;
} {
  return {
    name: 'url-provider',
    getModels: async () => [],
    async *generateChatCompletion(): AsyncGenerator<never> {},
    getBaseURL: read,
  };
}

describe('provider base URL reads', () => {
  it('preserves the provider receiver when reading its configured endpoint', () => {
    const provider = {
      endpoint: '  https://endpoint.example.invalid/v1  ',
      getBaseURL(): string {
        return this.endpoint;
      },
    };
    expect(extractProviderBaseUrl(provider)).toBe(provider.endpoint.trim());
  });

  it.each([extractProviderBaseUrl, getBaseUrlFromProvider])(
    'propagates an owned getter failure through %p',
    (read) => {
      const failure = new Error('Provider configuration failed');
      const provider = providerWithUrl(() => {
        throw failure;
      });
      expect(() => read(provider)).toThrow(failure);
    },
  );
});
