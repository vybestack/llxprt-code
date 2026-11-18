/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared fixtures for issue #4128 tests: a provider that records the text of
 * every compression request it receives and answers each call from a reply
 * list, plus a temp prompts directory per test.
 */

import { afterEach, beforeEach } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { CompressionContext } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { PromptResolver } from '@vybestack/llxprt-code-core/prompt-config/prompt-resolver.js';
import { MiddleOutStrategy } from '../MiddleOutStrategy.js';
import { OneShotStrategy } from '../OneShotStrategy.js';
import {
  buildContext,
  testProviderRuntime,
} from './MiddleOutStrategy-test-helpers.js';

const SHIPPED_DEFAULTS_DIR = fileURLToPath(
  new URL('../../../../core/src/prompt-config/defaults/', import.meta.url),
);

const requestFetch: NetworkFetch = () =>
  Promise.reject(new Error('This test must not make network requests'));

export function requestText(contents: readonly IContent[]): string {
  return contents
    .flatMap((content) =>
      content.blocks.flatMap((block) =>
        block.type === 'text' ? [block.text] : [],
      ),
    )
    .join('\n');
}

class RecordingProvider implements IProvider {
  readonly name = 'recording-provider';
  readonly requests: IContent[][] = [];
  private replyIndex = 0;

  constructor(private readonly replies: readonly string[]) {}

  getModels(): Promise<[]> {
    return Promise.resolve([]);
  }

  getDefaultModel(): string {
    return 'recording-model';
  }

  generateChatCompletion(
    options: RuntimeGenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  generateChatCompletion(content: IContent[]): AsyncIterableIterator<IContent>;
  async *generateChatCompletion(
    optionsOrContent: RuntimeGenerateChatOptions | IContent[],
  ): AsyncIterableIterator<IContent> {
    const contents = Array.isArray(optionsOrContent)
      ? optionsOrContent
      : optionsOrContent.contents;
    this.requests.push([...contents]);
    const reply =
      this.replies[Math.min(this.replyIndex, this.replies.length - 1)];
    this.replyIndex += 1;
    yield { speaker: 'ai', blocks: [{ type: 'text', text: reply }] };
  }
}

export function createRecordingProvider(
  ...replies: string[]
): RecordingProvider {
  return new RecordingProvider(replies);
}

export type StrategyName = 'one-shot' | 'middle-out';

export function createStrategy(
  name: StrategyName,
): OneShotStrategy | MiddleOutStrategy {
  return name === 'one-shot'
    ? new OneShotStrategy(undefined, undefined, undefined, undefined)
    : new MiddleOutStrategy(undefined, undefined, undefined, undefined);
}

export function buildRecordingContext(
  provider: IProvider,
  history: IContent[],
  options: { promptBaseDir?: string; verification?: boolean } = {},
): CompressionContext {
  const base = buildContext({
    history,
    preserveThreshold: 0.3,
    topPreserveThreshold: 0.1,
    resolveProvider: () => {
      const settings = new SettingsService();
      return {
        provider,
        runtime: testProviderRuntime,
        invocation: captureProviderInvocation(
          {
            fetch: requestFetch,
            runtimeId: testProviderRuntime.runtimeId,
            metadata: testProviderRuntime.metadata,
            globalSettings: settings.getAllGlobalSettings(),
            providerSettings: settings.getProviderSettings(provider.name),
          },
          provider.name,
        ),
      };
    },
  });
  return {
    ...base,
    ...(options.promptBaseDir !== undefined
      ? {
          promptResolver: new PromptResolver(),
          promptBaseDir: options.promptBaseDir,
        }
      : {}),
    compressionVerification: options.verification === true,
  };
}

/** Registers a fresh temp prompts directory per test; returns an accessor. */
export function usePromptsDir(): () => string {
  let dir: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'llxprt-4128-prompts-'));
  });
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });
  return () => {
    if (dir === undefined) throw new Error('prompts dir not initialised');
    return dir;
  };
}

/** Copies the shipped compression defaults into a prompts directory. */
export function installShippedCompressionDefaults(promptsDir: string): void {
  cpSync(
    join(SHIPPED_DEFAULTS_DIR, 'compression.md'),
    join(promptsDir, 'compression.md'),
  );
  cpSync(
    join(SHIPPED_DEFAULTS_DIR, 'compression'),
    join(promptsDir, 'compression'),
    { recursive: true },
  );
}

export function writePromptFile(
  promptsDir: string,
  relativePath: string,
  content: string,
): void {
  const fullPath = join(promptsDir, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}
