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
import {
  tryConsumeTransportAttempt,
  attachTransportAttemptBudget,
} from '../transportAttemptBudget.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IModel } from '../IModel.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { streamCallOptions } from './streamCallOptions.js';
import { isAsyncIterableContents } from '../utils/collectContents.js';

interface OneShotEnvelope {
  readonly token: object;
  attemptDisposals: number;
  unsentDisposals: number;
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
  readonly refreshProjection: 'fresh' | 'undefined' | { readonly error: Error };
}

function createOneShotProjectedProvider(config: OneShotProviderConfig): {
  provider: IProvider;
  envelopes: OneShotEnvelope[];
  attempts: RecordedAttempt[];
  projectionCalls: () => number;
} {
  const state: OneShotProviderState = {
    config,
    envelopes: [],
    attempts: [],
    envelopeByToken: new Map(),
    projectionCalls: 0,
  };

  const provider: IProvider = {
    name: 'one-shot-projected-provider',
    projectPromptEnvelope: (options) => projectEnvelope(state, options),
    generateChatCompletion: (options) => generateEnvelope(state, options),
    async getModels(): Promise<IModel[]> {
      return [];
    },
    getDefaultModel(): string {
      return 'test-model';
    },
  };

  return {
    provider,
    envelopes: state.envelopes,
    attempts: state.attempts,
    projectionCalls: () => state.projectionCalls,
  };
}

/**
 * Mint a projection through the fake provider with the optional-method
 * narrowing the orchestrator performs at runtime.
 */
async function mintEnvelope(
  provider: IProvider,
  options: GenerateChatOptions,
): Promise<PromptEnvelopeProjection> {
  const project = provider.projectPromptEnvelope;
  if (project === undefined) {
    throw new Error('test provider cannot project prompt envelopes');
  }
  const projection = await project.call(provider, options);
  if (projection === undefined) {
    throw new Error('test provider declined to mint a prompt envelope');
  }
  return projection;
}

function buildOptions(token: object | undefined): GenerateChatOptions {
  const base = streamCallOptions({
    providerName: 'one-shot-projected-provider',
    contents: [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'hello' }],
      },
    ],
    ephemerals: { retries: 2, retrywait: 0 },
  });
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
  registerBehavior1();

  registerBehavior2();

  registerBehavior3();

  registerBehavior4();

  registerBehavior5();

  registerBehavior6();
  registerBehavior7();

  registerBehavior8();

  registerBehavior9();

  registerBehavior10();

  registerBehavior11();

  registerBehavior12();

  registerBehavior13();
});

function registerBehavior1(): void {
  describe('RetryOrchestrator prompt-envelope retry contract (@issue:3444) [1]', () => {
    it('aborts while a refresh remains pending without waiting for its projection', async () => {
      const { provider, attempts } = createOneShotProjectedProvider({
        failFirstSend: true,
        refreshProjection: 'fresh',
      });
      const options = buildOptions(undefined);
      const original = await mintEnvelope(provider, options);
      let notifyStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        notifyStarted = resolve;
      });
      let rejectRefresh: ((error: Error) => void) | undefined;
      const pending = new Promise<PromptEnvelopeProjection>(
        (_resolve, reject) => {
          rejectRefresh = reject;
        },
      );
      provider.projectPromptEnvelope = () => {
        if (notifyStarted === undefined)
          throw new Error('Missing start resolver');
        notifyStarted();
        return pending;
      };
      const controller = new AbortController();
      const result = drain(
        new RetryOrchestrator(provider, {
          maxAttempts: 2,
          initialDelayMs: 0,
        }).generateChatCompletion(
          { ...options, promptEnvelopeTransportToken: original.transportToken },
          undefined,
          controller.signal,
        ),
      );
      await started;
      controller.abort();

      const { error, chunks } = await result;
      expect(error instanceof Error && error.name).toBe('AbortError');
      expect(chunks).toHaveLength(0);
      expect(attempts).toHaveLength(1);
      if (rejectRefresh === undefined)
        throw new Error('Missing refresh rejecter');
      rejectRefresh(new Error('projection failed after cancellation'));
    });
  });
}

