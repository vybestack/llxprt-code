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
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import type { ToolResult } from '../index.js';

function createTempDir(prefix = 'llxprt-read-many-files-behavior-'): {
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

function stringifyLlmContent(result: ToolResult): string {
  return Array.isArray(result.llmContent)
    ? result.llmContent
        .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
        .join('\n')
    : String(result.llmContent);
}

describe('ReadManyFilesTool real behavioral filtering', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;

    mkdirSync(join(tempDir, '.git'), { recursive: true });
    mkdirSync(join(tempDir, 'secrets'), { recursive: true });
    writeFileSync(join(tempDir, '.gitignore'), '*.log\n');
    writeFileSync(join(tempDir, '.llxprtignore'), 'secrets/\n');
    writeFileSync(join(tempDir, 'debug.log'), 'log content', 'utf-8');
    writeFileSync(join(tempDir, 'keep.txt'), 'visible content', 'utf-8');
    writeFileSync(
      join(tempDir, 'secrets', 'key.txt'),
      'secret content',
      'utf-8',
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('excludes .llxprtignore matches by default', async () => {
    const tool = new ReadManyFilesTool(
      createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
    );

    const result = await tool.execute({ paths: ['**/*.txt'] });
    const content = stringifyLlmContent(result);

    expect(result.error).toBeUndefined();
    expect(content).toContain('visible content');
    expect(content).not.toContain('secret content');
  });

  it('does not pre-filter .llxprtignore matches when respect_llxprt_ignore is false', async () => {
    const tool = new ReadManyFilesTool(
      createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
    );

    const result = await tool.execute({
      paths: ['**/*.txt', '**/*.log'],
      file_filtering_options: { respect_llxprt_ignore: false },
    });
    const content = stringifyLlmContent(result);

    expect(result.error).toBeUndefined();
    expect(content).toContain('visible content');
    expect(content).toContain('secret content');
    expect(content).not.toContain('log content');
  });

  it('allows .llxprtignore negation to un-ignore a gitignored file', async () => {
    writeFileSync(join(tempDir, '.gitignore'), '*.txt\n');
    writeFileSync(join(tempDir, '.llxprtignore'), '!keep.txt\n');

    const tool = new ReadManyFilesTool(
      createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
    );

    const result = await tool.execute({ paths: ['**/*.txt'] });
    const content = stringifyLlmContent(result);

    expect(result.error).toBeUndefined();
    expect(content).toContain('visible content');
    // The broad .gitignore rule still excludes other .txt files; this assertion
    // keeps the focus on keep.txt being restored by the .llxprtignore negation.
    expect(content).not.toContain('secret content');
  });
});
