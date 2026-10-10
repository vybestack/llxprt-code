/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdirSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import {
  getPerfPhaseObserver,
  setPerfPhaseObserver,
  type PerfProviderAttemptStartInfo,
  type PerfProviderAttemptEndInfo,
} from '@vybestack/llxprt-code-core/perf/perfPhaseObserver.js';
import { join } from 'node:path';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { FileLogExporter } from '@vybestack/llxprt-code-telemetry/telemetry/file-exporters.js';
import {
  flushTelemetry,
  initializeTelemetry,
  shutdownTelemetry,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import type {
  IContent,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  ProviderManager,
  RetryOrchestrator,
} from '@vybestack/llxprt-code-providers';
import { LoggingProviderWrapper } from '../../../../../providers/src/LoggingProviderWrapper.js';
import { LOGICAL_REQUEST_ID_KEY } from '@vybestack/llxprt-code-providers/logging/attemptLifecycle.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import { resetConversationFileWriterForTesting } from '@vybestack/llxprt-code-storage/testing';
import { assembleStrict } from './source-strict-logger-fixture.js';
import {
  buildTransportSourceOptions,
  barrier,
  preflightDisk,
  preflightInstructions,
} from './source-preflight-fixture.js';
import { enforceAndStreamSourcePromptEnvelopeRetries } from '../../prompt-envelope-source-send.js';

export type CorrelatedFault =
  | 'pre'
  | 'post'
  | 'late'
  | 'missing'
  | 'post-late'
  | 'post-missing'
  | 'none';
class CorrelatedFileExporter extends FileLogExporter {
  readonly accepted: Array<Record<string, unknown>> = [];
  readonly rejected: Array<Record<string, unknown>> = [];
  readonly order: string[] = [];
  private faulted = false;
  private delayed: (() => void) | undefined;
  witness: string | null = null;
  constructor(
    path: string,
    private readonly fault: CorrelatedFault,
    private readonly target: string,
    private readonly logicalIds: Map<string, string>,
  ) {
    super(path);
  }
  override export(
    records: ReadableLogRecord[],
    callback: (result: ExportResult) => void,
  ): void {
    const selected = records.some((record) => {
      const prompt = record.attributes.prompt_id;
      const name = record.attributes['event.name'];
      return (
        typeof prompt === 'string' &&
        (this.logicalIds.get(prompt) ?? prompt).startsWith(this.target) &&
        name ===
          (this.fault.startsWith('post')
            ? 'llxprt_code.api_response'
            : 'llxprt_code.api_request')
      );
    });
    const reject = selected && !this.faulted && this.fault !== 'none';
    if (reject) {
      this.faulted = true;
      rmSync(this.filePath, { force: true });
      mkdirSync(this.filePath);
    }
    super.export(records, (result) => {
      for (const record of records) {
        const {
          chunk_data: _chunk,
          request_text: _text,
          ...fields
        } = record.attributes;
        (result.code === ExportResultCode.SUCCESS
          ? this.accepted
          : this.rejected
        ).push(fields);
      }
      const complete = (): void => {
        this.order.push(
          `${String(records[0]?.attributes.prompt_id)}:${result.code}`,
        );
        callback(result);
      };
      if (reject && result.error instanceof Error && 'code' in result.error)
        this.witness = String(result.error.code);
      if (reject && this.fault.endsWith('missing')) this.delayed = complete;
      else if (reject && this.fault.endsWith('late')) setTimeout(complete, 25);
      else complete();
    });
    if (reject) rmSync(this.filePath, { recursive: true });
  }
  releaseLate(): void {
    this.delayed?.();
    this.delayed = undefined;
  }
}
type Input = Awaited<ReturnType<typeof assembleStrict>>;
type Disk = Awaited<ReturnType<typeof preflightDisk>>;
interface Result {
  output: string;
  usage: UsageStats[];
  finishes: unknown[];
  error: { name: string; message: string; code: unknown } | null;
}
function failed(
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
    return failed(error, output, usage, finishes);
  }
}
async function send(
  input: Input,
  disk: Disk,
  source: boolean,
  id: string,
  meet: () => Promise<void>,
): Promise<Result> {
  try {
    if (!source)
      return await consume(
        input.wrapper.generateChatCompletion({
          contents: {
            async *[Symbol.asyncIterator](): AsyncGenerator<IContent> {
              await meet();
              yield* disk.source.openReader();
            },
          },
          config: input.setup.config,
          runtime: input.setup.context,
          settings: input.setup.context.settingsService,
          invocation: input.setup.invocation,
          systemInstruction: preflightInstructions,
          resolved: { model: 'gpt-5.6' },
          metadata: { [LOGICAL_REQUEST_ID_KEY]: id },
        }),
      );
    const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
      provider: input.wrapper,
      source: disk.source,
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
        metadata: { [LOGICAL_REQUEST_ID_KEY]: id },
      }),
      enforce: async (rows, estimate) => {
        await estimate(rows);
        return rows;
      },
      onPrepared: meet,
      shouldRetryOnError: () => false,
    });
    return await consume(stream);
  } catch (error: unknown) {
    return failed(error);
  }
}
interface ProbeOptions {
  readonly conversations?: boolean;
  readonly apiBodies?: boolean;
  readonly prompts?: boolean;
}
async function prepareCorrelated(
  root: string,
  fault: CorrelatedFault,
  external: boolean,
  options: ProbeOptions,
) {
  const uploaded = barrier();
  let uploadCount = 0;
  const assembled = await assembleStrict(root, 'none', async () => {
    if (!fault.startsWith('post')) return;
    if (++uploadCount === 2) uploaded.release();
    await uploaded.wait;
  });
  await shutdownTelemetry(assembled.setup.config);
  assembled.setup.config.updateTelemetrySettings({
    logConversations: options.conversations ?? true,
    logApiBodies: options.apiBodies ?? true,
    logPrompts: options.prompts ?? true,
  });
  const path = join(root, 'correlated.jsonl');
  const logicalIds = new Map<string, string>();
  const starts: PerfProviderAttemptStartInfo[] = [];
  const ends: PerfProviderAttemptEndInfo[] = [];
  const previousObserver = getPerfPhaseObserver();
  setPerfPhaseObserver({
    onProviderAttemptStart(info): void {
      starts.push(info);
      logicalIds.set(info.attemptId, info.promptId);
    },
    onProviderAttemptEnd(info): void {
      ends.push(info);
    },
    onToolCallCompleted(): void {},
  });
  const exporter = new CorrelatedFileExporter(
    path,
    fault,
    'corr-first',
    logicalIds,
  );
  initializeTelemetry(assembled.setup.config, exporter);
  const input = {
    ...assembled,
    wrapper: external
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
  const secondRoot = join(root, 'second');
  mkdirSync(secondRoot);
  const second = await preflightDisk(secondRoot, false);
  return { input, exporter, manager, second, starts, ends, previousObserver };
}
export async function correlatedProbe(
  root: string,
  fault: CorrelatedFault,
  firstSource: boolean,
  secondSource: boolean,
  external = false,
  options: ProbeOptions = {},
) {
  const { input, exporter, manager, second, starts, ends, previousObserver } =
    await prepareCorrelated(root, fault, external, options);
  const prepared = barrier();
  let arrived = 0;
  const meet = async (): Promise<void> => {
    if (++arrived === 2) prepared.release();
    await prepared.wait;
  };
  try {
    const firstTask = send(
      input,
      input.fixture,
      firstSource,
      'corr-first',
      meet,
    );
    const secondTask = send(input, second, secondSource, 'corr-second', meet);
    const [first, other] = await Promise.all([firstTask, secondTask]);
    exporter.releaseLate();
    if (!firstSource) await input.fixture.source.close();
    if (!secondSource) await second.source.close();
    await flushTelemetry();
    const receipt = {
      first,
      other,
      starts,
      ends,
      fault: exporter.witness,
      accepted: exporter.accepted,
      rejected: exporter.rejected,
      order: exporter.order,
      bodies: input.http.bodies,
      sessionTokens: manager.getSessionTokenUsage(),
      performance: input.wrapper.getPerformanceMetrics(),
      closed: [input.fixture.state.closed, second.state.closed],
      activeReaders: input.fixture.state.active + second.state.active,
      activeBodies: activeRequestBodyCount(),
    };
    const evidence = process.env.ISSUE854_LOGGING_EVIDENCE;
    if (evidence !== undefined)
      await writeFile(
        join(
          evidence,
          `correlated-${fault}-${firstSource}-${secondSource}-${external}.json`,
        ),
        JSON.stringify(receipt, null, 2),
      );
    return receipt;
  } finally {
    setPerfPhaseObserver(previousObserver);
    exporter.releaseLate();
    await input.http.server.stop(true);
    await shutdownTelemetry(input.setup.config);
    await input.setup.config.dispose();
    resetConversationFileWriterForTesting();
  }
}