function registerBehavior2(): void {
  describe('RetryOrchestrator prompt-envelope retry contract (@issue:3444) [2]', () => {
    it('sends once on entry with pre-consumed shared budget when retries remain only for numbering', async () => {
      const { provider, attempts } = createOneShotProjectedProvider({
        failFirstSend: false,
        refreshProjection: 'fresh',
      });
      const attached = attachTransportAttemptBudget(buildOptions(undefined), 4);
      try {
        expect(tryConsumeTransportAttempt(attached.options)).toBe(true);
        expect(tryConsumeTransportAttempt(attached.options)).toBe(true);
        const { chunks, error } = await drain(
          new RetryOrchestrator(provider, {
            maxAttempts: 2,
            initialDelayMs: 0,
          }).generateChatCompletion(attached.options),
        );

        expect({
          sends: attempts.length,
          chunks,
          error,
          used: attached.budget.used,
        }).toStrictEqual({
          sends: 1,
          chunks: [{ speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] }],
          error: undefined,
          used: 3,
        });
      } finally {
        attached.release();
      }
    });
  });
}

function registerBehavior3(): void {
  describe('RetryOrchestrator prompt-envelope retry contract (@issue:3444) [3]', () => {
    it('exhausts token-less retries using pre-consumed shared budget attempts', async () => {
      const { provider, attempts, projectionCalls } =
        createOneShotProjectedProvider({
          failFirstSend: true,
          refreshProjection: 'fresh',
        });
      const attached = attachTransportAttemptBudget(buildOptions(undefined), 4);
      try {
        expect(tryConsumeTransportAttempt(attached.options)).toBe(true);
        const { chunks, error } = await drain(
          new RetryOrchestrator(provider, {
            maxAttempts: 2,
            initialDelayMs: 0,
          }).generateChatCompletion(attached.options),
        );

        expect({
          sends: attempts.length,
          budgetUsed: attached.budget.used,
          outcome: errorMessage(error),
          chunks: chunks.length,
        }).toStrictEqual({
          sends: 1,
          budgetUsed: 2,
          outcome: expect.stringContaining(
            'retries exhausted after 2 transport attempts',
          ),
          chunks: 0,
        });
        expect(projectionCalls()).toBe(0);
      } finally {
        attached.release();
      }
    });
  });
}

function registerBehavior4(): void {
  describe('RetryOrchestrator prompt-envelope retry contract (@issue:3444) [4]', () => {
    it('refreshes a spent token with pre-consumed shared budget when a retry remains', async () => {
      const { provider, attempts, envelopes } = createOneShotProjectedProvider({
        failFirstSend: true,
        refreshProjection: 'fresh',
      });
      const base = buildOptions(undefined);
      const original = await mintEnvelope(provider, base);
      const attached = attachTransportAttemptBudget(
        {
          ...base,
          invocation:
            base.invocation === undefined
              ? undefined
              : {
                  ...base.invocation,
                  ephemerals: { retries: 3, retrywait: 0 },
                },
          promptEnvelopeTransportToken: original.transportToken,
        },
        4,
      );
      try {
        expect(tryConsumeTransportAttempt(attached.options)).toBe(true);
        const { chunks, error } = await drain(
          new RetryOrchestrator(provider, {
            maxAttempts: 3,
            initialDelayMs: 0,
          }).generateChatCompletion(attached.options),
        );

        expect(error).toBeUndefined();
        expect(chunks).toHaveLength(1);
        expect(attempts).toHaveLength(2);
        expect(attached.budget.used).toBe(3);
        expect(attempts[0].token).toBe(original.transportToken);
        expect(attempts[1].token).toBeDefined();
        expect(attempts[1].token).not.toBe(original.transportToken);
        expect(attempts[1].succeeded).toBe(true);
        expect(envelopes).toHaveLength(2);
        for (const envelope of envelopes) {
          expect(envelope.attemptDisposals).toBe(1);
          expect(envelope.unsentDisposals).toBe(0);
        }
      } finally {
        attached.release();
      }
    });
  });
}

function registerBehavior5(): void {
  describe('RetryOrchestrator prompt-envelope retry contract (@issue:3444) [5]', () => {
    it.each([
      'preflight rejection',
      'returned before starting',
      'cancel during preparation',
    ])(
      'disposes the fresh envelope once after %s without entering its body',
      verifyPreparedEnvelopeDisposal,
    );
  });
}

