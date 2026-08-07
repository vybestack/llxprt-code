/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fence test for issue #3048 (REQ-3048-001).
 *
 * The discard-and-restart contract depends on a property that already exists:
 * `RetryOrchestrator.yieldStreamUnprotected` marks any error raised after an
 * `IContent` was yielded as terminal and refuses to retry inside the SAME
 * iterator, because doing so would splice two generations into one stream. The
 * turn-level restart happens at the fresh-attempt boundary owned by
 * `TurnProcessor` instead (specification AD-1).
 *
 * This test passes on unmodified source. It exists so a future "just let the
 * orchestrator retry after output" edit fails loudly — that edit would break the
 * anti-mixing rule the whole fix relies on.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  GenerateChatOptions,
  IProvider,
  ProviderToolset,
} from '../IProvider.js';
import type { IModel } from '../IModel.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import {
  isTerminalRetryError,
  markErrorAfterStreamOutput,
} from '../retryErrorClassification.js';

describe('RetryOrchestrator partial-output boundary (issue 3048 fence)', () => {
  it('does not retry inside one iterator after yielding output and propagates the same error', async () => {
    const thrownError = new Error('Connection error.');

    let generateCallCount = 0;
    class PartialOutputProvider implements IProvider {
      readonly name = 'partial-output-boundary-provider';

      generateChatCompletion(
        options: GenerateChatOptions,
      ): AsyncIterableIterator<IContent>;
      generateChatCompletion(
        content: IContent[],
        tools?: ProviderToolset,
        signal?: AbortSignal,
      ): AsyncIterableIterator<IContent>;
      async *generateChatCompletion(
        _optionsOrContent: GenerateChatOptions | IContent[],
        _tools?: ProviderToolset,
        _signal?: AbortSignal,
      ): AsyncIterableIterator<IContent> {
        generateCallCount += 1;
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'partial' }],
        };
        throw thrownError;
      }

      async getModels(): Promise<IModel[]> {
        return [];
      }

      getDefaultModel(): string {
        return 'test-model';
      }

      getServerTools(): string[] {
        return [];
      }

      async invokeServerTool(): Promise<unknown> {
        return null;
      }
    }
    const provider = new PartialOutputProvider();

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 6,
      initialDelayMs: 0,
    });

    const collected: IContent[] = [];
    let rejected: unknown;
    try {
      for await (const chunk of orchestrator.generateChatCompletion({
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
      })) {
        collected.push(chunk);
      }
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toBe(thrownError);

    expect(generateCallCount).toBe(1);
    expect(collected).toStrictEqual([
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'partial' }],
      },
    ]);

    expect('isRetryable' in thrownError).toBe(false);
    expect(isTerminalRetryError(thrownError)).toBe(true);
  });

  it('marks an after-output error terminal via the provider WeakSet (agents layer must not see it)', () => {
    // The agents-layer predicate (turnAbortHelpers.isTerminalRetryError) keys off
    // `isRetryable === false`. The provider mark keys off a private WeakSet, so a
    // post-output transient transport error is terminal in providers but NOT
    // terminal in agents — that is what lets the turn layer restart it. This pins
    // the asymmetry directly against the two classification mechanisms.
    const error = new Error('Connection error.');
    expect('isRetryable' in error).toBe(false);
    const marked = markErrorAfterStreamOutput(error);
    expect(marked).toBe(error);
    expect(isTerminalRetryError(marked)).toBe(true);
  });
});
