/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Filesystem-backed behavior tests for the A2A extension loader.
 *
 * These tests exercise the real `loadExtensions` against temp directories
 * containing real manifest and metadata files. No mocks of the loader itself —
 * only real filesystem I/O against throwaway directories. The injected
 * `homeDir` option isolates user-level extension scanning from workspace-level
 * tests (production dependency injection instead of `node:os` module mocking —
 * No `vi.mock('node:os')` is used, making these tests
 * compatible with BOTH Bun and Vitest.
 *
 * Contract verified (analogous to the CLI loader):
 * - llxprt-extension.json takes precedence over gemini-extension.json.
 * - gemini-extension.json is loaded when it is the only manifest present.
 * - Fallback manifest hooks, mcpServers, and context fields are carried to
 *   LlxprtExtension.
 * - Install metadata prefers .llxprt-extension-install.json then falls back
 *   to .gemini-extension-install.json.
 * - Malformed fallback manifests produce diagnostics naming gemini-extension.json.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const loggerErrorSpy = vi.fn();
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: loggerErrorSpy,
    warn: vi.fn(),
  },
}));

const {
  loadExtensions,
  EXTENSIONS_DIRECTORY_NAME,
  COMPAT_EXTENSIONS_DIRECTORY_NAME,
  EXTENSIONS_CONFIG_FILENAME,
  EXTENSIONS_CONFIG_FILENAME_FALLBACK,
  INSTALL_METADATA_FILENAME,
  INSTALL_METADATA_FILENAME_FALLBACK,
} = await import('./extension.js');

// Env keys that redirect Storage category dirs so user-scope extensions land
// under the temp fake home instead of the real user filesystem. The canonical
// user extensions dir is <LLXPRT_DATA_HOME>/extensions.
const ENV_KEYS = ['LLXPRT_DATA_HOME', 'LLXPRT_CONFIG_HOME'] as const;
const SAVED_ENV: Record<string, string | undefined> = {};

interface Harness {
  workspaceDir: string;
  extensionsDir: string;
}

function createHarness(): Harness {
  const workspaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'a2a-ext-test-ws-'),
  );
  const extensionsDir = path.join(workspaceDir, EXTENSIONS_DIRECTORY_NAME);
  fs.mkdirSync(extensionsDir, { recursive: true });
  return { workspaceDir, extensionsDir };
}

function writeExtensionFile(
  extensionsDir: string,
  extName: string,
  fileName: string,
  body: unknown,
): void {
  const extDir = path.join(extensionsDir, extName);
  fs.mkdirSync(extDir, { recursive: true });
  fs.writeFileSync(
    path.join(extDir, fileName),
    typeof body === 'string' ? body : JSON.stringify(body),
  );
}

/**
 * Create a real CLI link-layout extension: manifest (and optional context
 * file) in `sourceDir`, and only the install metadata file in the
 * registration directory. Returns both paths.
 */
function writeLinkExtension(
  extensionsDir: string,
  regName: string,
  sourceBaseDir: string,
  manifest: { name: string; version: string; contextFileName?: string },
  contextBody?: string,
  useFallbackMetadata = false,
): { regDir: string; sourceDir: string } {
  const sourceDir = path.join(sourceBaseDir, `${regName}-source`);
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, EXTENSIONS_CONFIG_FILENAME),
    JSON.stringify(manifest),
  );
  if (contextBody !== undefined && manifest.contextFileName !== undefined) {
    fs.writeFileSync(
      path.join(sourceDir, manifest.contextFileName),
      contextBody,
    );
  }
  const regDir = path.join(extensionsDir, regName);
  fs.mkdirSync(regDir, { recursive: true });
  fs.writeFileSync(
    path.join(
      regDir,
      useFallbackMetadata
        ? INSTALL_METADATA_FILENAME_FALLBACK
        : INSTALL_METADATA_FILENAME,
    ),
    JSON.stringify({ source: sourceDir, type: 'link' }),
  );
  return { regDir, sourceDir };
}

