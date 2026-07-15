/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for exact-case uninstall identity.
 *
 * Finding 2: Uninstall must match by exact case-sensitive name/source/registration
 * first. Case-insensitive fallback only if there is exactly one unambiguous match.
 * If multiple case-variant registrations exist in the same root, uninstall must
 * error (no delete) rather than guessing.
 *
 * Tests cover:
 * - Exact-case name match is found first and removed
 * - Reverse-case (query "myext", registration "MyExt") does NOT match exactly,
 *   only falls back if unambiguous
 * - Ambiguous same-root case variants produce an error, no deletion
 * - Case-sensitive source paths match exactly
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LLXPRT_CONFIG_DIR } from '@vybestack/llxprt-code-core';

vi.mock('os', async (importOriginal) => {
  const mockedOs = await importOriginal<typeof os>();
  return {
    ...mockedOs,
    homedir: vi.fn(),
  };
});

const { uninstallExtension, EXTENSIONS_CONFIG_FILENAME } = await import(
  '../extension.js'
);

const LLXPRT_EXT_SUBDIR = path.join(LLXPRT_CONFIG_DIR, 'extensions');
const COMPAT_EXT_SUBDIR = '.gemini/extensions';

describe('exact-case uninstall identity', () => {
  let tempHomeDir: string;
  let tempWorkspaceDir: string;
  let llxprtExtensionsDir: string;
  let compatExtensionsDir: string;

  beforeEach(() => {
    tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uninstall-id-home-'));
    tempWorkspaceDir = fs.mkdtempSync(
      path.join(tempHomeDir, 'uninstall-id-ws-'),
    );
    llxprtExtensionsDir = path.join(tempHomeDir, LLXPRT_EXT_SUBDIR);
    compatExtensionsDir = path.join(tempHomeDir, COMPAT_EXT_SUBDIR);
    fs.mkdirSync(llxprtExtensionsDir, { recursive: true });
    fs.mkdirSync(compatExtensionsDir, { recursive: true });
    vi.mocked(os.homedir).mockReturnValue(tempHomeDir);
    vi.spyOn(process, 'cwd').mockReturnValue(tempWorkspaceDir);
  });

  afterEach(() => {
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
    fs.rmSync(tempWorkspaceDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('exact-case name match is found and removed (cross-root, no ambiguity)', async () => {
    const dir = path.join(llxprtExtensionsDir, 'MyExt');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, EXTENSIONS_CONFIG_FILENAME),
      JSON.stringify({ name: 'MyExt', version: '1.0.0' }),
    );

    await uninstallExtension('MyExt', false, tempWorkspaceDir);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('reverse-case query (myext vs registration MyExt) does NOT exact-match, falls back if unambiguous', async () => {
    const dir = path.join(llxprtExtensionsDir, 'MyExt');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, EXTENSIONS_CONFIG_FILENAME),
      JSON.stringify({ name: 'MyExt', version: '1.0.0' }),
    );

    // Query "myext" — no exact match for "myext" exists, only "MyExt".
    // Case-insensitive fallback: one unambiguous match → should remove.
    await uninstallExtension('myext', false, tempWorkspaceDir);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('ambiguous cross-root case variants: exact-case query removes only the matching root, not the other', async () => {
    // On case-insensitive filesystems, same-directory case variants are the
    // same file. So we use different roots to test cross-root ambiguity.
    const primaryDir = path.join(llxprtExtensionsDir, 'MyExt');
    fs.mkdirSync(primaryDir, { recursive: true });
    fs.writeFileSync(
      path.join(primaryDir, EXTENSIONS_CONFIG_FILENAME),
      JSON.stringify({ name: 'MyExt', version: '1.0.0' }),
    );

    const compatDir = path.join(compatExtensionsDir, 'MyExt');
    fs.mkdirSync(compatDir, { recursive: true });
    fs.writeFileSync(
      path.join(compatDir, 'gemini-extension.json'),
      JSON.stringify({ name: 'MyExt', version: '1.0.0' }),
    );

    // Uninstall "MyExt" — exact match found in llxprt root (precedence).
    // The compat registration should NOT be removed.
    await uninstallExtension('MyExt', false, tempWorkspaceDir);
    expect(fs.existsSync(primaryDir)).toBe(false);
    expect(fs.existsSync(compatDir)).toBe(true);
  });

  it('ambiguous cross-root case-insensitive fallback: query with no exact match and multiple CI matches errors', async () => {
    // Two registrations in different roots with different case
    const primaryDir = path.join(llxprtExtensionsDir, 'MyExt');
    fs.mkdirSync(primaryDir, { recursive: true });
    fs.writeFileSync(
      path.join(primaryDir, EXTENSIONS_CONFIG_FILENAME),
      JSON.stringify({ name: 'MyExt', version: '1.0.0' }),
    );

    const compatDir = path.join(compatExtensionsDir, 'MYEXT');
    fs.mkdirSync(compatDir, { recursive: true });
    fs.writeFileSync(
      path.join(compatDir, 'gemini-extension.json'),
      JSON.stringify({ name: 'MYEXT', version: '1.0.0' }),
    );

    // Query "myext" — no exact match, two case-insensitive matches (MyExt + MYEXT)
    // → ambiguous error, no deletion
    await expect(
      uninstallExtension('myext', false, tempWorkspaceDir),
    ).rejects.toThrow(/ambiguous|multiple/i);

    expect(fs.existsSync(primaryDir)).toBe(true);
    expect(fs.existsSync(compatDir)).toBe(true);
  });

  it('rejects ambiguous case variants registered in the same root', async () => {
    const firstDir = path.join(llxprtExtensionsDir, 'first-registration');
    fs.mkdirSync(firstDir, { recursive: true });
    fs.writeFileSync(
      path.join(firstDir, EXTENSIONS_CONFIG_FILENAME),
      JSON.stringify({ name: 'MyExt', version: '1.0.0' }),
    );

    const secondDir = path.join(llxprtExtensionsDir, 'second-registration');
    fs.mkdirSync(secondDir, { recursive: true });
    fs.writeFileSync(
      path.join(secondDir, EXTENSIONS_CONFIG_FILENAME),
      JSON.stringify({ name: 'MYEXT', version: '1.0.0' }),
    );

    await expect(
      uninstallExtension('myext', false, tempWorkspaceDir),
    ).rejects.toThrow(/ambiguous/i);
    expect(fs.existsSync(firstDir)).toBe(true);
    expect(fs.existsSync(secondDir)).toBe(true);
  });

  it('exact-case source path match removes only the matching registration', async () => {
    const sourceA = '/exact/path/to/source-a';
    const sourceB = '/exact/path/to/source-b';

    const dirA = path.join(llxprtExtensionsDir, 'ext-a');
    fs.mkdirSync(dirA, { recursive: true });
    fs.writeFileSync(
      path.join(dirA, EXTENSIONS_CONFIG_FILENAME),
      JSON.stringify({ name: 'ext-a', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(dirA, '.llxprt-extension-install.json'),
      JSON.stringify({ source: sourceA, type: 'local' }),
    );

    const dirB = path.join(llxprtExtensionsDir, 'ext-b');
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(
      path.join(dirB, EXTENSIONS_CONFIG_FILENAME),
      JSON.stringify({ name: 'ext-b', version: '1.0.0' }),
    );
    fs.writeFileSync(
      path.join(dirB, '.llxprt-extension-install.json'),
      JSON.stringify({ source: sourceB, type: 'local' }),
    );

    await uninstallExtension(sourceA, false, tempWorkspaceDir);
    expect(fs.existsSync(dirA)).toBe(false);
    expect(fs.existsSync(dirB)).toBe(true);
  });
});
