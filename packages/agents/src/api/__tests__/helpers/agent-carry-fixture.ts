/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  AgentClientContract,
  DeferredHistorySourceOptions,
} from '@vybestack/llxprt-code-core/core/clientContract.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  accountingRow,
  accountingFactory,
} from '@vybestack/llxprt-code-core/services/history/__tests__/support/token-accounting-stream-test-helpers.js';
import { AgentClient } from '../../../core/client.js';
import { isHistorySource } from '../../../core/deferredHistorySource.js';
import { createAgentRuntimeFactoryBindings } from '../../runtimeFactories.js';
import { buildAgent, type Agent } from './agentHarness.js';

export const carryBounds = { rows: 440, serializedBytes: 8 * 1024 * 1024 };

export function latch(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

export class CarryProbeClient extends AgentClient {
  readonly entered = latch();
  readonly proceed = latch();
  readonly counters = createRowCounters();
  readonly owners = new RowOwnership();
  readonly abort = new AbortController();
  fault: 'source' | 'abort' | undefined;
  pause = false;
  visited = 0;
  admissions = 0;

  constructor(...args: ConstructorParameters<typeof AgentClient>) {
    super(...args);
  }

  // The session owner binds its real tokenizer to every client it creates;
  // the probe substitutes the character-count tokenizer the fixture asserts on.
  override bindTokenization(
    ..._operations: Parameters<AgentClient['bindTokenization']>
  ): void {
    const tokenizer = accountingFactory((text) => text.length);
    super.bindTokenization(tokenizer.getTokenizer, tokenizer);
  }

  override getHistory(): AsyncGenerator<IContent, void, unknown> {
    throw new Error('Carried history array forbidden');
  }

  private async pauseFirstRow(): Promise<void> {
    if (++this.visited !== 1) return;
    this.entered.open();
    if (this.pause) await this.proceed.promise;
  }

  private async *observed(
    source: AsyncIterable<IContent>,
  ): AsyncGenerator<IContent, void, unknown> {
    for await (const row of source) {
      this.owners.retain(row);
      try {
        await this.pauseFirstRow();
        yield row;
        if (this.fault === 'source') throw new Error('Carried source fault');
        if (this.fault === 'abort')
          this.abort.abort(new Error('Carried source cancelled'));
      } finally {
        this.owners.release(row);
      }
    }
  }

  private observedOptions(
    options: DeferredHistorySourceOptions,
  ): DeferredHistorySourceOptions {
    return {
      ...options,
      ownership: this.owners,
      counters: { ...this.counters.counters, ownership: this.owners },
      signal: this.abort.signal,
    };
  }

  override async setHistoryFromSource(
    source: AsyncIterable<IContent>,
    options: DeferredHistorySourceOptions = {},
  ): Promise<void> {
    this.admissions++;
    await super.setHistoryFromSource(
      this.observed(source),
      this.observedOptions(options),
    );
  }

  // Client replacement carries the previous journal into the new client
  // through this deferred-source admission, which the chat then adopts as is.
  override async storeHistoryForLaterUse(
    history: readonly IContent[] | AsyncIterable<IContent>,
    options: DeferredHistorySourceOptions = {},
  ): Promise<void> {
    if (!isHistorySource(history)) {
      await super.storeHistoryForLaterUse(history, options);
      return;
    }
    this.admissions++;
    await super.storeHistoryForLaterUse(
      this.observed(history),
      this.observedOptions(options),
    );
  }
}

function createProbe(
  ...[config, runtime, readMcp, store, paths, instr]: Parameters<
    ReturnType<typeof createAgentRuntimeFactoryBindings>['agentClientFactory']
  >
): CarryProbeClient {
  if (store === undefined || paths === undefined)
    throw new Error('Carry probe requires the session media store and paths');
  return new CarryProbeClient(
    config,
    runtime,
    readMcp ?? (() => undefined),
    store,
    paths,
    undefined,
    undefined,
    instr,
  );
}

interface ReplacementAccessor {
  (): CarryProbeClient;
  readonly ready: Promise<void>;
}

export async function withAgentCarry<T>(
  size: number,
  action: (
    agent: Agent,
    replacement: ReplacementAccessor,
    previous: AgentClientContract,
    input: RowOwnership,
  ) => Promise<T>,
  bytes = 2048,
  configure: (client: CarryProbeClient) => void = () => {},
): Promise<T> {
  return withSuffixFixture(
    size,
    async (history, input) => {
      let replacement: CarryProbeClient | undefined;
      let armed = false;
      const ready = latch();
      const defaults = createAgentRuntimeFactoryBindings();
      const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
        runtimeFactoryBindings: {
          ...defaults,
          agentClientFactory: (
            config,
            runtime,
            readMcp,
            store,
            paths,
            instr,
          ) => {
            if (!armed)
              return defaults.agentClientFactory(
                config,
                runtime,
                readMcp,
                store,
                paths,
                instr,
              );
            replacement = createProbe(
              config,
              runtime,
              readMcp,
              store,
              paths,
              instr,
            );
            configure(replacement);
            ready.open();
            return replacement;
          },
        },
      });
      const previous = agent.agentClient;
      const priorHistory = previous.getHistoryService();
      previous.storeHistoryServiceForReuse(history);
      const access = Object.assign(
        () => {
          if (replacement === undefined)
            throw new Error('No replacement client');
          return replacement;
        },
        { ready: ready.promise },
      );
      armed = true;
      try {
        return await action(agent, access, previous, input);
      } finally {
        replacement?.proceed.open();
        try {
          await cleanup();
        } finally {
          if (priorHistory !== history) await priorHistory?.dispose();
        }
      }
    },
    bytes,
    accountingRow,
    new RowOwnership(),
  );
}

export async function historyDigest(
  source: AsyncIterable<IContent>,
): Promise<{ count: number; digest: string }> {
  const hash = createHash('sha256');
  let count = 0;
  for await (const row of source) {
    hash.update(JSON.stringify(row));
    count++;
  }
  return { count, digest: hash.digest('hex') };
}

export function expectedDigest(
  size: number,
  bytes = 2048,
): { count: number; digest: string } {
  const hash = createHash('sha256');
  for (let index = 0; index < size; index++)
    hash.update(JSON.stringify(accountingRow(index, bytes)));
  return { count: size, digest: hash.digest('hex') };
}

export function recordCarry(value: object): void {
  const output = process.env.AGENT_CARRY_OUTPUT;
  if (output !== undefined)
    appendFileSync(output, `${JSON.stringify(value)}\n`);
}
