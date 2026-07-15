/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Public discovery tests proving that the CLI extension loader discovers
 * extensions from `.gemini/extensions` roots alongside `.llxprt/extensions`,
 * with LLxprt-first deterministic precedence and deduplication by extension
 * name.
 *
 * These tests exercise the real `loadExtensionsFromDir` against temp
 * directories containing real manifest files in both `.llxprt/extensions` and
 * `.gemini/extensions` subdirectories. No mocks of the loader itself.
 *
 * Contract verified:
 * - Extensions in `.gemini/extensions` are discovered.
 * - Fallback manifests (gemini-extension.json) there carry commands (MCP),
 *   context, and hooks.
 * - When an extension exists in both roots, the LLxprt one wins (precedence).
 * - Deduplication is by extension name.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadExtensionsFromDir,
  EXTENSIONS_CONFIG_FILENAME,
  EXTENSIONS_CONFIG_FILENAME_FALLBACK,
  COMPAT_EXTENSIONS_DIRECTORY_NAME,
} from './extension.js';
import { LLXPRT_CONFIG_DIR } from '@vybestack/llxprt-code-core';

const LLXPRT_EXT_DIR = path.join(LLXPRT_CONFIG_DIR, 'extensions');

function writeManifest(
  rootDir: string,
  relExtDir: string,
  fileName: string,
  body: unknown,
): string {
  const extDir = path.join(rootDir, relExtDir);
  fs.mkdirSync(extDir, { recursive: true });
  fs.writeFileSync(path.join(extDir, fileName), JSON.stringify(body));
  return extDir;
}

