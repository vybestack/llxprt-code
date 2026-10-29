/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('core runtime package entries', () => {
  const fixtureDirectories: string[] = [];

  afterEach(() => {
    for (const directory of fixtureDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function invokeConsumer(directory: string, script: string): string {
    const consumer = mkdtempSync(join(tmpdir(), 'llxprt-core-consumer-'));
    fixtureDirectories.push(consumer);
    const packageDirectory = join(
      consumer,
      'node_modules/@vybestack/llxprt-code-core',
    );
    mkdirSync(packageDirectory, { recursive: true });
    copyFileSync(
      new URL('../package.json', import.meta.url),
      join(packageDirectory, 'package.json'),
    );
    cpSync(
      new URL(`./${directory}`, import.meta.url),
      join(packageDirectory, 'src', directory),
      { recursive: true },
    );

    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: consumer,
      encoding: 'utf8',
      timeout: 10_000,
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    return result.stdout;
  }

  it('loads approval publication behavior through the installed Bun subpath', () => {
    const output = invokeConsumer(
      'scheduler',
      `import {
        ApprovalPublicationError,
        serializableApprovalDetails,
      } from '@vybestack/llxprt-code-core/scheduler/approval-lifecycle.js';
      const details = serializableApprovalDetails({
        type: 'exec',
        title: 'Allow command?',
        command: 'pwd',
        rootCommand: 'pwd',
        onConfirm: async () => {},
      });
      console.log(JSON.stringify({
        details,
        publicationError: new ApprovalPublicationError('persist failed') instanceof Error,
      }));`,
    );

    expect(JSON.parse(output)).toStrictEqual({
      details: {
        type: 'exec',
        title: 'Allow command?',
        command: 'pwd',
        rootCommand: 'pwd',
      },
      publicationError: true,
    });
  });

  it('loads native fact coverage behavior through the installed Bun subpath', () => {
    const output = invokeConsumer(
      'journal',
      `import {
        encodeNativeFactCoverage,
        nativeFactCoverage,
      } from '@vybestack/llxprt-code-core/journal/nativeFactIndex.js';
      const coverage = nativeFactCoverage(encodeNativeFactCoverage('anthropic', 42));
      console.log(JSON.stringify(coverage, (_, value) =>
        typeof value === 'bigint' ? Number(value) : value));`,
    );

    expect(JSON.parse(output)).toStrictEqual({
      scope: 'anthropic',
      through: 42,
    });
  });
});
