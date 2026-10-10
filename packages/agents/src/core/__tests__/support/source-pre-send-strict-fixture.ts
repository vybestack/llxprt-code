/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdirSync } from 'node:fs';
import { appendFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  flushTelemetry,
  shutdownTelemetry,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import { resetConversationFileWriterForTesting } from '@vybestack/llxprt-code-storage/testing';
import { LOGICAL_REQUEST_ID_KEY } from '@vybestack/llxprt-code-providers/logging/attemptLifecycle.js';
import { assembleStrict } from './source-strict-logger-fixture.js';
import {
  preflightDisk,
  barrier,
  preflightInstructions,
} from './source-preflight-fixture.js';
import {
  buildSourceProviderChatOptions,
  enforceAndStreamSourcePromptEnvelopeRetries,
} from '../../prompt-envelope-source-send.js';

type Input = Awaited<ReturnType<typeof assembleStrict>>;
type Disk = Awaited<ReturnType<typeof preflightDisk>>;
interface Result {
  readonly output: string;
  readonly error: { name: string; message: string; code: unknown } | null;
}
function failedResult(error: unknown, output = ''): Result {
  return {
    output,
    error: {
      name: error instanceof Error ? error.name : 'unknown',
      message: String(error),
      code: error instanceof Error && 'code' in error ? error.code : null,
    },
  };
}
async function consume(stream: AsyncIterable<IContent>): Promise<Result> {
  let output = '';
  try {
    for await (const row of stream)
      output += row.blocks
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
    return { output, error: null };
  } catch (error: unknown) {
    return failedResult(error, output);
  }
}
async function witness(path: string | undefined): Promise<string | null> {
  if (path === undefined) return null;
  try {
    await appendFile(path, 'witness');
    throw new Error('Expected filesystem fault');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'EISDIR')
      return error.code;
    throw error;
  }
}
function eagerStream(
  input: Input,
  disk: Disk,
  entered: ReturnType<typeof barrier>,
  prepared: ReturnType<typeof barrier>,
): AsyncIterableIterator<IContent> {
  return input.wrapper.generateChatCompletion({
    contents: {
      async *[Symbol.asyncIterator](): AsyncGenerator<IContent> {
        entered.release();
        await prepared.wait;
        yield* disk.source.openReader();
      },
    },
    config: input.setup.config,
    runtime: input.setup.context,
    settings: input.setup.context.settingsService,
    invocation: input.setup.invocation,
    systemInstruction: preflightInstructions,
    resolved: { model: 'gpt-5.6' },
    metadata: { [LOGICAL_REQUEST_ID_KEY]: 'mixed-eager' },
  });
}
async function sourceStream(
  input: Input,
  entered: ReturnType<typeof barrier>,
  prepared: ReturnType<typeof barrier>,
  abortBeforeSend: boolean,
): Promise<Result> {
  try {
    const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
      provider: input.wrapper,
      source: input.fixture.source,
      signal: input.controller.signal,
      buildOptions: (rows) => ({
        ...buildSourceProviderChatOptions(
          rows,
          undefined,
          input.setup.context,
          input.setup.invocation,
          undefined,
          preflightInstructions,
        ),
        resolved: { model: 'gpt-5.6' },
        metadata: { [LOGICAL_REQUEST_ID_KEY]: 'mixed-source' },
      }),
      enforce: async (rows, estimate) => {
        await estimate(rows);
        return rows;
      },
      onPrepared: async (): Promise<void> => {
        prepared.release();
        await entered.wait;
        if (abortBeforeSend)
          input.controller.abort(
            new DOMException('source cancelled before send', 'AbortError'),
          );
      },
      shouldRetryOnError: () => false,
    });
    return await consume(stream);
  } catch (error: unknown) {
    return failedResult(error);
  }
}
export async function mixedPreSendProbe(
  root: string,
  fault:
    | 'conversation-request'
    | 'api-request'
    | 'api-durable-request'
    | 'abort'
    | 'none',
  eagerFirst: boolean,
) {
  let setupFault: 'conversation-request' | 'api-request' | 'none' = 'none';
  if (fault === 'conversation-request' || fault === 'api-durable-request')
    setupFault = 'conversation-request';
  if (fault === 'api-request') setupFault = 'api-request';
  const input = await assembleStrict(root, setupFault);
  if (fault === 'api-durable-request')
    input.setup.config.updateTelemetrySettings({ logConversations: false });
  const eagerRoot = join(root, 'eager-disk');
  mkdirSync(eagerRoot);
  const disk = await preflightDisk(eagerRoot, false);
  const entered = barrier();
  const prepared = barrier();
  try {
    if (input.faultPath !== undefined) mkdirSync(input.faultPath);
    const eager = (): Promise<Result> =>
      consume(eagerStream(input, disk, entered, prepared));
    const source = (): Promise<Result> =>
      sourceStream(input, entered, prepared, fault === 'abort');
    const tasks = eagerFirst ? [eager(), source()] : [source(), eager()];
    let results: Result[];
    try {
      results = await Promise.all(tasks);
    } finally {
      await disk.source.close();
    }
    await flushTelemetry();
    const receipt = {
      source: results[eagerFirst ? 1 : 0],
      eager: results[eagerFirst ? 0 : 1],
      bodies: input.http.bodies,
      events: input.exporter.events,
      rejected: input.exporter.rejected,
      writeFault: await witness(input.faultPath),
      artifacts: (await readdir(root)).filter((path) =>
        /^request-.*\.jsonl$/.test(path),
      ),
      sourceClosed: input.fixture.state.closed,
      eagerClosed: disk.state.closed,
      activeReaders: input.fixture.state.active + disk.state.active,
      activeBodies: activeRequestBodyCount(),
    };
    return receipt;
  } finally {
    await input.http.server.stop(true);
    await shutdownTelemetry(input.setup.config);
    await input.setup.config.dispose();
    resetConversationFileWriterForTesting();
  }
}
