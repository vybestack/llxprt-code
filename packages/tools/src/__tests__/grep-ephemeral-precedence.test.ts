/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IToolHost } from '../interfaces/index.js';
import { GrepTool } from '../index.js';
import type { ToolResult } from '../index.js';
import type { GrepToolParams } from '../tools/grep/types.js';

function createTempDir(prefix = 'llxprt-eph-'): {
  dir: string;
  cleanup: () => void;
} {
  const dir = join(
    tmpdir(),
    `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
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

function createToolHost(
  targetDir: string,
  ephemeralMaxItems?: unknown,
): IToolHost {
  const ephemeral: Record<string, unknown> = {
    'tool-output-max-tokens': 50000,
    'tool-output-item-size-limit': 524288,
  };
  if (ephemeralMaxItems !== undefined) {
    ephemeral['tool-output-max-items'] = ephemeralMaxItems;
  }
  return {
    getTargetDir: () => targetDir,
    getWorkspaceRoots: () => [targetDir],
    getApprovalMode: () => 'auto',
    setApprovalMode: () => {},
    isInteractive: () => false,
    hasFeatureFlag: () => false,
    getFileService: () => ({
      shouldGitIgnoreFile: () => false,
      shouldLlxprtIgnoreFile: () => false,
      shouldIgnoreFile: () => false,
      filterFiles: (paths) => paths,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getFileExclusions: () => [],
    getReadManyFilesExclusions: () => [],
    getFileFilteringRespectLlxprtIgnore: () => true,
    getLlxprtIgnoreFilePath: () => null,
    recordFileRead: () => {},
    getFileSystemService: () => undefined,
    getLlxprtIgnorePatterns: () => [],
    getEphemeralSettings: () => ephemeral,
    getDebugMode: () => false,
  };
}

async function executeGrep(
  host: IToolHost,
  params: GrepToolParams,
): Promise<ToolResult> {
  const tool = new GrepTool(host);
  return tool.build(params).execute(new AbortController().signal);
}

describe('GrepTool ephemeral max-results precedence', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(tempDir, `f${i}.txt`), `ephmatch_${i}\n`);
    }
  });

  afterEach(() => {
    cleanup();
  });

  it('ephemeral fallback: no explicit max_results uses tool-output-max-items', async () => {
    const host = createToolHost(tempDir, 3);
    const result = await executeGrep(host, {
      pattern: 'ephmatch',
      max_per_file: 1,
    });
    const text = typeof result.llmContent === 'string' ? result.llmContent : '';
    // Should be limited to 3 results from ephemeral setting
    const matchCount = (text.match(/ephmatch_/g) ?? []).length;
    expect(matchCount).toBe(3);
    expect(text).toMatch(/showing/i);
  });

  it('explicit override: max_results wins over ephemeral', async () => {
    const host = createToolHost(tempDir, 3);
    const result = await executeGrep(host, {
      pattern: 'ephmatch',
      max_results: 5,
      max_per_file: 1,
    });
    const text = typeof result.llmContent === 'string' ? result.llmContent : '';
    const matchCount = (text.match(/ephmatch_/g) ?? []).length;
    // Explicit 5 should win over ephemeral 3
    expect(matchCount).toBe(5);
  });

  it('absent default: no explicit, no ephemeral => defaults to 1000', async () => {
    const host = createToolHost(tempDir, undefined);
    const result = await executeGrep(host, {
      pattern: 'ephmatch',
    });
    const text = typeof result.llmContent === 'string' ? result.llmContent : '';
    // Default 1000 > 10 files, so all 10 should be found
    const matchCount = (text.match(/ephmatch_/g) ?? []).length;
    expect(matchCount).toBe(10);
    expect(text).not.toMatch(/showing|incomplete/i);
  });

  it('invalid ephemeral: falls back to default 1000', async () => {
    const host = createToolHost(tempDir, -1);
    const result = await executeGrep(host, {
      pattern: 'ephmatch',
    });
    const text = typeof result.llmContent === 'string' ? result.llmContent : '';
    // Invalid ephemeral (-1) should fall back to 1000 > 10
    const matchCount = (text.match(/ephmatch_/g) ?? []).length;
    expect(matchCount).toBe(10);
    expect(text).not.toMatch(/showing|incomplete/i);
  });

  it('hard-cap: ephemeral above cap does not crash and stays bounded', async () => {
    const host = createToolHost(tempDir, 500_000);
    const result = await executeGrep(host, {
      pattern: 'ephmatch',
    });
    expect(result.error).toBeUndefined();
    const text = typeof result.llmContent === 'string' ? result.llmContent : '';
    // 500k would be capped to 100k (MAX_RESULTS_HARD_CAP), still > 10 files
    const matchCount = (text.match(/ephmatch_/g) ?? []).length;
    expect(matchCount).toBe(10);
  });
});
