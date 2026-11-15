/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneDumpDirectory } from './dump-retention.js';

const directories: string[] = [];

function createFixture(): string {
  const directory = join(tmpdir(), `llxprt-dump-retention-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  directories.push(directory);
  return directory;
}

describe('dump retention', () => {
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('prunes expired and oldest linked dump groups before newer ones', async () => {
    const directory = createFixture();
    const now = new Date('2026-11-14T12:00:00Z');
    const writeGroup = (id: string, ageDays: number, bytes: number): void => {
      const timestamp = new Date(now.getTime() - ageDays * 86_400_000);
      for (const suffix of ['request', 'response']) {
        const path = join(directory, `${id}-${suffix}.json`);
        writeFileSync(path, 'x'.repeat(bytes));
        utimesSync(path, timestamp, timestamp);
      }
    };
    writeGroup('expired', 20, 10);
    writeGroup('old', 5, 20);
    writeGroup('new', 1, 20);
    writeFileSync(join(directory, 'notes.txt'), 'leave me');
    const outside = join(
      directory,
      '..',
      `retention-target-${crypto.randomUUID()}`,
    );
    writeFileSync(outside, 'target');
    symlinkSync(outside, join(directory, 'linked-request.json'));

    const result = await pruneDumpDirectory(directory, {
      maxBytes: 45,
      maxAgeDays: 14,
      now,
    });

    expect(result.removedGroups).toStrictEqual(['expired', 'old']);
    expect(readFileSync(join(directory, 'new-request.json'), 'utf8')).toBe(
      'x'.repeat(20),
    );
    expect(readFileSync(join(directory, 'notes.txt'), 'utf8')).toBe('leave me');
    expect(readFileSync(outside, 'utf8')).toBe('target');
    rmSync(outside, { force: true });
  });

  it('does not prune through a symlinked dump directory', async () => {
    const root = createFixture();
    const outside = join(root, 'outside');
    mkdirSync(outside);
    const request = join(outside, 'pair-request.json');
    const response = join(outside, 'pair-response.json');
    writeFileSync(request, 'request');
    writeFileSync(response, 'response');
    const linkedDirectory = join(root, 'dumps');
    symlinkSync(outside, linkedDirectory, 'dir');

    await pruneDumpDirectory(linkedDirectory, {
      maxBytes: 1,
      maxAgeDays: 1,
      now: new Date(),
    });

    expect(readFileSync(request, 'utf8')).toBe('request');
    expect(readFileSync(response, 'utf8')).toBe('response');
  });

  it('keeps request and response files together and accepts default caps', async () => {
    const directory = createFixture();
    writeFileSync(join(directory, 'pair-request.json'), 'r'.repeat(20));
    writeFileSync(join(directory, 'pair-response.json'), 's'.repeat(20));

    const result = await pruneDumpDirectory(directory, {
      maxBytes: 30,
      maxAgeDays: 14,
      now: new Date(),
    });

    expect(result.managedBytes).toBe(0);
    expect(result.removedGroups).toStrictEqual(['pair']);
  });
});
