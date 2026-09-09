/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260909-ISSUE3444
 *
 * Issue #3444 — RetryOrchestrator must never replay a spent
 * promptEnvelopeTransportToken. Providers treat that token as a one-shot
 * prepared envelope: the media request it carries is released when the
 * attempt that consumed it finishes. A retry that replays the token hits
 * `Cannot consume media request contents after release` and masks the real
 * transport error.
 *
 * The fake provider below implements the same one-shot contract the real
 * providers implement (attempt-scoped release of the prepared envelope), so
 * these tests exercise the orchestrator contract without provider internals.
 */

import { describe, it, expect } from 'bun:test';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import type {
  IProvider,
  GenerateChatOptions,
} from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IModel } from '../IModel.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';

interface OneShotEnvelope {
  readonly token: object;
  attemptReleases: number;
  unsentReleases: number;
  released: boolean;
}

interface RecordedAttempt {
  readonly token: object | undefined;
  readonly error: unknown | undefined;
  readonly succeeded: boolean;
}

function createRateLimitError(): Error {
  const error = new Error('Rate limit exceeded') as Error & {
    status?: number;
  };
  error.status = 429;
  return error;
}

interface OneShotProviderConfig {
  readonly failFirstSend: boolean;
  readonly refreshProjection:
    | 'fresh'
    | 'undefined'
    | { readonly error: Error };
}

function createOneShotProjectedProvider(
  config: OneShotProviderConfig,
): {
  provider: IProvider;
  envelopes: OneShotEnvelope[];
  attempts: RecordedAttempt[];
  projectionCalls: () => number;
} {
  const envelopes: OneShotEnvelope[] = [];
  const attempts: RecordedAttempt[] = [];
  const envelopeByToken = new Map<object, OneShotEnvelope>();
  let projectionCalls = 0;

  const provider: IProvider = {
    name: 'one-shot-projected-provider',
    async projectPromptEnvelope(
      options: GenerateChatOptions,
    ): Promise<PromptEnvelopeProjection> {
      projectionCalls += 1;
      if (
        projectionCalls > 1 &&
        config.refreshProjection !== 'fresh'
      ) {
        if (config.refreshProjection === 'undefined') {
          return undefined as unknown as PromptEnvelopeProjection;
        }
        throw config.refreshProjection.error;
      }
      const envelope: OneShotEnvelope = {
        token: Object.freeze({ sequence: envelopes.length }),
        attemptReleases: 0,
        unsentReleases: 0,
        released: false,
      };
      envelopes.push(envelope);
      envelopeByToken.set(envelope.token, envelope);
      return {
        model: options.resolved?.model ?? 'test-model',
        protocol: 'openai-responses',
        method: 'responses/v1',
        projectionRevision: 1,
        unsupportedMedia: [],
        transportToken: envelope.token,
        finalizedProjection: Object.freeze({
          kind: 'test-envelope',
          sequence: envelopes.length,
        }),
        legacyEstimate: () => Promise.resolve(1),
        releaseIfUnsent: () => {
          envelope.unsentReleases += 1;
          envelope.released = true;
          return Promise.resolve();
        },
      };
    },
    async *generateChatCompletion(
      options: GenerateChatOptions,
    ): AsyncIterableIterator<IContent> {
      const token = options.promptEnvelopeTransportToken;
      const envelope = token === undefined ? undefined : envelopeByToken.get(token);
      if (token !== undefined && envelope === undefined) {
        throw new Error('Unknown prompt-envelope transport token');
      }
      let error: unknown;
      let succeeded = false;
      try {
        if (envelope !== undefined) {
          if (envelope.released) {
            throw new Error(
              'Cannot consume media request contents after release',
            );
          }
        }
        const sendIndex = attempts.length;
        if (config.failFirstSend && sendIndex === 0) {
          throw createRateLimitError();
        }
        succeeded = true;
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      } catch (caught) {
        error = caught;
        throw error;
      } finally {
        attempts.push({ token, error, succeeded });
        if (envelope !== undefined) {
          envelope.attemptReleases += 1;
          envelope.released = true;
        }
      }
    },
    async getModels(): Promise<IModel[]> {
      return [];
    },
    getDefaultModel(): string {
      return 'test-model';
    },
  };

  return {
    provider,
    envelopes,
    attempts,
    projectionCalls: () => projectionCalls,
  };
}

function buildOptions(token: object | undefined): GenerateChatOptions {
  const base = createProviderCallOptions({
    providerName: 'one-shot-projected-provider',
    contents: [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'hello' }],
      },
    ],
    ephemerals: { retries: 2, retrywait: 0 },
  } as Parameters<typeof createProviderCallOptions>[0]);
  return token === undefined
    ? base
    : { ...base, promptEnvelopeTransportToken: token };
}

