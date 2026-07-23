/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for scripts/check-legacy-paths.ts (issue #2606, Phase 10).
 *
 * These tests exercise the guard's real behavior end-to-end:
 *
 * 1. Against the REAL repo — the guard must pass today (all legacy references
 *    are either allowlisted or genuinely fixed).
 * 2. The built-in RED/GREEN self-test proves the guard's patterns detect
 *    forbidden active home-anchored references and pass allowed
 *    (workspace-relative) cases.
 * 3. Against SYNTHETIC temp fixtures — proving that a newly added forbidden
 *    active reference FAILS, an allowlisted file passes, and a workspace-
 *    relative `.llxprt` path passes.
 *
 * Tests invoke the real guard script via a non-blocking async child process
 * (no mock theater), per RULES.md.
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  bunAvailable,
  runScript,
  runScriptRealRepo,
  withFixture,
} from './legacy-paths-guard-helpers.ts';

const missingBunMessage =
  '[legacy-paths] Bun runtime not found — install Bun or set BUN_EXECUTABLE.';

describe.skipIf(process.env.CI !== 'true' && !bunAvailable())(
  'check-legacy-paths',
  () => {
    // When CI requires Bun and it is missing, report the failure as a normal
    // test result rather than a suite-collection-time throw (which can abort
    // collection of subsequent suites and surface as an uncaught error).
    (process.env.CI === 'true' && !bunAvailable()
      ? describe.only
      : describe.skip)('CI Bun availability', () => {
      it('Bun is available in CI (required for guard tests)', () => {
        throw new Error(`${missingBunMessage} Guard tests cannot run in CI.`);
      });
    });

    // ── Real repo must be clean ─────────────────────────────────────────
    describe('real repo (current state must be clean)', () => {
      it('passes against the real repository', async () => {
        const { code, stdout } = await runScriptRealRepo(0);
        expect(code).toBe(0);
        expect(stdout).toContain('legacy-paths guard PASSED');
      }, 45_000);
    });

    // ── Built-in RED/GREEN self-test ────────────────────────────────────
    describe('built-in self-test (--self-test)', () => {
      it('passes the RED/GREEN self-test', async () => {
        const { code, stdout } = await runScriptRealRepo(0, ['--self-test']);
        expect(code).toBe(0);
        expect(stdout).toContain('Self-test PASSED');
        // RED cases (forbidden active references detected)
        expect(stdout).toContain('RED: literal ~/.llxprt/settings.json');
        expect(stdout).toContain('RED: $HOME/.llxprt shell expansion');
        expect(stdout).toContain('RED: ${HOME}/.llxprt brace expansion');
        expect(stdout).toContain("RED: homedir() join '.llxprt'");
        expect(stdout).toContain('RED: homedir() join LLXPRT_DIR');
        // RED case: control bytes (NUL) detected in maintained text
        expect(stdout).toContain('RED: NUL byte in maintained text');
        // GREEN cases (allowed references not detected)
        expect(stdout).toContain(
          'GREEN: workspace-relative .llxprt/settings.json',
        );
        expect(stdout).toContain('GREEN: Storage canonical helper');
        expect(stdout).toContain('GREEN: env-paths resolution');
      }, 30_000);
    });

    // ── Fixture-based negatives (forbidden new active reference) ────────
    describe('forbidden new active references (negative cases)', () => {
      it('FAILS a new literal ~/.llxprt in production source', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue.ts',
            "const configDir = '~/.llxprt/settings.json';\nexport const x = configDir;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue.ts');
        expect(stdout).toContain('legacy-paths guard FAILED');
      });

      it('FAILS a new $HOME/.llxprt in shell-scripts', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'shell-scripts/rogue.sh',
            '#!/bin/bash\nAUTH_DIR="$HOME/.llxprt/oauth"\nmkdir -p "$AUTH_DIR"\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue.sh');
      });

      it('FAILS a new ${HOME}/.llxprt in shell-scripts', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'shell-scripts/rogue-brace.sh',
            '#!/bin/bash\nmkdir -p "${HOME}/.llxprt/locks"\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue-brace.sh');
      });

      it('FAILS a new homedir()+.llxprt path.join in production source', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/core/src/legacy-join.ts',
            "import path from 'node:path';\nimport os from 'node:os';\nexport const d = path.join(os.homedir(), '.llxprt', 'x');\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('legacy-join.ts');
      });

      it('FAILS a new homedir()+LLXPRT_DIR path.join in production source', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/core/src/legacy-dir.ts',
            "import path from 'node:path';\nimport os from 'node:os';\nconst LLXPRT_DIR = '.llxprt';\nexport const d = path.join(os.homedir(), LLXPRT_DIR);\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('legacy-dir.ts');
      });

      it('FAILS a new ~/.llxprt in docs', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'docs/rogue.md',
            '# Rogue Doc\n\nSave your settings to ~/.llxprt/settings.json.\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue.md');
      });

      it('FAILS a new Windows %USERPROFILE%\\.llxprt in docs', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'docs/rogue-win.md',
            '# Windows\n\nConfig: %USERPROFILE%\\.llxprt\\settings.json\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue-win.md');
      });

      it('FAILS an explicit /Users/<name>/.llxprt in docs (finding G)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'docs/rogue-users.md',
            '# macOS\nConfig lives at /Users/alice/.llxprt/settings.json.\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue-users.md');
      });

      it('FAILS an explicit /home/<name>/.llxprt in docs (finding G)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'docs/rogue-home.md',
            '# Linux\nData: /home/bob/.llxprt/data.json\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue-home.md');
      });

      it('FAILS a Windows drive-letter C:\\Users\\<name>\\.llxprt in docs (finding G)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'docs/rogue-drive.md',
            '# Windows\nConfig: C:\\Users\\carol\\.llxprt\\settings.json\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue-drive.md');
      });

      it('FAILS a legacy ~/.llxprt in a .js production source file (finding G)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue.js',
            "const dir = '~/.llxprt/settings.json';\nexport { dir };\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue.js');
      });

      it('FAILS a legacy ~/.llxprt in a .mjs production source file (finding G)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue.mjs',
            "const dir = '~/.llxprt/data';\nexport { dir };\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue.mjs');
      });

      it('FAILS a legacy ~/.llxprt in a .cjs production source file (finding G)', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/rogue.cjs',
            "const dir = '~/.llxprt/cache';\nmodule.exports = { dir };\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue.cjs');
      });

      it('FAILS a maintained doc containing an embedded NUL byte', async () => {
        // A doc whose prose was truncated by NUL padding (regression of the
        // documented corruption) must fail the guard rather than pass silently.
        const { code, stdout } = await withFixture(({ root, write }) => {
          // Write a clean file so the guard does not fail-closed on zero files,
          // then inject a NUL byte into a separate maintained doc.
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          const docPath = join(root, 'docs', 'nul-corrupted.md');
          mkdirSync(dirname(docPath), { recursive: true });
          // Content "truncated sentence" + NUL + trailing newline.
          const buf = Buffer.from(
            '# Doc\n\nThis sentence was truncated by\x00\x00\x00\n',
            'utf8',
          );
          writeFileSync(docPath, buf);
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('nul-corrupted.md');
        expect(stdout).toContain('NUL');
      });
    });

    // ── Fixture-based positives (allowed references) ────────────────────
    describe('allowed references (positive cases)', () => {
      it('passes workspace-relative .llxprt/settings.json', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/workspace-scoped.ts',
            "import path from 'node:path';\nexport const f = path.join(workspaceDir, '.llxprt', 'settings.json');\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('passes a Storage canonical helper reference', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/canonical.ts',
            'export const dir = Storage.getGlobalConfigDir();\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('passes an env-paths resolution', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write(
            'scripts/canonical.js',
            "import envPaths from 'env-paths';\nconst p = envPaths('llxprt-code', { suffix: '' }).config;\nexport default p;\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('passes a .gemini compatibility root reference', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/compat.ts',
            "import path from 'node:path';\nimport os from 'node:os';\nexport const root = path.join(os.homedir(), '.gemini', 'extensions');\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('passes a project-local ./.llxprt reference', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/local.ts',
            "import { readFileSync } from 'node:fs';\nexport const s = readFileSync('./.llxprt/settings.json');\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('passes a file with no legacy references', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const hello = "world";\n');
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });
    });

    // ── Allowlist semantics ─────────────────────────────────────────────
    describe('allowlist semantics (narrow path+pattern scoping)', () => {
      it('suppresses matching allowlisted occurrences with a reason', async () => {
        // packages/storage/src/config/storage.ts is allowlisted for
        // ~/.llxprt|homeDir.*.llxprt|LLXPRT_DIR. A doc reference to the
        // legacy path matches the pattern and is suppressed.
        const { code, stdout } = await withFixture(({ root, write }) => {
          // write a clean scannable file so the guard does not fail-closed
          // on zero files
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/storage/src/config/storage.ts',
            '// doc: ~/.llxprt is the legacy migration input.\nexport const ok = 1;\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
        // The allowlisted file's suppression is reported
        expect(stdout).toContain('storage.ts');
        expect(stdout).toContain('ALLOWLISTED');
      });

      it('detects a non-allowlisted new form in an allowlisted file', async () => {
        // docs/oauth-setup.md is allowlisted for ~/.llxprt. Adding a
        // homedir()+LLXPRT_DIR reference (which does NOT match the
        // allowlist pattern '~/.llxprt') must still fail.
        const { code, stdout } = await withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'docs/oauth-setup.md',
            '# OAuth\nLegacy ~/.llxprt is fine here.\nBut rogue: path.join(os.homedir(), LLXPRT_DIR);\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('oauth-setup.md');
        expect(stdout).toContain('homedir()');
      });

      // Hook docs were rewritten to canonical config-root semantics
      // (${LLXPRT_CONFIG_HOME}/hooks), so they are no longer allowlisted.
      // Any home-anchored ~/.llxprt reference in a hook doc must FAIL —
      // including the old ~/.llxprt/hooks script location, which is now
      // forbidden guidance.
      it('FAILS a ~/.llxprt/hooks reference in docs/hooks/creating-custom-hooks.md', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'docs/hooks/creating-custom-hooks.md',
            '# Hooks\nStale: ~/.llxprt/hooks/block.sh\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('creating-custom-hooks.md');
        expect(stdout).toContain('hooks');
      });

      it('FAILS a ~/.llxprt/settings.json in docs/hooks/creating-custom-hooks.md', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'docs/hooks/creating-custom-hooks.md',
            '# Hooks\nStale app-managed: ~/.llxprt/settings.json\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('creating-custom-hooks.md');
        expect(stdout).toContain('settings.json');
      });

      it('FAILS a ~/.llxprt/hooks reference in docs/hooks/index.md', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'docs/hooks/index.md',
            '# Hooks\nStale: ~/.llxprt/hooks/y.sh\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('index.md');
      });

      it('passes a canonical ${LLXPRT_CONFIG_HOME}/hooks reference in hook docs', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'docs/hooks/creating-custom-hooks.md',
            '# Hooks\n"command": "${LLXPRT_CONFIG_HOME:-$HOME/.config/llxprt-code}/hooks/block.sh"\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });
    });

    // ── Detection, not counting ─────────────────────────────────────────
    describe('detection semantics (not count-based)', () => {
      it('reports each violation individually with file:line:match', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/multi.ts',
            "const a = '~/.llxprt/a';\nconst b = '~/.llxprt/b';\nconst c = '~/.llxprt/c';\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        // Three distinct line numbers reported
        expect(stdout).toMatch(/multi\.ts:1:/);
        expect(stdout).toMatch(/multi\.ts:2:/);
        expect(stdout).toMatch(/multi\.ts:3:/);
      });

      it('detects newly added occurrences (not baseline count)', async () => {
        // Adding a new occurrence to a previously-clean file fails.
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'packages/cli/src/new-occurrence.ts',
            "const clean = 'ok';\n// later edit adds:\nconst bad = '~/.llxprt/new';\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('new-occurrence.ts:3:');
      });
    });

    // ── lint_shell parity: shell-scripts active coverage (#1) ────────────
    //
    // The lint_shell CI job runs shellcheck only (no bun/deps). The legacy-
    // paths guard covers shell-scripts/** via the lint_javascript job
    // (lint:legacy-paths). These tests prove the shell-scripts tree is
    // actively scanned so a legacy home-anchored reference in any shell
    // script is caught — the coverage the lint_shell job alone cannot
    // provide. Defense-in-depth: this makes the shell-coverage contract
    // explicit and guards against a future SCANNED_TREES change silently
    // dropping shell-scripts.
    describe('lint_shell parity: shell-scripts active coverage', () => {
      it('FAILS a tilde-form ~/.llxprt in a shell script', async () => {
        const { code, stdout } = await withFixture(({ root, write }) => {
          write(
            'shell-scripts/rogue-tilde.sh',
            '#!/bin/bash\n# writes to ~/.llxprt/data\nexit 0\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue-tilde.sh');
      });

      it('passes a clean shell script using canonical env-paths resolution', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write(
            'shell-scripts/clean.sh',
            '#!/bin/bash\nDATA_DIR="${LLXPRT_DATA_HOME:-$(node -p "require(\'env-paths\')(\'llxprt-code\',{suffix:\'\'}).data")}"\nmkdir -p "$DATA_DIR"\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });
    });

    // ── Exclusions ──────────────────────────────────────────────────────
    describe('exclusions', () => {
      it('does not scan test files in production source', async () => {
        const { code } = await withFixture(({ root, write }) => {
          // a clean scannable file ensures the guard does not fail-closed
          // on zero files; the rogue test file must be ignored
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/cli/src/rogue.test.ts',
            "const bad = '~/.llxprt/test';\nexport { bad };\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('does not scan spec files in production source', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/cli/src/rogue.spec.ts',
            "const bad = '~/.llxprt/spec';\nexport { bad };\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('does not scan __tests__ directories', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/cli/src/__tests__/rogue.ts',
            "const bad = '~/.llxprt/dir';\nexport { bad };\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('does not scan historical docs/plans/ tree', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'docs/plans/old-plan.md',
            '# Old Plan\nUse ~/.llxprt for everything.\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('does not scan project-plans/ tree', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write('project-plans/old.md', '# Old\n~/.llxprt is the way.\n');
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('does not scan research/ tree', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write('research/audit.md', '# Audit\n~/.llxprt everywhere.\n');
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('does not scan the guard own files', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'scripts/check-legacy-paths.ts',
            "const bad = '~/.llxprt/self';\nexport { bad };\n",
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('does not scan the allowlist data file', async () => {
        const { code } = await withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'scripts/legacy-path-allowlist.json',
            '[{"path":"x","reason":"~/.llxprt in reason"}]\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });
    });
  },
);
