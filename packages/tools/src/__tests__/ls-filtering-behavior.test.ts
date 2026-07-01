/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRealToolHost as createRealHost } from './helpers/create-real-tool-host.js';
import { LSTool } from '../tools/ls.js';
import type { LSToolParams } from '../tools/ls.js';
import type { IToolHost } from '../interfaces/index.js';
import type { ToolResult } from '../index.js';

function createTempDir(prefix = 'llxprt-ls-filtering-behavior-'): {
  dir: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

async function runLs(
  host: IToolHost,
  params: LSToolParams,
): Promise<ToolResult> {
  const tool = new LSTool(host);
  const result = await tool.build(params).execute(new AbortController().signal);
  expect(result.error).toBeUndefined();
  return result;
}

function stringifyLlmContent(result: ToolResult): string {
  return Array.isArray(result.llmContent)
    ? result.llmContent
        .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
        .join('\n')
    : String(result.llmContent);
}

describe('LSTool real behavioral filtering', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;

    mkdirSync(join(tempDir, '.git'), { recursive: true });
    writeFileSync(join(tempDir, '.gitignore'), '*.log\n');
    writeFileSync(join(tempDir, '.llxprtignore'), 'secret.txt\n');
    writeFileSync(join(tempDir, 'debug.log'), 'log content', 'utf-8');
    writeFileSync(join(tempDir, 'keep.txt'), 'visible content', 'utf-8');
    writeFileSync(join(tempDir, 'secret.txt'), 'secret', 'utf-8');
  });

  afterEach(() => {
    cleanup();
  });

  it('both flags true filters both gitignored and llxprtignored entries', async () => {
    const result = await runLs(
      createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
      { path: tempDir },
    );
    const content = stringifyLlmContent(result);

    expect(content).toContain('keep.txt');
    expect(content).not.toContain('debug.log');
    expect(content).not.toContain('secret.txt');
  });

  it('respect_git_ignore false keeps gitignored entries but still filters llxprtignored entries', async () => {
    const result = await runLs(
      createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
      {
        path: tempDir,
        file_filtering_options: { respect_git_ignore: false },
      },
    );
    const content = stringifyLlmContent(result);

    expect(content).toContain('keep.txt');
    expect(content).toContain('debug.log');
    expect(content).not.toContain('secret.txt');
  });

  it('respect_llxprt_ignore false keeps llxprtignored entries but still filters gitignored entries', async () => {
    const result = await runLs(
      createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
      {
        path: tempDir,
        file_filtering_options: { respect_llxprt_ignore: false },
      },
    );
    const content = stringifyLlmContent(result);

    expect(content).toContain('keep.txt');
    expect(content).not.toContain('debug.log');
    expect(content).toContain('secret.txt');
  });

  it('both flags false keeps gitignored and llxprtignored entries', async () => {
    const result = await runLs(
      createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
      {
        path: tempDir,
        file_filtering_options: {
          respect_git_ignore: false,
          respect_llxprt_ignore: false,
        },
      },
    );
    const content = stringifyLlmContent(result);

    expect(content).toContain('keep.txt');
    expect(content).toContain('debug.log');
    expect(content).toContain('secret.txt');
  });

  it('file_filtering_options can enable filters when host defaults disable them', async () => {
    const result = await runLs(
      createRealHost(tempDir, {
        respectGitIgnore: false,
        respectLlxprtIgnore: false,
      }),
      {
        path: tempDir,
        file_filtering_options: {
          respect_git_ignore: true,
          respect_llxprt_ignore: true,
        },
      },
    );
    const content = stringifyLlmContent(result);

    expect(content).toContain('keep.txt');
    expect(content).not.toContain('debug.log');
    expect(content).not.toContain('secret.txt');
  });

  it('both flags true allows .llxprtignore negation to un-ignore a gitignored entry', async () => {
    writeFileSync(join(tempDir, '.gitignore'), 'important.txt\n');
    writeFileSync(join(tempDir, '.llxprtignore'), '!important.txt\n');
    writeFileSync(join(tempDir, 'important.txt'), 'important', 'utf-8');

    const result = await runLs(
      createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
      { path: tempDir },
    );
    const content = stringifyLlmContent(result);

    expect(content).toContain('important.txt');
    expect(content).toContain('debug.log');
    expect(content).toContain('keep.txt');
    expect(content).toContain('secret.txt');
  });
});
