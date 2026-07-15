/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { DirectMessageProcessor } from './DirectMessageProcessor.js';
import { TurnProcessor } from './TurnProcessor.js';
import { isTerminalRetryError } from './turnAbortHelpers.js';

function terminalError(): Error & {
  readonly isRetryable: false;
  readonly failures: readonly Error[];
} {
  const cause = new Error('transport exhausted');
  return Object.assign(new Error('retries exhausted'), {
    isRetryable: false as const,
    failures: [cause] as readonly Error[],
  });
}

describe('agent processor retry boundaries', () => {
  it('TurnProcessor does not retry a terminal provider aggregate', async () => {
    const error = terminalError();
    let calls = 0;
    const processor = Object.create(TurnProcessor.prototype) as TurnProcessor;
    Object.assign(processor, {
      compressionHandler: {
        enforceProviderContents: async ({
          contents,
        }: {
          contents: unknown[];
        }) => contents,
        clearProviderCompressionCallback: () => undefined,
      },
      runtimeContext: {
        state: { model: 'test-model' },
        providerRuntime: {},
        telemetry: { logApiError: () => undefined },
      },
      resolveProviderBaseUrl: () => undefined,
      generationConfig: {},
      _executeProviderCall: async () => {
        calls++;
        throw error;
      },
      _validateProvider: () => undefined,
      _enforceAndLogProviderContents: async (contents: unknown[]) => contents,
    });

    await expect(
      Reflect.apply(
        (
          processor as unknown as {
            _executeSendWithRetry: (...args: unknown[]) => Promise<unknown>;
          }
        )._executeSendWithRetry,
        processor,
        [
          { message: 'test' },
          [{ speaker: 'human', blocks: [] }],
          { name: 'test-provider' },
          'prompt-id',
        ],
      ),
    ).rejects.toBe(error);
    expect(calls).toBe(1);
  });

  it('DirectMessageProcessor passes the signal and does not retry a terminal aggregate', async () => {
    const error = terminalError();
    const controller = new AbortController();
    let calls = 0;
    const processor = Object.create(
      DirectMessageProcessor.prototype,
    ) as DirectMessageProcessor;
    Object.assign(processor, {
      _executeDirectProviderCall: async () => {
        calls++;
        throw error;
      },
    });

    await expect(
      Reflect.apply(
        (
          processor as unknown as {
            _executeWithRetry: (...args: unknown[]) => Promise<unknown>;
          }
        )._executeWithRetry,
        processor,
        [
          { name: 'test-provider' },
          { message: 'test', config: { abortSignal: controller.signal } },
          [{ speaker: 'human', blocks: [] }],
        ],
      ),
    ).rejects.toBe(error);
    expect(calls).toBe(1);
    expect(isTerminalRetryError(error)).toBe(true);
  });

  it('DirectMessageProcessor honors an already-aborted signal before transport', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const processor = Object.create(
      DirectMessageProcessor.prototype,
    ) as DirectMessageProcessor;
    Object.assign(processor, {
      _executeDirectProviderCall: async () => {
        calls++;
      },
    });

    await expect(
      Reflect.apply(
        (
          processor as unknown as {
            _executeWithRetry: (...args: unknown[]) => Promise<unknown>;
          }
        )._executeWithRetry,
        processor,
        [
          { name: 'test-provider' },
          { message: 'test', config: { abortSignal: controller.signal } },
          [{ speaker: 'human', blocks: [] }],
        ],
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(0);
  });

  it('TurnProcessor stops when aborted during the retry delay', async () => {
    const controller = new AbortController();
    let attempts = 0;
    let releaseAttempt!: () => void;
    const attemptStarted = new Promise<void>((resolve) => {
      releaseAttempt = resolve;
    });
    const processor = Object.create(TurnProcessor.prototype) as TurnProcessor;
    Object.assign(processor, {
      async *_runStreamAttempt() {
        attempts++;
        releaseAttempt();
        yield* [];
        return { error: new Error('retry me'), action: 'retry' as const };
      },
    });

    const generator = Reflect.apply(
      (
        processor as unknown as {
          _createStreamGenerator: (
            ...args: unknown[]
          ) => AsyncGenerator<unknown>;
        }
      )._createStreamGenerator,
      processor,
      [
        { message: 'test', config: { abortSignal: controller.signal } },
        'prompt-id',
        [],
        () => undefined,
      ],
    );
    const pending = generator.next();
    await attemptStarted;
    controller.abort();

    await expect(pending).rejects.toThrow(/abort/i);
    expect(attempts).toBe(1);
  });
});
