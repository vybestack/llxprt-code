/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdirSync } from 'node:fs';
import { appendFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  IContent,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  ProviderManager,
  RetryOrchestrator,
} from '@vybestack/llxprt-code-providers';
import { LoggingProviderWrapper } from '../../../../../providers/src/LoggingProviderWrapper.js';
import {
  getPerfPhaseObserver,
  setPerfPhaseObserver,
  type PerfProviderAttemptStartInfo,
  type PerfProviderAttemptEndInfo,
} from '@vybestack/llxprt-code-core/perf/perfPhaseObserver.js';
import { LOGICAL_REQUEST_ID_KEY } from '@vybestack/llxprt-code-providers/logging/attemptLifecycle.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import {
  flushTelemetry,
  shutdownTelemetry,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { resetConversationFileWriterForTesting } from '@vybestack/llxprt-code-storage/testing';
import { assembleStrict } from './source-strict-logger-fixture.js';
import {
  buildTransportSourceOptions,
  preflightDisk,
  preflightInstructions,
  barrier,
} from './source-preflight-fixture.js';
import { enforceAndStreamSourcePromptEnvelopeRetries } from '../../prompt-envelope-source-send.js';

function observeAttempts() {
  const previous = getPerfPhaseObserver();
  const starts: PerfProviderAttemptStartInfo[] = [];
  const ends: PerfProviderAttemptEndInfo[] = [];
  setPerfPhaseObserver({
    onProviderAttemptStart(info): void {
      starts.push({ ...info });
    },
    onProviderAttemptEnd(info): void {
      ends.push({ ...info });
    },
    onToolCallCompleted(): void {},
  });
  return { starts, ends, close: (): void => setPerfPhaseObserver(previous) };
}
type Input = Awaited<ReturnType<typeof assembleStrict>>;
interface Result {
  readonly output: string;
  readonly usage: readonly UsageStats[];
  readonly finishes: readonly unknown[];
  readonly error: {
    name: string;
    message: string;
    code: unknown;
    path: unknown;
    syscall: unknown;
    stack: string | undefined;
  } | null;
}
function failure(
  error: unknown,
  output = '',
  usage: UsageStats[] = [],
  finishes: unknown[] = [],
): Result {
  return {
    output,
    usage,
    finishes,
    error: {
      name: error instanceof Error ? error.name : 'unknown',
      message: String(error),
      code: error instanceof Error && 'code' in error ? error.code : null,
      path: error instanceof Error && 'path' in error ? error.path : null,
      syscall:
        error instanceof Error && 'syscall' in error ? error.syscall : null,
      stack: error instanceof Error ? error.stack : undefined,
    },
  };
}
async function consume(stream: AsyncIterable<IContent>): Promise<Result> {
  let output = '';
  const usage: UsageStats[] = [];
  const finishes: unknown[] = [];
  try {
    for await (const row of stream) {
      output += row.blocks
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('');
      if (row.metadata?.usage !== undefined) usage.push(row.metadata.usage);
      if (row.metadata?.finishReason !== undefined)
        finishes.push(row.metadata.finishReason);
    }
    return { output, usage, finishes, error: null };
  } catch (error: unknown) {
    return failure(error, output, usage, finishes);
  }
}
async function sendSource(input: Input): Promise<Result> {
  try {
    const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
      provider: input.wrapper,
      source: input.fixture.source,
      signal: input.controller.signal,
      buildOptions: (rows) => ({
        ...buildTransportSourceOptions(
          rows,
          undefined,
          input.setup.context,
          input.setup.invocation,
          undefined,
          preflightInstructions,
        ),
        resolved: { model: 'gpt-5.6' },
        metadata: { [LOGICAL_REQUEST_ID_KEY]: 'post-source' },
      }),
      enforce: async (rows, estimate) => {
        await estimate(rows);
        return rows;
      },
      shouldRetryOnError: () => false,
    });
    return await consume(stream);
  } catch (error: unknown) {
    return failure(error);
  }
}
function sendEager(
  input: Input,
  disk: Awaited<ReturnType<typeof preflightDisk>>,
): Promise<Result> {
  return consume(
    input.wrapper.generateChatCompletion({
      contents: { [Symbol.asyncIterator]: () => disk.source.openReader() },
      config: input.setup.config,
      runtime: input.setup.context,
      settings: input.setup.context.settingsService,
      invocation: input.setup.invocation,
      systemInstruction: preflightInstructions,
      resolved: { model: 'gpt-5.6' },
      metadata: { [LOGICAL_REQUEST_ID_KEY]: 'post-eager' },
    }),
  );
}
async function witness(path: string | undefined): Promise<string | null> {
  if (path === undefined) return null;
  try {
    await appendFile(path, 'witness');
    throw new Error('Expected EISDIR');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'EISDIR')
      return error.code;
    throw error;
  }
}
type PostFault = 'none' | 'conversation-response' | 'api-response';
async function prepareMixed(
  root: string,
  fault: PostFault,
  eagerFirst: boolean,
  externalLifecycle: boolean,
) {
  const uploaded = barrier();
  const observations = { uploads: 0, priorRequestLog: '' };
  const conversationPath = join(
    root,
    `conversation-${new Date().toISOString().split('T')[0]}.jsonl`,
  );
  const assembled = await assembleStrict(root, fault, async () => {
    observations.uploads++;
    if (observations.uploads === 2) {
      observations.priorRequestLog = await readFile(conversationPath, 'utf8');
      const evidence = process.env.ISSUE854_LOGGING_EVIDENCE;
      if (evidence !== undefined)
        await writeFile(
          join(
            evidence,
            `prior-${fault}-${eagerFirst}-${externalLifecycle}.jsonl`,
          ),
          observations.priorRequestLog,
        );
      uploaded.release();
    }
    await uploaded.wait;
  });
  const input = {
    ...assembled,
    wrapper: externalLifecycle
      ? new LoggingProviderWrapper(
          new RetryOrchestrator(assembled.setup.provider, {
            maxAttempts: 2,
            initialDelayMs: 0,
            maxDelayMs: 0,
          }),
        )
      : assembled.wrapper,
  };
  const manager = new ProviderManager(input.setup.context);
  manager.registerProvider(input.setup.provider);
  input.setup.config.setProviderManager(manager);
  const eagerRoot = join(root, 'eager-disk');
  mkdirSync(eagerRoot);
  const disk = await preflightDisk(eagerRoot, false);
  return { input, disk, manager, observations, conversationPath };
}
export async function mixedPostSendProbe(
  root: string,
  fault: PostFault,
  eagerFirst: boolean,
  externalLifecycle = false,
) {
  const { input, disk, manager, observations, conversationPath } =
    await prepareMixed(root, fault, eagerFirst, externalLifecycle);
  const attempts = observeAttempts();
  try {
    const tasks = eagerFirst
      ? [sendEager(input, disk), sendSource(input)]
      : [sendSource(input), sendEager(input, disk)];
    const results = await Promise.all(tasks);
    await disk.source.close();
    await flushTelemetry();
    const receipt = {
      source: results[eagerFirst ? 1 : 0],
      eager: results[eagerFirst ? 0 : 1],
      bodies: input.http.bodies,
      uploads: observations.uploads,
      priorRequests: observations.priorRequestLog
        .trim()
        .split('\n')
        .map((line): unknown => JSON.parse(line)),
      conversationLog:
        fault === 'conversation-response'
          ? null
          : await readFile(conversationPath, 'utf8'),
      artifacts: (await readdir(root)).filter((path) =>
        /^request-.*\.jsonl$/.test(path),
      ),
      attemptStarts: attempts.starts,
      attemptEnds: attempts.ends,
      events: input.exporter.events,
      rejected: input.exporter.rejected,
      writeFault: await witness(input.faultPath),
      faultPath: input.faultPath,
      performance: input.wrapper.getPerformanceMetrics(),
      sessionTokens: manager.getSessionTokenUsage(),
      sourceClosed: input.fixture.state.closed,
      eagerClosed: disk.state.closed,
      activeReaders: input.fixture.state.active + disk.state.active,
      activeBodies: activeRequestBodyCount(),
    };
    const evidence = process.env.ISSUE854_LOGGING_EVIDENCE;
    if (evidence !== undefined)
      await writeFile(
        join(evidence, `post-${fault}-${eagerFirst}-${externalLifecycle}.json`),
        JSON.stringify(receipt, null, 2),
      );
    return receipt;
  } finally {
    attempts.close();
    await input.http.server.stop(true);
    await shutdownTelemetry(input.setup.config);
    await input.setup.config.dispose();
    resetConversationFileWriterForTesting();
  }
}
