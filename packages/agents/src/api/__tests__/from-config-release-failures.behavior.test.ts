/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cleanupFailedAdoption,
  cleanupFailedFromConfig,
  rethrowPrimaryAfterCleanup,
} from '../fromConfig-cleanup.js';

describe('adoption release cause preservation and actual resource prefixes', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'adoption-release-causes-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('preserves independent cleanup error identities, undefined and repeated causes without flattening or filtering', () => {
    const repeated = new Error('same independently observed cause');
    const joined = new AggregateError(
      [undefined, repeated],
      'joined owner failure',
    );
    let caught: unknown;
    try {
      rethrowPrimaryAfterCleanup(
        repeated,
        [repeated, undefined, joined, repeated],
        'actual failed adoption',
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    if (!(caught instanceof AggregateError)) throw caught;
    expect(caught.errors).toStrictEqual([
      repeated,
      repeated,
      undefined,
      joined,
      repeated,
    ]);
    expect(caught.errors[3]).toBe(joined);
    expect(joined.errors).toStrictEqual([undefined, repeated]);
  });

  it('joins every acquired outer resource after a synchronous failure and releases preflight only after the other owners settle', async () => {
    for (const name of [
      'github',
      'images',
      'definitions',
      'memory',
      'preflight',
    ])
      await writeFile(join(directory, name), name);
    const primary = new Error('construction failed');
    const repeated = new Error('independent releases failed');
    const results = await Promise.allSettled([
      cleanupFailedFromConfig(
        primary,
        () => {
          unlinkSync(join(directory, 'github'));
          throw repeated;
        },
        async () => {
          await unlink(join(directory, 'images'));
          throw undefined;
        },
        () => {
          unlinkSync(join(directory, 'definitions'));
          throw repeated;
        },
        async () => {
          await unlink(join(directory, 'memory'));
        },
        async () => {
          expect((await readdir(directory)).sort()).toStrictEqual([
            'preflight',
          ]);
          await unlink(join(directory, 'preflight'));
          throw primary;
        },
      ),
    ]);
    expect((await readdir(directory)).sort()).toStrictEqual([]);
    const result = results[0];
    if (result.status !== 'rejected')
      throw new Error('Expected real resource release failure');
    expect(result.reason).toBeInstanceOf(AggregateError);
    if (!(result.reason instanceof AggregateError)) throw result.reason;
    expect(result.reason.errors).toStrictEqual([
      primary,
      repeated,
      undefined,
      repeated,
      primary,
    ]);
  });

  it('releases client, runtime and media despite synchronous workspace release failure, preserving stage order and an undefined primary', async () => {
    for (const name of ['workspace', 'client', 'runtime', 'media'])
      await writeFile(join(directory, name), name);
    const failure = new Error(
      'workspace and client release share an error identity',
    );
    const results = await Promise.allSettled([
      cleanupFailedAdoption(
        undefined,
        () => {
          unlinkSync(join(directory, 'runtime'));
          throw undefined;
        },
        () => {
          unlinkSync(join(directory, 'workspace'));
          throw failure;
        },
        async () => {
          await unlink(join(directory, 'media'));
        },
        async () => {
          expect((await readdir(directory)).sort()).toStrictEqual([
            'client',
            'media',
            'runtime',
          ]);
          await unlink(join(directory, 'client'));
          throw failure;
        },
      ),
    ]);
    expect((await readdir(directory)).sort()).toStrictEqual([]);
    const result = results[0];
    if (result.status !== 'rejected')
      throw new Error('Expected actual staged release failure');
    expect(result.reason).toBeInstanceOf(AggregateError);
    if (!(result.reason instanceof AggregateError)) throw result.reason;
    expect(result.reason.errors).toStrictEqual([
      undefined,
      failure,
      failure,
      undefined,
    ]);
  });
});
