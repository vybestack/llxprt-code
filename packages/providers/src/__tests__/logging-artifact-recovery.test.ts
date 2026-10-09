/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  initializeTelemetry,
  flushTelemetry,
  shutdownTelemetry,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { resetConversationFileWriterForTesting } from '@vybestack/llxprt-code-storage/testing';
import { LoggingProviderWrapper } from '../LoggingProviderWrapper.js';
import { ConfigBasedRedactor } from '../logging/ConfigBasedRedactor.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { isAsyncIterableContents } from '../utils/collectContents.js';

class RecoveryConfig extends Config {
  constructor(
    readonly root: string,
    readonly conversation: boolean,
    readonly bodies: boolean,
    readonly prompts = true,
    readonly telemetry = true,
  ) {
    super({
      sessionId: 'recovery-session',
      targetDir: root,
      cwd: root,
      debugMode: false,
      model: 'recovery-model',
    });
  }
  override getConversationLoggingEnabled(): boolean {
    return this.conversation;
  }
  override getConversationLogPath(): string {
    return this.root;
  }
  override getTelemetryEnabled(): boolean {
    return this.telemetry;
  }
  override getTelemetryOutfile(): string {
    return join(this.root, 'telemetry.jsonl');
  }
  override getTelemetryLogApiBodiesEnabled(): boolean {
    return this.bodies;
  }
  override getTelemetryLogPromptsEnabled(): boolean {
    return this.prompts;
  }
  override getTelemetryLogApiBodyMaxChars(): number {
    return 7;
  }
}

