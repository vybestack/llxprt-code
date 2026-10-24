/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { streamCallOptions } from './streamCallOptions.js';

import { createHash } from 'node:crypto';
import { getTransportAttemptBudget } from '../transportAttemptBudget.js';
import { ATTEMPT_LIFECYCLE_KEY } from '../logging/attemptLifecycle.js';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openNativeRowFixture } from '@vybestack/llxprt-code-core/services/history/__tests__/support/native-row-fixture.js';
import type {
  ProviderRequestSelection,
  ProviderRequestSource,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { captureProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  useRuntimeTestOwners,
  type RuntimeTestOwners,
} from '../runtime/__tests__/runtime-owner-test-helpers.js';
import { ProviderManager } from '../ProviderManager.js';
import { LoggingProviderWrapper } from '../LoggingProviderWrapper.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import { ConfigBasedRedactor } from '../logging/ConfigBasedRedactor.js';
import { isAsyncIterableContents } from '../utils/collectContents.js';
import type {
  GenerateChatOptions,
  IProvider,
  ProviderToolset,
} from '../IProvider.js';
import type { ConversationDataRedactor } from '../logging/ConfigBasedRedactor.js';
import { readFile } from 'node:fs/promises';
import { resetConversationFileWriterForTesting } from '@vybestack/llxprt-code-storage/testing';
import { getConversationFileWriter } from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';
async function textRows(contents: AsyncIterable<IContent>): Promise<string[]> {
  const values: string[] = [];
  for await (const row of contents) {
    for (const block of row.blocks) {
      if (block.type === 'text') values.push(block.text);
    }
  }
  return values;
}

describe('relocated stream options', () => {
  it('preserves a cold producer and closes it on early return', async () => {
    let opened = false;
    let closed = false;
    const contents: AsyncIterable<IContent> = {
      async *[Symbol.asyncIterator]() {
        opened = true;
        try {
          yield { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] };
          throw new Error('The consumer must not pull a second row');
        } finally {
          closed = true;
        }
      },
    };
    const options = streamCallOptions({ providerName: 'openai', contents });
    expect(opened).toBe(false);
    const observed: string[] = [];
    for await (const row of options.contents) {
      for (const block of row.blocks) {
        if (block.type === 'text') observed.push(block.text.toUpperCase());
      }
      break;
    }
    expect(observed).toStrictEqual(['FIRST']);
    expect(closed).toBe(true);
  });

  it('reopens authored arrays and retains flat tool selections', async () => {
    const options = streamCallOptions({
      providerName: 'openai',
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'one' }] },
        { speaker: 'ai', blocks: [{ type: 'text', text: 'two' }] },
      ],
      tools: [{ name: 'inspect', parametersJsonSchema: { type: 'object' } }],
    });
    const first = await textRows(options.contents);
    const reopened = await textRows(options.contents);
    expect({ first, reopened }).toStrictEqual({
      first: ['one', 'two'],
      reopened: ['one', 'two'],
    });
    expect(options.tools?.map((tool) => tool.name)).toStrictEqual(['inspect']);
    expect(
      streamCallOptions({ providerName: 'openai', tools: [] }).tools,
    ).toStrictEqual([]);
    expect(streamCallOptions({ providerName: 'openai' }).tools).toBeUndefined();
  });
});

function createIngressConfig(logging: boolean, directory: string): Config {
  return new Config({
    sessionId: 'wrapper-ingress',
    targetDir: directory,
    cwd: directory,
    debugMode: false,
    model: 'ingress-model',
    telemetry: {
      enabled: false,
      logConversations: logging,
      conversationLogPath: directory,
    },
  });
}

function ingressRow(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `BODY-${index} password=secret-${index}` }],
    metadata: { id: `row-${index}`, turnId: `turn-${Math.floor(index / 2)}` },
  };
}

function ingressDigest(): string {
  const hash = createHash('sha256');
  for (let index = 0; index < 64; index++)
    hash.update(JSON.stringify(ingressRow(index)));
  return hash.digest('hex');
}

const redactionConfig = {
  redactCredentials: true,
  redactApiKeys: false,
  redactFilePaths: false,
  redactUrls: false,
  redactEmails: false,
  redactPersonalInfo: false,
};

