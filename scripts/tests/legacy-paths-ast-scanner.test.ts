/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the AST-based legacy-path scanner (Finding #5).
 *
 * The AST scanner catches patterns the regex scanner cannot:
 * 1. Arbitrary local aliases: `const myDir = '.llxprt'; path.join(homedir(), myDir)`
 * 2. Multiline path.join: `path.join(\n  os.homedir(),\n  '.llxprt'\n)`
 * 3. The exact telemetry prior shape: `const SETTINGS_DIR = join(homedir(), '.llxprt')`
 *
 * Tests exercise the REAL scanner against REAL source files (no mock theater).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { scanFileAst } from '../legacy-paths/ast-scanner.ts';
import type { CompiledAllowlist } from '../legacy-paths/config.ts';

const emptyAllowlist: CompiledAllowlist = new Map();

const tempDirs: string[] = [];

function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'llx-ast-scan-'));
  tempDirs.push(dir);
  return dir;
}

function writeFile(dir: string, relPath: string, content: string): string {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(`Failed to remove temp dir ${dir}:`, cleanupError);
    }
  }
});

describe('AST legacy-path scanner (Finding #5)', () => {
  let dir: string;

  beforeEach(() => {
    dir = freshDir();
  });

  it('detects the exact telemetry prior shape: join(homedir(), .llxprt)', () => {
    const filePath = writeFile(
      dir,
      'telemetry.ts',
      [
        "import { join } from 'node:path';",
        "import { homedir } from 'node:os';",
        "const SETTINGS_DIR = '.llxprt';",
        "const USER_SETTINGS_PATH = join(homedir(), SETTINGS_DIR, 'settings.json');",
      ].join('\n'),
    );
    const { matches } = scanFileAst(filePath, dir, emptyAllowlist);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(
      matches.some((m) => m.patternId === 'ast-homedir-dotllxprt-join'),
    ).toBe(true);
  });

  it('detects arbitrary local alias: const myAlias = .llxprt; path.join(homedir(), myAlias)', () => {
    const filePath = writeFile(
      dir,
      'alias.ts',
      [
        "import path from 'node:path';",
        "import os from 'node:os';",
        "const mySecretAlias = '.llxprt';",
        "export const configDir = path.join(os.homedir(), mySecretAlias, 'config');",
      ].join('\n'),
    );
    const { matches } = scanFileAst(filePath, dir, emptyAllowlist);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(
      matches.some((m) => m.patternId === 'ast-homedir-dotllxprt-join'),
    ).toBe(true);
  });

  it('detects multiline path.join: homedir() and .llxprt on separate lines', () => {
    const filePath = writeFile(
      dir,
      'multiline.ts',
      [
        "import path from 'node:path';",
        "import os from 'node:os';",
        'export const dataDir = path.join(',
        '  os.homedir(),',
        "  '.llxprt',",
        "  'data',",
        ');',
      ].join('\n'),
    );
    const { matches } = scanFileAst(filePath, dir, emptyAllowlist);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(
      matches.some((m) => m.patternId === 'ast-homedir-dotllxprt-join'),
    ).toBe(true);
  });

  it('detects template literal: `${homedir()}/.llxprt`', () => {
    const filePath = writeFile(
      dir,
      'template.ts',
      [
        "import { homedir } from 'node:os';",
        'export const dir = `${homedir()}/.llxprt/settings.json`;',
      ].join('\n'),
    );
    const { matches } = scanFileAst(filePath, dir, emptyAllowlist);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(
      matches.some((m) => m.patternId === 'ast-homedir-template-dotllxprt'),
    ).toBe(true);
  });

  it('detects binary concatenation: homedir() + "/.llxprt"', () => {
    const filePath = writeFile(
      dir,
      'concat.ts',
      [
        "import { homedir } from 'node:os';",
        "export const dir = homedir() + '/.llxprt/data';",
      ].join('\n'),
    );
    const { matches } = scanFileAst(filePath, dir, emptyAllowlist);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(
      matches.some((m) => m.patternId === 'ast-homedir-concat-dotllxprt'),
    ).toBe(true);
  });

  it('does NOT flag workspace-relative .llxprt (not home-anchored)', () => {
    const filePath = writeFile(
      dir,
      'workspace.ts',
      [
        "import path from 'node:path';",
        "export const settings = path.join(workspaceDir, '.llxprt', 'settings.json');",
      ].join('\n'),
    );
    const { matches } = scanFileAst(filePath, dir, emptyAllowlist);
    expect(matches.length).toBe(0);
  });

  it('does NOT flag homedir() joined with non-.llxprt paths', () => {
    const filePath = writeFile(
      dir,
      'gemini.ts',
      [
        "import path from 'node:path';",
        "import os from 'node:os';",
        "export const root = path.join(os.homedir(), '.gemini', 'extensions');",
      ].join('\n'),
    );
    const { matches } = scanFileAst(filePath, dir, emptyAllowlist);
    expect(matches.length).toBe(0);
  });

  it('respects allowlist suppressions (pattern-based)', () => {
    const filePath = writeFile(
      dir,
      'packages/storage/src/config/storage.ts',
      [
        "import path from 'node:path';",
        "import os from 'node:os';",
        "const LLXPRT_DIR = '.llxprt';",
        'export const legacyDir = path.join(os.homedir(), LLXPRT_DIR);',
      ].join('\n'),
    );
    const allowlist: CompiledAllowlist = new Map([
      [
        'packages/storage/src/config/storage.ts',
        [
          {
            patterns: [/LLXPRT_DIR|\.llxprt/],
            reason:
              'Storage is the single canonical authority for legacy paths',
          },
        ],
      ],
    ]);
    const { matches, suppressed } = scanFileAst(filePath, dir, allowlist);
    expect(matches.length).toBe(0);
    expect(suppressed.length).toBeGreaterThanOrEqual(1);
  });

  it('respects allowlist suppressions (whole-file)', () => {
    const filePath = writeFile(
      dir,
      'allowlisted.ts',
      [
        "import path from 'node:path';",
        "import os from 'node:os';",
        "export const dir = path.join(os.homedir(), '.llxprt', 'data');",
      ].join('\n'),
    );
    const allowlist: CompiledAllowlist = new Map([
      ['allowlisted.ts', [{ patterns: [], reason: 'Intentional reference' }]],
    ]);
    const { matches, suppressed } = scanFileAst(filePath, dir, allowlist);
    expect(matches.length).toBe(0);
    expect(suppressed.length).toBeGreaterThanOrEqual(1);
  });
});