describe('CLI .gemini/extensions discovery', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-gemini-disc-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('gemini/extensions fallback discovery', () => {
    it('discovers an extension in .gemini/extensions with gemini-extension.json', () => {
      const compatRoot = path.join(tempRoot, COMPAT_EXTENSIONS_DIRECTORY_NAME);
      writeManifest(
        compatRoot,
        'legacy-ext',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        { name: 'legacy-ext', version: '1.0.0' },
      );

      const extensions = loadExtensionsFromDir(tempRoot);
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.name).toBe('legacy-ext');
      expect(extensions[0]?.version).toBe('1.0.0');
    });

    it('discovers MCP servers from .gemini/extensions fallback manifest', () => {
      const compatRoot = path.join(tempRoot, COMPAT_EXTENSIONS_DIRECTORY_NAME);
      writeManifest(
        compatRoot,
        'mcp-ext',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        {
          name: 'mcp-ext',
          version: '1.0.0',
          mcpServers: {
            'legacy-server': { command: 'python', args: ['server.py'] },
          },
        },
      );

      const extensions = loadExtensionsFromDir(tempRoot);
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.mcpServers).toHaveProperty('legacy-server');
    });

    it('discovers contextFileName from .gemini/extensions fallback manifest', () => {
      const compatRoot = path.join(tempRoot, COMPAT_EXTENSIONS_DIRECTORY_NAME);
      const extDir = writeManifest(
        compatRoot,
        'ctx-ext',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        {
          name: 'ctx-ext',
          version: '1.0.0',
          contextFileName: 'GEMINI.md',
        },
      );
      fs.writeFileSync(path.join(extDir, 'GEMINI.md'), '# Legacy context');

      const extensions = loadExtensionsFromDir(tempRoot);
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.contextFiles).toContain(
        path.join(extDir, 'GEMINI.md'),
      );
    });

    it('discovers GEMINI.md context file when contextFileName is omitted (dual default)', () => {
      const compatRoot = path.join(tempRoot, COMPAT_EXTENSIONS_DIRECTORY_NAME);
      const extDir = writeManifest(
        compatRoot,
        'default-ctx-ext',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        {
          name: 'default-ctx-ext',
          version: '1.0.0',
          // contextFileName intentionally omitted
        },
      );
      fs.writeFileSync(path.join(extDir, 'GEMINI.md'), '# Legacy context');

      const extensions = loadExtensionsFromDir(tempRoot);
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.contextFiles).toContain(
        path.join(extDir, 'GEMINI.md'),
      );
    });

    it('discovers hooks from .gemini/extensions fallback manifest', () => {
      const compatRoot = path.join(tempRoot, COMPAT_EXTENSIONS_DIRECTORY_NAME);
      writeManifest(
        compatRoot,
        'hook-ext',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        {
          name: 'hook-ext',
          version: '1.0.0',
          hooks: {
            BeforeTool: [
              {
                hooks: [{ type: 'command', command: 'echo lint' }],
              },
            ],
          },
        },
      );

      const extensions = loadExtensionsFromDir(tempRoot);
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.hooks).toBeDefined();
      expect(extensions[0]?.hooks).toHaveProperty('BeforeTool');
    });
  });

  describe('LLxprt-first precedence and deduplication', () => {
    it('places .llxprt/extensions before .gemini/extensions for caller dedup', () => {
      const llxprtRoot = path.join(tempRoot, LLXPRT_EXT_DIR);
      const compatRoot = path.join(tempRoot, COMPAT_EXTENSIONS_DIRECTORY_NAME);

      writeManifest(llxprtRoot, 'shared', EXTENSIONS_CONFIG_FILENAME, {
        name: 'shared',
        version: '2.0.0',
      });
      writeManifest(compatRoot, 'shared', EXTENSIONS_CONFIG_FILENAME_FALLBACK, {
        name: 'shared',
        version: '1.0.0',
      });

      const extensions = loadExtensionsFromDir(tempRoot);
      // Both are returned; LLxprt-first ordering ensures caller dedup picks it.
      expect(extensions).toHaveLength(2);
      expect(extensions[0]?.version).toBe('2.0.0');
      expect(extensions[1]?.version).toBe('1.0.0');
    });

    it('returns distinct extensions from both roots', () => {
      const llxprtRoot = path.join(tempRoot, LLXPRT_EXT_DIR);
      const compatRoot = path.join(tempRoot, COMPAT_EXTENSIONS_DIRECTORY_NAME);

      writeManifest(llxprtRoot, 'ext-a', EXTENSIONS_CONFIG_FILENAME, {
        name: 'ext-a',
        version: '1.0.0',
      });
      writeManifest(compatRoot, 'ext-b', EXTENSIONS_CONFIG_FILENAME_FALLBACK, {
        name: 'ext-b',
        version: '1.0.0',
      });

      const extensions = loadExtensionsFromDir(tempRoot);
      expect(extensions).toHaveLength(2);
      const names = extensions.map((e) => e.name).sort();
      expect(names).toStrictEqual(['ext-a', 'ext-b']);
    });

    it('returns only .gemini/extensions when .llxprt/extensions is absent', () => {
      const compatRoot = path.join(tempRoot, COMPAT_EXTENSIONS_DIRECTORY_NAME);
      writeManifest(
        compatRoot,
        'only-gemini',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        { name: 'only-gemini', version: '0.9.0' },
      );

      const extensions = loadExtensionsFromDir(tempRoot);
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.name).toBe('only-gemini');
    });

    it('returns only .llxprt/extensions when .gemini/extensions is absent', () => {
      const llxprtRoot = path.join(tempRoot, LLXPRT_EXT_DIR);
      writeManifest(llxprtRoot, 'only-llxprt', EXTENSIONS_CONFIG_FILENAME, {
        name: 'only-llxprt',
        version: '3.0.0',
      });

      const extensions = loadExtensionsFromDir(tempRoot);
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.name).toBe('only-llxprt');
    });

    it('returns empty when neither root exists', () => {
      const extensions = loadExtensionsFromDir(tempRoot);
      expect(extensions).toHaveLength(0);
    });
  });

  describe('root enumeration failure handling', () => {
    it('continues loading from compat root when llxprt root is unreadable', () => {
      // Make the llxprt extensions root unreadable by placing a file where a
      // directory is expected — readdirSync will throw on it.
      const llxprtRoot = path.join(tempRoot, LLXPRT_EXT_DIR);
      fs.mkdirSync(path.dirname(llxprtRoot), { recursive: true });
      fs.writeFileSync(llxprtRoot, 'not a directory');

      // Put a valid extension in the compat root
      const compatRoot = path.join(tempRoot, COMPAT_EXTENSIONS_DIRECTORY_NAME);
      writeManifest(
        compatRoot,
        'compat-ext',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        { name: 'compat-ext', version: '1.0.0' },
      );

      const extensions = loadExtensionsFromDir(tempRoot);
      // The compat extension should still load despite the llxprt root error
      expect(extensions.some((e) => e.name === 'compat-ext')).toBe(true);

      // Cleanup: remove the file so afterEach rmSync works
      fs.rmSync(llxprtRoot, { force: true });
    });
  });
});