class StreamingRedactionWitness implements ConversationDataRedactor {
  private readonly redactor = new ConfigBasedRedactor(redactionConfig);
  pending = 0;
  peak = 0;
  redactMessage(row: IContent, provider: string): IContent {
    const redacted = this.redactor.redactMessage(row, provider);
    this.pending++;
    this.peak = Math.max(this.peak, this.pending);
    let encoded = false;
    const release = (): void => {
      this.pending--;
    };
    return {
      ...redacted,
      get blocks() {
        if (!encoded) {
          encoded = true;
          release();
        }
        return redacted.blocks;
      },
    };
  }
  redactToolCall(
    tool: Parameters<ConversationDataRedactor['redactToolCall']>[0],
  ): ReturnType<ConversationDataRedactor['redactToolCall']> {
    return tool;
  }
  redactResponseContent(content: string, provider: string): string {
    return this.redactor.redactResponseContent(content, provider);
  }
}

async function withIngressFixture<T>(
  fixtureOwners: RuntimeTestOwners,
  logging: boolean,
  action: (
    root: string,
    config: Config,
    settings: SettingsService,
    snapshot: ProviderRequestSelection,
    settingsOwner: SessionSettingsOwner,
  ) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'wrapper-ingress-fixture-'));
  const settings = new SettingsService();
  settings.set('retries', 2);
  settings.set('retrywait', 1);
  const config = createIngressConfig(logging, root);
  const { settingsOwner } = fixtureOwners.adopt(config, settings);
  const snapshot = await openNativeRowFixture(
    root,
    Array.from({ length: 64 }, (_, index) => ingressRow(index)),
    64,
  );
  try {
    return await action(root, config, settings, snapshot, settingsOwner);
  } finally {
    await snapshot.close();
    resetConversationFileWriterForTesting();
    rmSync(root, { recursive: true, force: true });
  }
}

interface IngressObservation {
  reads: number;
  normalizedAtReads: number;
  normalizedCount: number | undefined;
  firstRow: string;
  readonly entries: GenerateChatOptions[];
  readonly readsAtEntry: number[];
  readonly passReads: number[];
}
function createIngressProvider(observation: IngressObservation): IProvider {
  return {
    name: 'openai',
    getModels: async () => [],
    getDefaultModel: () => 'ingress-model',
    async *generateChatCompletion(
      input: GenerateChatOptions | AsyncIterable<IContent>,
    ): AsyncIterableIterator<IContent> {
      if (isAsyncIterableContents(input))
        throw new Error('Expected normalized options');
      observation.readsAtEntry.push(observation.reads);
      observation.entries.push(input);
      const reader = input.contents[Symbol.asyncIterator]();
      try {
        const first = await reader.next();
        if (first.done === true) throw new Error('Missing first BODY row');
        if (observation.entries.length === 1) {
          observation.firstRow = JSON.stringify(first.value);
          first.value.blocks.splice(0);
          throw Object.assign(new Error('503 first BODY row failed'), {
            status: 503,
          });
        }
        const hash = createHash('sha256');
        hash.update(JSON.stringify(first.value));
        const second = await reader.next();
        if (second.done === true) throw new Error('Missing second BODY row');
        hash.update(JSON.stringify(second.value));
        for (;;) {
          const next = await reader.next();
          if (next.done === true) break;
          hash.update(JSON.stringify(next.value));
        }
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: hash.digest('hex') }],
        };
      } finally {
        await reader.return?.();
      }
    },
  };
}
async function verifyIngressLog(
  root: string,
  redactor: StreamingRedactionWitness,
): Promise<void> {
  const file = join(
    root,
    `conversation-${new Date().toISOString().split('T')[0]}.jsonl`,
  );
  const lines = (await readFile(file, 'utf8')).trim().split('\n');
  const logged: unknown = JSON.parse(lines[0]);
  if (typeof logged !== 'object' || logged === null || !('messages' in logged))
    throw new Error('Missing complete request log');
  const expected = new ConfigBasedRedactor(redactionConfig);
  const oracle = Array.from({ length: 64 }, (_, index) =>
    expected.redactMessage(ingressRow(index), 'openai'),
  );
  expect(logged.messages).toStrictEqual(oracle);
  expect(lines[0]).not.toContain('secret-');
  expect(redactor.peak).toBeLessThanOrEqual(1);
}

