/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for scripts/check-doc-placement.ts (issue #2654).
 *
 * Exercises the guard's real behavior against real fixture directories in
 * temp dirs — no mocks of the filesystem.
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  bunAvailable,
  isCiEnvironment,
  runDocPlacementGuard,
  useTempDir,
} from './doc-guard-helpers.ts';

describe.skipIf(!isCiEnvironment() && !bunAvailable())(
  'check-doc-placement',
  () => {
    describe('internal-only directories', () => {
      const fx = useTempDir();

      it('fails when docs/architecture/ exists', async () => {
        mkdirSync(join(fx.root(), 'docs', 'architecture'), {
          recursive: true,
        });
        fx.write('docs/architecture/x.md', '# X\n');
        const { code, stdout } = await runDocPlacementGuard(fx.root(), 1);
        expect(code).toBe(1);
        expect(stdout).toContain('architecture');
      });

      it('fails when docs/plans/ exists', async () => {
        mkdirSync(join(fx.root(), 'docs', 'plans'), { recursive: true });
        fx.write('docs/plans/x.md', '# X\n');
        const { code, stdout } = await runDocPlacementGuard(fx.root(), 1);
        expect(code).toBe(1);
        expect(stdout).toContain('plans');
      });

      it('fails when docs/merge-notes/ exists', async () => {
        mkdirSync(join(fx.root(), 'docs', 'merge-notes'), {
          recursive: true,
        });
        fx.write('docs/merge-notes/x.md', '# X\n');
        const { code, stdout } = await runDocPlacementGuard(fx.root(), 1);
        expect(code).toBe(1);
        expect(stdout).toContain('merge-notes');
      });

      it('passes when those directories are absent', async () => {
        fx.write('docs/page.md', '# Page\n');
        const { code } = await runDocPlacementGuard(fx.root(), 0);
        expect(code).toBe(0);
      });
    });

    describe('bookkeeping markers', () => {
      const fx = useTempDir();

      it('fails on a docs/ file containing @plan:', async () => {
        fx.write('docs/page.md', '# Page\n\n@plan: do something\n');
        const { code } = await runDocPlacementGuard(fx.root(), 1);
        expect(code).toBe(1);
      });

      it('fails on a docs/ file containing @requirement:', async () => {
        fx.write('docs/page.md', '# Page\n\n@requirement: r1\n');
        const { code } = await runDocPlacementGuard(fx.root(), 1);
        expect(code).toBe(1);
      });

      it('fails on a docs/ file containing a PLAN- marker', async () => {
        fx.write('docs/page.md', '# Page\n\nPLAN-42: work\n');
        const { code } = await runDocPlacementGuard(fx.root(), 1);
        expect(code).toBe(1);
      });

      it('fails on a docs/ file containing a REQ- marker', async () => {
        fx.write('docs/page.md', '# Page\n\nREQ-7: thing\n');
        const { code } = await runDocPlacementGuard(fx.root(), 1);
        expect(code).toBe(1);
      });

      it('fails on case-insensitive marker @Plan:', async () => {
        fx.write('docs/page.md', '# Page\n\n@Plan: do something\n');
        const { code } = await runDocPlacementGuard(fx.root(), 1);
        expect(code).toBe(1);
      });

      it('fails on case-insensitive marker PLAN_123', async () => {
        fx.write('docs/page.md', '# Page\n\nPLAN_123: work\n');
        const { code } = await runDocPlacementGuard(fx.root(), 1);
        expect(code).toBe(1);
      });

      it('permits those markers under dev-docs/', async () => {
        fx.write('dev-docs/page.md', '# Page\n\n@plan: ok\nPLAN-1: ok\n');
        const { code } = await runDocPlacementGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('permits those markers inside fenced code blocks in docs/', async () => {
        fx.write(
          'docs/page.md',
          '# Page\n\n```\n@plan: quoted\nPLAN-1: quoted\n```\n',
        );
        const { code } = await runDocPlacementGuard(fx.root(), 0);
        expect(code).toBe(0);
      });
    });

    describe('markers in HTML comments', () => {
      const fx = useTempDir();

      it('flags a marker hidden in an HTML comment', async () => {
        // Markers hidden in HTML comments are invisible to readers but still
        // internal metadata — the PRIMARY case issue #2654 complained about.
        fx.write('docs/page.md', '# Page\n\n<!-- @plan: PLAN-999 -->\n');
        const { code } = await runDocPlacementGuard(fx.root(), 1);
        expect(code).toBe(1);
      });

      it('flags a REQ- marker hidden in an HTML comment', async () => {
        fx.write('docs/page.md', '# Page\n\n<!-- @requirement: REQ-001 -->\n');
        const { code } = await runDocPlacementGuard(fx.root(), 1);
        expect(code).toBe(1);
      });
    });

    describe('fenced markers in containers (lists/blockquotes)', () => {
      const fx = useTempDir();

      it('permits a marker inside a fence within a list item', async () => {
        // BUG D: container tokens carry .raw that includes nested fences.
        // A fenced marker inside a list item must NOT be flagged.
        fx.write(
          'docs/page.md',
          '# Page\n\n1. Step one:\n\n   ```\n   @plan: PLAN-123\n   ```\n',
        );
        const { code } = await runDocPlacementGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('permits a marker inside a fence within a blockquote', async () => {
        fx.write('docs/page.md', '# Page\n\n> ```\n> REQ-456\n> ```\n');
        const { code } = await runDocPlacementGuard(fx.root(), 0);
        expect(code).toBe(0);
      });

      it('still flags an UNFENCED marker in a list item', async () => {
        // Do not overcorrect: an unfenced marker in a list IS still caught.
        fx.write(
          'docs/page.md',
          '# Page\n\n1. See @plan: PLAN-789 for details\n',
        );
        const { code } = await runDocPlacementGuard(fx.root(), 1);
        expect(code).toBe(1);
      });

      it('still flags an UNFENCED marker in a blockquote', async () => {
        fx.write('docs/page.md', '# Page\n\n> REQ-001 here\n');
        const { code } = await runDocPlacementGuard(fx.root(), 1);
        expect(code).toBe(1);
      });
    });

    describe('reporting', () => {
      const fx = useTempDir();

      it('reports every violation, not just the first', async () => {
        fx.write('docs/a.md', '# A\n\n@plan: 1\n');
        fx.write('docs/b.md', '# B\n\n@requirement: 2\n');
        const { code, stdout } = await runDocPlacementGuard(fx.root(), 1);
        expect(code).toBe(1);
        expect(stdout).toContain('a.md');
        expect(stdout).toContain('b.md');
      });

      it('exits zero on a clean tree', async () => {
        fx.write('docs/page.md', '# Clean page\n');
        fx.write('dev-docs/internal.md', '# Internal\n@plan: ok\n');
        const { code, stdout } = await runDocPlacementGuard(fx.root(), 0);
        expect(code).toBe(0);
        expect(stdout).toContain('PASSED');
      });
    });
  },
);