async function drain(
  iterator: AsyncIterableIterator<IContent>,
): Promise<{ chunks: IContent[]; error: unknown | undefined }> {
  const chunks: IContent[] = [];
  let error: unknown | undefined;
  try {
    for await (const chunk of iterator) chunks.push(chunk);
  } catch (caught) {
    error = caught;
  }
  return { chunks, error };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe('RetryOrchestrator prompt-envelope retry contract (@issue:3444)', () => {
  it('retries with a freshly projected transport token instead of the spent one', async () => {
    const { provider, envelopes, attempts, projectionCalls } =
      createOneShotProjectedProvider({
        failFirstSend: true,
        refreshProjection: 'fresh',
      });
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 2,
      initialDelayMs: 0,
    });

    // The caller (agent seam) mints the original projection, exactly as the
    // production entry point does before handing options + token over.
    const firstProjection = await provider.projectPromptEnvelope(
      buildOptions(undefined),
    );
    const originalToken = firstProjection.transportToken;
    expect(originalToken).toBe(envelopes[0].token);

    const { chunks, error } = await drain(
      orchestrator.generateChatCompletion(buildOptions(originalToken)),
    );

    expect(error).toBeUndefined();
    expect(chunks).toHaveLength(1);
    // First attempt keeps the caller's original token; the retry must carry
    // a different token minted by a second projection call.
    expect(attempts).toHaveLength(2);
    expect(attempts[0].token).toBe(originalToken);
    expect(attempts[1].token).toBeDefined();
    expect(attempts[1].token).not.toBe(originalToken);
    expect(attempts[1].succeeded).toBe(true);
    // Caller projection + orchestrator refresh projection.
    expect(projectionCalls()).toBe(2);
    // No attempt ever observed the release error.
    for (const attempt of attempts) {
      expect(attempt.error).not.toMatchObject({
        message: 'Cannot consume media request contents after release',
      });
    }
  });

  it('releases every minted envelope exactly once across the retry cycle', async () => {
    const { provider, envelopes } = createOneShotProjectedProvider({
      failFirstSend: true,
      refreshProjection: 'fresh',
    });
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 2,
      initialDelayMs: 0,
    });

    const firstProjection = await provider.projectPromptEnvelope(
      buildOptions(undefined),
    );
    const { error } = await drain(
      orchestrator.generateChatCompletion(
        buildOptions(firstProjection.transportToken),
      ),
    );

    expect(error).toBeUndefined();
    expect(envelopes).toHaveLength(2);
    // Both envelopes were consumed by a provider attempt, which is the sole
    // releaser on the success path (no unsent-release double fire).
    for (const envelope of envelopes) {
      expect(envelope.attemptReleases).toBe(1);
      expect(envelope.unsentReleases).toBe(0);
      expect(envelope.released).toBe(true);
    }
  });

  it('falls back to unprojected attempts when the provider cannot re-project on refresh', async () => {
    const { provider, envelopes, attempts } = createOneShotProjectedProvider({
      failFirstSend: true,
      refreshProjection: 'undefined',
    });
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 2,
      initialDelayMs: 0,
    });

    const firstProjection = await provider.projectPromptEnvelope(
      buildOptions(undefined),
    );
    const { chunks, error } = await drain(
      orchestrator.generateChatCompletion(
        buildOptions(firstProjection.transportToken),
      ),
    );

    expect(error).toBeUndefined();
    expect(chunks).toHaveLength(1);
    expect(attempts).toHaveLength(2);
    // The retry must NOT carry the spent token: it either carries a fresh
    // one or none at all (degraded to unprojected re-resolution).
    expect(attempts[1].token).not.toBe(envelopes[0].token);
  });

  it('surfaces a failed refresh as the attempt error instead of a release error', async () => {
    const projectionFailure = new Error('projection backend unavailable');
    const { provider, envelopes, attempts } = createOneShotProjectedProvider({
      failFirstSend: true,
      refreshProjection: { error: projectionFailure },
    });
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 2,
      initialDelayMs: 0,
    });

    const firstProjection = await provider.projectPromptEnvelope(
      buildOptions(undefined),
    );
    const { error } = await drain(
      orchestrator.generateChatCompletion(
        buildOptions(firstProjection.transportToken),
      ),
    );

    expect(error).toBeDefined();
    // The refresh failure surfaces (or is classified terminally), never the
    // media release error.
    expect(errorMessage(error)).not.toContain(
      'Cannot consume media request contents after release',
    );
    // Only the first physical send happened; the retry died in refresh.
    expect(attempts).toHaveLength(1);
    // Only the caller's projection was ever minted.
    expect(envelopes).toHaveLength(1);
  });

  it('does not invoke projectPromptEnvelope when no token was supplied', async () => {
    const { provider, attempts, projectionCalls } =
      createOneShotProjectedProvider({
        failFirstSend: true,
        refreshProjection: 'fresh',
      });
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 2,
      initialDelayMs: 0,
    });

    const { chunks, error } = await drain(
      orchestrator.generateChatCompletion(buildOptions(undefined)),
    );

    expect(error).toBeUndefined();
    expect(chunks).toHaveLength(1);
    expect(attempts).toHaveLength(2);
    expect(attempts.every((attempt) => attempt.token === undefined)).toBe(
      true,
    );
    expect(projectionCalls()).toBe(0);
  });
});