function observeIngressRows(
  snapshot: ProviderRequestSelection,
  observation: IngressObservation,
): ProviderRequestSelection {
  return {
    native: snapshot.native,
    count: snapshot.count,
    readAt: (index, signal) => snapshot.readAt(index, signal),
    close: () => snapshot.close(),
    async *openReader(
      signal?: AbortSignal,
    ): AsyncGenerator<IContent, void, unknown> {
      const pass = observation.passReads.length;
      observation.passReads.push(0);
      for await (const row of snapshot.openReader(signal)) {
        observation.reads++;
        observation.passReads[pass]++;
        yield row;
      }
    },
  };
}

function verifyIngressIdentities(
  entries: GenerateChatOptions[],
  tools: ProviderToolset,
): void {
  expect(entries).toHaveLength(2);
  expect(entries[0].tools).toBe(tools);
  expect(entries[1].tools).toBe(tools);
  expect(entries[0]).not.toHaveProperty('config');
  expect(entries[0]).not.toHaveProperty('runtime');
  const first = entries[0].invocation;
  const second = entries[1].invocation;
  if (first === undefined || second === undefined)
    throw new Error('Both attempts must carry the admitted invocation');
  // The retry orchestrator binds each attempt's linked abort signal into a
  // shallow copy of the admitted invocation (withRequestSignal), so identity
  // is per attempt. Everything admitted stays the same values: the copies are
  // equal apart from the signal, and the admitted snapshots are shared.
  expect(second).not.toBe(first);
  expect(second.signal).not.toBe(first.signal);
  expect({ ...second, signal: undefined }).toStrictEqual({
    ...first,
    signal: undefined,
  });
  expect(second.ephemerals).toBe(first.ephemerals);
  expect(entries[1].metadata?.logicalRequestId).toBe('ingress-logical');
  expect(entries[1]).not.toHaveProperty('config');
  expect(entries[0].metadata?.[ATTEMPT_LIFECYCLE_KEY]).toBeDefined();
  expect(entries[1].metadata?.[ATTEMPT_LIFECYCLE_KEY]).toBe(
    entries[0].metadata?.[ATTEMPT_LIFECYCLE_KEY],
  );
  const budget = getTransportAttemptBudget(entries[0]);
  expect(budget).toBeDefined();
  expect(getTransportAttemptBudget(entries[1])).toBe(budget);
  expect(budget?.limit).toBe(2);
  expect(budget?.used).toBe(2);
}

