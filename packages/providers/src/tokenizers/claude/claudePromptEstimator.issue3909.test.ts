/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3909: a failure while counting a Claude history entry used to escape
 * the calibrated runtime tokenizer as a raw encoder or serialization error,
 * with no model, stage or tokenizer context. The failure now carries the same
 * ModelPromptEstimatorError context as the pre-send estimate and keeps the
 * original error as its cause.
 */

import { describe, expect, it } from 'bun:test';
import * as tiktoken from '@dqbd/tiktoken';
import { LocalTokenizationError } from '@vybestack/llxprt-code-core/utils/errors.js';
import { createRuntimeTokenizerFactory } from '../../composition/runtimeTokenizerFactory.js';
import { ModelPromptEstimatorError } from '../ModelPromptEstimatorError.js';
import type { TiktokenModuleLoader } from '../o200kBaseCounter.js';

const MODEL = 'claude-opus-5';

function failingEncodeLoader(failure: Error): TiktokenModuleLoader {
  return async () => ({
    ...tiktoken,
    get_encoding: (...args: Parameters<typeof tiktoken.get_encoding>) =>
      new Proxy(tiktoken.get_encoding(...args), {
        get(target, property, receiver) {
          if (property === 'encode') {
            return (): never => {
              throw failure;
            };
          }
          return Reflect.get(target, property, receiver);
        },
      }),
  });
}

function claudeTokenizer(loadModule: TiktokenModuleLoader) {
  const tokenizer = createRuntimeTokenizerFactory(loadModule).getTokenizer(
    'claudecode',
    MODEL,
  );
  if (tokenizer === undefined) {
    throw new Error(`no runtime tokenizer is registered for ${MODEL}`);
  }
  return tokenizer;
}

async function captureRejection(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error('expected the operation to reject');
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('Claude calibrated runtime tokenizer failures (issue #3909)', () => {
  it('reports an unavailable base encoder with model context and the original cause', async () => {
    const failure = new Error('o200k wasm asset is corrupt');
    const tokenizer = claudeTokenizer(() => Promise.reject(failure));

    const error = await captureRejection(
      Promise.resolve(tokenizer.countTokens('hello')),
    );

    expect(error).toBeInstanceOf(ModelPromptEstimatorError);
    expect(error).toMatchObject({
      code: 'asset-unavailable',
      context: {
        activeProvider: 'claudecode',
        canonicalModel: MODEL,
        protocol: 'anthropic-messages',
      },
      cause: failure,
    });
  });

  it('reports a failing encode as tokenization-failed with the original cause', async () => {
    const failure = new Error('encode exploded');
    const tokenizer = claudeTokenizer(failingEncodeLoader(failure));

    const error = await captureRejection(
      Promise.resolve(tokenizer.countTokens('hello')),
    );

    expect(error).toBeInstanceOf(ModelPromptEstimatorError);
    expect(error).toMatchObject({
      code: 'tokenization-failed',
      context: { canonicalModel: MODEL, protocol: 'anthropic-messages' },
      cause: failure,
    });
  });

  it('does not expose the counted text in the failure', async () => {
    const secret = 'do not serialize this history entry';
    const tokenizer = claudeTokenizer(
      failingEncodeLoader(new Error('encode exploded')),
    );

    const error = await captureRejection(
      Promise.resolve(tokenizer.countTokens(secret)),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error && error.message).not.toContain(secret);
  });

  it('reports content that cannot be serialized as tokenization-failed with the original cause', async () => {
    const tokenizer = claudeTokenizer(() => Promise.resolve(tiktoken));

    const error = await captureRejection(
      Promise.resolve(tokenizer.countTokens({ value: 1n })),
    );

    expect(error).toBeInstanceOf(ModelPromptEstimatorError);
    expect(error).toMatchObject({
      code: 'tokenization-failed',
      context: { canonicalModel: MODEL },
    });
    expect(error instanceof Error && error.cause).toBeInstanceOf(TypeError);
  });

  it('still counts ordinary content', async () => {
    const tokenizer = claudeTokenizer(() => Promise.resolve(tiktoken));

    expect(await tokenizer.countTokens('hello world')).toBeGreaterThan(0);
  });
});

describe('ModelPromptEstimatorError classification and causal detail (issue #3909)', () => {
  it('is a local tokenization failure so the display never presents it as an API error', async () => {
    const tokenizer = claudeTokenizer(
      failingEncodeLoader(new Error('encode exploded')),
    );

    const error = await captureRejection(
      Promise.resolve(tokenizer.countTokens('hello')),
    );

    expect(error).toBeInstanceOf(LocalTokenizationError);
  });

  it('states the cause detail once in the message for a Claude tokenizer failure', async () => {
    const tokenizer = claudeTokenizer(
      failingEncodeLoader(new Error('encode exploded')),
    );

    const error = await captureRejection(
      Promise.resolve(tokenizer.countTokens('hello')),
    );

    const message = error instanceof Error ? error.message : '';
    expect(occurrences(message, 'encode exploded')).toBe(1);
  });

  it('states the cause detail once in the message for a GPT-5.6 readiness failure', async () => {
    const factory = createRuntimeTokenizerFactory(() =>
      Promise.reject(new Error('codec initialization exploded')),
    );
    const prepareTokenizer = factory.prepareTokenizer;
    if (prepareTokenizer === undefined) {
      throw new Error('runtime tokenizer factory has no readiness operation');
    }

    const error = await captureRejection(
      prepareTokenizer('codex', 'gpt-5.6-sol'),
    );

    const message = error instanceof Error ? error.message : '';
    expect(occurrences(message, 'codec initialization exploded')).toBe(1);
  });

  it('keeps remediation free of the cause so callers can show them separately', async () => {
    const factory = createRuntimeTokenizerFactory(() =>
      Promise.reject(new Error('codec initialization exploded')),
    );
    const prepareTokenizer = factory.prepareTokenizer;
    if (prepareTokenizer === undefined) {
      throw new Error('runtime tokenizer factory has no readiness operation');
    }

    const error = await captureRejection(
      prepareTokenizer('codex', 'gpt-5.6-sol'),
    );

    expect(error).toBeInstanceOf(ModelPromptEstimatorError);
    expect(
      error instanceof ModelPromptEstimatorError && error.remediation,
    ).not.toContain('codec initialization exploded');
  });
});
