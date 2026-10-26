/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetConversationFileWriterForTesting } from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import type { ConversationResponseEvent } from '@vybestack/llxprt-code-core/telemetry/types.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { StreamedResponseLog } from './streamed-response-log.js';
import { ConfigBasedRedactor } from './ConfigBasedRedactor.js';
import { logResponseStreamWithRecorderGen } from './streamProcessor.js';
import { AttemptRecorder } from './attemptRecorder.js';
import { ProviderPerformanceTracker } from './ProviderPerformanceTracker.js';

function diagnostics(
  path: string,
  events: ConversationResponseEvent[],
): ProviderRequestDiagnostics {
  return {
    conversationLoggingEnabled: true,
    conversationLogPath: path,
    requestBodyLoggingEnabled: true,
    redaction: {
      redactApiKeys: true,
      redactCredentials: true,
      redactFilePaths: true,
      redactUrls: true,
      redactEmails: true,
      redactPersonalInfo: true,
    },
    assertRequestArtifactExporter: () => undefined,
    acknowledgeTerminalTelemetry: (build) => {
      build();
      return Promise.resolve(() => undefined);
    },
    recordApiError: () => undefined,
    recordApiRequest: () => undefined,
    recordApiResponse: () => undefined,
    recordTokenUsage: () => undefined,
    recordConversationRequest: () => undefined,
    recordConversationResponse: (event) => {
      events.push(event);
    },
  };
}

describe('response logging stream integration', () => {
  const directories: string[] = [];
  afterEach(async () => {
    resetConversationFileWriterForTesting();
    for (const directory of directories.splice(0))
      await fs.rm(directory, { recursive: true, force: true });
  });

  async function harness(): Promise<{
    directory: string;
    config: ProviderRequestDiagnostics;
    log: StreamedResponseLog;
    events: ConversationResponseEvent[];
  }> {
    const directory = await fs.mkdtemp(
      join(tmpdir(), 'llxprt-streamed-response-'),
    );
    directories.push(directory);
    const events: ConversationResponseEvent[] = [];
    const config = diagnostics(directory, events);
    const log = new StreamedResponseLog(
      config,
      {
        providerName: 'test',
        conversationId: 'conversation',
        turnNumber: 1,
        defaultModelName: 'model',
        generatePromptId: () => 'prompt',
        redactor: new ConfigBasedRedactor(config.redaction),
        debug: new DebugLogger('test:response-log'),
      },
      {
        signal: undefined,
        strictPreSend: true,
        strictDurableResponse: true,
        strictTelemetry: true,
      },
    );
    return { directory, config, log, events };
  }

  it('writes legacy-equivalent redacted JSON string bytes and publishes only an artifact descriptor', async () => {
    const run = await harness();
    const text =
      'prefix 🙂 password="secret" mail alice@example.com sk-' +
      'A'.repeat(32) +
      '\n';
    for (let offset = 0; offset < text.length; offset++)
      await run.log.append(text[offset] ?? '');
    const publish = await run.log.finish('prompt', 20, true, undefined);
    expect(run.events).toHaveLength(0);
    if (publish === undefined)
      throw new Error('Missing deferred response telemetry');
    await publish();
    expect(run.events).toHaveLength(1);
    const event = run.events[0];
    expect(event.redacted_content).toBeUndefined();
    const artifact = event.response_artifact;
    if (artifact === undefined) throw new Error('Missing response artifact');
    const bytes = await fs.readFile(artifact.artifact_path);
    const content = bytes
      .subarray(
        artifact.content_offset,
        artifact.content_offset + artifact.content_bytes,
      )
      .toString('utf8');
    expect(content).toBe(
      JSON.stringify(
        new ConfigBasedRedactor(run.config.redaction).redactResponseContent(
          text,
          'test',
        ),
      ),
    );
    expect(content).not.toContain('secret');
  });

  it('streams the production generator without passing a completed response body to its terminal writer', async () => {
    const run = await harness();
    const recorder = new AttemptRecorder({
      providerName: 'test',
      defaultModelName: 'model',
      config: run.config,
      logicalRequestId: 'prompt',
      wrapperOwned: true,
    });
    recorder.ensureAttemptStarted();
    const chunk = 'ordinary reply. '.repeat(128);
    let sourceChunks = 0;
    let terminalBodyChars = 0;
    async function* source(): AsyncIterableIterator<IContent> {
      for (let index = 0; index < 256; index++) {
        sourceChunks++;
        yield { speaker: 'ai', blocks: [{ type: 'text', text: chunk }] };
      }
    }
    let visibleChars = 0;
    for await (const content of logResponseStreamWithRecorderGen(
      run.config,
      source(),
      'prompt',
      'model',
      recorder,
      {
        providerName: 'test',
        debug: new DebugLogger('test:response'),
        performanceTracker: new ProviderPerformanceTracker('test'),
      },
      (body, prompt, duration, success, error) => {
        terminalBodyChars += body.length;
        return run.log.finish(prompt, duration, success, error);
      },
      {
        signal: undefined,
        strictPreSend: true,
        strictDurableResponse: true,
        strictTelemetry: true,
      },
      run.log,
    )) {
      for (const block of content.blocks)
        if (block.type === 'text') visibleChars += block.text.length;
      expect(run.log.retainedChars).toBeLessThanOrEqual(run.log.retentionLimit);
    }
    expect(sourceChunks).toBe(256);
    expect(visibleChars).toBe(256 * chunk.length);
    expect(terminalBodyChars).toBe(0);
    expect(run.events).toHaveLength(1);
  });

  it('discards a partial response body on source failure and records an empty failed response', async () => {
    const run = await harness();
    await run.log.append('prefix. '.repeat(20000));
    const publish = await run.log.finish(
      'prompt',
      3,
      false,
      new Error('source failed'),
    );
    if (publish === undefined)
      throw new Error('Missing failed response publication');
    await publish();
    const artifact = run.events[0]?.response_artifact;
    if (artifact === undefined)
      throw new Error('Missing failed response artifact');
    const entry: unknown = JSON.parse(
      await fs.readFile(artifact.artifact_path, 'utf8'),
    );
    expect(entry).toMatchObject({
      response: '',
      metadata: { success: false, error: 'Error: source failed' },
    });
    expect(
      (await fs.readdir(run.directory)).filter((name) =>
        name.startsWith('response-'),
      ),
    ).toHaveLength(1);
  });

  it('removes the unfinished artifact on cancellation without publishing telemetry', async () => {
    const run = await harness();
    await run.log.append('prefix. '.repeat(20000));
    expect((await fs.readdir(run.directory)).length).toBeGreaterThan(0);
    await run.log.abort();
    expect(await fs.readdir(run.directory)).toHaveLength(0);
    expect(run.events).toHaveLength(0);
  });
});