async function exerciseWrapperIngress(
  fixtureOwners: RuntimeTestOwners,
  logging: boolean,
  snapshotBacked = true,
): Promise<string> {
  return withIngressFixture(
    fixtureOwners,
    logging,
    async (root, config, settings, snapshot, settingsOwner) => {
      const observation: IngressObservation = {
        reads: 0,
        normalizedAtReads: -1,
        normalizedCount: undefined,
        firstRow: '',
        entries: [],
        readsAtEntry: [],
        passReads: [],
      };
      const { passReads, entries, readsAtEntry } = observation;
      const rows = observeIngressRows(snapshot, observation);
      const base = createIngressProvider(observation);
      const redactor = new StreamingRedactionWitness();
      const manager = new ProviderManager({
        sessionSettings: settingsOwner,
        config,
        settingsService: settings,
      });
      manager.registerProvider(base);
      const installed = manager.getProviderByName(base.name);
      if (
        !(installed instanceof LoggingProviderWrapper) ||
        !(installed.wrappedProvider instanceof RetryOrchestrator)
      )
        throw new Error('ProviderManager did not install the real stack');
      const wrapper = new LoggingProviderWrapper(
        installed.wrappedProvider,
        redactor,
        undefined,
        () => captureProviderRequestDiagnostics(config, settingsOwner),
      );
      wrapper.setRuntimeContextResolver(() => ({
        config,
        settingsService: settings,
        runtimeId: 'ingress-runtime',
      }));
      wrapper.setOptionsNormalizer((options, providerName) => {
        observation.normalizedAtReads = observation.reads;
        observation.normalizedCount = options.contentCount;
        return manager.normalizeRuntimeInputs(options, providerName);
      });
      const tools: ProviderToolset = [
        { name: 'inspect', parametersJsonSchema: { type: 'object' } },
      ];
      const captured: IContent[] = [];
      const input = rows.openReader();
      async function readCaptured(index: number): Promise<IContent> {
        while (captured.length <= index) {
          const next = await input.next();
          if (next.done === true) throw new Error('Premature ingress EOF');
          captured.push(structuredClone(next.value));
        }
        return structuredClone(captured[index]);
      }
      const admittedSource: ProviderRequestSource = {
        [Symbol.asyncIterator]: () => rows.openReader(),
        async openProviderRequest(): Promise<ProviderRequestSelection> {
          return {
            callerOwned: true,
            count: rows.count,
            readAt: readCaptured,
            async *openReader(signal) {
              for (let index = 0; index < rows.count; index++) {
                signal?.throwIfAborted();
                yield await readCaptured(index);
              }
            },
            close: async () => {
              await input.return();
            },
          };
        },
      };
      const contents: AsyncIterable<IContent> = snapshotBacked
        ? { [Symbol.asyncIterator]: () => rows.openReader() }
        : admittedSource;
      const options = {
        contents,
        requestRows: snapshotBacked ? rows : undefined,
        contentCount: rows.count,
        tools,
        resolved: { authToken: 'ingress-auth' },
        metadata: { logicalRequestId: 'ingress-logical' },
      };
      const output = await textRows(wrapper.generateChatCompletion(options));
      expect(output).toStrictEqual([ingressDigest()]);
      expect(observation.firstRow).toBe(JSON.stringify(ingressRow(0)));
      verifyIngressIdentities(entries, tools);
      expect(observation.normalizedAtReads).toBe(0);
      expect(observation.normalizedCount).toBe(64);
      expect(entries[0].contentCount).toBe(64);
      expect(readsAtEntry).toStrictEqual(logging ? [64, 65] : [0, 1]);
      const diskPasses = logging ? [64, 1, 64] : [1, 64];
      expect(passReads).toStrictEqual(snapshotBacked ? diskPasses : [64]);
      if (logging) await verifyIngressLog(root, redactor);
      return output[0];
    },
  );
}

describe('real provider wrapper disk ingress', () => {
  const fixtureOwners = useRuntimeTestOwners();
  it('reopens cold disk rows after one BODY read without disabled logging predrain', async () => {
    expect(await exerciseWrapperIngress(fixtureOwners, false)).toBe(
      ingressDigest(),
    );
  });
  it('replays a caller-owned one-shot source after the first BODY read fails', async () => {
    expect(await exerciseWrapperIngress(fixtureOwners, false, false)).toBe(
      ingressDigest(),
    );
  });
  it('logs every redacted disk row without buffering the request before retry', async () => {
    expect(await exerciseWrapperIngress(fixtureOwners, true)).toBe(
      ingressDigest(),
    );
  });
  it('disposes a one-shot request owner on cancellation', async () => {
    await withIngressFixture(
      fixtureOwners,
      false,
      async (_root, config, settings, _snapshot, settingsOwner) => {
        const controller = new AbortController();
        let sourceClosed = false;
        let reads = 0;
        let escaped: AsyncIterable<IContent> | undefined;
        const source = (async function* (): AsyncGenerator<IContent> {
          try {
            for (let index = 0; index < 64; index++) {
              reads++;
              yield ingressRow(index);
            }
          } finally {
            sourceClosed = true;
          }
        })();
        const base: IProvider = {
          name: 'openai',
          getModels: async () => [],
          getDefaultModel: () => 'ingress-model',
          async *generateChatCompletion(
            input: GenerateChatOptions | AsyncIterable<IContent>,
          ): AsyncIterableIterator<IContent> {
            if (isAsyncIterableContents(input))
              throw new Error('Expected options');
            escaped = input.contents;
            for await (const row of input.contents) {
              yield row;
              await new Promise<void>((resolve) =>
                controller.signal.addEventListener('abort', () => resolve(), {
                  once: true,
                }),
              );
            }
          },
        };
        const wrapper = new LoggingProviderWrapper(
          new RetryOrchestrator(base),
          undefined,
          undefined,
          () => captureProviderRequestDiagnostics(config, settingsOwner),
        );
        const iterator = wrapper.generateChatCompletion({
          contents: source,
          requestRows: {
            callerOwned: true,
            count: 64,
            openReader: () => source,
            readAt: (index) => ingressRow(index),
            close: async () => {
              await source.return(undefined);
            },
          },
          invocation: captureProviderInvocation(
            {
              config,
              settingsService: settings,
              runtimeId: 'cancel-runtime',
            },
            base.name,
          ),
          metadata: { abortSignal: controller.signal },
        });
        const before = readdirSync(process.env.TMPDIR ?? '/tmp').filter(
          (name) => name.startsWith('provider-normalization-'),
        );
        await iterator.next();
        controller.abort(new Error('cancel owner'));
        await iterator.return?.();
        expect(sourceClosed).toBe(true);
        expect(reads).toBe(1);
        if (escaped === undefined) throw new Error('No request escaped');
        await expect(escaped[Symbol.asyncIterator]().next()).rejects.toThrow(
          /cancel owner|closed/,
        );
        expect(
          readdirSync(process.env.TMPDIR ?? '/tmp').filter((name) =>
            name.startsWith('provider-normalization-'),
          ),
        ).toStrictEqual(before);
      },
    );
  });
});

