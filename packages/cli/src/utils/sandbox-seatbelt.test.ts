/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSeatbeltArgs } from './sandbox-seatbelt.js';
import { Storage } from '@vybestack/llxprt-code-storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isMacOS = os.platform() === 'darwin';

/**
 * Reads all 6 built-in .sb profile files and returns their content keyed by
 * profile name. Used by cross-platform source assertions.
 */
function readAllProfiles(): Record<string, string> {
  const profiles = [
    'permissive-open',
    'permissive-closed',
    'permissive-proxied',
    'restrictive-open',
    'restrictive-closed',
    'restrictive-proxied',
  ];
  const result: Record<string, string> = {};
  for (const p of profiles) {
    const filePath = path.join(__dirname, `sandbox-macos-${p}.sb`);
    result[p] = fs.readFileSync(filePath, 'utf8');
  }
  return result;
}

// ─── Cross-platform source assertions on .sb profiles ─────────────────────

describe('seatbelt .sb profiles: canonical roots and no legacy write grants', () => {
  const profiles = readAllProfiles();

  /**
   * Extracts every `(allow|deny) file-(read|write)*` grant block from a
   * profile's source text, returning an array of raw block strings.
   */
  function extractGrantBlocks(content: string): string[] {
    const matches = content.match(
      /\((?:allow|deny)\s+file-(?:read|write)\*[\s\S]*?\)\s*\n/g,
    );
    return matches ?? [];
  }

  for (const [profileName, content] of Object.entries(profiles)) {
    describe(`profile: ${profileName}`, () => {
      it('grants writes to CONFIG_DIR, DATA_DIR, and LOG_DIR canonical roots', () => {
        expect(content).toContain('(subpath (param "CONFIG_DIR"))');
        expect(content).toContain('(subpath (param "DATA_DIR"))');
        expect(content).toContain('(subpath (param "LOG_DIR"))');
      });

      it('does NOT grant writes to HOME_DIR/.llxprt (no active legacy write grant)', () => {
        // The string-append pattern for .llxprt writes must never appear.
        // A file-read* grant for migration is allowed, but NOT a file-write*
        // grant containing HOME_DIR joined with .llxprt.
        const writeGrantMatch = content.match(
          /\(allow file-write\*[\s\S]*?\)\s*\n/g,
        );
        const writeGrants = writeGrantMatch ? writeGrantMatch.join('\n') : '';
        expect(writeGrants).not.toContain(
          '(string-append (param "HOME_DIR") "/.llxprt")',
        );
      });

      it('every HOME_DIR/.llxprt grant is read-only (no write grants)', () => {
        // Any HOME_DIR/.llxprt reference must be under file-read*, never
        // file-write*. We assert explicitly: among ALL grant blocks that
        // mention both HOME_DIR and .llxprt, none may be a file-write* grant.
        const grantBlocks = extractGrantBlocks(content);
        const llxprtGrantBlocks = grantBlocks.filter(
          (block) => block.includes('HOME_DIR') && block.includes('.llxprt'),
        );
        // Assert every matching block is read-only (contains file-read).
        // A block is a write grant if it mentions file-write* but NOT
        // file-read*.
        const writeGrants = llxprtGrantBlocks.filter(
          (block) => !block.includes('file-read'),
        );
        expect(writeGrants).toStrictEqual([]);
      });
    });
  }
});

// ─── buildSeatbeltArgs passes canonical root params ───────────────────────

describe('buildSeatbeltArgs: canonical root resolution', () => {
  let tmpRoot: string;
  const savedEnv: Record<string, string | undefined> = {};

  const ENV_KEYS = [
    'LLXPRT_CONFIG_HOME',
    'LLXPRT_DATA_HOME',
    'LLXPRT_LOG_HOME',
    'LLXPRT_CACHE_HOME',
    'HOME',
  ] as const;

  beforeEach(async () => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    tmpRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'seatbelt-args-'),
    );
    const configHome = path.join(tmpRoot, 'config');
    const dataHome = path.join(tmpRoot, 'data');
    const logHome = path.join(tmpRoot, 'log');
    const cacheHome = path.join(tmpRoot, 'cache');
    await fs.promises.mkdir(configHome, { recursive: true });
    await fs.promises.mkdir(dataHome, { recursive: true });
    await fs.promises.mkdir(logHome, { recursive: true });
    await fs.promises.mkdir(cacheHome, { recursive: true });
    process.env['LLXPRT_CONFIG_HOME'] = configHome;
    process.env['LLXPRT_DATA_HOME'] = dataHome;
    process.env['LLXPRT_LOG_HOME'] = logHome;
    process.env['LLXPRT_CACHE_HOME'] = cacheHome;
    process.env['HOME'] = tmpRoot;
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  });

  it('passes CONFIG_DIR resolved from Storage.getGlobalConfigDir()', () => {
    const args = buildSeatbeltArgs('/tmp/profile.sb', 'node-opts');
    const configDirParam = args.find(
      (a, i) => i > 0 && args[i - 1] === '-D' && a.startsWith('CONFIG_DIR='),
    );
    expect(configDirParam).toBeDefined();
    const value = configDirParam!.split('=').slice(1).join('=');
    expect(value).toBe(fs.realpathSync(Storage.getGlobalConfigDir()));
  });

  it('passes DATA_DIR resolved from Storage.getGlobalDataDir()', () => {
    const args = buildSeatbeltArgs('/tmp/profile.sb', 'node-opts');
    const dataDirParam = args.find(
      (a, i) => i > 0 && args[i - 1] === '-D' && a.startsWith('DATA_DIR='),
    );
    expect(dataDirParam).toBeDefined();
    const value = dataDirParam!.split('=').slice(1).join('=');
    expect(value).toBe(fs.realpathSync(Storage.getGlobalDataDir()));
  });

  it('passes LOG_DIR resolved from Storage.getGlobalLogDir()', () => {
    const args = buildSeatbeltArgs('/tmp/profile.sb', 'node-opts');
    const logDirParam = args.find(
      (a, i) => i > 0 && args[i - 1] === '-D' && a.startsWith('LOG_DIR='),
    );
    expect(logDirParam).toBeDefined();
    const value = logDirParam!.split('=').slice(1).join('=');
    expect(value).toBe(fs.realpathSync(Storage.getGlobalLogDir()));
  });

  it('passes CACHE_DIR resolved from Storage.getGlobalCacheDir() (canonical, not Darwin user cache)', () => {
    const args = buildSeatbeltArgs('/tmp/profile.sb', 'node-opts');
    const cacheDirParam = args.find(
      (a, i) => i > 0 && args[i - 1] === '-D' && a.startsWith('CACHE_DIR='),
    );
    expect(cacheDirParam).toBeDefined();
    const value = cacheDirParam!.split('=').slice(1).join('=');
    // CACHE_DIR must resolve through the canonical Storage cache resolver
    // (honoring LLXPRT_CACHE_HOME), NOT the Darwin per-user cache dir.
    expect(value).toBe(fs.realpathSync(Storage.getGlobalCacheDir()));
  });
});