function registerBehavior6(): void {
  describe('RetryOrchestrator prompt-envelope retry contract (@issue:3444) [6]', () => {
    it('stops after two provider-owned sends and one failed refresh exhaust the combined cap', async () => {
      const { provider } = createOneShotProjectedProvider({
        failFirstSend: true,
        refreshProjection: 'fresh',
      });
      const original = await mintEnvelope(provider, buildOptions(undefined));
      const attached = attachTransportAttemptBudget(
        buildOptions(original.transportToken),
        3,
      );
      const refreshError = Object.assign(new Error('refresh quota exhausted'), {
        status: 429,
      });
      let sends = 0;
      let refreshes = 0;
      provider.transportAttemptOwnership = 'provider';
      provider.generateChatCompletion = async function* (options) {
        if (isAsyncIterableContents(options))
          throw new Error('Expected request options');
        for (let index = 0; index < 2; index += 1) {
          if (tryConsumeTransportAttempt(options)) sends += 1;
        }
        await original.releaseIfUnsent?.();
        yield await Promise.reject<IContent>(createRateLimitError());
      };
      provider.projectPromptEnvelope = async () => {
        refreshes += 1;
        throw refreshError;
      };
      try {
        const options = attached.options;
        const { error } = await drain(
          new RetryOrchestrator(provider, {
            maxAttempts: 3,
            initialDelayMs: 0,
          }).generateChatCompletion({
            ...options,
            invocation:
              options.invocation === undefined
                ? undefined
                : {
                    ...options.invocation,
                    ephemerals: { retries: 3, retrywait: 0 },
                  },
          }),
        );
        expect(error instanceof Error ? error.cause : undefined).toBe(
          refreshError,
        );
        expect(sends).toBe(2);
        expect(refreshes).toBe(1);
        expect(attached.budget.used).toBe(2);
      } finally {
        attached.release();
      }
    });
  });
}

function registerBehavior7(): void {
  describe('RetryOrchestrator prompt-envelope retry contract (@issue:3444) [7]', () => {
    it.each([false, true])(
      'releases a refresh resolved after cancellation without starting another provider body (release rejects: %s)',
      async (releaseRejects) => {
        const { provider, envelopes, attempts } =
          createOneShotProjectedProvider({
            failFirstSend: true,
            refreshProjection: 'fresh',
          });
        const options = buildOptions(undefined);
        const original = await mintEnvelope(provider, options);
        let resolveFresh:
          | ((value: PromptEnvelopeProjection) => void)
          | undefined;
        const pending = new Promise<PromptEnvelopeProjection>((resolve) => {
          resolveFresh = resolve;
        });
        let notifyStarted: (() => void) | undefined;
        const started = new Promise<void>((resolve) => {
          notifyStarted = resolve;
        });
        const project = provider.projectPromptEnvelope;
        if (project === undefined) throw new Error('Missing projection seam');
        provider.projectPromptEnvelope = () => {
          if (notifyStarted === undefined)
            throw new Error('Missing start resolver');
          notifyStarted();
          return pending;
        };
        const controller = new AbortController();
        const orchestrator = new RetryOrchestrator(provider, {
          maxAttempts: 2,
          initialDelayMs: 0,
        });
        const result = drain(
          orchestrator.generateChatCompletion(
            {
              ...options,
              promptEnvelopeTransportToken: original.transportToken,
            },
            undefined,
            controller.signal,
          ),
        );
        await started;
        controller.abort();
        const fresh = await project.call(provider, options);
        if (fresh === undefined) throw new Error('Missing fresh projection');
        if (resolveFresh === undefined)
          throw new Error('Missing refresh resolver');
        resolveFresh({
          ...fresh,
          releaseIfUnsent: async () => {
            await fresh.releaseIfUnsent?.();
            if (releaseRejects) throw new Error('unsent release failed');
          },
        });
        const { error } = await result;
        expect(error).toBeInstanceOf(Error);
        expect(error instanceof Error && error.name).toBe('AbortError');
        expect(attempts).toHaveLength(1);
        expect(envelopes[1].unsentDisposals).toBe(1);
        expect(envelopes[1].attemptDisposals).toBe(0);
        expect(envelopes[1].released).toBe(true);
      },
    );
  });
}

