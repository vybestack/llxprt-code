/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { retainedShapeEntries } from './token-usage-source-fixture.js';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { createTelemetryAdapter } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { captureProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  hookSessionRuntime,
  readHookDefinitions,
} from '@vybestack/llxprt-code-core/hooks/hook-configuration.js';
import { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  initializeTelemetry,
  flushTelemetry,
  shutdownTelemetry,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { LoggingProviderWrapper } from '../../../../../providers/src/LoggingProviderWrapper.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { resetConversationFileWriterForTesting } from '@vybestack/llxprt-code-storage/testing';
import {
  processorFixture,
  sourcePending,
  sourceWireOracle,
} from './streamprocessor-source-fixture.js';
import { registerModelHook } from './streamprocessor-model-hook-fixture.js';
import { StreamProcessor } from '../../StreamProcessor.js';
import type { SendMessageParams } from '../../chatSession.js';
import { sourceHeap } from './streamprocessor-source-measurements.js';
import { ConversationManager } from '../../ConversationManager.js';
import { TokenUsageLogger } from '../../TokenUsageLogger.js';
import {
  loggingChatSession,
  readLoggingChatStream,
  readLoggingProcessorStream,
} from './chat-session-logging-fixture.js';

const modeSchema = z.enum([
  'enabled',
  'conversation',
  'shape',
  'disabled',
  'retry',
  'hook',
  'error',
  'abort',
]);
type Mode = z.infer<typeof modeSchema>;
type Setup = Awaited<ReturnType<typeof processorFixture>>;
type Trace = Array<{
  category: string;
  promptId?: string;
  chars?: number;
  sha256?: string;
  error?: string;
}>;
async function digestBody(
  request: Request,
): Promise<{ bytes: number; sha256: string }> {
  if (request.body === null) throw new Error('Missing real HTTP body');
  const reader = request.body.getReader();
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.length;
      hash.update(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return { bytes, sha256: hash.digest('hex') };
}
function httpEndpoint(mode: Mode, controller: AbortController) {
  const bodies: Array<{ bytes: number; sha256: string }> = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      bodies.push(await digestBody(request));
      if (mode === 'abort')
        controller.abort(new Error('required logging HTTP abort'));
      if (mode === 'error')
        return new Response('required HTTP error', { status: 400 });
      if (mode === 'retry' && bodies.length === 1)
        return new Response('retry', { status: 503 });
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"finished"}\n\ndata: {"type":"response.completed","response":{"id":"resp_logging","status":"completed","output":[],"usage":{"input_tokens":123,"output_tokens":1,"total_tokens":124}}}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  return { server, bodies };
}
function records(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .flatMap((line) => {
      const parsed: unknown = JSON.parse(line);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('attributes' in parsed)
      )
        return [];
      const value = parsed.attributes;
      return typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
        ? [Object.fromEntries(Object.entries(value))]
        : [];
    });
}
async function oracle(setup: Setup, mode: Mode, large: boolean) {
  const projection = await setup.provider.projectPromptEnvelope({
    contents: {
      async *[Symbol.asyncIterator]() {
        if (mode === 'hook')
          yield {
            speaker: 'human' as const,
            blocks: [{ type: 'text' as const, text: 'new context' }],
          };
        else {
          for (let index = 0; index < 64; index++)
            yield diskTextRow(index, large);
          yield sourcePending;
        }
      },
    },
    invocation: setup.runtime.prepareProviderInvocation(setup.provider.name),
    resolved: { model: 'gpt-5.6' },
    systemInstruction: setup.generation.systemInstruction,
  });
  try {
    return await estimatePromptEnvelope(
      setup.provider.name,
      projection,
      setup.nativeFactory,
    );
  } finally {
    await projection.releaseIfUnsent?.();
  }
}
function observeLegacy(setup: Setup, telemetry: RootTelemetry): Trace {
  const adapter = createTelemetryAdapter(setup.config, telemetry);
  const trace: Trace = [];
  Object.assign(setup.runtime.telemetry, {
    logApiRequest(
      event: Parameters<typeof adapter.logApiRequest>[0],
    ): void | Promise<void> {
      trace.push({
        category: 'agent.api_request',
        promptId: event.promptId,
        chars: event.requestText?.length,
        sha256:
          event.requestText === undefined
            ? undefined
            : createHash('sha256').update(event.requestText).digest('hex'),
      });
      return adapter.logApiRequest(event);
    },
    logApiResponse: adapter.logApiResponse,
    logApiError(event: Parameters<typeof adapter.logApiError>[0]): void {
      trace.push({
        category: 'agent.api_error',
        promptId: event.promptId,
        error: event.error,
      });
      adapter.logApiError(event);
    },
  });
  return trace;
}
async function assemble(root: string, mode: Mode, large: boolean) {
  const controller = new AbortController();
  const http = httpEndpoint(mode, controller);
  const bodies = !['disabled', 'conversation', 'shape'].includes(mode);
  // Conversation export requires both logConversations and logPrompts; only
  // 'conversation' mode keeps API-body logging off to stay distinct from 'enabled'.
  const prompts = bodies || mode === 'conversation';
  const setup = await processorFixture(
    root,
    `http://127.0.0.1:${http.server.port}/v1`,
    large,
    64,
    {
      enabled: true,
      logPrompts: prompts,
      logApiBodies: bodies,
      logApiBodyMaxChars: 32 * 1024 * 1024,
      logConversations: !['disabled', 'shape'].includes(mode),
      conversationLogPath: root,
      outfile: join(root, 'telemetry.jsonl'),
    },
  );
  const settingsOwner = new SessionSettingsOwner(setup.settings);
  const telemetry = settingsOwner.bindTelemetry(setup.config);
  const trace = observeLegacy(setup, telemetry);
  const wrapper = new LoggingProviderWrapper(
    setup.provider,
    undefined,
    undefined,
    () => captureProviderRequestDiagnostics(setup.config, settingsOwner),
  );
  const processor = new StreamProcessor(
    setup.runtime,
    new ConversationManager(setup.history, setup.runtime),
    setup.compression,
    () => wrapper,
    (_source, metadata) => ({ ...setup.runtime.providerRuntime, metadata }),
    setup.history,
    setup.generation,
  );
  if (mode === 'shape')
    setup.compression.tokenUsageLogger = new TokenUsageLogger(
      true,
      join(root, 'tokens.jsonl'),
    );
  let hooks: SessionHookOwner | undefined;
  if (mode === 'hook') {
    registerModelHook(setup.config, root, 'none');
    hooks = new SessionHookOwner(
      readHookDefinitions(setup.config),
      hookSessionRuntime(
        setup.config,
        new WorkspaceTrustLifecycle({
          localTrust: setup.config.initialWorkspaceTrust,
        }),
        telemetry,
      ),
      true,
      new MessageBus(),
    );
  }
  setup.settings.set('token-usage-log', mode === 'shape');
  const chat =
    process.env.ISSUE854_LOGGING_ENTRY === 'chat'
      ? loggingChatSession(setup.runtime, wrapper, setup.generation)
      : undefined;
  await initializeTelemetry(telemetry);
  return {
    setup,
    http,
    processor,
    chat,
    trace,
    controller,
    telemetry,
    settingsOwner,
    hooks,
  };
}
function collectFacts(
  root: string,
  input: Awaited<ReturnType<typeof assemble>>,
  mode: Mode,
  source: boolean,
  large: boolean,
  output: string,
  failure: string | undefined,
  expectedEstimate: unknown,
): Record<string, unknown> {
  const { setup, http, processor, trace } = input;
  const events = records(join(root, 'telemetry.jsonl'));
  const requestText = events.find(
    (event) => typeof event.request_text === 'string',
  )?.request_text;
  const hookFile = join(root, 'model-hooks.jsonl');
  const debugRoot = join(root, 'logs/debug');
  const debugRecords = existsSync(debugRoot)
    ? readdirSync(debugRoot).flatMap((name) =>
        readFileSync(join(debugRoot, name), 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      )
    : [];
  return {
    mode,
    source,
    large,
    output,
    error: failure,
    trace,
    bodies: http.bodies,
    expectedBody: mode === 'hook' ? undefined : sourceWireOracle(large),
    entry: input.chat === undefined ? 'stream' : 'chat',
    estimate:
      input.chat === undefined
        ? processor.getPromptEnvelopeEstimate()
        : input.chat.getPromptEnvelopeEstimate(),
    oracle: expectedEstimate,
    owners: setup.history.owners,
    activeBodies: activeRequestBodyCount(),
    liveOriginalRows: setup.history.inputReferences.filter(
      (ref) => ref.deref() !== undefined,
    ).length,
    liveReadRows: setup.history.references.filter(
      (ref) => ref.deref() !== undefined,
    ).length,
    tokens: setup.provider.tokens.length,
    events: events.filter(
      (event) =>
        typeof event['event.name'] === 'string' &&
        !String(event['event.name']).endsWith('_chunk'),
    ),
    debugRecords,
    chunkRecords: events.filter((event) =>
      String(event['event.name']).endsWith('_chunk'),
    ).length,
    requestTextSha256:
      typeof requestText === 'string'
        ? createHash('sha256').update(requestText).digest('hex')
        : undefined,
    requestRows:
      typeof requestText === 'string' ? JSON.parse(requestText) : undefined,
    hooks: existsSync(hookFile)
      ? readFileSync(hookFile, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [],
    directory: readdirSync(root),
    shapeMeasurements: retainedShapeEntries(
      (input.chat?.getTokenUsageLogger() ?? setup.compression.tokenUsageLogger)
        ?.getShapeMemory()
        .snapshot() ?? {},
    ),
  };
}
async function run(
  root: string,
  mode: Mode,
  source: boolean,
  large: boolean,
): Promise<void> {
  const input = await assemble(root, mode, large);
  const {
    setup,
    http,
    processor,
    controller,
    telemetry,
    settingsOwner,
    hooks,
  } = input;
  let output = '';
  let failure: string | undefined;
  try {
    const expectedEstimate = await oracle(setup, mode, large);
    try {
      const params: SendMessageParams = {
        message: sourcePending,
        config: {
          abortSignal: controller.signal,
        },
        ...(hooks === undefined
          ? {}
          : {
              hookOwner: hooks.execution({
                sessionId: () => setup.config.getSessionId(),
                transcriptPath: () => undefined,
              }),
            }),
      };
      if (input.chat !== undefined) {
        output = await readLoggingChatStream(
          input.chat,
          params,
          'real-logging',
        );
      } else {
        output = await readLoggingProcessorStream(processor, params);
      }
    } catch (error) {
      failure = String(error);
    }
    await flushTelemetry(telemetry);
    await DebugLogger.resetForTesting();
    await sourceHeap();
    writeFileSync(
      join(root, 'result.json'),
      JSON.stringify(
        collectFacts(
          root,
          input,
          mode,
          source,
          large,
          output,
          failure,
          expectedEstimate,
        ),
        null,
        2,
      ),
    );
  } finally {
    resetConversationFileWriterForTesting();
    await setup.history.dispose();
    await http.server.stop(true);
    await shutdownTelemetry(telemetry);
    await hooks?.dispose();
    await settingsOwner.dispose();
    await setup.config.dispose();
  }
}
const root = z.string().min(1).parse(process.argv[2]);
mkdirSync(root, { recursive: true });
await run(
  root,
  modeSchema.parse(process.argv[3]),
  process.argv[4] === 'source',
  process.argv[5] === 'large',
);
