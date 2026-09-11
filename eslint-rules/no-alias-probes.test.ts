/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { Linter } from 'eslint';
import rule, { BOUNDARY_EXCEPTIONS } from './no-alias-probes.js';

// cwd is set to the filesystem root so the absolute test filenames below
// (e.g. '/x/packages/...') resolve inside the flat-config basePath instead of
// being classified as external paths, which would skip linting entirely.
const linter = new Linter({ cwd: path.sep });

/**
 * Filename used when a test does not care about location. It is a .ts file
 * outside any allowlisted path so existing detection tests are unaffected.
 */
const NON_ALLOWLISTED_FILENAME = '/x/src/file.ts';

function verify(code: string, filename: string = NON_ALLOWLISTED_FILENAME) {
  return linter.verify(
    code,
    {
      files: ['**/*.ts'],
      plugins: {
        custom: {
          rules: {
            'no-alias-probes': rule,
          },
        },
      },
      rules: {
        'custom/no-alias-probes': 'error',
      },
    },
    filename,
  );
}

function expectFlagged(code: string, filename?: string) {
  const messages = verify(code, filename);
  expect(messages).toHaveLength(1);
  expect(messages[0]?.ruleId).toBe('custom/no-alias-probes');
  expect(messages[0]?.messageId).toBe('aliasProbe');
}

function expectClean(code: string, filename?: string) {
  expect(verify(code, filename)).toHaveLength(0);
}

describe('no-alias-probes', () => {
  describe('flags alias coalescing on the same object', () => {
    it('flags camelCase old/new name probing with ||', () => {
      expectFlagged('const v = value.oldName || value.newName;');
    });

    it('flags snake_case vs camelCase with ??', () => {
      expectFlagged('const v = value.old_name ?? value.newName;');
    });

    it('flags computed-with-literal vs dot access', () => {
      expectFlagged("const v = obj['old-name'] ?? obj.oldName;");
    });

    it('flags snake_case vs camelCase params', () => {
      expectFlagged('const v = params.foo_bar ?? params.fooBar;');
    });

    it('flags case-only variants (baseUrl vs baseURL)', () => {
      expectFlagged('const v = x.baseUrl ?? x.baseURL;');
    });

    it('flags British/American spelling variants', () => {
      expectFlagged(
        'const v = request.behaviourPrompts ?? request.behaviorPrompts;',
      );
    });

    it('flags optional chains on the same object', () => {
      expectFlagged('const v = cfg?.base_url ?? cfg?.baseUrl;');
    });

    it('flags nested member expressions comparing the full object source', () => {
      expectFlagged('const v = params.cfg.oldName ?? params.cfg.newName;');
    });
  });

  describe('boundary exception: third-party field decoding is flagged by design', () => {
    // Provider adapters decoding third-party wire-format variants (e.g.
    // OpenAI sending both `reasoning_details` and `reasoningDetails`) are
    // flagged by design. Boundary exceptions live in the rule's exported
    // BOUNDARY_EXCEPTIONS allowlist (each entry with owner, reason, and
    // removal condition), mirrored in dev-docs/naming-standard.md;
    // inline lint suppressions are not the mechanism.
    it('flags an inline third-party field-variant probe in an adapter shape', () => {
      expectFlagged(
        'const details = payload.reasoning_details ?? payload.reasoningDetails;',
      );
    });
  });

  describe('boundary exception allowlist', () => {
    it('every entry has non-empty file, owner, reason, and removalCondition', () => {
      expect(BOUNDARY_EXCEPTIONS.length).toBeGreaterThan(0);
      for (const entry of BOUNDARY_EXCEPTIONS) {
        expect(entry.file).toBeTruthy();
        expect(entry.owner).toBeTruthy();
        expect(entry.reason).toBeTruthy();
        expect(entry.removalCondition).toBeTruthy();
      }
    });

    it('file values are unique, glob-free, and repo-relative', () => {
      const files = BOUNDARY_EXCEPTIONS.map((entry) => entry.file);
      expect(new Set(files).size).toBe(files.length);
      for (const file of files) {
        expect(file.startsWith('packages/')).toBe(true);
        expect(file.includes('*')).toBe(false);
        expect(file.includes('?')).toBe(false);
        expect(file.includes('[')).toBe(false);
      }
    });

    it('does not report the probe snippet in an allowlisted file', () => {
      expectClean(
        'const v = process.env.NO_PROXY ?? process.env.no_proxy;',
        '/x/packages/cli/src/utils/sandbox-seatbelt.ts',
      );
    });

    it('still reports the probe snippet in a non-allowlisted file', () => {
      expectFlagged(
        'const v = process.env.NO_PROXY ?? process.env.no_proxy;',
        '/x/packages/cli/src/utils/some-other-file.ts',
      );
    });
  });

  describe('does not flag legitimate fallbacks', () => {
    it('allows boolean option fallback', () => {
      expectClean('const v = x.flag || false;');
    });

    it('allows string default fallback', () => {
      expectClean("const v = x.name ?? 'default';");
    });

    it('allows numeric zero fallback', () => {
      expectClean('const v = x.count ?? 0;');
    });

    it('allows different objects', () => {
      expectClean('const v = a.b ?? c.d;');
      expectClean('const v = x.a || y.a;');
    });

    it('allows different fields after normalization', () => {
      expectClean('const v = x.foo ?? x.bar;');
    });

    it('does not fold old inside a longer identifier segment', () => {
      expectClean('const v = obj.olderSibling || obj.newerSibling;');
    });

    it('does not fold ise inside a longer identifier segment', () => {
      expectClean('const v = obj.rise || obj.rize;');
    });

    it('does not fold our inside a longer identifier segment', () => {
      expectClean('const v = obj.contour || obj.contor;');
    });

    it('allows nested access on different objects', () => {
      expectClean('const v = params.a.foo ?? params.b.foo;');
    });

    it('allows dynamic computed access', () => {
      expectClean('const v = obj[key] ?? obj.other;');
    });
  });
});