const redaction = {
  redactApiKeys: false,
  redactCredentials: true,
  redactFilePaths: false,
  redactUrls: false,
  redactEmails: true,
  redactPersonalInfo: false,
};
function row(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [
      {
        type: 'text',
        text:
          `row:${index} 🌊 password=secret-${index} contact=<alice@example.com> ` +
          'payload '.repeat(512),
      },
    ],
    metadata: { id: `id-${index}`, turnId: `turn-${Math.floor(index / 2)}` },
  };
}
function expectedRows(): IContent[] {
  return Array.from({ length: 24 }, (_, index) => ({
    ...row(index),
    blocks: [
      {
        type: 'text',
        text:
          `row:${index} 🌊 password=[REDACTED] contact=<[REDACTED-EMAIL]> ` +
          'payload '.repeat(512),
      },
    ],
  }));
}
function rawDigest(): string {
  const hash = createHash('sha256');
  for (let index = 0; index < 24; index++)
    hash.update(JSON.stringify(row(index)));
  return hash.digest('hex');
}
function provider(): IProvider {
  return {
    name: 'recovery',
    getModels: async () => [],
    getDefaultModel: () => 'recovery-model',
    async *generateChatCompletion(
      input: GenerateChatOptions | AsyncIterable<IContent>,
    ): AsyncIterableIterator<IContent> {
      if (isAsyncIterableContents(input)) throw new Error('Expected options');
      const hash = createHash('sha256');
      for await (const content of input.contents)
        hash.update(JSON.stringify(content));
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: hash.digest('hex') }],
      };
    },
  };
}
async function invoke(
  config: RecoveryConfig,
  redactor = new ConfigBasedRedactor(redaction),
  signal?: AbortSignal,
): Promise<IContent[]> {
  const settings = new SettingsService();
  const contents = (async function* (): AsyncGenerator<IContent> {
    for (let index = 0; index < 24; index++) yield row(index);
  })();
  const wrapper = new LoggingProviderWrapper(provider(), redactor);
  const output: IContent[] = [];
  for await (const chunk of wrapper.generateChatCompletion({
    contents,
    config,
    settings,
    runtime: { config, settingsService: settings, runtimeId: 'recovery' },
    metadata: { __logicalRequestId: 'recovery-logical', abortSignal: signal },
  }))
    output.push(chunk);
  return output;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function recordAttributes(line: string): Record<string, unknown> | undefined {
  const value: unknown = JSON.parse(line);
  return isRecord(value) && isRecord(value.attributes)
    ? value.attributes
    : undefined;
}
async function records(root: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(join(root, 'telemetry.jsonl'), 'utf8');
  return text
    .trim()
    .split('\n')
    .map(recordAttributes)
    .filter((value): value is Record<string, unknown> => value !== undefined);
}
function recover(events: Array<Record<string, unknown>>, name: string): Buffer {
  const chunks = events.filter(
    (event) => event['event.name'] === name + '_chunk',
  );
  expect(chunks.length).toBeGreaterThan(1);
  const completion = events.find(
    (event) => event['event.name'] === name + '_complete',
  );
  if (completion === undefined) throw new Error('Missing completion');
  expect(completion.chunk_count).toBe(chunks.length);
  let offset = 0;
  const bytes = chunks.map((event, index) => {
    expect(event.schema_version).toBe(2);
    expect(event.prompt_id).toBe('recovery-logical');
    expect(event.artifact_id).toBe(completion.artifact_id);
    expect(event.chunk_index).toBe(index);
    expect(event.chunk_byte_offset).toBe(offset);
    if (typeof event.chunk_data !== 'string')
      throw new Error('Missing chunk bytes');
    const decoded = Buffer.from(event.chunk_data, 'base64');
    offset += decoded.length;
    return decoded;
  });
  const body = Buffer.concat(bytes);
  expect(completion.content_bytes).toBe(body.length);
  expect(completion.content_sha256).toBe(
    createHash('sha256').update(body).digest('hex'),
  );
  expect(completion.row_count).toBe(24);
  return body;
}

const directories: string[] = [];
let activeConfig: RecoveryConfig | undefined;
async function fixture(
  conversation: boolean,
  bodies: boolean,
  prompts = true,
  telemetry = true,
): Promise<RecoveryConfig> {
  const root = await mkdtemp(join(process.cwd(), 'tmp/logging-recovery-'));
  directories.push(root);
  const config = new RecoveryConfig(
    root,
    conversation,
    bodies,
    prompts,
    telemetry,
  );
  activeConfig = config;
  initializeTelemetry(config);
  return config;
}

async function verifyRecovery(
  config: RecoveryConfig,
  conversation: boolean,
): Promise<Buffer> {
  const output = await invoke(config);
  expect(output[0].blocks).toStrictEqual([{ type: 'text', text: rawDigest() }]);
  await flushTelemetry();
  const events = await records(config.root);
  const api = recover(events, 'llxprt_code.api_request');
  expect(JSON.parse(api.toString('utf8'))).toStrictEqual(expectedRows());
  if (conversation)
    expect(recover(events, 'conversation_request')).toStrictEqual(api);
  const artifacts = (await readdir(config.root)).filter((name) =>
    name.startsWith('request-'),
  );
  expect(artifacts).toHaveLength(conversation ? 2 : 1);
  for (const name of artifacts) {
    const artifact = JSON.parse(
      await readFile(join(config.root, name), 'utf8'),
    );
    expect(artifact.messages).toStrictEqual(expectedRows());
    expect(artifact.context.promptId).toBe('recovery-logical');
    const artifactId = name.slice('request-'.length, -'.jsonl'.length);
    const descriptor = events.find((event) => event.artifact_id === artifactId);
    if (descriptor === undefined)
      throw new Error('Artifact has no telemetry correlation');
    const messageBytes = Buffer.from(JSON.stringify(artifact.messages));
    expect(descriptor.content_sha256).toBe(
      createHash('sha256').update(messageBytes).digest('hex'),
    );
    expect(descriptor.content_bytes).toBe(messageBytes.length);
    expect(descriptor.prompt_id).toBe(artifact.context.promptId);
  }
  const diskName = `conversation-${new Date().toISOString().split('T')[0]}.jsonl`;
  const disk = await readFile(join(config.root, diskName), 'utf8');
  expect(JSON.parse(disk.split('\n')[0]).messages).toStrictEqual(
    expectedRows(),
  );
  expect(disk).not.toContain('secret-');
  expect(JSON.stringify(events)).not.toContain('secret-');
  expect(JSON.stringify(events)).not.toContain('alice@example.com');
  return api;
}

describe('complete bounded request logging', () => {
  afterEach(async () => {
    if (activeConfig !== undefined) await shutdownTelemetry(activeConfig);
    resetConversationFileWriterForTesting();
    for (const directory of directories.splice(0))
      await rm(directory, { recursive: true, force: true });
  });
  it('recovers all redacted rows from real file-exported conversation and opted-in API chunks while BODY remains raw', async () => {
    expect(
      JSON.parse(
        (await verifyRecovery(await fixture(true, true), true)).toString(
          'utf8',
        ),
      ),
    ).toStrictEqual(expectedRows());
  });
  it('recovers opted-in API rows with conversation logging disabled', async () => {
    expect(
      JSON.parse(
        (await verifyRecovery(await fixture(false, true), false)).toString(
          'utf8',
        ),
      ),
    ).toStrictEqual(expectedRows());
  });
  it('does not emit request bodies or durable artifacts when prompt privacy disables API opt-in', async () => {
    const config = await fixture(false, true, false);
    const output = await invoke(config);
    expect(output[0].blocks).toStrictEqual([
      { type: 'text', text: rawDigest() },
    ]);
    await flushTelemetry();
    const events = await records(config.root);
    expect(
      events.filter((event) => String(event['event.name']).includes('_chunk')),
    ).toHaveLength(0);
    expect(
      (await readdir(config.root)).filter(
        (name) =>
          name.startsWith('request-') || name.startsWith('conversation-'),
      ),
    ).toHaveLength(0);
  });
  it('does not stage API bodies when the telemetry SDK is disabled', async () => {
    const config = await fixture(false, true, true, false);
    const output = await invoke(config);
    expect(output[0].blocks).toStrictEqual([
      { type: 'text', text: rawDigest() },
    ]);
    expect(await readdir(config.root)).toStrictEqual([]);
  });
  it('cancels mid-redaction without publishing an incomplete artifact as a complete request', async () => {
    const config = await fixture(true, false);
    const controller = new AbortController();
    let redacted = 0;
    class CancellingRedactor extends ConfigBasedRedactor {
      override redactMessage(content: IContent, name: string): IContent {
        const result = super.redactMessage(content, name);
        if (++redacted === 3)
          controller.abort(new Error('cancel redacted request'));
        return result;
      }
    }
    await expect(
      invoke(config, new CancellingRedactor(redaction), controller.signal),
    ).rejects.toThrow('cancel redacted request');
    await flushTelemetry();
    expect(redacted).toBe(3);
    expect(
      (await readdir(config.root)).filter(
        (name) =>
          name.startsWith('request-') ||
          name.startsWith('.request-') ||
          name.startsWith('conversation-'),
      ),
    ).toHaveLength(0);
  });
});
