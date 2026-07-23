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
  loadInstallMetadata,
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

describe('A2A extension loader', () => {
  let harness: Harness;
  let fakeHome: string;

  beforeEach(() => {
    harness = createHarness();
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-ext-test-home-'));
    // Redirect the canonical Storage data dir to the fake home so that
    // user-scope extensions resolve under <fakeHome>/extensions (mirrors the
    // production contract: Storage.getUserExtensionsDir() => <data>/extensions).
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

  describe('dual-manifest precedence (primary wins)', () => {
    it('loads llxprt-extension.json when both manifests exist', () => {
      writeExtensionFile(
        harness.extensionsDir,
        'dual',
        EXTENSIONS_CONFIG_FILENAME,
        { name: 'primary', version: '2.0.0' },
      );
      writeExtensionFile(
        harness.extensionsDir,
        'dual',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        { name: 'fallback', version: '1.0.0' },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.name).toBe('primary');
      expect(extensions[0]?.version).toBe('2.0.0');
    });
  });

  describe('fallback-only (legacy gemini-extension.json)', () => {
    it('loads gemini-extension.json when it is the only manifest', () => {
      writeExtensionFile(
        harness.extensionsDir,
        'legacy',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        {
          name: 'legacy-ext',
          version: '0.9.0',
          mcpServers: {
            'legacy-server': { command: 'python', args: ['server.py'] },
          },
        },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.name).toBe('legacy-ext');
      expect(extensions[0]?.mcpServers).toHaveProperty('legacy-server');
    });

    it('preserves every canonical MCP server field except trust', () => {
      const nestedExtension = {
        name: 'nested-extension',
        version: '1.0.0',
        isActive: true,
        path: '/nested-extension',
        contextFiles: [],
      };
      const expectedServer = {
        command: 'node',
        args: ['server.js'],
        env: { TOKEN: 'value' },
        cwd: '/work',
        url: 'https://example.test/sse',
        httpUrl: 'https://example.test/http',
        headers: { Authorization: 'Bearer token' },
        tcp: 'localhost:9000',
        type: 'http',
        timeout: 4500,
        description: 'Canonical MCP server',
        includeTools: ['read'],
        excludeTools: ['write'],
        extensionName: 'owner-extension',
        extension: nestedExtension,
        oauth: {
          enabled: true,
          clientId: 'client-id',
          clientSecret: 'client-secret',
          authorizationUrl: 'https://example.test/authorize',
          tokenUrl: 'https://example.test/token',
          scopes: ['scope-a'],
          audiences: ['audience-a'],
          redirectUri: 'http://localhost/callback',
          tokenParamName: 'access_token',
          registrationUrl: 'https://example.test/register',
        },
        authProviderType: 'service_account_impersonation',
        targetAudience: 'client.apps.googleusercontent.com',
        targetServiceAccount: 'service@example.iam.gserviceaccount.com',
      };
      writeExtensionFile(
        harness.extensionsDir,
        'all-mcp-fields',
        EXTENSIONS_CONFIG_FILENAME,
        {
          name: 'all-mcp-fields',
          version: '1.0.0',
          mcpServers: {
            canonical: { ...expectedServer, trust: true },
          },
        },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });

      expect(extensions[0]?.mcpServers?.canonical).toStrictEqual(
        expectedServer,
      );
    });

    it('carries hooks from gemini-extension.json to LlxprtExtension', () => {
      writeExtensionFile(
        harness.extensionsDir,
        'legacy-hooks',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        {
          name: 'legacy-hooks',
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
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.hooks).toBeDefined();
      expect(extensions[0]?.hooks).toHaveProperty('BeforeTool');
    });

    it('honors contextFileName from gemini-extension.json', () => {
      const contextFileName = 'GEMINI.md';
      const extDir = path.join(harness.extensionsDir, 'legacy-ctx');
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(path.join(extDir, contextFileName), '# Legacy context');
      fs.writeFileSync(
        path.join(extDir, EXTENSIONS_CONFIG_FILENAME_FALLBACK),
        JSON.stringify({
          name: 'legacy-ctx',
          version: '1.0.0',
          contextFileName,
        }),
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.contextFiles).toContain(
        path.join(extDir, contextFileName),
      );
    });
  });

  describe('install metadata fallback', () => {
    it('prefers .llxprt-extension-install.json', () => {
      writeExtensionFile(
        harness.extensionsDir,
        'meta',
        EXTENSIONS_CONFIG_FILENAME,
        { name: 'meta', version: '1.0.0' },
      );
      writeExtensionFile(
        harness.extensionsDir,
        'meta',
        INSTALL_METADATA_FILENAME,
        { source: 'https://primary.example.git', type: 'git' },
      );
      writeExtensionFile(
        harness.extensionsDir,
        'meta',
        INSTALL_METADATA_FILENAME_FALLBACK,
        { source: 'https://fallback.example.git', type: 'git' },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.installMetadata?.source).toBe(
        'https://primary.example.git',
      );
    });

    it('falls back to .gemini-extension-install.json', () => {
      writeExtensionFile(
        harness.extensionsDir,
        'meta-fb',
        EXTENSIONS_CONFIG_FILENAME,
        { name: 'meta-fb', version: '1.0.0' },
      );
      writeExtensionFile(
        harness.extensionsDir,
        'meta-fb',
        INSTALL_METADATA_FILENAME_FALLBACK,
        { source: 'https://legacy.example.git', type: 'git' },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.installMetadata?.source).toBe(
        'https://legacy.example.git',
      );
    });

    it('falls back when primary metadata disappears before it is read', () => {
      const extDir = path.join(harness.extensionsDir, 'meta-race');
      writeExtensionFile(
        harness.extensionsDir,
        'meta-race',
        INSTALL_METADATA_FILENAME,
        { source: 'https://primary.example.git', type: 'git' },
      );
      writeExtensionFile(
        harness.extensionsDir,
        'meta-race',
        INSTALL_METADATA_FILENAME_FALLBACK,
        { source: 'https://fallback.example.git', type: 'git' },
      );
      const primaryPath = path.join(extDir, INSTALL_METADATA_FILENAME);
      const readTextFile = (filePath: string, encoding: 'utf-8'): string => {
        if (filePath === primaryPath) {
          const error = new Error('metadata disappeared');
          Object.defineProperty(error, 'code', { value: 'ENOENT' });
          throw error;
        }
        return fs.readFileSync(filePath, encoding);
      };

      const metadata = loadInstallMetadata(extDir, readTextFile);

      expect(metadata).toMatchObject({
        source: 'https://fallback.example.git',
        type: 'git',
      });
    });

    it('reports error and does not fall back when primary metadata is malformed', () => {
      loggerErrorSpy.mockClear();

      writeExtensionFile(
        harness.extensionsDir,
        'bad-meta',
        EXTENSIONS_CONFIG_FILENAME,
        { name: 'bad-meta', version: '1.0.0' },
      );
      // Malformed primary metadata (invalid JSON)
      writeExtensionFile(
        harness.extensionsDir,
        'bad-meta',
        INSTALL_METADATA_FILENAME,
        '{ "source": broken',
      );
      writeExtensionFile(
        harness.extensionsDir,
        'bad-meta',
        INSTALL_METADATA_FILENAME_FALLBACK,
        { source: 'https://fallback.example.git', type: 'git' },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      // Extension should not load due to malformed primary metadata
      expect(extensions).toHaveLength(0);
      expect(
        loggerErrorSpy.mock.calls.some(
          (call) =>
            typeof call[0] === 'string' &&
            call[0].includes(INSTALL_METADATA_FILENAME),
        ),
      ).toBe(true);
    });

    it('rejects metadata with a structurally invalid shape and isolates the entry', () => {
      loggerErrorSpy.mockClear();
      writeExtensionFile(
        harness.extensionsDir,
        'invalid-shape',
        EXTENSIONS_CONFIG_FILENAME,
        { name: 'invalid-shape', version: '1.0.0' },
      );
      writeExtensionFile(
        harness.extensionsDir,
        'invalid-shape',
        INSTALL_METADATA_FILENAME,
        {
          source: 'https://example.test/invalid.git',
          type: 'git',
          autoUpdate: 'yes',
        },
      );
      writeExtensionFile(
        harness.extensionsDir,
        'valid-neighbor',
        EXTENSIONS_CONFIG_FILENAME,
        { name: 'valid-neighbor', version: '1.0.0' },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions.map((extension) => extension.name)).toStrictEqual([
        'valid-neighbor',
      ]);
      expect(
        loggerErrorSpy.mock.calls.some(
          (call) =>
            typeof call[0] === 'string' &&
            call[0].includes(INSTALL_METADATA_FILENAME),
        ),
      ).toBe(true);
    });
  });

  describe('malformed manifest diagnostics', () => {
    it('names gemini-extension.json when fallback manifest is missing name', () => {
      loggerErrorSpy.mockClear();

      writeExtensionFile(
        harness.extensionsDir,
        'malformed',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        { version: '1.0.0' },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(0);
      expect(
        loggerErrorSpy.mock.calls.some(
          (call) =>
            typeof call[0] === 'string' &&
            call[0].includes(EXTENSIONS_CONFIG_FILENAME_FALLBACK),
        ),
      ).toBe(true);
    });
  });

  describe('.gemini/extensions discovery', () => {
    let compatExtensionsDir: string;

    beforeEach(() => {
      compatExtensionsDir = path.join(
        harness.workspaceDir,
        COMPAT_EXTENSIONS_DIRECTORY_NAME,
      );
      fs.mkdirSync(compatExtensionsDir, { recursive: true });
    });

    it('discovers an extension from .gemini/extensions with gemini-extension.json', () => {
      writeExtensionFile(
        compatExtensionsDir,
        'gemini-ext',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        { name: 'gemini-ext', version: '1.0.0' },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.name).toBe('gemini-ext');
    });

    it('carries MCP servers from .gemini/extensions fallback manifest', () => {
      writeExtensionFile(
        compatExtensionsDir,
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

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.mcpServers).toHaveProperty('legacy-server');
    });

    it('carries contextFileName from .gemini/extensions fallback manifest', () => {
      const contextFileName = 'GEMINI.md';
      const extDir = path.join(compatExtensionsDir, 'ctx-ext');
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(path.join(extDir, contextFileName), '# Legacy context');
      fs.writeFileSync(
        path.join(extDir, EXTENSIONS_CONFIG_FILENAME_FALLBACK),
        JSON.stringify({
          name: 'ctx-ext',
          version: '1.0.0',
          contextFileName,
        }),
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.contextFiles).toContain(
        path.join(extDir, contextFileName),
      );
    });

    it('carries hooks from .gemini/extensions fallback manifest', () => {
      writeExtensionFile(
        compatExtensionsDir,
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

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.hooks).toBeDefined();
      expect(extensions[0]?.hooks).toHaveProperty('BeforeTool');
    });

    it('prefers .llxprt/extensions over .gemini/extensions by name (dedup)', () => {
      writeExtensionFile(
        harness.extensionsDir,
        'shared',
        EXTENSIONS_CONFIG_FILENAME,
        { name: 'shared', version: '2.0.0' },
      );
      writeExtensionFile(
        compatExtensionsDir,
        'shared',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        { name: 'shared', version: '1.0.0' },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(1);
      expect(extensions[0]?.version).toBe('2.0.0');
    });

    it('discovers distinct extensions from both roots', () => {
      writeExtensionFile(
        harness.extensionsDir,
        'llxprt-ext',
        EXTENSIONS_CONFIG_FILENAME,
        { name: 'llxprt-ext', version: '1.0.0' },
      );
      writeExtensionFile(
        compatExtensionsDir,
        'gemini-ext',
        EXTENSIONS_CONFIG_FILENAME_FALLBACK,
        { name: 'gemini-ext', version: '1.0.0' },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions).toHaveLength(2);
      const names = extensions.map((e) => e.name).sort();
      expect(names).toStrictEqual(['gemini-ext', 'llxprt-ext']);
    });
  });

  // ---- Finding 1: folderTrust gating ----

  describe('folderTrust gating (workspace extensions gated)', () => {
    it('loads workspace extensions when folderTrust is explicitly true', () => {
      writeExtensionFile(
        harness.extensionsDir,
        'ws-ext',
        EXTENSIONS_CONFIG_FILENAME,
        { name: 'ws-ext', version: '1.0.0' },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: true,
        homeDir: fakeHome,
      });
      expect(extensions.some((e) => e.name === 'ws-ext')).toBe(true);
    });

    it('preserves workspace extension loading when folderTrust is omitted', () => {
      writeExtensionFile(
        harness.extensionsDir,
        'ws-ext-default',
        EXTENSIONS_CONFIG_FILENAME,
        { name: 'ws-ext-default', version: '1.0.0' },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        homeDir: fakeHome,
      });
      expect(extensions.some((e) => e.name === 'ws-ext-default')).toBe(true);
    });

    it('does NOT load workspace extensions when folderTrust is false', () => {
      writeExtensionFile(
        harness.extensionsDir,
        'ws-blocked',
        EXTENSIONS_CONFIG_FILENAME,
        { name: 'ws-blocked', version: '1.0.0' },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: false,
        homeDir: fakeHome,
      });
      expect(extensions.some((e) => e.name === 'ws-blocked')).toBe(false);
    });

    it('retains user (home) extensions even when folderTrust is false', () => {
      // User extensions resolve through Storage.getUserExtensionsDir()
      // (<LLXPRT_DATA_HOME>/extensions). beforeEach redirects LLXPRT_DATA_HOME
      // to fakeHome, so the canonical user dir is <fakeHome>/extensions.
      const homeExtensionsDir = path.join(fakeHome, 'extensions');
      fs.mkdirSync(homeExtensionsDir, { recursive: true });
      const userExtDir = path.join(homeExtensionsDir, 'user-ext');
      fs.mkdirSync(userExtDir, { recursive: true });
      fs.writeFileSync(
        path.join(userExtDir, EXTENSIONS_CONFIG_FILENAME),
        JSON.stringify({ name: 'user-ext', version: '1.0.0' }),
      );

      // Create a workspace extension too
      writeExtensionFile(
        harness.extensionsDir,
        'ws-ext',
        EXTENSIONS_CONFIG_FILENAME,
        { name: 'ws-ext', version: '1.0.0' },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: false,
        homeDir: fakeHome,
      });

      // User extension should be present
      expect(extensions.some((e) => e.name === 'user-ext')).toBe(true);
      // Workspace extension should NOT be present
      expect(extensions.some((e) => e.name === 'ws-ext')).toBe(false);
    });

    it('keeps user MCP servers and modern executable hooks active when folderTrust is false', () => {
      // Canonical user extensions dir: <LLXPRT_DATA_HOME>/extensions
      const homeExtensionsDir = path.join(fakeHome, 'extensions');
      const userExtDir = path.join(homeExtensionsDir, 'trusted-user-ext');
      fs.mkdirSync(path.join(userExtDir, 'hooks'), { recursive: true });
      fs.writeFileSync(
        path.join(userExtDir, EXTENSIONS_CONFIG_FILENAME),
        JSON.stringify({
          name: 'trusted-user-ext',
          version: '1.0.0',
          mcpServers: {
            'user-server': { command: 'node', args: ['user-server.js'] },
          },
        }),
      );
      fs.writeFileSync(
        path.join(userExtDir, 'hooks', 'hooks.json'),
        JSON.stringify({
          hooks: {
            BeforeTool: [
              {
                hooks: [{ type: 'command', command: 'echo user-hook' }],
              },
            ],
          },
        }),
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: false,
        homeDir: fakeHome,
      });
      const userExtension = extensions.find(
        (extension) => extension.name === 'trusted-user-ext',
      );

      expect(userExtension?.mcpServers?.['user-server']).toBeDefined();
      expect(userExtension?.hooks?.BeforeTool?.[0]?.hooks[0]?.command).toBe(
        'echo user-hook',
      );
    });

    it('does NOT load workspace MCP servers when folderTrust is false', () => {
      writeExtensionFile(
        harness.extensionsDir,
        'ws-mcp',
        EXTENSIONS_CONFIG_FILENAME,
        {
          name: 'ws-mcp',
          version: '1.0.0',
          mcpServers: {
            'ws-server': { command: 'node', args: ['ws.js'] },
          },
        },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: false,
        homeDir: fakeHome,
      });
      expect(extensions.some((e) => e.name === 'ws-mcp')).toBe(false);
    });

    it('does NOT load workspace hooks when folderTrust is false', () => {
      writeExtensionFile(
        harness.extensionsDir,
        'ws-hook',
        EXTENSIONS_CONFIG_FILENAME,
        {
          name: 'ws-hook',
          version: '1.0.0',
          hooks: {
            BeforeTool: [
              {
                hooks: [{ type: 'command', command: 'malicious' }],
              },
            ],
          },
        },
      );

      const extensions = loadExtensions(harness.workspaceDir, {
        folderTrust: false,
        homeDir: fakeHome,
      });
      expect(extensions.some((e) => e.name === 'ws-hook')).toBe(false);
    });
  });
});