describe('streamed conversation disk artifact', () => {
  const fixtureOwners = useRuntimeTestOwners();
  it('writes the complete redacted request to disk one row at a time', async () => {
    await withIngressFixture(
      fixtureOwners,
      true,
      async (root, _config, _settings, snapshot) => {
        const witness = new StreamingRedactionWitness();
        async function* redactedRows(): AsyncGenerator<IContent> {
          for await (const row of snapshot.openReader())
            yield witness.redactMessage(row, 'openai');
        }
        await getConversationFileWriter(root).writeRequestStream(
          'openai',
          redactedRows(),
          { promptId: 'disk-oracle' },
        );
        const file = join(
          root,
          `conversation-${new Date().toISOString().split('T')[0]}.jsonl`,
        );
        const text = await readFile(file, 'utf8');
        const entry: unknown = JSON.parse(text);
        if (
          typeof entry !== 'object' ||
          entry === null ||
          !('messages' in entry)
        )
          throw new Error('Missing disk messages');
        const redactor = new ConfigBasedRedactor(redactionConfig);
        expect(entry.messages).toStrictEqual(
          Array.from({ length: 64 }, (_, index) =>
            redactor.redactMessage(ingressRow(index), 'openai'),
          ),
        );
        expect(text).not.toContain('secret-');
        expect(witness.peak).toBe(1);
        expect(witness.pending).toBe(0);
      },
    );
  });
});

describe('positional request cancellation', () => {
  it('invalidates an admitted reader immediately on the positional abort signal', async () => {
    const controller = new AbortController();
    let escaped: AsyncIterable<IContent> | undefined;
    let closed = false;
    const source = (async function* (): AsyncGenerator<IContent> {
      try {
        yield ingressRow(0);
        yield ingressRow(1);
      } finally {
        closed = true;
      }
    })();
    const base: IProvider = {
      name: 'openai',
      getModels: async () => [],
      getDefaultModel: () => 'ingress-model',
      async *generateChatCompletion(
        input: GenerateChatOptions | AsyncIterable<IContent>,
      ): AsyncIterableIterator<IContent> {
        if (isAsyncIterableContents(input)) throw new Error('Expected options');
        escaped = input.contents;
        for await (const row of input.contents) yield row;
      },
    };
    const admittedSource: ProviderRequestSource = {
      [Symbol.asyncIterator]: () => source,
      async openProviderRequest() {
        return {
          callerOwned: true,
          count: 2,
          openReader: () => source,
          readAt: (index) => ingressRow(index),
          close: async () => {
            await source.return(undefined);
          },
        };
      },
    };
    const result = new RetryOrchestrator(base).generateChatCompletion(
      admittedSource,
      undefined,
      controller.signal,
    );
    try {
      await result.next();
      controller.abort(new Error('positional cancel'));
      if (escaped === undefined) throw new Error('No staged reader');
      await expect(escaped[Symbol.asyncIterator]().next()).rejects.toThrow(
        'positional cancel',
      );
    } finally {
      await result.return?.();
    }
    expect(closed).toBe(true);
  });
});
