/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * `api_error` marks a failed provider API call. A request that is stopped
 * before it is prepared for the provider (a BeforeModel hook block, an abort,
 * a context overflow) made no API call and is not logged as one.
 */
import { describe, expect, it } from 'bun:test';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import { StreamProcessor } from './StreamProcessor.js';
import { ConversationManager } from './ConversationManager.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  processorFixture,
  sourcePending,
} from './__tests__/support/streamprocessor-source-fixture.js';

const root = sourceRootSetup();

type Fixture = Awaited<ReturnType<typeof processorFixture>>;
type ApiErrorEvent = Parameters<
  Fixture['runtime']['telemetry']['logApiError']
>[0];

function endpoint() {
  let requests = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(): Response {
      requests++;
      return new Response('{"error":{"message":"rejected"}}', {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return { server, requests: () => requests };
}

function hookOwner(
  beforeModelSnapshot: HookExecutionOwner['beforeModelSnapshot'],
): HookExecutionOwner {
  return {
    sessionId: () => 'api-error-classification',
    transcriptPath: () => undefined,
    beforeModelSnapshot,
  };
}

interface SendOptions {
  /** Builds the hook owner; the controller is the request's abort controller. */
  readonly hook?: (controller: AbortController) => HookExecutionOwner;
  readonly contextLimit?: number;
}

async function send(options: SendOptions): Promise<{
  readonly failure: unknown;
  readonly apiErrors: ApiErrorEvent[];
  readonly httpRequests: number;
}> {
  const http = endpoint();
  const setup = await processorFixture(
    root(),
    `http://127.0.0.1:${http.server.port}/v1`,
    false,
    8,
  );
  if (options.contextLimit !== undefined)
    setup.settings.set('context-limit', options.contextLimit);
  const apiErrors: ApiErrorEvent[] = [];
  const runtime = {
    ...setup.runtime,
    telemetry: {
      ...setup.runtime.telemetry,
      logApiError(event: ApiErrorEvent): void {
        apiErrors.push(event);
      },
    },
  };
  const processor = new StreamProcessor(
    runtime,
    new ConversationManager(setup.history, runtime),
    setup.compression,
    () => setup.provider,
    (_source, metadata) => ({ ...runtime.providerRuntime, metadata }),
    setup.history,
    setup.generation,
  );
  const controller = new AbortController();
  const owner = options.hook?.(controller);
  let failure: unknown;
  try {
    const stream = await processor.makeApiCallAndProcessStream(
      {
        message: 'Answer',
        config: { abortSignal: controller.signal },
        ...(owner === undefined ? {} : { hookOwner: owner }),
      },
      'api-error-classification',
      sourcePending,
    );
    for await (const _chunk of stream) {
      /* Drain the response. */
    }
  } catch (error) {
    failure = error;
  } finally {
    await setup.history.dispose();
    await http.server.stop(true);
    await setup.config.dispose();
  }
  return { failure, apiErrors, httpRequests: http.requests() };
}

describe('api_error classification', () => {
  it('does not log a BeforeModel hook block as an API error', async () => {
    const result = await send({
      hook: () =>
        hookOwner(() =>
          Promise.reject(new Error('BeforeModel hook blocked the request')),
        ),
    });

    expect(String(result.failure)).toContain('BeforeModel hook blocked');
    expect(result.httpRequests).toBe(0);
    expect(result.apiErrors).toStrictEqual([]);
  }, 60000);

  it('does not log an abort during request preparation as an API error', async () => {
    const result = await send({
      hook: (controller) =>
        hookOwner(() => {
          controller.abort(new Error('stopped while preparing'));
          return Promise.reject(controller.signal.reason);
        }),
    });

    expect(String(result.failure)).toContain('stopped while preparing');
    expect(result.httpRequests).toBe(0);
    expect(result.apiErrors).toStrictEqual([]);
  }, 60000);

  it('does not log a context overflow found before the request is sent as an API error', async () => {
    const result = await send({ contextLimit: 100 });

    expect(String(result.failure)).toContain('ContextOverflowError');
    expect(result.httpRequests).toBe(0);
    expect(result.apiErrors).toStrictEqual([]);
  }, 60000);

  it('logs a provider rejection of the sent request as an API error', async () => {
    const result = await send({});

    expect(result.failure).toBeDefined();
    expect(result.httpRequests).toBeGreaterThan(0);
    expect(result.apiErrors).toHaveLength(1);
    expect(result.apiErrors[0].promptId).toBe('api-error-classification');
  }, 60000);
});
