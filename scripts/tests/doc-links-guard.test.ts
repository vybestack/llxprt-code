/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for scripts/check-doc-links.ts (issue #2654).
 *
 * Exercises the guard's real behavior against real fixture directories in
 * temp dirs — no mocks of the filesystem. Each test writes real Markdown
 * files, invokes the real guard script via child process, and asserts on
 * the exit code and stdout.
 */

import { describe, expect, it } from 'vitest';
import { symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  bunAvailable,
  runDocLinksGuard,
  useTempDir,
} from './doc-guard-helpers.ts';

describe.skipIf(process.env.CI !== 'true' && !bunAvailable())(
  'check-doc-links',
  () => {
    describe('broken-link detection', () => {
      const fx = useTempDir();

      it('reports a link to a nonexistent sibling file as broken', async () => {
        fx.write('docs/page.md', '# Page\n\n[missing](./missing.md)\n');
        const { code, stdout } = await runDocLinksGuard(fx.root(), 1);
        expect(code).toBe(1);
        expect(stdout).toContain('page.md');
        expect(stdout).toContain('missing.md');
      });

      it('accepts a link to an existing sibling file', async () => {
        fx.write('docs/page.md', '# Page\n\n[ok](./other.md)\n');
        fx.write('docs/other.md', '# Other\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });
    });

    describe('external links ignored', () => {
      const fx = useTempDir();

      it('ignores http:, https:, and mailto: links', async () => {
        fx.write(
          'docs/page.md',
          '# Page\n\n[web](https://example.com)\n[http](http://example.com)\n[mail](mailto:a@b.com)\n',
        );
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });
    });

    describe('code spans and fences', () => {
      const fx = useTempDir();

      it('ignores link-shaped text inside fenced code blocks', async () => {
        fx.write(
          'docs/page.md',
          '# Page\n\n```\n[not-a-link](./nope.md)\n```\n',
        );
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('ignores link-shaped text inside inline code spans', async () => {
        fx.write('docs/page.md', '# Page\n\nUse `[x](./nope.md)` carefully.\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('detects a broken link after a 4-space-indented "fence" (indented code is not a fence)', async () => {
        // A 4-space-indented ``` is INDENTED CODE, not a fence.
        // The link after it must still be checked.
        fx.write('docs/page.md', '# P\n\n    ```\n[missing](./nope.md)\n');
        const { code, stdout } = await runDocLinksGuard(fx.root(), 1);
        expect(code).toBe(1);
        expect(stdout).toContain('nope.md');
      });

      it('does not close a ``` fence with ~~~ (different fence char)', async () => {
        // ``` opened, ~~~ should NOT close it, so the link inside is in code
        fx.write(
          'docs/page.md',
          '# P\n\n```\n~~~\n[not-checked](./nope.md)\n```\n[ok](./real.md)\n',
        );
        fx.write('docs/real.md', '# R\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('does not close a 4-backtick fence with 3 backticks (length mismatch)', async () => {
        // ```` opened, ``` should NOT close it
        fx.write(
          'docs/page.md',
          '# P\n\n````\n```\n[not-checked](./nope.md)\n````\n[ok](./real.md)\n',
        );
        fx.write('docs/real.md', '# R\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('ignores link-shaped text inside multi-backtick inline code spans', async () => {
        fx.write('docs/page.md', '# P\n\nUse ``[x](./nope.md)`` carefully.\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('detects a broken link after a malformed link on the same line (does not abort scanning)', async () => {
        // First link is malformed (unclosed paren), second is valid broken
        fx.write(
          'docs/page.md',
          '# P\n\n[broken](./missing.md [real](./gone.md)\n',
        );
        const { code, stdout } = await runDocLinksGuard(fx.root(), 1);
        expect(code).toBe(1);
        // At least one of the broken links should be reported
        expect(stdout).toMatch(/missing\.md|gone\.md/);
      });
    });

    describe('link destinations with special syntax', () => {
      const fx = useTempDir();

      it('accepts a titled destination [x](./t.md "Title")', async () => {
        fx.write('docs/page.md', '# P\n\n[x](./t.md "Title")\n');
        fx.write('docs/t.md', '# T\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('accepts a destination with balanced parentheses [x](./t_(one).md)', async () => {
        fx.write('docs/page.md', '# P\n\n[x](./t_(one).md)\n');
        fx.write('docs/t_(one).md', '# T\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('accepts an angle-bracket reference definition [ref]: <./my file.md>', async () => {
        fx.write(
          'docs/page.md',
          '# P\n\n[a][ref]\n\n[ref]: <./my%20file.md>\n',
        );
        fx.write('docs/my file.md', '# F\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });
    });

    describe('relative path resolution', () => {
      const fx = useTempDir();

      it('resolves ../ links relative to the containing file, not the CWD', async () => {
        fx.write('docs/sub/page.md', '# Page\n\n[up](../other.md)\n');
        fx.write('docs/other.md', '# Other\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('rejects a link that escapes the repository root', async () => {
        fx.write('docs/page.md', '# P\n\n[escape](../../outside.md)\n');
        const { code, stdout } = await runDocLinksGuard(fx.root(), 1);
        expect(code).toBe(1);
        expect(stdout).toMatch(/outside.*repository|resolves outside/i);
      });
    });

    describe('fragments', () => {
      const fx = useTempDir();

      it('strips #fragment before existence checks', async () => {
        fx.write('docs/page.md', '# Page\n\n[ok](./other.md#section)\n');
        fx.write('docs/other.md', '# Other\n\n## Section\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('reports a #fragment that matches no heading in the target file', async () => {
        fx.write('docs/page.md', '# Page\n\n[bad](./other.md#nope)\n');
        fx.write('docs/other.md', '# Other\n');
        const { code, stdout } = await runDocLinksGuard(fx.root(), 1);
        expect(code).toBe(1);
        expect(stdout).toContain('nope');
      });

      it('accepts a #fragment matching a GitHub-slugged heading', async () => {
        fx.write(
          'docs/page.md',
          '# Page\n\n[ok](./other.md#my-cool-heading)\n',
        );
        fx.write('docs/other.md', '# Other\n\n## My Cool Heading!\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('accepts a fragment with a leading # in the URL (#my-heading)', async () => {
        // Some links include # in the fragment text itself
        fx.write('docs/page.md', '# Page\n\n[ok](./other.md#heading-text)\n');
        fx.write('docs/other.md', '# Other\n\n## Heading Text\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('accepts a setext heading fragment (Title\\n=====)', async () => {
        fx.write('docs/page.md', '# Page\n\n[ok](./other.md#setext-heading)\n');
        fx.write('docs/other.md', 'Setext Heading\n===============\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('matches duplicate headings with GitHub suffixes (#repeat, #repeat-1)', async () => {
        fx.write(
          'docs/page.md',
          '# Page\n\n[a](./other.md#dup)\n[b](./other.md#dup-1)\n[c](./other.md#dup-2)\n',
        );
        fx.write(
          'docs/other.md',
          '# Other\n\n## Dup\n\nText\n\n## Dup\n\nMore\n\n## Dup\n',
        );
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('does not crash on a malformed percent-encoded fragment (#%)', async () => {
        fx.write('docs/page.md', '# Page\n\n[bad](./other.md#%)\n');
        fx.write('docs/other.md', '# Other\n');
        const { code } = await runDocLinksGuard(fx.root(), 1);
        expect(code).toBe(1);
        // Must not crash — should report it as not found
      });

      it('does not crash on malformed percent-encoding (#%zz)', async () => {
        fx.write('docs/page.md', '# Page\n\n[bad](./other.md#%zz)\n');
        fx.write('docs/other.md', '# Other\n');
        const { code } = await runDocLinksGuard(fx.root(), 1);
        expect(code).toBe(1);
      });
    });

    describe('directory links', () => {
      const fx = useTempDir();

      it('accepts a link to a directory that contains index.md', async () => {
        fx.write('docs/page.md', '# Page\n\n[dir](./subdir/)\n');
        fx.write('docs/subdir/index.md', '# Sub\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('rejects a link to a directory without index.md or README.md', async () => {
        fx.write('docs/page.md', '# Page\n\n[dir](./subdir/)\n');
        fx.write('docs/subdir/page.md', '# Page\n'); // no index
        const { code, stdout } = await runDocLinksGuard(fx.root(), 1);
        expect(code).toBe(1);
        expect(stdout).toMatch(/directory without index/i);
      });

      it('validates a fragment on a directory link against index.md', async () => {
        fx.write(
          'docs/page.md',
          '# Page\n\n[dir](./subdir/#missing-section)\n',
        );
        fx.write('docs/subdir/index.md', '# Sub\n');
        const { code, stdout } = await runDocLinksGuard(fx.root(), 1);
        expect(code).toBe(1);
        expect(stdout).toContain('missing-section');
      });
    });

    describe('non-Markdown fragment targets', () => {
      const fx = useTempDir();

      it('reports a fragment on a non-Markdown target instead of silently ignoring it', async () => {
        fx.write('docs/page.md', '# Page\n\n[img](./logo.png#section)\n');
        fx.write('docs/logo.png', 'fake-png');
        const { code, stdout } = await runDocLinksGuard(fx.root(), 1);
        expect(code).toBe(1);
        expect(stdout).toMatch(/cannot be checked|non-Markdown/i);
      });
    });

    describe('special targets', () => {
      const fx = useTempDir();

      it('accepts links to non-Markdown assets that exist', async () => {
        fx.write('docs/page.md', '# Page\n\n![img](./assets/x.png)\n');
        fx.write('docs/assets/x.png', 'fake-png');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('handles percent-encoded targets', async () => {
        fx.write('docs/page.md', '# Page\n\n[enc](./my%20file.md)\n');
        fx.write('docs/my file.md', '# Spaced\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });
    });

    describe('lycheeignore', () => {
      const fx = useTempDir();

      it('honors .lycheeignore entries for external URLs', async () => {
        fx.write('docs/page.md', '# Page\n\n[x](https://ignored.example)\n');
        fx.write('.lycheeignore', 'https://ignored.example\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });
    });

    describe('exit codes and output', () => {
      const fx = useTempDir();

      it('exits non-zero and prints file -> target for each break', async () => {
        fx.write('docs/page.md', '# Page\n\n[a](./a.md)\n[b](./b.md)\n');
        const { code, stdout } = await runDocLinksGuard(fx.root(), 1);
        expect(code).toBe(1);
        expect(stdout).toContain('page.md');
        expect(stdout).toContain('a.md');
        expect(stdout).toContain('b.md');
      });

      it('exits zero on a clean tree', async () => {
        fx.write('docs/page.md', '# Page\n\n[ok](./other.md)\n');
        fx.write('docs/other.md', '# Other\n');
        const { code, stdout } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
        expect(stdout).toContain('PASSED');
      });
    });

    describe('reference-style links', () => {
      const fx = useTempDir();

      it('checks reference-style link definitions', async () => {
        fx.write('docs/page.md', '# Page\n\n[a][ref]\n\n[ref]: ./b.md\n');
        fx.write('docs/b.md', '# B\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });
    });

    describe('repository-root Markdown coverage', () => {
      const fx = useTempDir();

      it('reports a broken link from a root-level file into docs/', async () => {
        fx.write('CONTRIBUTING.md', '# Contributing\n\n[g](./docs/gone.md)\n');
        fx.write('docs/page.md', '# Page\n');
        const { code, stdout } = await runDocLinksGuard(fx.root(), 1);
        expect(code).toBe(1);
        expect(stdout).toContain('CONTRIBUTING.md');
      });

      it('accepts a root-level link that resolves into dev-docs/', async () => {
        fx.write('README.md', '# R\n\n[g](./dev-docs/guide.md)\n');
        fx.write('dev-docs/guide.md', '# Guide\n');
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });
    });

    describe('non-ASCII heading anchors', () => {
      const fx = useTempDir();

      it('accepts an anchor targeting a CJK heading', async () => {
        fx.write(
          'docs/page.md',
          '# Page\n\n[jump](#bun\u8fd0\u884c\u65f6)\n\n### Bun\u8fd0\u884c\u65f6\n',
        );
        const { code } = await runDocLinksGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('still reports a genuinely absent non-ASCII anchor', async () => {
        fx.write(
          'docs/page.md',
          '# Page\n\n[jump](#\u7f3a\u5931\u7684\u6807\u9898)\n\n### Bun\u8fd0\u884c\u65f6\n',
        );
        const { code } = await runDocLinksGuard(fx.root(), 1);
        expect(code).toBe(1);
      });
    });

    describe('missing root (fail-fast)', () => {
      const fx = useTempDir();

      it('fails when docs/ root does not exist', async () => {
        // beforeEach pre-creates docs/ and dev-docs/; remove docs/ to test
        rmSync(join(fx.root(), 'docs'), { recursive: true, force: true });
        await runDocLinksGuard(fx.root(), 1);
        // The guard must fail (non-zero), proving fail-fast works
      });
    });

    describe('symlink policy', () => {
      const fx = useTempDir();

      it('follows symlinked directories and validates links inside them', async () => {
        fx.write('docs/page.md', '# Page\n');
        fx.write('dev-docs/page.md', '# Page\n');
        fx.write('real-docs/page.md', '# Page\n\n[broken](./nope.md)\n');
        // Create a symlink inside docs/ pointing to real-docs
        symlinkSync(
          join(fx.root(), 'real-docs'),
          join(fx.root(), 'docs', 'linked'),
          'dir',
        );
        const { code, stdout } = await runDocLinksGuard(fx.root(), 1);
        expect(code).toBe(1);
        expect(stdout).toContain('nope.md');
      });
    });
  },
);