function registerBehavior8(): void {
  describe('RetryOrchestrator prompt-envelope retry contract (@issue:3444) [8]', () => {
    it.each([2, 3])(
      'bounds retryable refresh failures at %s attempts and preserves the last projection error',
      async (limit) => {
        const { provider, attempts } = createOneShotProjectedProvider({
          failFirstSend: true,
          refreshProjection: 'fresh',
        });
        const options = buildOptions(undefined);
        const original = await mintEnvelope(provider, options);
        const failures: Error[] = [];
        provider.projectPromptEnvelope = async () => {
          const failure = Object.assign(
            new Error(`refresh rate limit ${failures.length + 1}`),
            { status: 429 },
          );
          failures.push(failure);
          // Fail deterministically instead of leaving a broken retry loop running.
          if (failures.length >= limit)
            throw new Error('recovery limit exceeded');
          throw failure;
        };
        const orchestrator = new RetryOrchestrator(provider, {
          maxAttempts: limit,
          initialDelayMs: 0,
        });
        const { error } = await drain(
          orchestrator.generateChatCompletion({
            ...options,
            invocation:
              options.invocation === undefined
                ? undefined
                : {
                    ...options.invocation,
                    ephemerals: { retries: limit, retrywait: 0 },
                  },
            promptEnvelopeTransportToken: original.transportToken,
          }),
        );
        expect(failures).toHaveLength(limit - 1);
        expect(error instanceof Error ? error.cause : undefined).toBe(
          failures[limit - 2],
        );
        expect(errorMessage(error)).toContain(failures[limit - 2].message);
        expect(attempts).toHaveLength(1);
      },
    );
  });
}

function registerBehavior9(): void {
  describe('RetryOrchestrator prompt-envelope retry contract (@issue:3444) [9]', () => {
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
      const firstProjection = await mintEnvelope(
        provider,
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
        expect(errorMessage(attempt.error)).not.toContain(
          'Cannot consume media request contents after release',
        );
      }
    });
  });
}

function registerBehavior10(): void {
  describe('RetryOrchestrator prompt-envelope retry contract (@issue:3444) [10]', () => {
    it('releases every minted envelope exactly once across the retry cycle', async () => {
      const { provider, envelopes } = createOneShotProjectedProvider({
        failFirstSend: true,
        refreshProjection: 'fresh',
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 2,
        initialDelayMs: 0,
      });

      const firstProjection = await mintEnvelope(
        provider,
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
        expect(envelope.attemptDisposals).toBe(1);
        expect(envelope.unsentDisposals).toBe(0);
        expect(envelope.released).toBe(true);
      }
    });
  });
}

