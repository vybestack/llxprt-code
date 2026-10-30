/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  IContent,
  MediaReferenceBlock,
} from '../services/history/IContent.js';
import { LocalMediaStore } from './local-media-store.js';
import {
  RequestMediaByteOverflowError,
  RequestMediaResolutionError,
  RequestMediaResolver,
} from './request-media-resolver.js';

async function admitted(
  store: LocalMediaStore,
  seed: number,
  length: number,
): Promise<MediaReferenceBlock> {
  return store.admit({
    bytes: new Uint8Array(length).fill(seed),
    mimeType: 'image/png',
    dimensions: { width: 2, height: 2 },
    semanticMetadata: {},
  });
}

function turn(turnId: string, reference: MediaReferenceBlock): IContent {
  return { speaker: 'human', blocks: [reference], metadata: { turnId } };
}

async function rejection(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to reject');
}

describe('request media byte overflow', () => {
  let tempDirectory = '';
  const directory = (): string => tempDirectory;

  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'llxprt-media-overflow-'));
  });
  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  });

  async function selection(): Promise<{
    readonly store: LocalMediaStore;
    readonly contents: IContent[];
    readonly total: number;
  }> {
    const store = new LocalMediaStore({
      rootDirectory: directory(),
      quotaBytes: 1024,
    });
    const first = await admitted(store, 1, 30);
    const second = await admitted(store, 2, 30);
    return {
      store,
      contents: [turn('turn-old', first), turn('turn-new', second)],
      total: first.normalizedBase64Length + second.normalizedBase64Length,
    };
  }

  it('reports total, budget, and the crossing turn when the budget is one byte short', async () => {
    const { store, contents, total } = await selection();

    const error = await rejection(
      new RequestMediaResolver(store).resolve({
        contents,
        requestId: 'overflow',
        turnId: 'active-turn',
        aggregateBudgetBytes: total - 1,
      }),
    );

    expect(error).toBeInstanceOf(RequestMediaByteOverflowError);
    expect(error).toMatchObject({
      totalBytes: total,
      budgetBytes: total - 1,
      turnId: 'turn-new',
    });
  });

  it('names the bytes and an actionable remedy in the message', async () => {
    const { store, contents, total } = await selection();

    const error = await rejection(
      new RequestMediaResolver(store).resolve({
        contents,
        requestId: 'overflow',
        turnId: 'active-turn',
        aggregateBudgetBytes: total - 1,
      }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : '').toContain(
      `${total} > ${total - 1}`,
    );
  });

  it('describes the total across the whole selected history, not a single oversized image', async () => {
    const { store, contents, total } = await selection();

    const error = await rejection(
      new RequestMediaResolver(store).resolve({
        contents,
        requestId: 'overflow',
        turnId: 'active-turn',
        aggregateBudgetBytes: total - 1,
      }),
    );

    const message = error instanceof Error ? error.message : '';
    expect(message).toContain('all selected images');
    expect(message).not.toContain('failed for content');
  });

  it('admits the same selection when the budget equals its total', async () => {
    const { store, contents, total } = await selection();

    const resolved = await new RequestMediaResolver(store).resolve({
      contents,
      requestId: 'exact',
      turnId: 'active-turn',
      aggregateBudgetBytes: total,
    });

    expect(resolved.accounting().selectedNormalizedBytes).toBe(total);
    await resolved.release();
  });

  it('keeps missing media distinct from byte overflow', async () => {
    const { store, contents } = await selection();
    const missing: IContent = {
      speaker: 'human',
      blocks: [
        {
          ...(await admitted(store, 3, 30)),
          contentId: `sha256:${'0'.repeat(64)}`,
        },
      ],
      metadata: { turnId: 'turn-missing' },
    };

    const error = await rejection(
      new RequestMediaResolver(store).resolve({
        contents: [...contents, missing],
        requestId: 'missing',
        turnId: 'active-turn',
        aggregateBudgetBytes: 1_000_000,
      }),
    );

    expect(error).toBeInstanceOf(RequestMediaResolutionError);
    expect(error).not.toBeInstanceOf(RequestMediaByteOverflowError);
  });
});
