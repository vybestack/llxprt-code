/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the post-consumption sandbox.bashrc compatibility helper.
 * @plan project-plans/issue-1954-sandbox-hardening.md (AC5)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applySandboxBashrc,
  extractSandboxBashrcChanges,
} from './sandbox-bashrc.js';

describe('sandbox-bashrc: post-consumption compatibility (AC5)', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbrc-'));
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    delete process.env.MY_SANDBOX_EXPORT;
    delete process.env.PATH_EXTRA_TEST;
    delete process.env.STOLEN;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeBashrc(content: string): string {
    const p = path.join(tmpDir, 'sandbox.bashrc');
    fs.writeFileSync(p, content);
    return p;
  }

  describe('extractSandboxBashrcChanges', () => {
    it('captures exported environment variables from sandbox.bashrc', () => {
      const r = extractSandboxBashrcChanges(
        writeBashrc('export MY_SANDBOX_EXPORT=hello-world\n'),
        tmpDir,
      );
      expect(r.env.MY_SANDBOX_EXPORT).toBe('hello-world');
    });

    it('captures the working-directory change from sandbox.bashrc', () => {
      const subDir = path.join(tmpDir, 'subdir');
      fs.mkdirSync(subDir);
      const r = extractSandboxBashrcChanges(
        writeBashrc(`cd "${subDir}"\n`),
        tmpDir,
      );
      expect(r.cwd).toBeDefined();
      expect(fs.realpathSync(r.cwd as string)).toBe(fs.realpathSync(subDir));
    });

    it('does not expose unexported (shell-local) variables', () => {
      const r = extractSandboxBashrcChanges(
        writeBashrc('LOCAL_ONLY=secret\nexport MY_SANDBOX_EXPORT=visible\n'),
        tmpDir,
      );
      expect(r.env.MY_SANDBOX_EXPORT).toBe('visible');
      expect(r.env.LOCAL_ONLY).toBeUndefined();
    });

    it('O4: sanitizeEnv removes all LLXPRT_CAPABILITY_* keys from child env, unset list, and exfiltration', () => {
      const r = extractSandboxBashrcChanges(
        writeBashrc(
          'export STOLEN="$LLXPRT_CAPABILITY_TOKEN"\nunset KEEP_ME\n',
        ),
        tmpDir,
        {
          LLXPRT_CAPABILITY_TOKEN: 'a'.repeat(64),
          LLXPRT_CAPABILITY_FD: '3',
          LLXPRT_CAPABILITY_OTHER: 'should-be-removed',
          KEEP_ME: 'remove-me',
        },
        { sanitizeEnv: true },
      );
      expect(r.env.STOLEN).toBe('');
      expect(r.env).not.toHaveProperty('LLXPRT_CAPABILITY_TOKEN');
      expect(r.env).not.toHaveProperty('LLXPRT_CAPABILITY_FD');
      expect(r.env).not.toHaveProperty('LLXPRT_CAPABILITY_OTHER');
      expect(r.unset).not.toContain('LLXPRT_CAPABILITY_TOKEN');
      expect(r.unset).not.toContain('LLXPRT_CAPABILITY_FD');
      expect(r.unset).toContain('KEEP_ME');
    });

    it('O4: sanitizeEnv removes a parent capability key even when bashrc unsets it; ordinary unset preserved', () => {
      const r = extractSandboxBashrcChanges(
        writeBashrc('unset LLXPRT_CAPABILITY_TOKEN\nunset KEEP_ME\n'),
        tmpDir,
        { LLXPRT_CAPABILITY_TOKEN: 'a'.repeat(64), KEEP_ME: 'remove-me' },
        { sanitizeEnv: true },
      );
      expect(r.env).not.toHaveProperty('LLXPRT_CAPABILITY_TOKEN');
      expect(r.unset).not.toContain('LLXPRT_CAPABILITY_TOKEN');
      expect(r.unset).toContain('KEEP_ME');
    });

    it('O3: preserves PATH when unmodified; appends correctly when modified', () => {
      const r1 = extractSandboxBashrcChanges(
        writeBashrc('export MY_SANDBOX_EXPORT=ok\n'),
        tmpDir,
        { PATH: '/usr/bin:/bin' },
      );
      expect(r1.env).not.toHaveProperty('PATH');
      const r2 = extractSandboxBashrcChanges(
        writeBashrc('export PATH=/opt/mybin:$PATH\n'),
        tmpDir,
        { PATH: '/usr/bin:/bin' },
      );
      expect(r2.env.PATH).toBe('/opt/mybin:/usr/bin:/bin');
    });

    it('handles a missing sandbox.bashrc gracefully (no error, empty changes)', () => {
      const r = extractSandboxBashrcChanges(
        path.join(tmpDir, 'does-not-exist.bashrc'),
        tmpDir,
      );
      expect(r.env).toStrictEqual({});
      expect(r.cwd).toBeUndefined();
    });

    it('does not report unchanged variables as bashrc contributions', () => {
      const r = extractSandboxBashrcChanges(
        writeBashrc('export MY_SANDBOX_EXPORT=ok\n'),
        tmpDir,
        { KEEP_ME: 'preserved' },
        { sanitizeEnv: false },
      );
      expect(r.env.MY_SANDBOX_EXPORT).toBe('ok');
      expect(r.env.KEEP_ME).toBeUndefined();
    });

    it('reports exported variables removed by sandbox.bashrc', () => {
      const r = extractSandboxBashrcChanges(
        writeBashrc('unset KEEP_ME\n'),
        tmpDir,
        { KEEP_ME: 'remove-me' },
      );
      expect(r.unset).toContain('KEEP_ME');
    });

    it('O1: the probe child runs and has a different BASHPID than the parent (separate process)', () => {
      const r = extractSandboxBashrcChanges(
        writeBashrc('export MY_SANDBOX_EXPORT=$BASHPID\n'),
        tmpDir,
      );
      const childPid = Number(r.env.MY_SANDBOX_EXPORT);
      expect(Number.isInteger(childPid)).toBe(true);
      expect(childPid).not.toBe(process.pid);
    });
  });

  describe('applySandboxBashrc', () => {
    it('applies exported environment variables to the current process', () => {
      applySandboxBashrc(
        writeBashrc('export MY_SANDBOX_EXPORT=applied\n'),
        tmpDir,
      );
      expect(process.env.MY_SANDBOX_EXPORT).toBe('applied');
    });

    it('applies the working-directory change to the current process', () => {
      const subDir = path.join(tmpDir, 'worksub');
      fs.mkdirSync(subDir);
      applySandboxBashrc(writeBashrc(`cd "${subDir}"\n`), tmpDir);
      expect(fs.realpathSync(process.cwd())).toBe(fs.realpathSync(subDir));
    });

    it('applies exported variable removals to the current process', () => {
      process.env.PATH_EXTRA_TEST = 'remove-me';
      applySandboxBashrc(writeBashrc('unset PATH_EXTRA_TEST\n'), tmpDir);
      expect(process.env.PATH_EXTRA_TEST).toBeUndefined();
    });

    it('does nothing when the sandbox.bashrc file does not exist (missing bashrc leaves env unchanged)', () => {
      const before = process.cwd();
      process.env.MISSING_BASHRC_SENTINEL = 'preserve-me';
      try {
        applySandboxBashrc(path.join(tmpDir, 'nope.bashrc'), tmpDir);
        expect(process.cwd()).toBe(before);
        expect(process.env.MISSING_BASHRC_SENTINEL).toBe('preserve-me');
      } finally {
        delete process.env.MISSING_BASHRC_SENTINEL;
      }
    });

    it('does not expose the capability token to the evaluated sandbox.bashrc', () => {
      process.env.LLXPRT_CAPABILITY_TOKEN = 'b'.repeat(64);
      try {
        applySandboxBashrc(
          writeBashrc('export STOLEN="$LLXPRT_CAPABILITY_TOKEN"\n'),
          tmpDir,
        );
        expect(process.env.STOLEN).toBe('');
      } finally {
        delete process.env.LLXPRT_CAPABILITY_TOKEN;
      }
    });

    it('O4: applySandboxBashrc actively removes every parent LLXPRT_CAPABILITY_* key', () => {
      process.env.LLXPRT_CAPABILITY_TOKEN = 'c'.repeat(64);
      process.env.LLXPRT_CAPABILITY_FD = '3';
      process.env.LLXPRT_CAPABILITY_OTHER = 'should-be-removed';
      try {
        applySandboxBashrc(
          writeBashrc('export MY_SANDBOX_EXPORT=ok\n'),
          tmpDir,
        );
        expect(process.env.LLXPRT_CAPABILITY_TOKEN).toBeUndefined();
        expect(process.env.LLXPRT_CAPABILITY_FD).toBeUndefined();
        expect(process.env.LLXPRT_CAPABILITY_OTHER).toBeUndefined();
        expect(process.env.MY_SANDBOX_EXPORT).toBe('ok');
      } finally {
        delete process.env.MY_SANDBOX_EXPORT;
        delete process.env.LLXPRT_CAPABILITY_TOKEN;
        delete process.env.LLXPRT_CAPABILITY_FD;
        delete process.env.LLXPRT_CAPABILITY_OTHER;
      }
    });

    it('never returns or reapplies an LLXPRT_CAPABILITY_* export from a malicious bashrc', () => {
      const malicious = writeBashrc(
        'export LLXPRT_CAPABILITY_TOKEN=evil-reinject\n' +
          'export LLXPRT_CAPABILITY_FD=99\n' +
          'export LLXPRT_CAPABILITY_BOGUS=injected\n' +
          'export MY_SANDBOX_EXPORT=legit\n',
      );
      const r = extractSandboxBashrcChanges(malicious, tmpDir, {
        MY_OTHER: 'keep',
      });
      expect(r.env).not.toHaveProperty('LLXPRT_CAPABILITY_TOKEN');
      expect(r.env).not.toHaveProperty('LLXPRT_CAPABILITY_FD');
      expect(r.env).not.toHaveProperty('LLXPRT_CAPABILITY_BOGUS');
      expect(r.env.MY_SANDBOX_EXPORT).toBe('legit');
      expect(r.unset).not.toContain('MY_OTHER');
      try {
        applySandboxBashrc(
          writeBashrc(
            'export LLXPRT_CAPABILITY_TOKEN=evil-reinject\n' +
              'export LLXPRT_CAPABILITY_FD=99\n',
          ),
          tmpDir,
        );
        expect(process.env.LLXPRT_CAPABILITY_TOKEN).toBeUndefined();
        expect(process.env.LLXPRT_CAPABILITY_FD).toBeUndefined();
      } finally {
        delete process.env.LLXPRT_CAPABILITY_TOKEN;
        delete process.env.LLXPRT_CAPABILITY_FD;
      }
    });

    it('allows a valid empty env payload (no env changes) while still requiring cwd output', () => {
      const r = extractSandboxBashrcChanges(writeBashrc('true\n'), tmpDir);
      expect(r.env).toStrictEqual({});
      expect(r.cwd).toBeUndefined();
    });

    it('throws when the cwd payload is missing (cwd protocol required)', () => {
      // A bashrc that exits before reaching the cwd printf causes the cwd
      // pipe to be empty, which the helper must surface as an error.
      expect(() =>
        extractSandboxBashrcChanges(writeBashrc('exit 0\n'), tmpDir),
      ).toThrowError(/cwd payload|exited with status/);
    });
  });
});