function registerBehavior11(): void {
  describe('RetryOrchestrator prompt-envelope retry contract (@issue:3444) [11]', () => {
    it('falls back to unprojected attempts when the provider cannot re-project on refresh', async () => {
      const { provider, envelopes, attempts } = createOneShotProjectedProvider({
        failFirstSend: true,
        refreshProjection: 'undefined',
      });
      const orchestrator = new RetryOrchestrator(provider, {
        maxAttempts: 2,
        initialDelayMs: 0,
      });

      const firstProjection = await mintEnvelope(
        provider,
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
  });
}

function registerBehavior12(): void {
  describe('RetryOrchestrator prompt-envelope retry contract (@issue:3444) [12]', () => {
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

      const firstProjection = await mintEnvelope(
        provider,
        buildOptions(undefined),
      );
      const { error } = await drain(
        orchestrator.generateChatCompletion(
          buildOptions(firstProjection.transportToken),
        ),
      );

      expect(error).toBe(projectionFailure);
      expect(errorMessage(error)).toBe(projectionFailure.message);
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
  });
}

function registerBehavior13(): void {
  describe('RetryOrchestrator prompt-envelope retry contract (@issue:3444) [13]', () => {
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
}

interface OneShotProviderState {
  readonly config: OneShotProviderConfig;
  readonly envelopes: OneShotEnvelope[];
  readonly attempts: RecordedAttempt[];
  readonly envelopeByToken: Map<object, OneShotEnvelope>;
  projectionCalls: number;
}
async function projectEnvelope(
  state: OneShotProviderState,
  options: GenerateChatOptions,
): Promise<PromptEnvelopeProjection | undefined> {
  state.projectionCalls += 1;
  if (state.projectionCalls > 1 && state.config.refreshProjection !== 'fresh') {
    if (state.config.refreshProjection === 'undefined') {
      return undefined;
    }
    throw state.config.refreshProjection.error;
  }
  const envelope: OneShotEnvelope = {
    token: Object.freeze({ sequence: state.envelopes.length }),
    attemptDisposals: 0,
    unsentDisposals: 0,
    released: false,
  };
  state.envelopes.push(envelope);
  state.envelopeByToken.set(envelope.token, envelope);
  return {
    model: options.resolved?.model ?? 'test-model',
    protocol: 'openai-responses',
    method: 'responses/v1',
    projectionRevision: 1,
    unsupportedMedia: [],
    transportToken: envelope.token,
    finalizedProjection: Object.freeze({
      kind: 'test-envelope',
      sequence: state.envelopes.length,
    }),
    legacyEstimate: () => Promise.resolve(1),
    releaseIfUnsent: async () => {
      if (envelope.released) return;
      envelope.released = true;
      envelope.unsentDisposals += 1;
    },
  };
}
async function* generateEnvelope(
  state: OneShotProviderState,
  optionsOrContents: GenerateChatOptions | AsyncIterable<IContent>,
): AsyncIterableIterator<IContent> {
  const options: GenerateChatOptions = isAsyncIterableContents(
    optionsOrContents,
  )
    ? { contents: optionsOrContents }
    : optionsOrContents;
  const token = options.promptEnvelopeTransportToken;
  const envelope =
    token === undefined ? undefined : state.envelopeByToken.get(token);
  if (token !== undefined && envelope === undefined) {
    throw new Error('Unknown prompt-envelope transport token');
  }
  let error: unknown;
  let succeeded = false;
  try {
    if (envelope?.released === true) {
      throw new Error('Cannot consume media request contents after release');
    }
    const sendIndex = state.attempts.length;
    if (state.config.failFirstSend && sendIndex === 0) {
      throw createRateLimitError();
    }
    succeeded = true;
    yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
  } catch (caught) {
    error = caught;
    throw error;
  } finally {
    state.attempts.push({ token, error, succeeded });
    if (envelope !== undefined && !envelope.released) {
      envelope.released = true;
      envelope.attemptDisposals += 1;
    }
  }
}

async function verifyPreparedEnvelopeDisposal(mode: string): Promise<void> {
  const { provider, envelopes, attempts } = createOneShotProjectedProvider({
    failFirstSend: true,
    refreshProjection: 'fresh',
  });
  const original = await mintEnvelope(provider, buildOptions(undefined));
  const generate = provider.generateChatCompletion.bind(provider);
  const controller = new AbortController();
  const failure = new Error('adapter preparation failed');
  let calls = 0;
  let bodies = 0;
  provider.generateChatCompletion = (options) => {
    if (isAsyncIterableContents(options))
      throw new Error('Expected request options');
    calls += 1;
    if (calls === 1) return generate(options);
    const body = (async function* (): AsyncIterableIterator<IContent> {
      bodies += 1;
      yield* generate(options);
    })();
    const preparation = async (): Promise<void> => {
      if (mode === 'preflight rejection') throw failure;
      if (mode === 'returned before starting') {
        await body.return?.();
        throw failure;
      }
      await new Promise<void>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve(), {
          once: true,
        });
        controller.abort(failure);
      });
      throw failure;
    };
    let pending: Promise<void> | undefined;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        pending ??= preparation();
        await pending;
        return body.next();
      },
      async return() {
        await body.return?.();
        return { done: true, value: undefined };
      },
    };
  };
  const { error } = await drain(
    new RetryOrchestrator(provider, {
      maxAttempts: 2,
      initialDelayMs: 0,
    }).generateChatCompletion(
      buildOptions(original.transportToken),
      undefined,
      controller.signal,
    ),
  );
  const observedError =
    mode === 'cancel during preparation' && error instanceof Error
      ? error.name
      : error;
  expect(observedError).toBe(
    mode === 'cancel during preparation' ? 'AbortError' : failure,
  );
  expect(calls).toBe(2);
  expect(bodies).toBe(0);
  expect(attempts).toHaveLength(1);
  expect(envelopes).toHaveLength(2);
  for (const envelope of envelopes) {
    expect(envelope.attemptDisposals + envelope.unsentDisposals).toBe(1);
    expect(envelope.released).toBe(true);
  }
}
