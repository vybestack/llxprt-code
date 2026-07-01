/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  symlinkSync,
  mkdtempSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PartListUnion } from '@google/genai';
import { GlobTool, type GlobToolParams } from '../tools/glob.js';
import { createRealToolHost as createRealHost } from './helpers/create-real-tool-host.js';
import type { IToolHost } from '../interfaces/index.js';
import type { ToolResult } from '../index.js';

function createTempDir(prefix = 'llxprt-glob-behavior-'): {
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

function canCreateSymlink(): boolean {
  const dir = mkdtempSync(join(tmpdir(), 'llxprt-glob-symlink-probe-'));
  try {
    writeFileSync(join(dir, 'target.txt'), 'target', 'utf-8');
    symlinkSync(join(dir, 'target.txt'), join(dir, 'link.txt'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let supportsSymlinks = false;

async function runGlob(
  host: IToolHost,
  params: GlobToolParams,
): Promise<ToolResult> {
  const tool = new GlobTool(host);
  const invocation = tool.build(params);
  const result = await invocation.execute(new AbortController().signal);
  expect(result.error).toBeUndefined();
  return result;
}

function extractFilePaths(llmContent: PartListUnion): string[] {
  if (typeof llmContent !== 'string') {
    throw new TypeError('GlobTool test expected string llmContent');
  }
  return llmContent
    .split('\n')
    .map((l) => l.trim())
    .filter(
      (l) =>
        l !== '' && !/^Found \d+ file\(s\)/.test(l) && !l.startsWith('**Note'),
    );
}
function endsWithPath(filePath: string, suffix: string): boolean {
  return filePath.replace(/\\/g, '/').endsWith(suffix);
}

describe('GlobTool real behavioral filtering', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeAll(() => {
    supportsSymlinks = process.platform !== 'win32' && canCreateSymlink();
  });

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  describe('.gitignore and .llxprtignore independence', () => {
    beforeEach(() => {
      mkdirSync(join(tempDir, '.git'), { recursive: true });
      writeFileSync(join(tempDir, '.gitignore'), '*.log\n');
      writeFileSync(join(tempDir, '.llxprtignore'), 'secrets/\n');

      writeFileSync(join(tempDir, 'keep.ts'), 'keep', 'utf-8');
      writeFileSync(join(tempDir, 'debug.log'), 'log', 'utf-8');
      mkdirSync(join(tempDir, 'secrets'), { recursive: true });
      writeFileSync(join(tempDir, 'secrets', 'key.pem'), 'key', 'utf-8');
    });

    it('both flags true filters both gitignored and llxprtignored files', async () => {
      const host = createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      });

      const result = await runGlob(host, { pattern: '**/*', path: tempDir });
      const files = extractFilePaths(result.llmContent);

      expect(files.some((f) => endsWithPath(f, 'keep.ts'))).toBe(true);
      expect(files.some((f) => endsWithPath(f, 'debug.log'))).toBe(false);
      expect(files.some((f) => endsWithPath(f, 'key.pem'))).toBe(false);
    });

    it('respect_git_ignore false keeps gitignored files but still filters llxprtignored', async () => {
      const host = createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      });

      const result = await runGlob(host, {
        pattern: '**/*',
        path: tempDir,
        file_filtering_options: { respect_git_ignore: false },
      });
      const files = extractFilePaths(result.llmContent);

      expect(files.some((f) => endsWithPath(f, 'keep.ts'))).toBe(true);
      expect(files.some((f) => endsWithPath(f, 'debug.log'))).toBe(true);
      expect(files.some((f) => endsWithPath(f, 'key.pem'))).toBe(false);
    });

    it('respect_llxprt_ignore false keeps llxprtignored files but still filters gitignored', async () => {
      const host = createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      });

      const result = await runGlob(host, {
        pattern: '**/*',
        path: tempDir,
        file_filtering_options: { respect_llxprt_ignore: false },
      });
      const files = extractFilePaths(result.llmContent);

      expect(files.some((f) => endsWithPath(f, 'keep.ts'))).toBe(true);
      expect(files.some((f) => endsWithPath(f, 'debug.log'))).toBe(false);
      expect(files.some((f) => endsWithPath(f, 'key.pem'))).toBe(true);
    });

    it('both flags false keeps all files', async () => {
      const host = createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      });

      const result = await runGlob(host, {
        pattern: '**/*',
        path: tempDir,
        file_filtering_options: {
          respect_git_ignore: false,
          respect_llxprt_ignore: false,
        },
      });
      const files = extractFilePaths(result.llmContent);

      expect(files.some((f) => endsWithPath(f, 'keep.ts'))).toBe(true);
      expect(files.some((f) => endsWithPath(f, 'debug.log'))).toBe(true);
      expect(files.some((f) => endsWithPath(f, 'key.pem'))).toBe(true);
    });
  });

  describe('combined precedence (.llxprtignore negation un-ignores gitignored)', () => {
    beforeEach(() => {
      mkdirSync(join(tempDir, '.git'), { recursive: true });
      // .gitignore ignores all .txt files; .llxprtignore un-ignores important.txt
      writeFileSync(join(tempDir, '.gitignore'), '*.txt\n');
      writeFileSync(join(tempDir, '.llxprtignore'), '!important.txt\n');

      writeFileSync(join(tempDir, 'normal.txt'), 'normal', 'utf-8');
      writeFileSync(join(tempDir, 'important.txt'), 'important', 'utf-8');
      writeFileSync(join(tempDir, 'keep.js'), 'keep', 'utf-8');
    });

    it('both flags true allows .llxprtignore negation to un-ignore a gitignored file', async () => {
      const host = createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      });

      const result = await runGlob(host, { pattern: '**/*', path: tempDir });
      const files = extractFilePaths(result.llmContent);

      expect(files.some((f) => endsWithPath(f, 'important.txt'))).toBe(true);
      expect(files.some((f) => endsWithPath(f, 'normal.txt'))).toBe(false);
      expect(files.some((f) => endsWithPath(f, 'keep.js'))).toBe(true);
    });

    it('respect_llxprt_ignore false applies only gitignore (negation not applied)', async () => {
      const host = createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      });

      const result = await runGlob(host, {
        pattern: '**/*',
        path: tempDir,
        file_filtering_options: { respect_llxprt_ignore: false },
      });
      const files = extractFilePaths(result.llmContent);

      // Without llxprtignore, both .txt files are gitignored
      expect(files.some((f) => endsWithPath(f, 'important.txt'))).toBe(false);
      expect(files.some((f) => endsWithPath(f, 'normal.txt'))).toBe(false);
      expect(files.some((f) => endsWithPath(f, 'keep.js'))).toBe(true);
    });

    it('both flags true lets .llxprtignore un-ignore a file inside a gitignored directory', async () => {
      const isolatedDir = mkdtempSync(join(tmpdir(), 'llxprt-glob-dir-'));
      try {
        mkdirSync(join(isolatedDir, '.git'), { recursive: true });
        writeFileSync(join(isolatedDir, '.gitignore'), 'tmp/\n');
        writeFileSync(join(isolatedDir, '.llxprtignore'), '!tmp/example.txt\n');
        mkdirSync(join(isolatedDir, 'tmp'), { recursive: true });
        writeFileSync(
          join(isolatedDir, 'tmp', 'example.txt'),
          'example',
          'utf-8',
        );
        writeFileSync(join(isolatedDir, 'tmp', 'other.txt'), 'other', 'utf-8');

        const host = createRealHost(isolatedDir, {
          respectGitIgnore: true,
          respectLlxprtIgnore: true,
        });

        const result = await runGlob(host, {
          pattern: '**/*',
          path: isolatedDir,
        });
        const files = extractFilePaths(result.llmContent);

        expect(files.some((f) => endsWithPath(f, 'tmp/example.txt'))).toBe(
          true,
        );
        expect(files.some((f) => endsWithPath(f, 'tmp/other.txt'))).toBe(false);
      } finally {
        rmSync(isolatedDir, { recursive: true, force: true });
      }
    });

    it('later .llxprtignore re-ignore wins after a negation', async () => {
      writeFileSync(join(tempDir, '.gitignore'), 'unrelated.log\n');
      writeFileSync(
        join(tempDir, '.llxprtignore'),
        '!important.txt\nimportant.txt\n',
      );

      const host = createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      });

      const result = await runGlob(host, { pattern: '**/*', path: tempDir });
      const files = extractFilePaths(result.llmContent);

      expect(files.some((f) => endsWithPath(f, 'important.txt'))).toBe(false);
      expect(files.some((f) => endsWithPath(f, 'normal.txt'))).toBe(true);
      expect(files.some((f) => endsWithPath(f, 'keep.js'))).toBe(true);
    });
  });

  describe('no-git repository (only .llxprtignore applies)', () => {
    beforeEach(() => {
      // Intentionally no .git directory
      writeFileSync(join(tempDir, '.gitignore'), '*.log\n');
      writeFileSync(join(tempDir, '.llxprtignore'), 'drafts/\n');

      writeFileSync(join(tempDir, 'keep.ts'), 'keep', 'utf-8');
      writeFileSync(join(tempDir, 'debug.log'), 'log', 'utf-8');
      mkdirSync(join(tempDir, 'drafts'), { recursive: true });
      writeFileSync(join(tempDir, 'drafts', 'notes.md'), 'draft', 'utf-8');
    });

    it('.gitignore is NOT applied when there is no .git directory', async () => {
      const host = createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      });

      const result = await runGlob(host, { pattern: '**/*', path: tempDir });
      const files = extractFilePaths(result.llmContent);

      // Without .git, gitignore doesn't apply even though respectGitIgnore=true
      expect(files.some((f) => endsWithPath(f, 'keep.ts'))).toBe(true);
      expect(files.some((f) => endsWithPath(f, 'debug.log'))).toBe(true);
      // But .llxprtignore still applies
      expect(files.some((f) => endsWithPath(f, 'notes.md'))).toBe(false);
    });
  });

  describe('nested workspace (.llxprtignore relative to workspace root)', () => {
    let repoRoot: string;
    let workspaceDir: string;

    beforeEach(() => {
      repoRoot = join(tempDir, 'repo');
      workspaceDir = join(repoRoot, 'workspace');
      mkdirSync(join(repoRoot, '.git'), { recursive: true });
      mkdirSync(workspaceDir, { recursive: true });

      // Root .gitignore ignores *.secret everywhere
      writeFileSync(join(repoRoot, '.gitignore'), '*.secret\n');
      // Workspace-local .llxprtignore ignores local-only.txt
      writeFileSync(join(workspaceDir, '.llxprtignore'), 'local-only.txt\n');

      writeFileSync(join(workspaceDir, 'keep.ts'), 'keep', 'utf-8');
      writeFileSync(join(workspaceDir, 'hidden.secret'), 'secret', 'utf-8');
      writeFileSync(join(workspaceDir, 'local-only.txt'), 'local', 'utf-8');
    });

    it('gitignore from repo root applies and .llxprtignore from workspace root applies', async () => {
      const host = createRealHost(workspaceDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      });

      const result = await runGlob(host, {
        pattern: '**/*',
        path: workspaceDir,
      });
      const files = extractFilePaths(result.llmContent);

      expect(files.some((f) => endsWithPath(f, 'keep.ts'))).toBe(true);
      expect(files.some((f) => endsWithPath(f, 'hidden.secret'))).toBe(false);
      expect(files.some((f) => endsWithPath(f, 'local-only.txt'))).toBe(false);
    });

    it('.llxprtignore patterns are relative to workspace root, not repo root', async () => {
      // local-only.txt should be ignored relative to the workspace dir.
      // If it were relative to repo root, the pattern wouldn't match.
      const host = createRealHost(workspaceDir, {
        respectGitIgnore: false,
        respectLlxprtIgnore: true,
      });

      const result = await runGlob(host, {
        pattern: '**/*',
        path: workspaceDir,
      });
      const files = extractFilePaths(result.llmContent);

      expect(files.some((f) => endsWithPath(f, 'keep.ts'))).toBe(true);
      // .secret not filtered because respectGitIgnore=false
      expect(files.some((f) => endsWithPath(f, 'hidden.secret'))).toBe(true);
      // local-only.txt filtered because .llxprtignore is relative to workspace
      expect(files.some((f) => endsWithPath(f, 'local-only.txt'))).toBe(false);
    });
  });

  describe('nested .gitignore files', () => {
    beforeEach(() => {
      mkdirSync(join(tempDir, '.git'), { recursive: true });
      writeFileSync(join(tempDir, '.gitignore'), '*.log\n');

      writeFileSync(join(tempDir, 'root.log'), 'log', 'utf-8');
      writeFileSync(join(tempDir, 'keep.ts'), 'keep', 'utf-8');

      mkdirSync(join(tempDir, 'sub'), { recursive: true });
      // Nested .gitignore in sub/ that ignores *.tmp
      writeFileSync(join(tempDir, 'sub', '.gitignore'), '*.tmp\n');
      writeFileSync(join(tempDir, 'sub', 'data.tmp'), 'tmp', 'utf-8');
      writeFileSync(join(tempDir, 'sub', 'code.ts'), 'code', 'utf-8');
    });

    it('nested .gitignore patterns apply only within their directory', async () => {
      const host = createRealHost(tempDir, {
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      });

      const result = await runGlob(host, { pattern: '**/*', path: tempDir });
      const files = extractFilePaths(result.llmContent);

      expect(files.some((f) => endsWithPath(f, 'keep.ts'))).toBe(true);
      expect(files.some((f) => endsWithPath(f, 'root.log'))).toBe(false);
      expect(files.some((f) => endsWithPath(f, 'data.tmp'))).toBe(false);
      expect(files.some((f) => endsWithPath(f, 'code.ts'))).toBe(true);
    });
  });

  describe('canonical/symlink behavior', () => {
    beforeEach(() => {
      mkdirSync(join(tempDir, '.git'), { recursive: true });
      writeFileSync(join(tempDir, '.gitignore'), 'target/\n');

      mkdirSync(join(tempDir, 'target'), { recursive: true });
      writeFileSync(join(tempDir, 'target', 'real.txt'), 'real', 'utf-8');
      // Symlink to a file inside an ignored directory
      try {
        symlinkSync(
          join(tempDir, 'target', 'real.txt'),
          join(tempDir, 'link.txt'),
        );
      } catch {
        // Some restricted environments do not allow symlink creation.
      }
    });

    it.skipIf(!supportsSymlinks)(
      'symlink to ignored target is filtered consistently',
      async () => {
        expect(existsSync(join(tempDir, 'link.txt'))).toBe(true);

        const host = createRealHost(tempDir, {
          respectGitIgnore: true,
          respectLlxprtIgnore: true,
        });

        const result = await runGlob(host, { pattern: '**/*', path: tempDir });
        const files = extractFilePaths(result.llmContent);

        expect(files.some((f) => endsWithPath(f, 'link.txt'))).toBe(false);
        expect(files.some((f) => endsWithPath(f, 'target/real.txt'))).toBe(
          false,
        );
      },
    );
  });
});