// ─── Real macOS sandbox-exec behavioral test (gated to macOS) ─────────────

describe.skipIf(!isMacOS)(
  'real macOS sandbox-exec: canonical roots enforced',
  () => {
    let tmpRoot: string;
    const savedEnv: Record<string, string | undefined> = {};

    const ENV_KEYS = [
      'LLXPRT_CONFIG_HOME',
      'LLXPRT_DATA_HOME',
      'LLXPRT_LOG_HOME',
      'HOME',
    ] as const;

    beforeEach(async () => {
      for (const key of ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      tmpRoot = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'seatbelt-real-'),
      );
      const configHome = path.join(tmpRoot, 'config');
      await fs.promises.mkdir(configHome, { recursive: true });
      process.env['LLXPRT_CONFIG_HOME'] = configHome;
      process.env['HOME'] = tmpRoot;
    });

    afterEach(async () => {
      for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedEnv[key];
        }
      }
      await fs.promises.rm(tmpRoot, { recursive: true, force: true });
    });

    it('sandbox-exec permits write to CONFIG_DIR and denies write to legacy HOME/.llxprt', () => {
      const configDir = fs.realpathSync(process.env['LLXPRT_CONFIG_HOME']!);
      const realTmpRoot = fs.realpathSync(tmpRoot);
      const legacyDir = path.join(realTmpRoot, '.llxprt');
      fs.mkdirSync(legacyDir, { recursive: true });

      const profile = path.join(realTmpRoot, 'test.sb');
      fs.writeFileSync(
        profile,
        `(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow file-read*)
(allow file-write*
    (subpath (param "CONFIG_DIR"))
    (literal "/dev/null")
)
;; read-only legacy grant
(allow file-read*
    (subpath (string-append (param "HOME_DIR") "/.llxprt"))
)
`,
      );

      // Write to CONFIG_DIR should succeed.
      const writeCmd = `echo test > "${configDir}/write-test.txt"`;
      execFileSync('sandbox-exec', [
        '-D',
        `CONFIG_DIR=${configDir}`,
        '-D',
        `HOME_DIR=${realTmpRoot}`,
        '-f',
        profile,
        'sh',
        '-c',
        writeCmd,
      ]);
      expect(fs.existsSync(path.join(configDir, 'write-test.txt'))).toBe(true);

      // Write to legacy HOME/.llxprt should be DENIED (no file-write* grant).
      let denied = false;
      try {
        execFileSync(
          'sandbox-exec',
          [
            '-D',
            `CONFIG_DIR=${configDir}`,
            '-D',
            `HOME_DIR=${realTmpRoot}`,
            '-f',
            profile,
            'sh',
            '-c',
            `echo test > "${legacyDir}/denied.txt"`,
          ],
          { encoding: 'utf8', stdio: 'pipe' },
        );
      } catch {
        denied = true;
      }
      expect(denied).toBe(true);
      expect(fs.existsSync(path.join(legacyDir, 'denied.txt'))).toBe(false);

      // Read from legacy HOME/.llxprt should SUCCEED (read-only migration grant).
      const legacyFile = path.join(legacyDir, 'readme.txt');
      fs.writeFileSync(legacyFile, 'legacy data');
      const readResult = execFileSync(
        'sandbox-exec',
        [
          '-D',
          `CONFIG_DIR=${configDir}`,
          '-D',
          `HOME_DIR=${realTmpRoot}`,
          '-f',
          profile,
          'cat',
          legacyFile,
        ],
        { encoding: 'utf8', stdio: 'pipe' },
      );
      expect(readResult.trim()).toBe('legacy data');
    });
  },
);
