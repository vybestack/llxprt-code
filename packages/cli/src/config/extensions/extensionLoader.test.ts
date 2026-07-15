/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the extension manifest dual-manifest precedence and
 * fallback-only loading paths.
 *
 * These tests exercise the real `loadExtensionFromDir` against temp directories
 * containing real manifest files. No mocks of the loader itself — only real
 * filesystem I/O against throwaway directories.
 *
 * Contract verified:
 * - When both the primary (`llxprt-extension.json`) and the fallback
 *   (`gemini-extension.json`) manifests exist, the primary wins (precedence).
 * - When only the fallback manifest exists, it is loaded (fallback-only).
 * - When neither manifest exists, the extension is skipped with a warning.
 * - Fallback manifest hooks, mcpServers, and context fields are carried to
 *   LlxprtExtension so HookRegistry can register them.
 * - Install metadata prefers `.llxprt-extension-install.json` then falls back
 *   to `.gemini-extension-install.json`.
 * - Malformed fallback manifests produce diagnostics naming `gemini-extension.json`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadExtensionFromDir,
  loadInstallMetadataFromDir,
} from './extensionLoader.js';
import type { LoadExtensionContext } from './variableSchema.js';

const PRIMARY_MANIFEST = 'llxprt-extension.json';
const FALLBACK_MANIFEST = 'gemini-extension.json';
const PRIMARY_METADATA = '.llxprt-extension-install.json';
const FALLBACK_METADATA = '.gemini-extension-install.json';

interface WarningCollector {
  warnings: string[];
  errors: string[];
}

function makeDeps(collector: WarningCollector) {
  return {
    configFileName: PRIMARY_MANIFEST,
    fallbackConfigFileName: FALLBACK_MANIFEST,
    installMetadataFileName: PRIMARY_METADATA,
    fallbackInstallMetadataFileName: FALLBACK_METADATA,
    loadSettings: () => ({ merged: {} }),
    validateName: () => {},
    reportError: (message: string) => collector.errors.push(message),
    reportWarning: (message: string) => collector.warnings.push(message),
  };
}

function writeManifest(dir: string, fileName: string, body: unknown): void {
  fs.writeFileSync(path.join(dir, fileName), JSON.stringify(body));
}

function makeContext(dir: string): LoadExtensionContext {
  return { extensionDir: dir, workspaceDir: dir };
}