describe('A2A extension loader', () => {
  let harness: Harness;
  let fakeHome: string;

  beforeEach(() => {
    harness = createHarness();
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-ext-test-home-'));
    // Redirect the canonical Storage data dir to the fake home so user-scope
    // extensions resolve under <fakeHome>/extensions.
    for (const key of ENV_KEYS) {
      SAVED_ENV[key] = process.env[key];
      process.env[key] = fakeHome;
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (SAVED_ENV[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = SAVED_ENV[key];
      }
    }
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(harness.workspaceDir, { recursive: true, force: true });
  });
  // ---- Finding 1: hook validation without casts ----

  describe('hook validation rejects malformed hooks', () => {
    it('skips extension with invalid hook event name', () => {
      loggerErrorSpy.mockClear();

      writeExtensionFile(
        harness.extensionsDir,
        'bad-event',
        EXTENSIONS_CONFIG_FILENAME,
        {
          name: 'bad-event',
          version: '1.0.0',
          hooks: {
            InvalidEvent: [
              {
                hooks: [{ type: 'command', command: 'echo' }],
              },
            ],
          },
        },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions.some((e) => e.name === 'bad-event')).toBe(false);
    });

    it('skips extension with hooks missing command', () => {
      writeExtensionFile(
        harness.extensionsDir,
        'no-cmd',
        EXTENSIONS_CONFIG_FILENAME,
        {
          name: 'no-cmd',
          version: '1.0.0',
          hooks: {
            BeforeTool: [
              {
                hooks: [{ type: 'command' }],
              },
            ],
          },
        },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions.some((e) => e.name === 'no-cmd')).toBe(false);
    });

    it('loads extension with valid hooks from fallback manifest', () => {
      writeExtensionFile(
        harness.extensionsDir,
        'valid-hooks',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        {
          name: 'valid-hooks',
          version: '1.0.0',
          hooks: {
            BeforeTool: [
              {
                hooks: [{ type: 'command', command: 'lint' }],
              },
            ],
          },
        },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions.some((e) => e.name === 'valid-hooks')).toBe(true);
    });

    it('accepts legacy named hooks without exposing them as executable events', () => {
      writeExtensionFile(
        harness.extensionsDir,
        'legacy-named-hooks',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        {
          name: 'legacy-named-hooks',
          version: '1.0.0',
          hooks: {
            'pre-commit': { command: 'lint', args: ['--fix'] },
          },
        },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      const extension = extensions.find(
        (entry) => entry.name === 'legacy-named-hooks',
      );
      expect(extension).toBeDefined();
      expect(extension?.hooks).toBeUndefined();
    });

    it('rejects mixed modern and legacy hook schemas', () => {
      writeExtensionFile(
        harness.extensionsDir,
        'mixed-hooks',
        EXTENSIONS_CONFIG_FILENAME,
        {
          name: 'mixed-hooks',
          version: '1.0.0',
          hooks: {
            BeforeTool: [
              {
                hooks: [{ type: 'command', command: 'echo modern' }],
              },
            ],
            'pre-commit': { command: 'echo legacy' },
          },
        },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions.some((entry) => entry.name === 'mixed-hooks')).toBe(
        false,
      );
    });
  });

  // ---- metadata-first: real CLI link layout loads from metadata.source ----

  describe('metadata-first link layout: loads from metadata.source', () => {
    it('loads an extension with only primary metadata in reg dir and manifest in link source', () => {
      const { sourceDir } = writeLinkExtension(
        harness.extensionsDir,
        'meta-only',
        fakeHome,
        { name: 'link-src', version: '1.0.0' },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.name).toBe('link-src');
      expect(extensions[0]?.installMetadata?.source).toBe(sourceDir);
      expect(extensions[0]?.path).toBe(sourceDir);
    });

    it('loads an extension with only fallback metadata in reg dir and manifest in link source', () => {
      const { sourceDir } = writeLinkExtension(
        harness.extensionsDir,
        'meta-only-fb',
        fakeHome,
        { name: 'link-src-fb', version: '2.0.0' },
        undefined,
        true,
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.name).toBe('link-src-fb');
      expect(extensions[0]?.installMetadata?.source).toBe(sourceDir);
    });

    it('resolves context files from link source, not registration dir', () => {
      const { sourceDir } = writeLinkExtension(
        harness.extensionsDir,
        'link-ctx',
        fakeHome,
        { name: 'link-ctx', version: '1.0.0', contextFileName: 'CONTEXT.md' },
        '# Source ctx',
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.contextFiles).toContain(
        path.join(sourceDir, 'CONTEXT.md'),
      );
    });
  });

  // ---- Finding 5: malformed fallback metadata distinct from ENOENT ----

  describe('malformed fallback metadata diagnostics', () => {
    it('reports error naming fallback metadata file when it is malformed', () => {
      loggerErrorSpy.mockClear();

      writeExtensionFile(
        harness.extensionsDir,
        'bad-fb-meta',
        EXTENSIONS_CONFIG_FILENAME,
        { name: 'bad-fb-meta', version: '1.0.0' },
      );
      // Write malformed fallback metadata (no primary metadata present)
      fs.writeFileSync(
        path.join(
          harness.extensionsDir,
          'bad-fb-meta',
          INSTALL_METADATA_FILENAME_FALLBACK,
        ),
        '{ "source": broken',
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      // Extension should NOT load — malformed fallback metadata is named and
      // the extension is skipped, distinct from ENOENT (absent) which would
      // return undefined and allow loading.
      expect(extensions).toHaveLength(0);
      expect(
        loggerErrorSpy.mock.calls.some(
          (call) =>
            typeof call[0] === 'string' &&
            call[0].includes(INSTALL_METADATA_FILENAME_FALLBACK),
        ),
      ).toBe(true);
    });

    it('skips a metadata-only registration whose fallback metadata is malformed', () => {
      loggerErrorSpy.mockClear();

      // Registration dir with ONLY malformed fallback metadata — no manifest
      // in the registration dir, manifest would be in metadata.source.
      const extDir = path.join(harness.extensionsDir, 'meta-only-bad-fb');
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(
        path.join(extDir, INSTALL_METADATA_FILENAME_FALLBACK),
        '{ "source": broken',
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      // Malformed fallback metadata must skip the extension, not load it.
      expect(extensions).toHaveLength(0);
      expect(
        loggerErrorSpy.mock.calls.some(
          (call) =>
            typeof call[0] === 'string' &&
            call[0].includes(INSTALL_METADATA_FILENAME_FALLBACK),
        ),
      ).toBe(true);
    });
  });

  // ---- Finding 9: safe per-entry stat, broken-link continue ----

  describe('safe per-entry stat and broken symlink handling', () => {
    it('continues scanning when a broken symlink is encountered', () => {
      // Create a valid extension
      writeExtensionFile(
        harness.extensionsDir,
        'valid-ext',
        EXTENSIONS_CONFIG_FILENAME,
        { name: 'valid-ext', version: '1.0.0' },
      );

      // Create a broken symlink in the extensions dir
      const brokenLink = path.join(harness.extensionsDir, 'broken-link');
      fs.symlinkSync(
        path.join(harness.extensionsDir, 'nonexistent-target'),
        brokenLink,
        'dir',
      );

      loggerErrorSpy.mockClear();

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      // The valid extension should still load despite the broken symlink
      expect(extensions.some((e) => e.name === 'valid-ext')).toBe(true);
      // A diagnostic should be logged for the broken symlink
      expect(
        loggerErrorSpy.mock.calls.some(
          (call) =>
            typeof call[0] === 'string' && call[0].includes('broken-link'),
        ),
      ).toBe(true);
    });

    it('does not crash when extensions dir contains a non-directory entry', () => {
      // Create a valid extension
      writeExtensionFile(
        harness.extensionsDir,
        'valid-ext2',
        EXTENSIONS_CONFIG_FILENAME,
        { name: 'valid-ext2', version: '1.0.0' },
      );

      // Create a regular file entry (not a directory)
      fs.writeFileSync(
        path.join(harness.extensionsDir, 'stray-file.txt'),
        'not a directory',
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions.some((e) => e.name === 'valid-ext2')).toBe(true);
    });
  });

  // ---- Finding 4: secure context paths (relative-only realpath containment) ----

  describe('secure context paths reject traversal/absolute/sibling/symlink escape', () => {
    it('rejects contextFileName with parent traversal', () => {
      const extDir = path.join(harness.extensionsDir, 'traversal-ext');
      fs.mkdirSync(extDir, { recursive: true });
      // Create the target file outside the extension dir
      fs.writeFileSync(
        path.join(harness.extensionsDir, 'secret.txt'),
        'SECRET',
      );
      fs.writeFileSync(
        path.join(extDir, EXTENSIONS_CONFIG_FILENAME),
        JSON.stringify({
          name: 'traversal-ext',
          version: '1.0.0',
          contextFileName: '../secret.txt',
        }),
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.name).toBe('traversal-ext');
      // The context file must NOT be included — it escapes the extension dir
      expect(extensions[0]?.contextFiles).toHaveLength(0);
    });

    it('rejects absolute path contextFileName', () => {
      const absFile = path.join(fakeHome, 'absolute-target.md');
      fs.writeFileSync(absFile, '# absolute');

      const extDir = path.join(harness.extensionsDir, 'absolute-ext');
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(
        path.join(extDir, EXTENSIONS_CONFIG_FILENAME),
        JSON.stringify({
          name: 'absolute-ext',
          version: '1.0.0',
          contextFileName: absFile,
        }),
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.contextFiles).toHaveLength(0);
    });

    it('allows nested relative contextFileName within extension dir', () => {
      const extDir = path.join(harness.extensionsDir, 'nested-ext');
      fs.mkdirSync(extDir, { recursive: true });
      fs.mkdirSync(path.join(extDir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(extDir, 'docs', 'context.md'), '# nested');
      fs.writeFileSync(
        path.join(extDir, EXTENSIONS_CONFIG_FILENAME),
        JSON.stringify({
          name: 'nested-ext',
          version: '1.0.0',
          contextFileName: 'docs/context.md',
        }),
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.contextFiles).toContain(
        path.join(extDir, 'docs', 'context.md'),
      );
    });

    it('allows current-directory relative contextFileName', () => {
      const extDir = path.join(harness.extensionsDir, 'dot-ext');
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(path.join(extDir, 'context.md'), '# local');
      fs.writeFileSync(
        path.join(extDir, EXTENSIONS_CONFIG_FILENAME),
        JSON.stringify({
          name: 'dot-ext',
          version: '1.0.0',
          contextFileName: './context.md',
        }),
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.contextFiles).toContain(
        path.join(extDir, 'context.md'),
      );
    });
  });

  // ---- Finding 6: root enumeration errors continue to next root ----

  describe('root enumeration errors continue to next root', () => {
    it('continues loading from the compat root when the canonical user root is unreadable', () => {
      // The canonical user extensions root is Storage.getUserExtensionsDir()
      // (<LLXPRT_DATA_HOME>/extensions). Make it unreadable by creating a
      // regular file at that path so fs.readdirSync throws — the loader must
      // continue to the .gemini/extensions compatibility root.
      const userRoot = path.join(fakeHome, 'extensions');
      fs.writeFileSync(userRoot, 'not a directory');

      // Put a valid extension in the compat root
      const compatRoot = path.join(fakeHome, COMPAT_EXTENSIONS_DIRECTORY_NAME);
      fs.mkdirSync(compatRoot, { recursive: true });
      writeExtensionFile(
        compatRoot,
        'compat-ext',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        { name: 'compat-ext', version: '1.0.0' },
      );

      loggerErrorSpy.mockClear();
      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      // The compat extension should still load despite the user root error
      expect(extensions.some((e) => e.name === 'compat-ext')).toBe(true);
      // A diagnostic should be logged for the unreadable root
      expect(
        loggerErrorSpy.mock.calls.some(
          (call) =>
            typeof call[0] === 'string' &&
            call[0].includes('could not enumerate'),
        ),
      ).toBe(true);

      // Cleanup
      fs.rmSync(userRoot, { force: true });
    });
  });
});
