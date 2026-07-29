/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSeatbeltArgs, runSeatbeltSandbox } from './sandbox-seatbelt.js';
import { Storage } from '@vybestack/llxprt-code-storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isMacOS = os.platform() === 'darwin';

/** Extracts the value of a `-D NAME=value` seatbelt param from args. */
function paramValue(args: string[], name: string): string | undefined {
  const param = args.find(
    (a, i) => i > 0 && args[i - 1] === '-D' && a.startsWith(`${name}=`),
  );
  return param?.split('=').slice(1).join('=');
}

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
   * profile's source text. Each block terminates at a standalone `)` line.
   */
  function extractGrantBlocks(content: string): string[] {
    return (
      content.match(
        /\((?:allow|deny)\s+file-(?:read|write)\*[\s\S]*?\n\)\s*\n/g,
      ) ?? []
    );
  }

  for (const [profileName, content] of Object.entries(profiles)) {
    describe(`profile: ${profileName}`, () => {
      it('grants writes to CONFIG_DIR, DATA_DIR, and LOG_DIR canonical roots', () => {
        expect(content).toContain('(subpath (param "CONFIG_DIR"))');
        expect(content).toContain('(subpath (param "DATA_DIR"))');
        expect(content).toContain('(subpath (param "LOG_DIR"))');
      });

      it('does NOT grant writes to HOME_DIR/.llxprt (no active legacy write grant)', () => {
        const writeGrants = (
          content.match(/\(allow file-write\*[\s\S]*?\n\)\s*\n/g) ?? []
        ).join('\n');
        expect(writeGrants).not.toContain(
          '(string-append (param "HOME_DIR") "/.llxprt")',
        );
      });

      it('every HOME_DIR/.llxprt grant is read-only (no write grants)', () => {
        const llxprtBlocks = extractGrantBlocks(content).filter(
          (b) => b.includes('HOME_DIR') && b.includes('.llxprt'),
        );
        expect(
          llxprtBlocks.filter((b) => !b.includes('file-read')),
        ).toStrictEqual([]);
      });
    });
  }

  it('extractGrantBlocks mutation guard: detects a reintroduced HOME_DIR/.llxprt write grant', () => {
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
    const writeGrants = (
      mutatedProfile.match(/\(allow file-write\*[\s\S]*?\n\)\s*\n/g) ?? []
    ).join('\n');
    expect(writeGrants).toContain(
      '(string-append (param "HOME_DIR") "/.llxprt")',
    );
    const writeBlocks = extractGrantBlocks(mutatedProfile)
      .filter((b) => b.includes('HOME_DIR') && b.includes('.llxprt'))
      .filter((b) => !b.includes('file-read'));
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

  it.each([
    ['CONFIG_DIR', () => Storage.getGlobalConfigDir()],
    ['DATA_DIR', () => Storage.getGlobalDataDir()],
    ['LOG_DIR', () => Storage.getGlobalLogDir()],
    ['CACHE_DIR', () => Storage.getGlobalCacheDir()],
  ])(
    'passes %s resolved from canonical Storage resolver',
    (_name, resolver) => {
      const args = buildSeatbeltArgs('/tmp/profile.sb', 'node-opts');
      expect(paramValue(args, _name)).toBe(fs.realpathSync(resolver()));
    },
  );

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

      function runInSandbox(cmd: string): string {
        return execFileSync(
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
            cmd,
          ],
          { encoding: 'utf8', stdio: 'pipe' },
        );
      }

      // Write to CONFIG_DIR should succeed.
      execFileSync('sandbox-exec', [
        '-D',
        `CONFIG_DIR=${configDir}`,
        '-D',
        `HOME_DIR=${realTmpRoot}`,
        '-f',
        profile,
        'sh',
        '-c',
        `echo test > "${configDir}/write-test.txt"`,
      ]);
      expect(fs.existsSync(path.join(configDir, 'write-test.txt'))).toBe(true);

      // Write to legacy HOME/.llxprt should be DENIED.
      expect(() =>
        runInSandbox(`echo test > "${legacyDir}/denied.txt"`),
      ).toThrow(/denied|operation not permitted|sandbox/i);
      expect(fs.existsSync(path.join(legacyDir, 'denied.txt'))).toBe(false);

      // Read from legacy HOME/.llxprt should SUCCEED (read-only grant).
      const legacyFile = path.join(legacyDir, 'readme.txt');
      fs.writeFileSync(legacyFile, 'legacy data');
      expect(runInSandbox(`cat "${legacyFile}"`).trim()).toBe('legacy data');
    });
  },
);

