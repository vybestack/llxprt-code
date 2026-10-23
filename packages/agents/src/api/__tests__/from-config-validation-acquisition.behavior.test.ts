import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { access, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('adoption validation precedes host acquisition', () => {
  let previousDescriptor: string | undefined;
  let previousSocket: string | undefined;
  beforeEach(() => {
    previousDescriptor = process.env.LLXPRT_CAPABILITY_FD;
    previousSocket = process.env.LLXPRT_CREDENTIAL_SOCKET;
    process.env.LLXPRT_CAPABILITY_FD = 'invalid-adoption-descriptor';
    process.env.LLXPRT_CREDENTIAL_SOCKET = '/unused-adoption-socket';
  });
  afterEach(() => {
    if (previousDescriptor === undefined)
      delete process.env.LLXPRT_CAPABILITY_FD;
    else process.env.LLXPRT_CAPABILITY_FD = previousDescriptor;
    if (previousSocket === undefined)
      delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    else process.env.LLXPRT_CREDENTIAL_SOCKET = previousSocket;
  });

  it.each([undefined, null, {}, { config: null }])(
    'rejects a missing Config without consuming the inherited capability %#',
    async (input) => {
      const construction: unknown = Reflect.apply(fromConfig, undefined, [
        input,
      ]);
      await expect(construction).rejects.toThrow(
        'fromConfig requires an existing Config',
      );
      expect(process.env.LLXPRT_CAPABILITY_FD).toBe(
        'invalid-adoption-descriptor',
      );
    },
  );

  it.each(['fulfilled', 'undefined', 'error'])(
    'joins the actual transferred image prefix after broker acquisition validation fails, retaining %s cleanup faults',
    async (mode) => {
      const directory = await mkdtemp(
        join(tmpdir(), 'adoption-broker-prefix-'),
      );
      const file = join(directory, 'transferred-image-resource');
      await writeFile(file, 'actual transferred image');
      let releases = 0;
      const repeated = new Error('image cleanup failed independently');
      const cleanupFailure = mode === 'undefined' ? undefined : repeated;
      try {
        const construction: Promise<unknown> = Reflect.apply(
          fromConfig,
          undefined,
          [
            undefined,
            undefined,
            {},
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            async () => {
              throw new Error('Unacquired broker must not release');
            },
            {
              ownership: 'agent',
              run: async () => {
                throw new Error(
                  'No image execution during invalid broker acquisition',
                );
              },
              dispose: async () => {
                releases++;
                await unlink(file);
                if (mode !== 'fulfilled') throw cleanupFailure;
              },
            },
          ],
        );
        const [outcome] = await Promise.allSettled([construction]);
        expect(outcome.status).toBe('rejected');
        if (outcome.status !== 'rejected')
          throw new Error('Invalid broker unexpectedly acquired');
        const error: unknown = outcome.reason;
        expect(error instanceof AggregateError).toBe(mode !== 'fulfilled');
        const causes: unknown[] =
          error instanceof AggregateError ? error.errors : [error];
        const primary = causes[0];
        expect(primary).toBeInstanceOf(Error);
        if (!(primary instanceof Error))
          throw new Error('Missing broker acquisition primary');
        expect(primary.message).toBe(
          'GitHub transport disposal requires an explicit broker',
        );
        expect(causes.slice(1)).toStrictEqual(
          mode === 'fulfilled' ? [] : [cleanupFailure],
        );
        await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(releases).toBe(1);
        expect(process.env.LLXPRT_CAPABILITY_FD).toBe(
          'invalid-adoption-descriptor',
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it('joins cleanup of the explicit transferred image resource even when validation rejects before host acquisition', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'adoption-validation-'));
    const file = join(directory, 'transferred-image-resource');
    await writeFile(file, 'actual transferred construction resource');
    let releases = 0;
    try {
      const construction: unknown = Reflect.apply(fromConfig, undefined, [
        undefined,
        undefined,
        {},
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          ownership: 'agent',
          run: async () => {
            throw new Error('Validation must not execute image generation');
          },
          dispose: async () => {
            releases++;
            await unlink(file);
          },
        },
      ]);
      await expect(construction).rejects.toThrow(
        'fromConfig requires an existing Config',
      );
      await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(releases).toBe(1);
      expect(process.env.LLXPRT_CAPABILITY_FD).toBe(
        'invalid-adoption-descriptor',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
