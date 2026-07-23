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
   *
   * Each block terminates at a standalone `)` on its own line — NOT at the
   * first inner `)` (subpath entries also close with `)`), so later
   * entries such as a legacy HOME_DIR/.llxprt write grant are captured.
   */
  function extractGrantBlocks(content: string): string[] {
    const matches = content.match(
      /\((?:allow|deny)\s+file-(?:read|write)\*[\s\S]*?\n\)\s*\n/g,
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
        // The regex terminates at a standalone `)` line so the FULL
        // file-write* block is captured, not just the first subpath entry.
        const writeGrantMatch = content.match(
          /\(allow file-write\*[\s\S]*?\n\)\s*\n/g,
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

  it('extractGrantBlocks mutation guard: detects a reintroduced HOME_DIR/.llxprt write grant in a later subpath entry', () => {
    // This mutation test proves the regex captures the FULL grant block,
    // not just the first subpath entry. If the legacy HOME_DIR/.llxprt
    // write grant were reintroduced as a later entry in a file-write* block
    // (exactly where it used to live, next to .npm/.cache/.gitconfig), the
    // regression guard must detect it.
    const mutatedProfile = `(version 1)
(deny default)
(allow file-write*
    (subpath (param "TARGET_DIR"))
    (subpath (param "CONFIG_DIR"))
    (subpath (param "DATA_DIR"))
    (subpath (string-append (param "HOME_DIR") "/.npm"))
    (subpath (string-append (param "HOME_DIR") "/.cache"))
    (subpath (string-append (param "HOME_DIR") "/.gitconfig"))
    (subpath (string-append (param "HOME_DIR") "/.llxprt"))
    (literal "/dev/null")
)
(allow file-read*
    (subpath (string-append (param "HOME_DIR") "/.llxprt"))
)
`;
    // The write-grant regex must capture the FULL file-write* block
    // including the .llxprt entry near the end.
    const writeGrantMatch = mutatedProfile.match(
      /\(allow file-write\*[\s\S]*?\n\)\s*\n/g,
    );
    const writeGrants = writeGrantMatch ? writeGrantMatch.join('\n') : '';
    expect(writeGrants).toContain(
      '(string-append (param "HOME_DIR") "/.llxprt")',
    );

    // extractGrantBlocks must also include the mutated block.
    const blocks = extractGrantBlocks(mutatedProfile);
    const llxprtBlocks = blocks.filter(
      (b) => b.includes('HOME_DIR') && b.includes('.llxprt'),
    );
    const writeBlocks = llxprtBlocks.filter((b) => !b.includes('file-read'));
    // The mutation test: a reintroduced write grant IS detected.
    expect(writeBlocks.length).toBeGreaterThan(0);
  });
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

  it('creates missing canonical root directories with mode 0o700', () => {
    // Point CONFIG_DIR at a path that does NOT exist yet so
    // resolveRealpathSync must create it. The auto-created directory
    // must have a restrictive mode (0o700), not a permissive default.
    const newConfigDir = path.join(tmpRoot, 'fresh-config');
    expect(fs.existsSync(newConfigDir)).toBe(false);
    process.env['LLXPRT_CONFIG_HOME'] = newConfigDir;

    buildSeatbeltArgs('/tmp/profile.sb', 'node-opts');

    expect(fs.existsSync(newConfigDir)).toBe(true);
    const stat = fs.statSync(newConfigDir);
    // On macOS/Linux the mode is masked by umask, but 0o700 as the requested
    // mode means the result has no group/other bits. We assert that group
    // and other bits are absent (owner-only access).
    expect(stat.mode & 0o077).toBe(0);
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
