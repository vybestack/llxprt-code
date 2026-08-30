/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural tests for the mutating broker operations added in P11a.
 *
 * These operations are destructive by nature, so NO test here mutates any
 * real repository. Coverage is on argv construction, shaping, parameter
 * validation and temp-file lifecycle — all of which are the parts that can
 * actually be wrong. Live mutation testing is deliberately omitted.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002, REQ-008, REQ-009, REQ-012, REQ-013
 * @pseudocode 003-github-broker.md lines 38-55
 */

import { describe, it, expect } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { OP_REGISTRY } from '../github-broker-ops.js';
import {
  validateParams,
  resolveLimit,
  MAX_LIMIT,
  DEFAULT_LIMIT,
} from '../github-broker-validation.js';
import { truncateWithMarker } from '../github-broker-shaping.js';
import { withBodyFiles } from '../github-broker-body-file.js';
import {
  buildIssueCreateArgv,
  buildIssueCommentArgv,
  buildIssueCloseArgv,
  shapeCreatedUrl,
  validateIssueCreateParams,
} from '../github-broker-issue-write-ops.js';
import {
  buildPrCreateArgv,
  buildPrCommentArgv,
  buildPrEditArgv,
  buildPrReadyArgv,
  buildLabelCreateArgv,
} from '../github-broker-pr-write-ops.js';

/**
 * Every mutating operation. `issue.edit` and `pr.resolve-thread` are
 * multi-step (P11b) but are still writes, so they belong here: the
 * complement of this list must contain no mutating op.
 */
const WRITE_OPS = [
  'issue.create',
  'issue.comment',
  'issue.close',
  'pr.create',
  'pr.comment',
  'pr.edit',
  'pr.ready',
  'label.create',
  'issue.edit',
  'pr.resolve-thread',
] as const;

/** Ops covered by the single-call argv/shape assertions in this file. */
const SINGLE_CALL_WRITE_OPS = WRITE_OPS.filter(
  (name) => name !== 'issue.edit' && name !== 'pr.resolve-thread',
);