describe('extensionLoader manifest precedence and fallback', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-ext-loader-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('dual-manifest precedence (primary wins)', () => {
    it('loads the primary manifest when both primary and fallback exist', () => {
      const extDir = path.join(tempRoot, 'dual-ext');
      fs.mkdirSync(extDir, { recursive: true });

      writeManifest(extDir, PRIMARY_MANIFEST, {
        name: 'primary-ext',
        version: '2.0.0',
      });
      writeManifest(extDir, FALLBACK_MANIFEST, {
        name: 'fallback-ext',
        version: '1.0.0',
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      expect(result?.name).toBe('primary-ext');
      expect(result?.version).toBe('2.0.0');
      expect(collector.warnings).toHaveLength(0);
      expect(collector.errors).toHaveLength(0);
    });

    it('primary manifest mcpServers take precedence over fallback', () => {
      const extDir = path.join(tempRoot, 'dual-mcp-ext');
      fs.mkdirSync(extDir, { recursive: true });

      writeManifest(extDir, PRIMARY_MANIFEST, {
        name: 'dual-mcp',
        version: '1.0.0',
        mcpServers: {
          'primary-server': { command: 'node', args: ['primary.js'] },
        },
      });
      writeManifest(extDir, FALLBACK_MANIFEST, {
        name: 'dual-mcp',
        version: '1.0.0',
        mcpServers: {
          'fallback-server': { command: 'node', args: ['fallback.js'] },
        },
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      expect(result?.mcpServers).toBeDefined();
      expect(result?.mcpServers).toHaveProperty('primary-server');
      expect(result?.mcpServers).not.toHaveProperty('fallback-server');
    });
  });

  describe('fallback-only (legacy gemini-extension.json)', () => {
    it('loads the fallback manifest when only it exists', () => {
      const extDir = path.join(tempRoot, 'fallback-only-ext');
      fs.mkdirSync(extDir, { recursive: true });

      writeManifest(extDir, FALLBACK_MANIFEST, {
        name: 'legacy-ext',
        version: '0.9.0',
        mcpServers: {
          'legacy-server': { command: 'python', args: ['server.py'] },
        },
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      expect(result?.name).toBe('legacy-ext');
      expect(result?.version).toBe('0.9.0');
      expect(result?.mcpServers).toBeDefined();
      expect(result?.mcpServers).toHaveProperty('legacy-server');
      expect(collector.warnings).toHaveLength(0);
      expect(collector.errors).toHaveLength(0);
    });

    it('fallback manifest contextFileName is honored', () => {
      const extDir = path.join(tempRoot, 'fallback-context-ext');
      fs.mkdirSync(extDir, { recursive: true });

      const contextFileName = 'GEMINI.md';
      // Write the context file so it is picked up.
      fs.writeFileSync(path.join(extDir, contextFileName), '# Legacy context');

      writeManifest(extDir, FALLBACK_MANIFEST, {
        name: 'legacy-context',
        version: '1.0.0',
        contextFileName,
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      expect(result?.contextFiles).toContain(
        path.join(extDir, contextFileName),
      );
    });

    it('recognizes GEMINI.md as default context when contextFileName is omitted (dual defaults)', () => {
      const extDir = path.join(tempRoot, 'fallback-omitted-context-ext');
      fs.mkdirSync(extDir, { recursive: true });

      // Write a GEMINI.md so it is picked up by the dual-default lookup.
      fs.writeFileSync(path.join(extDir, 'GEMINI.md'), '# Legacy context');

      writeManifest(extDir, FALLBACK_MANIFEST, {
        name: 'legacy-omitted-context',
        version: '1.0.0',
        // contextFileName intentionally omitted — must fall back to dual defaults
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      expect(result?.contextFiles).toContain(path.join(extDir, 'GEMINI.md'));
    });

    it('recognizes LLXPRT.md as default context when contextFileName is omitted (dual defaults)', () => {
      const extDir = path.join(tempRoot, 'primary-omitted-context-ext');
      fs.mkdirSync(extDir, { recursive: true });

      fs.writeFileSync(path.join(extDir, 'LLXPRT.md'), '# LLxprt context');

      writeManifest(extDir, PRIMARY_MANIFEST, {
        name: 'modern-omitted-context',
        version: '1.0.0',
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      expect(result?.contextFiles).toContain(path.join(extDir, 'LLXPRT.md'));
    });

    it('picks up both LLXPRT.md and GEMINI.md when contextFileName is omitted and both exist', () => {
      const extDir = path.join(tempRoot, 'dual-omitted-context-ext');
      fs.mkdirSync(extDir, { recursive: true });

      fs.writeFileSync(path.join(extDir, 'LLXPRT.md'), '# LLxprt context');
      fs.writeFileSync(path.join(extDir, 'GEMINI.md'), '# Legacy context');

      writeManifest(extDir, FALLBACK_MANIFEST, {
        name: 'dual-omitted-context',
        version: '1.0.0',
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      expect(result?.contextFiles).toContain(path.join(extDir, 'LLXPRT.md'));
      expect(result?.contextFiles).toContain(path.join(extDir, 'GEMINI.md'));
    });

    it('fallback manifest hooks are carried to LlxprtExtension', () => {
      const extDir = path.join(tempRoot, 'fallback-hooks-ext');
      fs.mkdirSync(extDir, { recursive: true });

      writeManifest(extDir, FALLBACK_MANIFEST, {
        name: 'legacy-hooks',
        version: '1.0.0',
        hooks: {
          BeforeTool: [
            {
              hooks: [{ type: 'command', command: 'lint' }],
            },
          ],
        },
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      expect(result?.hooks).toBeDefined();
      expect(result?.hooks).toHaveProperty('BeforeTool');
    });
  });

  describe('no manifest present', () => {
    it('returns null and warns when neither manifest exists', () => {
      const extDir = path.join(tempRoot, 'empty-ext');
      fs.mkdirSync(extDir, { recursive: true });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).toBeNull();
      expect(collector.warnings).toHaveLength(1);
      expect(collector.warnings[0]).toContain(PRIMARY_MANIFEST);
      expect(collector.warnings[0]).toContain(FALLBACK_MANIFEST);
    });
  });

  describe('single primary manifest', () => {
    it('loads the primary manifest when only it exists', () => {
      const extDir = path.join(tempRoot, 'primary-only-ext');
      fs.mkdirSync(extDir, { recursive: true });

      writeManifest(extDir, PRIMARY_MANIFEST, {
        name: 'modern-ext',
        version: '3.1.0',
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      expect(result?.name).toBe('modern-ext');
      expect(result?.version).toBe('3.1.0');
    });

    it('primary manifest hooks are carried to LlxprtExtension', () => {
      const extDir = path.join(tempRoot, 'primary-hooks-ext');
      fs.mkdirSync(extDir, { recursive: true });

      writeManifest(extDir, PRIMARY_MANIFEST, {
        name: 'modern-hooks',
        version: '1.0.0',
        hooks: {
          BeforeTool: [
            {
              hooks: [{ type: 'command', command: 'lint' }],
            },
          ],
        },
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      expect(result?.hooks).toBeDefined();
      expect(result?.hooks).toHaveProperty('BeforeTool');
    });
  });

  describe('install metadata fallback', () => {
    it('prefers .llxprt-extension-install.json when present', () => {
      const extDir = path.join(tempRoot, 'primary-meta-ext');
      fs.mkdirSync(extDir, { recursive: true });

      writeManifest(extDir, PRIMARY_MANIFEST, {
        name: 'meta-primary',
        version: '1.0.0',
      });
      writeManifest(extDir, PRIMARY_METADATA, {
        source: 'https://primary.example.git',
        type: 'git',
      });
      writeManifest(extDir, FALLBACK_METADATA, {
        source: 'https://fallback.example.git',
        type: 'git',
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      expect(result?.installMetadata?.source).toBe(
        'https://primary.example.git',
      );
    });

    it('falls back to .gemini-extension-install.json when primary is absent', () => {
      const extDir = path.join(tempRoot, 'fallback-meta-ext');
      fs.mkdirSync(extDir, { recursive: true });

      writeManifest(extDir, PRIMARY_MANIFEST, {
        name: 'meta-fallback',
        version: '1.0.0',
      });
      writeManifest(extDir, FALLBACK_METADATA, {
        source: 'https://legacy.example.git',
        type: 'git',
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      expect(result?.installMetadata?.source).toBe(
        'https://legacy.example.git',
      );
    });

    it('falls back when primary metadata disappears before it is read', () => {
      const extDir = path.join(tempRoot, 'racing-primary-meta-ext');
      fs.mkdirSync(extDir, { recursive: true });
      writeManifest(extDir, PRIMARY_METADATA, {
        source: 'https://primary.example.git',
        type: 'git',
      });
      writeManifest(extDir, FALLBACK_METADATA, {
        source: 'https://fallback.example.git',
        type: 'git',
      });
      const primaryPath = path.join(extDir, PRIMARY_METADATA);
      const readTextFile = (filePath: string, encoding: 'utf-8'): string => {
        if (filePath === primaryPath) {
          const error = new Error('metadata disappeared');
          Object.defineProperty(error, 'code', { value: 'ENOENT' });
          throw error;
        }
        return fs.readFileSync(filePath, encoding);
      };

      const result = loadInstallMetadataFromDir(
        extDir,
        PRIMARY_METADATA,
        FALLBACK_METADATA,
        readTextFile,
      );

      expect(result?.source).toBe('https://fallback.example.git');
    });

    it('returns undefined installMetadata when neither file exists', () => {
      const extDir = path.join(tempRoot, 'no-meta-ext');
      fs.mkdirSync(extDir, { recursive: true });

      writeManifest(extDir, PRIMARY_MANIFEST, {
        name: 'no-meta',
        version: '1.0.0',
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      expect(result?.installMetadata).toBeUndefined();
    });

    it('reports error and does not fall back when primary metadata is malformed', () => {
      const extDir = path.join(tempRoot, 'malformed-primary-meta-ext');
      fs.mkdirSync(extDir, { recursive: true });

      writeManifest(extDir, PRIMARY_MANIFEST, {
        name: 'bad-primary-meta',
        version: '1.0.0',
      });
      // Malformed primary metadata (invalid JSON)
      fs.writeFileSync(
        path.join(extDir, PRIMARY_METADATA),
        '{ "source": broken',
      );
      writeManifest(extDir, FALLBACK_METADATA, {
        source: 'https://fallback.example.git',
        type: 'git',
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      // Extension should not load — malformed primary metadata stops loading
      expect(result).toBeNull();
      expect(collector.errors.length).toBeGreaterThan(0);
      expect(collector.errors.some((e) => e.includes(PRIMARY_METADATA))).toBe(
        true,
      );
    });

    it('rejects metadata with a structurally invalid shape', () => {
      const extDir = path.join(tempRoot, 'invalid-shape-meta-ext');
      fs.mkdirSync(extDir, { recursive: true });
      writeManifest(extDir, PRIMARY_MANIFEST, {
        name: 'invalid-shape-meta',
        version: '1.0.0',
      });
      writeManifest(extDir, PRIMARY_METADATA, {
        source: 'https://example.test/extension.git',
        type: 'git',
        autoUpdate: 'yes',
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).toBeNull();
      expect(
        collector.errors.some((error) => error.includes(PRIMARY_METADATA)),
      ).toBe(true);
    });

    it('isolates invalid metadata so another extension still loads', () => {
      const invalidDir = path.join(tempRoot, 'invalid-metadata-entry');
      fs.mkdirSync(invalidDir, { recursive: true });
      writeManifest(invalidDir, PRIMARY_MANIFEST, {
        name: 'invalid-entry',

        version: '1.0.0',
      });
      writeManifest(invalidDir, PRIMARY_METADATA, {
        source: 42,
        type: 'git',
      });

      const validDir = path.join(tempRoot, 'valid-metadata-entry');
      fs.mkdirSync(validDir, { recursive: true });
      writeManifest(validDir, PRIMARY_MANIFEST, {
        name: 'valid-entry',
        version: '1.0.0',
      });
      writeManifest(validDir, PRIMARY_METADATA, {
        source: 'https://example.test/valid.git',
        type: 'git',
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const invalidResult = loadExtensionFromDir(
        makeContext(invalidDir),
        makeDeps(collector),
      );
      const validResult = loadExtensionFromDir(
        makeContext(validDir),
        makeDeps(collector),
      );

      expect(invalidResult).toBeNull();
      expect(validResult?.name).toBe('valid-entry');
    });

    it('reports error and skips extension when fallback metadata is malformed', () => {
      const extDir = path.join(tempRoot, 'malformed-fallback-meta-ext');
      fs.mkdirSync(extDir, { recursive: true });

      writeManifest(extDir, PRIMARY_MANIFEST, {
        name: 'bad-fb-meta',
        version: '1.0.0',
      });
      // Malformed fallback metadata (invalid JSON), no primary metadata present
      fs.writeFileSync(
        path.join(extDir, FALLBACK_METADATA),
        '{ "source": broken',
      );

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      // Malformed fallback metadata must NOT be treated as absent — only
      // ENOENT means absent. The extension is skipped (matching primary
      // metadata safety), not loaded with undefined metadata.
      expect(result).toBeNull();
      expect(collector.errors.some((e) => e.includes(FALLBACK_METADATA))).toBe(
        true,
      );
    });
  });

  describe('canonical hooks/hooks.json', () => {
    it('loads and hydrates executable hooks with precedence over manifest hooks', () => {
      const extDir = path.join(tempRoot, 'hooks-file-ext');
      fs.mkdirSync(path.join(extDir, 'hooks'), { recursive: true });
      writeManifest(extDir, FALLBACK_MANIFEST, {
        name: 'hooks-file-ext',
        version: '1.0.0',
        hooks: {
          BeforeTool: [
            { hooks: [{ type: 'command', command: 'manifest-command' }] },
          ],
        },
      });
      writeManifest(extDir, path.join('hooks', 'hooks.json'), {
        hooks: {
          BeforeTool: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'echo ${extensionPath} ${workspacePath}',
                },
              ],
            },
          ],
        },
      });

      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps({ warnings: [], errors: [] }),
      );

      expect(result?.hooks?.BeforeTool?.[0]?.hooks[0]?.command).toBe(
        `echo ${extDir} ${extDir}`,
      );
    });
  });

  describe('malformed manifest diagnostics', () => {
    it('names gemini-extension.json when fallback manifest is missing name', () => {
      const extDir = path.join(tempRoot, 'malformed-fallback-ext');
      fs.mkdirSync(extDir, { recursive: true });

      // Fallback manifest is malformed (missing name/version).
      writeManifest(extDir, FALLBACK_MANIFEST, {
        version: '1.0.0',
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).toBeNull();
      expect(collector.errors.length).toBeGreaterThan(0);
      expect(collector.errors.some((e) => e.includes(FALLBACK_MANIFEST))).toBe(
        true,
      );
    });

    it('names gemini-extension.json when fallback manifest is invalid JSON', () => {
      const extDir = path.join(tempRoot, 'bad-json-fallback-ext');
      fs.mkdirSync(extDir, { recursive: true });

      fs.writeFileSync(
        path.join(extDir, FALLBACK_MANIFEST),
        '{ "name": broken',
      );

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).toBeNull();
      expect(collector.errors.length).toBeGreaterThan(0);
      expect(collector.errors.some((e) => e.includes(FALLBACK_MANIFEST))).toBe(
        true,
      );
    });

    it('names llxprt-extension.json when primary manifest is missing version', () => {
      const extDir = path.join(tempRoot, 'malformed-primary-ext');
      fs.mkdirSync(extDir, { recursive: true });

      writeManifest(extDir, PRIMARY_MANIFEST, {
        name: 'no-version',
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).toBeNull();
      expect(collector.errors.length).toBeGreaterThan(0);
      expect(collector.errors.some((e) => e.includes(PRIMARY_MANIFEST))).toBe(
        true,
      );
    });
  });

  // ---- Finding 4: secure context paths (relative-only realpath containment) ----

  describe('secure context paths reject traversal/absolute/sibling/symlink escape', () => {
    it('rejects contextFileName with parent traversal (../../etc/passwd)', () => {
      const extDir = path.join(tempRoot, 'traversal-ext');
      fs.mkdirSync(extDir, { recursive: true });

      // Create the target file outside the extension dir
      const outsideFile = path.join(tempRoot, 'secret.txt');
      fs.writeFileSync(outsideFile, 'SECRET');

      writeManifest(extDir, PRIMARY_MANIFEST, {
        name: 'traversal-ext',
        version: '1.0.0',
        contextFileName: '../../secret.txt',
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      // The context file must NOT be included — it escapes the extension dir
      expect(result?.contextFiles).toHaveLength(0);
    });

    it('rejects absolute path contextFileName', () => {
      const extDir = path.join(tempRoot, 'absolute-ext');
      fs.mkdirSync(extDir, { recursive: true });

      // Create an absolute path file
      const absFile = path.join(tempRoot, 'absolute-target.md');
      fs.writeFileSync(absFile, '# absolute');

      writeManifest(extDir, PRIMARY_MANIFEST, {
        name: 'absolute-ext',
        version: '1.0.0',
        contextFileName: absFile,
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      expect(result?.contextFiles).toHaveLength(0);
    });

    it('allows nested relative contextFileName within extension dir', () => {
      const extDir = path.join(tempRoot, 'nested-ext');
      fs.mkdirSync(extDir, { recursive: true });
      fs.mkdirSync(path.join(extDir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(extDir, 'docs', 'context.md'), '# nested');

      writeManifest(extDir, PRIMARY_MANIFEST, {
        name: 'nested-ext',
        version: '1.0.0',
        contextFileName: 'docs/context.md',
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      expect(result?.contextFiles).toContain(
        path.join(extDir, 'docs', 'context.md'),
      );
    });

    it('allows current-directory relative contextFileName (./context.md)', () => {
      const extDir = path.join(tempRoot, 'dot-ext');
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(path.join(extDir, 'context.md'), '# local');

      writeManifest(extDir, PRIMARY_MANIFEST, {
        name: 'dot-ext',
        version: '1.0.0',
        contextFileName: './context.md',
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(extDir),
        makeDeps(collector),
      );

      expect(result).not.toBeNull();
      expect(result?.contextFiles).toContain(path.join(extDir, 'context.md'));
    });
  });

  // ---- Finding 9: safe per-entry stat (broken link diagnostics/continue) ----

  describe('safe per-entry stat handles broken symlinks gracefully', () => {
    it('continues scanning past a broken symlink entry', () => {
      // Create a broken symlink in the extensions dir
      const brokenLinkDir = path.join(tempRoot, 'broken-link');
      const targetDir = path.join(tempRoot, 'nonexistent-target');
      fs.symlinkSync(targetDir, brokenLinkDir, 'dir');

      // Create a valid extension alongside the broken symlink
      const validDir = path.join(tempRoot, 'valid-ext');
      fs.mkdirSync(validDir, { recursive: true });
      writeManifest(validDir, PRIMARY_MANIFEST, {
        name: 'valid-ext',
        version: '1.0.0',
      });

      const collector: WarningCollector = { warnings: [], errors: [] };
      // Load from tempRoot as if it's an extensions dir
      // We need to simulate loadExtensionsFromDir scanning tempRoot
      // Use loadExtensionFromDir on the broken link, then the valid one
      const brokenResult = loadExtensionFromDir(
        makeContext(brokenLinkDir),
        makeDeps(collector),
      );
      expect(brokenResult).toBeNull();
      // The valid extension should still load despite the broken one
      const validResult = loadExtensionFromDir(
        makeContext(validDir),
        makeDeps(collector),
      );
      expect(validResult).not.toBeNull();
      expect(validResult?.name).toBe('valid-ext');
    });

    it('reports diagnostic for broken symlink and continues', () => {
      const brokenLinkDir = path.join(tempRoot, 'broken-diag');
      const targetDir = path.join(tempRoot, 'nonexistent-target-2');
      fs.symlinkSync(targetDir, brokenLinkDir, 'dir');

      const collector: WarningCollector = { warnings: [], errors: [] };
      const result = loadExtensionFromDir(
        makeContext(brokenLinkDir),
        makeDeps(collector),
      );

      expect(result).toBeNull();
      // Should have reported a diagnostic
      expect(
        collector.warnings.length + collector.errors.length,
      ).toBeGreaterThan(0);
    });
  });
});
