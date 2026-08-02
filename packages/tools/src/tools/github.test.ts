/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural tests for the `github` tool.
 *
 * The properties that matter are: every mutating operation prompts, no read
 * operation prompts, unknown operations are rejected before reaching the
 * broker, and the tool never handles a credential.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-008, REQ-012, REQ-013
 * @pseudocode 003-github-broker.md lines 38-55
 */

import { describe, it, expect } from 'vitest';
import {
  GithubTool,
  MUTATING_OPS,
  SUPPORTED_OPS,
  renderChecks,
  type GitHubBrokerClient,
} from './github.js';

/** Records the operations dispatched to the broker. */
function stubClient(
  result: Record<string, unknown> = { ok: true },
): GitHubBrokerClient & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return {
    calls,
    async runOperation(op, params) {
      calls.push([op, params]);
      return result;
    },
  };
}

describe('github tool', () => {
  describe('operation validation', () => {
    /**
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-002
     */
    it('rejects an unknown operation before it reaches the broker', () => {
      const tool = new GithubTool(stubClient());
      expect(tool.validateToolParams({ op: 'issue.destroy' })).not.toBeNull();
      expect(() => tool.build({ op: 'issue.destroy' })).toThrow(
        /must be equal to one of/,
      );
    });

    /**
     * The operation list lives in the schema as an enum, so the model sees
     * the valid values in the function declaration rather than discovering
     * them by trial and error.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */
    it('publishes the operation list in the parameter schema', () => {
      const tool = new GithubTool(stubClient());
      const schema = tool.parameterSchema as {
        properties: { op: { enum: string[] } };
      };
      expect(schema.properties.op.enum).toStrictEqual([...SUPPORTED_OPS]);
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */
    it('accepts every supported operation', () => {
      const tool = new GithubTool(stubClient());
      for (const op of SUPPORTED_OPS) {
        expect(
          tool.validateToolParams({ op }),
          `${op} must validate`,
        ).toBeNull();
      }
    });
  });

  describe('confirmation', () => {
    /**
     * A prompt-injected agent must not write under the user's identity
     * unattended.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-012
     */
    it('prompts for every mutating operation', async () => {
      const tool = new GithubTool(stubClient());
      for (const op of MUTATING_OPS) {
        const invocation = tool.build({ op, number: 1 });
        const confirmation = await invocation.shouldConfirmExecute(
          new AbortController().signal,
        );
        expect(confirmation, `${op} must prompt`).not.toBe(false);
      }
    });

    /**
     * Prompting on reads would make the tool intolerable to use.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-012
     */
    it('never prompts for a read operation', async () => {
      const tool = new GithubTool(stubClient());
      const reads = SUPPORTED_OPS.filter((op) => !MUTATING_OPS.has(op));
      expect(reads.length).toBeGreaterThan(0);
      // Use parameters each op actually takes. Passing `number` to
      // issue.list or search.issues exercised a shape those ops never
      // receive, so the assertion held for the wrong reason.
      const paramsFor = (op: string): Record<string, unknown> => {
        if (op.startsWith('search.')) return { query: 'sandbox' };
        if (op.endsWith('.list')) return { limit: 5 };
        return { number: 1 };
      };
      for (const op of reads) {
        const invocation = tool.build({ op, ...paramsFor(op) });
        const confirmation = await invocation.shouldConfirmExecute(
          new AbortController().signal,
        );
        expect(confirmation, `${op} must not prompt`).toBe(false);
      }
    });

    /**
     * Every mutating op in the tool must exist in the supported set, or a
     * write could silently bypass confirmation by being unreachable here.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-012
     */
    it('lists every mutating operation among the supported operations', () => {
      for (const op of MUTATING_OPS) {
        expect(SUPPORTED_OPS, `${op} missing from SUPPORTED_OPS`).toContain(op);
      }
    });

    /**
     * The inverse direction, which is the one that fails open. Anything not
     * in MUTATING_OPS is treated as a read and skips confirmation, so a
     * write added to SUPPORTED_OPS without being classified would silently
     * execute unattended. Pinning the read set means adding an operation
     * forces a deliberate choice here rather than defaulting to no prompt.
     *
     * @plan PLAN-20260731-GHBROKER.P19
     * @requirement REQ-012
     */
    it('classifies every supported operation as read or mutating', () => {
      const KNOWN_READ_OPS = [
        'issue.view',
        'issue.list',
        'pr.view',
        'pr.list',
        'pr.diff',
        'pr.checks',
        'pr.reviews',
        'search.issues',
        'search.prs',
        'run.list',
        'label.list',
      ];
      const unclassified = SUPPORTED_OPS.filter(
        (op) => !MUTATING_OPS.has(op) && !KNOWN_READ_OPS.includes(op),
      );
      expect(
        unclassified,
        'operations must be added to MUTATING_OPS or to the known-read list; anything else silently skips confirmation',
      ).toStrictEqual([]);
    });
  });

  describe('dispatch', () => {
    /**
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-009
     */
    it('forwards parameters except op, including repo', async () => {
      const client = stubClient({ number: 42 });
      const tool = new GithubTool(client);
      const invocation = tool.build({
        op: 'issue.view',
        number: 42,
        repo: 'acoliver/other',
        comments: true,
      });
      await invocation.execute(new AbortController().signal);
      expect(client.calls).toHaveLength(1);
      const [op, params] = client.calls[0];
      expect(op).toBe('issue.view');
      expect(params).toStrictEqual({
        number: 42,
        repo: 'acoliver/other',
        comments: true,
      });
      expect(params).not.toHaveProperty('op');
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-013
     */
    it('returns shaped data as JSON for the model', async () => {
      const tool = new GithubTool(stubClient({ number: 7, title: 'X' }));
      const result = await tool
        .build({ op: 'issue.view', number: 7 })
        .execute(new AbortController().signal);
      expect(String(result.llmContent)).toContain('"number": 7');
      expect(String(result.llmContent)).toContain('"title": "X"');
    });

    /**
     * A broker failure must surface as a tool error, not a thrown exception
     * that aborts the turn.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-013
     */
    it('reports a broker failure as a tool error', async () => {
      const failing: GitHubBrokerClient = {
        async runOperation() {
          throw new Error('NOT_FOUND: no such issue');
        },
      };
      const tool = new GithubTool(failing);
      const result = await tool
        .build({ op: 'issue.view', number: 1 })
        .execute(new AbortController().signal);
      expect(result.error?.message).toContain('NOT_FOUND');
      expect(String(result.llmContent)).toContain('NOT_FOUND');
    });
  });

  describe('watch presentation', () => {
    const watchResult = {
      concluded: true,
      cancelled: false,
      summary: { pass: 2, fail: 1, pending: 0, skipping: 0 },
      checks: [
        { name: 'test', bucket: 'pass' },
        { name: 'lint', bucket: 'fail' },
        { name: 'build', bucket: 'pass' },
      ],
    };

    /**
     * After waiting minutes for CI, the thing that broke is what you need,
     * not an alphabetical roster.
     *
     * @plan PLAN-20260731-GHBROKER.P14
     * @requirement REQ-011
     */
    it('lists failures first', () => {
      const rendered = renderChecks(watchResult);
      const lines = rendered.split(String.fromCharCode(10));
      expect(lines[1]).toContain('lint');
      expect(lines[0]).toContain('complete');
      expect(lines[0]).toContain('1 fail');
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P14
     * @requirement REQ-011
     */
    it('distinguishes cancelled from complete', () => {
      expect(
        renderChecks({ ...watchResult, concluded: false, cancelled: true }),
      ).toContain('cancelled');
      expect(renderChecks({ ...watchResult })).toContain('complete');
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P14
     * @requirement REQ-011
     */
    it('handles a watch that reported no checks', () => {
      expect(renderChecks({ checks: [] })).toBe('No checks reported.');
    });

    /**
     * A multi-minute silent block is indistinguishable from a hang, so the
     * watch must emit progress immediately rather than after the first tick.
     *
     * @plan PLAN-20260731-GHBROKER.P14
     * @requirement REQ-011
     */
    it('reports progress as soon as a watch starts', async () => {
      const updates: string[] = [];
      const tool = new GithubTool(stubClient(watchResult));
      await tool
        .build({ op: 'pr.checks', number: 1, watch: true })
        .execute(new AbortController().signal, (u) => {
          if (u.mode === 'append') updates.push(u.data);
        });
      expect(updates.length).toBeGreaterThan(0);
      expect(updates[0]).toContain('Waiting for checks on #1');
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P14
     * @requirement REQ-011
     */
    it('emits no progress for a non-watch operation', async () => {
      const updates: string[] = [];
      const tool = new GithubTool(stubClient({ number: 1 }));
      await tool
        .build({ op: 'pr.checks', number: 1 })
        .execute(new AbortController().signal, (u) => {
          if (u.mode === 'append') updates.push(u.data);
        });
      expect(updates).toStrictEqual([]);
    });
  });

  describe('description', () => {
    /**
     * The description is what steers a model to this tool instead of
     * shelling out to gh, so the guidance must actually be present.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */
    it('documents gh-flag naming, cross-repo use and the blocking watch', () => {
      const tool = new GithubTool(stubClient());
      expect(tool.description).toContain('mirror');
      expect(tool.description).toContain('owner/name');
      expect(tool.description).toContain('BLOCKS');
      expect(tool.description).toContain('actionable');
    });
  });
});