describe('P11a write operations', () => {
  describe('registry', () => {
    for (const name of WRITE_OPS) {
      /**
       * @plan PLAN-20260731-GHBROKER.P11
       * @requirement REQ-012
       */
      it(`${name} is registered and marked mutating`, () => {
        expect(OP_REGISTRY[name]).toBeDefined();
        expect(OP_REGISTRY[name].mutating).toBe(true);
      });
    }

    /**
     * @plan PLAN-20260731-GHBROKER.P11
     * @requirement REQ-012
     */
    it('no read operation is marked mutating', () => {
      const reads = Object.entries(OP_REGISTRY).filter(
        ([name]) => !(WRITE_OPS as readonly string[]).includes(name),
      );
      expect(reads.length).toBeGreaterThan(0);
      for (const [name, descriptor] of reads) {
        expect(descriptor.mutating, `${name} must not be mutating`).toBe(false);
      }
    });
  });

  describe('argv construction', () => {
    /**
     * Body text must never appear in argv. It is passed by file path.
     *
     * @plan PLAN-20260731-GHBROKER.P11
     * @requirement REQ-002
     */
    it('body is passed via --body-file, never inline', () => {
      const argv = buildIssueCreateArgv({
        title: 'T',
        body: '/tmp/body.md',
      });
      expect(argv).toContain('--body-file');
      expect(argv).not.toContain('--body');
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P11
     * @requirement REQ-009
     */
    it('every write op honours repo', () => {
      const cases: Array<[string, string[]]> = [
        ['issue.create', buildIssueCreateArgv({ title: 'T', repo: 'o/n' })],
        [
          'issue.comment',
          buildIssueCommentArgv({ number: 1, body: '/t', repo: 'o/n' }),
        ],
        ['issue.close', buildIssueCloseArgv({ number: 1, repo: 'o/n' })],
        ['pr.create', buildPrCreateArgv({ title: 'T', repo: 'o/n' })],
        [
          'pr.comment',
          buildPrCommentArgv({ number: 1, body: '/t', repo: 'o/n' }),
        ],
        ['pr.edit', buildPrEditArgv({ number: 1, repo: 'o/n' })],
        ['pr.ready', buildPrReadyArgv({ number: 1, repo: 'o/n' })],
        ['label.create', buildLabelCreateArgv({ name: 'bug', repo: 'o/n' })],
      ];
      for (const [name, argv] of cases) {
        const idx = argv.indexOf('--repo');
        expect(idx, `${name} must accept --repo`).toBeGreaterThan(-1);
        expect(argv[idx + 1]).toBe('o/n');
      }
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P11
     * @requirement REQ-002
     */
    it('repeatable label flags emit one flag per value', () => {
      const argv = buildPrEditArgv({
        number: 7,
        addLabel: ['bug', 'security'],
      });
      expect(argv.filter((a) => a === '--add-label')).toHaveLength(2);
      expect(argv).toContain('bug');
      expect(argv).toContain('security');
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P11
     * @requirement REQ-002
     */
    it('boolean flags emit no value operand', () => {
      const draft = buildPrCreateArgv({ title: 'T', draft: true });
      expect(draft).toContain('--draft');
      expect(draft[draft.indexOf('--draft') + 1]).not.toBe('true');

      const notDraft = buildPrCreateArgv({ title: 'T', draft: false });
      expect(notDraft).not.toContain('--draft');
    });
  });

  describe('shaping', () => {
    /**
     * @plan PLAN-20260731-GHBROKER.P11
     * @requirement REQ-013
     */
    it('extracts url and trailing number from gh create output', () => {
      const shaped = shapeCreatedUrl(
        'https://github.com/vybestack/llxprt-code/issues/2902\n',
      );
      expect(shaped.url).toBe(
        'https://github.com/vybestack/llxprt-code/issues/2902',
      );
      expect(shaped.number).toBe(2902);
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P11
     * @requirement REQ-013
     */
    it('yields a null number when output carries no trailing id', () => {
      expect(shapeCreatedUrl('not-a-url').number).toBeNull();
    });

    /**
     * The proxy client rejects arrays as response data, so no shape may
     * return one. This covers the single-call writes only; the whole
     * registry, including the multi-step issue.edit and pr.resolve-thread,
     * is covered by the envelope invariant in
     * github-broker-envelope.test.ts.
     *
     * @plan PLAN-20260731-GHBROKER.P11
     * @requirement REQ-013
     */
    it('no single-call write op shape returns an array', () => {
      for (const name of SINGLE_CALL_WRITE_OPS) {
        const shaped = OP_REGISTRY[name].shape('', { number: 1, name: 'x' });
        expect(Array.isArray(shaped), `${name} returned an array`).toBe(false);
        expect(typeof shaped).toBe('object');
      }
    });
  });

  describe('body temp-file lifecycle', () => {
    async function tmpBodyDirs(): Promise<string[]> {
      const entries = await readdir(tmpdir());
      return entries.filter((e) => e.startsWith('llxprt-gh-body-'));
    }

    /**
     * @plan PLAN-20260731-GHBROKER.P11
     * @requirement REQ-002
     */
    it('writes body text to a file and exposes its path', async () => {
      let seenPath = '';
      let contents = '';
      await withBodyFiles(
        ['body'],
        { body: 'line one\nline two' },
        async (p) => {
          seenPath = p.body as string;
          contents = await readFile(seenPath, 'utf8');
        },
      );
      expect(seenPath).toContain('llxprt-gh-body-');
      expect(contents).toBe('line one\nline two');
    });

    /**
     * The failure path is the one that leaks, and gh failures surface as
     * exceptions routinely.
     *
     * @plan PLAN-20260731-GHBROKER.P11
     * @requirement REQ-002
     */
    it('removes the temp directory even when the operation throws', async () => {
      const before = await tmpBodyDirs();
      await expect(
        withBodyFiles(['body'], { body: 'x' }, async () => {
          throw new Error('gh failed');
        }),
      ).rejects.toThrow('gh failed');
      const after = await tmpBodyDirs();
      expect(after.length).toBe(before.length);
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P11
     * @requirement REQ-002
     */
    it('is a no-op when no body parameter is present', async () => {
      const before = await tmpBodyDirs();
      const out = await withBodyFiles(['body'], { number: 1 }, async (p) => p);
      expect(out).toStrictEqual({ number: 1 });
      expect((await tmpBodyDirs()).length).toBe(before.length);
    });
  });
});

describe('required parameters', () => {
  /**
   * Builders interpolate positionals directly, so without this check a
   * missing number reaches gh as the literal string "undefined".
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-002
   */
  it('rejects an operation missing a required positional', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['issue.close', {}],
      ['issue.comment', { body: 'x' }],
      ['pr.ready', {}],
      ['pr.resolve-thread', {}],
      ['label.create', {}],
      ['search.issues', {}],
    ];
    for (const [name, params] of cases) {
      const descriptor = OP_REGISTRY[name];
      const error = validateParams(
        descriptor.params,
        params,
        descriptor.requiredParams,
      );
      expect(
        error,
        `${name} must reject missing required params`,
      ).not.toBeNull();
      expect(error?.message).toContain('Missing required parameter');
    }
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-002
   */
  it('accepts an operation once required params are supplied', () => {
    const descriptor = OP_REGISTRY['issue.close'];
    expect(
      validateParams(
        descriptor.params,
        { number: 7 },
        descriptor.requiredParams,
      ),
    ).toBeNull();
  });

  /**
   * Every op whose builder interpolates a positional must declare it, or the
   * "undefined" argv bug returns for that op alone.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-002
   */
  it('declares required params for every op that interpolates one', () => {
    const undeclared = Object.entries(OP_REGISTRY)
      .filter(([, d]) => d.buildArgv({}).includes('undefined'))
      .filter(([, d]) => (d.requiredParams ?? []).length === 0)
      .map(([name]) => name);
    expect(
      undeclared,
      'ops interpolate a positional but declare no requiredParams',
    ).toStrictEqual([]);
  });
});

describe('truncation is byte-accurate', () => {
  /**
   * The budget is measured in UTF-8 bytes, so the cut must be too. Slicing
   * by UTF-16 code units under-cuts multi-byte text, leaving a result that
   * is still over budget.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-013
   */
  it('respects the byte budget for multi-byte text', () => {
    const emoji = '😀'.repeat(200); // 4 UTF-8 bytes each, 2 UTF-16 units each
    const limit = 100;
    const out = truncateWithMarker(emoji, 'body', limit);
    expect(out.truncated).not.toBeNull();
    expect(Buffer.byteLength(out.value, 'utf8')).toBeLessThanOrEqual(limit);
  });

  /**
   * Cutting mid-sequence must not leave a replacement character.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-013
   */
  it('does not split a multi-byte character', () => {
    const out = truncateWithMarker('😀'.repeat(50), 'body', 21);
    expect(out.value).not.toContain('\uFFFD');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-013
   */
  it('leaves text within budget untouched', () => {
    const out = truncateWithMarker('short', 'body', 1000);
    expect(out.truncated).toBeNull();
    expect(out.value).toBe('short');
  });
});

describe('parameter edge cases from review', () => {
  /**
   * Short hex is what colour pickers and GitHub itself produce, so
   * rejecting it turned a valid label colour into INVALID_PARAM.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-002
   */
  it('accepts both 3- and 6-digit hex colours', () => {
    const spec = OP_REGISTRY['label.create'].params;
    for (const color of ['#FFF', 'FFF', '#ff00aa', 'ff00aa']) {
      expect(
        validateParams(spec, { name: 'bug', color }),
        `${color} should be accepted`,
      ).toBeNull();
    }
    expect(
      validateParams(spec, { name: 'bug', color: 'nothex' }),
    ).not.toBeNull();
  });

  /**
   * resolveLimit is exported, so it must clamp rather than trust that a
   * caller validated first.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-013
   */
  it('clamps an oversized limit instead of trusting the caller', () => {
    expect(resolveLimit({ limit: 5000 })).toBe(MAX_LIMIT);
    expect(resolveLimit({ limit: 5 })).toBe(5);
    expect(resolveLimit({})).toBe(DEFAULT_LIMIT);
  });
});

/**
 * Issue #3407: `gh issue create` has no `--type` flag, so `issue.create`
 * cannot accept `type` — but the old rejection only listed what the op DOES
 * accept, leaving no recovery path. The reporter watched an agent retry the
 * identical rejected call repeatedly instead of switching to `issue.edit`.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-4
 * @issue 3407
 */
describe('issue #3407: issue.create rejects type and redirects to issue.edit', () => {
  /**
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-4
   * @issue 3407
   */
  it('still rejects type rather than silently accepting it', () => {
    const result = validateIssueCreateParams({ title: 'T', type: 'Bug' });
    expect(result?.code).toBe('INVALID_PARAM');
  });

  /**
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-4
   * @issue 3407
   */
  it('names issue.edit and says the type is set after creation', () => {
    const result = validateIssueCreateParams({ title: 'T', type: 'Bug' });
    expect(result?.message).toContain('issue.edit');
    expect(result?.message.toLowerCase()).toContain('after creation');
  });

  /**
   * The redirect must not leak into ops that legitimately accept `type`.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-4
   * @issue 3407
   */
  it('issue.edit still accepts type without complaint', () => {
    expect(OP_REGISTRY['issue.edit'].params.type).toBeDefined();
  });
});
