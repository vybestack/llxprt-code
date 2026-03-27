/* eslint-disable no-console */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
// ConversationContext is not available in core package
// import { ConversationContext } from '../../../utils/ConversationContext.js';
import { IContent } from '../../services/history/IContent.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createProviderWithRuntime,
  createRuntimeConfigStub,
} from '../../test-utils/runtime.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';
import { SettingsService } from '../../settings/SettingsService.js';
import type { ProviderRuntimeContext } from '../../runtime/providerRuntimeContext.js';

// This test suite makes live API calls and requires an OpenAI API key.
// The key is expected to be in a file named .openai_key in the user's home directory.
describe('OpenAIProvider Stateful Integration', () => {
  let provider: OpenAIProvider;
  let apiKey: string | undefined;
  let runtimeSettingsService: SettingsService | undefined;
  let runtimeContext: ProviderRuntimeContext | undefined;

  beforeAll(() => {
    try {
      const keyPath = path.join(os.homedir(), '.openai_key');
      apiKey = fs.readFileSync(keyPath, 'utf-8').trim();
    } catch {
      console.warn(
        'Skipping stateful integration tests: API key not found at ~/.openai_key',
      );
      apiKey = undefined;
    }
  });

  beforeEach(() => {
    // Ensure each test starts with a fresh context
    // ConversationContext.reset(); // Not available in core package
    if (apiKey) {
      ({
        provider,
        settingsService: runtimeSettingsService,
        runtime: runtimeContext,
      } = createProviderWithRuntime<OpenAIProvider>(
        ({ settingsService }) => {
          settingsService.set('auth-key', apiKey);
          settingsService.set('activeProvider', 'openai');
          return new OpenAIProvider(apiKey, 'https://api.openai.com/v1');
        },
        {
          runtimeId: 'openai.stateful.integration.test',
          metadata: { source: 'OpenAIProvider.stateful.integration.test.ts' },
        },
      ));
      if (runtimeContext && runtimeSettingsService && !runtimeContext.config) {
        runtimeContext.config = createRuntimeConfigStub(runtimeSettingsService);
      }
    }
  });

  // Helper function to consume the async iterator and collect content
  async function collectResponse(
    stream: AsyncIterableIterator<IContent>,
  ): Promise<string> {
    let fullContent = '';
    for await (const chunk of stream) {
      const textBlocks = chunk.blocks?.filter((b) => b.type === 'text');
      if (textBlocks?.length) {
        for (const textBlock of textBlocks) {
          fullContent += (textBlock as { text: string }).text;
        }
      }
    }
    return fullContent;
  }

  const buildCallOptions = (contents: IContent[]) => {
    if (!runtimeSettingsService || !runtimeContext) {
      throw new Error('Runtime context not initialised');
    }
    if (!runtimeContext.config) {
      runtimeContext.config = createRuntimeConfigStub(runtimeSettingsService);
    }
    return createProviderCallOptions({
      providerName: provider.name,
      contents,
      settings: runtimeSettingsService,
      runtime: runtimeContext,
      config: runtimeContext.config,
    });
  };
});
