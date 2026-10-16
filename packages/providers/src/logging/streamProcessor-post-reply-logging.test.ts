/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { AttemptRecorder } from './attemptRecorder.js';
import { ProviderPerformanceTracker } from './ProviderPerformanceTracker.js';
import type { RequestLoggingPolicy } from './requestLoggingPolicy.js';
import {
  logResponseStreamWithRecorderGen,
  processStreamWithRecorderGen,
  type StreamProcessContext,
} from './streamProcessor.js';

class RecordingDebugLogger extends DebugLogger {
  readonly errors: string[] = [];
  override error(messageOrFn: string | (() => string)): void {
    this.errors.push(
      typeof messageOrFn === 'function' ? messageOrFn() : messageOrFn,
    );
  }
}

interface Harness {
  readonly config: ProviderRequestDiagnostics;
  readonly recorder: AttemptRecorder;
  readonly ctx: StreamProcessContext;
  readonly debug: RecordingDebugLogger;
  readonly sessionTokens: Array<{ input: number; output: number }>;
}

function harness(
  policy: RequestLoggingPolicy,
  acknowledgeFailure: Error | undefined,
): Harness {
  const sessionTokens: Array<{ input: number; output: number }> = [];
  const debug = new RecordingDebugLogger('llxprt:test:post-reply-logging');
  const config: ProviderRequestDiagnostics = {
    conversationLoggingEnabled: true,
    conversationLogPath: '',
    requestBodyLoggingEnabled: true,
    redaction: {
      redactApiKeys: false,
      redactCredentials: false,
      redactFilePaths: false,
      redactUrls: false,
      redactEmails: false,
      redactPersonalInfo: false,
    },
    assertRequestArtifactExporter: () => undefined,
    acknowledgeTerminalTelemetry: () =>
      acknowledgeFailure === undefined
        ? Promise.resolve(() => undefined)
        : Promise.reject(acknowledgeFailure),
    recordApiError: () => undefined,
    recordApiRequest: () => undefined,
    recordApiResponse: () => undefined,
    recordTokenUsage: () => undefined,
    recordConversationRequest: () => undefined,
    recordConversationResponse: () => undefined,
    accumulateSessionTokens: (_provider, usage) => {
      sessionTokens.push({ input: usage.input, output: usage.output });
    },
  };
  const recorder = new AttemptRecorder({
    providerName: 'test-provider',
    defaultModelName: 'test-model',
    config,
    logicalRequestId: 'post-reply',
    wrapperOwned: true,
    loggingPolicy: policy,
  });
  recorder.ensureAttemptStarted();
  return {
    config,
    recorder,
    debug,
    sessionTokens,
    ctx: {
      providerName: 'test-provider',
      debug,
      performanceTracker: new ProviderPerformanceTracker('test-provider'),
    },
  };
}

function reply(): AsyncIterableIterator<IContent> {
  const chunks: IContent[] = [
    { speaker: 'ai', blocks: [{ type: 'text', text: 'the reply' }] },
    {
      speaker: 'ai',
      blocks: [],
      metadata: {
        usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
        finishReason: 'stop',
      },
    },
  ];
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

async function collect(
  stream: AsyncIterableIterator<IContent>,
): Promise<IContent[]> {
  const chunks: IContent[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function strictPolicy(signal?: AbortSignal): RequestLoggingPolicy {
  return {
    strictPreSend: true,
    strictDurableResponse: true,
    strictTelemetry: true,
    signal,
  };
}

function expectCompletedTurn(chunks: IContent[], run: Harness): void {
  expect(
    chunks.flatMap((chunk) =>
      chunk.blocks.flatMap((block) =>
        block.type === 'text' ? block.text : [],
      ),
    ),
  ).toStrictEqual(['the reply']);
  expect(chunks[chunks.length - 1]?.metadata?.usage).toMatchObject({
    totalTokens: 12,
  });
  expect(run.sessionTokens).toStrictEqual([{ input: 10, output: 2 }]);
}

describe('logging failures after the reply has streamed', () => {
  it('completes the turn when the durable response write fails', async () => {
    const run = harness(strictPolicy(), undefined);
    const chunks = await collect(
      logResponseStreamWithRecorderGen(
        run.config,
        reply(),
        'post-reply',
        'test-model',
        run.recorder,
        run.ctx,
        () => Promise.reject(new Error('ENOSPC: no space left on device')),
        strictPolicy(),
      ),
    );
    expectCompletedTurn(chunks, run);
    expect(run.debug.errors.join('\n')).toContain('ENOSPC');
  });

  it('completes the turn when the telemetry acknowledgement fails', async () => {
    const run = harness(
      strictPolicy(),
      new Error('Telemetry record export acknowledgement missing'),
    );
    const chunks = await collect(
      logResponseStreamWithRecorderGen(
        run.config,
        reply(),
        'post-reply',
        'test-model',
        run.recorder,
        run.ctx,
        () => Promise.resolve(undefined),
        strictPolicy(),
      ),
    );
    expectCompletedTurn(chunks, run);
    expect(run.debug.errors.join('\n')).toContain('acknowledgement missing');
  });

  it('completes an API-only source turn when the telemetry acknowledgement fails', async () => {
    const run = harness(
      strictPolicy(),
      new Error('Telemetry record export acknowledgement missing'),
    );
    const chunks = await collect(
      processStreamWithRecorderGen(
        run.config,
        reply(),
        'test-model',
        'post-reply',
        run.recorder,
        run.ctx,
        strictPolicy(),
      ),
    );
    expect(chunks[chunks.length - 1]?.metadata?.usage).toMatchObject({
      totalTokens: 12,
    });
    expect(run.debug.errors.join('\n')).toContain('acknowledgement missing');
  });

  it('still fails the turn when the caller aborted it', async () => {
    const controller = new AbortController();
    const policy = strictPolicy(controller.signal);
    const run = harness(policy, undefined);
    const stream = logResponseStreamWithRecorderGen(
      run.config,
      reply(),
      'post-reply',
      'test-model',
      run.recorder,
      run.ctx,
      () => {
        controller.abort(new Error('user abort'));
        return Promise.reject(new Error('write failed'));
      },
      policy,
    );
    await expect(collect(stream)).rejects.toThrow('user abort');
  });
});
