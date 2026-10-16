/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { AggregateDisposeError } from '../api/disposeErrors.js';
import {
  replaceClientHistorySource,
  replaceDeferredClientSource,
} from './clientHistoryReplacement.js';
import { RetainedHistoryAdmissions } from './retainedHistoryAdmissions.js';

async function* rows(): AsyncGenerator<IContent> {
  yield { speaker: 'human', blocks: [{ type: 'text', text: 'replacement' }] };
}

describe('history source replacement cleanup', () => {
  let directory = '';
  let store: LocalMediaStore;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'history-replacement-cleanup-'));
    store = new LocalMediaStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes: 1024,
    });
  });
  afterEach(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });

  async function replacementWithFailingDispose(): Promise<{
    existing: HistoryService;
    admissions: RetainedHistoryAdmissions;
    priorReleased: () => boolean;
    replacement: Parameters<typeof replaceDeferredClientSource>[2];
  }> {
    const existing = new HistoryService();
    existing.dispose = (): Promise<void> =>
      Promise.reject(new Error('prior dispose failed'));
    const admissions = new RetainedHistoryAdmissions(store);
    const prior = admissions.prepareDeferredArray([], {}).retained;
    let priorReleased = false;
    return {
      existing,
      admissions,
      priorReleased: () => priorReleased,
      replacement: {
        deps: { mediaStore: store },
        runtime: createAgentRuntimeState({
          runtimeId: 'runtime-replacement',
          provider: 'gemini',
          model: 'gemini-2.0-pro',
        }),
        existing,
        admissions,
        prior,
        priorRelease: (): Promise<void> => {
          priorReleased = true;
          return Promise.resolve();
        },
        publish: (): void => undefined,
      },
    };
  }

  it('releases the prior admission and release when disposing the prior deferred history fails', async () => {
    const { admissions, priorReleased, replacement } =
      await replacementWithFailingDispose();

    const failure = await replaceDeferredClientSource(
      rows(),
      {},
      replacement,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateDisposeError);
    expect(failure).toMatchObject({
      errors: [expect.objectContaining({ message: 'prior dispose failed' })],
    });
    expect(priorReleased()).toBe(true);
    expect(admissions.all).toStrictEqual([]);
  });

  it('releases the prior admission and release when disposing the detached prior history fails', async () => {
    const { admissions, priorReleased, replacement } =
      await replacementWithFailingDispose();

    const failure = await replaceClientHistorySource(
      rows(),
      {},
      false,
      replacement,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateDisposeError);
    expect(failure).toMatchObject({
      errors: [expect.objectContaining({ message: 'prior dispose failed' })],
    });
    expect(priorReleased()).toBe(true);
    expect(admissions.all).toStrictEqual([]);
  });
});
