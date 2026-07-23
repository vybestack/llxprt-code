/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the Codex credential shell scripts.
 *
 * These scripts resolve a canonical data directory that may hold live OAuth
 * credentials. The contract under test:
 *   1. Every script that resolves the auth directory prints a clear warning
 *      that the directory contains live credentials.
 *   2. Every directory-creation path uses mode 700 (owner-only).
 *   3. Scripts are syntactically valid bash.
 *
 * The tests run the scripts with fake overrides (a temp HOME and
 * CODEX_AUTH_DIR) so no real credentials are touched and no network calls
 * are made. The scripts are expected to exit non-zero when no auth file
 * exists; we assert on the warning text printed BEFORE that exit.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const SCRIPTS_DIR = path.join(REPO_ROOT, 'shell-scripts');

function mkdtempRepo(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(s: string): string {
  return s.replace(REGEX_SPECIAL, '\\$&');
}

describe('codex credential scripts', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = mkdtempRepo('codex-cred-home-');
  });

  afterEach(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  describe('bash syntax validity', () => {
    for (const script of [
      'codex-call.sh',
      'codex-models.sh',
      'codex-oauth.sh',
    ]) {
      it(`${script} is syntactically valid bash`, () => {
        const res = spawnSync('bash', ['-n', path.join(SCRIPTS_DIR, script)], {
          encoding: 'utf8',
        });
        expect(res.status).toBe(0);
      });
    }
  });

  describe('credential warning', () => {
    it('codex-call.sh does NOT print the credential warning when no auth file exists (gated on use)', () => {
      // With no auth file present, the credential-path warning must NOT be
      // emitted: it is gated so it only fires once a credential file is
      // actually loaded. This preserves the security signal without noise.
      const authDir = path.join(tempHome, 'codex-auth');
      const res = spawnSync(
        'bash',
        [path.join(SCRIPTS_DIR, 'codex-call.sh'), 'ignored-prompt'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: tempHome,
            CODEX_AUTH_DIR: authDir,
            LLXPRT_DATA_HOME: tempHome,
            CODEX_VERBOSE: '1',
          },
        },
      );
      const combined = `${res.stdout}\n${res.stderr}`;
      expect(combined).not.toMatch(/WARNING.*contains live credentials/);
      // The script must exit non-zero when no auth file exists.
      expect(res.status).not.toBe(0);
    });

    it('codex-call.sh prints the credential warning to stderr (verbose) only when an auth file is actually used', () => {
      // Place a valid auth file so the script actually loads credentials,
      // then the gated warning fires. The token is non-empty so the flow
      // proceeds past validation to the warning (which fails later on the
      // missing prompt file, before any network call).
      const authDir = path.join(tempHome, 'codex-auth');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(
        path.join(authDir, 'auth.json'),
        JSON.stringify({ access_token: 'tok', account_id: 'acc' }),
      );
      const res = spawnSync(
        'bash',
        [path.join(SCRIPTS_DIR, 'codex-call.sh'), 'ignored-prompt'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: tempHome,
            CODEX_AUTH_DIR: authDir,
            LLXPRT_DATA_HOME: tempHome,
            CODEX_VERBOSE: '1',
          },
        },
      );
      // The warning must name the resolved auth dir on stderr (proving
      // env-var-driven resolution AND that it fires only on actual use).
      expect(res.stderr).toMatch(
        new RegExp(
          `WARNING.*${escapeRegex(authDir)}.*contains live credentials`,
        ),
      );
      // It must NOT appear on stdout (parseable output channel).
      expect(res.stdout).not.toMatch(/WARNING.*contains live credentials/);
    });

    it('codex-call.sh does NOT print the credential warning by default (privacy-gated, non-verbose)', () => {
      // Even when an auth file exists, the resolved credential path must not
      // be disclosed unless CODEX_VERBOSE is set.
      const authDir = path.join(tempHome, 'codex-auth');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(
        path.join(authDir, 'auth.json'),
        JSON.stringify({ access_token: 'tok', account_id: 'acc' }),
      );
      const res = spawnSync(
        'bash',
        [path.join(SCRIPTS_DIR, 'codex-call.sh'), 'ignored-prompt'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: tempHome,
            CODEX_AUTH_DIR: authDir,
            LLXPRT_DATA_HOME: tempHome,
          },
        },
      );
      const combined = `${res.stdout}\n${res.stderr}`;
      expect(combined).not.toMatch(/WARNING.*contains live credentials/);
    });

    it('codex-models.sh prints a credential note before requiring auth (verbose)', () => {
      const authDir = path.join(tempHome, 'codex-auth');
      const res = spawnSync(
        'bash',
        [path.join(SCRIPTS_DIR, 'codex-models.sh')],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: tempHome,
            CODEX_AUTH_DIR: authDir,
            LLXPRT_DATA_HOME: tempHome,
            // The credential-path notice is gated behind CODEX_VERBOSE so it
            // does not contaminate stdout JSON output by default.
            CODEX_VERBOSE: '1',
          },
        },
      );
      // The note is emitted on stderr so JSON consumers piping stdout are not
      // contaminated, and it must name the resolved canonical data dir.
      expect(res.stderr).toMatch(
        new RegExp(`NOTE: ${escapeRegex(authDir)}.*credentials`),
      );
      // It must NOT appear on stdout (the JSON API response channel).
      expect(res.stdout).not.toMatch(/resolved canonical data directory/i);
      expect(res.status).not.toBe(0);
    });

    it('codex-oauth.sh source contains the credential warning', () => {
      // codex-oauth.sh performs a live network OAuth flow, so we assert the
      // source-level invariant (the warning is emitted at the creation path)
      // rather than executing it.
      const src = fs.readFileSync(
        path.join(SCRIPTS_DIR, 'codex-oauth.sh'),
        'utf8',
      );
      expect(src).toMatch(/WARNING.*contains live credentials/);
    });
  });

  describe('CODEX_AUTH_DIR override validation (Storage contract parity)', () => {
    it('codex-call.sh rejects a relative CODEX_AUTH_DIR, falling back to the canonical data dir', () => {
      // A relative CODEX_AUTH_DIR must be ignored in favor of the canonical
      // data dir (matching Storage.isNonEmptyAbsoluteOverride). The resolved
      // AUTH_DIR must derive from LLXPRT_DATA_HOME, not the relative value.
      // We set CODEX_VERBOSE and place an auth file with a non-empty token so
      // the gated credential-path warning (on stderr) fires once credentials
      // are actually loaded, reporting the resolved AUTH_DIR.
      const canonicalAuthDir = path.join(tempHome, 'codex-auth');
      fs.mkdirSync(canonicalAuthDir, { recursive: true });
      fs.writeFileSync(
        path.join(canonicalAuthDir, 'auth.json'),
        JSON.stringify({ access_token: 'tok', account_id: 'acc' }),
      );
      const res = spawnSync(
        'bash',
        [path.join(SCRIPTS_DIR, 'codex-call.sh'), 'ignored-prompt'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: tempHome,
            CODEX_AUTH_DIR: 'relative/auth-dir',
            LLXPRT_DATA_HOME: tempHome,
            CODEX_VERBOSE: '1',
          },
        },
      );
      // The warning on stderr names the canonical data-derived dir, proving
      // the relative override was ignored.
      expect(res.stderr).toMatch(
        new RegExp(`WARNING.*${escapeRegex(canonicalAuthDir)}.*credentials`),
      );
      // The relative dir must NOT have been used as AUTH_DIR.
      expect(res.stderr).not.toMatch(/WARNING.*relative\/auth-dir/);
    });

    it('codex-call.sh accepts an absolute CODEX_AUTH_DIR and uses it', () => {
      const authDir = path.join(tempHome, 'explicit-auth');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(
        path.join(authDir, 'auth.json'),
        JSON.stringify({ access_token: 'tok', account_id: 'acc' }),
      );
      const res = spawnSync(
        'bash',
        [path.join(SCRIPTS_DIR, 'codex-call.sh'), 'ignored-prompt'],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: tempHome,
            CODEX_AUTH_DIR: authDir,
            LLXPRT_DATA_HOME: tempHome,
            CODEX_VERBOSE: '1',
          },
        },
      );
      // The gated warning on stderr names the explicit absolute auth dir,
      // proving the override was honored.
      expect(res.stderr).toMatch(
        new RegExp(`WARNING.*${escapeRegex(authDir)}.*credentials`),
      );
    });
  });

  describe('secure directory creation (mode 700)', () => {
    it('codex-call.sh chmods AUTH_DIR to 700 after creating it', () => {
      // codex-call.sh creates AUTH_DIR deep in its flow (after loading a
      // system prompt that only exists when tmp/codex is cloned), so we
      // assert the source invariant: the mkdir of AUTH_DIR is immediately
      // followed by chmod 700. This is the security-critical contract.
      const src = fs.readFileSync(
        path.join(SCRIPTS_DIR, 'codex-call.sh'),
        'utf8',
      );
      expect(src).toMatch(
        /mkdir\s+-p\s+"\$\{AUTH_DIR\}"[\s\S]*?chmod\s+700\s+"\$\{AUTH_DIR\}"/,
      );
    });

    it('codex-oauth.sh chmods AUTH_DIR to 700 and AUTH_FILE to 600', () => {
      // codex-oauth.sh performs a live network OAuth flow, so we assert the
      // source invariant for the creation path.
      const src = fs.readFileSync(
        path.join(SCRIPTS_DIR, 'codex-oauth.sh'),
        'utf8',
      );
      expect(src).toMatch(
        /mkdir\s+-p\s+"\$\{AUTH_DIR\}"[\s\S]*?chmod\s+700\s+"\$\{AUTH_DIR\}"/,
      );
      expect(src).toMatch(/chmod\s+600\s+"\$\{AUTH_FILE\}"/);
    });
  });
});