// ─── AC11: Seatbelt starts no proxy and receives no capability transport (#1954)

/**
 * Reusable -D parameter pairs for the permissive-open profile that requires
 * all params defined. Used by every sandbox-exec spawn test.
 */
const PERMISSIVE_OPEN_D_PARAMS = [
  '-D',
  'TARGET_DIR=/tmp',
  '-D',
  'TMP_DIR=/tmp',
  '-D',
  'HOME_DIR=/tmp',
  '-D',
  'CACHE_DIR=/tmp',
  '-D',
  'CONFIG_DIR=/tmp',
  '-D',
  'DATA_DIR=/tmp',
  '-D',
  'LOG_DIR=/tmp',
  '-D',
  'INCLUDE_DIR_0=/dev/null',
  '-D',
  'INCLUDE_DIR_1=/dev/null',
  '-D',
  'INCLUDE_DIR_2=/dev/null',
  '-D',
  'INCLUDE_DIR_3=/dev/null',
  '-D',
  'INCLUDE_DIR_4=/dev/null',
];

const PERMISSIVE_OPEN_PROFILE = path.join(
  __dirname,
  'sandbox-macos-permissive-open.sb',
);

describe('AC11: seatbelt spawn env carries no capability transport (#1954)', () => {
  /**
   * Cross-platform behavioral test through the real exported
   * runSeatbeltSandbox path. Begins with dirty capability markers in
   * process.env and asserts the actual spawned child env lacks
   * token/fd/socket. Uses a stub sandbox-exec binary on PATH that prints
   * its environment so this works on ALL platforms without a real
   * sandbox-exec.
   */
  it('runSeatbeltSandbox: child env lacks LLXPRT_CAPABILITY_* and LLXPRT_CREDENTIAL_SOCKET even when parent env has dirty markers', async () => {
    const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-stub-'));
    const stubPath = path.join(stubDir, 'sandbox-exec');
    const capturedEnvPath = path.join(stubDir, 'child-env');
    fs.writeFileSync(stubPath, '#!/bin/sh\nenv > "$SEATBELT_ENV_CAPTURE"\n', {
      mode: 0o755,
    });
    const savedFd = process.env.LLXPRT_CAPABILITY_FD;
    const savedTok = process.env.LLXPRT_CAPABILITY_TOKEN;
    const savedSock = process.env.LLXPRT_CREDENTIAL_SOCKET;
    const savedProfile = process.env.SEATBELT_PROFILE;
    const savedPath = process.env.PATH;
    process.env.LLXPRT_CAPABILITY_TOKEN = 'd'.repeat(64);
    process.env.LLXPRT_CAPABILITY_FD = '3';
    process.env.LLXPRT_CREDENTIAL_SOCKET = '/tmp/fake-dirty.sock';
    process.env.SEATBELT_PROFILE = 'permissive-open';
    process.env.SEATBELT_ENV_CAPTURE = capturedEnvPath;
    // Under vitest, import.meta.url inside sandbox-seatbelt.ts may resolve
    // to a transform-relative path, so the builtin .sb profile may not be
    // found. Spy on fs.existsSync to allow the profile check to pass; the
    // stub sandbox-exec binary ignores the profile entirely.
    const realExistsSync = fs.existsSync;
    const existsSpy = vi
      .spyOn(fs, 'existsSync')
      .mockImplementation((p: fs.PathLike) => {
        if (String(p).includes('sandbox-macos-permissive-open.sb')) return true;
        return realExistsSync(p);
      });
    process.env.PATH = `${stubDir}:${process.env.PATH ?? ''}`;
    try {
      await runSeatbeltSandbox(
        { command: 'sandbox-exec', image: 'test' } as never,
        [],
        undefined,
        [],
      );
      const childEnvOutput = fs.readFileSync(capturedEnvPath, 'utf8');
      expect(childEnvOutput).not.toContain('LLXPRT_CAPABILITY_TOKEN');
      expect(childEnvOutput).not.toContain('LLXPRT_CAPABILITY_FD');
      expect(childEnvOutput).not.toContain('LLXPRT_CREDENTIAL_SOCKET');
    } finally {
      if (savedFd !== undefined) process.env.LLXPRT_CAPABILITY_FD = savedFd;
      else delete process.env.LLXPRT_CAPABILITY_FD;
      if (savedTok !== undefined)
        process.env.LLXPRT_CAPABILITY_TOKEN = savedTok;
      else delete process.env.LLXPRT_CAPABILITY_TOKEN;
      if (savedSock !== undefined)
        process.env.LLXPRT_CREDENTIAL_SOCKET = savedSock;
      else delete process.env.LLXPRT_CREDENTIAL_SOCKET;
      if (savedProfile !== undefined)
        process.env.SEATBELT_PROFILE = savedProfile;
      else delete process.env.SEATBELT_PROFILE;
      process.env.PATH = savedPath;
      delete process.env.SEATBELT_ENV_CAPTURE;
      fs.rmSync(stubDir, { recursive: true, force: true });
      existsSpy.mockRestore();
    }
  });

  it.runIf(isMacOS)(
    'real sandbox-exec child inherits no capability transport markers from the post-consumption parent env',
    () => {
      expect(fs.existsSync(PERMISSIVE_OPEN_PROFILE)).toBe(true);

      const cleanEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: process.env.PATH ?? '/usr/bin:/bin',
      };
      delete cleanEnv.LLXPRT_CAPABILITY_FD;
      delete cleanEnv.LLXPRT_CAPABILITY_TOKEN;
      delete cleanEnv.LLXPRT_CREDENTIAL_SOCKET;

      const result = spawnSync(
        'sandbox-exec',
        [...PERMISSIVE_OPEN_D_PARAMS, '-f', PERMISSIVE_OPEN_PROFILE, 'env'],
        { encoding: 'utf8', env: cleanEnv },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      const childEnv = result.stdout;
      expect(childEnv).not.toContain('LLXPRT_CAPABILITY_FD');
      expect(childEnv).not.toContain('LLXPRT_CAPABILITY_TOKEN');
      expect(childEnv).not.toContain('LLXPRT_CREDENTIAL_SOCKET');
    },
  );

  it.runIf(isMacOS)(
    'O16: asserts real macOS sandbox-exec spawn success/failure surfaces correctly',
    () => {
      expect(fs.existsSync(PERMISSIVE_OPEN_PROFILE)).toBe(true);
      const dirtyEnv: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        LLXPRT_CAPABILITY_TOKEN: 'd'.repeat(64),
        LLXPRT_CAPABILITY_FD: '3',
        LLXPRT_CREDENTIAL_SOCKET: '/tmp/fake.sock',
      };
      const ok = spawnSync(
        'sandbox-exec',
        [...PERMISSIVE_OPEN_D_PARAMS, '-f', PERMISSIVE_OPEN_PROFILE, 'env'],
        { encoding: 'utf8', env: dirtyEnv },
      );
      expect(ok.error).toBeUndefined();
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain('PATH=');

      const fail = spawnSync('sandbox-exec', [
        '-f',
        '/nonexistent/profile.sb',
        'env',
      ]);
      expect(fail.error !== undefined || fail.status !== 0).toBe(true);
    },
  );
});
